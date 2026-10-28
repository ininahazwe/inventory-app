// server/src/services/memoService.ts
// ─────────────────────────────────────────────────────────────────────────────
// Cœur du module « mémos et chaîne de validation ». Toutes les écritures sur
// `memos`, `memo_steps` et `memo_events` passent par ici ; les routes valident
// l'entrée HTTP, ouvrent une transaction et appellent ces fonctions.
//
// Même patron que loanService.ts :
//   1. la machine à états vit à un seul endroit (ALLOWED_TRANSITIONS) ;
//   2. chaque transition écrit son événement dans `memo_events` ;
//   3. les contrôles se font sous `SELECT … FOR UPDATE` sur la ligne du mémo,
//      dans la même transaction que l'écriture.
//
// Invariants (cf. migration 2026-10-28-memos.sql) :
//   1. Un seul pas actif à la fois.
//   2. Le circuit est copié dans `memo_steps` à la soumission.
//   3. Le décideur est un titulaire/suppléant actif du niveau du pas actif, et
//      jamais l'auteur ; une soumission est refusée si un niveau du circuit n'a
//      aucun titulaire actif autre que l'auteur.
//   4. Contenu immuable après soumission : correction = « returned » → nouvelle
//      révision → circuit redémarré.
//   5. `released` exige `approved` ; un refus de la finance donne
//      `release_refused` sans effacer l'approbation.
//   6. Toute transition écrit son événement.
//   7. Rejet, retour et refus de décaissement exigent un commentaire.
//   8. Soumettre, recommander, approuver et décaisser exigent une signature
//      active ; son empreinte est figée sur le pas.
// ─────────────────────────────────────────────────────────────────────────────
import { BusinessException, ConflictException, ForbiddenException, NotFoundException } from '../exceptions';
import type { Executor } from './loanService';

export type MemoStatus =
    | 'draft'
    | 'in_review'
    | 'approved'
    | 'released'
    | 'release_refused'
    | 'returned'
    | 'rejected'
    | 'withdrawn';

export type StepKind = 'submit' | 'recommend' | 'approve' | 'release';
export type StepStatus = 'pending' | 'active' | 'done' | 'returned' | 'rejected' | 'refused' | 'skipped';

/** Statuts dans lesquels l'auteur peut encore modifier le contenu. */
export const EDITABLE_STATUSES: MemoStatus[] = ['draft', 'returned'];

/** Statuts terminaux : plus aucune transition possible. */
export const CLOSED_STATUSES: MemoStatus[] = ['released', 'rejected', 'withdrawn'];

/**
 * Machine à états du mémo. Tout ce qui n'est pas listé est refusé en 409 (conflit
 * d'état), comme pour les prêts. Un mémo `approved` ne peut pas être retiré :
 * l'ordre de décaisser est donné.
 */
const ALLOWED_TRANSITIONS: Record<MemoStatus, MemoStatus[]> = {
    draft:           ['in_review', 'withdrawn'],
    in_review:       ['in_review', 'approved', 'returned', 'rejected', 'withdrawn'],
    approved:        ['released', 'release_refused'],
    release_refused: ['approved', 'withdrawn'],
    returned:        ['in_review', 'withdrawn'],
    released:        [],
    rejected:        [],
    withdrawn:       [],
};

export function assertTransition(from: MemoStatus, to: MemoStatus): void {
    if (!ALLOWED_TRANSITIONS[from] || !ALLOWED_TRANSITIONS[from].includes(to)) {
        throw new ConflictException(
            `Cannot move a memo from '${from}' to '${to}'` +
            (CLOSED_STATUSES.includes(from) ? ' — this memo is already closed.' : '')
        );
    }
}

export const SIGNATURE_REQUIRED = 'SIGNATURE_REQUIRED';

const sameEmail = (a?: string | null, b?: string | null) =>
    !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

// ═══════════════════════════════════════════════════════════════════════════
// Briques communes
// ═══════════════════════════════════════════════════════════════════════════

