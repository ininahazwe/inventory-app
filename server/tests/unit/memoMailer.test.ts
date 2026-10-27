// tests/unit/memoMailer.test.ts
// DB et Gmail sont mockés globalement (tests/jest.setup.ts) : on vérifie QUI reçoit
// QUOI, que rien n'est jamais bloquant, et la logique des relances.
import { db } from '../../src/database/connection';
import { sendEmail } from '../../src/services/gmailService';
import { notifyMemoEvent, checkMemosWaiting, buildMemoMail } from '../../src/services/memoMailer';

const query = db.query as jest.Mock;
const execute = db.execute as jest.Mock;
const send = sendEmail as jest.Mock;
const rows = (r: any[]) => [r, []];

const memo = (o: Record<string, any> = {}) => ({
    id: 5, reference: 'MFWA/MEMO/2026/0012', subject: 'Request for funds', author_email: 'agent@mfwa.org',
    status: 'in_review', revision_no: 1, current_step_no: 1, amount: 100, currency: 'USD', release_reference: null, type_name: 'Request for funds', ...o,
});
const step = (no: number, kind: string, pos: number, status: string, o: Record<string, any> = {}) =>
    ({ step_no: no, kind, position_id: pos, status, acted_by_email: null, comment: null, position_label: `L${pos}`, ...o });

beforeEach(() => { query.mockReset(); execute.mockReset(); send.mockReset(); send.mockResolvedValue(true); });

describe('notifyMemoEvent', () => {
    it('submitted → the holders of the active level, never the author', async () => {
        query
            .mockResolvedValueOnce(rows([memo()]))
            .mockResolvedValueOnce(rows([step(0, 'submit', 1, 'done'), step(1, 'recommend', 2, 'active')]))
            .mockResolvedValueOnce(rows([{ user_email: 'manager@mfwa.org' }, { user_email: 'Agent@mfwa.org' }]));
        await notifyMemoEvent('submitted', 5, 'agent@mfwa.org');
        expect(send).toHaveBeenCalledTimes(1);
        expect(send.mock.calls[0][0].to).toEqual(['manager@mfwa.org']);
        expect(send.mock.calls[0][0].subject).toContain('To sign');
    });

    it('sends nothing (and does not throw) when the level has no holder', async () => {
        query
            .mockResolvedValueOnce(rows([memo()]))
            .mockResolvedValueOnce(rows([step(0, 'submit', 1, 'done'), step(1, 'recommend', 2, 'active')]))
            .mockResolvedValueOnce(rows([]));
        await expect(notifyMemoEvent('submitted', 5, 'agent@mfwa.org')).resolves.toBeUndefined();
        expect(send).not.toHaveBeenCalled();
    });

    it('returned → the author, with the reason, HTML-escaped', async () => {
        query
            .mockResolvedValueOnce(rows([memo({ status: 'returned', current_step_no: null, revision_no: 2 })]))
            .mockResolvedValueOnce(rows([]));
        await notifyMemoEvent('decided', 5, 'manager@mfwa.org', { comment: 'Fix the <b>amount</b> & resubmit' });
        const mail = send.mock.calls[0][0];
        expect(mail.to).toEqual(['agent@mfwa.org']);
        expect(mail.html).toContain('Fix the &lt;b&gt;amount&lt;/b&gt; &amp; resubmit');
        expect(mail.html).not.toContain('<b>amount</b>');
    });

    it('approved → finance is asked to release AND the author is told', async () => {
        query
            .mockResolvedValueOnce(rows([memo({ status: 'approved', current_step_no: 3 })]))
            .mockResolvedValueOnce(rows([step(0, 'submit', 1, 'done'), step(1, 'recommend', 2, 'done'), step(2, 'approve', 3, 'done'), step(3, 'release', 4, 'active')]))
            .mockResolvedValueOnce(rows([{ user_email: 'finance@mfwa.org' }]));
        await notifyMemoEvent('decided', 5, 'director@mfwa.org');
        expect(send.mock.calls.map(c => c[0].to)).toEqual([['finance@mfwa.org'], ['agent@mfwa.org']]);
        expect(send.mock.calls[0][0].subject).toContain('To release');
    });

    it('refused → the author and the approver level, not the finance officer who refused', async () => {
        query
            .mockResolvedValueOnce(rows([memo({ status: 'release_refused', current_step_no: null })]))
            .mockResolvedValueOnce(rows([step(0, 'submit', 1, 'done'), step(2, 'approve', 3, 'done'), step(3, 'release', 4, 'refused')]))
            .mockResolvedValueOnce(rows([{ user_email: 'director@mfwa.org' }, { user_email: 'finance@mfwa.org' }]));
        await notifyMemoEvent('refused', 5, 'finance@mfwa.org', { comment: 'No budget line' });
        expect(send.mock.calls[0][0].to.sort()).toEqual(['agent@mfwa.org', 'director@mfwa.org']);
    });

    it('never throws when Gmail or the database fail', async () => {
        query.mockResolvedValueOnce(rows([memo()])).mockResolvedValueOnce(rows([step(1, 'recommend', 2, 'active')])).mockResolvedValueOnce(rows([{ user_email: 'm@mfwa.org' }]));
        send.mockRejectedValueOnce(new Error('gmail down'));
        await expect(notifyMemoEvent('submitted', 5, 'agent@mfwa.org')).resolves.toBeUndefined();
        query.mockRejectedValueOnce(new Error('db down'));
        await expect(notifyMemoEvent('submitted', 5, 'agent@mfwa.org')).resolves.toBeUndefined();
    });
});

