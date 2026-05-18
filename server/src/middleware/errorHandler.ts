/**
 * Error handling middleware
 * Catches exceptions and returns JSON responses
 */

import type {Request, Response, NextFunction} from 'express';
import { logger } from './logger';
import {AppException, InternalServerException} from "../exceptions";

/**
 * Async wrapper to catch async errors in route handlers
 * Usage: router.get('/', asyncHandler(async (req, res) => { ... }))
 */
export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) {
    return (req: Request, res: Response, next: NextFunction) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

/**
 * Global error handler middleware
 * Should be registered last in Express app
 * ⚠️ MUST have 4 parameters: err, req, res, next (even if unused)
 */
export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
    logger.error(`[ERROR_HANDLER] ${err.message}`, err);

    // Zod validation error
    if (err.name === 'ZodError') {
        return res.status(400).json({
            error: 'Validation Error',
            code: 'VALIDATION_ERROR',
            details: err.errors,
        });
    }

    // Custom AppException
    if (err instanceof AppException) {
        return res.status(err.statusCode).json({
            error: err.message,
            code: err.code,
        });
    }

    // MySQL error
    if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({
            error: 'Duplicate entry',
            code: 'DUPLICATE_ENTRY',
        });
    }

    if (err.code === 'ER_NO_REFERENCED_ROW_2') {
        return res.status(400).json({
            error: 'Invalid foreign key reference',
            code: 'INVALID_FK',
        });
    }

    // Default internal server error
    const internalError = new InternalServerException();
    res.status(internalError.statusCode).json({
        error: internalError.message,
        code: internalError.code,
    });
}