// tests/integration/assetsLendable.test.ts
// Interrupteur « prêtable » : route PATCH dédiée (admin) et filtre de liste
// qui alimente /loans/new.
import request from 'supertest';
import { createTestApp, mockRows, mockOk, asUser } from '../helpers/testApp';
import { db } from '../../src/database/connection';

const mockedQuery = db.query as jest.Mock;

describe('PATCH /api/assets/:id/lendable', () => {
    const app = createTestApp();
    beforeEach(() => { mockedQuery.mockReset(); });

    it('turns the flag on and writes an audit entry with old and new value', async () => {
        mockedQuery
            .mockResolvedValueOnce(mockRows([{ id: 12, is_lendable: 0 }]))   // existing
            .mockResolvedValueOnce(mockOk())                                 // update
            .mockResolvedValueOnce(mockOk());                                // audit_log

        const res = await request(app).patch('/api/assets/12/lendable').send({ is_lendable: true });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ success: true, id: 12, is_lendable: 1 });
        const update = mockedQuery.mock.calls.find(c => String(c[0]).includes('UPDATE assets SET is_lendable'));
        expect(update![1]).toEqual([1, 12]);
        const audit = mockedQuery.mock.calls.find(c => String(c[0]).includes('INSERT INTO audit_log'));
        expect(audit![1][1]).toBe('asset_lendable_changed');
    });

    it('is admin-only', async () => {
        const res = await request(app)
            .patch('/api/assets/12/lendable')
            .set(asUser({ role: 'user' }))
            .send({ is_lendable: true });

        expect(res.status).toBe(403);
        expect(mockedQuery).not.toHaveBeenCalled();
    });

    it('rejects a non-boolean value', async () => {
        const res = await request(app).patch('/api/assets/12/lendable').send({ is_lendable: 'yes' });
        expect(res.status).toBe(400);
    });

    it('404s on an unknown asset', async () => {
        mockedQuery.mockResolvedValueOnce(mockRows([]));
        const res = await request(app).patch('/api/assets/999/lendable').send({ is_lendable: false });
        expect(res.status).toBe(404);
    });
});

describe('GET /api/assets?lendable=1', () => {
    const app = createTestApp();
    beforeEach(() => { mockedQuery.mockReset(); });

    it('filters on is_lendable in both the count and the data query', async () => {
        mockedQuery
            .mockResolvedValueOnce(mockRows([{ count: 1 }]))
            .mockResolvedValueOnce(mockRows([{ id: 12, label: 'Canon C70', status: 'in_stock', is_lendable: 1 }]));

        const res = await request(app).get('/api/assets?lendable=1&limit=500');

        expect(res.status).toBe(200);
        expect(String(mockedQuery.mock.calls[0][0])).toContain('a.is_lendable = 1');
        expect(String(mockedQuery.mock.calls[1][0])).toContain('a.is_lendable = 1');
        expect(res.body.data[0].is_lendable).toBe(1);
    });

    it('does not filter when the parameter is absent', async () => {
        mockedQuery
            .mockResolvedValueOnce(mockRows([{ count: 0 }]))
            .mockResolvedValueOnce(mockRows([]));

        await request(app).get('/api/assets');

        expect(String(mockedQuery.mock.calls[0][0])).not.toContain('is_lendable = 1');
    });
});
