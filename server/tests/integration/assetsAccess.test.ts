// Role-based access in the Inventory module: admins see everything, users only
// what is entrusted to them; mutations and stats are admin-only.
import request from 'supertest';
import { createTestApp, mockRows, asUser } from '../helpers/testApp';
import { db } from '../../src/database/connection';

const mockedQuery = db.query as jest.Mock;
const user = asUser({ role: 'user', email: 'ama@mfwa.org', uid: 'u-1' } as any);

describe('Inventory access control', () => {
    const app = createTestApp();
    beforeEach(() => { mockedQuery.mockReset(); });

    it('list: user gets an "entrusted" restriction in count and data queries', async () => {
        mockedQuery
            .mockResolvedValueOnce(mockRows([{ count: 1 }]))
            .mockResolvedValueOnce(mockRows([{ id: 1, label: 'Laptop', status: 'on_loan' }]));
        const res = await request(app).get('/api/assets').set(user);
        expect(res.status).toBe(200);
        expect(String(mockedQuery.mock.calls[0][0])).toContain("l.status = 'checked_out'");
        expect(mockedQuery.mock.calls[0][1]).toEqual(expect.arrayContaining(['u-1', 'ama@mfwa.org']));
    });

    it('list: admin gets no restriction', async () => {
        mockedQuery
            .mockResolvedValueOnce(mockRows([{ count: 0 }]))
            .mockResolvedValueOnce(mockRows([]));
        await request(app).get('/api/assets');
        expect(String(mockedQuery.mock.calls[0][0])).not.toContain("l.status = 'checked_out'");
    });

    it('list: loan picker (?lendable=1) is open to users but hides assignee details', async () => {
        mockedQuery
            .mockResolvedValueOnce(mockRows([{ count: 1 }]))
            .mockResolvedValueOnce(mockRows([{ id: 2, label: 'Camera', assignee_name: 'Kofi', assignee_email: 'k@x.org' }]));
        const res = await request(app).get('/api/assets?lendable=1').set(user);
        expect(res.status).toBe(200);
        expect(String(mockedQuery.mock.calls[0][0])).not.toContain("l.status = 'checked_out'");
        expect(res.body.data[0].assignee_email).toBeNull();
    });

    it('detail: 403 for an asset that is not entrusted to the user', async () => {
        mockedQuery.mockResolvedValueOnce(mockRows([]));
        const res = await request(app).get('/api/assets/5').set(user);
        expect(res.status).toBe(403);
        expect(mockedQuery).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['post', '/api/assets'],
        ['put', '/api/assets/5'],
        ['delete', '/api/assets/5'],
        ['post', '/api/rpc/return_asset'],
        ['post', '/api/rpc/send_to_repair'],
        ['post', '/api/rpc/exit_repair'],
        ['post', '/api/rpc/retire_asset'],
        ['post', '/api/rpc/get_asset_stats'],
        ['post', '/api/rpc/get_dashboard_kpis'],
        ['post', '/api/assignments'],
        ['get', '/api/assignments'],
    ])('%s %s is admin-only', async (method, url) => {
        const res = await (request(app) as any)[method](url).set(user).send({});
        expect(res.status).toBe(403);
        expect(mockedQuery).not.toHaveBeenCalled();
    });
});
