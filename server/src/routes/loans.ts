// server/src/routes/loans.ts
// Module « prêts de matériel » — REST au-dessus de services/loanService.ts.
// Les routes ne font que : valider l'entrée, ouvrir une transaction, appeler le
// service, journaliser dans audit_log, notifier par mail (jamais bloquant).
// Toute la logique d'états et de disponibilité vit dans le service.
import { Router, Request, Response } from 'express';
import { db } from '../database/connection';
import { logger } from '../middleware/logger';
import { requireAuth } from '../middleware/auth';
import { logAudit } from './audit';
import { AppException, ConflictException } from '../exceptions';
import { todayDateString, calendarDaysLate } from '../utils/dateHelpers';
import {
    createLoanRequest,
    decideLoan,
    cancelLoan,
    checkoutLoan,
    checkinLoan,
    extendLoan,
    assertAssetAvailable,
    type ConditionIn,
    type ConditionOut,
} from '../services/loanService';
import {
    sendEmail,
    getLoanRequestedAdminEmail,
    getLoanDecisionEmail,
    getLoanOverdueReminderEmail,
    getLoanReturnedEmail,
    getLoanPickupReminderEmail,
    getLoanAutoCancelledEmail,
} from '../services/gmailService';

const router = Router();

const FRONTEND_URL = process.env.FRONTEND_URL || '';
const loanUrl = (id: number) => `${FRONTEND_URL}/loans/${id}`;

