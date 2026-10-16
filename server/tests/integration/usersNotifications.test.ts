import request from 'supertest';
import { createTestApp, asUser } from '../helpers/testApp';
import { db } from '../../src/database/connection';
import { getAdminNotificationEmails } from '../../src/services/notificationRecipients';

const q = db.query as jest.Mock;

describe('POST /api/users/notifications', () => {
    const app = createTestApp();
    beforeEach(() => q.mockReset());

    it('is super_admin only', async () => {
        const res = await request(app).post('/api/users/notifications').set(asUser({ role: 'admin' })).send({ p_user_id: 'u1', p_enabled: false });
        expect(res.status).toBe(403);
    });

    it('validates the body', async () => {
        const res = await request(app).post('/api/users/notifications').set(asUser({ role: 'super_admin' })).send({ p_user_id: 'u1' });
        expect(res.status).toBe(400);
    });

    it('updates notify_admin', async () => {
        q.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]);
        const res = await request(app).post('/api/users/notifications').set(asUser({ role: 'super_admin' })).send({ p_user_id: 'u1', p_enabled: false });
        expect(res.status).toBe(200);
        expect(q.mock.calls[0][1]).toEqual([0, 'u1']);
    });
});

describe('getAdminNotificationEmails', () => {
    beforeEach(() => q.mockReset());

    it('only queries admins with notify_admin = 1', async () => {
        q.mockResolvedValueOnce([[{ email: 'a@mfwa.org' }], undefined]);
        expect(await getAdminNotificationEmails()).toEqual(['a@mfwa.org']);
        expect(q.mock.calls[0][0]).toMatch(/notify_admin = 1/);
    });

    it('falls back to every admin when the column is missing', async () => {
        q.mockRejectedValueOnce(Object.assign(new Error('Unknown column'), { code: 'ER_BAD_FIELD_ERROR' }));
        q.mockResolvedValueOnce([[{ email: 'a@mfwa.org' }, { email: 'b@mfwa.org' }], undefined]);
        expect(await getAdminNotificationEmails()).toEqual(['a@mfwa.org', 'b@mfwa.org']);
    });
});
