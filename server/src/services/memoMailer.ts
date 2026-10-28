// server/src/services/memoMailer.ts
// E-mails du module mémos, au même titre que les prêts : l'envoi est TOUJOURS non
// bloquant (un mémo signé ne doit jamais échouer parce que Gmail est indisponible)
// et les destinataires sont calculés ici, à partir de l'état en base — jamais
// passés par la route.
//
//   submitted    → titulaires du niveau qui doit agir
//   decided      → in_review : titulaires du niveau suivant ; approved : titulaires de la
//                  finance + l'auteur ; returned / rejected : l'auteur (avec le motif)
//   released     → l'auteur et tous ceux qui ont signé
//   refused      → l'auteur et le niveau approbateur (qui peut ré-instruire)
//   reinstructed → titulaires de la finance
//   withdrawn    → ceux qui avaient signé
// Les relances (checkMemosWaiting) sont enregistrées dans memo_events (type 'reminder').
import { db } from '../database/connection';
import { logger } from '../middleware/logger';
import { sendEmail } from './gmailService';
import { recordMemoEvent } from './memoService';

const FRONTEND_URL = process.env.FRONTEND_URL || '';
const memoUrl = (id: number) => `${FRONTEND_URL}/memos/${id}`;

export type MemoMailEvent = 'submitted' | 'decided' | 'released' | 'refused' | 'reinstructed' | 'withdrawn' | 'reassigned';

const esc = (v: unknown): string =>
    String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const uniq = (list: string[]) => {
    const seen = new Set<string>();
    return list.filter(e => e && !seen.has(e.toLowerCase()) && seen.add(e.toLowerCase()));
};

// ─── Gabarit ────────────────────────────────────────────────────────────────

type MailSpec = {
    to: string[]; subject: string; title: string; accent: string; background: string;
    intro: string; facts: Array<[string, string]>; memoId: number; cta: string;
};

export function buildMemoMail(s: MailSpec) {
    return {
        to: s.to,
        subject: s.subject,
        html: `
  <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px; font-family: Arial, sans-serif;">
      <h2 style="color: ${s.accent};">${s.title}</h2>
      <p>${s.intro}</p>
      <div style="background-color: ${s.background}; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid ${s.accent};">
          ${s.facts.map(([k, v]) => `<p style="margin: 0 0 8px 0;"><strong>${esc(k)}:</strong> ${esc(v)}</p>`).join('')}
      </div>
      <div style="margin: 30px 0; text-align: center;">
          <a href="${esc(memoUrl(s.memoId))}" style="display: inline-block; padding: 12px 24px; background-color: ${s.accent}; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">${esc(s.cta)}</a>
      </div>
      <p style="font-size: 13px; color: #6b7280;">Assets Management System</p>
  </div>`,
    };
}

async function safeSend(payload: ReturnType<typeof buildMemoMail>, ctx: string): Promise<boolean> {
    if (!payload.to.length) return false;
    try {
        const sent = await sendEmail(payload);       // renvoie false (sans lever) si Gmail refuse
        if (!sent) logger.error(`Memo notification not delivered (${ctx}) to [${payload.to.join(', ')}] — see the EMAIL log line above`, 'MEMOS');
        return sent !== false;
    } catch (err) {
        logger.error(`Memo notification failed (${ctx}):`, err as Error);
        return false;
    }
}

// ─── Lectures ───────────────────────────────────────────────────────────────

async function holdersOf(positionId: number): Promise<string[]> {
    const [rows] = await db.query(
        'SELECT user_email FROM memo_position_holders WHERE position_id = ? AND is_active = 1', [positionId]);
    return ((rows as any[]) || []).map(r => String(r.user_email));
}

/** Destinataires d'un pas : le manager choisi s'il l'est encore, sinon tous les titulaires du niveau. */
async function recipientsOfStep(step: any): Promise<string[]> {
    const holders = await holdersOf(step.position_id);
    if (step.assigned_email) {
        const chosen = holders.find(h => h.toLowerCase() === String(step.assigned_email).toLowerCase());
        if (chosen) return [chosen];
    }
    return holders;
}

async function loadContext(memoId: number) {
    const [mRows] = await db.query(
        `SELECT m.id, m.reference, m.subject, m.author_email, m.status, m.revision_no, m.current_step_no,
                m.amount, m.currency, m.release_reference, ty.name AS type_name
         FROM memos m JOIN memo_types ty ON ty.id = m.type_id WHERE m.id = ?`, [memoId]);
    const memo = (mRows as any[])[0];
    if (!memo) return null;
    const [sRows] = await db.query(
        `SELECT s.step_no, s.kind, s.position_id, s.status, s.assigned_email, s.acted_by_email, s.comment, p.label AS position_label
         FROM memo_steps s JOIN memo_positions p ON p.id = s.position_id
         WHERE s.memo_id = ? AND s.revision_no = ? ORDER BY s.step_no`, [memoId, memo.revision_no]);
    return { memo, steps: (sRows as any[]) || [] };
}

