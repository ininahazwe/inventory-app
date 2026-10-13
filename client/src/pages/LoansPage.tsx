// src/pages/LoansPage.tsx
// Écran principal du module prêts : compteurs du cycle en haut, puis la liste
// filtrée par étape. Les actions (approuver, sortir, rendre) vivent sur la fiche
// du prêt — ici on ne fait que voir où en est chaque prêt et y accéder.
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Layout from '../Layout';
import { usePermissions } from '../hooks/usePermissions';
import { SectionRevealCover } from '../components/SectionRevealCover';
import { useLoans, LOAN_STATUS_LABEL, LOAN_STATUS_COLOR, type Loan, type LoanStatus } from '../hooks/useLoans';

type Tab = { key: string; label: string; query: string };

const TABS: Tab[] = [
  { key: 'active',    label: 'In progress', query: '?status=requested,approved,checked_out' },
  { key: 'pending',   label: 'Pending',     query: '?status=requested' },
  { key: 'out',       label: 'Out',         query: '?status=checked_out' },
  { key: 'overdue',   label: 'Overdue',     query: '?overdue=1' },
  { key: 'returned',  label: 'Returned',    query: '?status=returned' },
  { key: 'all',       label: 'All',         query: '' },
];

const StatCard = ({ label, value, color }: { label: string; value: number; color: string }) => (
  <div style={{ flex: '1 1 120px', padding: 12, border: '1px solid #eee', borderRadius: 6, background: '#fff' }}>
    <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
    <div style={{ fontSize: 12, color: '#666' }}>{label}</div>
  </div>
);

export function LoanStatusBadge({ loan }: { loan: Pick<Loan, 'status' | 'is_overdue' | 'days_past_due'> }) {
  const overdue = loan.status === 'checked_out' && Number(loan.is_overdue) === 1;
  const color = overdue ? '#b91c1c' : LOAN_STATUS_COLOR[loan.status as LoanStatus];
  const label = overdue
    ? `Overdue · ${loan.days_past_due}d`
    : LOAN_STATUS_LABEL[loan.status as LoanStatus] || loan.status;
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 12,
      fontWeight: 600, color: '#fff', background: color, whiteSpace: 'nowrap',
    }}>{label}</span>
  );
}

export default function LoansPage() {
  const navigate = useNavigate();
  const { isAdmin } = usePermissions();
  const { loans, stats, loading, error, fetchLoans, fetchStats } = useLoans();

  const [tab, setTab] = useState<Tab>(TABS[0]);
  const [search, setSearch] = useState('');

  useEffect(() => { fetchLoans(tab.query); }, [tab, fetchLoans]);
  useEffect(() => { fetchStats(); }, [fetchStats]);

  const visible = useMemo(() => {
    if (!search.trim()) return loans;
    const s = search.toLowerCase();
    return loans.filter(l =>
      (l.asset_label || '').toLowerCase().includes(s) ||
      l.borrower_email.toLowerCase().includes(s) ||
      String(l.id) === s
    );
  }, [loans, search]);

  return (
    <Layout>
      <SectionRevealCover sectionKey="loans" />
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ marginBottom: 4 }}>Equipment Loans</h1>
            <p style={{ color: '#666', margin: 0, fontSize: 14 }}>
              Request → approval → pickup → return. Every step is logged on the loan.
            </p>
          </div>
          <button
            onClick={() => navigate('/loans/new')}
            style={{ padding: '10px 18px', background: 'var(--brand)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
          >
            + New loan
          </button>
        </div>

        {stats && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '20px 0' }}>
            <StatCard label="Pending approval" value={stats.pending} color="#b45309" />
            <StatCard label="Awaiting pickup" value={stats.approved} color="#2563eb" />
            <StatCard label="Out" value={stats.out} color="#7c3aed" />
            <StatCard label="Due today" value={stats.due_today} color="#0891b2" />
            <StatCard label="Overdue" value={stats.overdue} color="#b91c1c" />
            <StatCard label="Returned" value={stats.returned} color="#16a34a" />
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t)}
              style={{
                padding: '6px 14px', borderRadius: 999, fontSize: 13, cursor: 'pointer',
                border: '1px solid ' + (tab.key === t.key ? 'var(--brand)' : '#ddd'),
                background: tab.key === t.key ? 'var(--brand)' : '#fff',
                color: tab.key === t.key ? '#fff' : '#444',
              }}
            >{t.label}</button>
          ))}
        </div>

        <input
          type="text"
          placeholder="Search by asset, borrower or loan id…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: '100%', padding: 8, border: '1px solid #ddd', borderRadius: 4, boxSizing: 'border-box', marginBottom: 12 }}
        />

        {error && (
          <div style={{ padding: 12, background: '#f8d7da', color: '#721c24', borderRadius: 4, marginBottom: 12 }}>❌ {error}</div>
        )}

        <div style={{ border: '1px solid #eee', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.6fr 1fr 1fr 1.2fr', padding: '8px 12px', background: '#f4f1ee', fontSize: 12, fontWeight: 600, color: '#666' }}>
            <div>Asset</div><div>Borrower</div><div>From</div><div>Due</div><div>Status</div>
          </div>
          {loading && <div style={{ padding: 20, textAlign: 'center', color: '#999' }}>Loading…</div>}
          {!loading && visible.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: '#999' }}>
              No loans in this view{isAdmin ? '' : ' — only your own loans are shown'}.
            </div>
          )}
          {!loading && visible.map(loan => (
            <Link
              key={loan.id}
              to={`/loans/${loan.id}`}
              style={{ display: 'grid', gridTemplateColumns: '2fr 1.6fr 1fr 1fr 1.2fr', padding: '10px 12px', borderTop: '1px solid #eee', alignItems: 'center', fontSize: 14, color: 'inherit', textDecoration: 'none' }}
            >
              <div>
                <strong>{loan.asset_label || `Asset #${loan.asset_id}`}</strong>
                <div style={{ fontSize: 12, color: '#999' }}>
                  #{loan.id}{loan.asset_serial_no ? ` · ${loan.asset_serial_no}` : ''}
                </div>
              </div>
              <div style={{ fontSize: 13, color: '#555', overflow: 'hidden', textOverflow: 'ellipsis' }}>{loan.borrower_email}</div>
              <div style={{ fontSize: 13, color: '#666' }}>{loan.start_date}</div>
              <div style={{ fontSize: 13, color: Number(loan.is_overdue) === 1 ? '#b91c1c' : '#666' }}>{loan.due_date}</div>
              <div><LoanStatusBadge loan={loan} /></div>
            </Link>
          ))}
        </div>
      </div>
    </Layout>
  );
}
