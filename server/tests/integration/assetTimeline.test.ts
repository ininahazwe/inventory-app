// tests/integration/assetTimeline.test.ts
// Vraie app Express, DB mockée. Couvre GET /api/assets/:id/timeline : fusion de
// 4 sources (assignments, lifecycle_events, incidents, auctions) en une seule
// frise triée par date décroissante.
import request from 'supertest';
import { createTestApp } from '../helpers/testApp';
import { mockRows } from '../helpers/testApp';
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
            }]));

        const res = await request(app).get('/api/assets/1/timeline');

        expect(res.status).toBe(200);
        expect(res.body.events).toHaveLength(4);

        // Trié du plus récent au plus ancien: repair (2026-02-01) > incident (2026-01-20)
        // > assignment (2026-01-05) > auction (2025-12-01)
        expect(res.body.events.map((e: any) => e.type)).toEqual(['repair', 'incident', 'assignment', 'auction']);
        expect(res.body.events[0].title).toMatch(/repair/i);
        expect(res.body.events[3].detail).toMatch(/winner@mfwa\.org/);
    });
});
