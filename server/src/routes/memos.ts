// server/src/routes/memos.ts
// Module « mémos et chaîne de validation » — REST au-dessus de services/memoService.ts.
// Les routes valident l'entrée, ouvrent une transaction, appellent le service et
// journalisent dans audit_log. Toute la logique d'états vit dans le service.
// E-mails : services/memoMailer.ts (non bloquants, après la transaction) ; PDF : services/memoPdf.ts.
import { Router, Request, Response } from 'express';
import { db } from '../database/connection';
import { logger } from '../middleware/logger';
import { requireAuth, requireAdmin, isAdminUser } from '../middleware/auth';
import { logAudit } from './audit';
import { AppException, BusinessException, ConflictException, NotFoundException } from '../exceptions';
import {
    createMemoDraft,
    updateMemoDraft,
    submitMemo,
    decideStep,
    decideRelease,
    reinstructRelease,
    withdrawMemo,
    reassignManager,
    canViewMemo,
    memoCapabilities,
    EDITABLE_STATUSES,
    type StepDecision,
} from '../services/memoService';
import { parsePngDataUrl, saveSignaturePng, readSignaturePng } from '../services/signatureStorage';
import { MEMO_PDF_SELECT, renderMemoPdf, pdfFileName, archiveFinalPdf, readArchivedPdf } from '../services/memoFinalPdf';
import { notifyMemoEvent } from '../services/memoMailer';
import {
    loadAdminConfig, createProject, updateProject, createType, updateType,
    createTemplate, updateTemplate, replaceChain,
} from '../services/memoAdminService';
import {
    validateAttachment, saveAttachment, readAttachment, MAX_ATTACHMENTS_PER_REVISION,
} from '../services/attachmentStorage';

const router = Router();

// ─── Helpers ────────────────────────────────────────────────────────────────

function fail(res: Response, err: unknown, ctx: string) {
    if (err instanceof AppException) {
        return res.status(err.statusCode).json({ error: err.message, code: err.code });
    }
    logger.error(`${ctx} error:`, err as Error);
    return res.status(500).json({ error: (err as Error).message });
}

function parseId(raw: unknown): number {
    const id = parseInt(String(raw), 10);
    if (!id || id < 1) throw new BusinessException('Invalid id');
    return id;
}

const optNumber = (v: unknown): number | null | undefined => {
    if (v === undefined) return undefined;
    if (v === null || v === '') return null;
    const n = Number(v);
    if (!isFinite(n)) throw new BusinessException('amount must be a number');
    return n;
};

const optString = (v: unknown): string | undefined => (v === undefined || v === null ? undefined : String(v));

/** Champs de contenu acceptés à la création et à la modification d'un brouillon. */
function pickFields(body: any) {
    return {
        to_label: optString(body.to_label),
        from_label: optString(body.from_label),
        subject: optString(body.subject),
        body: optString(body.body),
        memo_date: body.memo_date ? String(body.memo_date).slice(0, 10) : undefined,
        amount: optNumber(body.amount),
        currency: body.currency === undefined ? undefined : (body.currency ? String(body.currency).toUpperCase() : null),
        project_id: body.project_id === undefined ? undefined : (body.project_id ? parseInt(String(body.project_id), 10) : null),
        activity_ref: body.activity_ref === undefined ? undefined : (body.activity_ref ? String(body.activity_ref) : null),
        manager_email: body.manager_email === undefined ? undefined : (body.manager_email ? String(body.manager_email).trim().toLowerCase() : null),
    };
}

// Colonnes de la liste : sans le corps du mémo (lourd, inutile pour une liste).
const MEMO_LIST_SELECT = `
    SELECT m.id, m.reference, m.type_id, m.template_id, m.author_email, m.to_label, m.from_label, m.subject,
           m.memo_date, m.amount, m.currency, m.project_id, m.activity_ref, m.status, m.revision_no,
           m.current_step_no, m.submitted_at, m.approved_at, m.released_at, m.release_reference,
           m.created_at, m.updated_at,
           ty.name AS type_name, pr.code AS project_code, pr.title AS project_title,
           (SELECT p.label FROM memo_steps s JOIN memo_positions p ON p.id = s.position_id
             WHERE s.memo_id = m.id AND s.revision_no = m.revision_no
               AND s.step_no = m.current_step_no AND s.status = 'active' LIMIT 1) AS waiting_for,
           (SELECT MAX(e.event_at) FROM memo_events e WHERE e.memo_id = m.id AND e.event_type <> 'reminder') AS last_event_at
    FROM memos m
         JOIN memo_types ty ON ty.id = m.type_id
         LEFT JOIN memo_projects pr ON pr.id = m.project_id
`;

