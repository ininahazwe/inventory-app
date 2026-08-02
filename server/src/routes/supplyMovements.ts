// routes/supplyMovements.ts
// Ledger de stock fournitures (append-only).
// qty signée: + entrée (purchase/return/adjustment+), − sortie (issue/adjustment−)
import { Router, Request, Response } from 'express';
import { db } from '../database/connection';
import { logger } from '../middleware/logger';
import { requireAuth } from '../middleware/auth';
import { logAudit } from './audit';
import { todayDateString } from '../utils/dateHelpers';

const router = Router();

// ─── Helper réutilisé par les autres routes (supplies, supplyAssignments) ───
// executor: passer `tx` (depuis db.transaction) pour que l'écriture du ledger
// fasse partie de la même transaction que l'action principale. Si ça échoue,
// ça throw et fait rollback tout le reste — le ledger ne doit jamais désynchroniser
// silencieusement de l'état réel du stock.
type Executor = { execute: (sql: string, values?: any[]) => Promise<any> };

export async function recordMovement(
    params: {
        supply_id: number;
        type: 'purchase' | 'issue' | 'return' | 'adjustment';
        qty: number;                 // signée
        movement_date: string;       // YYYY-MM-DD
        ref_type?: 'supply' | 'supply_assignment' | null;
        ref_id?: number | null;
        notes?: string | null;
        created_by?: string | null;
    },
    executor: Executor = db
): Promise<void> {
    await executor.execute(
        `INSERT INTO supply_movements (supply_id, type, qty, movement_date, ref_type, ref_id, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            params.supply_id,
            params.type,
            params.qty,
            params.movement_date,
            params.ref_type || null,
            params.ref_id || null,
            params.notes || null,
            params.created_by || null,
        ]
    );
}

export async function deleteMovementsByRef(
    refType: string,
    refId: number,
    executor: Executor = db
): Promise<void> {
    await executor.execute(
        'DELETE FROM supply_movements WHERE ref_type = ? AND ref_id = ?',
        [refType, refId]
    );
}

// ─── GET /api/supply-movements - liste filtrable ────────────────────────────
// Filtres: supply_id, type, from (YYYY-MM-DD), to (YYYY-MM-DD)
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

        // created_by peut contenir un uid (backfill) ou un email (runtime): on résout en email
        const [rows] = await db.execute(
            `SELECT m.id, m.supply_id, m.type, m.qty, m.movement_date, m.ref_type, m.ref_id,
                    m.notes, m.created_at,
                    COALESCE(u.email, m.created_by) AS created_by,
                    s.name AS supply_name, c.name AS category_name
             FROM supply_movements m
                      JOIN supplies s ON m.supply_id = s.id
                      LEFT JOIN categories c ON s.category_id = c.id
                      LEFT JOIN users u ON m.created_by = u.id
                 ${whereClause}
             ORDER BY m.movement_date DESC, m.id DESC
             LIMIT 500`,
            params
        );

        return res.json(rows || []);
    } catch (err) {
        logger.error('GET /supply-movements error:', err as Error);
        return res.status(500).json({ error: 'Failed to fetch movements' });
    }
});

// ─── GET /api/supply-movements/stock?at=YYYY-MM-DD ──────────────────────────
// État du stock par fourniture à l'instant t (défaut: aujourd'hui)
router.get('/stock', requireAuth, async (req: Request, res: Response) => {
    try {
        const at = (req.query.at as string) || todayDateString();
        const lowOnly = req.query.low_stock === '1' || req.query.low_stock === 'true';

        const [rows] = await db.execute(
            `SELECT s.id AS supply_id, s.name, s.brand, c.name AS category_name,
                    s.low_stock_threshold,
                    COALESCE(SUM(CASE WHEN m.qty > 0 THEN m.qty ELSE 0 END), 0) AS total_in,
                    COALESCE(SUM(CASE WHEN m.qty < 0 THEN -m.qty ELSE 0 END), 0) AS total_out,
                    COALESCE(SUM(m.qty), 0) AS stock
             FROM supplies s
                      LEFT JOIN supply_movements m ON m.supply_id = s.id AND m.movement_date <= ?
                      LEFT JOIN categories c ON s.category_id = c.id
             GROUP BY s.id, s.name, s.brand, c.name, s.low_stock_threshold
             ORDER BY s.name ASC`,
            [at]
        );

        // ✅ is_low: seuil configuré ET stock courant <= seuil (pas d'alerte si seuil NULL)
        let stock = (rows as any[]).map(r => ({
            ...r,
            is_low: r.low_stock_threshold !== null && Number(r.stock) <= Number(r.low_stock_threshold),
        }));

        if (lowOnly) {
            stock = stock.filter(r => r.is_low);
        }

        return res.json({ at, stock });
    } catch (err) {
        logger.error('GET /supply-movements/stock error:', err as Error);
        return res.status(500).json({ error: 'Failed to compute stock' });
    }
});

// ─── GET /api/supply-movements/summary?from&to ──────────────────────────────
// Entrées / sorties de la période + stock fin de période, par catégorie
router.get('/summary', requireAuth, async (req: Request, res: Response) => {
    try {
        const from = (req.query.from as string) || '1970-01-01';
        const to = (req.query.to as string) || todayDateString();

        const [rows] = await db.execute(
            `SELECT COALESCE(c.name, 'No category') AS category_name,
                    COALESCE(SUM(CASE WHEN m.movement_date BETWEEN ? AND ? AND m.type = 'purchase' THEN m.qty ELSE 0 END), 0) AS period_purchased,
                    COALESCE(SUM(CASE WHEN m.movement_date BETWEEN ? AND ? AND m.type = 'issue' THEN -m.qty ELSE 0 END), 0) AS period_issued,
                    COALESCE(SUM(CASE WHEN m.movement_date BETWEEN ? AND ? AND m.type = 'return' THEN m.qty ELSE 0 END), 0) AS period_returned,
                    COALESCE(SUM(CASE WHEN m.movement_date BETWEEN ? AND ? AND m.type = 'adjustment' THEN m.qty ELSE 0 END), 0) AS period_adjusted,
                    COALESCE(SUM(CASE WHEN m.movement_date <= ? THEN m.qty ELSE 0 END), 0) AS stock_at_end
             FROM supply_movements m
                      JOIN supplies s ON m.supply_id = s.id
                      LEFT JOIN categories c ON s.category_id = c.id
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
// Seul type saisi à la main: adjustment (perte, casse, correction d'inventaire)
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

        const [supplyCheck] = await db.execute('SELECT id, name FROM supplies WHERE id = ?', [supply_id]);
        if (!(supplyCheck as any[]).length) {
            return res.status(404).json({ error: 'Supply not found' });
        }

        // Un ajustement négatif ne peut pas rendre le stock négatif
        if (qtyNum < 0) {
            const [stockResult] = await db.execute(
                'SELECT COALESCE(SUM(qty), 0) AS stock FROM supply_movements WHERE supply_id = ?',
                [supply_id]
            );
            const currentStock = Number((stockResult as any[])[0]?.stock || 0);
            if (currentStock + qtyNum < 0) {
                return res.status(400).json({ error: `Stock would become negative (current: ${currentStock})` });
            }
        }

        const cleanDate = movement_date.includes('T') ? movement_date.split('T')[0] : movement_date;

        const [result] = await db.execute(
            `INSERT INTO supply_movements (supply_id, type, qty, movement_date, notes, created_by)
             VALUES (?, 'adjustment', ?, ?, ?, ?)`,
            [supply_id, qtyNum, cleanDate, notes || null, user.email]
        );

        const movementId = (result as any).insertId;
        await logAudit(user.email, 'supply_adjustment', 'supply_movements', movementId, null, {
            supply_id, qty: qtyNum, movement_date: cleanDate, notes
        });

        logger.info(`Supply adjustment #${movementId}: supply ${supply_id}, qty ${qtyNum}`, 'SUPPLY_MOVEMENTS');
        return res.status(201).json({ id: movementId, supply_id, type: 'adjustment', qty: qtyNum, movement_date: cleanDate, notes });
    } catch (err) {
        logger.error('POST /supply-movements error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

export default router;
