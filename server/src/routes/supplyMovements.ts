// server/src/routes/supplyMovements.ts
//
// Phase 3 — ADAPTATEUR. Le ledger lui-même (supply_stock_ledger) EST
// maintenant la source de vérité ; ce fichier ne fait plus qu'un UNION en
// lecture dessus, reformaté dans l'ancien vocabulaire (type: purchase/issue/
// return/adjustment) pour que SuppliesList.tsx continue de fonctionner sans
// changement. Les anciens helpers recordMovement()/deleteMovementsByRef()
// ont disparu : supplies.ts et supplyAssignments.ts écrivent désormais
// directement via supplyLedger.ts, jamais via ce fichier.
//
// `supply_id` dans la liste reste, pour les lignes historiques, l'ancien id
// de lot (repris depuis les tables legacy via legacy_supply_id /
// legacy_assignment_id / legacy_movement_id) ; pour toute nouvelle activité
// (réceptions exceptées, qui ont toujours un lot), c'est désormais l'id de
// l'article — il n'y a plus de lot à référencer pour une sortie ou un
// ajustement dans le nouveau modèle (stock mutualisé par article).
//
// `created_by` : approximation acceptée pendant la transition — faute d'une
// colonne "créateur" distincte sur les nouveaux documents, on affiche le
// destinataire/receveur du document. L'auteur réel de l'action reste tracé
// fidèlement dans audit_log (logAudit), qui n'est pas concerné par ce gap.
import { Router, Request, Response } from 'express';
import { db } from '../database/connection';
import { logger } from '../middleware/logger';
import { requireAuth } from '../middleware/auth';
import { logAudit } from './audit';
import { postAdjustment } from '../services/supplyLedger';
import { AppException } from '../exceptions';

const router = Router();

const UNION_SELECT = `
    SELECT sl.id, COALESCE(rl.legacy_supply_id, rl.id) AS supply_id, 'purchase' AS type,
           sl.quantity_base AS qty, sl.movement_date, 'supply' AS ref_type,
           COALESCE(rl.legacy_supply_id, rl.id) AS ref_id,
           CONCAT('Purchase: ', i.name) AS notes, sl.created_at,
           ru.email AS created_by, i.name AS supply_name, c.name AS category_name
    FROM supply_stock_ledger sl
             JOIN supply_receipt_lines rl ON rl.id = sl.source_line_id AND sl.source_table = 'supply_receipt_lines'
             JOIN supply_receipts r ON r.id = rl.receipt_id
             JOIN supply_items i ON i.id = sl.item_id
             LEFT JOIN categories c ON c.id = i.category_id
             LEFT JOIN users ru ON ru.id = CAST(r.received_by_uid AS UNSIGNED)
    WHERE sl.reason = 'receipt'

    UNION ALL

    SELECT sl.id, COALESCE(sa_old.supply_id, il.item_id) AS supply_id, 'issue' AS type,
           sl.quantity_base AS qty, sl.movement_date, 'supply_assignment' AS ref_type,
           COALESCE(il.legacy_assignment_id, il.id) AS ref_id,
           CONCAT('Issued to ', COALESCE(ru.email, CONCAT('location #', q.destination_location_id))) AS notes, sl.created_at,
           ru.email AS created_by, i.name AS supply_name, c.name AS category_name
    FROM supply_stock_ledger sl
             JOIN supply_issue_lines il ON il.id = sl.source_line_id AND sl.source_table = 'supply_issue_lines'
             JOIN supply_issues q ON q.id = il.issue_id
             JOIN supply_items i ON i.id = sl.item_id
             LEFT JOIN categories c ON c.id = i.category_id
             LEFT JOIN supply_assignments sa_old ON sa_old.id = il.legacy_assignment_id
             LEFT JOIN users ru ON ru.id = CAST(q.recipient_uid AS UNSIGNED)
    WHERE sl.reason = 'issue'

    UNION ALL

    SELECT sl.id, COALESCE(sa_old.supply_id, il.item_id) AS supply_id, 'return' AS type,
           sl.quantity_base AS qty, sl.movement_date, 'supply_assignment' AS ref_type,
           COALESCE(il.legacy_assignment_id, il.id) AS ref_id,
           CONCAT('Returned by ', COALESCE(ru.email, 'unknown')) AS notes, sl.created_at,
           ru.email AS created_by, i.name AS supply_name, c.name AS category_name
    FROM supply_stock_ledger sl
             JOIN supply_issue_lines il ON il.id = sl.source_line_id AND sl.source_table = 'supply_issue_lines'
             JOIN supply_issues q ON q.id = il.issue_id
             JOIN supply_items i ON i.id = sl.item_id
             LEFT JOIN categories c ON c.id = i.category_id
             LEFT JOIN supply_assignments sa_old ON sa_old.id = il.legacy_assignment_id
             LEFT JOIN users ru ON ru.id = CAST(q.recipient_uid AS UNSIGNED)
    WHERE sl.reason = 'return'

    UNION ALL

    SELECT sl.id, COALESCE(mv_old.supply_id, al.item_id) AS supply_id, 'adjustment' AS type,
           sl.quantity_base AS qty, sl.movement_date, NULL AS ref_type, NULL AS ref_id,
           al.notes AS notes, sl.created_at,
           ru.email AS created_by, i.name AS supply_name, c.name AS category_name
    FROM supply_stock_ledger sl
             JOIN supply_adjustment_lines al ON al.id = sl.source_line_id AND sl.source_table = 'supply_adjustment_lines'
             JOIN supply_adjustments adj ON adj.id = al.adjustment_id
             JOIN supply_items i ON i.id = sl.item_id
             LEFT JOIN categories c ON c.id = i.category_id
             LEFT JOIN supply_movements mv_old ON mv_old.id = al.legacy_movement_id
             LEFT JOIN users ru ON ru.id = CAST(adj.recorded_by_uid AS UNSIGNED)
    WHERE sl.reason IN ('count_variance', 'write_off')
`;

