// routes/locations.ts
import { Router, Request, Response } from 'express';
import { db } from '../database/connection';
import { logger } from '../middleware/logger';
import { requireAuth } from '../middleware/auth';

const router = Router();

// Middleware super_admin
function requireSuperAdmin(req: Request, res: Response, next: Function) {
    const user = (req as any).user;
    if (!user || user.role !== 'super_admin') {
        return res.status(403).json({ error: 'Super admin required' });
    }
    next();
}

// GET /api/locations - Liste toutes les localisations
router.get('/', requireAuth, async (req: Request, res: Response) => {
    try {
        const { q } = req.query;
        let sql = 'SELECT id, name, floor, description, created_at FROM locations';
        const params: any[] = [];

        if (q) {
            sql += ' WHERE name LIKE ? OR floor LIKE ?';
            params.push(`%${q}%`, `%${q}%`);
        }

        sql += ' ORDER BY name ASC';
        const [rows] = await db.query(sql, params);
        return res.json(rows);
    } catch (err) {
        logger.error('GET /locations error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

// GET /api/locations/:id - Détail d'une localisation
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
    try {
        const id = String(req.params.id);
        const [rows] = await db.query(
            'SELECT id, name, floor, description, created_at FROM locations WHERE id = ?',
            [id]
        );
        if (!(rows as any[]).length) {
            return res.status(404).json({ error: 'Location not found' });
        }
        return res.json((rows as any[])[0]);
    } catch (err) {
        logger.error('GET /locations/:id error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

// POST /api/locations - Créer une localisation (super_admin)
router.post('/', requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    try {
        const { name, floor, description } = req.body;
        if (!name?.trim()) {
            return res.status(400).json({ error: 'name is required' });
        }
        const [result] = await db.query(
            'INSERT INTO locations (name, floor, description) VALUES (?, ?, ?)',
            [name.trim(), floor?.trim() || null, description?.trim() || null]
        );
        const id = (result as any).insertId;
        logger.info(`Created location #${id}: ${name}`, 'LOCATIONS');
        return res.status(201).json({ id, name, floor, description });
    } catch (err) {
        logger.error('POST /locations error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

// PUT /api/locations/:id - Modifier une localisation (super_admin)
router.put('/:id', requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    try {
        const id = parseInt(String(req.params.id), 10);
        const { name, floor, description } = req.body;
        if (!name?.trim()) {
            return res.status(400).json({ error: 'name is required' });
        }
        const [check] = await db.query('SELECT id FROM locations WHERE id = ?', [id]);
        if (!(check as any[]).length) {
            return res.status(404).json({ error: 'Location not found' });
        }
        await db.query(
            'UPDATE locations SET name = ?, floor = ?, description = ? WHERE id = ?',
            [name.trim(), floor?.trim() || null, description?.trim() || null, id]
        );
        logger.info(`Updated location #${id}`, 'LOCATIONS');
        return res.json({ id, name, floor, description });
    } catch (err) {
        logger.error('PUT /locations/:id error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

// DELETE /api/locations/:id - Supprimer une localisation (super_admin)
// Bloqué si des assignments actifs y sont liés
router.delete('/:id', requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    try {
        const id = parseInt(String(req.params.id), 10);

        const [check] = await db.query('SELECT id, name FROM locations WHERE id = ?', [id]);
        if (!(check as any[]).length) {
            return res.status(404).json({ error: 'Location not found' });
        }

        // Bloquer si assignments actifs
        const [activeAssignments] = await db.query(
            'SELECT COUNT(*) as count FROM assignments WHERE location_id = ? AND status = "active"',
            [id]
        );
        const count = (activeAssignments as any[])[0]?.count || 0;
        if (count > 0) {
            return res.status(400).json({
                error: `Cannot delete location with ${count} active assignment(s). Reassign or return assets first.`
            });
        }

        await db.query('DELETE FROM locations WHERE id = ?', [id]);
        logger.info(`Deleted location #${id}`, 'LOCATIONS');
        return res.json({ success: true });
    } catch (err) {
        logger.error('DELETE /locations/:id error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

export default router;