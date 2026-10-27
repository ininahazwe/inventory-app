// src/pages/MemoDetailPage.tsx
// Fiche d'un mémo : le texte, le circuit avec les signatures déjà apposées, la
// barre de décision et le journal. Les boutons suivent `capabilities` (calculées
// par le serveur) ; signer = cliquer sur l'action, avec sa signature enregistrée.
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import Layout from '../Layout';
import { SkeletonDetail } from '../components/Skeleton';
import SignaturePad from '../components/SignaturePad';
import MemoAttachments from '../components/MemoAttachments';
import { MemoStatusBadge } from './MemosPage';
import {
  memosApi, useProtectedImage, SIGNATURE_REQUIRED, STEP_STATUS_LABEL, STEP_KIND_VERB, fmtDate, fmtDateTime,
  type MemoFull, type MemoStep,
} from '../hooks/useMemos';

const EVENT_ICON: Record<string, string> = {
  created: '📝', submitted: '📤', recommended: '👍', approved: '✅', returned: '↩️', rejected: '❌',
  released: '💸', release_refused: '⛔', release_reopened: '🔁', withdrawn: '🚫', resubmitted: '📤',
};

const btn = (bg: string): React.CSSProperties => ({
  padding: '10px 16px', background: bg, color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 14,
});
const box: React.CSSProperties = { border: '1px solid #eee', borderRadius: 6, padding: 16, marginBottom: 20 };
const input: React.CSSProperties = { width: '100%', padding: 8, marginTop: 8, border: '1px solid #ddd', borderRadius: 4, boxSizing: 'border-box' };

function StepSignature({ memoId, step }: { memoId: number; step: MemoStep }) {
  const url = useProtectedImage(step.signed ? `/memos/${memoId}/steps/${step.id}/signature` : null);
  if (!step.signed) return null;
  return url ? <img src={url} alt="signature" style={{ height: 38, display: 'block', marginTop: 4 }} /> : null;
}

type Panel = null | 'return' | 'reject' | 'release' | 'refuse' | 'reinstruct' | 'withdraw';

