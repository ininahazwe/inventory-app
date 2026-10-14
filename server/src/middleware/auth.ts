/**
 * JWT Authentication middleware
 * Extracts and verifies JWT tokens from Authorization header
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import {AuthUser} from '../types/requests';
import {UnauthorizedException} from "../exceptions/index";
import { JWT_SECRET } from '../config/env';

/**
 * Middleware to verify JWT and attach user to request
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw new UnauthorizedException('Missing or invalid Authorization header');
        }

        const token = authHeader.substring(7); // Remove "Bearer " prefix
        const decoded = jwt.verify(token, JWT_SECRET()) as AuthUser;

        req.user = decoded;
        next();
    } catch (error) {
        if (error instanceof jwt.JsonWebTokenError) {
            return next(new UnauthorizedException('Invalid token'));
        }
        next(error);
    }
}

/**
 * Extract user from JWT without throwing (for optional auth)
 */
export function optionalAuth(req: Request, res: Response, next: NextFunction) {
    try {
        const authHeader = req.headers.authorization;

        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.substring(7);
            const decoded = jwt.verify(token, JWT_SECRET()) as AuthUser;
            req.user = decoded;
        }
        next();
    } catch (error) {
        // Ignore auth errors for optional routes
        next();
    }
}

/** Admin or super_admin only (must run after requireAuth). */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
    const user = req.user as AuthUser | undefined;
    if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
}

export function isAdminUser(user?: { role?: string } | null): boolean {
    return !!user && (user.role === 'admin' || user.role === 'super_admin');
}

/**
 * SQL condition: asset `a` is "entrusted" to the user, i.e. actively assigned
 * to them (by user id or email) or currently checked out to them on a loan.
 * Requires the query to alias assets as `a`. Params: [uid, email, email].
 */
export const ENTRUSTED_SQL = `(
    EXISTS (SELECT 1 FROM assignments x WHERE x.asset_id = a.id AND x.status = 'active'
            AND (x.assigned_user_id = ? OR x.assignee_email = ?))
    OR EXISTS (SELECT 1 FROM loans l WHERE l.asset_id = a.id AND l.status = 'checked_out'
            AND l.borrower_email = ?)
)`;
export const entrustedParams = (u: { uid?: string; email?: string }) => [u.uid ?? '', u.email ?? '', u.email ?? ''];
