// routes/assignments.ts
import { Router, Request, Response } from 'express';
import { db } from '../database/connection';
import { logger } from '../middleware/logger';
import { requireAuth } from '../middleware/auth';

const router = Router();

// GET /api/assignments - List all assignments
router.get('/', requireAuth, async (req: Request, res: Response) => {
    try {
        const [assignments] = await db.query(
            `SELECT a.id, a.asset_id, a.assignee_name, a.assignee_email, a.assigned_user_id,
                    a.location_id, l.name as location_name, l.floor as location_floor,
                    a.status, a.assigned_at, a.returned_at, u.email as user_email
             FROM assignments a
                      LEFT JOIN users u ON a.assigned_user_id = u.id
                      LEFT JOIN locations l ON a.location_id = l.id
             WHERE a.status IN ('active', 'returned')
             ORDER BY a.assigned_at DESC`
        );
        logger.info(`Fetched assignments`, 'ASSIGNMENTS');
        return res.json(assignments || []);
    } catch (err) {
        logger.error('GET /assignments error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

// GET /api/assignments/assignees - List unique assignees
router.get('/assignees', requireAuth, async (req: Request, res: Response) => {
    try {
        const { page = 1, limit = 10, q = '' } = req.query;
        const pageNum = parseInt(page as string) || 1;
        const pageSize = Math.min(parseInt(limit as string) || 10, 100);
        const offset = (pageNum - 1) * pageSize;
        const searchTerm = (q || '').toString().trim();

        let countQuery = `
            SELECT COUNT(DISTINCT a.assigned_user_id) as total
            FROM assignments a
            WHERE a.status = 'active' AND a.assigned_user_id IS NOT NULL
        `;
        const countParams: any[] = [];
        if (searchTerm) {
            countQuery += ' AND u.email LIKE ?';
            countParams.push(`%${searchTerm}%`);
        }
        const [countResult] = await db.query(countQuery, countParams);
        const total = (countResult as any[])[0]?.total || 0;

        let dataQuery = `
            SELECT a.assigned_user_id, u.email as assignee_email, COUNT(a.asset_id) as asset_count
            FROM assignments a
                     LEFT JOIN users u ON a.assigned_user_id = u.id
            WHERE a.status = 'active' AND a.assigned_user_id IS NOT NULL
        `;
        const dataParams: any[] = [];
        if (searchTerm) {
            dataQuery += ' AND u.email LIKE ?';
            dataParams.push(`%${searchTerm}%`);
        }
        dataQuery += ' GROUP BY a.assigned_user_id, u.email ORDER BY u.email ASC LIMIT ? OFFSET ?';
        dataParams.push(pageSize, offset);

        const [assignees] = await db.query(dataQuery, dataParams);
        logger.info(`Fetched assignees`, 'ASSIGNMENTS');
        return res.json({ data: assignees || [], count: total });
    } catch (err) {
        logger.error('GET /assignments/assignees error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

// POST /api/assignments - Créer un assignment (user et/ou location)
router.post('/', requireAuth, async (req: Request, res: Response) => {
    try {
        const { asset_id, assigned_user_id, location_id } = req.body;

        if (!asset_id) {
            return res.status(400).json({ error: 'asset_id is required' });
        }
        if (!assigned_user_id && !location_id) {
            return res.status(400).json({ error: 'assigned_user_id or location_id is required' });
        }

        let userEmail: string | null = null;

        if (assigned_user_id) {
            const [userResult] = await db.query(
                'SELECT id, email FROM users WHERE id = ? LIMIT 1',
                [assigned_user_id]
            );
            if (!userResult || (userResult as any[]).length === 0) {
                return res.status(404).json({ error: 'User not found' });
            }
            userEmail = (userResult as any[])[0].email;
        }

        if (location_id) {
            const [locResult] = await db.query(
                'SELECT id FROM locations WHERE id = ? LIMIT 1',
                [location_id]
            );
            if (!locResult || (locResult as any[]).length === 0) {
                return res.status(404).json({ error: 'Location not found' });
            }
        }

        // Clore l'assignment actif précédent
        await db.query(
            'UPDATE assignments SET status = ?, returned_at = ? WHERE asset_id = ? AND status = ?',
            ['returned', new Date().toISOString().split('T')[0], asset_id, 'active']
        );

        const assignedAtDate = new Date().toISOString().split('T')[0];
        const [result] = await db.query(
            `INSERT INTO assignments (asset_id, assignee_name, assignee_email, assigned_user_id, location_id, status, assigned_at)
             VALUES (?, ?, ?, ?, ?, 'active', ?)`,
            [
                asset_id,
                userEmail,
                userEmail,
                assigned_user_id || null,
                location_id || null,
                assignedAtDate
            ]
        );

        await db.query('UPDATE assets SET status = ? WHERE id = ?', ['assigned', asset_id]);

        logger.info(`Created assignment for asset ${asset_id}`, 'ASSIGNMENTS');
        return res.status(201).json({
            id: (result as any).insertId,
            asset_id,
            assigned_user_id: assigned_user_id || null,
            location_id: location_id || null,
            assignee_email: userEmail,
            status: 'active'
        });
    } catch (err) {
        logger.error('POST /assignments error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

export default router;