/** « À traiter » : un pas actif (ou un refus de décaissement) que cet utilisateur peut décider. */
const TO_ACT_SQL = `(
    m.author_email <> ? AND (
        (m.status IN ('in_review','approved') AND EXISTS (
            SELECT 1 FROM memo_steps s
              JOIN memo_position_holders h ON h.position_id = s.position_id AND h.user_email = ? AND h.is_active = 1
             WHERE s.memo_id = m.id AND s.revision_no = m.revision_no
               AND s.step_no = m.current_step_no AND s.status = 'active'
               AND (s.assigned_email IS NULL OR s.assigned_email = ?)))
        OR (m.status = 'release_refused' AND EXISTS (
            SELECT 1 FROM memo_steps s
              JOIN memo_position_holders h ON h.position_id = s.position_id AND h.user_email = ? AND h.is_active = 1
             WHERE s.memo_id = m.id AND s.revision_no = m.revision_no AND s.kind = 'approve'
               AND s.step_no = (SELECT MAX(s2.step_no) FROM memo_steps s2
                                 WHERE s2.memo_id = m.id AND s2.revision_no = m.revision_no AND s2.kind = 'approve')))
    )
)`;
const toActParams = (email: string) => [email, email, email, email];

/** Périmètre de lecture imposé côté serveur (jamais seulement masqué dans l'interface). */
function visibleClause(user: { email: string; role?: string }): { sql: string; params: any[] } {
    const adminPart = isAdminUser(user) ? `m.status <> 'draft'` : '0';
    return {
        sql: `(m.author_email = ? OR ${adminPart} OR (m.status <> 'draft' AND EXISTS (
                 SELECT 1 FROM memo_steps vs
                   LEFT JOIN memo_position_holders vh
                          ON vh.position_id = vs.position_id AND vh.user_email = ? AND vh.is_active = 1
                  WHERE vs.memo_id = m.id AND vs.step_no > 0 AND (vh.id IS NOT NULL OR vs.acted_by_email = ?))))`,
        params: [user.email, user.email, user.email],
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// ROUTES SPÉCIFIQUES — avant /:id
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/memos/meta — de quoi construire le formulaire de rédaction
router.get('/meta', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const [types] = await db.query(
            `SELECT id, code, name, requires_amount, requires_project, requires_attachment
             FROM memo_types WHERE is_active = 1 ORDER BY name`
        );
        const [templates] = await db.query(
            `SELECT id, type_id, name, is_default FROM memo_chain_templates WHERE is_active = 1 ORDER BY type_id, is_default DESC, id`
        );
        // Le circuit de chaque modèle, avec le nombre de titulaires actifs par niveau :
        // l'auteur voit qui signera, et un niveau sans titulaire est signalé avant la soumission.
        const [steps] = await db.query(
            `SELECT cs.template_id, cs.step_no, cs.kind, cs.label, p.code AS position_code, p.label AS position_label,
                    (SELECT COUNT(*) FROM memo_position_holders h
                      WHERE h.position_id = p.id AND h.is_active = 1 AND h.user_email <> ?) AS holders
             FROM memo_chain_steps cs JOIN memo_positions p ON p.id = cs.position_id
             ORDER BY cs.template_id, cs.step_no`,
            [user.email]
        );
        const [projects] = await db.query(
            `SELECT id, code, title, donor, default_currency FROM memo_projects WHERE is_active = 1 ORDER BY code`
        );
        // Titulaires des niveaux « recommander » : l'auteur peut y choisir son manager.
        const [managers] = await db.query(
            `SELECT DISTINCT p.code AS position_code, h.user_email AS email, h.holder_role
             FROM memo_chain_steps cs
                  JOIN memo_positions p ON p.id = cs.position_id
                  JOIN memo_position_holders h ON h.position_id = p.id AND h.is_active = 1
             WHERE cs.kind = 'recommend' ORDER BY h.user_email`
        );
        const [sig] = await db.query(
            `SELECT id, source, created_at FROM user_signatures WHERE user_email = ? AND is_active = 1 ORDER BY id DESC LIMIT 1`,
            [user.email]
        );

        const stepsByTemplate = new Map<number, any[]>();
        for (const s of (steps as any[]) || []) {
            if (!stepsByTemplate.has(s.template_id)) stepsByTemplate.set(s.template_id, []);
            stepsByTemplate.get(s.template_id)!.push(s);
        }
        return res.json({
            types: types || [],
            templates: ((templates as any[]) || []).map(t => ({ ...t, steps: stepsByTemplate.get(t.id) || [] })),
            projects: projects || [],
            managers: managers || [],
            signature: (sig as any[])[0] || null,
        });
    } catch (err) {
        return fail(res, err, 'GET /memos/meta');
    }
});

