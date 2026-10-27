// tests/unit/memoService.test.ts
// Machine à états et invariants du module mémos, testés directement sur le service
// avec un exécuteur SQL scénarisé (aucune base). Chaque test décrit la séquence de
// requêtes attendue : un contrôle sauté ou un événement oublié fait échouer le test.
import {
    assertTransition,
    createMemoDraft,
    submitMemo,
    decideStep,
    decideRelease,
    reinstructRelease,
    withdrawMemo,
    updateMemoDraft,
    canViewMemo,
    memoCapabilities,
    SIGNATURE_REQUIRED,
} from '../../src/services/memoService';
import { scriptedTx, rows, ok } from '../helpers/scriptedTx';

const AUTHOR = 'agent@mfwa.org';
const MANAGER = 'manager@mfwa.org';
const DIRECTOR = 'director@mfwa.org';
const FINANCE = 'finance@mfwa.org';

// Niveaux : 1 agent, 2 manager, 3 director, 4 finance
const LABEL: Record<number, string> = { 1: 'Agent', 2: 'Manager', 3: 'Director', 4: 'Finance' };

const memo = (o: Record<string, any> = {}) => ({
    id: 5, reference: null, type_id: 1, template_id: 1, author_email: AUTHOR,
    to_label: 'Executive Director', from_label: 'Director, Media for Democracy',
    subject: 'Request for funds', body: 'Please authorise…', memo_date: '2026-10-28',
    amount: 2336, currency: 'EUR', project_id: null, status: 'draft', revision_no: 1, current_step_no: null,
    ...o,
});

const step = (no: number, kind: string, pos: number, status: string, o: Record<string, any> = {}) => ({
    id: 100 + no, memo_id: 5, revision_no: 1, step_no: no, kind, position_id: pos, label: `${kind} label`,
    status, position_label: LABEL[pos], ...o,
});

// Circuit standard des demandes de fonds : manager → director → finance
const fullChain = (active: number) => [
    step(0, 'submit', 1, 'done'),
    step(1, 'recommend', 2, active === 1 ? 'active' : active > 1 ? 'done' : 'pending'),
    step(2, 'approve', 3, active === 2 ? 'active' : active > 2 ? 'done' : 'pending'),
    step(3, 'release', 4, active === 3 ? 'active' : 'pending'),
];

const chainRows = [
    { step_no: 1, kind: 'recommend', position_id: 2, label: 'Recommended for approval', position_label: 'Manager' },
    { step_no: 2, kind: 'approve', position_id: 3, label: 'Approved', position_label: 'Director' },
    { step_no: 3, kind: 'release', position_id: 4, label: 'Funds released', position_label: 'Finance' },
];

const SIG = { id: 9, sha256: 'a'.repeat(64) };
const holder = rows([{ 1: 1 }]);
const notHolder = rows([]);

