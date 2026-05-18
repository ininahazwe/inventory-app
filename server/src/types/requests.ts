/**
 * Type definitions for Express Request with authenticated user
 */

export interface AuthUser {
    uid: string;              // UUID from Google / JWT
    email: string;            // Email address
    role: 'user' | 'admin' | 'super_admin' | 'accountant';  // User role
    iat?: number;             // Issued at (unix timestamp)
    exp?: number;             // Expiration (unix timestamp)
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