// GET /api/memos/stats — compteurs de l'en-tête
router.get('/stats', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const [toAct] = await db.query(
            `SELECT COUNT(*) AS n, MIN((SELECT MAX(e.event_at) FROM memo_events e WHERE e.memo_id = m.id AND e.event_type <> 'reminder')) AS oldest
             FROM memos m WHERE ${TO_ACT_SQL}`,
            toActParams(user.email)
        );
        const [mine] = await db.query(
            `SELECT SUM(status IN ('draft','returned')) AS to_finish,
                    SUM(status IN ('in_review','approved','release_refused')) AS in_progress
             FROM memos WHERE author_email = ?`,
            [user.email]
        );
        const t = (toAct as any[])[0] || {};
        const m = (mine as any[])[0] || {};
        return res.json({
            to_act: Number(t.n || 0),
            oldest_waiting_since: t.oldest || null,
            to_finish: Number(m.to_finish || 0),
            in_progress: Number(m.in_progress || 0),
        });
    } catch (err) {
        return fail(res, err, 'GET /memos/stats');
    }
});

// ─── Signature de l'utilisateur ─────────────────────────────────────────────

// GET /api/memos/signature — l'utilisateur a-t-il une signature enregistrée ?
router.get('/signature', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const [rows] = await db.query(
            `SELECT id, source, sha256, created_at FROM user_signatures
             WHERE user_email = ? AND is_active = 1 ORDER BY id DESC LIMIT 1`,
            [user.email]
        );
        const sig = (rows as any[])[0] || null;
        return res.json({ has_signature: !!sig, signature: sig });
    } catch (err) {
        return fail(res, err, 'GET /memos/signature');
    }
});

// GET /api/memos/signature/image — l'image de SA signature (aperçu dans son profil)
router.get('/signature/image', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const [rows] = await db.query(
            `SELECT image_path FROM user_signatures WHERE user_email = ? AND is_active = 1 ORDER BY id DESC LIMIT 1`,
            [user.email]
        );
        const sig = (rows as any[])[0];
        if (!sig) throw new NotFoundException('No signature registered');
        const png = await readSignaturePng(sig.image_path);
        res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store' });
        return res.send(png);
    } catch (err) {
        return fail(res, err, 'GET /memos/signature/image');
    }
});

// POST /api/memos/signature — { image: 'data:image/png;base64,…', source: 'drawn'|'typed'|'uploaded' }
// Remplace la signature active ; l'ancienne reste en base (inactive) car des pas de
// mémos déjà décidés y font référence.
router.post('/signature', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const source = String(req.body?.source || '');
        if (!['drawn', 'typed', 'uploaded'].includes(source)) {
            throw new BusinessException("source must be 'drawn', 'typed' or 'uploaded'");
        }
        const png = parsePngDataUrl(req.body?.image);
        const { relPath, sha256 } = await saveSignaturePng(png);

        const id = await db.transaction(async (tx) => {
            await tx.execute(`UPDATE user_signatures SET is_active = 0 WHERE user_email = ?`, [user.email]);
            const [r] = await tx.execute(
                `INSERT INTO user_signatures (user_uid, user_email, image_path, sha256, source, is_active)
                 VALUES (?, ?, ?, ?, ?, 1)`,
                [String(user.uid ?? '') || null, user.email, relPath, sha256, source]
            );
            return (r as any).insertId as number;
        });

        await logAudit(user.email, 'memo_signature_saved', 'user_signatures', id, null, { source, sha256 });
        return res.status(201).json({ id, source, sha256 });
    } catch (err) {
        return fail(res, err, 'POST /memos/signature');
    }
});

// ─── Administration : titulaires par niveau ─────────────────────────────────

// GET /api/memos/admin/positions — les niveaux et leurs titulaires
router.get('/admin/positions', requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try {
        const [positions] = await db.query(`SELECT id, code, label, sort_order, is_active FROM memo_positions ORDER BY sort_order`);
        const [holders] = await db.query(
            `SELECT id, position_id, user_email, holder_role, is_active, created_at, created_by
             FROM memo_position_holders ORDER BY position_id, holder_role, user_email`
        );
        const byPosition = new Map<number, any[]>();
        for (const h of (holders as any[]) || []) {
            if (!byPosition.has(h.position_id)) byPosition.set(h.position_id, []);
            byPosition.get(h.position_id)!.push(h);
        }
        return res.json(((positions as any[]) || []).map(p => ({ ...p, holders: byPosition.get(p.id) || [] })));
    } catch (err) {
        return fail(res, err, 'GET /memos/admin/positions');
    }
});