// ═══════════════════════════════════════════════════════════════════════════
describe('state machine', () => {
    it('allows the nominal transitions', () => {
        expect(() => assertTransition('draft', 'in_review')).not.toThrow();
        expect(() => assertTransition('in_review', 'approved')).not.toThrow();
        expect(() => assertTransition('approved', 'released')).not.toThrow();
        expect(() => assertTransition('approved', 'release_refused')).not.toThrow();
        expect(() => assertTransition('release_refused', 'approved')).not.toThrow();
        expect(() => assertTransition('returned', 'in_review')).not.toThrow();
    });

    it('refuses everything else with a 409', () => {
        for (const [from, to] of [
            ['draft', 'approved'], ['in_review', 'released'], ['approved', 'withdrawn'],
            ['approved', 'returned'], ['rejected', 'in_review'], ['released', 'withdrawn'], ['withdrawn', 'draft'],
        ] as const) {
            expect(() => assertTransition(from, to)).toThrow(expect.objectContaining({ statusCode: 409 }));
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('createMemoDraft', () => {
    it('creates a draft on the default chain and writes the event', async () => {
        const s = scriptedTx([
            ['FROM memo_types', rows([{ id: 1, is_active: 1 }])],
            ['FROM memo_chain_templates', rows([{ id: 7 }])],
            ['INSERT INTO memos', ok({ insertId: 42 })],
            ['INSERT INTO memo_events', ok()],
        ]);
        const r = await createMemoDraft(s.tx, { type_id: 1, author_uid: 'u1', author_email: AUTHOR, subject: ' Fire certificate ', currency: 'GHS', amount: 2855.39 });
        expect(r).toEqual({ memoId: 42, templateId: 7 });
        s.done();
        expect(s.params(3)).toContain('Fire certificate');
        expect(s.params(4)).toEqual(expect.arrayContaining([42, 1, 'created']));
    });

    it('requires a subject, a valid currency and a non-negative amount (400)', async () => {
        const s = scriptedTx([]);
        await expect(createMemoDraft(s.tx, { type_id: 1, author_uid: null, author_email: AUTHOR, subject: '  ' }))
            .rejects.toMatchObject({ statusCode: 400 });
        await expect(createMemoDraft(s.tx, { type_id: 1, author_uid: null, author_email: AUTHOR, subject: 'x', currency: 'euro' }))
            .rejects.toMatchObject({ statusCode: 400 });
        await expect(createMemoDraft(s.tx, { type_id: 1, author_uid: null, author_email: AUTHOR, subject: 'x', amount: -5 }))
            .rejects.toMatchObject({ statusCode: 400 });
    });

    it('refuses an inactive type (409) and an unknown one (404)', async () => {
        await expect(createMemoDraft(scriptedTx([['FROM memo_types', rows([{ id: 1, is_active: 0 }])]]).tx,
            { type_id: 1, author_uid: null, author_email: AUTHOR, subject: 'x' })).rejects.toMatchObject({ statusCode: 409 });
        await expect(createMemoDraft(scriptedTx([['FROM memo_types', rows([])]]).tx,
            { type_id: 9, author_uid: null, author_email: AUTHOR, subject: 'x' })).rejects.toMatchObject({ statusCode: 404 });
    });

    it('refuses a type without any active chain (409)', async () => {
        const s = scriptedTx([['FROM memo_types', rows([{ id: 1, is_active: 1 }])], ['FROM memo_chain_templates', rows([])]]);
        await expect(createMemoDraft(s.tx, { type_id: 1, author_uid: null, author_email: AUTHOR, subject: 'x' }))
            .rejects.toMatchObject({ statusCode: 409 });
    });
});

describe('updateMemoDraft', () => {
    it('lets the author edit a draft', async () => {
        const s = scriptedTx([['FOR UPDATE', rows([memo()])], ['UPDATE memos SET', ok()]]);
        await updateMemoDraft(s.tx, 5, AUTHOR, { subject: 'New subject', amount: 10 });
        s.done();
    });

    it('refuses anyone but the author (403) and any status but draft/returned (409) — invariant 4', async () => {
        await expect(updateMemoDraft(scriptedTx([['FOR UPDATE', rows([memo()])]]).tx, 5, MANAGER, { subject: 'x' }))
            .rejects.toMatchObject({ statusCode: 403 });
        await expect(updateMemoDraft(scriptedTx([['FOR UPDATE', rows([memo({ status: 'in_review' })])]]).tx, 5, AUTHOR, { subject: 'x' }))
            .rejects.toMatchObject({ statusCode: 409 });
    });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('submitMemo', () => {
    const happyScript = (m = memo(), withSequence = true) => [
        ['FOR UPDATE', rows([m])],
        ['FROM memo_types', rows([{ id: 1, requires_amount: 1, requires_project: 0, requires_attachment: 1 }])],
        ['FROM memo_attachments', rows([{ n: 1 }])],
        ['FROM memo_chain_steps', rows(chainRows)],
        ['LEFT JOIN memo_position_holders', rows([{ id: 2, label: 'Manager', n: 1 }, { id: 3, label: 'Director', n: 1 }, { id: 4, label: 'Finance', n: 1 }])],
        ['FROM user_signatures', rows([SIG])],
        ...(withSequence ? [['INSERT INTO memo_sequences', ok()], ['SELECT last_number', rows([{ last_number: 12 }])]] : []),
        ["FROM memo_positions WHERE code = 'agent'", rows([{ id: 1 }])],
        ['INSERT INTO memo_steps', ok()],
        ['INSERT INTO memo_steps', ok()],
        ["UPDATE memos SET status = 'in_review'", ok()],
        ['INSERT INTO memo_events', ok()],
    ] as any;

    it('signs step 0, freezes the chain with the first step active, assigns the reference, writes the event', async () => {
        const s = scriptedTx(happyScript());
        const r = await submitMemo(s.tx, 5, AUTHOR);
        s.done();
        expect(r.reference).toBe(`MFWA/MEMO/${new Date().getFullYear()}/0012`);
        expect(r.firstStepLabel).toBe('Recommended for approval');

        // pas 0 signé
        const step0 = s.calls.find(c => /INSERT INTO memo_steps/.test(c[0]) && /'submit'/.test(c[0]))!;
        expect(step0[1]).toEqual([5, 1, 1, AUTHOR, SIG.id, SIG.sha256]);

        // pas 1..3 : 3 lignes de 7 valeurs, seul le premier actif
        const frozen = s.calls.filter(c => /INSERT INTO memo_steps/.test(c[0]))[1][1] as any[];
        expect(frozen).toHaveLength(21);
        expect([frozen[6], frozen[13], frozen[20]]).toEqual(['active', 'pending', 'pending']);

        const ev = s.calls[s.calls.length - 1][1] as any[];
        expect(ev[3]).toBe('submitted');
    });

    it('keeps the existing reference and logs « resubmitted » after a return', async () => {
        const s = scriptedTx(happyScript(memo({ status: 'returned', revision_no: 2, reference: 'MFWA/MEMO/2026/0003' }), false));
        const r = await submitMemo(s.tx, 5, AUTHOR);
        s.done();
        expect(r.reference).toBe('MFWA/MEMO/2026/0003');
        expect((s.calls[s.calls.length - 1][1] as any[])[3]).toBe('resubmitted');
        // les pas de la nouvelle révision portent revision_no = 2
        expect(s.calls.find(c => /'submit'/.test(c[0]))![1][1]).toBe(2);
    });

    it('only the author can submit (403) and only a draft or returned memo (409)', async () => {
        await expect(submitMemo(scriptedTx([['FOR UPDATE', rows([memo()])]]).tx, 5, MANAGER)).rejects.toMatchObject({ statusCode: 403 });
        await expect(submitMemo(scriptedTx([['FOR UPDATE', rows([memo({ status: 'in_review' })])]]).tx, 5, AUTHOR))
            .rejects.toMatchObject({ statusCode: 409 });
    });

    it('lists the missing fields (400)', async () => {
        const s = scriptedTx([
            ['FOR UPDATE', rows([memo({ amount: null, currency: null, body: '' })])],
            ['FROM memo_types', rows([{ id: 1, requires_amount: 1 }])],
        ]);
        await expect(submitMemo(s.tx, 5, AUTHOR)).rejects.toThrow(/missing: body, amount, currency/);
    });

    it('requires an attachment when the type says so (400)', async () => {
        const s = scriptedTx([
            ['FOR UPDATE', rows([memo()])],
            ['FROM memo_types', rows([{ id: 1, requires_amount: 1, requires_attachment: 1 }])],
            ['FROM memo_attachments', rows([{ n: 0 }])],
        ]);
        await expect(submitMemo(s.tx, 5, AUTHOR)).rejects.toThrow(/attachment/);
    });

    it('refuses to submit when a level has no active holder other than the author (409) — invariant 3', async () => {
        const s = scriptedTx([
            ['FOR UPDATE', rows([memo()])],
            ['FROM memo_types', rows([{ id: 1, requires_amount: 0 }])],
            ['FROM memo_chain_steps', rows(chainRows)],
            ['LEFT JOIN memo_position_holders', rows([{ id: 2, label: 'Manager', n: 1 }, { id: 3, label: 'Director', n: 0 }, { id: 4, label: 'Finance', n: 0 }])],
        ]);
        const err: any = await submitMemo(s.tx, 5, AUTHOR).catch(e => e);
        expect(err.statusCode).toBe(409);
        expect(err.message).toContain('Director, Finance');
        // le SQL exclut l'auteur lui-même des titulaires comptés
        expect(s.params(4)[0]).toBe(AUTHOR);
    });

    it('refuses without a registered signature (400, code SIGNATURE_REQUIRED) — invariant 8', async () => {
        const s = scriptedTx([
            ['FOR UPDATE', rows([memo()])],
            ['FROM memo_types', rows([{ id: 1 }])],
            ['FROM memo_chain_steps', rows(chainRows)],
            ['LEFT JOIN memo_position_holders', rows([{ id: 2, label: 'Manager', n: 1 }, { id: 3, label: 'Director', n: 1 }, { id: 4, label: 'Finance', n: 1 }])],
            ['FROM user_signatures', rows([])],
        ]);
        await expect(submitMemo(s.tx, 5, AUTHOR)).rejects.toMatchObject({ statusCode: 400, code: SIGNATURE_REQUIRED });
    });

    it('refuses a chain without approval step, or with a release step before another step (409)', async () => {
        const noApprove = scriptedTx([
            ['FOR UPDATE', rows([memo()])], ['FROM memo_types', rows([{ id: 1 }])],
            ['FROM memo_chain_steps', rows([chainRows[0], chainRows[2]])],
        ]);
        await expect(submitMemo(noApprove.tx, 5, AUTHOR)).rejects.toThrow(/no approval step/);

        const badOrder = scriptedTx([
            ['FOR UPDATE', rows([memo()])], ['FROM memo_types', rows([{ id: 1 }])],
            ['FROM memo_chain_steps', rows([chainRows[1], { ...chainRows[2], step_no: 2 }, { ...chainRows[0], step_no: 3 }])],
        ]);
        await expect(submitMemo(badOrder.tx, 5, AUTHOR)).rejects.toThrow(/release steps must come last/);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('decideStep', () => {
    const inReview = (stepNo: number, o: Record<string, any> = {}) =>
        memo({ status: 'in_review', current_step_no: stepNo, reference: 'MFWA/MEMO/2026/0012', ...o });

    const approveScript = (stepNo: number, steps: any[], withNext: boolean) => [
        ['FOR UPDATE', rows([inReview(stepNo)])],
        ['FROM memo_steps s', rows(steps)],
        ['FROM memo_position_holders WHERE position_id', holder],
        ['FROM user_signatures', rows([SIG])],
        ["UPDATE memo_steps SET status = 'done'", ok()],
        ...(withNext ? [["UPDATE memo_steps SET status = 'active'", ok()]] : []),
        ['UPDATE memos SET status = ?', ok()],
        ['INSERT INTO memo_events', ok()],
    ] as any;

    it('recommendation signs the step, activates the next one and keeps the memo in review', async () => {
        const s = scriptedTx(approveScript(1, fullChain(1), true));
        const r = await decideStep(s.tx, 5, MANAGER, 'approve', 'Looks fine');
        s.done();
        expect(r.newStatus).toBe('in_review');
        expect(r.nextStep.step_no).toBe(2);
        expect(s.params(5)).toEqual([MANAGER, 'Looks fine', SIG.id, SIG.sha256, 101]);
        expect(s.params(7)).toEqual(['in_review', 2, 5]);
        expect((s.calls[s.calls.length - 1][1] as any[])[3]).toBe('recommended');
    });

    it('approval followed by a release step makes the memo « approved » and hands it to finance', async () => {
        const s = scriptedTx(approveScript(2, fullChain(2), true));
        const r = await decideStep(s.tx, 5, DIRECTOR, 'approve');
        s.done();
        expect(r.newStatus).toBe('approved');
        expect(s.params(7)).toEqual(['approved', 3, 5]);
        expect((s.calls[s.calls.length - 1][1] as any[])[3]).toBe('approved');
    });

    it('approval of the last step of a chain without release closes the circuit as « approved »', async () => {
        const noRelease = [step(0, 'submit', 1, 'done'), step(1, 'recommend', 2, 'done'), step(2, 'approve', 3, 'active')];
        const s = scriptedTx(approveScript(2, noRelease, false));
        const r = await decideStep(s.tx, 5, DIRECTOR, 'approve');
        s.done();
        expect(r.newStatus).toBe('approved');
        expect(s.params(6)).toEqual(['approved', null, 5]);
    });

    it('the author can never decide on their own memo (403) — invariant 3', async () => {
        const s = scriptedTx([['FOR UPDATE', rows([inReview(1)])], ['FROM memo_steps s', rows(fullChain(1))]]);
        await expect(decideStep(s.tx, 5, AUTHOR, 'approve')).rejects.toMatchObject({ statusCode: 403 });
    });

    it('someone who does not hold the level of the active step is refused (403)', async () => {
        const s = scriptedTx([
            ['FOR UPDATE', rows([inReview(1)])], ['FROM memo_steps s', rows(fullChain(1))],
            ['FROM memo_position_holders WHERE position_id', notHolder],
        ]);
        const err: any = await decideStep(s.tx, 5, DIRECTOR, 'approve').catch(e => e);
        expect(err.statusCode).toBe(403);
        expect(err.message).toContain('Manager');
        expect(s.params(3)).toEqual([2, DIRECTOR]);
    });

    it('refuses to approve without a signature (400, SIGNATURE_REQUIRED) and writes nothing — invariant 8', async () => {
        const s = scriptedTx([
            ['FOR UPDATE', rows([inReview(1)])], ['FROM memo_steps s', rows(fullChain(1))],
            ['FROM memo_position_holders WHERE position_id', holder], ['FROM user_signatures', rows([])],
        ]);
        await expect(decideStep(s.tx, 5, MANAGER, 'approve')).rejects.toMatchObject({ code: SIGNATURE_REQUIRED });
        expect(s.calls.some(c => /^\s*UPDATE/.test(c[0]))).toBe(false);
    });

    it('returning bumps the revision, carries the attachments over and logs the event', async () => {
        const s = scriptedTx([
            ['FOR UPDATE', rows([inReview(2)])], ['FROM memo_steps s', rows(fullChain(2))],
            ['FROM memo_position_holders WHERE position_id', holder],
            ["UPDATE memo_steps SET status = 'returned'", ok()],
            ["UPDATE memos SET status = 'returned'", ok()],
            ['INSERT INTO memo_attachments', ok()],
            ['INSERT INTO memo_events', ok()],
        ]);
        const r = await decideStep(s.tx, 5, DIRECTOR, 'return', 'Budget line missing');
        s.done();
        expect(r.newStatus).toBe('returned');
        expect(s.params(5)).toEqual([2, 5]);          // nouvelle révision, mémo 5
        expect(s.params(6)).toEqual([2, 5, 1]);       // pièces copiées de la révision 1 vers la 2
        expect((s.calls[6][1] as any[])[3]).toBe('returned');
    });

    it('return and reject require a comment (400) — invariant 7', async () => {
        for (const d of ['return', 'reject'] as const) {
            const s = scriptedTx([
                ['FOR UPDATE', rows([inReview(1)])], ['FROM memo_steps s', rows(fullChain(1))],
                ['FROM memo_position_holders WHERE position_id', holder],
            ]);
            await expect(decideStep(s.tx, 5, MANAGER, d, '  ')).rejects.toMatchObject({ statusCode: 400 });
        }
    });

    it('rejecting closes the memo and skips the remaining steps', async () => {
        const s = scriptedTx([
            ['FOR UPDATE', rows([inReview(1)])], ['FROM memo_steps s', rows(fullChain(1))],
            ['FROM memo_position_holders WHERE position_id', holder],
            ["UPDATE memo_steps SET status = 'rejected'", ok()],
            ["SET status = 'skipped'", ok()],
            ["UPDATE memos SET status = 'rejected'", ok()],
            ['INSERT INTO memo_events', ok()],
        ]);
        const r = await decideStep(s.tx, 5, MANAGER, 'reject', 'Out of budget');
        s.done();
        expect(r.newStatus).toBe('rejected');
    });

    it('refuses when the memo is not in review (409) or the decision is unknown (400)', async () => {
        await expect(decideStep(scriptedTx([['FOR UPDATE', rows([memo({ status: 'approved', current_step_no: 3 })])]]).tx, 5, FINANCE, 'approve'))
            .rejects.toMatchObject({ statusCode: 409 });
        await expect(decideStep(scriptedTx([['FOR UPDATE', rows([memo({ status: 'released' })])]]).tx, 5, MANAGER, 'approve'))
            .rejects.toMatchObject({ statusCode: 409 });
        await expect(decideStep(scriptedTx([]).tx, 5, MANAGER, 'maybe' as any)).rejects.toMatchObject({ statusCode: 400 });
    });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('decideRelease', () => {
    const approvedMemo = () => memo({ status: 'approved', current_step_no: 3, reference: 'MFWA/MEMO/2026/0012' });
    const prefix = (holderResult = holder) => [
        ['FOR UPDATE', rows([approvedMemo()])], ['FROM memo_steps s', rows(fullChain(3))],
        ['FROM memo_position_holders WHERE position_id', holderResult],
    ] as any;

    it('releases funds with a signature and a payment reference', async () => {
        const s = scriptedTx([
            ...prefix(), ['FROM user_signatures', rows([SIG])],
            ["UPDATE memo_steps SET status = 'done'", ok()],
            ["UPDATE memos SET status = 'released'", ok()],
            ['INSERT INTO memo_events', ok()],
        ]);
        const r = await decideRelease(s.tx, 5, FINANCE, { decision: 'release', release_reference: 'PAY-2026-118' });
        s.done();
        expect(r.newStatus).toBe('released');
        expect(s.params(6)).toEqual(['PAY-2026-118', 5]);
    });

    it('needs a payment reference (400), a finance holder (403) and an approved memo (409)', async () => {
        await expect(decideRelease(scriptedTx(prefix()).tx, 5, FINANCE, { decision: 'release', release_reference: ' ' }))
            .rejects.toMatchObject({ statusCode: 400 });
        await expect(decideRelease(scriptedTx(prefix(notHolder)).tx, 5, MANAGER, { decision: 'release', release_reference: 'X' }))
            .rejects.toMatchObject({ statusCode: 403 });
        await expect(decideRelease(scriptedTx([['FOR UPDATE', rows([memo({ status: 'in_review' })])]]).tx, 5, FINANCE, { decision: 'release', release_reference: 'X' }))
            .rejects.toMatchObject({ statusCode: 409 });
    });

    it('a refusal needs a reason and moves the memo to « release_refused » without touching the approval — invariant 5', async () => {
        await expect(decideRelease(scriptedTx(prefix()).tx, 5, FINANCE, { decision: 'refuse' })).rejects.toMatchObject({ statusCode: 400 });

        const s = scriptedTx([
            ...prefix(),
            ["UPDATE memo_steps SET status = 'refused'", ok()],
            ["UPDATE memos SET status = 'release_refused'", ok()],
            ['INSERT INTO memo_events', ok()],
        ]);
        const r = await decideRelease(s.tx, 5, FINANCE, { decision: 'refuse', comment: 'Insufficient funds on this line' });
        s.done();
        expect(r.newStatus).toBe('release_refused');
        expect(s.calls.some(c => /approved_at/.test(c[0]))).toBe(false);
    });

    it('refuses to release without a signature (400, SIGNATURE_REQUIRED)', async () => {
        const s = scriptedTx([...prefix(), ['FROM user_signatures', rows([])]]);
        await expect(decideRelease(s.tx, 5, FINANCE, { decision: 'release', release_reference: 'X' }))
            .rejects.toMatchObject({ code: SIGNATURE_REQUIRED });
    });
});

describe('reinstructRelease', () => {
    const refused = () => memo({ status: 'release_refused', current_step_no: null });
    const stepsRefused = () => [step(0, 'submit', 1, 'done'), step(1, 'recommend', 2, 'done'), step(2, 'approve', 3, 'done'), step(3, 'release', 4, 'refused')];

    it('lets the approving level re-activate the release step', async () => {
        const s = scriptedTx([
            ['FOR UPDATE', rows([refused()])], ['FROM memo_steps s', rows(stepsRefused())],
            ['FROM memo_position_holders WHERE position_id', holder],
            ["UPDATE memo_steps SET status = 'active'", ok()],
            ["UPDATE memos SET status = 'approved'", ok()],
            ['INSERT INTO memo_events', ok()],
        ]);
        const r = await reinstructRelease(s.tx, 5, DIRECTOR, 'Funds confirmed by the ED');
        s.done();
        expect(r.status).toBe('approved');
        expect(s.params(3)).toEqual([3, DIRECTOR]);    // niveau « director », pas « finance »
        expect((s.calls[5][1] as any[])[3]).toBe('release_reopened');
    });

    it('needs a comment (400), the approving level (403) and a refused release (409)', async () => {
        await expect(reinstructRelease(scriptedTx([['FOR UPDATE', rows([refused()])]]).tx, 5, DIRECTOR, ''))
            .rejects.toMatchObject({ statusCode: 400 });
        await expect(reinstructRelease(scriptedTx([
            ['FOR UPDATE', rows([refused()])], ['FROM memo_steps s', rows(stepsRefused())],
            ['FROM memo_position_holders WHERE position_id', notHolder],
        ]).tx, 5, FINANCE, 'please')).rejects.toMatchObject({ statusCode: 403 });
        await expect(reinstructRelease(scriptedTx([['FOR UPDATE', rows([memo({ status: 'approved' })])]]).tx, 5, DIRECTOR, 'x'))
            .rejects.toMatchObject({ statusCode: 409 });
    });
});

describe('withdrawMemo', () => {
    it('lets the author withdraw an in-review memo and skips the open steps', async () => {
        const s = scriptedTx([
            ['FOR UPDATE', rows([memo({ status: 'in_review', current_step_no: 1 })])],
            ["SET status = 'skipped'", ok()],
            ["UPDATE memos SET status = 'withdrawn'", ok()],
            ['INSERT INTO memo_events', ok()],
        ]);
        await withdrawMemo(s.tx, 5, AUTHOR, 'No longer needed');
        s.done();
    });

    it('refuses a third party (403), and an approved memo (409): the payment order is given', async () => {
        await expect(withdrawMemo(scriptedTx([['FOR UPDATE', rows([memo({ status: 'in_review' })])]]).tx, 5, MANAGER))
            .rejects.toMatchObject({ statusCode: 403 });
        await expect(withdrawMemo(scriptedTx([['FOR UPDATE', rows([memo({ status: 'approved' })])]]).tx, 5, AUTHOR))
            .rejects.toMatchObject({ statusCode: 409 });
    });

    it('the approving level can withdraw after a refused release, with a reason', async () => {
        const prefix = [
            ['FOR UPDATE', rows([memo({ status: 'release_refused' })])],
            ['FROM memo_steps s', rows([step(2, 'approve', 3, 'done'), step(3, 'release', 4, 'refused')])],
            ['FROM memo_position_holders WHERE position_id', holder],
        ] as any;
        await expect(withdrawMemo(scriptedTx(prefix).tx, 5, DIRECTOR, '')).rejects.toMatchObject({ statusCode: 400 });
        const s = scriptedTx([...prefix, ["SET status = 'skipped'", ok()], ["UPDATE memos SET status = 'withdrawn'", ok()], ['INSERT INTO memo_events', ok()]]);
        await withdrawMemo(s.tx, 5, DIRECTOR, 'Funding no longer available');
        s.done();
    });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('canViewMemo', () => {
    const stranger = { email: 'someone@mfwa.org', role: 'user' };

    it('the author sees their memo, drafts included, without any query', async () => {
        const s = scriptedTx([]);
        expect(await canViewMemo(s.tx, memo(), { email: AUTHOR, role: 'user' })).toBe(true);
    });

    it('an admin sees everything except other people’s drafts', async () => {
        const s = scriptedTx([]);
        expect(await canViewMemo(s.tx, memo({ status: 'in_review' }), { email: 'admin@mfwa.org', role: 'admin' })).toBe(true);
        expect(await canViewMemo(s.tx, memo({ status: 'draft' }), { email: 'admin@mfwa.org', role: 'admin' })).toBe(false);
    });

    it('a holder of a level in the chain, or someone who acted, sees it; a stranger does not', async () => {
        expect(await canViewMemo(scriptedTx([['FROM memo_steps s', rows([{ 1: 1 }])]]).tx, memo({ status: 'in_review' }), stranger)).toBe(true);
        expect(await canViewMemo(scriptedTx([['FROM memo_steps s', rows([])]]).tx, memo({ status: 'in_review' }), stranger)).toBe(false);
        expect(await canViewMemo(scriptedTx([]).tx, memo({ status: 'draft' }), stranger)).toBe(false);
    });
});

describe('memoCapabilities', () => {
    const u = (email: string) => ({ email });

    it('author: edit, submit and withdraw a draft; nothing to decide', () => {
        expect(memoCapabilities(memo(), [], u(AUTHOR), [])).toMatchObject({ edit: true, submit: true, withdraw: true, decide: false, release: false });
    });

    it('author of an in-review memo can only withdraw it, never decide', () => {
        const m = memo({ status: 'in_review', current_step_no: 1 });
        expect(memoCapabilities(m, fullChain(1), u(AUTHOR), [2])).toMatchObject({ edit: false, withdraw: true, decide: false, waiting_for: 'Manager' });
    });

    it('only the holder of the active level can decide', () => {
        const m = memo({ status: 'in_review', current_step_no: 1 });
        expect(memoCapabilities(m, fullChain(1), u(MANAGER), [2]).decide).toBe(true);
        expect(memoCapabilities(m, fullChain(1), u(DIRECTOR), [3]).decide).toBe(false);
    });

    it('finance can release an approved memo, and nobody can withdraw it', () => {
        const m = memo({ status: 'approved', current_step_no: 3 });
        expect(memoCapabilities(m, fullChain(3), u(FINANCE), [4])).toMatchObject({ release: true, decide: false });
        expect(memoCapabilities(m, fullChain(3), u(AUTHOR), []).withdraw).toBe(false);
    });

    it('after a refused release, the approving level can re-instruct or withdraw', () => {
        const m = memo({ status: 'release_refused', current_step_no: null });
        const steps = [step(2, 'approve', 3, 'done'), step(3, 'release', 4, 'refused')];
        expect(memoCapabilities(m, steps, u(DIRECTOR), [3])).toMatchObject({ reinstruct: true, withdraw: true, release: false });
        expect(memoCapabilities(m, steps, u(FINANCE), [4])).toMatchObject({ reinstruct: false });
    });
});
