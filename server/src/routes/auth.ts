import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { db } from '../database/connection';
import { logger } from '../middleware/logger';
import { requireAuth } from '../middleware/auth';
import { JWT_SECRET, JWT_EXPIRES_IN } from '../config/env';

const router = Router();
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID;

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// POST /api/auth/google - Connexion Google
router.post('/google', async (req: Request, res: Response) => {
    try {
        const { token } = req.body;
        if (!token) {
            return res.status(400).json({ error: 'No token provided' });
        }

        // SECURITY: cryptographically verify the Google ID token
        // (signature, issuer, audience, expiration). Never trust jwt.decode alone.
        let email: string | undefined;
        try {
            const ticket = await googleClient.verifyIdToken({
                idToken: token,
                audience: GOOGLE_CLIENT_ID,
            });
            const payload = ticket.getPayload();
            email = payload?.email;
            if (!payload?.email_verified) {
                return res.status(403).json({ error: 'Google email not verified' });
            }
        } catch (verifyErr) {
            logger.error('Google token verification failed:', verifyErr as Error);
            return res.status(401).json({ error: 'Invalid Google token' });
        }

        if (!email) {
            return res.status(400).json({ error: 'No email in Google token' });
        }

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

        const appToken = jwt.sign(tokenPayload, JWT_SECRET(), { expiresIn: JWT_EXPIRES_IN() } as jwt.SignOptions);

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