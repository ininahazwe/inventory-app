// tests/integration/supplyAssignments.test.ts
// Vraie app Express, DB mockée. Couvre le verrou anti-survente ajouté sur
// POST /api/supply-assignments : la vérification du stock disponible et l'insert
// tournent dans la même transaction (SELECT ... FOR UPDATE), donc deux requêtes
// concurrentes ne peuvent plus toutes les deux passer le contrôle "available".
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

    it('rejects when requested quantity exceeds available stock (verrou FOR UPDATE)', async () => {
        mockedExecute
            .mockResolvedValueOnce(mockRows([{ id: 'user-1', email: 'u@mfwa.org' }])) // lookup user
            .mockResolvedValueOnce(mockRows([{ id: 5, name: 'Paper', quantity: 10 }])) // supply FOR UPDATE (tx)
            .mockResolvedValueOnce(mockRows([{ active_qty: 8 }]));                     // stock déjà assigné (tx)
        // available = 10 - 8 = 2, on demande 3 -> doit être refusé

        const res = await request(app)
            .post('/api/supply-assignments')
            .send({ ...validPayload, quantity_assigned: 3 });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/2 units available/);

        // L'INSERT ne doit jamais avoir lieu si le stock est insuffisant
        expect(mockedExecute).toHaveBeenCalledTimes(3);
    });

    it('creates the assignment and records an issue movement when stock is sufficient', async () => {
        mockedExecute
            .mockResolvedValueOnce(mockRows([{ id: 'user-1', email: 'u@mfwa.org' }])) // lookup user
            .mockResolvedValueOnce(mockRows([{ id: 5, name: 'Paper', quantity: 10 }])) // supply FOR UPDATE (tx)
            .mockResolvedValueOnce(mockRows([{ active_qty: 2 }]))                      // available = 8
            .mockResolvedValueOnce(mockOk({ insertId: 77 }))                           // INSERT supply_assignments (tx)
            .mockResolvedValueOnce(mockOk({ insertId: 200 }))                          // INSERT supply_movements (tx)
            .mockResolvedValueOnce(mockRows([{ id: 77, supply_id: 5, quantity_assigned: 3, status: 'active' }])); // fetch

        const res = await request(app)
            .post('/api/supply-assignments')
            .send({ ...validPayload, quantity_assigned: 3 });

        expect(res.status).toBe(201);
        expect(res.body.id).toBe(77);

        const insertMovementCall = mockedExecute.mock.calls[4];
        expect(insertMovementCall[0]).toMatch(/INSERT INTO supply_movements/);
        expect(insertMovementCall[1]).toEqual(
            expect.arrayContaining([5, 'issue', -3])
        );
    });

    it('returns 404 when the supply does not exist', async () => {
        mockedExecute
            .mockResolvedValueOnce(mockRows([{ id: 'user-1', email: 'u@mfwa.org' }])) // lookup user
            .mockResolvedValueOnce(mockRows([])); // supply FOR UPDATE (tx) -> introuvable

        const res = await request(app).post('/api/supply-assignments').send(validPayload);

        expect(res.status).toBe(404);
    });
});