// ─── GET /api/supply-movements - liste filtrable ────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response) => {
    try {
        const { supply_id, type, from, to } = req.query;
        const where: string[] = [];
        const params: any[] = [];

        if (supply_id) { where.push('m.supply_id = ?'); params.push(parseInt(supply_id as string)); }
        if (type) { where.push('m.type = ?'); params.push(type); }
        if (from) { where.push('m.movement_date >= ?'); params.push(from); }
        if (to) { where.push('m.movement_date <= ?'); params.push(to); }

        const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

        const [rows] = await db.execute(
            `SELECT m.* FROM (${UNION_SELECT}) m ${whereClause} ORDER BY m.movement_date DESC, m.id DESC LIMIT 500`,
            params
        );

        return res.json(rows || []);
    } catch (err) {
        logger.error('GET /supply-movements error:', err as Error);
        return res.status(500).json({ error: 'Failed to fetch movements' });
    }
});

// ─── GET /api/supply-movements/stock?at=YYYY-MM-DD ──────────────────────────
// Non utilisé par le front actuel (vérifié) : simplifié au niveau article
// (le modèle cible mutualise le stock par article, plus par lot — voir
// GET /api/supply-items pour l'équivalent qui remplace cet endpoint en Phase 4).
router.get('/stock', requireAuth, async (req: Request, res: Response) => {
    try {
        const lowOnly = req.query.low_stock === '1' || req.query.low_stock === 'true';

        const [rows] = await db.execute(
            `SELECT i.id AS supply_id, i.name, NULL AS brand, c.name AS category_name,
                    i.reorder_point AS low_stock_threshold,
                    COALESCE(SUM(CASE WHEN sl.quantity_base > 0 THEN sl.quantity_base ELSE 0 END), 0) AS total_in,
                    COALESCE(SUM(CASE WHEN sl.quantity_base < 0 THEN -sl.quantity_base ELSE 0 END), 0) AS total_out,
                    COALESCE(SUM(sl.quantity_base), 0) AS stock
             FROM supply_items i
                      LEFT JOIN supply_stock_ledger sl ON sl.item_id = i.id
                      LEFT JOIN categories c ON c.id = i.category_id
             GROUP BY i.id, i.name, c.name, i.reorder_point
             ORDER BY i.name ASC`
        );

        let stock = (rows as any[]).map(r => ({
            ...r,
            is_low: r.low_stock_threshold !== null && Number(r.stock) <= Number(r.low_stock_threshold),
        }));

        if (lowOnly) {
            stock = stock.filter(r => r.is_low);
        }

        return res.json({ at: req.query.at || null, stock });
    } catch (err) {
        logger.error('GET /supply-movements/stock error:', err as Error);
        return res.status(500).json({ error: 'Failed to compute stock' });
    }
});

