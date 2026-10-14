import express from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { sendEmailOrThrow, emailConfigStatus } from '../services/gmailService';

const router = express.Router();

router.get('/', (req, res) => {
    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// POST /api/health/test-email — admin only. Sends a test mail to the signed-in admin
// through the real Gmail pipeline and reports the exact outcome (including the Google
// error), since normal business code swallows send failures.
router.post('/test-email', requireAuth, requireAdmin, async (req, res) => {
    const to = (req as any).user.email as string;
    const config = emailConfigStatus();
    try {
        const messageId = await sendEmailOrThrow({
            to,
            subject: 'Test email — Asset Management',
            html: `<h2>Email delivery works</h2>
                   <p>This test was triggered by ${to} on ${new Date().toISOString()}.</p>
                   <p>If you can read this, the Gmail credentials configured on the server are valid.</p>`,
        });
        return res.json({ ok: true, to, messageId, config });
    } catch (err: any) {
        const message = String(err?.response?.data?.error_description || err?.message || err);
        const code = String(err?.response?.data?.error || err?.code || '');
        let hint = 'Check the server logs and the Google credentials.';
        if (/invalid_grant/i.test(code + message)) {
            hint = 'The REFRESH_TOKEN is expired, revoked, or was issued for a different CLIENT_ID/CLIENT_SECRET or Google account. Generate a new one.';
        } else if (/invalid_client|unauthorized_client/i.test(code + message)) {
            hint = 'CLIENT_ID / CLIENT_SECRET are wrong or do not match the refresh token.';
        } else if (/insufficient|scope/i.test(message)) {
            hint = 'The token was not granted the Gmail send scope (https://www.googleapis.com/auth/gmail.send).';
        } else if (/has not been used|disabled|accessNotConfigured/i.test(message)) {
            hint = 'The Gmail API is not enabled in the Google Cloud project of this client.';
        }
        return res.status(502).json({ ok: false, to, error: message, code: code || undefined, hint, config });
    }
});

export default router;