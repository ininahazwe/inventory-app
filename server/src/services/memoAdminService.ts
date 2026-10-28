// server/src/services/memoAdminService.ts
// Administration du module Mémos : projets, types de mémo et circuits de validation.
// Les niveaux (agent / manager / director / finance) sont fixes ; on édite les types,
// les modèles de circuit et leurs pas. Un mémo déjà soumis garde son circuit figé
// (memo_steps) : modifier un modèle n'affecte que les mémos soumis ensuite.
import { BusinessException, ConflictException, NotFoundException } from '../exceptions';
import type { Executor } from './loanService';

export type ChainKind = 'recommend' | 'approve' | 'release';
export type ChainStepInput = { kind: ChainKind; position_code: string; label?: string | null };
export type ChainStep = { kind: ChainKind; position_code: string; label: string };

export const MAX_CHAIN_STEPS = 8;
export const DEFAULT_STEP_LABEL: Record<ChainKind, string> = {
    recommend: 'Recommended for approval',
    approve: 'Approved',
    release: 'Funds released',
};
/** Circuit proposé à la création d'un type (modifiable ensuite). */
export const DEFAULT_CHAIN: ChainStepInput[] = [
    { kind: 'recommend', position_code: 'manager' },
    { kind: 'approve', position_code: 'director' },
];

const TYPE_CODE_RE = /^[a-z][a-z0-9_]{1,39}$/;
const PROJECT_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,39}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;

const text = (v: unknown, field: string, max: number, required = true): string => {
    const s = typeof v === 'string' ? v.trim() : '';
    if (!s && required) throw new BusinessException(`${field} is required`);
    if (s.length > max) throw new BusinessException(`${field} is too long (max ${max} characters)`);
    return s;
};

/**
 * Valide et normalise un circuit. Mêmes règles que le contrôle fait à la soumission
 * (memoService.assertChainShape) : au moins une approbation, les décaissements en dernier.
 */
export function normaliseChain(input: unknown): ChainStep[] {
    if (!Array.isArray(input) || input.length === 0) throw new BusinessException('A chain needs at least one step');
    if (input.length > MAX_CHAIN_STEPS) throw new BusinessException(`A chain has at most ${MAX_CHAIN_STEPS} steps`);
    const steps: ChainStep[] = input.map((raw: any, i: number) => {
        const kind = raw?.kind as ChainKind;
        if (!['recommend', 'approve', 'release'].includes(kind)) {
            throw new BusinessException(`Step ${i + 1}: kind must be 'recommend', 'approve' or 'release'`);
        }
        const code = typeof raw?.position_code === 'string' ? raw.position_code.trim() : '';
        if (!code) throw new BusinessException(`Step ${i + 1}: pick a level`);
        if (code === 'agent') throw new BusinessException(`Step ${i + 1}: the agent level cannot sign a step — the author submits automatically`);
        const label = text(raw?.label, `Step ${i + 1} label`, 150, false) || DEFAULT_STEP_LABEL[kind];
        return { kind, position_code: code, label };
    });
    if (!steps.some(s => s.kind === 'approve')) throw new BusinessException('A chain needs at least one approval step');
    const firstRelease = steps.findIndex(s => s.kind === 'release');
    if (firstRelease !== -1 && steps.slice(firstRelease).some(s => s.kind !== 'release')) {
        throw new BusinessException('Release steps must come last');
    }
    return steps;
}

async function resolvePositions(tx: Executor, steps: ChainStep[]): Promise<Map<string, number>> {
    const codes = [...new Set(steps.map(s => s.position_code))];
    const [rows] = await tx.execute(
        `SELECT id, code FROM memo_positions WHERE is_active = 1 AND code IN (${codes.map(() => '?').join(',')})`,
        codes
    );
    const map = new Map<string, number>(((rows as any[]) || []).map(r => [String(r.code), Number(r.id)] as [string, number]));
    const unknown = codes.filter(c => !map.has(c));
    if (unknown.length) throw new BusinessException(`Unknown level: ${unknown.join(', ')}`);
    return map;
}

