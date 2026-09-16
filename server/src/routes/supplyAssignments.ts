// server/src/routes/supplyAssignments.ts
//
// Phase 3 — ADAPTATEUR. Lit/écrit exclusivement via supply_issues /
// supply_issue_lines / supplyLedger.ts, renvoie le même contrat JSON qu'avant.
//
// Changement de fond, invisible pour ce formulaire mais réel : le stock
// n'est plus décrémenté par LOT (`supplies.id`) mais par ARTICLE — assigner
// depuis deux lots différents du même article partage désormais le même
// stock, au lieu d'être suivi séparément comme avant (c'est exactement le
// problème de fragmentation que ce chantier corrige). `supply_id` en entrée
// reste un id de lot (celui renvoyé par GET /api/supplies) : il est résolu
// vers l'article correspondant avant d'écrire dans le ledger.
//
// `status`/`returned_at` n'existent plus comme colonnes : ils sont recalculés
// à la lecture depuis les écritures reason='return' du ledger qui référencent
// (via reverses_id) la sortie d'origine. Un retour n'écrase jamais rien —
// c'est une écriture inverse (invariant 2).
import { Router, Request, Response } from 'express';
import { db } from '../database/connection';
import { logger } from '../middleware/logger';
import { requireAuth } from '../middleware/auth';
import { logAudit } from './audit';
import { postIssue, postReturn } from '../services/supplyLedger';
import { AppException, NotFoundException, BusinessException } from '../exceptions';
import { todayDateString } from '../utils/dateHelpers';

const router = Router();

const ROW_SELECT = `
    SELECT
        COALESCE(il.legacy_assignment_id, il.id) AS id,
        COALESCE(sa_old.supply_id, il.item_id) AS supply_id,
        i.name AS supply_name,
        COALESCE(sa_old.assignee_name, ru.email) AS assignee_name,
        COALESCE(sa_old.assignee_email, ru.email) AS assignee_email,
        COALESCE(sa_old.assigned_user_id, ru.id) AS assigned_user_id,
        q.destination_location_id AS location_id,
        l.name AS location_name,
        l.floor AS location_floor,
        il.quantity_base AS quantity_assigned,
        q.issue_date AS assigned_at,
        CASE WHEN COALESCE(ret.returned_qty, 0) >= il.quantity_base THEN 'returned' ELSE 'active' END AS status,
        ret.last_return_date AS returned_at,
        COALESCE(sa_old.assignee_email, ru.email) AS user_email,
        il.id AS _line_id,
        il.item_id AS _item_id,
        il.quantity_base AS _quantity_base,
        COALESCE(ret.returned_qty, 0) AS _returned_qty,
        orig.id AS _orig_ledger_id
    FROM supply_issue_lines il
             JOIN supply_issues q ON q.id = il.issue_id
             JOIN supply_items i ON i.id = il.item_id
             LEFT JOIN locations l ON l.id = q.destination_location_id
             LEFT JOIN supply_assignments sa_old ON sa_old.id = il.legacy_assignment_id
             LEFT JOIN users ru ON ru.id = CAST(q.recipient_uid AS UNSIGNED)
             LEFT JOIN supply_stock_ledger orig ON orig.source_table = 'supply_issue_lines' AND orig.source_line_id = il.id
             LEFT JOIN (
                 SELECT reverses_id, SUM(quantity_base) AS returned_qty, MAX(movement_date) AS last_return_date
                 FROM supply_stock_ledger WHERE reason = 'return' GROUP BY reverses_id
             ) ret ON ret.reverses_id = orig.id
`;

function stripInternal(row: any) {
    const { _line_id, _item_id, _quantity_base, _returned_qty, _orig_ledger_id, ...rest } = row;
    return rest;
}

