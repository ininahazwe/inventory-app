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
        if (!name) {
            return res.status(400).json({ error: 'name is required' });
        }

        const [result] = await db.query(
            'INSERT INTO categories (name) VALUES (?)',
            [name]
        );

        logger.info(`Created category: ${name}`, 'CATEGORIES');
        return res.status(201).json({ id: (result as any).insertId, name });
    } catch (err) {
        logger.error('POST /categories error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

export default router;