async function writeChain(tx: Executor, templateId: number, steps: ChainStep[]): Promise<void> {
    const pos = await resolvePositions(tx, steps);
    await tx.execute('DELETE FROM memo_chain_steps WHERE template_id = ?', [templateId]);
    const values = steps.map((s, i) => [templateId, i + 1, s.kind, pos.get(s.position_code)!, s.label]);
    await tx.execute(
        `INSERT INTO memo_chain_steps (template_id, step_no, kind, position_id, label)
         VALUES ${values.map(() => '(?,?,?,?,?)').join(',')}`,
        values.flat()
    );
}

// ─── Lecture ────────────────────────────────────────────────────────────────

export async function loadAdminConfig(tx: Executor) {
    const [types] = await tx.execute(
        `SELECT t.id, t.code, t.name, t.requires_amount, t.requires_project, t.requires_attachment, t.is_active,
                (SELECT COUNT(*) FROM memos m WHERE m.type_id = t.id) AS memo_count
         FROM memo_types t ORDER BY t.name`);
    const [templates] = await tx.execute(
        `SELECT t.id, t.type_id, t.name, t.is_default, t.is_active,
                (SELECT COUNT(*) FROM memos m WHERE m.template_id = t.id) AS memo_count
         FROM memo_chain_templates t ORDER BY t.type_id, t.is_default DESC, t.id`);
    const [steps] = await tx.execute(
        `SELECT cs.template_id, cs.step_no, cs.kind, cs.label, p.code AS position_code, p.label AS position_label,
                (SELECT COUNT(*) FROM memo_position_holders h WHERE h.position_id = p.id AND h.is_active = 1) AS holders
         FROM memo_chain_steps cs JOIN memo_positions p ON p.id = cs.position_id
         ORDER BY cs.template_id, cs.step_no`);
    const [projects] = await tx.execute(
        `SELECT p.id, p.code, p.title, p.donor, p.default_currency, p.is_active,
                (SELECT COUNT(*) FROM memos m WHERE m.project_id = p.id) AS memo_count
         FROM memo_projects p ORDER BY p.code`);
    const [levels] = await tx.execute(
        `SELECT code, label FROM memo_positions WHERE is_active = 1 AND code <> 'agent' ORDER BY sort_order`);

    const stepsOf = new Map<number, any[]>();
    for (const s of (steps as any[]) || []) {
        if (!stepsOf.has(s.template_id)) stepsOf.set(s.template_id, []);
        stepsOf.get(s.template_id)!.push(s);
    }
    const templatesOf = new Map<number, any[]>();
    for (const t of (templates as any[]) || []) {
        if (!templatesOf.has(t.type_id)) templatesOf.set(t.type_id, []);
        templatesOf.get(t.type_id)!.push({ ...t, steps: stepsOf.get(t.id) || [] });
    }
    return {
        types: ((types as any[]) || []).map(t => ({ ...t, templates: templatesOf.get(t.id) || [] })),
        projects: projects || [],
        levels: levels || [],
    };
}

// ─── Projets ────────────────────────────────────────────────────────────────

export async function createProject(
    tx: Executor, input: { code?: string; title?: string; donor?: string | null; default_currency?: string | null }
): Promise<{ id: number }> {
    const code = text(input.code, 'code', 40);
    if (!PROJECT_CODE_RE.test(code)) throw new BusinessException('code may only contain letters, digits and . _ / -');
    const title = text(input.title, 'title', 255);
    const donor = text(input.donor, 'donor', 255, false) || null;
    const currency = input.default_currency ? String(input.default_currency).trim().toUpperCase() : null;
    if (currency && !CURRENCY_RE.test(currency)) throw new BusinessException("default_currency must be a 3-letter code such as 'EUR'");

    const [dup] = await tx.execute('SELECT id FROM memo_projects WHERE code = ?', [code]);
    if ((dup as any[]).length) throw new ConflictException(`A project with the code ${code} already exists`);
    const [r] = await tx.execute(
        'INSERT INTO memo_projects (code, title, donor, default_currency, is_active) VALUES (?, ?, ?, ?, 1)',
        [code, title, donor, currency]
    );
    return { id: Number((r as any).insertId) };
}

