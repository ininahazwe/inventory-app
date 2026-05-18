import { Router, Request, Response } from 'express';
import { db } from '../database/connection';
import { logger } from '../middleware/logger';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.get('/', requireAuth, async (req: Request, res: Response) => {
    try {
        const [incidents] = await db.query(`
            SELECT
                i.id,
                i.asset_id,
                a.label as asset_label,
                i.incident_type,
                i.severity,
                i.description,
                i.status,
                i.reported_by_email,
                i.assigned_to,
                i.created_at,
                i.resolved_at,
                i.notes
            FROM incidents i
                     LEFT JOIN assets a ON i.asset_id = a.id
            ORDER BY i.created_at DESC
        `);
        logger.info(`Fetched incidents`, 'INCIDENTS');
        return res.json(incidents || []);
    } catch (err) {
        logger.error('GET /incidents error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

router.get('/:id', requireAuth, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const [incidents] = await db.query(`
            SELECT
                i.id,
                i.asset_id,
                a.label as asset_label,
                i.incident_type,
                i.severity,
                i.description,
                i.status,
                i.reported_by_email,
                i.assigned_to,
                i.created_at,
                i.resolved_at,
                i.notes
            FROM incidents i
                     LEFT JOIN assets a ON i.asset_id = a.id
            WHERE i.id = ?
        `, [id]);

        if (!(incidents as any[]).length) {
            return res.status(404).json({ error: 'Incident not found' });
        }

        return res.json((incidents as any[])[0]);
    } catch (err) {
        logger.error(`GET /incidents/:id error:`, err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

router.post('/', requireAuth, async (req: Request, res: Response) => {
    try {
        const { asset_id, incident_type, severity, description } = req.body;
        const user = (req as any).user;
        const { email } = user;

        if (!asset_id) {
            return res.status(400).json({ error: 'asset_id required' });
        }

        const [result] = await db.query(
            `INSERT INTO incidents (asset_id, incident_type, severity, description, status, reported_by_email, created_at)
             VALUES (?, ?, ?, ?, ?, ?, NOW())`,
            [asset_id, incident_type || 'other', severity || 'medium', description || null, 'open', email]
        );

        logger.info(`Created incident for asset ${asset_id}`, 'INCIDENTS');
        return res.status(201).json({
            id: (result as any).insertId,
            asset_id,
            incident_type: incident_type || 'other',
            severity: severity || 'medium',
            description,
            status: 'open',
            reported_by_email: email,
            created_at: new Date().toISOString()
        });
    } catch (err) {
        logger.error('POST /incidents error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

router.patch('/:id/status', requireAuth, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!status) {
            return res.status(400).json({ error: 'status required' });
        }

        const resolvedAt = status === 'resolved' ? new Date().toISOString().split('T')[0] : null;

        const [result] = await db.query(
            `UPDATE incidents
             SET status = ?, resolved_at = ?
             WHERE id = ?`,
            [status, resolvedAt, id]
        );

        if ((result as any).affectedRows === 0) {
            return res.status(404).json({ error: 'Incident not found' });
        }

        logger.info(`Updated incident ${id} status to ${status}`, 'INCIDENTS');
        return res.json({ success: true });
    } catch (err) {
        logger.error('PATCH /incidents/:id/status error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

export default router;