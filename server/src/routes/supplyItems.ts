// server/src/routes/supplyItems.ts
// Nouvelles routes (Phase 3) : lecture du référentiel d'articles et de leur
// stock courant, calculé depuis le ledger (v_supply_stock), jamais stocké.
import { Router, Request, Response } from 'express';
import { db } from '../database/connection';
import { logger } from '../middleware/logger';
import { requireAuth } from '../middleware/auth';

const router = Router();

// GET /api/supply-items - liste des articles avec leur stock courant
router.get('/', requireAuth, async (req: Request, res: Response) => {
    try {
        const { category_id, active } = req.query;
        const where: string[] = [];
        const params: any[] = [];

        if (category_id) {
            where.push('i.category_id = ?');
            params.push(parseInt(category_id as string));
        }
        if (active === '1' || active === 'true') {
            where.push('i.is_active = 1');
        }

        const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

        const [rows] = await db.execute(
            `SELECT i.id, i.code, i.name, i.category_id, c.name AS category_name,
                    i.base_unit, i.is_batch_tracked, i.reorder_point, i.target_level, i.is_active,
                    COALESCE(st.qty_on_hand, 0) AS qty_on_hand,
                    COALESCE(st.value_on_hand, 0) AS value_on_hand,
                    st.avg_unit_cost
             FROM supply_items i
                      LEFT JOIN categories c ON c.id = i.category_id
                      LEFT JOIN v_supply_stock st ON st.item_id = i.id
                 ${whereClause}
             ORDER BY i.name ASC`,
            params
        );

        return res.json(rows || []);
    } catch (err) {
        logger.error('GET /supply-items error:', err as Error);
        return res.status(500).json({ error: 'Failed to fetch supply items' });
    }
});

// GET /api/supply-items/:id/stock - détail du stock d'un article
router.get('/:id/stock', requireAuth, async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id as string, 10);

        const [itemRows] = await db.execute(
            `SELECT i.id, i.code, i.name, i.reorder_point, i.target_level
             FROM supply_items i WHERE i.id = ?`,
            [id]
        );
        if (!(itemRows as any[]).length) {
            return res.status(404).json({ error: 'Item not found' });
        }
        const item = (itemRows as any[])[0];

        const [stockRows] = await db.execute(
            `SELECT qty_on_hand, value_on_hand, avg_unit_cost FROM v_supply_stock WHERE item_id = ?`,
            [id]
        );
        const stock = (stockRows as any[])[0] || { qty_on_hand: 0, value_on_hand: 0, avg_unit_cost: null };

        const [coverRows] = await db.execute(
            `SELECT avg_daily_qty_out, cover_days FROM v_supply_cover WHERE item_id = ?`,
            [id]
        );
        const cover = (coverRows as any[])[0] || { avg_daily_qty_out: null, cover_days: null };

        return res.json({ ...item, ...stock, ...cover });
    } catch (err) {
        logger.error('GET /supply-items/:id/stock error:', err as Error);
        return res.status(500).json({ error: 'Failed to fetch item stock' });
    }
});

// GET /api/supply-items/:id/ledger - historique complet du ledger pour un article, paginé
router.get('/:id/ledger', requireAuth, async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id as string, 10);
        const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
        const perPage = Math.min(100, Math.max(1, parseInt((req.query.per_page as string) || '20', 10)));
        const offset = (page - 1) * perPage;

        const [itemRows] = await db.execute(`SELECT id FROM supply_items WHERE id = ?`, [id]);
        if (!(itemRows as any[]).length) {
            return res.status(404).json({ error: 'Item not found' });
        }

        const [countRows] = await db.execute(
            `SELECT COUNT(*) AS total FROM supply_stock_ledger WHERE item_id = ?`,
            [id]
        );
        const total = Number((countRows as any[])[0]?.total || 0);

        // "by" résolu selon le document source (en-tête réception / sortie / ajustement) —
        // le ledger lui-même ne porte pas cette info, par construction (voir invariant 3).
        const [rows] = await db.execute(
            `SELECT led.id, led.movement_date, led.reason, led.quantity_base, led.unit_cost_base, led.value,
                    led.location_id, loc.name AS location_name, led.batch_id,
                    led.source_table, led.source_line_id, led.reverses_id,
                    COALESCE(r.received_by_uid, iss.issued_by_uid, adj.recorded_by_uid) AS created_by_uid,
                    COALESCE(r.reference, iss.reference, NULL) AS document_reference
             FROM supply_stock_ledger led
             LEFT JOIN locations loc ON loc.id = led.location_id
             LEFT JOIN supply_receipt_lines rl ON led.source_table = 'supply_receipt_lines' AND rl.id = led.source_line_id
             LEFT JOIN supply_receipts r ON r.id = rl.receipt_id
             LEFT JOIN supply_issue_lines il ON led.source_table = 'supply_issue_lines' AND il.id = led.source_line_id
             LEFT JOIN supply_issues iss ON iss.id = il.issue_id
             LEFT JOIN supply_adjustment_lines al ON led.source_table = 'supply_adjustment_lines' AND al.id = led.source_line_id
             LEFT JOIN supply_adjustments adj ON adj.id = al.adjustment_id
             WHERE led.item_id = ?
             ORDER BY led.movement_date DESC, led.id DESC
             LIMIT ? OFFSET ?`,
            [id, perPage, offset]
        );

        return res.json({ entries: rows || [], total, page, per_page: perPage });
    } catch (err) {
        logger.error('GET /supply-items/:id/ledger error:', err as Error);
        return res.status(500).json({ error: 'Failed to fetch item ledger' });
    }
});

export default router;
