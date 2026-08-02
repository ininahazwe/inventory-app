// tests/helpers/testApp.ts
// Construit l'app Express réelle (mêmes routes, middlewares, gestion d'erreurs)
// pour des tests d'intégration via supertest — seules la DB, l'auth et Gmail sont mockées.
import { createApp } from '../../src/app';

export function createTestApp() {
    return createApp();
}

// mysql2 renvoie des tuples [rows, fields] — ces helpers construisent la même forme
// pour que db.execute.mockResolvedValueOnce(...) simule fidèlement une vraie réponse.
export const mockRows = (rows: any[]): [any[], any[]] => [rows, []];

export const mockOk = (overrides: Record<string, any> = {}): [any, any[]] => [
    { affectedRows: 1, insertId: 0, ...overrides },
    [],
];

// Header consommé par le mock de src/middleware/auth — override du req.user par test.
export const asUser = (user: Partial<{ uid: number; email: string; role: string }>) => ({
    'x-test-user': JSON.stringify(user),
});
