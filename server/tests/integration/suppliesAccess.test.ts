// The whole Supplies module (and locations, which feed it) is admin-only.
import request from 'supertest';
import { createTestApp, asUser } from '../helpers/testApp';
import { db } from '../../src/database/connection';

const user = asUser({ role: 'user', email: 'ama@mfwa.org' });

describe('Supplies module is closed to non-admin users', () => {
    const app = createTestApp();
    beforeEach(() => { (db.query as jest.Mock).mockReset(); (db.execute as jest.Mock).mockReset(); });

    it.each([
        '/api/supplies', '/api/supply-items', '/api/supply-receipts', '/api/supply-issues',
        '/api/supply-adjustments', '/api/supply-movements', '/api/supply-assignments', '/api/locations',
    ])('GET %s → 403 without touching the DB', async (url) => {
        const res = await request(app).get(url).set(user);
        expect(res.status).toBe(403);
        expect(db.query).not.toHaveBeenCalled();
        expect(db.execute).not.toHaveBeenCalled();
    });

    it.each([
        ['post', '/api/supply-issues'], ['post', '/api/supply-receipts'], ['post', '/api/supply-adjustments'],
        ['post', '/api/supplies'], ['delete', '/api/supply-items/1'],
    ])('%s %s → 403', async (method, url) => {
        const res = await (request(app) as any)[method](url).set(user).send({});
        expect(res.status).toBe(403);
    });
});