const requireAdmin = (req: Request, res: Response, next: Function) => {
    const user = (req as any).user;
    if (!user || (user.role !== 'super_admin' && user.role !== 'admin')) {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
};

const isAdmin = (user: any) => user && (user.role === 'admin' || user.role === 'super_admin');

// Colonnes renvoyées par toutes les lectures : le statut `overdue` n'est PAS stocké,
// il est dérivé de due_date à chaque lecture — un seul endroit où il se calcule.
const LOAN_SELECT = `
    SELECT l.*,
           a.label  AS asset_label,
           a.serial_no AS asset_serial_no,
           a.status AS asset_status,
           c.name   AS asset_category,
           loc.name AS return_location_name,
           (l.status = 'checked_out' AND l.due_date < CURDATE()) AS is_overdue,
           DATEDIFF(CURDATE(), l.due_date) AS days_past_due
    FROM loans l
             LEFT JOIN assets a ON l.asset_id = a.id
             LEFT JOIN categories c ON a.category_id = c.id
             LEFT JOIN locations loc ON l.return_location_id = loc.id
`;

// Envoi d'email systématiquement non bloquant : un prêt enregistré ne doit jamais
// échouer parce que Gmail est indisponible (même règle que pour les incidents).
async function notify(payload: any, context: string): Promise<void> {
    try {
        await sendEmail(payload);
    } catch (err) {
        logger.error(`Loan notification failed (${context}):`, err as Error);
    }
}

async function adminEmails(): Promise<string[]> {
    const [rows] = await db.query(`SELECT email FROM users WHERE role IN ('admin','super_admin')`);
    return (rows as any[]).map(u => u.email).filter(Boolean);
}

// ═══════════════════════════════════════════════════════════════════════════
// ROUTES SPÉCIFIQUES — avant /:id, sinon Express attrape "availability" comme un id
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/loans/availability?asset_id=&start_date=&due_date=
// Interrogé par le formulaire de demande avant de poster : renvoie le conflit
// éventuel sans rien écrire, pour que l'utilisateur corrige ses dates.
router.get('/availability', requireAuth, async (req: Request, res: Response) => {
    try {
        const assetId = parseInt(String(req.query.asset_id || ''), 10);
        const startDate = String(req.query.start_date || '');
        const dueDate = String(req.query.due_date || '');
        if (!assetId || !startDate || !dueDate) {
            return res.status(400).json({ error: 'asset_id, start_date and due_date are required' });
        }

        try {
            await assertAssetAvailable(db as any, assetId, startDate, dueDate, null);
        } catch (err) {
            if (err instanceof ConflictException) {
                return res.json({ available: false, reason: err.message });
            }
            throw err;
        }

        // Les réservations à venir sont renvoyées pour affichage, pas pour blocage.
        const [upcoming] = await db.query(
            `SELECT id, status, start_date, due_date, borrower_email
             FROM loans
             WHERE asset_id = ? AND status IN ('requested','approved','checked_out') AND due_date >= CURDATE()
             ORDER BY start_date ASC LIMIT 10`,
            [assetId]
        );
        return res.json({ available: true, upcoming: upcoming || [] });
    } catch (err) {
        logger.error('GET /loans/availability error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

// GET /api/loans/stats - compteurs pour l'en-tête de l'écran Loans
router.get('/stats', requireAuth, async (req: Request, res: Response) => {
    try {
        const [rows] = await db.query(`
            SELECT
                SUM(status = 'requested')                                AS pending,
                SUM(status = 'approved')                                 AS approved,
                SUM(status = 'checked_out')                              AS out,
                SUM(status = 'checked_out' AND due_date < CURDATE())     AS overdue,
                SUM(status = 'checked_out' AND due_date = CURDATE())     AS due_today,
                SUM(status = 'returned')                                 AS returned
            FROM loans
        `);
        const r = (rows as any[])[0] || {};
        return res.json({
            pending: Number(r.pending || 0),
            approved: Number(r.approved || 0),
            out: Number(r.out || 0),
            overdue: Number(r.overdue || 0),
            due_today: Number(r.due_today || 0),
            returned: Number(r.returned || 0),
        });
    } catch (err) {
        logger.error('GET /loans/stats error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// LECTURES
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/loans?status=&asset_id=&borrower=&overdue=1&mine=1
router.get('/', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { status, asset_id, borrower, overdue, mine } = req.query;

        const where: string[] = [];
        const params: any[] = [];

        // Un utilisateur non-admin ne voit que ses propres prêts — même règle
        // que le filtre `mine`, mais imposée côté serveur.
        if (!isAdmin(user) || mine === '1') {
            where.push('(l.borrower_email = ? OR l.requested_by_email = ?)');
            params.push(user.email, user.email);
        }
        if (status) {
            const list = String(status).split(',').map(s => s.trim()).filter(Boolean);
            where.push(`l.status IN (${list.map(() => '?').join(',')})`);
            params.push(...list);
        }
        if (asset_id) { where.push('l.asset_id = ?'); params.push(parseInt(String(asset_id), 10)); }
        if (borrower) { where.push('l.borrower_email LIKE ?'); params.push(`%${borrower}%`); }
        if (overdue === '1') { where.push(`l.status = 'checked_out' AND l.due_date < CURDATE()`); }

        const [rows] = await db.query(
            `${LOAN_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
             ORDER BY FIELD(l.status,'checked_out','approved','requested','returned','rejected','cancelled'),
                      l.due_date ASC, l.id DESC`,
            params
        );
        return res.json(rows || []);
    } catch (err) {
        logger.error('GET /loans error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

// GET /api/loans/:id - le prêt + son journal complet (le cycle, de bout en bout)
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const [rows] = await db.query(`${LOAN_SELECT} WHERE l.id = ?`, [req.params.id]);
        const loan = (rows as any[])[0];
        if (!loan) return res.status(404).json({ error: 'Loan not found' });

        if (!isAdmin(user) && loan.borrower_email !== user.email && loan.requested_by_email !== user.email) {
            return res.status(403).json({ error: 'You can only view your own loans' });
        }

        const [events] = await db.query(
            `SELECT id, event_type, from_status, to_status, actor_email, event_at, payload, notes
             FROM loan_events WHERE loan_id = ? ORDER BY event_at ASC, id ASC`,
            [req.params.id]
        );
        return res.json({ ...loan, events: events || [] });
    } catch (err) {
        logger.error('GET /loans/:id error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. LA DEMANDE
// ═══════════════════════════════════════════════════════════════════════════

// POST /api/loans - { asset_id, start_date, due_date, purpose?, borrower_uid? }
router.post('/', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { asset_id, start_date, due_date, purpose, borrower_uid } = req.body;

        if (!asset_id || !start_date || !due_date) {
            return res.status(400).json({ error: 'asset_id, start_date and due_date are required' });
        }

        // Emprunter pour quelqu'un d'autre est réservé aux admins ; dans ce cas la
        // demande est approuvée d'emblée (c'est l'admin qui enregistre le prêt).
        let borrowerUid: string | null = String(user.uid ?? '') || null;
        let borrowerEmail: string = user.email;
        let autoApprove = false;

        if (borrower_uid && String(borrower_uid) !== String(user.uid)) {
            if (!isAdmin(user)) {
                return res.status(403).json({ error: 'Only an administrator can request a loan on behalf of someone else' });
            }
            const [uRows] = await db.query('SELECT id, email FROM users WHERE id = ? LIMIT 1', [borrower_uid]);
            const borrower = (uRows as any[])[0];
            if (!borrower) return res.status(404).json({ error: 'Borrower not found' });
            borrowerUid = borrower.id;
            borrowerEmail = borrower.email;
            autoApprove = true;
        }

        const { loanId, status } = await db.transaction(async (tx) =>
            createLoanRequest(tx as any, {
                asset_id: parseInt(String(asset_id), 10),
                borrower_uid: borrowerUid,
                borrower_email: borrowerEmail,
                start_date: String(start_date).slice(0, 10),
                due_date: String(due_date).slice(0, 10),
                purpose: purpose || null,
                requested_by_email: user.email,
                auto_approve: autoApprove,
            })
        );

        await logAudit(user.email, 'loan_requested', 'loans', loanId, null, { asset_id, start_date, due_date, status });

        const [assetRows] = await db.query('SELECT label FROM assets WHERE id = ?', [asset_id]);
        const assetLabel = (assetRows as any[])[0]?.label || `Asset #${asset_id}`;

        if (status === 'requested') {
            const admins = await adminEmails();
            if (admins.length) {
                await notify(
                    getLoanRequestedAdminEmail(admins, assetLabel, borrowerEmail, String(start_date).slice(0, 10), String(due_date).slice(0, 10), purpose || null, loanUrl(loanId)),
                    `request #${loanId}`
                );
            }
        }

        logger.info(`Created loan #${loanId} (${status}) for asset ${asset_id}`, 'LOANS');
        return res.status(201).json({ id: loanId, status, asset_id, borrower_email: borrowerEmail, start_date, due_date });
    } catch (err) {
        if (err instanceof AppException) return res.status(err.statusCode).json({ error: err.message });
        logger.error('POST /loans error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. DÉCISION ET ANNULATION
// ═══════════════════════════════════════════════════════════════════════════

// PATCH /api/loans/:id/decision - { decision: 'approved'|'rejected', notes? }
router.patch('/:id/decision', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const loanId = parseInt(String(req.params.id), 10);
        const { decision, notes } = req.body;

        if (decision !== 'approved' && decision !== 'rejected') {
            return res.status(400).json({ error: "decision must be 'approved' or 'rejected'" });
        }

        const loan = await db.transaction(async (tx) =>
            decideLoan(tx as any, loanId, decision, user.email, notes || null)
        );

        await logAudit(user.email, `loan_${decision}`, 'loans', loanId, null, { notes: notes || null });

        const [assetRows] = await db.query('SELECT label FROM assets WHERE id = ?', [loan.asset_id]);
        const assetLabel = (assetRows as any[])[0]?.label || `Asset #${loan.asset_id}`;
        await notify(
            getLoanDecisionEmail(loan.borrower_email, assetLabel, decision, String(loan.start_date).slice(0, 10), String(loan.due_date).slice(0, 10), notes || null, loanUrl(loanId)),
            `decision #${loanId}`
        );

        logger.info(`Loan #${loanId} ${decision} by ${user.email}`, 'LOANS');
        return res.json({ success: true, id: loanId, status: decision });
    } catch (err) {
        if (err instanceof AppException) return res.status(err.statusCode).json({ error: err.message });
        logger.error('PATCH /loans/:id/decision error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

// PATCH /api/loans/:id/cancel - l'emprunteur (avant la sortie) ou un admin
router.patch('/:id/cancel', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const loanId = parseInt(String(req.params.id), 10);
        const { reason } = req.body || {};

        const [rows] = await db.query('SELECT borrower_email, requested_by_email FROM loans WHERE id = ?', [loanId]);
        const existing = (rows as any[])[0];
        if (!existing) return res.status(404).json({ error: 'Loan not found' });
        if (!isAdmin(user) && existing.borrower_email !== user.email && existing.requested_by_email !== user.email) {
            return res.status(403).json({ error: 'You can only cancel your own loan requests' });
        }

        await db.transaction(async (tx) => cancelLoan(tx as any, loanId, user.email, reason || null));
        await logAudit(user.email, 'loan_cancelled', 'loans', loanId, null, { reason: reason || null });

        logger.info(`Loan #${loanId} cancelled by ${user.email}`, 'LOANS');
        return res.json({ success: true, id: loanId, status: 'cancelled' });
    } catch (err) {
        if (err instanceof AppException) return res.status(err.statusCode).json({ error: err.message });
        logger.error('PATCH /loans/:id/cancel error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. SORTIE / 4. PROLONGATION / 5. RETOUR
// ═══════════════════════════════════════════════════════════════════════════

// PATCH /api/loans/:id/checkout - { condition_out?, notes? }
router.patch('/:id/checkout', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const loanId = parseInt(String(req.params.id), 10);
        const { condition_out, notes } = req.body || {};

        if (condition_out && !['good', 'fair', 'damaged'].includes(condition_out)) {
            return res.status(400).json({ error: "condition_out must be 'good', 'fair' or 'damaged'" });
        }

        await db.transaction(async (tx) =>
            checkoutLoan(tx as any, loanId, user.email, {
                condition_out: (condition_out as ConditionOut) || 'good',
                notes: notes || null,
            })
        );

        await logAudit(user.email, 'loan_checked_out', 'loans', loanId, null, { condition_out: condition_out || 'good' });
        logger.info(`Loan #${loanId} checked out by ${user.email}`, 'LOANS');
        return res.json({ success: true, id: loanId, status: 'checked_out' });
    } catch (err) {
        if (err instanceof AppException) return res.status(err.statusCode).json({ error: err.message });
        logger.error('PATCH /loans/:id/checkout error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

// PATCH /api/loans/:id/extend - { due_date, reason? }
router.patch('/:id/extend', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const loanId = parseInt(String(req.params.id), 10);
        const { due_date, reason } = req.body || {};
        if (!due_date) return res.status(400).json({ error: 'due_date is required' });

        const loan = await db.transaction(async (tx) =>
            extendLoan(tx as any, loanId, user.email, String(due_date).slice(0, 10), reason || null)
        );

        await logAudit(user.email, 'loan_extended', 'loans', loanId, null, { due_date, reason: reason || null });
        logger.info(`Loan #${loanId} extended to ${due_date} by ${user.email}`, 'LOANS');
        return res.json({ success: true, id: loanId, due_date: loan.due_date, extended_count: loan.extended_count });
    } catch (err) {
        if (err instanceof AppException) return res.status(err.statusCode).json({ error: err.message });
        logger.error('PATCH /loans/:id/extend error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

// PATCH /api/loans/:id/checkin - { condition_in, return_location_id?, notes?, open_incident? }
router.patch('/:id/checkin', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const loanId = parseInt(String(req.params.id), 10);
        const { condition_in, return_location_id, notes, open_incident } = req.body || {};

        if (!condition_in) return res.status(400).json({ error: 'condition_in is required' });

        const { loan, incidentId, assetStatus } = await db.transaction(async (tx) =>
            checkinLoan(tx as any, loanId, user.email, {
                condition_in: condition_in as ConditionIn,
                return_location_id: return_location_id ? parseInt(String(return_location_id), 10) : null,
                notes: notes || null,
                // Un retour abîmé ou perdu ouvre un incident par défaut : c'est le
                // comportement attendu, l'appelant doit le désactiver explicitement.
                open_incident: open_incident !== false,
            })
        );

        await logAudit(user.email, 'loan_returned', 'loans', loanId, null, { condition_in, incidentId, assetStatus });

        const [assetRows] = await db.query('SELECT label FROM assets WHERE id = ?', [loan.asset_id]);
        const assetLabel = (assetRows as any[])[0]?.label || `Asset #${loan.asset_id}`;
        const daysLate = calendarDaysLate(loan.due_date);
        await notify(getLoanReturnedEmail(loan.borrower_email, assetLabel, condition_in, daysLate, loanUrl(loanId)), `return #${loanId}`);

        logger.info(`Loan #${loanId} returned (${condition_in}) — asset back to '${assetStatus}'`, 'LOANS');
        return res.json({ success: true, id: loanId, status: 'returned', incident_id: incidentId, asset_status: assetStatus });
    } catch (err) {
        if (err instanceof AppException) return res.status(err.statusCode).json({ error: err.message });
        logger.error('PATCH /loans/:id/checkin error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// RETARDS : relance quotidienne, appelée par le scheduler interne (src/scheduler.ts)
// Même garde-fou anti-spam que la relance SLA des incidents, mais réarmée chaque
// jour (`overdue_reminder_sent_at` < CURDATE()) : un retard qui dure doit continuer
// de remonter, là où un incident n'est relancé qu'une fois.
// ═══════════════════════════════════════════════════════════════════════════
export async function checkLoansOverdue(): Promise<{ overdue: number; notified: number }> {
    const [rows] = await db.query(
        `SELECT l.id, l.asset_id, l.borrower_email, l.due_date,
                DATEDIFF(CURDATE(), l.due_date) AS days_late,
                a.label AS asset_label
         FROM loans l
                  LEFT JOIN assets a ON l.asset_id = a.id
         WHERE l.status = 'checked_out'
           AND l.due_date < CURDATE()
           AND (l.overdue_reminder_sent_at IS NULL OR DATE(l.overdue_reminder_sent_at) < CURDATE())`
    );
    const overdue = rows as any[];
    if (overdue.length === 0) return { overdue: 0, notified: 0 };

    const admins = await adminEmails();

    let notified = 0;
    for (const loan of overdue) {
        try {
            const recipients = Array.from(new Set([loan.borrower_email, ...admins].filter(Boolean)));
            if (recipients.length === 0) continue;

            await sendEmail(getLoanOverdueReminderEmail(
                recipients,
                loan.asset_label || `Asset #${loan.asset_id}`,
                loan.borrower_email,
                String(loan.due_date).slice(0, 10),
                Number(loan.days_late),
                loanUrl(loan.id)
            ));
            await db.query('UPDATE loans SET overdue_reminder_sent_at = NOW() WHERE id = ?', [loan.id]);
            await db.query(
                `INSERT INTO loan_events (loan_id, event_type, from_status, to_status, actor_email, payload)
                 VALUES (?, 'overdue_reminder', 'checked_out', 'checked_out', 'system', ?)`,
                [loan.id, JSON.stringify({ days_late: Number(loan.days_late), sent_on: todayDateString() })]
            );
            notified++;
        } catch (err) {
            logger.error(`Overdue reminder failed for loan ${loan.id}:`, err as Error);
        }
    }

    logger.info(`Loan overdue check: ${overdue.length} overdue, ${notified} notified`, 'LOANS');
    return { overdue: overdue.length, notified };
}

// ═══════════════════════════════════════════════════════════════════════════
// NO-SHOW : prêts approuvés jamais retirés. Sans ce job, une réservation oubliée
// bloquerait l'asset indéfiniment (elle compte dans la détection de chevauchement).
//   1. start_date dépassée → relance unique (verrou pickup_reminder_sent_at) ;
//   2. start_date + LOAN_NOSHOW_GRACE_DAYS dépassée → annulation automatique,
//      acteur 'system', journalisée comme n'importe quelle annulation.
// L'annulation passe d'abord : un prêt déjà hors délai n'a plus à être relancé.
// ═══════════════════════════════════════════════════════════════════════════
export async function checkLoansNoShow(): Promise<{ reminded: number; cancelled: number }> {
    const graceDays = Math.max(1, parseInt(process.env.LOAN_NOSHOW_GRACE_DAYS || '3', 10) || 3);
    const admins = await adminEmails();

    // 1. Annulations
    const [expiredRows] = await db.query(
        `SELECT l.id, l.asset_id, l.borrower_email, l.start_date, a.label AS asset_label
         FROM loans l LEFT JOIN assets a ON l.asset_id = a.id
         WHERE l.status = 'approved' AND DATE_ADD(l.start_date, INTERVAL ? DAY) < CURDATE()`,
        [graceDays]
    );
    let cancelled = 0;
    for (const loan of expiredRows as any[]) {
        try {
            await db.transaction(async (tx) =>
                cancelLoan(tx as any, loan.id, 'system',
                    `Auto-cancelled: not picked up within ${graceDays} day(s) of the planned start date`,
                    { reason: 'no_show', grace_days: graceDays })
            );
            cancelled++;
            await notify(
                getLoanAutoCancelledEmail(
                    Array.from(new Set([loan.borrower_email, ...admins].filter(Boolean))),
                    loan.asset_label || `Asset #${loan.asset_id}`,
                    String(loan.start_date).slice(0, 10), graceDays, loanUrl(loan.id)
                ),
                `no-show cancel #${loan.id}`
            );
        } catch (err) {
            // Un prêt modifié entre-temps (ex. sorti) lève un conflit d'état : on passe.
            logger.error(`No-show cancel failed for loan ${loan.id}:`, err as Error);
        }
    }

    // 2. Relances
    const [dueRows] = await db.query(
        `SELECT l.id, l.asset_id, l.borrower_email, l.start_date,
                DATEDIFF(CURDATE(), l.start_date) AS days_since_start, a.label AS asset_label
         FROM loans l LEFT JOIN assets a ON l.asset_id = a.id
         WHERE l.status = 'approved' AND l.start_date < CURDATE()
           AND l.pickup_reminder_sent_at IS NULL
           AND DATE_ADD(l.start_date, INTERVAL ? DAY) >= CURDATE()`,
        [graceDays]
    );
    let reminded = 0;
    for (const loan of dueRows as any[]) {
        try {
            await sendEmail(getLoanPickupReminderEmail(
                Array.from(new Set([loan.borrower_email, ...admins].filter(Boolean))),
                loan.asset_label || `Asset #${loan.asset_id}`,
                loan.borrower_email,
                String(loan.start_date).slice(0, 10),
                Math.max(1, graceDays - Number(loan.days_since_start) + 1),
                loanUrl(loan.id)
            ));
            await db.query('UPDATE loans SET pickup_reminder_sent_at = NOW() WHERE id = ?', [loan.id]);
            await db.query(
                `INSERT INTO loan_events (loan_id, event_type, from_status, to_status, actor_email, payload)
                 VALUES (?, 'pickup_reminder', 'approved', 'approved', 'system', ?)`,
                [loan.id, JSON.stringify({ days_since_start: Number(loan.days_since_start), grace_days: graceDays })]
            );
            reminded++;
        } catch (err) {
            logger.error(`Pickup reminder failed for loan ${loan.id}:`, err as Error);
        }
    }

    logger.info(`Loan no-show check: ${reminded} reminded, ${cancelled} cancelled`, 'LOANS');
    return { reminded, cancelled };
}

export default router;
