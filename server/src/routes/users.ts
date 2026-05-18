import { Router, Request, Response } from 'express';
import { db } from '../database/connection';
import { logger } from '../middleware/logger';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.get('/', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        if (user.role !== 'super_admin') {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const [users] = await db.query(
            'SELECT id, email, role, created_at FROM users ORDER BY email'
        );
        logger.info(`Fetched all users`, 'USERS');
        return res.json(users || []);
    } catch (err) {
        logger.error('GET /users error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

// RPC HELPERS
router.get('/is_admin', requireAuth, async (req: Request, res: Response) => {
    try {
        const { email } = req.query;
        if (!email) return res.status(400).json({ error: 'email required' });

        const [users] = await db.query(
            'SELECT role FROM users WHERE email = ? LIMIT 1',
            [email]
        );

        const isAdmin = users && (users as any[]).length > 0 &&
            ((users as any[])[0].role === 'admin' || (users as any[])[0].role === 'super_admin');

        return res.json({ result: isAdmin });
    } catch (err) {
        logger.error('GET /is_admin error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

router.get('/is_super_admin', requireAuth, async (req: Request, res: Response) => {
    try {
        const { email } = req.query;
        if (!email) return res.status(400).json({ error: 'email required' });

        const [users] = await db.query(
            'SELECT role FROM users WHERE email = ? LIMIT 1',
            [email]
        );

        const isSuperAdmin = users && (users as any[]).length > 0 && (users as any[])[0].role === 'super_admin';
        return res.json({ result: isSuperAdmin });
    } catch (err) {
        logger.error('GET /is_super_admin error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

router.get('/is_email_allowed', async (req: Request, res: Response) => {
    try {
        console.log('✅ is_email_allowed called');
        const { email } = req.query;
        if (!email) return res.status(400).json({ error: 'email required' });

        const [users] = await db.query(
            'SELECT id FROM users WHERE email = ? LIMIT 1',
            [email]
        );

        const isAllowed = users && (users as any[]).length > 0;
        return res.json({ result: isAllowed });
    } catch (err) {
        console.error('❌ ERREUR:', err);
        logger.error('GET /is_email_allowed error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

export default router;