// POST /api/memos/admin/positions/:code/holders — { email, holder_role?: 'holder'|'deputy' }
router.post('/admin/positions/:code/holders', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const code = String(req.params.code);
        const email = String(req.body?.email || '').trim().toLowerCase();
        const holderRole = req.body?.holder_role === 'deputy' ? 'deputy' : 'holder';
        if (!email) throw new BusinessException('email is required');
        if (code === 'agent') {
            throw new BusinessException("The 'agent' level has no holders: any signed-in user can write a memo");
        }

        const [pRows] = await db.query('SELECT id FROM memo_positions WHERE code = ? AND is_active = 1', [code]);
        const position = (pRows as any[])[0];
        if (!position) throw new NotFoundException('Level not found');
        const [uRows] = await db.query('SELECT email FROM users WHERE email = ? LIMIT 1', [email]);
        if (!(uRows as any[])[0]) throw new NotFoundException(`No user account with the email ${email}`);

        const [r] = await db.query(
            `INSERT INTO memo_position_holders (position_id, user_email, holder_role, is_active, created_by)
             VALUES (?, ?, ?, 1, ?)
             ON DUPLICATE KEY UPDATE is_active = 1, holder_role = VALUES(holder_role)`,
            [position.id, email, holderRole, user.email]
        );
        await logAudit(user.email, 'memo_holder_added', 'memo_position_holders', Number((r as any).insertId || 0), null,
            { level: code, email, holder_role: holderRole });
        return res.status(201).json({ success: true, level: code, email, holder_role: holderRole });
    } catch (err) {
        return fail(res, err, 'POST /memos/admin/positions/:code/holders');
    }
});

