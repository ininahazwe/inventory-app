// server/src/routes/supplyItems.ts
// Nouvelles routes (Phase 3) : lecture du référentiel d'articles et de leur
// stock courant, calculé depuis le ledger (v_supply_stock), jamais stocké.
import { Router, Request, Response } from 'express';
import { db } from '../database/connection';
import { logger } from '../middleware/logger';
import { requireAuth } from '../middleware/auth';
import { logAudit } from './audit';

const router = Router();

// POST /api/supply-items - créer un nouvel article (référentiel, pas un achat).
// Nécessaire pour logger l'achat d'un produit qui n'existe pas encore dans le
// catalogue (voir la restriction stricte de POST /api/supplies sur le nom).
router.post('/', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { name, category_id, base_unit, reorder_point, target_level, is_batch_tracked } = req.body;

        if (!name || !String(name).trim()) {
            return res.status(400).json({ error: 'name is required' });
        }
        const trimmedName = String(name).trim();

        const [existing] = await db.execute(`SELECT id FROM supply_items WHERE LOWER(name) = LOWER(?)`, [trimmedName]);
        if ((existing as any[]).length) {
            return res.status(400).json({ error: `An item named "${trimmedName}" already exists.` });
        }

        let validatedCategoryId: number | null = null;
        if (category_id) {
            const [catResult] = await db.execute(`SELECT id FROM categories WHERE id = ? AND type = 'supply'`, [category_id]);
            if (!(catResult as any[]).length) {
                return res.status(400).json({ error: 'Invalid or non-supply category' });
            }
            validatedCategoryId = category_id;
        }

        const cleanNonNegativeInt = (value: any, field: string): number | null => {
            if (value === undefined || value === null || value === '') return null;
            const n = parseInt(String(value), 10);
            if (!Number.isInteger(n) || n < 0) {
                throw new Error(`${field} must be a non-negative integer`);
            }
            return n;
        };

        let cleanReorder: number | null;
        let cleanTarget: number | null;
        try {
            cleanReorder = cleanNonNegativeInt(reorder_point, 'reorder_point');
            cleanTarget = cleanNonNegativeInt(target_level, 'target_level');
        } catch (validationErr) {
            return res.status(400).json({ error: (validationErr as Error).message });
        }

        // code = slug(name), déduplication en ajoutant -2, -3… en cas de collision
        // (même convention que la table de correspondance de la Phase 1).
        const baseSlug = trimmedName
            .toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'item';
        let code = baseSlug;
        let suffix = 2;
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const [codeRows] = await db.execute(`SELECT id FROM supply_items WHERE code = ?`, [code]);
            if (!(codeRows as any[]).length) break;
            code = `${baseSlug}-${suffix}`;
            suffix++;
        }

        const [result] = await db.execute(
            `INSERT INTO supply_items (code, name, category_id, base_unit, is_batch_tracked, reorder_point, target_level, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
            [
                code,
                trimmedName,
                validatedCategoryId,
                base_unit && String(base_unit).trim() ? String(base_unit).trim() : 'unit',
                is_batch_tracked ? 1 : 0,
                cleanReorder,
                cleanTarget,
            ]
        );
        const itemId = (result as any).insertId;

        const [rows] = await db.execute(
            `SELECT i.id, i.code, i.name, i.category_id, c.name AS category_name,
                    i.base_unit, i.is_batch_tracked, i.reorder_point, i.target_level, i.is_active
             FROM supply_items i
             LEFT JOIN categories c ON c.id = i.category_id
             WHERE i.id = ?`,
            [itemId]
        );
        const item = (rows as any[])[0];

        await logAudit(user.email, 'supply_item_created', 'supply_items', itemId, null, item);

        logger.info(`Created supply item: ${trimmedName} (${code})`, 'SUPPLY_ITEMS');
        return res.status(201).json(item);
    } catch (err) {
        logger.error('POST /supply-items error:', err as Error);
        return res.status(500).json({ error: 'Failed to create supply item' });
    }
});


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
