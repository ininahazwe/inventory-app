// src/pages/LoanDetailPage.tsx
// Fiche d'un prêt : l'état courant, les actions possibles à cette étape, et le
// journal complet du cycle (loan_events). Les boutons affichés sont ceux que le
// serveur accepterait — la machine à états reste la sienne, on ne fait que ne
// pas proposer ce qu'il refuserait.
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Layout from '../Layout';
import { api } from '../lib/apiClient';
import { usePermissions } from '../hooks/usePermissions';
import { useLoans, LOAN_STATUS_LABEL, LOAN_STATUS_COLOR, type Loan, type LoanEvent, type ConditionIn } from '../hooks/useLoans';

type LoanFull = Loan & { events: LoanEvent[] };
type LocationOption = { id: number; name: string; floor: string | null };

const EVENT_ICON: Record<string, string> = {
  requested: '📥', approved: '✅', rejected: '❌', cancelled: '🚫',
  checked_out: '📤', extended: '🗓️', returned: '📦', overdue_reminder: '⏰', pickup_reminder: '📣',
};

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div style={{ display: 'flex', gap: 12, padding: '6px 0', borderBottom: '1px solid #f3f3f3', fontSize: 14 }}>
    <div style={{ width: 150, color: '#888', flexShrink: 0 }}>{label}</div>
    <div style={{ flex: 1 }}>{children}</div>
  </div>
);

const btn = (bg: string): React.CSSProperties => ({
  padding: '10px 16px', background: bg, color: '#fff', border: 'none',
  borderRadius: 4, cursor: 'pointer', fontSize: 14,
});