// PATCH /api/memos/admin/holders/:id — { is_active?, holder_role? } (on désactive, on ne supprime pas)
router.patch('/admin/holders/:id', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const id = parseId(req.params.id);
        const sets: string[] = [];
        const params: any[] = [];
        if (req.body?.is_active !== undefined) { sets.push('is_active = ?'); params.push(req.body.is_active ? 1 : 0); }
        if (req.body?.holder_role !== undefined) {
            if (!['holder', 'deputy'].includes(req.body.holder_role)) throw new BusinessException("holder_role must be 'holder' or 'deputy'");
            sets.push('holder_role = ?'); params.push(req.body.holder_role);
        }
        if (!sets.length) throw new BusinessException('Nothing to update');

        const [r] = await db.query(`UPDATE memo_position_holders SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
        if (!(r as any).affectedRows) throw new NotFoundException('Holder not found');
        await logAudit(user.email, 'memo_holder_changed', 'memo_position_holders', id, null, req.body);
        return res.json({ success: true, id });
    } catch (err) {
        return fail(res, err, 'PATCH /memos/admin/holders/:id');
    }
});

// ─── Administration : projets, types de mémo et circuits ────────────────────

// GET /api/memos/admin/config — types, modèles de circuit (avec pas), projets, niveaux
router.get('/admin/config', requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try {
        return res.json(await loadAdminConfig(db as any));
    } catch (err) {
        return fail(res, err, 'GET /memos/admin/config');
    }
});

// POST /api/memos/admin/projects — { code, title, donor?, default_currency? }
router.post('/admin/projects', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const r = await db.transaction(async (tx) => createProject(tx as any, req.body || {}));
        await logAudit(user.email, 'memo_project_created', 'memo_projects', r.id, null, req.body);
        return res.status(201).json({ success: true, id: r.id });
    } catch (err) {
        return fail(res, err, 'POST /memos/admin/projects');
    }
});

// PATCH /api/memos/admin/projects/:id — { title?, donor?, default_currency?, is_active? }
router.patch('/admin/projects/:id', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const id = parseId(req.params.id);
        await db.transaction(async (tx) => updateProject(tx as any, id, req.body || {}));
        await logAudit(user.email, 'memo_project_changed', 'memo_projects', id, null, req.body);
        return res.json({ success: true, id });
    } catch (err) {
        return fail(res, err, 'PATCH /memos/admin/projects/:id');
    }
});

// POST /api/memos/admin/types — { code, name, requires_*?, steps? } (crée aussi le circuit « Standard »)
router.post('/admin/types', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const r = await db.transaction(async (tx) => createType(tx as any, req.body || {}));
        await logAudit(user.email, 'memo_type_created', 'memo_types', r.typeId, null, req.body);
        return res.status(201).json({ success: true, id: r.typeId, template_id: r.templateId });
    } catch (err) {
        return fail(res, err, 'POST /memos/admin/types');
    }
});

// PATCH /api/memos/admin/types/:id — { name?, requires_amount?, requires_project?, requires_attachment?, is_active? }
router.patch('/admin/types/:id', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const id = parseId(req.params.id);
        await db.transaction(async (tx) => updateType(tx as any, id, req.body || {}));
        await logAudit(user.email, 'memo_type_changed', 'memo_types', id, null, req.body);
        return res.json({ success: true, id });
    } catch (err) {
        return fail(res, err, 'PATCH /memos/admin/types/:id');
    }
});

// POST /api/memos/admin/types/:id/templates — { name, steps, is_default? }
router.post('/admin/types/:id/templates', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const id = parseId(req.params.id);
        const r = await db.transaction(async (tx) => createTemplate(tx as any, id, req.body || {}));
        await logAudit(user.email, 'memo_chain_created', 'memo_chain_templates', r.templateId, null, req.body);
        return res.status(201).json({ success: true, id: r.templateId });
    } catch (err) {
        return fail(res, err, 'POST /memos/admin/types/:id/templates');
    }
});

// PATCH /api/memos/admin/templates/:id — { name?, is_default?, is_active? }
router.patch('/admin/templates/:id', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const id = parseId(req.params.id);
        await db.transaction(async (tx) => updateTemplate(tx as any, id, req.body || {}));
        await logAudit(user.email, 'memo_chain_changed', 'memo_chain_templates', id, null, req.body);
        return res.json({ success: true, id });
    } catch (err) {
        return fail(res, err, 'PATCH /memos/admin/templates/:id');
    }
});

// PUT /api/memos/admin/templates/:id/chain — { steps: [{ kind, position_code, label? }] }
// Ne touche pas aux mémos déjà soumis : leur circuit est figé dans memo_steps.
router.put('/admin/templates/:id/chain', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const id = parseId(req.params.id);
        const r = await db.transaction(async (tx) => replaceChain(tx as any, id, req.body?.steps));
        await logAudit(user.email, 'memo_chain_steps_replaced', 'memo_chain_templates', id, null, req.body);
        return res.json({ success: true, id, steps: r.steps });
    } catch (err) {
        return fail(res, err, 'PUT /memos/admin/templates/:id/chain');
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// LECTURES
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/memos?scope=to_act|mine|all&status=&q=
router.get('/', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const scope = String(req.query.scope || 'mine');
        const where: string[] = [];
        const params: any[] = [];

        const vis = visibleClause(user);
        where.push(vis.sql);
        params.push(...vis.params);

        if (scope === 'to_act') { where.push(TO_ACT_SQL); params.push(...toActParams(user.email)); }
        else if (scope === 'mine') { where.push('m.author_email = ?'); params.push(user.email); }
        else if (scope !== 'all') throw new BusinessException("scope must be 'to_act', 'mine' or 'all'");

        if (req.query.status) {
            const list = String(req.query.status).split(',').map(s => s.trim()).filter(Boolean);
            where.push(`m.status IN (${list.map(() => '?').join(',')})`);
            params.push(...list);
        }
        if (req.query.q) {
            where.push('(m.subject LIKE ? OR m.reference LIKE ?)');
            params.push(`%${req.query.q}%`, `%${req.query.q}%`);
        }

        const [rows] = await db.query(
            `${MEMO_LIST_SELECT} WHERE ${where.join(' AND ')} ORDER BY m.updated_at DESC, m.id DESC LIMIT 200`,
            params
        );
        return res.json(rows || []);
    } catch (err) {
        return fail(res, err, 'GET /memos');
    }
});

// GET /api/memos/:id — le mémo, son circuit, ses pièces, son journal, et ce que
// l'utilisateur courant peut en faire (pour afficher la bonne barre d'actions).
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const id = parseId(req.params.id);

        const [rows] = await db.query(
            `SELECT m.*, ty.name AS type_name, pr.code AS project_code, pr.title AS project_title, pr.donor AS project_donor
             FROM memos m JOIN memo_types ty ON ty.id = m.type_id
                  LEFT JOIN memo_projects pr ON pr.id = m.project_id
             WHERE m.id = ?`,
            [id]
        );
        const memo = (rows as any[])[0];
        if (!memo) throw new NotFoundException('Memo not found');
        if (!(await canViewMemo(db as any, memo, user))) {
            return res.status(403).json({ error: 'You do not have access to this memo' });
        }

        const [steps] = await db.query(
            `SELECT s.id, s.revision_no, s.step_no, s.kind, s.position_id, s.label, s.status, s.assigned_email, s.acted_by_email,
                    s.acted_at, s.comment, (s.signature_id IS NOT NULL) AS signed, s.signature_sha256,
                    p.code AS position_code, p.label AS position_label
             FROM memo_steps s JOIN memo_positions p ON p.id = s.position_id
             WHERE s.memo_id = ? ORDER BY s.revision_no ASC, s.step_no ASC`,
            [id]
        );
        const [attachments] = await db.query(
            `SELECT id, revision_no, kind, original_name, mime_type, size_bytes, sha256, uploaded_by_email, uploaded_at
             FROM memo_attachments WHERE memo_id = ? ORDER BY revision_no, id`,
            [id]
        );
        const [events] = await db.query(
            `SELECT id, revision_no, step_no, event_type, from_status, to_status, actor_email, event_at, payload, notes
             FROM memo_events WHERE memo_id = ? ORDER BY event_at ASC, id ASC`,
            [id]
        );
        const [held] = await db.query(
            `SELECT position_id FROM memo_position_holders WHERE user_email = ? AND is_active = 1`,
            [user.email]
        );

        const currentSteps = ((steps as any[]) || []).filter(s => s.revision_no === memo.revision_no);
        const capabilities = memoCapabilities(memo, currentSteps, user, ((held as any[]) || []).map(h => h.position_id));

        return res.json({
            ...memo,
            steps: steps || [],
            attachments: attachments || [],
            events: events || [],
            capabilities,
        });
    } catch (err) {
        return fail(res, err, 'GET /memos/:id');
    }
});

// GET /api/memos/:id/steps/:stepId/signature — l'image de signature apposée à un pas,
// pour dessiner le bloc de tampons. Lisible par quiconque peut voir le mémo.
router.get('/:id/steps/:stepId/signature', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const id = parseId(req.params.id);
        const stepId = parseId(req.params.stepId);

        const [mRows] = await db.query('SELECT id, author_email, status FROM memos WHERE id = ?', [id]);
        const memo = (mRows as any[])[0];
        if (!memo) throw new NotFoundException('Memo not found');
        if (!(await canViewMemo(db as any, memo, user))) {
            return res.status(403).json({ error: 'You do not have access to this memo' });
        }

        const [rows] = await db.query(
            `SELECT sg.image_path FROM memo_steps s JOIN user_signatures sg ON sg.id = s.signature_id
             WHERE s.id = ? AND s.memo_id = ?`,
            [stepId, id]
        );
        const sig = (rows as any[])[0];
        if (!sig) throw new NotFoundException('No signature on this step');
        const png = await readSignaturePng(sig.image_path);
        res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=3600' });
        return res.send(png);
    } catch (err) {
        return fail(res, err, 'GET /memos/:id/steps/:stepId/signature');
    }
});

// ─── Pièces jointes ─────────────────────────────────────────────────────────
// Le corps de la requête est le fichier brut (express.raw, monté dans app.ts) ;
// le nom voyage dans l'en-tête X-File-Name (encodé URI), le type dans Content-Type.

// POST /api/memos/:id/attachments — l'auteur, brouillon ou mémo retourné, révision courante
router.post('/:id/attachments', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const id = parseId(req.params.id);
        const file = validateAttachment(req.header('x-file-name'), req.header('content-type'), req.body);
        const kind = ['budget', 'invoice', 'scan', 'other'].includes(String(req.header('x-attachment-kind')))
            ? String(req.header('x-attachment-kind')) : 'other';

        const [rows] = await db.query('SELECT id, author_email, status, revision_no FROM memos WHERE id = ?', [id]);
        const memo = (rows as any[])[0];
        if (!memo) throw new NotFoundException('Memo not found');
        if (String(memo.author_email).toLowerCase() !== String(user.email).toLowerCase()) {
            return res.status(403).json({ error: 'Only the author can attach files' });
        }
        if (!EDITABLE_STATUSES.includes(memo.status)) {
            throw new ConflictException('Attachments can only change while the memo is a draft or returned');
        }
        const [cnt] = await db.query('SELECT COUNT(*) AS n FROM memo_attachments WHERE memo_id = ? AND revision_no = ?', [id, memo.revision_no]);
        if (Number((cnt as any[])[0]?.n) >= MAX_ATTACHMENTS_PER_REVISION) {
            throw new BusinessException(`At most ${MAX_ATTACHMENTS_PER_REVISION} attachments per memo`);
        }

        const { relPath, sha256 } = await saveAttachment(file.data);
        const [ins] = await db.query(
            `INSERT INTO memo_attachments (memo_id, revision_no, kind, original_name, stored_path, mime_type, size_bytes, sha256, uploaded_by_email)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, memo.revision_no, kind, file.name, relPath, file.mime, file.data.length, sha256, user.email]
        );
        await logAudit(user.email, 'memo_attachment_added', 'memos', id, null, { name: file.name, sha256 });
        return res.status(201).json({ id: (ins as any).insertId, original_name: file.name, size_bytes: file.data.length });
    } catch (err) {
        return fail(res, err, 'POST /memos/:id/attachments');
    }
});

