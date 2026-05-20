/**
 * Type definitions for Express Request with authenticated user
 */

export interface AuthUser {
    uid: number;           // Modifié : ID numérique de la base de données (ex: 1, 2, 3)
    email: string;         // Email obligatoire
    role: 'user' | 'admin' | 'super_admin' | 'accountant';
    iat?: number;
    exp?: number;
}

declare global {
    namespace Express {
        interface Request {
            user?: AuthUser;      // Optional user attached by auth middleware
        }
    }
}

export interface PaginatedResponse<T> {
    data: T[];
    total: number;
    page: number;
    limit: number;
}

export interface ErrorResponse {
    error: string;
    code: string;
    details?: any;
}