export default function LoanDetailPage() {
  const { id } = useParams();
  const loanId = parseInt(id || '0', 10);
  const navigate = useNavigate();
  const { isAdmin, userInfo } = usePermissions();
  const { fetchLoan, decide, cancel, checkout, extend, checkin } = useLoans();

  const [loan, setLoan] = useState<LoanFull | null>(null);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Panneau d'action ouvert (un seul à la fois) et ses champs.
  const [panel, setPanel] = useState<null | 'reject' | 'checkout' | 'extend' | 'checkin'>(null);
  const [notes, setNotes] = useState('');
  const [conditionOut, setConditionOut] = useState('good');
  const [conditionIn, setConditionIn] = useState<ConditionIn>('good');
  const [openIncident, setOpenIncident] = useState(true);
  const [returnLocationId, setReturnLocationId] = useState('');
  const [newDueDate, setNewDueDate] = useState('');

  const reload = useCallback(async () => {
    const data = await fetchLoan(loanId);
    if (data) { setLoan(data as LoanFull); setNewDueDate(data.due_date); }
    setLoading(false);
  }, [fetchLoan, loanId]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    api.get<LocationOption[]>('/locations').then(({ data }) => { if (Array.isArray(data)) setLocations(data); });
  }, []);

  const run = async (fn: () => Promise<{ error: string | null }>, okMessage: string) => {
    setBusy(true); setError(null); setMessage(null);
    const { error: apiError } = await fn();
    setBusy(false);
    if (apiError) { setError(apiError); return; }
    setMessage(okMessage);
    setPanel(null); setNotes('');
    await reload();
  };

  if (loading) return <Layout><div style={{ padding: 20, textAlign: 'center' }}>Loading…</div></Layout>;
  if (!loan) return <Layout><div style={{ padding: 20, textAlign: 'center' }}>Loan not found. <Link to="/loans">Back to loans</Link></div></Layout>;

  const overdue = loan.status === 'checked_out' && Number(loan.is_overdue) === 1;
  const isMine = userInfo?.email === loan.borrower_email || userInfo?.email === loan.requested_by_email;
  const canCancel = (isAdmin || isMine) && (loan.status === 'requested' || loan.status === 'approved');

  return (
    <Layout>
      <div style={{ maxWidth: 860, margin: '0 auto', padding: 20 }}>
        <Link to="/loans" style={{ fontSize: 13, color: '#666' }}>← All loans</Link>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', margin: '10px 0 4px' }}>
          <h1 style={{ margin: 0 }}>{loan.asset_label || `Asset #${loan.asset_id}`}</h1>
          <span style={{
            padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, color: '#fff',
            background: overdue ? '#b91c1c' : LOAN_STATUS_COLOR[loan.status],
          }}>
            {overdue ? `Overdue · ${loan.days_past_due}d` : LOAN_STATUS_LABEL[loan.status]}
          </span>
        </div>
        <p style={{ color: '#999', fontSize: 13, marginTop: 0 }}>Loan #{loan.id}</p>

        {error && <div style={{ padding: 12, margin: '12px 0', background: '#f8d7da', color: '#721c24', borderRadius: 4 }}>❌ {error}</div>}
        {message && <div style={{ padding: 12, margin: '12px 0', background: '#d4edda', color: '#155724', borderRadius: 4 }}>✅ {message}</div>}

        {/* ─── Les faits ─────────────────────────────────────────────────── */}
        <div style={{ border: '1px solid #eee', borderRadius: 6, padding: 16, marginBottom: 20 }}>
          <Row label="Equipment">
            <Link to={`/asset/${loan.asset_id}`}>{loan.asset_label || `Asset #${loan.asset_id}`}</Link>
            {loan.asset_serial_no ? <span style={{ color: '#999' }}> · {loan.asset_serial_no}</span> : null}
          </Row>
          <Row label="Borrower">{loan.borrower_email}</Row>
          <Row label="Period">{loan.start_date} → {loan.due_date}{loan.extended_count > 0 ? ` (extended ${loan.extended_count}×)` : ''}</Row>
          <Row label="Purpose">{loan.purpose || '—'}</Row>
          <Row label="Requested by">{loan.requested_by_email}</Row>
          {loan.decided_by_email && <Row label="Decision">{loan.status === 'rejected' ? 'Declined' : 'Approved'} by {loan.decided_by_email}{loan.decision_notes ? ` — ${loan.decision_notes}` : ''}</Row>}
          {loan.checked_out_at && <Row label="Picked up">{new Date(loan.checked_out_at).toLocaleString('en-GB')} · condition {loan.condition_out}</Row>}
          {loan.returned_at && (
            <Row label="Returned">
              {new Date(loan.returned_at).toLocaleString('en-GB')} · condition {loan.condition_in}
              {loan.return_location_name ? ` · ${loan.return_location_name}` : ''}
              {loan.incident_id ? <> · <Link to={`/incidents/${loan.incident_id}`}>incident #{loan.incident_id}</Link></> : null}
            </Row>
          )}
          {loan.notes && <Row label="Notes">{loan.notes}</Row>}
        </div>

        {/* ─── Les actions de l'étape ────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
          {isAdmin && loan.status === 'requested' && (
            <>
              <button disabled={busy} style={btn('#16a34a')} onClick={() => run(() => decide(loan.id, 'approved'), 'Loan approved — the borrower has been emailed.')}>Approve</button>
              <button disabled={busy} style={btn('#b91c1c')} onClick={() => setPanel(panel === 'reject' ? null : 'reject')}>Decline…</button>
            </>
          )}
          {isAdmin && loan.status === 'approved' && (
            <button disabled={busy} style={btn('#7c3aed')} onClick={() => setPanel(panel === 'checkout' ? null : 'checkout')}>Check out…</button>
          )}
          {isAdmin && loan.status === 'checked_out' && (
            <button disabled={busy} style={btn('#16a34a')} onClick={() => setPanel(panel === 'checkin' ? null : 'checkin')}>Check in…</button>
          )}
          {isAdmin && (loan.status === 'approved' || loan.status === 'checked_out') && (
            <button disabled={busy} style={btn('#2563eb')} onClick={() => setPanel(panel === 'extend' ? null : 'extend')}>Extend…</button>
          )}
          {canCancel && (
            <button disabled={busy} style={btn('#6b7280')} onClick={() => run(() => cancel(loan.id, 'Cancelled from the loan page'), 'Loan cancelled.')}>Cancel loan</button>
          )}
        </div>

        {panel === 'reject' && (
          <div style={{ border: '1px solid #eee', borderRadius: 6, padding: 16, marginBottom: 20 }}>
            <strong>Decline this request</strong>
            <input type="text" placeholder="Reason (shown to the borrower)" value={notes} onChange={e => setNotes(e.target.value)} style={{ width: '100%', padding: 8, marginTop: 8, border: '1px solid #ddd', borderRadius: 4, boxSizing: 'border-box' }} />
            <button disabled={busy} style={{ ...btn('#b91c1c'), marginTop: 12 }} onClick={() => run(() => decide(loan.id, 'rejected', notes), 'Request declined.')}>Confirm decline</button>
          </div>
        )}

        {panel === 'checkout' && (
          <div style={{ border: '1px solid #eee', borderRadius: 6, padding: 16, marginBottom: 20 }}>
            <strong>Hand the equipment over</strong>
            <p style={{ fontSize: 13, color: '#666' }}>Record the condition now — it is what the return is compared against.</p>
            <select value={conditionOut} onChange={e => setConditionOut(e.target.value)} style={{ padding: 8, border: '1px solid #ddd', borderRadius: 4, background: '#fff' }}>
              <option value="good">Good</option>
              <option value="fair">Fair — minor wear</option>
              <option value="damaged">Already damaged</option>
            </select>
            <input type="text" placeholder="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} style={{ width: '100%', padding: 8, marginTop: 8, border: '1px solid #ddd', borderRadius: 4, boxSizing: 'border-box' }} />
            <button disabled={busy} style={{ ...btn('#7c3aed'), marginTop: 12 }} onClick={() => run(() => checkout(loan.id, conditionOut, notes), 'Checked out — the asset is now marked as on loan.')}>Confirm check-out</button>
          </div>
        )}

        {panel === 'extend' && (
          <div style={{ border: '1px solid #eee', borderRadius: 6, padding: 16, marginBottom: 20 }}>
            <strong>Push the due date back</strong>
            <p style={{ fontSize: 13, color: '#666' }}>Refused if another booking already covers the extra days.</p>
            <input type="date" value={newDueDate} min={loan.due_date} onChange={e => setNewDueDate(e.target.value)} style={{ padding: 8, border: '1px solid #ddd', borderRadius: 4 }} />
            <input type="text" placeholder="Reason (optional)" value={notes} onChange={e => setNotes(e.target.value)} style={{ width: '100%', padding: 8, marginTop: 8, border: '1px solid #ddd', borderRadius: 4, boxSizing: 'border-box' }} />
            <button disabled={busy} style={{ ...btn('#2563eb'), marginTop: 12 }} onClick={() => run(() => extend(loan.id, newDueDate, notes), 'Due date extended.')}>Confirm extension</button>
          </div>
        )}

        {panel === 'checkin' && (
          <div style={{ border: '1px solid #eee', borderRadius: 6, padding: 16, marginBottom: 20 }}>
            <strong>Take the equipment back</strong>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
              <label style={{ flex: '1 1 200px' }}>
                <span style={{ fontSize: 13, color: '#666' }}>Condition on return</span>
                <select value={conditionIn} onChange={e => setConditionIn(e.target.value as ConditionIn)} style={{ width: '100%', padding: 8, marginTop: 4, border: '1px solid #ddd', borderRadius: 4, background: '#fff' }}>
                  <option value="good">Good — back in stock</option>
                  <option value="fair">Fair — back in stock</option>
                  <option value="damaged">Damaged — sent to repair</option>
                  <option value="lost">Not returned / lost — retired</option>
                </select>
              </label>
              <label style={{ flex: '1 1 200px' }}>
                <span style={{ fontSize: 13, color: '#666' }}>Returned to</span>
                <select value={returnLocationId} onChange={e => setReturnLocationId(e.target.value)} style={{ width: '100%', padding: 8, marginTop: 4, border: '1px solid #ddd', borderRadius: 4, background: '#fff' }}>
                  <option value="">— Not recorded —</option>
                  {locations.map(l => <option key={l.id} value={l.id}>{l.name}{l.floor ? ` · ${l.floor}` : ''}</option>)}
                </select>
              </label>
            </div>
            <input type="text" placeholder="What was observed (optional)" value={notes} onChange={e => setNotes(e.target.value)} style={{ width: '100%', padding: 8, marginTop: 8, border: '1px solid #ddd', borderRadius: 4, boxSizing: 'border-box' }} />
            {(conditionIn === 'damaged' || conditionIn === 'lost') && (
              <label style={{ display: 'block', marginTop: 10, fontSize: 13 }}>
                <input type="checkbox" checked={openIncident} onChange={e => setOpenIncident(e.target.checked)} />{' '}
                Open an incident on this asset
              </label>
            )}
            <button
              disabled={busy}
              style={{ ...btn('#16a34a'), marginTop: 12 }}
              onClick={() => run(
                () => checkin(loan.id, {
                  condition_in: conditionIn,
                  return_location_id: returnLocationId ? parseInt(returnLocationId, 10) : undefined,
                  notes: notes || undefined,
                  open_incident: openIncident,
                }),
                'Return recorded — the loan is closed.'
              )}
            >
              Confirm return
            </button>
          </div>
        )}

        {/* ─── Le cycle, de bout en bout ─────────────────────────────────── */}
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>History</h2>
        <div style={{ border: '1px solid #eee', borderRadius: 6, overflow: 'hidden' }}>
          {loan.events.length === 0 && <div style={{ padding: 16, color: '#999' }}>No events recorded.</div>}
          {loan.events.map(ev => (
            <div key={ev.id} style={{ display: 'flex', gap: 12, padding: '10px 14px', borderBottom: '1px solid #f3f3f3', fontSize: 14 }}>
              <div style={{ fontSize: 18 }}>{EVENT_ICON[ev.event_type] || '•'}</div>
              <div style={{ flex: 1 }}>
                <strong style={{ textTransform: 'capitalize' }}>{ev.event_type.replace('_', ' ')}</strong>
                <span style={{ color: '#999', fontSize: 12, marginLeft: 8 }}>
                  {new Date(ev.event_at).toLocaleString('en-GB')} · {ev.actor_email || 'system'}
                </span>
                {ev.notes && <div style={{ color: '#555', fontSize: 13, marginTop: 2 }}>{ev.notes}</div>}
                {ev.payload && (
                  <div style={{ color: '#888', fontSize: 12, marginTop: 2 }}>
                    {Object.entries(ev.payload).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(' · ')}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <button onClick={() => navigate('/loans')} style={{ marginTop: 20, padding: '10px 16px', background: '#f4f1ee', color: 'var(--ink)', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
          Back to loans
        </button>
      </div>
    </Layout>
  );
}
