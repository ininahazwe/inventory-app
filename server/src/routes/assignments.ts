import { Router, Request, Response } from 'express';
import { db } from '../database/connection';
import { logger } from '../middleware/logger';
import { requireAuth } from '../middleware/auth';
import { logAudit } from './audit';

const router = Router();

// GET /api/assignments - List all assignments
router.get('/', requireAuth, async (req: Request, res: Response) => {
    try {
        const [assignments] = await db.query(
            `SELECT a.id, a.asset_id, a.assignee_name, a.assignee_email, a.status, a.assigned_at, a.returned_at
             FROM assignments a
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
            SELECT COUNT(DISTINCT TRIM(assignee_email)) as total
            FROM assignments
            WHERE status = 'active' AND assignee_email IS NOT NULL
        `;
        const countParams: any[] = [];

        if (searchTerm) {
            countQuery += ' AND (TRIM(assignee_name) LIKE ? OR TRIM(assignee_email) LIKE ?)';
            countParams.push(`%${searchTerm}%`, `%${searchTerm}%`);
        }

        const [countResult] = await db.query(countQuery, countParams);
        const total = (countResult as any[])[0]?.total || 0;

        let dataQuery = `
            SELECT
                TRIM(assignee_email) as assignee_email,
                MAX(TRIM(assignee_name)) as assignee_name,
                COUNT(asset_id) as asset_count
            FROM assignments
            WHERE status = 'active' AND assignee_email IS NOT NULL
        `;
        const dataParams: any[] = [];

        if (searchTerm) {
            dataQuery += ' AND (TRIM(assignee_name) LIKE ? OR TRIM(assignee_email) LIKE ?)';
            dataParams.push(`%${searchTerm}%`, `%${searchTerm}%`);
        }

        dataQuery += `
      GROUP BY TRIM(assignee_email)
      ORDER BY assignee_name ASC
      LIMIT ? OFFSET ?
    `;
        dataParams.push(pageSize, offset);

        const [assignees] = await db.query(dataQuery, dataParams);

        logger.info(`Fetched assignees`, 'ASSIGNMENTS');
        return res.json({
            data: assignees || [],
            count: total
        });
    } catch (err) {
        logger.error('GET /assignments/assignees error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

// POST /api/assignments - Create assignment
router.post('/', requireAuth, async (req: Request, res: Response) => {
    try {
        const { asset_id, assignee_name, assignee_email } = req.body;

        if (!asset_id || !assignee_name || !assignee_email) {
            return res.status(400).json({ error: 'asset_id, assignee_name, assignee_email required' });
        }

        // Close previous active assignment
        await db.query(
            'UPDATE assignments SET status = ?, returned_at = ? WHERE asset_id = ? AND status = ?',
            ['returned', new Date().toISOString().split('T')[0], asset_id, 'active']
        );

        // Create new assignment
        const [result] = await db.query(
            `INSERT INTO assignments (asset_id, assignee_name, assignee_email, status)
             VALUES (?, ?, ?, ?)`,
            [asset_id, assignee_name, assignee_email, 'active']
        );

        // Update asset status
        await db.query('UPDATE assets SET status = ? WHERE id = ?', ['assigned', asset_id]);

        logger.info(`Created assignment for asset ${asset_id}`, 'ASSIGNMENTS');
        return res.status(201).json({
            id: (result as any).insertId,
            asset_id,
            assignee_name,
            assignee_email,
            status: 'active'
        });
    } catch (err) {
        logger.error('POST /assignments error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

export default router;