// src/pages/MemoFormPage.tsx
// Rédaction d'un mémo (nouveau, brouillon ou mémo retourné). À gauche le
// formulaire, à droite l'aperçu du mémo tel qu'il sera lu et le circuit qu'il va
// suivre. Un niveau sans titulaire est signalé ici : le serveur refuserait la
// soumission, autant le dire avant.
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Layout from '../Layout';
import { usePermissions } from '../hooks/usePermissions';
import { SkeletonDetail } from '../components/Skeleton';
import SignaturePad from '../components/SignaturePad';
import MemoAttachments from '../components/MemoAttachments';
import { Spinner, MEMO_ANIMATIONS } from '../components/MemoSpinner';
import { memosApi, SIGNATURE_REQUIRED, DEFAULT_CURRENCY, currencyOptions, type MemoMeta, type MemoFull, type MemoFields } from '../hooks/useMemos';
import { todayDateString } from '../lib/dateHelpers';

const field: React.CSSProperties = { width: '100%', padding: 8, marginTop: 4, border: '1px solid #ddd', borderRadius: 4, boxSizing: 'border-box', background: '#fff' };
const label: React.CSSProperties = { display: 'block', fontSize: 13, color: '#666', marginTop: 12 };

export default function MemoFormPage() {
  const { id } = useParams();
  const memoId = id ? parseInt(id, 10) : null;
  const navigate = useNavigate();
  const { userInfo } = usePermissions();

  const [meta, setMeta] = useState<MemoMeta | null>(null);
  const [existing, setExisting] = useState<MemoFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPad, setShowPad] = useState(false);
  const [pendingSubmit, setPendingSubmit] = useState(false);
  const [action, setAction] = useState<'submit' | 'draft' | null>(null);   // bouton qui tourne
  const [managerEmail, setManagerEmail] = useState('');

  const [typeId, setTypeId] = useState<number | ''>('');
  const [templateId, setTemplateId] = useState<number | ''>('');
  const [toLabel, setToLabel] = useState('');
  const [fromLabel, setFromLabel] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [memoDate, setMemoDate] = useState(todayDateString());
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<string>(DEFAULT_CURRENCY);
  const [projectId, setProjectId] = useState<number | ''>('');
  const [activityRef, setActivityRef] = useState('');

  useEffect(() => {
    (async () => {
      const { data: m, error: e1 } = await memosApi.meta();
      if (e1 || !m) { setError(e1 || 'Could not load the memo settings'); setLoading(false); return; }
      setMeta(m);
      if (memoId) {
        const { data, error: e2 } = await memosApi.get(memoId);
        if (e2 || !data) { setError(e2 || 'Memo not found'); setLoading(false); return; }
        setExisting(data);
        setTypeId(data.type_id); setTemplateId(data.template_id || '');
        setToLabel(data.to_label || ''); setFromLabel(data.from_label || '');
        setSubject(data.subject || ''); setBody(data.body || '');
        setMemoDate((data.memo_date || todayDateString()).slice(0, 10));
        setAmount(data.amount ? String(data.amount) : ''); setCurrency(data.currency || DEFAULT_CURRENCY);
        setProjectId(data.project_id || ''); setActivityRef(data.activity_ref || '');
        setManagerEmail(data.manager_email || '');
      } else if (m.types[0]) {
        setTypeId(m.types[0].id);
      }
      setLoading(false);
    })();
  }, [memoId]);

  const type = meta?.types.find(t => t.id === typeId) || null;
  const templates = useMemo(() => (meta?.templates || []).filter(t => t.type_id === typeId), [meta, typeId]);
  const template = templates.find(t => t.id === templateId) || templates.find(t => t.is_default) || templates[0] || null;
  useEffect(() => { if (!templates.some(t => t.id === templateId)) setTemplateId(''); }, [templates]); // eslint-disable-line

  const missingLevels = (template?.steps || []).filter(s => s.holders === 0);
  // Managers au choix : titulaires du niveau « recommander » du circuit, hors l'auteur.
  const recommendStep = (template?.steps || []).find(s => s.kind === 'recommend') || null;
  const me = (userInfo?.email || '').toLowerCase();
  const managerChoices = recommendStep
    ? (meta?.managers || []).filter(m => m.position_code === recommendStep.position_code && m.email.toLowerCase() !== me)
    : [];
  useEffect(() => {
    if (managerEmail && !managerChoices.some(m => m.email.toLowerCase() === managerEmail.toLowerCase())) setManagerEmail('');
  }, [template?.id, meta]); // eslint-disable-line
  const project = meta?.projects.find(p => p.id === projectId) || null;

  const payload = (): MemoFields => ({
    type_id: Number(typeId), template_id: template ? template.id : null,
    to_label: toLabel, from_label: fromLabel, subject, body, memo_date: memoDate,
    amount: type?.requires_amount && amount ? amount : null, currency: amount ? currency : null,
    project_id: projectId ? Number(projectId) : null, activity_ref: activityRef || null,
    manager_email: managerChoices.length > 1 && managerEmail ? managerEmail : null,
  });

  const save = async (): Promise<number | null> => {
    if (!typeId) { setError('Pick a memo type.'); return null; }
    const target = memoId || existing?.id || null;   // déjà créé pendant cette session ? on met à jour
    if (target) {
      const { error: e } = await memosApi.update(target, payload());
      if (e) { setError(e); return null; }
      return target;
    }
    const { data, error: e } = await memosApi.create(payload());
    if (e || !data) { setError(e || 'Could not save'); return null; }
    return data.id;
  };

  const trySubmit = async (mid: number) => {
    const { data, error: e, code } = await memosApi.submit(mid) as any;
    if (code === SIGNATURE_REQUIRED) { setPendingSubmit(true); setShowPad(true); return false; }
    if (e) { setError(e); return false; }
    navigate(`/memos/${mid}`, { state: { message: data?.reference ? `Submitted as ${data.reference}.` : 'Submitted.' } });
    return true;
  };

  const onSaveDraft = async () => {
    setBusy(true); setAction('draft'); setError(null);
    const mid = await save();
    setBusy(false); setAction(null);
    if (mid) navigate(memoId ? `/memos/${mid}` : `/memos/${mid}/edit`, { replace: true });
  };

  const onSubmit = async () => {
    setBusy(true); setAction('submit'); setError(null);
    const mid = await save();
    if (mid) {
      if (!memoId) window.history.replaceState(null, '', `/memos/${mid}/edit`);
      setExisting(prev => prev || ({ id: mid } as any));
      await trySubmit(mid);
    }
    setBusy(false); setAction(null);
  };

  if (loading) return <Layout><SkeletonDetail /></Layout>;
  if (!meta) return <Layout><div style={{ padding: 20 }}>❌ {error}</div></Layout>;

  const currentId = memoId || existing?.id || null;
  const readOnly = existing && existing.capabilities && !existing.capabilities.edit;
  const lastReturn = existing?.events?.filter(ev => ev.event_type === 'returned').slice(-1)[0];

  return (
    <Layout>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: 20 }}>
        <style>{MEMO_ANIMATIONS}</style>
        <Link to="/memos" style={{ fontSize: 13, color: '#666' }}>← All memos</Link>
        <h1 style={{ margin: '10px 0 4px' }}>{memoId ? (existing?.status === 'returned' ? 'Revise memo' : 'Edit memo') : 'New memo'}</h1>
        {existing?.reference && <p style={{ color: '#999', fontSize: 13, marginTop: 0 }}>{existing.reference} · revision {existing.revision_no}</p>}

        {lastReturn && existing?.status === 'returned' && (
          <div style={{ padding: 12, margin: '12px 0', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 4, fontSize: 14 }}>
            <strong>Returned for changes</strong> by {lastReturn.actor_email}{lastReturn.notes ? ` — “${lastReturn.notes}”` : ''}
          </div>
        )}
        {readOnly && <div style={{ padding: 12, margin: '12px 0', background: '#fef3c7', borderRadius: 4 }}>This memo can no longer be edited. <Link to={`/memos/${memoId}`}>Open it</Link></div>}
        {error && <div style={{ padding: 12, margin: '12px 0', background: '#f8d7da', color: '#721c24', borderRadius: 4 }}>❌ {error}</div>}

        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {/* ── Formulaire ───────────────────────────────────────────── */}
          <div style={{ flex: '1 1 380px', minWidth: 300 }}>
            <label style={label}>Memo type
              <select style={field} disabled={!!memoId} value={typeId} onChange={e => setTypeId(Number(e.target.value))}>
                {meta.types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            {templates.length > 1 && (
              <label style={label}>Approval chain
                <select style={field} value={template?.id || ''} onChange={e => setTemplateId(Number(e.target.value))}>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
            )}
            {managerChoices.length > 1 && (
              <label style={label}>{recommendStep!.position_label} who will recommend this memo
                <select style={field} value={managerEmail} onChange={e => setManagerEmail(e.target.value)}>
                  <option value="">Any {recommendStep!.position_label} (all are notified)</option>
                  {managerChoices.map(m => <option key={m.email} value={m.email}>{m.email}{m.holder_role === 'deputy' ? ' (deputy)' : ''}</option>)}
                </select>
                <span style={{ fontSize: 12, color: '#999' }}>If you pick one person, only they can sign this step and receive the e-mail. You can change it while it waits.</span>
              </label>
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              <label style={{ ...label, flex: 1 }}>To<input style={field} value={toLabel} onChange={e => setToLabel(e.target.value)} placeholder="e.g. The Director" /></label>
              <label style={{ ...label, flex: 1 }}>From<input style={field} value={fromLabel} onChange={e => setFromLabel(e.target.value)} placeholder="Your name and role" /></label>
            </div>
            <label style={label}>Date<input style={field} type="date" value={memoDate} onChange={e => setMemoDate(e.target.value)} /></label>
            <label style={label}>Subject<input style={field} value={subject} onChange={e => setSubject(e.target.value)} /></label>
            {(type?.requires_amount || type?.requires_project || projectId) ? (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {!!type?.requires_amount && (
                  <>
                    <label style={{ ...label, flex: '2 1 120px' }}>Amount<input style={field} type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></label>
                    <label style={{ ...label, flex: '1 1 80px' }}>Currency
                      <select style={field} value={currency} onChange={e => setCurrency(e.target.value)}>
                        {currencyOptions(currency).map(c => <option key={c}>{c}</option>)}
                      </select>
                    </label>
                  </>
                )}
              </div>
            ) : null}
            <label style={label}>Project{type?.requires_project ? '' : ' (optional)'}
              <select style={field} value={projectId} onChange={e => setProjectId(e.target.value ? Number(e.target.value) : '')}>
                <option value="">— None —</option>
                {meta.projects.map(p => <option key={p.id} value={p.id}>{p.code} · {p.title}</option>)}
              </select>
            </label>
            <label style={label}>Activity reference (optional)<input style={field} value={activityRef} onChange={e => setActivityRef(e.target.value)} /></label>
            <label style={label}>Body
              <textarea style={{ ...field, minHeight: 220, fontFamily: 'inherit' }} value={body} onChange={e => setBody(e.target.value)} />
            </label>

            {currentId && existing && <MemoAttachments memoId={currentId} revisionNo={existing.revision_no || 1}
              attachments={existing.attachments || []} editable={!readOnly}
              required={!!type?.requires_attachment} onChanged={async () => { const { data } = await memosApi.get(currentId); if (data) setExisting(data); }} />}
            {!currentId && type?.requires_attachment ? (
              <p style={{ fontSize: 13, color: '#666', marginTop: 12 }}>📎 Save the draft first, then attach the supporting documents (required for this type).</p>
            ) : null}

            {!readOnly && (
              <div style={{ display: 'flex', gap: 8, marginTop: 20, flexWrap: 'wrap' }}>
                <button disabled={busy} onClick={onSubmit} style={{ padding: '10px 18px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                  {action === 'submit' && <Spinner />}{action === 'submit' ? 'Submitting…' : existing?.status === 'returned' ? 'Sign & resubmit' : 'Sign & submit'}
                </button>
                <button disabled={busy} onClick={onSaveDraft} style={{ padding: '10px 18px', background: '#f4f1ee', border: 'none', borderRadius: 4, cursor: 'pointer' }}>{action === 'draft' && <Spinner color="#555" />}{action === 'draft' ? 'Saving…' : 'Save draft'}</button>
              </div>
            )}
          </div>

          {/* ── Aperçu + circuit ─────────────────────────────────────── */}
          <div style={{ flex: '1 1 380px', minWidth: 300 }}>
            <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 4, padding: 28, boxShadow: '0 1px 4px rgba(0,0,0,.06)', fontSize: 14 }}>
              <div style={{ textAlign: 'center', letterSpacing: 2, fontWeight: 700, marginBottom: 16 }}>MEMORANDUM</div>
              <table style={{ borderCollapse: 'collapse', width: '100%', marginBottom: 14 }}><tbody>
                <tr><td style={{ width: 70, color: '#888', padding: '3px 0' }}>TO</td><td>{toLabel || '…'}</td></tr>
                <tr><td style={{ color: '#888', padding: '3px 0' }}>FROM</td><td>{fromLabel || userInfo?.email || '…'}</td></tr>
                <tr><td style={{ color: '#888', padding: '3px 0' }}>DATE</td><td>{memoDate ? new Date(memoDate + 'T12:00:00').toLocaleDateString('en-GB') : '…'}</td></tr>
                <tr><td style={{ color: '#888', padding: '3px 0' }}>SUBJECT</td><td><strong>{subject || '…'}</strong></td></tr>
                {project && <tr><td style={{ color: '#888', padding: '3px 0' }}>PROJECT</td><td>{project.code} · {project.title}</td></tr>}
                {amount && type?.requires_amount ? <tr><td style={{ color: '#888', padding: '3px 0' }}>AMOUNT</td><td>{Number(amount).toLocaleString('en-GB')} {currency}</td></tr> : null}
              </tbody></table>
              <hr style={{ border: 0, borderTop: '1px solid #ddd' }} />
              <div style={{ whiteSpace: 'pre-wrap', minHeight: 120, marginTop: 12 }}>{body || <span style={{ color: '#bbb' }}>The memo text appears here.</span>}</div>
            </div>

            <h3 style={{ fontSize: 15, margin: '20px 0 6px' }}>Approval chain</h3>
            <ol style={{ paddingLeft: 20, margin: 0, fontSize: 14 }}>
              <li style={{ padding: '3px 0' }}>You — submit (signed)</li>
              {(template?.steps || []).map(s => (
                <li key={s.step_no} style={{ padding: '3px 0', color: s.holders === 0 ? '#b91c1c' : undefined }}>
                  {s.position_label} — {s.kind}{s.kind !== 'release' ? ' (signed)' : ' (payment reference)'}
                  {s.kind === 'recommend' && managerEmail && managerChoices.length > 1 ? ` · ${managerEmail}` : ''}
                  {s.holders === 0 && ' ⚠️ no signatory assigned'}
                </li>
              ))}
            </ol>
            {missingLevels.length > 0 && (
              <p style={{ fontSize: 13, color: '#b91c1c' }}>
                This memo cannot be submitted until an admin assigns someone (other than you) to: {missingLevels.map(s => s.position_label).join(', ')}.
              </p>
            )}
            {!meta.signature && <p style={{ fontSize: 13, color: '#666' }}>You will be asked to create your signature the first time you sign.</p>}
          </div>
        </div>

        {showPad && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}>
            <div style={{ background: '#fff', borderRadius: 8, padding: 20, width: 'min(640px, 100%)', maxHeight: '95vh', overflow: 'auto' }}>
              <SignaturePad title="Create your signature"
                onCancel={() => { setShowPad(false); setPendingSubmit(false); }}
                onSaved={async () => {
                  setShowPad(false);
                  if (pendingSubmit && currentId) { setPendingSubmit(false); setBusy(true); await trySubmit(currentId); setBusy(false); }
                }} />
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
