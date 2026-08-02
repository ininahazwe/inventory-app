// tests/integration/supplies.test.ts
// Vraie app Express (mêmes routes/middlewares), DB mockée. Couvre le comportement
// transactionnel ajouté sur POST /api/supplies : l'écriture du ledger (supply_movements)
// fait partie de la même transaction que la création de la supply — si elle échoue,
// tout échoue (avant le correctif, l'erreur du ledger était avalée silencieusement).
import request from 'supertest';
import { createTestApp } from '../helpers/testApp';
import { mockRows, mockOk } from '../helpers/testApp';
import { db } from '../../src/database/connection';

const mockedExecute = db.execute as jest.Mock;
const mockedQuery = db.query as jest.Mock;

describe('POST /api/supplies', () => {
    const app = createTestApp();

    beforeEach(() => {
        mockedExecute.mockReset();
        mockedQuery.mockReset();
        mockedQuery.mockResolvedValue(mockRows([])); // logAudit -> INSERT INTO audit_log (résultat non vérifié)
    });

    const validPayload = {
        name: 'Printer Paper',
        purchase_date: '2026-08-02',
        cost: 150,
        quantity: 10,
        receiver_uid: 'receiver@mfwa.org',
    };

    it('rejects when required fields are missing', async () => {
        const res = await request(app).post('/api/supplies').send({ name: 'Only name' });
        expect(res.status).toBe(400);
        expect(mockedExecute).not.toHaveBeenCalled();
    });

    it('returns 404 when the receiver email does not match a user', async () => {
        mockedExecute.mockResolvedValueOnce(mockRows([])); // lookup receiver -> aucun user

        const res = await request(app).post('/api/supplies').send(validPayload);

        expect(res.status).toBe(404);
        expect(res.body.error).toMatch(/user/i);
    });

    it('rejects an invalid or non-supply category', async () => {
        mockedExecute
            .mockResolvedValueOnce(mockRows([{ id: 'user-1' }])) // lookup receiver OK
            .mockResolvedValueOnce(mockRows([])); // category lookup -> vide (type != supply ou inexistante)

        const res = await request(app)
            .post('/api/supplies')
            .send({ ...validPayload, category_id: 99 });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/category/i);
    });

    it('creates the supply and records a purchase movement in the same transaction', async () => {
        mockedExecute
            .mockResolvedValueOnce(mockRows([{ id: 'user-1' }]))       // lookup receiver
            .mockResolvedValueOnce(mockOk({ insertId: 42 }))            // INSERT supplies (tx)
            .mockResolvedValueOnce(mockOk({ insertId: 100 }))           // INSERT supply_movements (tx)
            .mockResolvedValueOnce(mockRows([{                         // fetch created supply
                id: 42,
                name: validPayload.name,
                purchase_date: validPayload.purchase_date,
                cost: validPayload.cost,
                quantity: validPayload.quantity,
                receiver_email: validPayload.receiver_uid,
                category_name: null,
            }]));

        const res = await request(app).post('/api/supplies').send(validPayload);

        expect(res.status).toBe(201);
        expect(res.body.id).toBe(42);

        // 2e appel execute = INSERT supplies, 3e = INSERT supply_movements (type purchase, qty = quantity)
        const insertSupplyCall = mockedExecute.mock.calls[1];
        expect(insertSupplyCall[0]).toMatch(/INSERT INTO supplies/);

        const insertMovementCall = mockedExecute.mock.calls[2];
        expect(insertMovementCall[0]).toMatch(/INSERT INTO supply_movements/);
        expect(insertMovementCall[1]).toEqual(
            expect.arrayContaining([42, 'purchase', 10, validPayload.purchase_date])
        );
    });

    it('rejects a negative low_stock_threshold', async () => {
        const res = await request(app)
            .post('/api/supplies')
            .send({ ...validPayload, low_stock_threshold: -1 });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/low_stock_threshold/);
        expect(mockedExecute).not.toHaveBeenCalled();
    });

    it('accepts and stores a valid low_stock_threshold', async () => {
        mockedExecute
            .mockResolvedValueOnce(mockRows([{ id: 'user-1' }]))       // lookup receiver
            .mockResolvedValueOnce(mockOk({ insertId: 42 }))            // INSERT supplies (tx)
            .mockResolvedValueOnce(mockOk({ insertId: 100 }))           // INSERT supply_movements (tx)
            .mockResolvedValueOnce(mockRows([{ id: 42, name: validPayload.name, low_stock_threshold: 5 }]));

        const res = await request(app)
            .post('/api/supplies')
            .send({ ...validPayload, low_stock_threshold: 5 });

        expect(res.status).toBe(201);
        const insertSupplyCall = mockedExecute.mock.calls[1];
        expect(insertSupplyCall[0]).toMatch(/INSERT INTO supplies/);
        expect(insertSupplyCall[1]).toEqual(expect.arrayContaining([5]));
    });

    it('fails the whole request if the ledger write fails inside the transaction', async () => {
        mockedExecute
            .mockResolvedValueOnce(mockRows([{ id: 'user-1' }]))       // lookup receiver
            .mockResolvedValueOnce(mockOk({ insertId: 42 }))            // INSERT supplies (tx)
            .mockRejectedValueOnce(new Error('ledger insert failed'));  // INSERT supply_movements (tx) -> échoue

        const res = await request(app).post('/api/supplies').send(validPayload);

        expect(res.status).toBe(500);
        // La lecture de la supply créée (4e appel execute) ne doit JAMAIS survenir:
        // la transaction a échoué avant, donc rien n'a été "commité" côté logique métier.
        expect(mockedExecute).toHaveBeenCalledTimes(3);
    });
});