// ─── GET /api/supply-movements/summary?from&to ──────────────────────────────
router.get('/summary', requireAuth, async (req: Request, res: Response) => {
    try {
        const from = (req.query.from as string) || '1970-01-01';
        const to = (req.query.to as string) || new Date().toISOString().split('T')[0];

        const [rows] = await db.execute(
            `SELECT COALESCE(c.name, 'No category') AS category_name,
                    COALESCE(SUM(CASE WHEN sl.movement_date BETWEEN ? AND ? AND sl.reason = 'receipt' THEN sl.quantity_base ELSE 0 END), 0) AS period_purchased,
                    COALESCE(SUM(CASE WHEN sl.movement_date BETWEEN ? AND ? AND sl.reason = 'issue' THEN -sl.quantity_base ELSE 0 END), 0) AS period_issued,
                    COALESCE(SUM(CASE WHEN sl.movement_date BETWEEN ? AND ? AND sl.reason = 'return' THEN sl.quantity_base ELSE 0 END), 0) AS period_returned,
                    COALESCE(SUM(CASE WHEN sl.movement_date BETWEEN ? AND ? AND sl.reason = 'count_variance' THEN sl.quantity_base ELSE 0 END), 0) AS period_adjusted,
                    COALESCE(SUM(CASE WHEN sl.movement_date <= ? THEN sl.quantity_base ELSE 0 END), 0) AS stock_at_end
             FROM supply_stock_ledger sl
                      JOIN supply_items i ON i.id = sl.item_id
                      LEFT JOIN categories c ON c.id = i.category_id
             GROUP BY c.name
             ORDER BY category_name ASC`,
            [from, to, from, to, from, to, from, to, to]
        );

        return res.json({ from, to, categories: rows || [] });
    } catch (err) {
        logger.error('GET /supply-movements/summary error:', err as Error);
        return res.status(500).json({ error: 'Failed to compute summary' });
    }
});

// ─── POST /api/supply-movements - ajustement manuel (admin) ─────────────────
// Ancien formulaire : une quantité signée (+ entrée / - sortie), pas un
// comptage. Converti en écart pour supplyLedger.postAdjustment() : le système
// recalcule le stock courant dans la même transaction et pose la ligne du
// ledger — jamais un UPDATE direct.
router.post('/', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        if (user.role !== 'admin' && user.role !== 'super_admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const { supply_id, qty, movement_date, notes } = req.body;

        if (!supply_id || qty === undefined || qty === null || !movement_date) {
            return res.status(400).json({ error: 'supply_id, qty and movement_date are required' });
        }

        const qtyNum = Number(qty);
        if (!Number.isInteger(qtyNum) || qtyNum === 0) {
            return res.status(400).json({ error: 'qty must be a non-zero integer (+ in / - out)' });
        }

        const [lotResult] = await db.execute(
            `SELECT rl.item_id, i.name FROM supply_receipt_lines rl JOIN supply_items i ON i.id = rl.item_id
             WHERE COALESCE(rl.legacy_supply_id, rl.id) = ?`,
            [supply_id]
        );
        if (!(lotResult as any[]).length) {
            return res.status(404).json({ error: 'Supply not found' });
        }
        const itemId = (lotResult as any[])[0].item_id;

        const [stockRows] = await db.execute(
            `SELECT COALESCE(SUM(quantity_base), 0) AS stock FROM supply_stock_ledger WHERE item_id = ?`,
            [itemId]
        );
        const currentStock = Number((stockRows as any[])[0]?.stock || 0);
        if (currentStock + qtyNum < 0) {
            return res.status(400).json({ error: `Stock would become negative (current: ${currentStock})` });
        }

        const cleanDate = movement_date.includes('T') ? movement_date.split('T')[0] : movement_date;
        const countedQuantity = currentStock + qtyNum;

        const { lineIds } = await db.transaction(async (tx) => {
            return postAdjustment({
                adjustment_date: cleanDate,
                source: 'event',
                reason: qtyNum < 0 ? 'loss' : 'found',
                recorded_by_uid: user.uid !== undefined ? String(user.uid) : null,
                lines: [{ item_id: itemId, counted_quantity: countedQuantity, notes: notes || null }],
            }, tx);
        });

        const movementId = lineIds[0];
        await logAudit(user.email, 'supply_adjustment', 'supply_movements', movementId, null, {
            supply_id, qty: qtyNum, movement_date: cleanDate, notes,
        });

        logger.info(`Supply adjustment #${movementId}: supply ${supply_id}, qty ${qtyNum}`, 'SUPPLY_MOVEMENTS');
        return res.status(201).json({ id: movementId, supply_id, type: 'adjustment', qty: qtyNum, movement_date: cleanDate, notes });
    } catch (err) {
        if (err instanceof AppException) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        logger.error('POST /supply-movements error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

export default router;