/** Le code ne change pas (il apparaît sur des mémos) ; on désactive plutôt que de supprimer. */
export async function updateProject(
    tx: Executor, id: number,
    patch: { title?: string; donor?: string | null; default_currency?: string | null; is_active?: boolean }
): Promise<void> {
    const sets: string[] = [];
    const params: any[] = [];
    if (patch.title !== undefined) { sets.push('title = ?'); params.push(text(patch.title, 'title', 255)); }
    if (patch.donor !== undefined) { sets.push('donor = ?'); params.push(text(patch.donor, 'donor', 255, false) || null); }
    if (patch.default_currency !== undefined) {
        const c = patch.default_currency ? String(patch.default_currency).trim().toUpperCase() : null;
        if (c && !CURRENCY_RE.test(c)) throw new BusinessException("default_currency must be a 3-letter code such as 'EUR'");
        sets.push('default_currency = ?'); params.push(c);
    }
    if (patch.is_active !== undefined) { sets.push('is_active = ?'); params.push(patch.is_active ? 1 : 0); }
    if (!sets.length) throw new BusinessException('Nothing to update');
    const [r] = await tx.execute(`UPDATE memo_projects SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
    if (!(r as any).affectedRows) throw new NotFoundException('Project not found');
}

// ─── Types de mémo ──────────────────────────────────────────────────────────

export async function createType(
    tx: Executor,
    input: { code?: string; name?: string; requires_amount?: boolean; requires_project?: boolean; requires_attachment?: boolean; steps?: ChainStepInput[] }
): Promise<{ typeId: number; templateId: number }> {
    const code = text(input.code, 'code', 40).toLowerCase();
    if (!TYPE_CODE_RE.test(code)) throw new BusinessException('code must start with a letter and use only lowercase letters, digits and _ (2–40 characters)');
    const name = text(input.name, 'name', 150);
    const steps = normaliseChain(input.steps ?? DEFAULT_CHAIN);

    const [dup] = await tx.execute('SELECT id FROM memo_types WHERE code = ?', [code]);
    if ((dup as any[]).length) throw new ConflictException(`A memo type with the code ${code} already exists`);

    const [t] = await tx.execute(
        `INSERT INTO memo_types (code, name, requires_amount, requires_project, requires_attachment, is_active)
         VALUES (?, ?, ?, ?, ?, 1)`,
        [code, name, input.requires_amount ? 1 : 0, input.requires_project ? 1 : 0, input.requires_attachment ? 1 : 0]
    );
    const typeId = Number((t as any).insertId);
    const [tpl] = await tx.execute(
        `INSERT INTO memo_chain_templates (type_id, name, is_default, is_active) VALUES (?, 'Standard', 1, 1)`, [typeId]);
    const templateId = Number((tpl as any).insertId);
    await writeChain(tx, templateId, steps);
    return { typeId, templateId };
}

export async function updateType(
    tx: Executor, id: number,
    patch: { name?: string; requires_amount?: boolean; requires_project?: boolean; requires_attachment?: boolean; is_active?: boolean }
): Promise<void> {
    const sets: string[] = [];
    const params: any[] = [];
    if (patch.name !== undefined) { sets.push('name = ?'); params.push(text(patch.name, 'name', 150)); }
    for (const col of ['requires_amount', 'requires_project', 'requires_attachment', 'is_active'] as const) {
        if (patch[col] !== undefined) { sets.push(`${col} = ?`); params.push(patch[col] ? 1 : 0); }
    }
    if (!sets.length) throw new BusinessException('Nothing to update');
    const [r] = await tx.execute(`UPDATE memo_types SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
    if (!(r as any).affectedRows) throw new NotFoundException('Memo type not found');
}

// ─── Modèles de circuit ─────────────────────────────────────────────────────

export async function createTemplate(
    tx: Executor, typeId: number, input: { name?: string; steps?: ChainStepInput[]; is_default?: boolean }
): Promise<{ templateId: number }> {
    const name = text(input.name, 'name', 150);
    const steps = normaliseChain(input.steps);
    const [tRows] = await tx.execute('SELECT id FROM memo_types WHERE id = ?', [typeId]);
    if (!(tRows as any[]).length) throw new NotFoundException('Memo type not found');
    const [dup] = await tx.execute('SELECT id FROM memo_chain_templates WHERE type_id = ? AND name = ?', [typeId, name]);
    if ((dup as any[]).length) throw new ConflictException(`This type already has a chain named “${name}”`);

    const [r] = await tx.execute(
        'INSERT INTO memo_chain_templates (type_id, name, is_default, is_active) VALUES (?, ?, 0, 1)', [typeId, name]);
    const templateId = Number((r as any).insertId);
    await writeChain(tx, templateId, steps);
    if (input.is_default) await tx.execute('UPDATE memo_chain_templates SET is_default = IF(id = ?, 1, 0) WHERE type_id = ?', [templateId, typeId]);
    return { templateId };
}

async function loadTemplate(tx: Executor, id: number): Promise<any> {
    const [rows] = await tx.execute('SELECT * FROM memo_chain_templates WHERE id = ? FOR UPDATE', [id]);
    const t = (rows as any[])[0];
    if (!t) throw new NotFoundException('Chain not found');
    return t;
}

/** Garde-fou : un type garde toujours au moins un modèle actif, et un seul est « par défaut ». */
export async function updateTemplate(
    tx: Executor, id: number, patch: { name?: string; is_default?: boolean; is_active?: boolean }
): Promise<void> {
    const t = await loadTemplate(tx, id);
    if (patch.name === undefined && patch.is_default === undefined && patch.is_active === undefined) {
        throw new BusinessException('Nothing to update');
    }
    if (patch.name !== undefined) {
        const name = text(patch.name, 'name', 150);
        const [dup] = await tx.execute('SELECT id FROM memo_chain_templates WHERE type_id = ? AND name = ? AND id <> ?', [t.type_id, name, id]);
        if ((dup as any[]).length) throw new ConflictException(`This type already has a chain named “${name}”`);
        await tx.execute('UPDATE memo_chain_templates SET name = ? WHERE id = ?', [name, id]);
    }
    if (patch.is_active === false && t.is_active) {
        const [others] = await tx.execute(
            'SELECT id FROM memo_chain_templates WHERE type_id = ? AND is_active = 1 AND id <> ? ORDER BY id LIMIT 1', [t.type_id, id]);
        const next = (others as any[])[0];
        if (!next) throw new ConflictException('A memo type needs at least one active chain');
        await tx.execute('UPDATE memo_chain_templates SET is_active = 0, is_default = 0 WHERE id = ?', [id]);
        if (t.is_default) await tx.execute('UPDATE memo_chain_templates SET is_default = 1 WHERE id = ?', [next.id]);
    } else if (patch.is_active === true && !t.is_active) {
        await tx.execute('UPDATE memo_chain_templates SET is_active = 1 WHERE id = ?', [id]);
    }
    if (patch.is_default === true) {
        const active = patch.is_active === undefined ? !!t.is_active : patch.is_active;
        if (!active) throw new ConflictException('An inactive chain cannot be the default one');
        await tx.execute('UPDATE memo_chain_templates SET is_default = IF(id = ?, 1, 0) WHERE type_id = ?', [id, t.type_id]);
    }
}

/** Remplace les pas d'un modèle. Les mémos déjà soumis gardent leur circuit figé. */
export async function replaceChain(tx: Executor, templateId: number, input: unknown): Promise<{ steps: number }> {
    const steps = normaliseChain(input);
    await loadTemplate(tx, templateId);
    await writeChain(tx, templateId, steps);
    return { steps: steps.length };
}