// GET /api/memos/:id/attachments/:attId — téléchargement (même visibilité que le mémo)
router.get('/:id/attachments/:attId', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const id = parseId(req.params.id);
        const attId = parseId(req.params.attId);
        const [mRows] = await db.query('SELECT id, author_email, status FROM memos WHERE id = ?', [id]);
        const memo = (mRows as any[])[0];
        if (!memo) throw new NotFoundException('Memo not found');
        if (!(await canViewMemo(db as any, memo, user))) {
            return res.status(403).json({ error: 'You do not have access to this memo' });
        }
        const [aRows] = await db.query(
            'SELECT original_name, stored_path, mime_type FROM memo_attachments WHERE id = ? AND memo_id = ?', [attId, id]);
        const att = (aRows as any[])[0];
        if (!att) throw new NotFoundException('Attachment not found');
        const data = await readAttachment(att.stored_path);
        res.set({
            'Content-Type': att.mime_type,
            'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(att.original_name)}`,
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'private, max-age=0',
        });
        return res.send(data);
    } catch (err) {
        return fail(res, err, 'GET /memos/:id/attachments/:attId');
    }
});

// DELETE /api/memos/:id/attachments/:attId — l'auteur, tant que le mémo est modifiable
router.delete('/:id/attachments/:attId', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const id = parseId(req.params.id);
        const attId = parseId(req.params.attId);
        const [rows] = await db.query('SELECT id, author_email, status, revision_no FROM memos WHERE id = ?', [id]);
        const memo = (rows as any[])[0];
        if (!memo) throw new NotFoundException('Memo not found');
        if (String(memo.author_email).toLowerCase() !== String(user.email).toLowerCase()) {
            return res.status(403).json({ error: 'Only the author can remove attachments' });
        }
        if (!EDITABLE_STATUSES.includes(memo.status)) {
            throw new ConflictException('Attachments can only change while the memo is a draft or returned');
        }
        // Seule la révision courante : les pièces des révisions passées font partie de l'historique.
        const [del] = await db.query('DELETE FROM memo_attachments WHERE id = ? AND memo_id = ? AND revision_no = ?', [attId, id, memo.revision_no]);
        if (!(del as any).affectedRows) throw new NotFoundException('Attachment not found');
        await logAudit(user.email, 'memo_attachment_removed', 'memos', id, null, { attachment_id: attId });
        return res.json({ success: true });
    } catch (err) {
        return fail(res, err, 'DELETE /memos/:id/attachments/:attId');
    }
});

