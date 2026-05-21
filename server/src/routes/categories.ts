import { Router, Request, Response } from 'express';
import { db } from '../database/connection';
import { logger } from '../middleware/logger';
import { requireAuth } from '../middleware/auth';

const router = Router();

// ✅ GET /api/categories - List categories with optional type filter
router.get('/', async (req: Request, res: Response) => {
    try {
        const { q, type } = req.query;

        let whereClause = '';
        let params: any[] = [];

        // ✅ Filter by type (asset or supply)
        if (type && (type === 'asset' || type === 'supply')) {
            whereClause = 'WHERE c.type = ?';
            params.push(type);
        }

        if (q) {
            whereClause += whereClause ? ' AND' : 'WHERE';
            whereClause += ' c.name LIKE ?';
            params.push(`%${q}%`);
        }

        // ✅ Jointures pour compter assets et supplies (seulement du bon type)
        const query = `
            SELECT
                c.id,
                c.name,
                c.type,
                c.created_at,
                COUNT(DISTINCT a.id) as assets_count,
                COUNT(DISTINCT s.id) as supplies_count
            FROM categories c
                     LEFT JOIN assets a ON c.id = a.category_id AND a.category_id IS NOT NULL
                     LEFT JOIN supplies s ON c.id = s.category_id AND s.category_id IS NOT NULL
                ${whereClause}
            GROUP BY c.id, c.name, c.type, c.created_at
            ORDER BY c.name ASC
        `;

        const [categories] = await db.query(query, params);
        logger.info(`Fetched ${(categories as any[]).length} categories (type: ${type || 'all'})`, 'CATEGORIES');
        return res.json(categories || []);
    } catch (err) {
        logger.error('GET /categories error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

// ✅ POST /api/categories - Create new category with type
router.post('/', requireAuth, async (req: Request, res: Response) => {
    try {
        const { name, type } = req.body;

        if (!name || typeof name !== 'string') {
            return res.status(400).json({ error: 'Category name required' });
        }

        // ✅ Validate type
        if (!type || !['asset', 'supply'].includes(type)) {
            return res.status(400).json({ error: 'Type must be "asset" or "supply"' });
        }

        const trimmed = name.trim();

        // ✅ Check if category exists ALREADY (case-insensitive, same type)
        const [existing] = await db.query(
            'SELECT id FROM categories WHERE LOWER(name) = LOWER(?) AND type = ?',
            [trimmed, type]
        );

        if ((existing as any[]).length > 0) {
            logger.info(`Category already exists: ${trimmed} (type: ${type}, ID: ${(existing as any[])[0].id})`, 'CATEGORIES');
            return res.status(200).json({
                id: (existing as any[])[0].id,
                name: trimmed,
                type: type
            });
        }

        // ✅ Create new category
        const [result] = await db.query(
            'INSERT INTO categories (name, type) VALUES (?, ?)',
            [trimmed, type]
        );

        const insertId = (result as any).insertId;
        logger.info(`Category created: ${trimmed} (type: ${type}, ID: ${insertId})`, 'CATEGORIES');
        return res.status(201).json({ id: insertId, name: trimmed, type: type });
    } catch (err) {
        logger.error('POST /categories error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

export default router;