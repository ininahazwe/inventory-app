import { Router, Request, Response } from 'express';
import { db } from '../database/connection';
import { logger } from '../middleware/logger';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
    try {
        const { q } = req.query;
        let query = 'SELECT id, name, created_at FROM categories';
        let params: any[] = [];

        if (q) {
            query += ' WHERE name LIKE ?';
            params.push(`%${q}%`);
        }

        query += ' ORDER BY name ASC';
        const [categories] = await db.query(query, params);
        logger.info(`Fetched categories`, 'CATEGORIES');
        return res.json(categories || []);
    } catch (err) {
        logger.error('GET /categories error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

router.post('/', requireAuth, async (req: Request, res: Response) => {
    try {
        const { name } = req.body;
        if (!name || typeof name !== 'string') {
            return res.status(400).json({ error: 'Category name required' });
        }

        const trimmed = name.trim();

        // ✅ Vérifier si la catégorie existe DÉJÀ (case-insensitive)
        const [existing] = await db.query(
            'SELECT id FROM categories WHERE LOWER(name) = LOWER(?)',
            [trimmed]
        );

        if ((existing as any[]).length > 0) {
            // ✅ Elle existe → retourner l'ID existant (sans créer)
            logger.info(`Category already exists: ${trimmed} (ID: ${(existing as any[])[0].id})`, 'CATEGORIES');
            return res.status(200).json({ id: (existing as any[])[0].id, name: trimmed });
        }

        // ✅ Elle n'existe pas → créer
        const [result] = await db.query(
            'INSERT INTO categories (name) VALUES (?)',
            [trimmed]
        );

        const insertId = (result as any).insertId;
        logger.info(`Category created: ${trimmed} (ID: ${insertId})`, 'CATEGORIES');
        return res.status(201).json({ id: insertId, name: trimmed });
    } catch (err) {
        logger.error('POST /categories error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

export default router;