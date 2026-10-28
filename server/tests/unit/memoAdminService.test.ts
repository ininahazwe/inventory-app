// tests/unit/memoAdminService.test.ts
// Administration des mémos : validation des circuits et écritures, sur un exécuteur SQL scénarisé.
import {
    normaliseChain, createProject, updateProject, createType, updateType,
    createTemplate, updateTemplate, replaceChain, loadAdminConfig,
} from '../../src/services/memoAdminService';
import { scriptedTx, rows, ok } from '../helpers/scriptedTx';

const std = [
    { kind: 'recommend', position_code: 'manager' },
    { kind: 'approve', position_code: 'director' },
    { kind: 'release', position_code: 'finance', label: 'Paid' },
] as any;
const positions = rows([{ id: 2, code: 'manager' }, { id: 3, code: 'director' }, { id: 4, code: 'finance' }]);

describe('normaliseChain', () => {
    it('fills the default label of each kind and keeps a custom one', () => {
        const c = normaliseChain(std);
        expect(c.map(s => s.label)).toEqual(['Recommended for approval', 'Approved', 'Paid']);
    });
    it.each([
        ['empty', [], /at least one step/],
        ['not an array', 'x', /at least one step/],
        ['no approval', [{ kind: 'recommend', position_code: 'manager' }], /approval step/],
        ['release before approval', [{ kind: 'release', position_code: 'finance' }, { kind: 'approve', position_code: 'director' }], /Release steps must come last/],
        ['agent level', [{ kind: 'approve', position_code: 'agent' }], /agent level cannot sign/],
        ['bad kind', [{ kind: 'sign', position_code: 'manager' }], /kind must be/],
        ['missing level', [{ kind: 'approve', position_code: '' }], /pick a level/],
        ['too many', Array.from({ length: 9 }, () => ({ kind: 'approve', position_code: 'director' })), /at most 8/],
    ])('rejects %s (400)', (_n, input, re) => {
        expect(() => normaliseChain(input)).toThrow(re as RegExp);
    });
    it('allows several release steps at the end', () => {
        expect(normaliseChain([{ kind: 'approve', position_code: 'director' }, { kind: 'release', position_code: 'finance' }, { kind: 'release', position_code: 'finance' }])).toHaveLength(3);
    });
});

describe('projects', () => {
    it('creates a project after checking the code is free', async () => {
        const s = scriptedTx([['SELECT id FROM memo_projects WHERE code', rows([])], ['INSERT INTO memo_projects', ok({ insertId: 7 })]]);
        const r = await createProject(s.tx, { code: 'EU-2026/A', title: ' Media ', donor: ' EU ', default_currency: 'eur' });
        s.done();
        expect(r.id).toBe(7);
        expect(s.params(2)).toEqual(['EU-2026/A', 'Media', 'EU', 'EUR']);
    });
    it('409 on a duplicate code, 400 on a bad code, title or currency', async () => {
        await expect(createProject(scriptedTx([['SELECT id FROM memo_projects', rows([{ id: 1 }])]]).tx, { code: 'P1', title: 't' })).rejects.toMatchObject({ statusCode: 409 });
        await expect(createProject(scriptedTx([]).tx, { code: 'bad code', title: 't' })).rejects.toMatchObject({ statusCode: 400 });
        await expect(createProject(scriptedTx([]).tx, { code: 'P1', title: ' ' })).rejects.toMatchObject({ statusCode: 400 });
        await expect(createProject(scriptedTx([]).tx, { code: 'P1', title: 't', default_currency: 'EURO' })).rejects.toMatchObject({ statusCode: 400 });
    });
    it('updates, deactivates, 404 for an unknown project, 400 when empty', async () => {
        const s = scriptedTx([['UPDATE memo_projects SET title = ?, is_active = ?', ok()]]);
        await updateProject(s.tx, 3, { title: 'New', is_active: false });
        expect(s.params(1)).toEqual(['New', 0, 3]);
        await expect(updateProject(scriptedTx([['UPDATE memo_projects', ok({ affectedRows: 0 })]]).tx, 9, { title: 'x' })).rejects.toMatchObject({ statusCode: 404 });
        await expect(updateProject(scriptedTx([]).tx, 3, {})).rejects.toMatchObject({ statusCode: 400 });
    });
});

