// tests/integration/auctionBids.test.ts
// Vraie app Express, DB mockée. Couvre le verrou FOR UPDATE ajouté sur
// POST /api/auctions/:id/bids : lecture + validation minBid + insert + update
// tournent dans la même transaction, verrouillant la ligne auction — deux enchères
// concurrentes ne peuvent plus toutes les deux passer le contrôle minBid.
import request from 'supertest';
import { createTestApp } from '../helpers/testApp';
import { mockRows, mockOk } from '../helpers/testApp';
import { db } from '../../src/database/connection';

const mockedExecute = db.execute as jest.Mock;
const mockedQuery = db.query as jest.Mock;

describe('POST /api/auctions/:id/bids', () => {
    const app = createTestApp();

    beforeEach(() => {
        mockedExecute.mockReset();
        mockedQuery.mockReset();
    });

    it('rejects a non-numeric auction id', async () => {
        const res = await request(app).post('/api/auctions/not-a-number/bids').send({ amount: 100 });
        expect(res.status).toBe(400);
    });

    it('rejects a zero or negative bid amount', async () => {
        const res = await request(app).post('/api/auctions/1/bids').send({ amount: 0 });
        expect(res.status).toBe(400);
    });

    it('returns 400 when the bidder has no email on file', async () => {
        mockedQuery.mockResolvedValueOnce(mockRows([])); // bidderCheck -> aucun user

        const res = await request(app).post('/api/auctions/1/bids').send({ amount: 100 });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/bidder email/i);
        // Rien ne doit être inséré si le bidder n'est pas identifiable
        expect(mockedExecute).not.toHaveBeenCalled();
    });

    it('returns 404 when the auction does not exist', async () => {
        mockedQuery
            .mockResolvedValueOnce(mockRows([{ email: 'bidder@mfwa.org' }])) // bidderCheck
            .mockResolvedValueOnce(mockRows([]));                            // auction FOR UPDATE (tx) -> introuvable

        const res = await request(app).post('/api/auctions/1/bids').send({ amount: 100 });

        expect(res.status).toBe(404);
    });

    it('rejects a bid on a non-active auction', async () => {
        mockedQuery
            .mockResolvedValueOnce(mockRows([{ email: 'bidder@mfwa.org' }]))
            .mockResolvedValueOnce(mockRows([{
                id: 1, status: 'ended', starting_price: 100, current_highest_bid: null,
                created_by_uid: 2, label: 'Office Chair',
            }]));

        const res = await request(app).post('/api/auctions/1/bids').send({ amount: 150 });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/not active/i);
    });

    it('rejects a bid below the minimum (starting price, no prior bid)', async () => {
        mockedQuery
            .mockResolvedValueOnce(mockRows([{ email: 'bidder@mfwa.org' }]))
            .mockResolvedValueOnce(mockRows([{
                id: 1, status: 'active', starting_price: 100, current_highest_bid: null,
                created_by_uid: 2, label: 'Office Chair',
            }]));

        const res = await request(app).post('/api/auctions/1/bids').send({ amount: 99 });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/at least 100/);
        expect(mockedExecute).not.toHaveBeenCalled();
    });

    it('rejects a bid that only matches the current highest (must exceed by at least 1)', async () => {
        mockedQuery
            .mockResolvedValueOnce(mockRows([{ email: 'bidder@mfwa.org' }]))
            .mockResolvedValueOnce(mockRows([{
                id: 1, status: 'active', starting_price: 100, current_highest_bid: 150,
                created_by_uid: 2, label: 'Office Chair',
            }]));

        const res = await request(app).post('/api/auctions/1/bids').send({ amount: 150 });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/at least 151/);
    });

    it('accepts a valid bid, inserts it and updates current_highest_bid atomically', async () => {
        mockedQuery
            .mockResolvedValueOnce(mockRows([{ email: 'bidder@mfwa.org' }]))     // bidderCheck
            .mockResolvedValueOnce(mockRows([{                                   // auction FOR UPDATE (tx)
                id: 1, status: 'active', starting_price: 100, current_highest_bid: 150,
                created_by_uid: 2, label: 'Office Chair',
            }]))
            .mockResolvedValueOnce(mockRows([{ email: 'creator@mfwa.org' }]))    // creatorData (post-commit)
            .mockResolvedValueOnce(mockRows([]))                                 // previousBidders (post-commit)
            .mockResolvedValueOnce(mockRows([]));                                // logAudit insert

        mockedExecute
            .mockResolvedValueOnce(mockOk({ insertId: 55 }))  // INSERT bids (tx)
            .mockResolvedValueOnce(mockOk());                 // UPDATE auctions current_highest_bid (tx)

        const res = await request(app).post('/api/auctions/1/bids').send({ amount: 160 });

        expect(res.status).toBe(201);
        expect(res.body.id).toBe(55);
        expect(res.body.amount).toBe(160);

        expect(mockedExecute.mock.calls[0][0]).toMatch(/INSERT INTO bids/);
        expect(mockedExecute.mock.calls[1][0]).toMatch(/UPDATE auctions SET current_highest_bid/);
        expect(mockedExecute.mock.calls[1][1]).toEqual([160, 1]);
    });
});