// ─── PDF officiel ───────────────────────────────────────────────────────────

// GET /api/memos/:id/pdf — même visibilité que la fiche. Un mémo non final est généré à la
// demande avec un bandeau « non valide » ; un mémo décaissé a un PDF FINAL archivé au
// décaissement (sinon archivé à la première demande) et servi tel quel, empreinte vérifiée.
router.get('/:id/pdf', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const id = parseId(req.params.id);

        const [rows] = await db.query(MEMO_PDF_SELECT, [id]);
        let memo = (rows as any[])[0];
        if (!memo) throw new NotFoundException('Memo not found');
        if (!(await canViewMemo(db as any, memo, user))) {
            return res.status(403).json({ error: 'You do not have access to this memo' });
        }

        let pdf: Buffer | null = null;
        let sha256: string | null = null;
        if (memo.status === 'released') {
            if (!memo.pdf_path) {
                try {
                    await archiveFinalPdf(id);
                    const [again] = await db.query(MEMO_PDF_SELECT, [id]);
                    memo = (again as any[])[0] || memo;
                } catch (err) {
                    logger.error(`Memo #${id}: final PDF could not be archived, serving a fresh render:`, err as Error);
                }
            }
            if (memo.pdf_path) {
                pdf = await readArchivedPdf(memo);
                sha256 = memo.pdf_sha256;
            }
        }
        if (!pdf) pdf = await renderMemoPdf(memo);

        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${pdfFileName(memo)}"`,
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'private, max-age=0',
            ...(sha256 ? { 'X-PDF-SHA256': sha256 } : {}),
        });
        return res.send(pdf);
    } catch (err) {
        return fail(res, err, 'GET /memos/:id/pdf');
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// ÉCRITURES
// ═══════════════════════════════════════════════════════════════════════════

// POST /api/memos — crée un brouillon { type_id, template_id?, subject, body, to_label, from_label, … }
router.post('/', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const typeId = parseInt(String(req.body?.type_id || ''), 10);
        if (!typeId) throw new BusinessException('type_id is required');

        const { memoId, templateId } = await db.transaction(async (tx) =>
            createMemoDraft(tx as any, {
                type_id: typeId,
                template_id: req.body?.template_id ? parseInt(String(req.body.template_id), 10) : null,
                author_uid: String(user.uid ?? '') || null,
                author_email: user.email,
                ...pickFields(req.body || {}),
            })
        );
        logger.info(`Created memo draft #${memoId} by ${user.email}`, 'MEMOS');
        return res.status(201).json({ id: memoId, status: 'draft', template_id: templateId });
    } catch (err) {
        return fail(res, err, 'POST /memos');
    }
});

// PUT /api/memos/:id — modifie un brouillon ou un mémo retourné (auteur seulement)
router.put('/:id', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const id = parseId(req.params.id);
        const fields: any = pickFields(req.body || {});
        if (req.body?.template_id) fields.template_id = parseInt(String(req.body.template_id), 10);
        await db.transaction(async (tx) => updateMemoDraft(tx as any, id, user.email, fields));
        return res.json({ success: true, id });
    } catch (err) {
        return fail(res, err, 'PUT /memos/:id');
    }
});

