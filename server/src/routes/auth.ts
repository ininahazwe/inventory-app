import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../database/connection';
import { logger } from '../middleware/logger';
import { requireAuth } from '../middleware/auth';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'a3c91f805485a745645f1cb0125ddcdc9b28122088e4a2e00c209f087d0f4119';
const JWT_EXPIRES_IN = '7d';

// POST /api/auth/google - Verify Google token and return JWT
router.post('/google', async (req: Request, res: Response) => {
    try {
        const { token } = req.body;
        if (!token) {
            return res.status(400).json({ error: 'No token provided' });
        }

        const decoded = jwt.decode(token) as any;
        if (!decoded) {
            return res.status(400).json({ error: 'Invalid token format' });
        }

        const { email, name, picture, sub } = decoded;

        const [allowed] = await db.query(
            'SELECT email, role FROM users WHERE email = ?',
            [email]
        );

        if (!allowed || (allowed as any[]).length === 0) {
            return res.status(403).json({ error: 'Email not authorized' });
        }

        const user = (allowed as any[])[0];
        const jwtToken = jwt.sign(
            { id: sub, email, name, picture, role: user.role },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        logger.info(`User authenticated: ${email}`, 'AUTH');
        return res.json({ token: jwtToken });
    } catch (err) {
        logger.error('Auth error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});
// GET /api/auth/me - Récupère les infos de l'utilisateur connecté (requiert le JWT)
router.get('/me', requireAuth, async (req: Request, res: Response) => {
    try {
        // 1. Récupérer l'utilisateur injecté par le middleware requireAuth
        const user = (req as any).user;
        if (!user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const { email } = user;

        // 2. Chercher les informations à jour de l'utilisateur dans la base de données
        const [users] = await db.query(
            'SELECT id, email, role, created_at FROM users WHERE email = ? LIMIT 1',
            [email]
        );

        // 3. Vérifier si l'utilisateur existe toujours dans la base
        if (!users || (users as any[]).length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        logger.info(`GET /auth/me success for ${email}`, 'AUTH');

        // 4. Retourner les données de l'utilisateur au frontend
        return res.json((users as any[])[0]);

    } catch (err) {
        logger.error('GET /auth/me error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});
// GET /api/me - Get current user info (requires JWT)
router.get('/', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        if (!user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const { email } = user;
        const [users] = await db.query(
            'SELECT id, email, role, created_at FROM users WHERE email = ? LIMIT 1',
            [email]
        );

        if (!users || (users as any[]).length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        logger.info(`GET /me for ${email}`, 'AUTH');
        return res.json((users as any[])[0]);
    } catch (err) {
        logger.error('GET /me error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

export default router;