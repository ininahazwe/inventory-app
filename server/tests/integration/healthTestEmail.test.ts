import request from 'supertest';
import { createTestApp, asUser } from '../helpers/testApp';
import { sendEmailOrThrow } from '../../src/services/gmailService';

const mocked = sendEmailOrThrow as jest.Mock;

describe('POST /api/health/test-email', () => {
    const app = createTestApp();
    beforeEach(() => mocked.mockReset());

    it('is admin-only', async () => {
        const res = await request(app).post('/api/health/test-email').set(asUser({ role: 'user' }));
        expect(res.status).toBe(403);
        expect(mocked).not.toHaveBeenCalled();
    });

    it('sends to the signed-in admin and reports the message id', async () => {
        mocked.mockResolvedValueOnce('abc123');
        const res = await request(app).post('/api/health/test-email').set(asUser({ email: 'boss@mfwa.org' }));
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ ok: true, to: 'boss@mfwa.org', messageId: 'abc123' });
        expect(mocked.mock.calls[0][0].to).toBe('boss@mfwa.org');
    });

    it('surfaces the Google error with a hint (invalid_grant)', async () => {
        mocked.mockRejectedValueOnce(Object.assign(new Error('invalid_grant'), { response: { data: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } } }));
        const res = await request(app).post('/api/health/test-email');
        expect(res.status).toBe(502);
        expect(res.body.ok).toBe(false);
        expect(res.body.hint).toMatch(/REFRESH_TOKEN/);
    });
});