// PATCH /api/memos/:id/submit — signe et soumet (ou re-soumet après un retour)
router.patch('/:id/submit', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const id = parseId(req.params.id);
        const result = await db.transaction(async (tx) => submitMemo(tx as any, id, user.email));
        await logAudit(user.email, 'memo_submitted', 'memos', id, null, { reference: result.reference });
        logger.info(`Memo #${id} submitted (${result.reference}) by ${user.email}`, 'MEMOS');
        await notifyMemoEvent('submitted', id, user.email);
        return res.json({ success: true, id, status: 'in_review', reference: result.reference });
    } catch (err) {
        return fail(res, err, 'PATCH /memos/:id/submit');
    }
});

// PATCH /api/memos/:id/assignee — { email: string | null } : change le manager (auteur ou admin)
router.patch('/:id/assignee', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const id = parseId(req.params.id);
        const email = req.body?.email ? String(req.body.email) : null;
        const result = await db.transaction(async (tx) => reassignManager(tx as any, id, user.email, isAdminUser(user), email));
        await logAudit(user.email, 'memo_manager_changed', 'memos', id, null, { from: result.previous, to: result.assignee });
        logger.info(`Memo #${id}: manager ${result.previous || 'any'} → ${result.assignee || 'any'} by ${user.email}`, 'MEMOS');
        await notifyMemoEvent('reassigned', id, user.email);
        return res.json({ success: true, id, assigned_email: result.assignee });
    } catch (err) {
        return fail(res, err, 'PATCH /memos/:id/assignee');
    }
});

// PATCH /api/memos/:id/decision — { decision: 'approve'|'return'|'reject', comment? }
router.patch('/:id/decision', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const id = parseId(req.params.id);
        const decision = String(req.body?.decision || '') as StepDecision;
        const result = await db.transaction(async (tx) =>
            decideStep(tx as any, id, user.email, decision, req.body?.comment || null)
        );
        await logAudit(user.email, `memo_${decision}`, 'memos', id, null, { step_no: result.step.step_no, comment: req.body?.comment || null });
        logger.info(`Memo #${id}: ${decision} at step ${result.step.step_no} by ${user.email} → ${result.newStatus}`, 'MEMOS');
        await notifyMemoEvent('decided', id, user.email, { comment: req.body?.comment || null });
        return res.json({ success: true, id, status: result.newStatus });
    } catch (err) {
        return fail(res, err, 'PATCH /memos/:id/decision');
    }
});

// PATCH /api/memos/:id/release — { decision: 'release'|'refuse', release_reference?, comment? }
router.patch('/:id/release', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const id = parseId(req.params.id);
        const result = await db.transaction(async (tx) =>
            decideRelease(tx as any, id, user.email, {
                decision: String(req.body?.decision || '') as any,
                release_reference: req.body?.release_reference || null,
                comment: req.body?.comment || null,
            })
        );
        await logAudit(user.email, `memo_${req.body.decision === 'refuse' ? 'release_refused' : 'released'}`, 'memos', id, null,
            { release_reference: req.body?.release_reference || null, comment: req.body?.comment || null });
        if (result.newStatus === 'released') {
            // Non bloquant : le décaissement est acquis ; sinon le PDF sera archivé à la première demande.
            try { await archiveFinalPdf(id); } catch (err) { logger.error(`Memo #${id}: final PDF archiving failed:`, err as Error); }
        }
        await notifyMemoEvent(req.body.decision === 'refuse' ? 'refused' : 'released', id, user.email, { comment: req.body?.comment || null });
        return res.json({ success: true, id, status: result.newStatus });
    } catch (err) {
        return fail(res, err, 'PATCH /memos/:id/release');
    }
});

// PATCH /api/memos/:id/reinstruct — { comment } : le niveau approbateur ré-instruit la finance
router.patch('/:id/reinstruct', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const id = parseId(req.params.id);
        await db.transaction(async (tx) => reinstructRelease(tx as any, id, user.email, req.body?.comment || null));
        await logAudit(user.email, 'memo_release_reopened', 'memos', id, null, { comment: req.body?.comment || null });
        await notifyMemoEvent('reinstructed', id, user.email, { comment: req.body?.comment || null });
        return res.json({ success: true, id, status: 'approved' });
    } catch (err) {
        return fail(res, err, 'PATCH /memos/:id/reinstruct');
    }
});

// PATCH /api/memos/:id/withdraw — { reason? }
router.patch('/:id/withdraw', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const id = parseId(req.params.id);
        await db.transaction(async (tx) => withdrawMemo(tx as any, id, user.email, req.body?.reason || null));
        await logAudit(user.email, 'memo_withdrawn', 'memos', id, null, { reason: req.body?.reason || null });
        await notifyMemoEvent('withdrawn', id, user.email, { comment: req.body?.reason || null });
        return res.json({ success: true, id, status: 'withdrawn' });
    } catch (err) {
        return fail(res, err, 'PATCH /memos/:id/withdraw');
    }
});

export default router;
