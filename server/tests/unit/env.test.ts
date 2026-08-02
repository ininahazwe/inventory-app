// tests/unit/env.test.ts
// Pure logic, aucune DB — vérifie que le serveur refuse de démarrer sans secrets
// requis, et qu'il n'y a plus de fallback hardcodé (correctif sécurité).
import { validateEnv, JWT_SECRET, JWT_EXPIRES_IN, CRON_SECRET } from '../../src/config/env';

const REQUIRED_VARS = ['JWT_SECRET', 'DB_HOST', 'DB_USER', 'DB_NAME'];
const originalEnv = { ...process.env };

describe('config/env', () => {
    beforeEach(() => {
        process.env = { ...originalEnv };
        for (const key of REQUIRED_VARS) {
            process.env[key] = `test-${key}`;
        }
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    describe('validateEnv', () => {
        it('does not throw when all required vars are set', () => {
            expect(() => validateEnv()).not.toThrow();
        });

        it.each(REQUIRED_VARS)('throws when %s is missing', (missingVar) => {
            delete process.env[missingVar];
            expect(() => validateEnv()).toThrow(missingVar);
        });

        it('throws when a required var is an empty/whitespace string', () => {
            process.env.JWT_SECRET = '   ';
            expect(() => validateEnv()).toThrow('JWT_SECRET');
        });

        it('lists every missing var at once, not just the first', () => {
            delete process.env.DB_HOST;
            delete process.env.DB_USER;
            expect(() => validateEnv()).toThrow(/DB_HOST.*DB_USER|DB_USER.*DB_HOST/);
        });
    });

    describe('JWT_SECRET()', () => {
        it('returns the configured secret with no hardcoded fallback', () => {
            process.env.JWT_SECRET = 'my-real-secret';
            expect(JWT_SECRET()).toBe('my-real-secret');
        });

        it('throws instead of silently returning a default when unset', () => {
            delete process.env.JWT_SECRET;
            expect(() => JWT_SECRET()).toThrow('JWT_SECRET');
        });
    });

    describe('JWT_EXPIRES_IN()', () => {
        it('defaults to 7d when unset (non-secret, safe default)', () => {
            delete process.env.JWT_EXPIRES_IN;
            expect(JWT_EXPIRES_IN()).toBe('7d');
        });

        it('uses the configured value when set', () => {
            process.env.JWT_EXPIRES_IN = '1d';
            expect(JWT_EXPIRES_IN()).toBe('1d');
        });
    });

    describe('CRON_SECRET()', () => {
        it('is undefined when not configured (fail-closed, not a fallback secret)', () => {
            delete process.env.CRON_SECRET;
            expect(CRON_SECRET()).toBeUndefined();
        });

        it('returns the configured value', () => {
            process.env.CRON_SECRET = 'cron-abc';
            expect(CRON_SECRET()).toBe('cron-abc');
        });
    });
});
