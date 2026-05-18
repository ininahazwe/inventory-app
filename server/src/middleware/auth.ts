/**
 * JWT Authentication middleware
 * Extracts and verifies JWT tokens from Authorization header
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import {AuthUser} from '../types/requests';
import {UnauthorizedException} from "../exceptions/index";

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
        const secret = process.env.JWT_SECRET || 'a3c91f805485a745645f1cb0125ddcdc9b28122088e4a2e00c209f087d0f4119';
        //const secret = process.env.JWT_SECRET || 'your-secret-key';

        const decoded = jwt.verify(token, secret) as AuthUser;

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
            //const secret = process.env.JWT_SECRET || 'your-secret-key';
            const secret = process.env.JWT_SECRET || 'a3c91f805485a745645f1cb0125ddcdc9b28122088e4a2e00c209f087d0f4119';
            const decoded = jwt.verify(token, secret) as AuthUser;
            req.user = decoded;
        }
        next();
    } catch (error) {
        // Ignore auth errors for optional routes
        next();
    }
}