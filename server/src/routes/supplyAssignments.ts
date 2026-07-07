import { Router, Request, Response } from 'express';
import { db } from '../database/connection';
import { logger } from '../middleware/logger';
import { requireAuth } from '../middleware/auth';
import { logAudit } from './audit';

const router = Router();

// GET /api/supply-assignments - List all supply assignments with filtering
router.get('/', requireAuth, async (req: Request, res: Response) => {
    try {
        const { supply_id, status, location_id } = req.query;
        let whereClause = '';
        let params: any[] = [];

        if (supply_id) {
            whereClause += 'WHERE sa.supply_id = ?';
            params.push(parseInt(supply_id as string));
        }

        if (location_id) {
            whereClause += whereClause ? ' AND' : 'WHERE';
            whereClause += ' sa.location_id = ?';
            params.push(parseInt(location_id as string));
        }

        if (status) {
            whereClause += whereClause ? ' AND' : 'WHERE';
            whereClause += ' sa.status = ?';
            params.push(status);
        }

        const [assignments] = await db.execute(
            `SELECT sa.*, s.name as supply_name, u.email as user_email,
                    l.name as location_name, l.floor as location_floor
             FROM supply_assignments sa
                      LEFT JOIN supplies s ON sa.supply_id = s.id
                      LEFT JOIN users u ON sa.assigned_user_id = u.id
                      LEFT JOIN locations l ON sa.location_id = l.id
                 ${whereClause}
             ORDER BY sa.assigned_at DESC`,
            params
        );

        logger.info(`Fetched ${(assignments as any[]).length} supply assignments`, 'SUPPLY_ASSIGNMENTS');
        return res.json(assignments || []);
    } catch (err) {
        logger.error('GET /supply-assignments error:', err as Error);
        return res.status(500).json({ error: 'Failed to fetch supply assignments' });
    }
});

// GET /api/supply-assignments/:id - Get single assignment
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
    try {
        const id = parseInt(String(req.params.id), 10);

        const [assignments] = await db.execute(
            `SELECT sa.*, s.name as supply_name, u.email as user_email,
                    l.name as location_name, l.floor as location_floor
             FROM supply_assignments sa
                      LEFT JOIN supplies s ON sa.supply_id = s.id
                      LEFT JOIN users u ON sa.assigned_user_id = u.id
                      LEFT JOIN locations l ON sa.location_id = l.id
             WHERE sa.id = ?`,
            [id]
        );

        if (!(assignments as any[]).length) {
            return res.status(404).json({ error: 'Assignment not found' });
        }

        return res.json((assignments as any[])[0]);
    } catch (err) {
        logger.error('GET /supply-assignments/:id error:', err as Error);
        return res.status(500).json({ error: 'Failed to fetch assignment' });
    }
});