// GET /api/supply-assignments - List with filtering
router.get('/', requireAuth, async (req: Request, res: Response) => {
    try {
        const { supply_id, status, location_id } = req.query;
        const having: string[] = [];
        const where: string[] = [];
        const params: any[] = [];

        if (supply_id) {
            where.push('COALESCE(sa_old.supply_id, il.item_id) = ?');
            params.push(parseInt(supply_id as string));
        }
        if (location_id) {
            where.push('q.destination_location_id = ?');
            params.push(parseInt(location_id as string));
        }
        if (status) {
            having.push('status = ?');
        }

        const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
        const havingClause = having.length ? 'HAVING ' + having.join(' AND ') : '';
        const havingParams = status ? [status] : [];

        const [rows] = await db.execute(
            `${ROW_SELECT} ${whereClause} ${havingClause} ORDER BY q.issue_date DESC, il.id DESC`,
            [...params, ...havingParams]
        );

        logger.info(`Fetched ${(rows as any[]).length} supply assignments`, 'SUPPLY_ASSIGNMENTS');
        return res.json((rows as any[]).map(stripInternal));
    } catch (err) {
        logger.error('GET /supply-assignments error:', err as Error);
        return res.status(500).json({ error: 'Failed to fetch supply assignments' });
    }
});

// GET /api/supply-assignments/:id - Get single assignment
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
    try {
        const id = parseInt(String(req.params.id), 10);
        const [rows] = await db.execute(`${ROW_SELECT} WHERE COALESCE(il.legacy_assignment_id, il.id) = ?`, [id]);

        if (!(rows as any[]).length) {
            return res.status(404).json({ error: 'Assignment not found' });
        }
        return res.json(stripInternal((rows as any[])[0]));
    } catch (err) {
        logger.error('GET /supply-assignments/:id error:', err as Error);
        return res.status(500).json({ error: 'Failed to fetch assignment' });
    }
});

