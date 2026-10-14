// Role-based access in the Incidents module.
import request from 'supertest';
import { createTestApp, mockRows, mockOk, asUser } from '../helpers/testApp';
import { db } from '../../src/database/connection';

const mockedQuery = db.query as jest.Mock;
const user = asUser({ role: 'user', email: 'ama@mfwa.org', uid: 'u-1' } as any);
const incident = { id: 3, asset_id: 9, asset_label: 'Laptop', reported_by_email: 'other@mfwa.org', assigned_to: 'tech@mfwa.org', notes: 'internal', status: 'open' };

describe('Incidents access control', () => {
    const app = createTestApp();
    beforeEach(() => { mockedQuery.mockReset(); });

    it('list: admin gets everything, unfiltered', async () => {
        mockedQuery.mockResolvedValueOnce(mockRows([incident]));
        const res = await request(app).get('/api/incidents');
        expect(res.status).toBe(200);
        expect(String(mockedQuery.mock.calls[0][0])).not.toContain('WHERE');
        expect(res.body[0].notes).toBe('internal');
    });

    it('list: user is limited to own reports / entrusted assets and loses admin fields', async () => {
        mockedQuery.mockResolvedValueOnce(mockRows([incident]));
        const res = await request(app).get('/api/incidents').set(user);
        expect(String(mockedQuery.mock.calls[0][0])).toContain('i.reported_by_email = ?');
        expect(mockedQuery.mock.calls[0][1]).toEqual(['ama@mfwa.org', 'u-1', 'ama@mfwa.org', 'ama@mfwa.org']);
        expect(res.body[0].notes).toBeNull();
        expect(res.body[0].assigned_to).toBeNull();
    });

    it('detail: user can open an incident they reported', async () => {
        mockedQuery.mockResolvedValueOnce(mockRows([{ ...incident, reported_by_email: 'ama@mfwa.org' }]));
        const res = await request(app).get('/api/incidents/3').set(user);
        expect(res.status).toBe(200);
        expect(res.body.notes).toBeNull();
    });

    it('detail: user can open an incident on an asset entrusted to them', async () => {
        mockedQuery.mockResolvedValueOnce(mockRows([incident])).mockResolvedValueOnce(mockRows([{ id: 9 }]));
        const res = await request(app).get('/api/incidents/3').set(user);
        expect(res.status).toBe(200);
    });

    it('detail: 403 otherwise', async () => {
        mockedQuery.mockResolvedValueOnce(mockRows([incident])).mockResolvedValueOnce(mockRows([]));
        const res = await request(app).get('/api/incidents/3').set(user);
        expect(res.status).toBe(403);
    });

    it('create: user cannot report on an asset that is not theirs', async () => {
        mockedQuery.mockResolvedValueOnce(mockRows([]));
        const res = await request(app).post('/api/incidents').set(user).send({ asset_id: 9, description: 'x' });
        expect(res.status).toBe(403);
        expect(mockedQuery).toHaveBeenCalledTimes(1);
    });

    it('create: user can report on their own asset', async () => {
        mockedQuery
            .mockResolvedValueOnce(mockRows([{ id: 9 }]))
            .mockResolvedValueOnce(mockOk({ insertId: 11 }))
            .mockResolvedValueOnce(mockRows([]));
        const res = await request(app).post('/api/incidents').set(user).send({ asset_id: 9, description: 'x' });
        expect(res.status).toBe(201);
        expect(res.body.id).toBe(11);
    });

    it.each(['status', 'assign', 'notes'])('PATCH /:id/%s is admin-only', async (action) => {
        const res = await request(app).patch(`/api/incidents/3/${action}`).set(user).send({});
        expect(res.status).toBe(403);
        expect(mockedQuery).not.toHaveBeenCalled();
    });
});
