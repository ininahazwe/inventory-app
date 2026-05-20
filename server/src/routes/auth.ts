import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../database/connection';
import { logger } from '../middleware/logger';
import { requireAuth } from '../middleware/auth';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'a3c91f805485a745645f1cb0125ddcdc9b28122088e4a2e00c209f087d0f4119';
const JWT_EXPIRES_IN = '7d';

// POST /api/auth/google - Connexion Google
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

        const { email } = decoded;

        const [allowed] = await db.query(
            'SELECT id, email, role FROM users WHERE email = ?',
            [email]
        );

        if (!allowed || (allowed as any[]).length === 0) {
            return res.status(403).json({ error: 'Access denied: user email not whitelisted' });
        }

        const dbUser = (allowed as any[])[0];

        // Payload avec l'ID numérique MySQL
        const tokenPayload = {
            uid: dbUser.id,
            email: dbUser.email,
            role: dbUser.role
        };

        const appToken = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

        logger.info(`User ${email} authenticated successfully with internal ID ${dbUser.id}`, 'AUTH');

        return res.json({ token: appToken });

    } catch (err) {
        logger.error('POST /api/auth/google error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
});

// GESTIONNAIRE COMMUN POUR / ET /ME
const getCurrentUser = async (req: Request, res: Response) => {
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

        return res.json((users as any[])[0]);

    } catch (err) {
        logger.error('Get current user error:', err as Error);
        return res.status(500).json({ error: (err as Error).message });
    }
};

// Les deux routes pointent maintenant vers le même validateur
router.get('/', requireAuth, getCurrentUser);
router.get('/me', requireAuth, getCurrentUser); // <-- Rétablit l'accès pour le frontend !

export default router;