// POST /api/supply-assignments - Issue stock from an existing purchase (lot) to a user and/or location
router.post('/', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { supply_id, assigned_user_id, location_id, quantity_assigned, assigned_at } = req.body;

        if (!supply_id || !quantity_assigned || !assigned_at) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        if (!assigned_user_id && !location_id) {
            return res.status(400).json({ error: 'assigned_user_id or location_id is required' });
        }

        const qtyRequested = Number(quantity_assigned);
        if (!Number.isInteger(qtyRequested) || qtyRequested < 1) {
            return res.status(400).json({ error: 'quantity_assigned must be a positive integer' });
        }

        if (assigned_user_id) {
            const [userResult] = await db.execute('SELECT id, email FROM users WHERE id = ?', [assigned_user_id]);
            if (!(userResult as any[]).length) {
                return res.status(404).json({ error: 'User not found' });
            }
        }
        if (location_id) {
            const [locationResult] = await db.execute('SELECT id FROM locations WHERE id = ?', [location_id]);
            if (!(locationResult as any[]).length) {
                return res.status(404).json({ error: 'Location not found' });
            }
        }

        const [lotResult] = await db.execute(
            `SELECT rl.item_id, i.name FROM supply_receipt_lines rl JOIN supply_items i ON i.id = rl.item_id
             WHERE COALESCE(rl.legacy_supply_id, rl.id) = ?`,
            [supply_id]
        );
        if (!(lotResult as any[]).length) {
            return res.status(404).json({ error: 'Supply not found' });
        }
        const { item_id: itemId, name: itemName } = (lotResult as any[])[0];

        const cleanDate = assigned_at.includes('T') ? assigned_at.split('T')[0] : assigned_at;

        const { issueId, lineIds } = await db.transaction(async (tx) => {
            return postIssue({
                issue_date: cleanDate,
                destination_location_id: location_id || null,
                recipient_uid: assigned_user_id ? String(assigned_user_id) : null,
                issued_by_uid: user.uid !== undefined ? String(user.uid) : null,
                lines: [{ item_id: itemId, quantity_base: qtyRequested }],
            }, tx);
        });

        const lineId = lineIds[0];
        const [rows] = await db.execute(`${ROW_SELECT} WHERE il.id = ?`, [lineId]);
        const assignment = stripInternal((rows as any[])[0]);

        await logAudit(user.email, 'supply_assigned', 'supply_assignments', assignment.id, null, assignment);

        logger.info(`Created supply assignment: ${itemName}`, 'SUPPLY_ASSIGNMENTS');
        return res.status(201).json(assignment);
    } catch (err) {
        if (err instanceof AppException) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        logger.error('POST /supply-assignments error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

// PATCH /api/supply-assignments/:id - Mark as returned (active -> returned only; matches prior behaviour)
router.patch('/:id', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const id = parseInt(String(req.params.id), 10);
        const { returned_at, status } = req.body;

        const [oldRows] = await db.execute(`${ROW_SELECT} WHERE COALESCE(il.legacy_assignment_id, il.id) = ?`, [id]);
        if (!(oldRows as any[]).length) {
            return res.status(404).json({ error: 'Assignment not found' });
        }
        const old = (oldRows as any[])[0];
        const oldAssignment = stripInternal(old);

        if (oldAssignment.status === 'active' && status === 'returned') {
            const returnDate = returned_at
                ? (returned_at.includes('T') ? returned_at.split('T')[0] : returned_at)
                : todayDateString();

            await db.transaction(async (tx) => {
                await postReturn({
                    issue_line_id: old._line_id,
                    quantity_base: old._quantity_base - old._returned_qty,
                    return_date: returnDate,
                }, tx);
            });
        }

        const [newRows] = await db.execute(`${ROW_SELECT} WHERE il.id = ?`, [old._line_id]);
        const newAssignment = stripInternal((newRows as any[])[0]);

        await logAudit(user.email, 'supply_assignment_updated', 'supply_assignments', id, oldAssignment, newAssignment);

        logger.info(`Updated supply assignment ${id}`, 'SUPPLY_ASSIGNMENTS');
        return res.json(newAssignment);
    } catch (err) {
        if (err instanceof AppException) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        logger.error('PATCH /supply-assignments/:id error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

// DELETE /api/supply-assignments/:id - Reverses the outstanding (non-returned) portion, then removes the line.
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const id = parseInt(String(req.params.id), 10);

        const [rows] = await db.execute(`${ROW_SELECT} WHERE COALESCE(il.legacy_assignment_id, il.id) = ?`, [id]);
        if (!(rows as any[]).length) {
            return res.status(404).json({ error: 'Assignment not found' });
        }
        const old = (rows as any[])[0];
        const oldAssignment = stripInternal(old);

        await db.transaction(async (tx) => {
            const outstanding = old._quantity_base - old._returned_qty;
            if (outstanding > 0) {
                const [ledgerRows] = await tx.execute(
                    `SELECT unit_cost_base, location_id FROM supply_stock_ledger WHERE id = ?`,
                    [old._orig_ledger_id]
                );
                const orig = (ledgerRows as any[])[0];
                await tx.execute(
                    `INSERT INTO supply_stock_ledger
                        (item_id, movement_date, reason, quantity_base, unit_cost_base, value, location_id, source_table, source_line_id)
                     VALUES (?, ?, 'issue', ?, ?, ?, ?, 'supply_issue_lines', ?)`,
                    [old._item_id, todayDateString(), outstanding, orig.unit_cost_base, Math.round(outstanding * orig.unit_cost_base * 100) / 100, orig.location_id, old._line_id]
                );
            }
            await tx.execute(`DELETE FROM supply_issue_lines WHERE id = ?`, [old._line_id]);
        });

        await logAudit(user.email, 'supply_assignment_deleted', 'supply_assignments', id, oldAssignment, null);

        logger.info(`Deleted supply assignment ${id}`, 'SUPPLY_ASSIGNMENTS');
        return res.json({ message: 'Assignment deleted' });
    } catch (err) {
        if (err instanceof AppException) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        logger.error('DELETE /supply-assignments/:id error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

export default router;
