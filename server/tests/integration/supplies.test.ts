// tests/integration/supplies.test.ts
// Vraie app Express (mêmes routes/middlewares), DB mockée. Phase 3 : POST
// /api/supplies est un adaptateur qui écrit via supplyLedger.postReceipt()
// dans les nouvelles tables (supply_receipts / supply_receipt_lines /
// supply_stock_ledger), plus jamais dans l'ancienne table `supplies`.
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

    it('rejects an item name that does not match an existing supply item', async () => {
        mockedExecute
            .mockResolvedValueOnce(mockRows([{ id: 'user-1' }])) // lookup receiver OK
            .mockResolvedValueOnce(mockRows([])); // item lookup -> aucune correspondance

        const res = await request(app).post('/api/supplies').send(validPayload);

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/unknown item/i);
    });

    it('creates the receipt line and records a receipt movement in the same transaction', async () => {
        // Ordre réel de supplyLedger.postReceipt(): l'en-tête supply_receipts est
        // inséré AVANT le verrou (lockItem) sur l'article, lui-même avant la ligne
        // et l'écriture du ledger.
        mockedExecute
            .mockResolvedValueOnce(mockRows([{ id: 'user-1' }]))            // lookup receiver
            .mockResolvedValueOnce(mockRows([{ id: 5, category_id: null }])) // item lookup
            .mockResolvedValueOnce(mockOk({ insertId: 900 }))                // INSERT supply_receipts (tx, en-tête)
            .mockResolvedValueOnce(mockRows([{ id: 5 }]))                    // lockItem (tx, FOR UPDATE)
            .mockResolvedValueOnce(mockOk({ insertId: 42 }))                 // INSERT supply_receipt_lines (tx)
            .mockResolvedValueOnce(mockOk({ insertId: 100 }))                // INSERT supply_stock_ledger (tx)
            .mockResolvedValueOnce(mockRows([{                              // fetch created row
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

        const insertReceiptCall = mockedExecute.mock.calls[2];
        expect(insertReceiptCall[0]).toMatch(/INSERT INTO supply_receipts/);

        const insertLineCall = mockedExecute.mock.calls[4];
        expect(insertLineCall[0]).toMatch(/INSERT INTO supply_receipt_lines/);

        const insertLedgerCall = mockedExecute.mock.calls[5];
        expect(insertLedgerCall[0]).toMatch(/INSERT INTO supply_stock_ledger/);
        expect(insertLedgerCall[0]).toMatch(/'receipt'/);
        expect(insertLedgerCall[1]).toEqual(
            expect.arrayContaining([5, validPayload.purchase_date, 10])
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

    it('accepts a valid low_stock_threshold and stores it on the item (shared across its lots)', async () => {
        mockedExecute
            .mockResolvedValueOnce(mockRows([{ id: 'user-1' }]))            // lookup receiver
            .mockResolvedValueOnce(mockRows([{ id: 5, category_id: null }])) // item lookup
            .mockResolvedValueOnce(mockOk({ insertId: 900 }))                // INSERT supply_receipts (tx, en-tête)
            .mockResolvedValueOnce(mockRows([{ id: 5 }]))                    // lockItem (tx)
            .mockResolvedValueOnce(mockOk({ insertId: 42 }))                 // INSERT supply_receipt_lines (tx)
            .mockResolvedValueOnce(mockOk({ insertId: 100 }))                // INSERT supply_stock_ledger (tx)
            .mockResolvedValueOnce(mockOk())                                 // UPDATE supply_items (tx) -- reorder_point
            .mockResolvedValueOnce(mockRows([{ id: 42, name: validPayload.name, low_stock_threshold: 5 }]));

        const res = await request(app)
            .post('/api/supplies')
            .send({ ...validPayload, low_stock_threshold: 5 });

        expect(res.status).toBe(201);
        const updateItemCall = mockedExecute.mock.calls[6];
        expect(updateItemCall[0]).toMatch(/UPDATE supply_items/);
        expect(updateItemCall[1]).toEqual(expect.arrayContaining([5]));
    });

    it('fails the whole request if the ledger write fails inside the transaction', async () => {
        mockedExecute
            .mockResolvedValueOnce(mockRows([{ id: 'user-1' }]))            // lookup receiver
            .mockResolvedValueOnce(mockRows([{ id: 5, category_id: null }])) // item lookup
            .mockResolvedValueOnce(mockOk({ insertId: 900 }))                // INSERT supply_receipts (tx, en-tête)
            .mockResolvedValueOnce(mockRows([{ id: 5 }]))                    // lockItem (tx)
            .mockResolvedValueOnce(mockOk({ insertId: 42 }))                 // INSERT supply_receipt_lines (tx)
            .mockRejectedValueOnce(new Error('ledger insert failed'));       // INSERT supply_stock_ledger (tx) -> échoue

        const res = await request(app).post('/api/supplies').send(validPayload);

        expect(res.status).toBe(500);
        // La lecture après coup (7e appel) ne doit jamais survenir : la
        // transaction a échoué avant, rien n'a été "commité" côté métier.
        expect(mockedExecute).toHaveBeenCalledTimes(6);
    });
});