describe('buildMemoMail', () => {
    it('escapes every fact', () => {
        const m = buildMemoMail({ to: ['a@b.c'], subject: 's', title: 't', accent: '#000', background: '#fff', intro: 'i', facts: [['Subject', '<script>x</script>']], memoId: 1, cta: 'Go' });
        expect(m.html).toContain('&lt;script&gt;');
        expect(m.html).not.toContain('<script>');
    });
});

describe('checkMemosWaiting', () => {
    const NOW = new Date('2026-10-27T09:00:00Z');
    const waiting = (id: number, since: string, lastReminder: string | null = null) =>
        ({ ...memo({ id }), since, last_reminder: lastReminder });

    it('reminds only memos waiting long enough, at most once per period, and records the reminder', async () => {
        delete process.env.MEMO_REMINDER_DAYS;                     // défaut : 2 jours
        query
            .mockResolvedValueOnce(rows([
                waiting(1, '2026-10-20T10:00:00Z'),                              // ~7 j (6 jours pleins), jamais relancé → relance
                waiting(2, '2026-10-26T10:00:00Z'),                              // 1 j → trop tôt
                waiting(3, '2026-10-20T10:00:00Z', '2026-10-26T09:00:00Z'),      // relancé hier → pas encore
            ]))
            .mockResolvedValueOnce(rows([step(1, 'recommend', 2, 'active')]))     // pas du mémo 1
            .mockResolvedValueOnce(rows([{ user_email: 'manager@mfwa.org' }]));   // titulaires
        execute.mockResolvedValue([{ affectedRows: 1, insertId: 1 }, []]);

        const r = await checkMemosWaiting(NOW);
        expect(r).toEqual({ waiting: 2, reminded: 1 });
        expect(send).toHaveBeenCalledTimes(1);
        expect(send.mock.calls[0][0]).toMatchObject({ to: ['manager@mfwa.org'] });
        expect(send.mock.calls[0][0].subject).toContain('Reminder (6d)');
        const [sql, params] = execute.mock.calls[0];
        expect(sql).toContain('INSERT INTO memo_events');
        expect(params).toContain('reminder');
    });

    it('a stale reminder (older than the last real activity) does not block a new one', async () => {
        query
            .mockResolvedValueOnce(rows([waiting(1, '2026-10-24T10:00:00Z', '2026-10-15T10:00:00Z')]))
            .mockResolvedValueOnce(rows([step(1, 'recommend', 2, 'active')]))
            .mockResolvedValueOnce(rows([{ user_email: 'manager@mfwa.org' }]));
        execute.mockResolvedValue([{ affectedRows: 1, insertId: 1 }, []]);
        expect((await checkMemosWaiting(NOW)).reminded).toBe(1);
    });

    it('a release_refused memo reminds the approver level; a level with nobody is skipped, not fatal', async () => {
        query
            .mockResolvedValueOnce(rows([{ ...waiting(1, '2026-10-20T10:00:00Z'), status: 'release_refused', current_step_no: null }]))
            .mockResolvedValueOnce(rows([step(2, 'approve', 3, 'done'), step(3, 'release', 4, 'refused')]))
            .mockResolvedValueOnce(rows([]));
        const r = await checkMemosWaiting(NOW);
        expect(r).toEqual({ waiting: 1, reminded: 0 });
        expect(send).not.toHaveBeenCalled();
    });

    it('honours MEMO_REMINDER_DAYS', async () => {
        process.env.MEMO_REMINDER_DAYS = '10';
        query.mockResolvedValueOnce(rows([waiting(1, '2026-10-20T10:00:00Z')]));
        expect(await checkMemosWaiting(NOW)).toEqual({ waiting: 0, reminded: 0 });
        delete process.env.MEMO_REMINDER_DAYS;
    });
});