describe('types', () => {
    it('creates a type with its « Standard » chain (default manager → director)', async () => {
        const s = scriptedTx([
            ['SELECT id FROM memo_types WHERE code', rows([])],
            ['INSERT INTO memo_types', ok({ insertId: 4 })],
            ['INSERT INTO memo_chain_templates', ok({ insertId: 11 })],
            ['FROM memo_positions', rows([{ id: 2, code: 'manager' }, { id: 3, code: 'director' }])],
            ['DELETE FROM memo_chain_steps', ok()],
            ['INSERT INTO memo_chain_steps', ok()],
        ]);
        const r = await createType(s.tx, { code: 'Travel_Request', name: 'Travel request', requires_amount: true });
        s.done();
        expect(r).toEqual({ typeId: 4, templateId: 11 });
        expect(s.params(2)).toEqual(['travel_request', 'Travel request', 1, 0, 0]);
        expect(s.params(6)).toEqual([11, 1, 'recommend', 2, 'Recommended for approval', 11, 2, 'approve', 3, 'Approved']);
    });
    it('409 on a duplicate code; 400 on a bad code or an invalid chain (nothing written)', async () => {
        await expect(createType(scriptedTx([['SELECT id FROM memo_types', rows([{ id: 1 }])]]).tx, { code: 'authorisation', name: 'x' })).rejects.toMatchObject({ statusCode: 409 });
        await expect(createType(scriptedTx([]).tx, { code: '1bad', name: 'x' })).rejects.toMatchObject({ statusCode: 400 });
        await expect(createType(scriptedTx([]).tx, { code: 'ok_code', name: 'x', steps: [{ kind: 'recommend', position_code: 'manager' }] as any })).rejects.toMatchObject({ statusCode: 400 });
    });
    it('updates flags and name', async () => {
        const s = scriptedTx([['UPDATE memo_types SET name = ?, requires_attachment = ?, is_active = ?', ok()]]);
        await updateType(s.tx, 2, { name: 'N', requires_attachment: true, is_active: false });
        expect(s.params(1)).toEqual(['N', 1, 0, 2]);
        await expect(updateType(scriptedTx([['UPDATE memo_types', ok({ affectedRows: 0 })]]).tx, 9, { name: 'x' })).rejects.toMatchObject({ statusCode: 404 });
    });
});

