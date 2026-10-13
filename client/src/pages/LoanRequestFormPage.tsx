// src/pages/LoanRequestFormPage.tsx
// Demande de prêt. Le contrôle de disponibilité est fait côté serveur
// (GET /loans/availability) et rejoué à l'approbation : l'affichage ici est
// une courtoisie, jamais la garantie — deux demandes simultanées sur le même
// créneau sont départagées en base, pas dans le navigateur.
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Layout from '../Layout';
import { api } from '../lib/apiClient';
import { todayDateString } from '../lib/dateHelpers';
import { usePermissions } from '../hooks/usePermissions';
import { useLoans } from '../hooks/useLoans';

type AssetOption = {
  id: number;
  label: string;
  serial_no: string | null;
  status: string;
  category_name: string | null;
};

type UserOption = { id: string; email: string; role?: string };

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return todayDateString(d);
};

export default function LoanRequestFormPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAdmin } = usePermissions();
  const { checkAvailability, requestLoan } = useLoans();

  const [assets, setAssets] = useState<AssetOption[]>([]);
  const [assetSearch, setAssetSearch] = useState('');
  const [assetId, setAssetId] = useState<number | null>(
    searchParams.get('asset_id') ? parseInt(searchParams.get('asset_id')!, 10) : null
  );

  const [users, setUsers] = useState<UserOption[]>([]);
  const [borrowerUid, setBorrowerUid] = useState('');

  const [startDate, setStartDate] = useState(todayDateString());
  const [dueDate, setDueDate] = useState(addDays(todayDateString(), 7));
  const [purpose, setPurpose] = useState('');

  const [availability, setAvailability] = useState<{ available: boolean; reason?: string; upcoming?: any[] } | null>(null);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      // Le matériel retiré ou vendu aux enchères n'est pas prêtable : le serveur
      // le refuse de toute façon, autant ne pas le proposer.
      const { data } = await api.get<{ data: AssetOption[] }>('/assets?limit=500');
      if (data?.data) setAssets(data.data.filter(a => a.status !== 'retired' && a.status !== 'auctioned'));
      if (isAdmin) {
        const { data: u } = await api.get<UserOption[]>('/users/assignable');
        if (Array.isArray(u)) setUsers(u);
      }
      setLoading(false);
    };
    load();
  }, [isAdmin]);

  // Chaque changement d'asset ou de dates invalide le verdict précédent.
  useEffect(() => {
    setAvailability(null);
    if (!assetId || !startDate || !dueDate || dueDate < startDate) return;
    let cancelled = false;
    setChecking(true);
    const t = setTimeout(async () => {
      const result = await checkAvailability(assetId, startDate, dueDate);
      if (!cancelled) { setAvailability(result); setChecking(false); }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); setChecking(false); };
  }, [assetId, startDate, dueDate, checkAvailability]);

  const filteredAssets = useMemo(() => {
    if (!assetSearch.trim()) return assets.slice(0, 50);
    const s = assetSearch.toLowerCase();
    return assets.filter(a =>
      a.label.toLowerCase().includes(s) ||
      (a.serial_no || '').toLowerCase().includes(s) ||
      (a.category_name || '').toLowerCase().includes(s)
    ).slice(0, 50);
  }, [assets, assetSearch]);

  const selectedAsset = assets.find(a => a.id === assetId) || null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!assetId) return setError('Pick the equipment to borrow.');
    if (!startDate || !dueDate) return setError('Both dates are required.');
    if (dueDate < startDate) return setError('The due date must be on or after the start date.');

    setSubmitting(true);
    const { data, error: apiError } = await requestLoan({
      asset_id: assetId,
      start_date: startDate,
      due_date: dueDate,
      purpose: purpose || undefined,
      borrower_uid: isAdmin && borrowerUid ? borrowerUid : undefined,
    });
    setSubmitting(false);

    if (apiError || !data?.id) return setError(apiError || 'Failed to create the loan');
    navigate(`/loans/${data.id}`);
  };

  if (loading) return <Layout><div style={{ padding: 20, textAlign: 'center' }}>Loading…</div></Layout>;

  const field: React.CSSProperties = { width: '100%', padding: 8, marginTop: 8, border: '1px solid #ddd', borderRadius: 4, boxSizing: 'border-box' };

  return (
    <Layout>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: 20 }}>
        <h1>New loan</h1>
        <p style={{ color: '#666', marginTop: -8, marginBottom: 20, fontSize: 14 }}>
          {isAdmin
            ? 'Recording a loan for someone else approves it straight away — you are the one lending it.'
            : 'Your request goes to IT for approval. You will get an email either way.'}
        </p>

        {error && <div style={{ padding: 12, marginBottom: 12, background: '#f8d7da', color: '#721c24', borderRadius: 4 }}>❌ {error}</div>}

        <form onSubmit={handleSubmit}>
          <label>
            <strong>Equipment *</strong>
            <input type="text" placeholder="Search by name, serial or category…" value={assetSearch} onChange={e => setAssetSearch(e.target.value)} style={field} />
          </label>

          <div style={{ border: '1px solid #eee', borderRadius: 4, maxHeight: 220, overflowY: 'auto', margin: '8px 0 20px' }}>
            {filteredAssets.map(a => (
              <div
                key={a.id}
                onClick={() => setAssetId(a.id)}
                style={{
                  padding: 10, borderBottom: '1px solid #f1f1f1', cursor: 'pointer', fontSize: 14,
                  background: assetId === a.id ? '#e3f2fd' : '#fff',
                }}
              >
                <strong>{a.label}</strong>
                <span style={{ color: '#999', fontSize: 12, marginLeft: 8 }}>
                  {a.serial_no || '—'} · {a.category_name || 'Uncategorised'} · {a.status.replace('_', ' ')}
                </span>
              </div>
            ))}
            {filteredAssets.length === 0 && <div style={{ padding: 16, textAlign: 'center', color: '#999' }}>No matching equipment.</div>}
          </div>

          {isAdmin && (
            <label style={{ display: 'block', marginBottom: 20 }}>
              <strong>Borrower</strong>
              <select value={borrowerUid} onChange={e => setBorrowerUid(e.target.value)} style={{ ...field, background: '#fff' }}>
                <option value="">— Myself —</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.email}</option>)}
              </select>
            </label>
          )}

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
            <label style={{ flex: '1 1 180px' }}>
              <strong>From *</strong>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={field} />
            </label>
            <label style={{ flex: '1 1 180px' }}>
              <strong>Due back *</strong>
              <input type="date" value={dueDate} min={startDate} onChange={e => setDueDate(e.target.value)} style={field} />
            </label>
          </div>

          <label style={{ display: 'block', marginBottom: 20 }}>
            <strong>Purpose</strong>
            <input type="text" placeholder="e.g., Field recording in Tamale (optional)" value={purpose} onChange={e => setPurpose(e.target.value)} style={field} />
          </label>

          {selectedAsset && (
            <div style={{ marginBottom: 20, fontSize: 14 }}>
              {checking && <span style={{ color: '#666' }}>Checking availability…</span>}
              {!checking && availability && !availability.available && (
                <div style={{ padding: 12, background: '#fef2f2', color: '#b91c1c', borderRadius: 4 }}>
                  ⛔ {availability.reason}
                </div>
              )}
              {!checking && availability?.available && (
                <div style={{ padding: 12, background: '#f0fdf4', color: '#166534', borderRadius: 4 }}>
                  ✅ {selectedAsset.label} is free from {startDate} to {dueDate}.
                  {availability.upcoming && availability.upcoming.length > 0 && (
                    <div style={{ marginTop: 8, fontSize: 13, color: '#166534' }}>
                      Already booked later: {availability.upcoming.map((u: any) => `${u.start_date}→${u.due_date}`).join(', ')}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="submit"
              disabled={submitting || (availability !== null && !availability.available)}
              style={{
                flex: 1, padding: 12, background: 'var(--brand)', color: '#fff', border: 'none', borderRadius: 4,
                cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting || (availability !== null && !availability.available) ? 0.6 : 1,
              }}
            >
              {submitting ? 'Saving…' : isAdmin && borrowerUid ? 'Record loan' : 'Submit request'}
            </button>
            <button type="button" onClick={() => navigate('/loans')} style={{ flex: 1, padding: 12, background: '#f4f1ee', color: 'var(--ink)', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
}