const baseFacts = (memo: any): Array<[string, string]> => {
    const f: Array<[string, string]> = [['Memo', memo.reference || `#${memo.id}`], ['Subject', memo.subject], ['Author', memo.author_email]];
    if (memo.amount != null && memo.amount !== '') f.push(['Amount', `${Number(memo.amount).toLocaleString('en-GB')} ${memo.currency || ''}`.trim()]);
    return f;
};

const activeStep = (ctx: { memo: any; steps: any[] }) =>
    ctx.steps.find(s => s.step_no === ctx.memo.current_step_no && s.status === 'active') || null;

const approverStep = (steps: any[]) => [...steps].reverse().find(s => s.kind === 'approve') || null;

const signers = (steps: any[]) => steps.filter(s => s.status === 'done' && s.acted_by_email).map(s => String(s.acted_by_email));

// ─── Notification d'un évènement ────────────────────────────────────────────

/** Envoie les e-mails d'un évènement du circuit. Ne lève jamais d'exception. */
export async function notifyMemoEvent(
    event: MemoMailEvent, memoId: number, actorEmail: string, opts: { comment?: string | null } = {}
): Promise<void> {
    try {
        const ctx = await loadContext(memoId);
        if (!ctx) return;
        const { memo, steps } = ctx;
        const without = (list: string[]) => uniq(list).filter(e => !same(e, actorEmail));
        const label = memo.reference || `#${memo.id}`;
        const facts = baseFacts(memo);
        const comment: Array<[string, string]> = opts.comment ? [['Comment', opts.comment]] : [];

        const waitingMail = async (step: any, why: string) => {
            const to = without((await recipientsOfStep(step)).filter(e => !same(e, memo.author_email)));
            if (!to.length) {
                logger.warn(`Memo ${label}: no recipient for the ${step.position_label} level — nobody was notified`, 'MEMOS');
                return;
            }
            const release = step.kind === 'release';
            await safeSend(buildMemoMail({
                to, subject: `[Memo] ${release ? 'To release' : 'To sign'} — ${memo.subject}`,
                title: release ? '💸 A payment is waiting for release' : '✍️ A memo is waiting for your signature',
                accent: '#2563eb', background: '#eff6ff',
                intro: esc(why), facts: [...facts, ['Your level', step.position_label]], memoId: memo.id,
                cta: release ? 'Review and release' : 'Review and sign',
            }), `${event} #${memoId}`);
        };

        const authorMail = async (title: string, accent: string, background: string, intro: string, extra: Array<[string, string]> = [], cc: string[] = []) => {
            const to = without([memo.author_email, ...cc]);
            await safeSend(buildMemoMail({
                to, subject: `[Memo] ${title.replace(/^\S+\s/, '')} — ${memo.subject}`, title, accent, background,
                intro: esc(intro), facts: [...facts, ...extra, ...comment], memoId: memo.id, cta: 'Open the memo',
            }), `${event} #${memoId}`);
        };

        if (event === 'submitted') {
            const step = activeStep(ctx);
            if (step) await waitingMail(step, `${memo.author_email} submitted a memo and signed it. It is now at the ${step.position_label} level.`);
        } else if (event === 'decided') {
            if (memo.status === 'in_review' || memo.status === 'approved') {
                const step = activeStep(ctx);
                if (step) await waitingMail(step, memo.status === 'approved'
                    ? 'This memo has been approved and now waits for the payment release.'
                    : `The previous level signed. It is now at the ${step.position_label} level.`);
                if (memo.status === 'approved') {
                    await authorMail('✅ Memo approved', '#16a34a', '#f0fdf4', 'Your memo has been approved. It now waits for the finance release.');
                }
            } else if (memo.status === 'returned') {
                await authorMail('↩️ Memo returned for changes', '#d97706', '#fffbeb', 'Your memo was returned. Revise it and sign again to resubmit.');
            } else if (memo.status === 'rejected') {
                await authorMail('❌ Memo rejected', '#b91c1c', '#fef2f2', 'Your memo was rejected. This is final.');
            }
        } else if (event === 'released') {
            await authorMail('💸 Payment released', '#16a34a', '#f0fdf4', 'Finance released the payment for this memo.',
                memo.release_reference ? [['Payment reference', memo.release_reference]] : [], signers(steps));
        } else if (event === 'refused') {
            const ap = approverStep(steps);
            const cc = ap ? await holdersOf(ap.position_id) : [];
            await authorMail('⛔ Release refused', '#c2410c', '#fff7ed',
                'Finance refused to release this payment. The approval is kept: the approver can re-instruct finance, or the memo can be withdrawn.', [], cc);
        } else if (event === 'reinstructed') {
            const step = activeStep(ctx);
            if (step) await waitingMail(step, 'The approver asked finance to look at this memo again.');
        } else if (event === 'reassigned') {
            const step = activeStep(ctx);
            if (step) await waitingMail(step, step.assigned_email
                ? `${actorEmail} asked you to recommend this memo.`
                : `This memo is now open to any ${step.position_label}.`);
        } else if (event === 'withdrawn') {
            await authorMail('🚫 Memo withdrawn', '#6b7280', '#f9fafb', 'This memo has been withdrawn.', [], signers(steps));
        }
    } catch (err) {
        logger.error(`Memo notification failed (${event} #${memoId}):`, err as Error);
    }
}