/** Écrit une ligne dans le journal. Appelée par chaque transition — jamais seule. */
export async function recordMemoEvent(
    tx: Executor,
    params: {
        memo_id: number;
        revision_no: number;
        step_no?: number | null;
        event_type: string;
        from_status?: MemoStatus | null;
        to_status?: MemoStatus | null;
        actor_email?: string | null;
        payload?: Record<string, any> | null;
        notes?: string | null;
    }
): Promise<void> {
    await tx.execute(
        `INSERT INTO memo_events (memo_id, revision_no, step_no, event_type, from_status, to_status, actor_email, payload, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            params.memo_id,
            params.revision_no,
            params.step_no ?? null,
            params.event_type,
            params.from_status || null,
            params.to_status || null,
            params.actor_email || null,
            params.payload ? JSON.stringify(params.payload) : null,
            params.notes || null,
        ]
    );
}

/** Charge un mémo et pose un verrou dessus pour la durée de la transaction. */
export async function loadMemoForUpdate(tx: Executor, memoId: number): Promise<any> {
    const [rows] = await tx.execute('SELECT * FROM memos WHERE id = ? FOR UPDATE', [memoId]);
    const memo = (rows as any[])[0];
    if (!memo) throw new NotFoundException('Memo not found');
    return memo;
}

/** Pas d'une révision, dans l'ordre d'exécution (le pas 0 est la soumission). */
export async function loadSteps(tx: Executor, memoId: number, revisionNo: number): Promise<any[]> {
    const [rows] = await tx.execute(
        `SELECT s.*, p.code AS position_code, p.label AS position_label
         FROM memo_steps s JOIN memo_positions p ON p.id = s.position_id
         WHERE s.memo_id = ? AND s.revision_no = ? ORDER BY s.step_no ASC`,
        [memoId, revisionNo]
    );
    return rows as any[];
}

/** Invariant 8 : la signature active de l'utilisateur, ou une erreur explicite. */
export async function getActiveSignature(tx: Executor, email: string): Promise<{ id: number; sha256: string }> {
    const [rows] = await tx.execute(
        `SELECT id, sha256 FROM user_signatures WHERE user_email = ? AND is_active = 1 ORDER BY id DESC LIMIT 1`,
        [email]
    );
    const sig = (rows as any[])[0];
    if (!sig) {
        throw new BusinessException(
            'A signature is required for this action — draw or upload yours first.',
            SIGNATURE_REQUIRED
        );
    }
    return sig;
}

/** Titulaire ou suppléant actif du niveau `positionId` ? */
export async function isActiveHolder(tx: Executor, positionId: number, email: string): Promise<boolean> {
    const [rows] = await tx.execute(
        `SELECT 1 FROM memo_position_holders WHERE position_id = ? AND user_email = ? AND is_active = 1 LIMIT 1`,
        [positionId, email]
    );
    return (rows as any[]).length > 0;
}

function assertAuthor(memo: any, actorEmail: string): void {
    if (!sameEmail(memo.author_email, actorEmail)) {
        throw new ForbiddenException('Only the author of this memo can do this');
    }
}

function assertNotAuthor(memo: any, actorEmail: string): void {
    if (sameEmail(memo.author_email, actorEmail)) {
        throw new ForbiddenException('You cannot decide on your own memo');
    }
}

function requireComment(comment: string | null | undefined, what: string): string {
    const c = (comment || '').trim();
    if (!c) throw new BusinessException(`A comment is required to ${what}`);
    return c;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Brouillon
// ═══════════════════════════════════════════════════════════════════════════

export type MemoFields = {
    to_label?: string;
    from_label?: string;
    subject?: string;
    body?: string;
    memo_date?: string;
    amount?: number | null;
    currency?: string | null;
    project_id?: number | null;
    activity_ref?: string | null;
    manager_email?: string | null;     // manager choisi pour la recommandation (NULL = tout manager du niveau)
};

const CURRENCY_RE = /^[A-Z]{3}$/;

function assertFieldFormats(f: MemoFields): void {
    if (f.currency != null && f.currency !== '' && !CURRENCY_RE.test(f.currency)) {
        throw new BusinessException("currency must be a 3-letter code such as 'GHS' or 'EUR'");
    }
    if (f.amount != null && (typeof f.amount !== 'number' || !isFinite(f.amount) || f.amount < 0)) {
        throw new BusinessException('amount must be a positive number');
    }
}

export async function createMemoDraft(
    tx: Executor,
    input: MemoFields & {
        type_id: number;
        template_id?: number | null;
        author_uid: string | null;
        author_email: string;
    }
): Promise<{ memoId: number; templateId: number }> {
    if (!(input.subject || '').trim()) throw new BusinessException('subject is required');
    assertFieldFormats(input);

    const [typeRows] = await tx.execute('SELECT id, is_active FROM memo_types WHERE id = ?', [input.type_id]);
    const type = (typeRows as any[])[0];
    if (!type) throw new NotFoundException('Memo type not found');
    if (!type.is_active) throw new ConflictException('This memo type is no longer available');

    // Le modèle demandé, sinon le modèle par défaut du type.
    const [tplRows] = await tx.execute(
        `SELECT id FROM memo_chain_templates
         WHERE type_id = ? AND is_active = 1 AND (? IS NULL OR id = ?)
         ORDER BY is_default DESC, id ASC LIMIT 1`,
        [input.type_id, input.template_id ?? null, input.template_id ?? null]
    );
    const template = (tplRows as any[])[0];
    if (!template) throw new ConflictException('No active approval chain is defined for this memo type');

    const today = new Date().toISOString().slice(0, 10);
    const [result] = await tx.execute(
        `INSERT INTO memos (type_id, template_id, author_uid, author_email, to_label, from_label, subject, body,
                            memo_date, amount, currency, project_id, activity_ref, manager_email, status, revision_no)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 1)`,
        [
            input.type_id,
            template.id,
            input.author_uid || null,
            input.author_email,
            (input.to_label || '').trim(),
            (input.from_label || '').trim(),
            input.subject!.trim(),
            input.body || '',
            input.memo_date || today,
            input.amount ?? null,
            input.currency || null,
            input.project_id ?? null,
            input.activity_ref || null,
            input.manager_email || null,
        ]
    );
    const memoId = (result as any).insertId;

    await recordMemoEvent(tx, {
        memo_id: memoId,
        revision_no: 1,
        event_type: 'created',
        from_status: null,
        to_status: 'draft',
        actor_email: input.author_email,
    });

    return { memoId, templateId: template.id };
}

const UPDATABLE_COLUMNS: Array<keyof MemoFields> = [
    'to_label', 'from_label', 'subject', 'body', 'memo_date', 'amount', 'currency', 'project_id', 'activity_ref', 'manager_email',
];

/** Invariant 4 : seul l'auteur modifie, et seulement un brouillon ou un mémo retourné. */
export async function updateMemoDraft(
    tx: Executor,
    memoId: number,
    actorEmail: string,
    fields: MemoFields & { template_id?: number }
): Promise<any> {
    const memo = await loadMemoForUpdate(tx, memoId);
    assertAuthor(memo, actorEmail);
    if (!EDITABLE_STATUSES.includes(memo.status)) {
        throw new ConflictException(
            `A memo that is '${memo.status}' can no longer be edited — only drafts and returned memos can.`
        );
    }
    assertFieldFormats(fields);
    if (fields.subject !== undefined && !fields.subject.trim()) {
        throw new BusinessException('subject cannot be empty');
    }

    const sets: string[] = [];
    const params: any[] = [];
    for (const col of UPDATABLE_COLUMNS) {
        if (fields[col] !== undefined) {
            sets.push(`${col} = ?`);
            const v: any = fields[col];
            params.push(typeof v === 'string' ? (col === 'body' ? v : v.trim()) : v);
        }
    }
    if (fields.template_id !== undefined) {
        const [tplRows] = await tx.execute(
            'SELECT id FROM memo_chain_templates WHERE id = ? AND type_id = ? AND is_active = 1',
            [fields.template_id, memo.type_id]
        );
        if (!(tplRows as any[]).length) throw new ConflictException('This approval chain is not available for this memo type');
        sets.push('template_id = ?');
        params.push(fields.template_id);
    }
    if (!sets.length) return memo;

    await tx.execute(`UPDATE memos SET ${sets.join(', ')} WHERE id = ?`, [...params, memoId]);
    return { ...memo, ...fields };
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Soumission (et re-soumission après un retour)
// ═══════════════════════════════════════════════════════════════════════════

function assertSubmittable(memo: any, type: any): void {
    const missing: string[] = [];
    if (!(memo.subject || '').trim()) missing.push('subject');
    if (!(memo.body || '').trim()) missing.push('body');
    if (!(memo.to_label || '').trim()) missing.push('to');
    if (!(memo.from_label || '').trim()) missing.push('from');
    if (type.requires_amount && !(Number(memo.amount) > 0)) missing.push('amount');
    if (type.requires_amount && !memo.currency) missing.push('currency');
    if (type.requires_project && !memo.project_id) missing.push('project');
    if (missing.length) throw new BusinessException(`Cannot submit — missing: ${missing.join(', ')}`);
}

/** Un `release` ne peut être suivi que d'autres `release` ; il faut au moins un `approve`. */
function assertChainShape(steps: any[]): void {
    if (!steps.length) throw new ConflictException('The approval chain of this memo has no steps');
    if (!steps.some(s => s.kind === 'approve')) {
        throw new ConflictException('The approval chain of this memo has no approval step');
    }
    const firstRelease = steps.findIndex(s => s.kind === 'release');
    if (firstRelease !== -1 && steps.slice(firstRelease).some(s => s.kind !== 'release')) {
        throw new ConflictException('The approval chain is invalid: release steps must come last');
    }
}

async function nextReference(tx: Executor): Promise<string> {
    const year = new Date().getFullYear();
    // Le compteur est incrémenté dans la transaction de la soumission : la ligne
    // de l'année reste verrouillée jusqu'au COMMIT, deux soumissions ne se croisent pas.
    await tx.execute(
        `INSERT INTO memo_sequences (year, last_number) VALUES (?, 1)
         ON DUPLICATE KEY UPDATE last_number = last_number + 1`,
        [year]
    );
    const [rows] = await tx.execute('SELECT last_number FROM memo_sequences WHERE year = ?', [year]);
    const n = Number((rows as any[])[0]?.last_number || 1);
    return `MFWA/MEMO/${year}/${String(n).padStart(4, '0')}`;
}

export async function submitMemo(
    tx: Executor,
    memoId: number,
    actorEmail: string
): Promise<{ memo: any; reference: string; firstStepLabel: string; firstStepPositionId: number }> {
    const memo = await loadMemoForUpdate(tx, memoId);
    assertAuthor(memo, actorEmail);
    // Contrôle explicite : la table de transitions autorise in_review → in_review
    // (passage au pas suivant), ce qui ne doit surtout pas permettre de re-soumettre.
    if (!EDITABLE_STATUSES.includes(memo.status)) {
        throw new ConflictException(`Only a draft or a returned memo can be submitted (this one is '${memo.status}')`);
    }

    const [typeRows] = await tx.execute('SELECT * FROM memo_types WHERE id = ?', [memo.type_id]);
    const type = (typeRows as any[])[0];
    assertSubmittable(memo, type);

    if (type.requires_attachment) {
        const [cnt] = await tx.execute(
            'SELECT COUNT(*) AS n FROM memo_attachments WHERE memo_id = ? AND revision_no = ?',
            [memoId, memo.revision_no]
        );
        if (!Number((cnt as any[])[0]?.n)) {
            throw new BusinessException('Cannot submit — at least one attachment is required for this memo type');
        }
    }

    const [stepRows] = await tx.execute(
        `SELECT cs.step_no, cs.kind, cs.position_id, cs.label, p.label AS position_label
         FROM memo_chain_steps cs JOIN memo_positions p ON p.id = cs.position_id
         WHERE cs.template_id = ? ORDER BY cs.step_no ASC`,
        [memo.template_id]
    );
    const chain = stepRows as any[];
    assertChainShape(chain);

    // Invariant 3 : chaque niveau du circuit doit avoir au moins un titulaire actif
    // autre que l'auteur, sinon le mémo resterait bloqué.
    const positionIds = [...new Set(chain.map(s => s.position_id))];
    const [holderRows] = await tx.execute(
        `SELECT p.id, p.label, COUNT(h.id) AS n,
                (SELECT COUNT(*) FROM memo_position_holders x WHERE x.position_id = p.id AND x.is_active = 1) AS total
         FROM memo_positions p
         LEFT JOIN memo_position_holders h
                ON h.position_id = p.id AND h.is_active = 1 AND h.user_email <> ?
         WHERE p.id IN (${positionIds.map(() => '?').join(',')})
         GROUP BY p.id, p.label`,
        [actorEmail, ...positionIds]
    );
    const blocked = (holderRows as any[]).filter(r => !Number(r.n));
    if (blocked.length) {
        // Deux causes différentes, deux messages : niveau vide, ou niveau dont l'auteur est le seul titulaire
        // (il ne peut pas décider sur son propre mémo : il faut quelqu'un d'autre).
        const nobody = blocked.filter(r => !Number(r.total || 0)).map(r => r.label);
        const onlyYou = blocked.filter(r => Number(r.total || 0) > 0).map(r => r.label);
        const parts: string[] = [];
        if (nobody.length) parts.push(`no active holder is set for: ${nobody.join(', ')}. Ask an administrator to assign one.`);
        if (onlyYou.length) {
            parts.push(`you are the only active holder of: ${onlyYou.join(', ')}. You cannot decide on your own memo, so an administrator must assign someone else to ${onlyYou.length > 1 ? 'these levels' : 'this level'}.`);
        }
        throw new ConflictException(`Cannot submit — ${parts.join(' Also, ')}`);
    }

    // Manager choisi par l'auteur : il doit être titulaire actif du niveau de recommandation
    // (un titulaire retiré entre-temps ne doit pas laisser le mémo sans destinataire).
    const recommendStep = chain.find(s => s.kind === 'recommend');
    let assignee: string | null = null;
    if (memo.manager_email && recommendStep) {
        if (sameEmail(memo.manager_email, actorEmail) || !(await isActiveHolder(tx, recommendStep.position_id, memo.manager_email))) {
            throw new ConflictException(
                `The selected manager (${memo.manager_email}) is no longer an active ${recommendStep.position_label}. Pick another one.`
            );
        }
        assignee = String(memo.manager_email).trim().toLowerCase();
    }

    const signature = await getActiveSignature(tx, actorEmail);

    const isResubmission = memo.revision_no > 1;
    const reference: string = memo.reference || (await nextReference(tx));

    const [agentRows] = await tx.execute(`SELECT id FROM memo_positions WHERE code = 'agent' LIMIT 1`);
    const agent = (agentRows as any[])[0];
    if (!agent) throw new ConflictException("The 'agent' level is missing from memo_positions");

    // Pas 0 : la soumission elle-même, signée par l'auteur.
    await tx.execute(
        `INSERT INTO memo_steps (memo_id, revision_no, step_no, kind, position_id, label, status,
                                 acted_by_email, acted_at, signature_id, signature_sha256)
         VALUES (?, ?, 0, 'submit', ?, 'Submitted', 'done', ?, NOW(), ?, ?)`,
        [memoId, memo.revision_no, agent.id, actorEmail, signature.id, signature.sha256]
    );

    // Pas 1..n : copie figée du circuit ; le premier est actif.
    const stepValues = chain.map((s, i) => [
        memoId, memo.revision_no, s.step_no, s.kind, s.position_id, s.label, i === 0 ? 'active' : 'pending',
        s.kind === 'recommend' ? assignee : null,
    ]);
    await tx.execute(
        `INSERT INTO memo_steps (memo_id, revision_no, step_no, kind, position_id, label, status, assigned_email)
         VALUES ${stepValues.map(() => '(?,?,?,?,?,?,?,?)').join(',')}`,
        stepValues.flat()
    );

    await tx.execute(
        `UPDATE memos SET status = 'in_review', current_step_no = ?, reference = ?, submitted_at = NOW() WHERE id = ?`,
        [chain[0].step_no, reference, memoId]
    );

    await recordMemoEvent(tx, {
        memo_id: memoId,
        revision_no: memo.revision_no,
        step_no: 0,
        event_type: isResubmission ? 'resubmitted' : 'submitted',
        from_status: memo.status,
        to_status: 'in_review',
        actor_email: actorEmail,
        payload: {
            reference, steps: chain.map(s => ({ step_no: s.step_no, kind: s.kind, level: s.position_label })),
            ...(assignee ? { manager: assignee } : {}),
        },
    });

    return {
        memo: { ...memo, status: 'in_review', reference, current_step_no: chain[0].step_no },
        reference,
        firstStepLabel: chain[0].label,
        firstStepPositionId: chain[0].position_id,
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Décision sur un pas de recommandation / d'approbation
// ═══════════════════════════════════════════════════════════════════════════

export type StepDecision = 'approve' | 'return' | 'reject';

export async function decideStep(
    tx: Executor,
    memoId: number,
    actorEmail: string,
    decision: StepDecision,
    comment?: string | null
): Promise<{ memo: any; step: any; newStatus: MemoStatus; nextStep: any | null }> {
    if (!['approve', 'return', 'reject'].includes(decision)) {
        throw new BusinessException("decision must be 'approve', 'return' or 'reject'");
    }
    const memo = await loadMemoForUpdate(tx, memoId);
    if (memo.status !== 'in_review') {
        throw new ConflictException(
            memo.status === 'approved'
                ? 'This memo is already approved and waits for the release step'
                : `This memo is '${memo.status}' — there is nothing to decide`
        );
    }

    const steps = await loadSteps(tx, memoId, memo.revision_no);
    const step = steps.find(s => s.step_no === memo.current_step_no);
    if (!step || step.status !== 'active' || step.kind === 'release' || step.kind === 'submit') {
        throw new ConflictException('This memo has no step waiting for a decision');
    }

    assertNotAuthor(memo, actorEmail);
    if (!(await isActiveHolder(tx, step.position_id, actorEmail))) {
        throw new ForbiddenException(`Only the ${step.position_label} level can act on this step`);
    }
    if (step.assigned_email && !sameEmail(step.assigned_email, actorEmail)) {
        throw new ForbiddenException(`This memo is assigned to ${step.assigned_email} — only they can act on this step`);
    }

    const note = decision === 'approve' ? (comment || '').trim() || null
        : requireComment(comment, decision === 'return' ? 'return a memo to its author' : 'reject a memo');

    // ── Retour à l'auteur : nouvelle révision, circuit redémarré à la re-soumission ──
    if (decision === 'return') {
        assertTransition('in_review', 'returned');
        const nextRevision = memo.revision_no + 1;
        await tx.execute(
            `UPDATE memo_steps SET status = 'returned', acted_by_email = ?, acted_at = NOW(), comment = ? WHERE id = ?`,
            [actorEmail, note, step.id]
        );
        await tx.execute(
            `UPDATE memos SET status = 'returned', current_step_no = NULL, revision_no = ? WHERE id = ?`,
            [nextRevision, memoId]
        );
        // Les pièces suivent le mémo : l'auteur part de la révision précédente.
        await tx.execute(
            `INSERT INTO memo_attachments (memo_id, revision_no, kind, original_name, stored_path, mime_type,
                                           size_bytes, sha256, uploaded_by_email, uploaded_at)
             SELECT memo_id, ?, kind, original_name, stored_path, mime_type, size_bytes, sha256,
                    uploaded_by_email, uploaded_at
             FROM memo_attachments WHERE memo_id = ? AND revision_no = ?`,
            [nextRevision, memoId, memo.revision_no]
        );
        await recordMemoEvent(tx, {
            memo_id: memoId, revision_no: memo.revision_no, step_no: step.step_no,
            event_type: 'returned', from_status: 'in_review', to_status: 'returned',
            actor_email: actorEmail, payload: { level: step.position_label, next_revision: nextRevision }, notes: note,
        });
        return { memo: { ...memo, status: 'returned', revision_no: nextRevision }, step, newStatus: 'returned', nextStep: null };
    }

    // ── Rejet : terminal ──
    if (decision === 'reject') {
        assertTransition('in_review', 'rejected');
        await tx.execute(
            `UPDATE memo_steps SET status = 'rejected', acted_by_email = ?, acted_at = NOW(), comment = ? WHERE id = ?`,
            [actorEmail, note, step.id]
        );
        await tx.execute(
            `UPDATE memo_steps SET status = 'skipped' WHERE memo_id = ? AND revision_no = ? AND status = 'pending'`,
            [memoId, memo.revision_no]
        );
        await tx.execute(`UPDATE memos SET status = 'rejected', current_step_no = NULL WHERE id = ?`, [memoId]);
        await recordMemoEvent(tx, {
            memo_id: memoId, revision_no: memo.revision_no, step_no: step.step_no,
            event_type: 'rejected', from_status: 'in_review', to_status: 'rejected',
            actor_email: actorEmail, payload: { level: step.position_label }, notes: note,
        });
        return { memo: { ...memo, status: 'rejected' }, step, newStatus: 'rejected', nextStep: null };
    }

    // ── Recommandation / approbation : signature requise (invariant 8) ──
    const signature = await getActiveSignature(tx, actorEmail);
    await tx.execute(
        `UPDATE memo_steps SET status = 'done', acted_by_email = ?, acted_at = NOW(), comment = ?,
                               signature_id = ?, signature_sha256 = ? WHERE id = ?`,
        [actorEmail, note, signature.id, signature.sha256, step.id]
    );

    const nextStep = steps.find(s => s.step_no === step.step_no + 1) || null;
    // Le mémo est « approved » dès qu'il ne reste que le décaissement (ou rien).
    const newStatus: MemoStatus = !nextStep || nextStep.kind === 'release' ? 'approved' : 'in_review';
    assertTransition('in_review', newStatus);

    if (nextStep) {
        await tx.execute(`UPDATE memo_steps SET status = 'active' WHERE id = ?`, [nextStep.id]);
    }
    await tx.execute(
        `UPDATE memos SET status = ?, current_step_no = ?, approved_at = ${newStatus === 'approved' ? 'NOW()' : 'approved_at'}
         WHERE id = ?`,
        [newStatus, nextStep ? nextStep.step_no : null, memoId]
    );

    await recordMemoEvent(tx, {
        memo_id: memoId, revision_no: memo.revision_no, step_no: step.step_no,
        event_type: step.kind === 'recommend' ? 'recommended' : 'approved',
        from_status: 'in_review', to_status: newStatus,
        actor_email: actorEmail,
        payload: { level: step.position_label, label: step.label, signature_sha256: signature.sha256 },
        notes: note,
    });

    return { memo: { ...memo, status: newStatus }, step, newStatus, nextStep };
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. Décaissement par la finance (ou refus)
// ═══════════════════════════════════════════════════════════════════════════

export async function decideRelease(
    tx: Executor,
    memoId: number,
    actorEmail: string,
    input: { decision: 'release' | 'refuse'; release_reference?: string | null; comment?: string | null }
): Promise<{ memo: any; newStatus: MemoStatus }> {
    if (!['release', 'refuse'].includes(input.decision)) {
        throw new BusinessException("decision must be 'release' or 'refuse'");
    }
    const memo = await loadMemoForUpdate(tx, memoId);
    if (memo.status !== 'approved') {
        throw new ConflictException(`Only an approved memo can be released (this one is '${memo.status}')`);
    }

    const steps = await loadSteps(tx, memoId, memo.revision_no);
    const step = steps.find(s => s.step_no === memo.current_step_no);
    if (!step || step.kind !== 'release' || step.status !== 'active') {
        throw new ConflictException('This memo has no release step waiting for the finance level');
    }

    assertNotAuthor(memo, actorEmail);
    if (!(await isActiveHolder(tx, step.position_id, actorEmail))) {
        throw new ForbiddenException(`Only the ${step.position_label} level can release funds`);
    }

    if (input.decision === 'refuse') {
        const note = requireComment(input.comment, 'refuse a release');
        assertTransition('approved', 'release_refused');
        await tx.execute(
            `UPDATE memo_steps SET status = 'refused', acted_by_email = ?, acted_at = NOW(), comment = ? WHERE id = ?`,
            [actorEmail, note, step.id]
        );
        await tx.execute(`UPDATE memos SET status = 'release_refused', current_step_no = NULL WHERE id = ?`, [memoId]);
        await recordMemoEvent(tx, {
            memo_id: memoId, revision_no: memo.revision_no, step_no: step.step_no,
            event_type: 'release_refused', from_status: 'approved', to_status: 'release_refused',
            actor_email: actorEmail, payload: { level: step.position_label }, notes: note,
        });
        return { memo: { ...memo, status: 'release_refused' }, newStatus: 'release_refused' };
    }

    const reference = (input.release_reference || '').trim();
    if (!reference) throw new BusinessException('A payment reference is required to release funds');
    assertTransition('approved', 'released');

    const signature = await getActiveSignature(tx, actorEmail);
    await tx.execute(
        `UPDATE memo_steps SET status = 'done', acted_by_email = ?, acted_at = NOW(), comment = ?,
                               signature_id = ?, signature_sha256 = ? WHERE id = ?`,
        [actorEmail, (input.comment || '').trim() || null, signature.id, signature.sha256, step.id]
    );
    const nextStep = steps.find(s => s.step_no === step.step_no + 1) || null;
    if (nextStep) {
        // Plusieurs pas de décaissement à la suite : le mémo reste « approved » jusqu'au dernier.
        await tx.execute(`UPDATE memo_steps SET status = 'active' WHERE id = ?`, [nextStep.id]);
        await tx.execute(`UPDATE memos SET current_step_no = ? WHERE id = ?`, [nextStep.step_no, memoId]);
        await recordMemoEvent(tx, {
            memo_id: memoId, revision_no: memo.revision_no, step_no: step.step_no,
            event_type: 'released_step', from_status: 'approved', to_status: 'approved',
            actor_email: actorEmail, payload: { release_reference: reference, signature_sha256: signature.sha256 },
        });
        return { memo: { ...memo, status: 'approved' }, newStatus: 'approved' };
    }

    await tx.execute(
        `UPDATE memos SET status = 'released', current_step_no = NULL, released_at = NOW(), release_reference = ? WHERE id = ?`,
        [reference, memoId]
    );
    await recordMemoEvent(tx, {
        memo_id: memoId, revision_no: memo.revision_no, step_no: step.step_no,
        event_type: 'released', from_status: 'approved', to_status: 'released',
        actor_email: actorEmail,
        payload: { release_reference: reference, signature_sha256: signature.sha256 },
        notes: (input.comment || '').trim() || null,
    });
    return { memo: { ...memo, status: 'released', release_reference: reference }, newStatus: 'released' };
}

/**
 * Après un refus de la finance, le niveau qui a approuvé (le dernier pas
 * « approve ») peut ré-instruire la finance : le pas de décaissement redevient actif.
 */
export async function reinstructRelease(
    tx: Executor,
    memoId: number,
    actorEmail: string,
    comment?: string | null
): Promise<any> {
    const memo = await loadMemoForUpdate(tx, memoId);
    if (memo.status !== 'release_refused') {
        throw new ConflictException(`Only a memo whose release was refused can be re-instructed (this one is '${memo.status}')`);
    }
    const note = requireComment(comment, 're-instruct the finance level');

    const steps = await loadSteps(tx, memoId, memo.revision_no);
    const approver = [...steps].reverse().find(s => s.kind === 'approve');
    const releaseStep = steps.find(s => s.kind === 'release' && s.status === 'refused');
    if (!approver || !releaseStep) throw new ConflictException('This memo has no refused release step');

    assertNotAuthor(memo, actorEmail);
    if (!(await isActiveHolder(tx, approver.position_id, actorEmail))) {
        throw new ForbiddenException(`Only the ${approver.position_label} level can re-instruct the release`);
    }
    assertTransition('release_refused', 'approved');

    await tx.execute(
        `UPDATE memo_steps SET status = 'active', acted_by_email = NULL, acted_at = NULL, comment = NULL WHERE id = ?`,
        [releaseStep.id]
    );
    await tx.execute(`UPDATE memos SET status = 'approved', current_step_no = ? WHERE id = ?`, [releaseStep.step_no, memoId]);
    await recordMemoEvent(tx, {
        memo_id: memoId, revision_no: memo.revision_no, step_no: releaseStep.step_no,
        event_type: 'release_reopened', from_status: 'release_refused', to_status: 'approved',
        actor_email: actorEmail, payload: { level: approver.position_label }, notes: note,
    });
    return { ...memo, status: 'approved', current_step_no: releaseStep.step_no };
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. Retrait
// ═══════════════════════════════════════════════════════════════════════════

/**
 * L'auteur retire son mémo (brouillon, en revue, retourné ou refusé au décaissement).
 * Le niveau « approbation » peut aussi le retirer après un refus de la finance.
 */
export async function withdrawMemo(
    tx: Executor,
    memoId: number,
    actorEmail: string,
    reason?: string | null
): Promise<any> {
    const memo = await loadMemoForUpdate(tx, memoId);
    assertTransition(memo.status, 'withdrawn');

    let byApprover = false;
    if (!sameEmail(memo.author_email, actorEmail)) {
        if (memo.status !== 'release_refused') {
            throw new ForbiddenException('Only the author of this memo can withdraw it');
        }
        const steps = await loadSteps(tx, memoId, memo.revision_no);
        const approver = [...steps].reverse().find(s => s.kind === 'approve');
        if (!approver || !(await isActiveHolder(tx, approver.position_id, actorEmail))) {
            throw new ForbiddenException('Only the author or the approving level can withdraw this memo');
        }
        byApprover = true;
    }
    if (byApprover) requireComment(reason, 'withdraw a memo on behalf of its author');

    await tx.execute(
        `UPDATE memo_steps SET status = 'skipped' WHERE memo_id = ? AND revision_no = ? AND status IN ('pending','active')`,
        [memoId, memo.revision_no]
    );
    await tx.execute(`UPDATE memos SET status = 'withdrawn', current_step_no = NULL WHERE id = ?`, [memoId]);
    await recordMemoEvent(tx, {
        memo_id: memoId, revision_no: memo.revision_no,
        event_type: 'withdrawn', from_status: memo.status, to_status: 'withdrawn',
        actor_email: actorEmail, payload: byApprover ? { by_approver: true } : null,
        notes: (reason || '').trim() || null,
    });
    return { ...memo, status: 'withdrawn' };
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. Lecture : visibilité et actions possibles (fonctions pures + 1 requête)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Change le manager d'un mémo en attente de recommandation (auteur ou admin). `newEmail` null =
 * rouvrir le pas à tout titulaire du niveau. Seul le pas actif de recommandation est concerné.
 */
export async function reassignManager(
    tx: Executor,
    memoId: number,
    actorEmail: string,
    actorIsAdmin: boolean,
    newEmail: string | null
): Promise<{ memo: any; step: any; previous: string | null; assignee: string | null }> {
    const memo = await loadMemoForUpdate(tx, memoId);
    if (!actorIsAdmin && !sameEmail(memo.author_email, actorEmail)) {
        throw new ForbiddenException('Only the author or an administrator can change the manager');
    }
    if (memo.status !== 'in_review') {
        throw new ConflictException('The manager can only be changed while the memo waits for the recommendation');
    }
    const steps = await loadSteps(tx, memoId, memo.revision_no);
    const step = steps.find(x => x.step_no === memo.current_step_no);
    if (!step || step.status !== 'active' || step.kind !== 'recommend') {
        throw new ConflictException('The manager can only be changed while the memo waits at the recommendation step');
    }

    const target = newEmail && newEmail.trim() ? newEmail.trim().toLowerCase() : null;
    if (target) {
        if (sameEmail(target, memo.author_email)) throw new BusinessException('The author cannot be the manager of their own memo');
        if (!(await isActiveHolder(tx, step.position_id, target))) {
            throw new BusinessException(`${target} is not an active ${step.position_label}`);
        }
    }
    const previous: string | null = step.assigned_email ? String(step.assigned_email).toLowerCase() : null;
    if (previous === target) throw new ConflictException('This is already the selected manager');

    await tx.execute('UPDATE memo_steps SET assigned_email = ? WHERE id = ?', [target, step.id]);
    await tx.execute('UPDATE memos SET manager_email = ? WHERE id = ?', [target, memoId]);
    await recordMemoEvent(tx, {
        memo_id: memoId, revision_no: memo.revision_no, step_no: step.step_no, event_type: 'reassigned',
        from_status: 'in_review', to_status: 'in_review', actor_email: actorEmail,
        payload: { from: previous, to: target },
    });
    return { memo, step: { ...step, assigned_email: target }, previous, assignee: target };
}

/**
 * Qui voit un mémo : son auteur ; un admin (sauf les brouillons des autres) ;
 * tout titulaire actif d'un niveau du circuit ; toute personne ayant agi sur un pas.
 */
export async function canViewMemo(
    tx: Executor,
    memo: any,
    user: { email: string; role?: string }
): Promise<boolean> {
    if (sameEmail(memo.author_email, user.email)) return true;
    if ((user.role === 'admin' || user.role === 'super_admin') && memo.status !== 'draft') return true;
    if (memo.status === 'draft') return false;
    const [rows] = await tx.execute(
        `SELECT 1 FROM memo_steps s
         LEFT JOIN memo_position_holders h
                ON h.position_id = s.position_id AND h.user_email = ? AND h.is_active = 1
         WHERE s.memo_id = ? AND s.step_no > 0 AND (h.id IS NOT NULL OR s.acted_by_email = ?)
         LIMIT 1`,
        [user.email, memo.id, user.email]
    );
    return (rows as any[]).length > 0;
}

export type MemoCapabilities = {
    edit: boolean;
    submit: boolean;
    withdraw: boolean;
    decide: boolean;        // recommander / approuver / retourner / rejeter
    release: boolean;       // décaisser / refuser
    reassign: boolean;      // changer le manager tant que la recommandation est en attente (auteur ou admin)
    reinstruct: boolean;    // ré-instruire la finance après un refus
    waiting_for: string | null;
};

/**
 * Ce que l'utilisateur peut faire maintenant sur ce mémo. Pure : sert à l'écran
 * (afficher la bonne barre d'actions) ; le service REFAIT ces contrôles à
 * l'écriture, ce n'est jamais le seul garde-fou.
 * @param heldPositionIds niveaux dont l'utilisateur est titulaire ou suppléant actif
 */
export function memoCapabilities(
    memo: any,
    steps: any[],
    user: { email: string; role?: string },
    heldPositionIds: number[]
): MemoCapabilities {
    const isAuthor = sameEmail(memo.author_email, user.email);
    const active = steps.find(s => s.step_no === memo.current_step_no && s.status === 'active') || null;
    const holds = (pid: number) => heldPositionIds.includes(pid);
    const approver = [...steps].reverse().find(s => s.kind === 'approve');

    return {
        edit: isAuthor && EDITABLE_STATUSES.includes(memo.status),
        submit: isAuthor && EDITABLE_STATUSES.includes(memo.status),
        withdraw:
            !!ALLOWED_TRANSITIONS[memo.status as MemoStatus]?.includes('withdrawn') &&
            (isAuthor || (memo.status === 'release_refused' && !!approver && holds(approver.position_id))),
        decide: !isAuthor && memo.status === 'in_review' && !!active &&
            (active.kind === 'recommend' || active.kind === 'approve') && holds(active.position_id) &&
            (!active.assigned_email || sameEmail(active.assigned_email, user.email)),
        reassign: (isAuthor || user.role === 'admin' || user.role === 'super_admin') &&
            memo.status === 'in_review' && !!active && active.kind === 'recommend',
        release: !isAuthor && memo.status === 'approved' && !!active && active.kind === 'release' && holds(active.position_id),
        reinstruct: !isAuthor && memo.status === 'release_refused' && !!approver && holds(approver.position_id),
        waiting_for: active ? (active.assigned_email ? `${active.position_label} (${active.assigned_email})` : active.position_label) : null,
    };
}
