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
            'SELECT id, email, role, created_at, created_by FROM users ORDER BY email'
        );
        logger.info(`Fetched all users`, 'USERS');
        return res.json(users || []);
    } catch (err) {
        logger.error('GET /users error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

router.post('/', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        if (user.role !== 'super_admin') {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const { p_email, p_role } = req.body;
        if (!p_email || !p_role) {
            return res.status(400).json({ error: 'p_email et p_role requis' });
        }

        const { v4: uuidv4 } = require('uuid');
        await db.query(
            'INSERT INTO users (id, email, role, created_by) VALUES (?, ?, ?, ?)',
            [uuidv4(), p_email, p_role, user.email]
        );
        logger.info(`User ${p_email} added with role ${p_role}`, 'USERS');
        return res.json({ success: true });
    } catch (err) {
        logger.error('POST /users error:', err as Error);
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

// GET /users/assignable - Autocomplete pour les assignations (filtre par rôle 'assignee')
router.get('/assignable', requireAuth, async (req: Request, res: Response) => {
    try {
        const { q } = req.query;
        let query = 'SELECT id, email FROM users WHERE role = ? ORDER BY email ASC LIMIT 50';
        const params: any[] = ['assignee'];

        if (q) {
            query = 'SELECT id, email FROM users WHERE role = ? AND email LIKE ? ORDER BY email ASC LIMIT 50';
            params.push(`%${q}%`);
        }

        const [results] = await db.query(query, params);
        logger.info(`Fetched assignable users`, 'USERS');
        return res.json(results || []);
    } catch (err) {
        logger.error('GET /users/assignable error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

// ✅ GET /users/all - Retourne TOUS les utilisateurs (sans filtre rôle)
router.get('/all', requireAuth, async (req: Request, res: Response) => {
    try {
        const { q } = req.query;
        let query = 'SELECT id, email, role FROM users ORDER BY email ASC LIMIT 100';
        const params: any[] = [];

        // Support recherche par email
        if (q) {
            query = 'SELECT id, email, role FROM users WHERE email LIKE ? ORDER BY email ASC LIMIT 100';
            params.push(`%${q}%`);
        }

        const [results] = await db.query(query, params);
        logger.info(`Fetched all users (no role filter)`, 'USERS');
        return res.json(results || []);
    } catch (err) {
        logger.error('GET /users/all error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});
router.post('/role', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        if (user.role !== 'super_admin') {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const { p_user_id, p_new_role } = req.body;
        if (!p_user_id || !p_new_role) {
            return res.status(400).json({ error: 'p_user_id et p_new_role requis' });
        }

        await db.query('UPDATE users SET role = ? WHERE id = ?', [p_new_role, p_user_id]);
        logger.info(`Role changed for user ${p_user_id} → ${p_new_role}`, 'USERS');
        return res.json({ success: true });
    } catch (err) {
        logger.error('PUT /users/change_role error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

router.post('/delete', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        if (user.role !== 'super_admin') {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const { p_user_id } = req.body;
        if (!p_user_id) return res.status(400).json({ error: 'p_user_id requis' });

        await db.query('DELETE FROM users WHERE id = ?', [p_user_id]);
        logger.info(`User ${p_user_id} deleted`, 'USERS');
        return res.json({ success: true });
    } catch (err) {
        logger.error('POST /users/delete error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

export default router;