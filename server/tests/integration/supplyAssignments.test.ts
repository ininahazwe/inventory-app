// tests/integration/supplyAssignments.test.ts
// Vraie app Express, DB mockée. Phase 3 : POST /api/supply-assignments résout
// le lot (supply_id, comme avant) vers son article puis écrit exclusivement
// via supplyLedger.postIssue() — le verrou anti-survente (FOR UPDATE) et le
// contrôle de disponibilité vivent maintenant dans le service, au niveau de
// l'article (stock mutualisé entre tous les lots du même article).
import request from 'supertest';
import { createTestApp } from '../helpers/testApp';
import { mockRows, mockOk } from '../helpers/testApp';
import { db } from '../../src/database/connection';

const mockedExecute = db.execute as jest.Mock;
const mockedQuery = db.query as jest.Mock;

describe('POST /api/supply-assignments', () => {
    const app = createTestApp();

    beforeEach(() => {
        mockedExecute.mockReset();
        mockedQuery.mockReset();
        mockedQuery.mockResolvedValue(mockRows([]));
    });

    const validPayload = {
        supply_id: 5,
        assigned_user_id: 'user-1',
        quantity_assigned: 3,
        assigned_at: '2026-08-02',
    };

    it('rejects when neither assigned_user_id nor location_id is provided', async () => {
        const { assigned_user_id, ...rest } = validPayload;
        const res = await request(app).post('/api/supply-assignments').send(rest);
        expect(res.status).toBe(400);
    });

    it('rejects a non-positive or non-integer quantity', async () => {
        const res = await request(app)
            .post('/api/supply-assignments')
            .send({ ...validPayload, quantity_assigned: 0 });
        expect(res.status).toBe(400);
    });

    it('rejects when requested quantity exceeds available stock (verrou FOR UPDATE au niveau article)', async () => {
        // Ordre réel de supplyLedger.postIssue(): l'en-tête supply_issues est
        // inséré AVANT le verrou (lockItem), lui-même avant le contrôle de stock.
        mockedExecute
            .mockResolvedValueOnce(mockRows([{ id: 'user-1', email: 'u@mfwa.org' }])) // lookup user
            .mockResolvedValueOnce(mockRows([{ item_id: 7, name: 'Paper' }]))         // résolution lot -> article
            .mockResolvedValueOnce(mockOk({ insertId: 900 }))                         // INSERT supply_issues (tx, en-tête)
            .mockResolvedValueOnce(mockRows([{ id: 7 }]))                             // lockItem (tx, FOR UPDATE)
            .mockResolvedValueOnce(mockRows([{ qty: 2 }]));                           // stock courant de l'article (tx)
        // available = 2, on demande 3 -> doit être refusé

        const res = await request(app)
            .post('/api/supply-assignments')
            .send({ ...validPayload, quantity_assigned: 3 });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/2 units available/);

        // L'INSERT de la ligne ne doit jamais avoir lieu si le stock est insuffisant
        expect(mockedExecute).toHaveBeenCalledTimes(5);
    });

    it('creates the assignment and records an issue movement when stock is sufficient', async () => {
        mockedExecute
            .mockResolvedValueOnce(mockRows([{ id: 'user-1', email: 'u@mfwa.org' }])) // lookup user
            .mockResolvedValueOnce(mockRows([{ item_id: 7, name: 'Paper' }]))         // résolution lot -> article
            .mockResolvedValueOnce(mockOk({ insertId: 900 }))                         // INSERT supply_issues (tx, en-tête)
            .mockResolvedValueOnce(mockRows([{ id: 7 }]))                             // lockItem (tx)
            .mockResolvedValueOnce(mockRows([{ qty: 8 }]))                            // stock courant (tx) -> available
            .mockResolvedValueOnce(mockRows([{ avg_cost: 12.5 }]))                    // coût moyen courant (tx)
            .mockResolvedValueOnce(mockOk({ insertId: 77 }))                          // INSERT supply_issue_lines (tx)
            .mockResolvedValueOnce(mockOk({ insertId: 200 }))                         // INSERT supply_stock_ledger (tx)
            .mockResolvedValueOnce(mockRows([{ id: 77, supply_id: 7, quantity_assigned: 3, status: 'active' }])); // fetch

        const res = await request(app)
            .post('/api/supply-assignments')
            .send({ ...validPayload, quantity_assigned: 3 });

        expect(res.status).toBe(201);
        expect(res.body.id).toBe(77);

        const insertLedgerCall = mockedExecute.mock.calls[7];
        expect(insertLedgerCall[0]).toMatch(/INSERT INTO supply_stock_ledger/);
        expect(insertLedgerCall[0]).toMatch(/'issue'/);
        expect(insertLedgerCall[1]).toEqual(
            expect.arrayContaining([7, '2026-08-02', -3])
        );
    });

    it('returns 404 when the supply (lot) does not exist', async () => {
        mockedExecute
            .mockResolvedValueOnce(mockRows([{ id: 'user-1', email: 'u@mfwa.org' }])) // lookup user
            .mockResolvedValueOnce(mockRows([])); // résolution lot -> introuvable

        const res = await request(app).post('/api/supply-assignments').send(validPayload);

        expect(res.status).toBe(404);
    });
});

describe('PATCH /api/supply-assignments/:id (return)', () => {
    const app = createTestApp();

    beforeEach(() => {
        mockedExecute.mockReset();
        mockedQuery.mockReset();
        mockedQuery.mockResolvedValue(mockRows([]));
    });

    it('posts a reversing ledger entry when transitioning active -> returned', async () => {
        const activeRow = {
            id: 77, supply_id: 7, supply_name: 'Paper', status: 'active', returned_at: null,
            quantity_assigned: 3, _line_id: 501, _item_id: 7, _quantity_base: 3, _returned_qty: 0, _orig_ledger_id: 200,
        };
        const returnedRow = { ...activeRow, status: 'returned', returned_at: '2026-08-10' };

        mockedExecute
            .mockResolvedValueOnce(mockRows([activeRow]))                                    // fetch old
            .mockResolvedValueOnce(mockRows([{ id: 501, item_id: 7, quantity_base: 3, destination_location_id: null }])) // postReturn: issue line (tx, FOR UPDATE)
            .mockResolvedValueOnce(mockRows([{ id: 200, unit_cost_base: 12.5 }]))              // postReturn: ledger d'origine (tx)
            .mockResolvedValueOnce(mockRows([{ already_returned: 0 }]))                        // postReturn: déjà retourné (tx)
            .mockResolvedValueOnce(mockOk({ insertId: 300 }))                                  // INSERT supply_stock_ledger reason='return' (tx)
            .mockResolvedValueOnce(mockRows([returnedRow]));                                   // fetch new

        const res = await request(app)
            .patch('/api/supply-assignments/77')
            .send({ status: 'returned', returned_at: '2026-08-10' });

        expect(res.status).toBe(200);
        expect(res.body.status).toBe('returned');

        const insertReturnCall = mockedExecute.mock.calls[4];
        expect(insertReturnCall[0]).toMatch(/INSERT INTO supply_stock_ledger/);
        expect(insertReturnCall[0]).toMatch(/'return'/);
        expect(insertReturnCall[1]).toEqual(expect.arrayContaining([7, '2026-08-10', 3]));
    });
});