// ─── Relances ───────────────────────────────────────────────────────────────

export const reminderDays = (): number => Math.max(1, parseInt(process.env.MEMO_REMINDER_DAYS || '2', 10) || 2);

/**
 * Relance les titulaires du niveau qui retient un mémo depuis MEMO_REMINDER_DAYS jours
 * (2 par défaut), puis au plus une fois par période. Les relances sont notées dans
 * memo_events (type « reminder ») ; elles ne repoussent pas l'ancienneté d'attente.
 */
export async function checkMemosWaiting(now: Date = new Date()): Promise<{ waiting: number; reminded: number }> {
    const days = reminderDays();
    const DAY = 86_400_000;
    const [rows] = await db.query(
        `SELECT m.id, m.reference, m.subject, m.author_email, m.status, m.revision_no, m.current_step_no,
                (SELECT MAX(e.event_at) FROM memo_events e WHERE e.memo_id = m.id AND e.event_type <> 'reminder') AS since,
                (SELECT MAX(e.event_at) FROM memo_events e WHERE e.memo_id = m.id AND e.event_type = 'reminder') AS last_reminder
         FROM memos m WHERE m.status IN ('in_review', 'approved', 'release_refused')`);

    let waiting = 0;
    let reminded = 0;
    for (const m of (rows as any[]) || []) {
        if (!m.since) continue;
        const waitedDays = Math.floor((now.getTime() - new Date(m.since).getTime()) / DAY);
        if (waitedDays < days) continue;
        waiting += 1;
        if (m.last_reminder && new Date(m.last_reminder) >= new Date(m.since)
            && now.getTime() - new Date(m.last_reminder).getTime() < days * DAY) continue;

        const [sRows] = await db.query(
            `SELECT s.step_no, s.kind, s.position_id, s.status, s.assigned_email, p.label AS position_label
             FROM memo_steps s JOIN memo_positions p ON p.id = s.position_id
             WHERE s.memo_id = ? AND s.revision_no = ? ORDER BY s.step_no`, [m.id, m.revision_no]);
        const steps = (sRows as any[]) || [];
        const step = m.status === 'release_refused'
            ? approverStep(steps)
            : steps.find(s => s.step_no === m.current_step_no && s.status === 'active');
        if (!step) continue;

        const to = uniq((await recipientsOfStep(step)).filter(e => !same(e, m.author_email)));
        if (!to.length) {
            logger.warn(`Memo ${m.reference || m.id}: waiting ${waitedDays}d at the ${step.position_label} level but nobody holds it`, 'MEMOS');
            continue;
        }
        const sent = await safeSend(buildMemoMail({
            to, subject: `[Memo] Reminder (${waitedDays}d) — ${m.subject}`,
            title: '⏰ A memo is still waiting for you', accent: '#b45309', background: '#fffbeb',
            intro: `This memo has been waiting at the ${esc(step.position_label)} level for ${waitedDays} day${waitedDays === 1 ? '' : 's'}.`,
            facts: [['Memo', m.reference || `#${m.id}`], ['Subject', m.subject], ['Author', m.author_email], ['Waiting since', new Date(m.since).toLocaleDateString('en-GB')]],
            memoId: m.id, cta: 'Open the memo',
        }), `reminder #${m.id}`);
        if (!sent) continue;

        reminded += 1;
        try {
            await db.transaction(async tx => recordMemoEvent(tx as any, {
                memo_id: m.id, revision_no: m.revision_no, step_no: step.step_no, event_type: 'reminder',
                actor_email: null, payload: { level: step.position_label, recipients: to.length, waited_days: waitedDays },
            }));
        } catch (err) {
            logger.error(`Memo reminder #${m.id} sent but not recorded:`, err as Error);
        }
    }
    return { waiting, reminded };
}
