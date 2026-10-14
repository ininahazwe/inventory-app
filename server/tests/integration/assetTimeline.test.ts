// tests/integration/assetTimeline.test.ts
// Vraie app Express, DB mockée. Couvre GET /api/assets/:id/timeline : fusion de
// 5 sources (assignments, lifecycle_events, incidents, auctions, loans) en une seule
// frise triée par date décroissante.
import request from 'supertest';
import { createTestApp } from '../helpers/testApp';
import { mockRows, asUser } from '../helpers/testApp';
import { db } from '../../src/database/connection';

const mockedExecute = db.execute as jest.Mock;

describe('GET /api/assets/:id/timeline', () => {
    const app = createTestApp();

    beforeEach(() => {
        mockedExecute.mockReset();
    });

    it('rejects a non-numeric asset id', async () => {
        const res = await request(app).get('/api/assets/not-a-number/timeline');
        expect(res.status).toBe(400);
    });

    it('returns 404 when the asset does not exist', async () => {
        mockedExecute.mockResolvedValueOnce(mockRows([])); // asset check
        const res = await request(app).get('/api/assets/1/timeline');
        expect(res.status).toBe(404);
    });

    it('merges assignments, lifecycle events, incidents and auctions sorted by date desc', async () => {
        mockedExecute
            .mockResolvedValueOnce(mockRows([{ id: 1 }])) // asset check
            .mockResolvedValueOnce(mockRows([{             // assignments
                id: 10, assignee_name: 'James', assignee_email: 'james@mfwa.org',
                assigned_at: '2026-01-05', returned_at: null, status: 'active', created_at: '2026-01-05T09:00:00.000Z',
            }]))
            .mockResolvedValueOnce(mockRows([{             // lifecycle_events
                id: 20, event_type: 'repair', event_date: '2026-02-01', notes: 'Sent for repair',
                created_at: '2026-02-01T09:00:00.000Z', created_by: 'admin@mfwa.org', status: 'open', resolved_at: null,
            }]))
            .mockResolvedValueOnce(mockRows([{             // incidents
                id: 30, incident_type: 'damage', title: 'Screen cracked', severity: 'high',
                description: 'Dropped', status: 'resolved', reported_by_email: 'u@mfwa.org',
                created_at: '2026-01-20T09:00:00.000Z', resolved_at: '2026-01-22T09:00:00.000Z',
            }]))
            .mockResolvedValueOnce(mockRows([{             // auctions
                id: 40, starting_price: 100, current_highest_bid: 150, status: 'ended',
                created_at: '2025-12-01T09:00:00.000Z', end_date: '2025-12-08T09:00:00.000Z',
                winner_uid: 'u-1', winner_email: 'winner@mfwa.org', bid_count: 3,
            }]))
            .mockResolvedValueOnce(mockRows([]));          // loans

        const res = await request(app).get('/api/assets/1/timeline');

        expect(res.status).toBe(200);
        expect(res.body.events).toHaveLength(4);

        // Trié du plus récent au plus ancien: repair (2026-02-01) > incident (2026-01-20)
        // > assignment (2026-01-05) > auction (2025-12-01)
        expect(res.body.events.map((e: any) => e.type)).toEqual(['repair', 'incident', 'assignment', 'auction']);
        expect(res.body.events[0].title).toMatch(/repair/i);
        expect(res.body.events[3].detail).toMatch(/winner@mfwa\.org/);
    });

    // Sources mockées dans l'ordre : assignments, lifecycle, incidents, auctions, loans.
    const withLoans = (loans: any[]) => {
        mockedExecute
            .mockResolvedValueOnce(mockRows([{ id: 1 }]))
            .mockResolvedValueOnce(mockRows([]))
            .mockResolvedValueOnce(mockRows([]))
            .mockResolvedValueOnce(mockRows([]))
            .mockResolvedValueOnce(mockRows([]))
            .mockResolvedValueOnce(mockRows(loans));
    };

    it('adds one entry per loan, linked to its page, with lateness and condition on return', async () => {
        withLoans([{
            id: 7, borrower_email: 'b@mfwa.org', purpose: 'Field shoot',
            start_date: '2026-10-01', due_date: '2026-10-05', status: 'returned',
            requested_at: '2026-09-28T09:00:00.000Z', checked_out_at: '2026-10-01T09:00:00.000Z',
            returned_at: '2026-10-08T09:00:00.000Z', condition_out: 'good', condition_in: 'fair',
            extended_count: 1, incident_id: null, created_at: '2026-09-28T09:00:00.000Z', is_overdue: 0,
        }]);

        const res = await request(app).get('/api/assets/1/timeline');

        expect(res.status).toBe(200);
        expect(res.body.events).toHaveLength(1);
        expect(res.body.events[0]).toMatchObject({
            type: 'loan', title: 'Loan to b@mfwa.org (returned)', status: 'returned',
            source_id: 7, link: '/loans/7',
        });
        expect(res.body.events[0].detail).toContain('2026-10-01 → 2026-10-05');
        expect(res.body.events[0].detail).toContain('returned 3 days late');
        expect(res.body.events[0].detail).toContain('back: fair');
        expect(res.body.events[0].at).toBe('2026-10-01T09:00:00.000Z'); // la sortie, pas la demande
    });

    it('flags a loan that is out past its due date as overdue', async () => {
        withLoans([{
            id: 8, borrower_email: 'b@mfwa.org', purpose: null, start_date: '2026-09-01', due_date: '2026-09-10',
            status: 'checked_out', requested_at: '2026-08-30T09:00:00.000Z', checked_out_at: '2026-09-01T09:00:00.000Z',
            returned_at: null, condition_out: 'good', condition_in: null, extended_count: 0, incident_id: null,
            created_at: '2026-08-30T09:00:00.000Z', is_overdue: 1,
        }]);

        const res = await request(app).get('/api/assets/1/timeline');

        expect(res.body.events[0].title).toBe('Overdue — Out on loan to b@mfwa.org');
        expect(res.body.events[0].status).toBe('overdue');
    });

    it('limits a non-admin to their own loans', async () => {
        mockedExecute
            .mockResolvedValueOnce(mockRows([{ id: 1 }]))   // asset exists
            .mockResolvedValueOnce(mockRows([{ id: 1 }]))   // entrusted to the user
            .mockResolvedValueOnce(mockRows([]))
            .mockResolvedValueOnce(mockRows([]))
            .mockResolvedValueOnce(mockRows([]))
            .mockResolvedValueOnce(mockRows([]))
            .mockResolvedValueOnce(mockRows([]));            // loans

        await request(app)
            .get('/api/assets/1/timeline')
            .set(asUser({ email: 'me@mfwa.org', role: 'user' }));

        const loanCall = mockedExecute.mock.calls[6];
        expect(String(loanCall[0])).toContain('borrower_email = ?');
        expect(loanCall[1]).toEqual([1, 'me@mfwa.org', 'me@mfwa.org']);
    });

    it('403s a non-admin on an asset that is not entrusted to them', async () => {
        mockedExecute
            .mockResolvedValueOnce(mockRows([{ id: 1 }]))
            .mockResolvedValueOnce(mockRows([]));
        const res = await request(app)
            .get('/api/assets/1/timeline')
            .set(asUser({ email: 'me@mfwa.org', role: 'user' }));
        expect(res.status).toBe(403);
    });

    it('lets an admin see every loan of the asset', async () => {
        withLoans([]);

        await request(app).get('/api/assets/1/timeline');

        const loanCall = mockedExecute.mock.calls[5];
        expect(String(loanCall[0])).not.toContain('borrower_email = ?');
        expect(loanCall[1]).toEqual([1]);
    });
});
