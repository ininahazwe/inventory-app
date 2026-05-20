import { Router, Request, Response } from 'express';
import { db } from '../database/connection';
import { logger } from '../middleware/logger';
import { requireAuth } from '../middleware/auth';

const router = Router();

// Middleware pour vérifier admin (utilisé dans les routes de modif)
const requireAdmin = (req: Request, res: Response, next: Function) => {
    const user = (req as any).user;
    if (!user || (user.role !== 'super_admin' && user.role !== 'admin')) {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
};

// ═══════════════════════════════════════════════════════════════════════════
// SPECIFIC ROUTES (/:id/action) - MUST BE BEFORE GENERIC /:id
// ═══════════════════════════════════════════════════════════════════════════

// PATCH /incidents/:id/status - Changer le statut (admin seulement)
router.patch('/:id/status', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!status || !['open', 'in_progress', 'resolved', 'closed'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status. Must be: open, in_progress, resolved, or closed' });
        }

        const resolvedAt = status === 'resolved' ? new Date() : null;

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
        return res.json({ success: true, status });
    } catch (err) {
        logger.error('PATCH /incidents/:id/status error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

// PATCH /incidents/:id/assign - Assigner un incident à un technicien (admin seulement)
router.patch('/:id/assign', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { assigned_to } = req.body;

        if (!assigned_to) {
            return res.status(400).json({ error: 'assigned_to (email) required' });
        }

        // Optionnel: vérifier que l'email existe dans la table users
        const [users] = await db.query('SELECT id FROM users WHERE email = ?', [assigned_to]);
        if (!(users as any[]).length) {
            return res.status(400).json({ error: 'User not found' });
        }

        const [result] = await db.query(
            `UPDATE incidents SET assigned_to = ? WHERE id = ?`,
            [assigned_to, id]
        );

        if ((result as any).affectedRows === 0) {
            return res.status(404).json({ error: 'Incident not found' });
        }

        logger.info(`Assigned incident ${id} to ${assigned_to}`, 'INCIDENTS');
        return res.json({ success: true, assigned_to });
    } catch (err) {
        logger.error('PATCH /incidents/:id/assign error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

// PATCH /incidents/:id/notes - Ajouter/modifier les notes (admin seulement)
router.patch('/:id/notes', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { notes } = req.body;

        if (notes === undefined || notes === null) {
            return res.status(400).json({ error: 'notes required' });
        }

        const [result] = await db.query(
            `UPDATE incidents SET notes = ? WHERE id = ?`,
            [notes, id]
        );

        if ((result as any).affectedRows === 0) {
            return res.status(404).json({ error: 'Incident not found' });
        }

        logger.info(`Updated notes for incident ${id}`, 'INCIDENTS');
        return res.json({ success: true, notes });
    } catch (err) {
        logger.error('PATCH /incidents/:id/notes error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// GENERIC ROUTES (/:id) - MUST BE AFTER SPECIFIC ROUTES
// ═══════════════════════════════════════════════════════════════════════════

// GET /incidents - Lister tous les incidents
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

// GET /incidents/:id - Détail d'un incident
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

// POST /incidents - Créer un nouvel incident
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

        const incidentId = (result as any).insertId;
        const createdAt = new Date().toISOString();

        logger.info(`Created incident ${incidentId} for asset ${asset_id}`, 'INCIDENTS');
        return res.status(201).json({
            id: incidentId,
            asset_id,
            incident_type: incident_type || 'other',
            severity: severity || 'medium',
            description,
            status: 'open',
            reported_by_email: email,
            assigned_to: null,
            created_at: createdAt,
            resolved_at: null,
            notes: null
        });
    } catch (err) {
        logger.error('POST /incidents error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

export default router;