// POST /api/supply-assignments - Create new assignment (user et/ou location)
router.post('/', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { supply_id, assigned_user_id, location_id, quantity_assigned, assigned_at } = req.body;

        // Validation: supply_id, quantity_assigned, assigned_at requis
        // + au moins assigned_user_id OU location_id
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

        // Verify supply exists
        const [supplyResult] = await db.execute(
            'SELECT id, name, quantity FROM supplies WHERE id = ?',
            [supply_id]
        );

        if (!(supplyResult as any[]).length) {
            return res.status(404).json({ error: 'Supply not found' });
        }

        const supply = (supplyResult as any[])[0];

        // Verify enough stock remains (total quantity minus currently active assignments)
        const [activeResult] = await db.execute(
            `SELECT COALESCE(SUM(quantity_assigned), 0) as active_qty
             FROM supply_assignments
             WHERE supply_id = ? AND status = 'active'`,
            [supply_id]
        );
        const activeQty = Number((activeResult as any[])[0]?.active_qty || 0);
        const available = Math.max(0, Number(supply.quantity) - activeQty);

        if (qtyRequested > available) {
            return res.status(400).json({ error: `Only ${available} units available` });
        }

        let assignedUserEmail: string | null = null;

        // Verify user exists (si fourni)
        if (assigned_user_id) {
            const [userResult] = await db.execute(
                'SELECT id, email FROM users WHERE id = ?',
                [assigned_user_id]
            );

            if (!(userResult as any[]).length) {
                return res.status(404).json({ error: 'User not found' });
            }

            assignedUserEmail = (userResult as any[])[0].email;
        }

        // Verify location exists (si fourni)
        if (location_id) {
            const [locationResult] = await db.execute(
                'SELECT id FROM locations WHERE id = ?',
                [location_id]
            );

            if (!(locationResult as any[]).length) {
                return res.status(404).json({ error: 'Location not found' });
            }
        }

        // Clean date
        const cleanDate = assigned_at.includes('T')
            ? assigned_at.split('T')[0]
            : assigned_at;

        const [result] = await db.execute(
            `INSERT INTO supply_assignments (supply_id, assignee_name, assignee_email, assigned_user_id, location_id, quantity_assigned, assigned_at, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`,
            [
                supply_id,
                assignedUserEmail,
                assignedUserEmail,
                assigned_user_id || null,
                location_id || null,
                qtyRequested,
                cleanDate
            ]
        );

        const assignmentId = (result as any).insertId;

        // Get created assignment
        const [assignments] = await db.execute(
            `SELECT sa.*, s.name as supply_name, u.email as user_email,
                    l.name as location_name, l.floor as location_floor
             FROM supply_assignments sa
                      LEFT JOIN supplies s ON sa.supply_id = s.id
                      LEFT JOIN users u ON sa.assigned_user_id = u.id
                      LEFT JOIN locations l ON sa.location_id = l.id
             WHERE sa.id = ?`,
            [assignmentId]
        );

        const assignment = (assignments as any[])[0];

        // Audit log
        await logAudit(user.email, 'supply_assigned', 'supply_assignments', assignmentId, null, assignment);

        logger.info(`Created supply assignment: ${supply.name}`, 'SUPPLY_ASSIGNMENTS');
        return res.status(201).json(assignment);
    } catch (err) {
        logger.error('POST /supply-assignments error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

// PATCH /api/supply-assignments/:id - Update assignment (return)
router.patch('/:id', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const id = parseInt(String(req.params.id), 10);
        const { returned_at, status } = req.body;

        const [oldAssignments] = await db.execute(
            `SELECT sa.*, s.name as supply_name, u.email as user_email
             FROM supply_assignments sa
                      LEFT JOIN supplies s ON sa.supply_id = s.id
                      LEFT JOIN users u ON sa.assigned_user_id = u.id
             WHERE sa.id = ?`,
            [id]
        );

        if (!(oldAssignments as any[]).length) {
            return res.status(404).json({ error: 'Assignment not found' });
        }

        const updates: string[] = [];
        const values: any[] = [];

        if (status !== undefined) {
            updates.push('status = ?');
            values.push(status);
        }

        if (returned_at !== undefined) {
            const cleanDate = returned_at.includes('T')
                ? returned_at.split('T')[0]
                : returned_at;
            updates.push('returned_at = ?');
            values.push(cleanDate);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        values.push(id);

        await db.execute(
            `UPDATE supply_assignments SET ${updates.join(', ')} WHERE id = ?`,
            values
        );

        const [newAssignments] = await db.execute(
            `SELECT sa.*, s.name as supply_name, u.email as user_email,
                    l.name as location_name, l.floor as location_floor
             FROM supply_assignments sa
                      LEFT JOIN supplies s ON sa.supply_id = s.id
                      LEFT JOIN users u ON sa.assigned_user_id = u.id
                      LEFT JOIN locations l ON sa.location_id = l.id
             WHERE sa.id = ?`,
            [id]
        );

        const newAssignment = (newAssignments as any[])[0];

        await logAudit(user.email, 'supply_assignment_updated', 'supply_assignments', id, (oldAssignments as any[])[0], newAssignment);

        logger.info(`Updated supply assignment ${id}`, 'SUPPLY_ASSIGNMENTS');
        return res.json(newAssignment);
    } catch (err) {
        logger.error('PATCH /supply-assignments/:id error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

// DELETE /api/supply-assignments/:id - Delete assignment
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const id = parseInt(String(req.params.id), 10);

        const [assignments] = await db.execute(
            `SELECT sa.*, s.name as supply_name, u.email as user_email
             FROM supply_assignments sa
                      LEFT JOIN supplies s ON sa.supply_id = s.id
                      LEFT JOIN users u ON sa.assigned_user_id = u.id
             WHERE sa.id = ?`,
            [id]
        );

        if (!(assignments as any[]).length) {
            return res.status(404).json({ error: 'Assignment not found' });
        }

        const oldAssignment = (assignments as any[])[0];

        await db.execute('DELETE FROM supply_assignments WHERE id = ?', [id]);

        await logAudit(user.email, 'supply_assignment_deleted', 'supply_assignments', id, oldAssignment, null);

        logger.info(`Deleted supply assignment ${id}`, 'SUPPLY_ASSIGNMENTS');
        return res.json({ message: 'Assignment deleted' });
    } catch (err) {
        logger.error('DELETE /supply-assignments/:id error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

export default router;