export default function MemoDetailPage() {
  const { id } = useParams();
  const memoId = parseInt(id || '0', 10);
  const location = useLocation() as { state?: { message?: string } };

  const [memo, setMemo] = useState<MemoFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(location.state?.message || null);
  const [panel, setPanel] = useState<Panel>(null);
  const [comment, setComment] = useState('');
  const [payRef, setPayRef] = useState('');
  const [sigKey, setSigKey] = useState(0);
  const [hasSig, setHasSig] = useState<boolean | null>(null);
  const [pad, setPad] = useState<null | (() => Promise<void>)>(null);   // action à rejouer après création de la signature
  const [padOpen, setPadOpen] = useState(false);
  const [showOld, setShowOld] = useState(false);

  const reload = useCallback(async () => {
    const { data, error: e } = await memosApi.get(memoId);
    if (data) setMemo(data); else if (e) setError(e);
    setLoading(false);
  }, [memoId]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    import('../lib/apiClient').then(({ api }) =>
      api.get<{ has_signature: boolean }>('/memos/signature').then(({ data }) => setHasSig(!!data?.has_signature)));
  }, [sigKey]);
  const mySigUrl = useProtectedImage(hasSig ? '/memos/signature/image' : null, sigKey);

  // Exécute une action ; si la signature manque, ouvre le pad puis rejoue l'action.
  const run = async (fn: () => Promise<{ error: string | null; code?: string }>, ok: string) => {
    setBusy(true); setError(null); setMessage(null);
    const res = await fn();
    setBusy(false);
    if (res.code === SIGNATURE_REQUIRED) {
      setPad(() => async () => { await run(fn, ok); });
      setPadOpen(true);
      return;
    }
    if (res.error) { setError(res.error); return; }
    setMessage(ok); setPanel(null); setComment(''); setPayRef('');
    await reload();
  };

  if (loading) return <Layout><SkeletonDetail /></Layout>;
  if (!memo) return <Layout><div style={{ padding: 20, textAlign: 'center' }}>{error || 'Memo not found.'} <Link to="/memos">Back to memos</Link></div></Layout>;

  const cap = memo.capabilities;
  const current = memo.steps.filter(s => s.revision_no === memo.revision_no);
  const older = memo.steps.filter(s => s.revision_no < memo.revision_no);
  const active = current.find(s => s.step_no === memo.current_step_no && s.status === 'active') || null;
  const approveLabel = active?.kind === 'recommend' ? 'Recommend' : 'Approve';
  const needComment = (c: string) => c.trim().length === 0;
  const toggle = (p: Panel) => { setPanel(panel === p ? null : p); setComment(''); };

  const SigHint = () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#666', margin: '8px 0' }}>
      {mySigUrl ? <><span>Signing with</span><img src={mySigUrl} alt="your signature" style={{ height: 34, border: '1px solid #eee', borderRadius: 4, background: '#fff' }} /></> : <span>You have no saved signature yet — you will be asked to create one.</span>}
      {hasSig && <button type="button" onClick={() => { setPad(null); setPadOpen(true); }} style={{ background: 'none', border: 'none', color: 'var(--brand)', cursor: 'pointer', fontSize: 13 }}>Change</button>}
    </div>
  );

  return (
    <Layout>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: 20 }}>
        <Link to="/memos" style={{ fontSize: 13, color: '#666' }}>← All memos</Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', margin: '10px 0 4px' }}>
          <h1 style={{ margin: 0 }}>{memo.subject || '(no subject)'}</h1>
          <MemoStatusBadge status={memo.status} />
        </div>
        <p style={{ color: '#999', fontSize: 13, marginTop: 0 }}>
          {memo.reference || 'Draft'} · {memo.type_name} · revision {memo.revision_no} · by {memo.author_email}
          {cap.waiting_for && (memo.status === 'in_review' || memo.status === 'approved') ? ` · waiting for ${cap.waiting_for}` : ''}
        </p>

        {error && <div style={{ padding: 12, margin: '12px 0', background: '#f8d7da', color: '#721c24', borderRadius: 4 }}>❌ {error}</div>}
        {message && <div style={{ padding: 12, margin: '12px 0', background: '#d4edda', color: '#155724', borderRadius: 4 }}>✅ {message}</div>}
        {memo.status === 'release_refused' && (
          <div style={{ padding: 12, margin: '12px 0', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 4, fontSize: 14 }}>
            Finance refused to release this payment. The approval is kept — the approver can re-instruct finance, or the memo can be withdrawn.
          </div>
        )}

        {/* ── Le mémo ─────────────────────────────────────────────── */}
        <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 4, padding: 28, marginBottom: 20, fontSize: 14 }}>
          <div style={{ textAlign: 'center', letterSpacing: 2, fontWeight: 700, marginBottom: 16 }}>MEMORANDUM</div>
          <table style={{ borderCollapse: 'collapse', width: '100%', marginBottom: 14 }}><tbody>
            <tr><td style={{ width: 80, color: '#888', padding: '3px 0' }}>TO</td><td>{memo.to_label}</td></tr>
            <tr><td style={{ color: '#888', padding: '3px 0' }}>FROM</td><td>{memo.from_label}</td></tr>
            <tr><td style={{ color: '#888', padding: '3px 0' }}>DATE</td><td>{fmtDate(memo.memo_date)}</td></tr>
            <tr><td style={{ color: '#888', padding: '3px 0' }}>SUBJECT</td><td><strong>{memo.subject}</strong></td></tr>
            {memo.project_code && <tr><td style={{ color: '#888', padding: '3px 0' }}>PROJECT</td><td>{memo.project_code} · {memo.project_title}{memo.project_donor ? ` (${memo.project_donor})` : ''}</td></tr>}
            {memo.amount ? <tr><td style={{ color: '#888', padding: '3px 0' }}>AMOUNT</td><td>{Number(memo.amount).toLocaleString('en-GB')} {memo.currency}</td></tr> : null}
            {memo.release_reference && <tr><td style={{ color: '#888', padding: '3px 0' }}>PAYMENT REF.</td><td>{memo.release_reference}</td></tr>}
          </tbody></table>
          <hr style={{ border: 0, borderTop: '1px solid #ddd' }} />
          <div style={{ whiteSpace: 'pre-wrap', marginTop: 12 }}>{memo.body}</div>
        </div>

        <MemoAttachments memoId={memo.id} revisionNo={memo.revision_no} attachments={memo.attachments} editable={false} required={false} onChanged={reload} />

        {/* ── Circuit ─────────────────────────────────────────────── */}
        <h2 style={{ fontSize: 18, margin: '24px 0 8px' }}>Chain</h2>
        <div style={{ ...box, padding: 0 }}>
          {current.length === 0 && <div style={{ padding: 16, color: '#999' }}>Not submitted yet.</div>}
          {current.map(s => (
            <div key={s.id} style={{ display: 'flex', gap: 12, padding: '10px 14px', borderBottom: '1px solid #f3f3f3', fontSize: 14, background: s.status === 'active' ? '#fffbeb' : undefined }}>
              <div style={{ width: 26, textAlign: 'center', fontSize: 18 }}>
                {s.status === 'done' ? '✅' : s.status === 'active' ? '⏳' : s.status === 'pending' ? '○' : s.status === 'skipped' ? '⤼' : '⛔'}
              </div>
              <div style={{ flex: 1 }}>
                <strong>{s.position_label}</strong>
                <span style={{ color: '#999', fontSize: 12, marginLeft: 8 }}>
                  {s.status === 'done' ? `${STEP_KIND_VERB[s.kind] || 'Done'} by ${s.acted_by_email} · ${fmtDateTime(s.acted_at)}` : STEP_STATUS_LABEL[s.status] || s.status}
                </span>
                {s.comment && <div style={{ color: '#555', fontSize: 13, marginTop: 2 }}>“{s.comment}”</div>}
                <StepSignature memoId={memo.id} step={s} />
              </div>
            </div>
          ))}
        </div>
        {older.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <button onClick={() => setShowOld(!showOld)} style={{ background: 'none', border: 'none', color: 'var(--brand)', cursor: 'pointer', padding: 0 }}>
              {showOld ? 'Hide' : 'Show'} earlier revisions ({older.length} steps)
            </button>
            {showOld && older.map(s => (
              <div key={s.id} style={{ fontSize: 13, color: '#777', padding: '4px 0' }}>
                Rev. {s.revision_no} · {s.position_label} — {STEP_STATUS_LABEL[s.status] || s.status}{s.acted_by_email ? ` by ${s.acted_by_email}` : ''}{s.comment ? ` — “${s.comment}”` : ''}
              </div>
            ))}
          </div>
        )}

        {/* ── Actions ─────────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {cap.edit && <Link to={`/memos/${memo.id}/edit`} style={{ ...btn('#2563eb'), textDecoration: 'none' }}>{memo.status === 'returned' ? 'Revise & resubmit' : 'Edit'}</Link>}
          {cap.decide && (
            <>
              <button disabled={busy} style={btn('#16a34a')} onClick={() => run(() => memosApi.decide(memo.id, 'approve') as any, active?.kind === 'recommend' ? 'Recommended and signed.' : 'Approved and signed.')}>{approveLabel} &amp; sign</button>
              <button disabled={busy} style={btn('#d97706')} onClick={() => toggle('return')}>Return…</button>
              <button disabled={busy} style={btn('#b91c1c')} onClick={() => toggle('reject')}>Reject…</button>
            </>
          )}
          {cap.release && (
            <>
              <button disabled={busy} style={btn('#16a34a')} onClick={() => toggle('release')}>Release payment…</button>
              <button disabled={busy} style={btn('#c2410c')} onClick={() => toggle('refuse')}>Refuse release…</button>
            </>
          )}
          {cap.reinstruct && <button disabled={busy} style={btn('#2563eb')} onClick={() => toggle('reinstruct')}>Re-instruct finance…</button>}
          {cap.withdraw && <button disabled={busy} style={btn('#6b7280')} onClick={() => toggle('withdraw')}>Withdraw…</button>}
        </div>
        {(cap.decide || cap.release) && <SigHint />}

        {(panel === 'return' || panel === 'reject' || panel === 'refuse') && (
          <div style={box}>
            <strong>{panel === 'return' ? 'Return for changes' : panel === 'reject' ? 'Reject this memo' : 'Refuse the release'}</strong>
            <textarea style={{ ...input, minHeight: 80 }} placeholder="Reason (required — the author will read it)" value={comment} onChange={e => setComment(e.target.value)} />
            <button disabled={busy || needComment(comment)} style={{ ...btn(panel === 'return' ? '#d97706' : '#b91c1c'), marginTop: 12 }}
              onClick={() => panel === 'refuse'
                ? run(() => memosApi.release(memo.id, { decision: 'refuse', comment }) as any, 'Release refused.')
                : run(() => memosApi.decide(memo.id, panel === 'return' ? 'return' : 'reject', comment) as any, panel === 'return' ? 'Memo returned to the author.' : 'Memo rejected.')}>
              Confirm
            </button>
          </div>
        )}
        {panel === 'release' && (
          <div style={box}>
            <strong>Release the payment</strong>
            <input style={input} placeholder="Payment / voucher reference" value={payRef} onChange={e => setPayRef(e.target.value)} />
            <input style={input} placeholder="Comment (optional)" value={comment} onChange={e => setComment(e.target.value)} />
            <SigHint />
            <button disabled={busy || !payRef.trim()} style={{ ...btn('#16a34a'), marginTop: 4 }}
              onClick={() => run(() => memosApi.release(memo.id, { decision: 'release', release_reference: payRef, comment: comment || undefined }) as any, 'Payment released and signed.')}>
              Sign &amp; release
            </button>
          </div>
        )}
        {panel === 'reinstruct' && (
          <div style={box}>
            <strong>Ask finance to look at it again</strong>
            <textarea style={{ ...input, minHeight: 70 }} placeholder="What has changed or been clarified (required)" value={comment} onChange={e => setComment(e.target.value)} />
            <button disabled={busy || needComment(comment)} style={{ ...btn('#2563eb'), marginTop: 12 }}
              onClick={() => run(() => memosApi.reinstruct(memo.id, comment) as any, 'Sent back to finance.')}>Confirm</button>
          </div>
        )}
        {panel === 'withdraw' && (
          <div style={box}>
            <strong>Withdraw this memo</strong>
            <input style={input} placeholder="Reason (optional)" value={comment} onChange={e => setComment(e.target.value)} />
            <button disabled={busy} style={{ ...btn('#6b7280'), marginTop: 12 }}
              onClick={() => run(() => memosApi.withdraw(memo.id, comment || undefined) as any, 'Memo withdrawn.')}>Confirm withdrawal</button>
          </div>
        )}

        {/* ── Journal ─────────────────────────────────────────────── */}
        <h2 style={{ fontSize: 18, margin: '24px 0 8px' }}>History</h2>
        <div style={{ border: '1px solid #eee', borderRadius: 6, overflow: 'hidden' }}>
          {memo.events.map(ev => (
            <div key={ev.id} style={{ display: 'flex', gap: 12, padding: '10px 14px', borderBottom: '1px solid #f3f3f3', fontSize: 14 }}>
              <div style={{ fontSize: 18 }}>{EVENT_ICON[ev.event_type] || '•'}</div>
              <div style={{ flex: 1 }}>
                <strong style={{ textTransform: 'capitalize' }}>{ev.event_type.replace(/_/g, ' ')}</strong>
                <span style={{ color: '#999', fontSize: 12, marginLeft: 8 }}>{fmtDateTime(ev.event_at)} · {ev.actor_email || 'system'} · rev. {ev.revision_no}</span>
                {ev.notes && <div style={{ color: '#555', fontSize: 13, marginTop: 2 }}>{ev.notes}</div>}
              </div>
            </div>
          ))}
        </div>

        {padOpen && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}>
            <div style={{ background: '#fff', borderRadius: 8, padding: 20, width: 'min(640px, 100%)', maxHeight: '95vh', overflow: 'auto' }}>
              <SignaturePad title={pad ? 'Create your signature to continue' : 'Change your signature'}
                onCancel={() => { setPadOpen(false); setPad(null); }}
                onSaved={async () => {
                  setPadOpen(false); setSigKey(k => k + 1);
                  const again = pad; setPad(null);
                  if (again) await again();
                }} />
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
