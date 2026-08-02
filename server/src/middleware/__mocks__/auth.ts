// src/middleware/__mocks__/auth.ts
// Mock manuel (jest.mock('../../src/middleware/auth')) — pas de vérification JWT réelle.
// req.user vient du header `x-test-user` (JSON) si présent, sinon un utilisateur par défaut.
// Permet aux tests d'intégration de simuler différents rôles/uid sans générer de vrai token.
import { Request, Response, NextFunction } from 'express';

const DEFAULT_TEST_USER = { uid: 1, email: 'test@mfwa.org', role: 'admin' };

function userFromHeader(req: Request) {
    const raw = req.headers['x-test-user'];
    if (typeof raw === 'string') {
        try {
            return { ...DEFAULT_TEST_USER, ...JSON.parse(raw) };
        } catch {
            return DEFAULT_TEST_USER;
        }
    }
    return DEFAULT_TEST_USER;
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
    (req as any).user = userFromHeader(req);
    next();
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
    (req as any).user = userFromHeader(req);
    next();
}