describe('chains', () => {
    it('creates an extra chain, optionally as the default', async () => {
        const s = scriptedTx([
            ['SELECT id FROM memo_types WHERE id', rows([{ id: 1 }])],
            ['SELECT id FROM memo_chain_templates WHERE type_id = ? AND name', rows([])],
            ['INSERT INTO memo_chain_templates', ok({ insertId: 20 })],
            ['FROM memo_positions', positions],
            ['DELETE FROM memo_chain_steps', ok()],
            ['INSERT INTO memo_chain_steps', ok()],
            ['SET is_default = IF(id = ?, 1, 0)', ok()],
        ]);
        expect(await createTemplate(s.tx, 1, { name: 'Urgent', steps: std, is_default: true })).toEqual({ templateId: 20 });
        s.done();
        expect(s.params(7)).toEqual([20, 1]);
    });
    it('409 for a duplicate name, 404 for an unknown type', async () => {
        await expect(createTemplate(scriptedTx([['FROM memo_types', rows([{ id: 1 }])], ['FROM memo_chain_templates', rows([{ id: 5 }])]]).tx, 1, { name: 'Standard', steps: std })).rejects.toMatchObject({ statusCode: 409 });
        await expect(createTemplate(scriptedTx([['FROM memo_types', rows([])]]).tx, 9, { name: 'x', steps: std })).rejects.toMatchObject({ statusCode: 404 });
    });

    it('replaceChain rewrites the steps in order, numbered from 1', async () => {
        const s = scriptedTx([
            ['FROM memo_chain_templates WHERE id = ? FOR UPDATE', rows([{ id: 3, type_id: 1, is_active: 1, is_default: 1 }])],
            ['FROM memo_positions', positions],
            ['DELETE FROM memo_chain_steps', ok()],
            ['INSERT INTO memo_chain_steps', ok()],
        ]);
        expect(await replaceChain(s.tx, 3, std)).toEqual({ steps: 3 });
        s.done();
        expect(s.params(4)).toEqual([3, 1, 'recommend', 2, 'Recommended for approval', 3, 2, 'approve', 3, 'Approved', 3, 3, 'release', 4, 'Paid']);
    });
    it('replaceChain: unknown level → 400 ; unknown chain → 404 ; invalid shape → 400 before any query', async () => {
        await expect(replaceChain(scriptedTx([
            ['FOR UPDATE', rows([{ id: 3, type_id: 1 }])], ['FROM memo_positions', rows([{ id: 3, code: 'director' }])],
        ]).tx, 3, [{ kind: 'approve', position_code: 'director' }, { kind: 'release', position_code: 'treasury' }])).rejects.toMatchObject({ statusCode: 400 });
        await expect(replaceChain(scriptedTx([['FOR UPDATE', rows([])]]).tx, 9, std)).rejects.toMatchObject({ statusCode: 404 });
        await expect(replaceChain(scriptedTx([]).tx, 3, [])).rejects.toMatchObject({ statusCode: 400 });
    });

    describe('updateTemplate', () => {
        const tpl = (o: any = {}) => ({ id: 3, type_id: 1, name: 'Standard', is_default: 1, is_active: 1, ...o });
        it('deactivating the default chain promotes another active one', async () => {
            const s = scriptedTx([
                ['FOR UPDATE', rows([tpl()])],
                ['AND is_active = 1 AND id <> ?', rows([{ id: 8 }])],
                ['SET is_active = 0, is_default = 0', ok()],
                ['SET is_default = 1 WHERE id = ?', ok()],
            ]);
            await updateTemplate(s.tx, 3, { is_active: false });
            s.done();
            expect(s.params(4)).toEqual([8]);
        });
        it('refuses to deactivate the last active chain of a type (409)', async () => {
            await expect(updateTemplate(scriptedTx([['FOR UPDATE', rows([tpl()])], ['AND is_active = 1 AND id <> ?', rows([])]]).tx, 3, { is_active: false }))
                .rejects.toMatchObject({ statusCode: 409 });
        });
        it('makes a chain the default (only one per type), refuses an inactive one', async () => {
            const s = scriptedTx([['FOR UPDATE', rows([tpl({ is_default: 0 })])], ['SET is_default = IF(id = ?, 1, 0)', ok()]]);
            await updateTemplate(s.tx, 3, { is_default: true });
            expect(s.params(2)).toEqual([3, 1]);
            await expect(updateTemplate(scriptedTx([['FOR UPDATE', rows([tpl({ is_active: 0, is_default: 0 })])]]).tx, 3, { is_default: true })).rejects.toMatchObject({ statusCode: 409 });
        });
        it('renames, refusing a name already used by another chain of the type (409)', async () => {
            const s = scriptedTx([['FOR UPDATE', rows([tpl()])], ['AND name = ? AND id <> ?', rows([])], ['SET name = ?', ok()]]);
            await updateTemplate(s.tx, 3, { name: ' Urgent ' });
            expect(s.params(3)).toEqual(['Urgent', 3]);
            await expect(updateTemplate(scriptedTx([['FOR UPDATE', rows([tpl()])], ['AND name = ? AND id <> ?', rows([{ id: 4 }])]]).tx, 3, { name: 'Urgent' })).rejects.toMatchObject({ statusCode: 409 });
        });
    });
});

describe('loadAdminConfig', () => {
    it('nests templates and their steps under each type', async () => {
        const s = scriptedTx([
            ['FROM memo_types t', rows([{ id: 1, code: 'funds_request', name: 'Request for funds' }])],
            ['FROM memo_chain_templates t', rows([{ id: 3, type_id: 1, name: 'Standard', is_default: 1, is_active: 1, memo_count: 4 }])],
            ['FROM memo_chain_steps cs', rows([{ template_id: 3, step_no: 1, kind: 'recommend', position_code: 'manager', holders: 2 }])],
            ['FROM memo_projects p', rows([{ id: 1, code: 'P1' }])],
            ['FROM memo_positions', rows([{ code: 'manager', label: 'Manager' }])],
        ]);
        const c = await loadAdminConfig(s.tx);
        s.done();
        expect(c.types[0].templates[0].steps[0]).toMatchObject({ position_code: 'manager', holders: 2 });
        expect(c.projects).toHaveLength(1);
        expect(c.levels).toEqual([{ code: 'manager', label: 'Manager' }]);
    });
});
