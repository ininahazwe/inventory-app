// src/database/__mocks__/connection.ts
// Mock manuel (jest.mock('../../src/database/connection')) — aucune vraie connexion MySQL.
// Chaque route appelle db.execute / db.query / db.transaction ; ce mock permet aux tests
// de contrôler les réponses via db.execute.mockResolvedValueOnce([[...rows]]) etc.,
// sans dépendre d'une base de données réelle (absente de ce sandbox).
const execute = jest.fn();
const query = jest.fn();

// Le mock délègue à execute / query pour que les tests n'aient qu'un seul point de
// contrôle, que le code sous test passe par tx.execute ou db.execute.
const transaction = jest.fn(async (fn: (tx: { execute: typeof execute; query: typeof query }) => Promise<unknown>) => {
    return fn({ execute, query });
});

export const db = { execute, query, transaction };

export function getPool() {
    throw new Error('getPool() should not be called directly in tests — use the db mock');
}

export async function initializePool() {
    return undefined;
}
