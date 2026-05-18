/**
 * Custom exception classes for error handling
 * Used by Services and Controllers
 */

export class AppException extends Error {
    statusCode: number;
    code?: string;

    constructor(statusCode: number, message: string, code?: string) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.name = this.constructor.name;
        Error.captureStackTrace(this, this.constructor);
    }
}

export class ValidationException extends AppException {
    constructor(message: string, code = 'VALIDATION_ERROR') {
        super(400, message, code);
    }
}

export class NotFoundException extends AppException {
    constructor(message: string, code = 'NOT_FOUND') {
        super(404, message, code);
    }
}

export class ForbiddenException extends AppException {
    constructor(message: string, code = 'FORBIDDEN') {
        super(403, message, code);
    }
}

export class UnauthorizedException extends AppException {
    constructor(message: string, code = 'UNAUTHORIZED') {
        super(401, message, code);
    }
}

export class BusinessException extends AppException {
    constructor(message: string, code = 'BUSINESS_ERROR') {
        super(400, message, code);
    }
}

export class ConflictException extends AppException {
    constructor(message: string, code = 'CONFLICT') {
        super(409, message, code);
    }
}

export class InternalServerException extends AppException {
    constructor(message: string = 'Internal server error', code = 'INTERNAL_ERROR') {
        super(500, message, code);
    }
}