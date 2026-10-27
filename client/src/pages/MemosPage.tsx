// src/pages/MemosPage.tsx
// Boîte des mémos : d'abord ce qui attend MA décision, puis mes mémos, puis tout
// ce que je peux voir. Les actions vivent sur la fiche ; ici on repère et on ouvre.
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Layout from '../Layout';
import { usePermissions } from '../hooks/usePermissions';
import { SectionRevealCover } from '../components/SectionRevealCover';
import { SkeletonStatRow, SkeletonListRows } from '../components/Skeleton';
import {
  memosApi, MEMO_STATUS_LABEL, MEMO_STATUS_COLOR, fmtDate,
  type MemoRow, type MemoStatus,
} from '../hooks/useMemos';

type Tab = { key: string; label: string; query: string };
const TABS: Tab[] = [
  { key: 'to_act',   label: 'To act',     query: '?scope=to_act' },
  { key: 'mine',     label: 'My memos',   query: '?scope=mine' },
  { key: 'released', label: 'Released',   query: '?scope=all&status=released' },
  { key: 'all',      label: 'All',        query: '?scope=all' },
];

export function MemoStatusBadge({ status }: { status: MemoStatus }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 600,
      color: '#fff', background: MEMO_STATUS_COLOR[status] || '#6b7280', whiteSpace: 'nowrap',
    }}>{MEMO_STATUS_LABEL[status] || status}</span>
  );
}

const StatCard = ({ label, value, color }: { label: string; value: number | string; color: string }) => (
  <div style={{ flex: '1 1 140px', padding: 12, border: '1px solid #eee', borderRadius: 6, background: '#fff' }}>
    <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
    <div style={{ fontSize: 12, color: '#666' }}>{label}</div>
  </div>
);

const COLS = '1.1fr 2.6fr 1.2fr 1.2fr 1.3fr';

export default function MemosPage() {
  const navigate = useNavigate();
  const { isAdmin } = usePermissions();
  const [stats, setStats] = useState<Awaited<ReturnType<typeof memosApi.stats>>['data']>(null);
  const [tab, setTab] = useState<Tab>(TABS[0]);
  const [rows, setRows] = useState<MemoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => { memosApi.stats().then(({ data }) => setStats(data)); }, []);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    memosApi.list(tab.query).then(({ data, error: e }) => {
      if (cancelled) return;
      setRows(Array.isArray(data) ? data : []); setError(e); setLoading(false);
    });
    return () => { cancelled = true; };
  }, [tab]);

  const visible = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(r =>
      r.subject.toLowerCase().includes(s) || (r.reference || '').toLowerCase().includes(s) ||
      r.author_email.toLowerCase().includes(s));
  }, [rows, search]);

  const waitingDays = stats?.oldest_waiting_since
    ? Math.floor((Date.now() - new Date(stats.oldest_waiting_since).getTime()) / 86400000) : null;

  return (
    <Layout>
      <SectionRevealCover sectionKey="memos" />
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ marginBottom: 4 }}>Memos</h1>
            <p style={{ color: '#666', margin: 0, fontSize: 14 }}>
              Draft → recommendation → approval → release. Each step is signed and logged.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {isAdmin && (
              <button onClick={() => navigate('/memos/admin')}
                style={{ padding: '10px 14px', background: '#f4f1ee', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                Signatories
              </button>
            )}
            <button onClick={() => navigate('/memos/new')}
              style={{ padding: '10px 18px', background: 'var(--brand)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
              + New memo
            </button>
          </div>
        </div>

        {!stats && <SkeletonStatRow count={4} height={64} />}
        {stats && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '20px 0' }}>
            <StatCard label="Waiting for me" value={stats.to_act} color="#b45309" />
            <StatCard label="Oldest waiting (days)" value={waitingDays ?? '—'} color={waitingDays && waitingDays > 3 ? '#b91c1c' : '#666'} />
            <StatCard label="My drafts / returned" value={stats.to_finish} color="#6b7280" />
            <StatCard label="My memos in progress" value={stats.in_progress} color="#2563eb" />
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t)} style={{
              padding: '6px 14px', borderRadius: 999, fontSize: 13, cursor: 'pointer',
              border: '1px solid ' + (tab.key === t.key ? 'var(--brand)' : '#ddd'),
              background: tab.key === t.key ? 'var(--brand)' : '#fff',
              color: tab.key === t.key ? '#fff' : '#444',
            }}>{t.label}{t.key === 'to_act' && stats?.to_act ? ` (${stats.to_act})` : ''}</button>
          ))}
        </div>

        <input type="text" placeholder="Search by subject, reference or author…" value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: '100%', padding: 8, border: '1px solid #ddd', borderRadius: 4, boxSizing: 'border-box', marginBottom: 12 }} />

        {error && <div style={{ padding: 12, background: '#f8d7da', color: '#721c24', borderRadius: 4, marginBottom: 12 }}>❌ {error}</div>}

        <div style={{ border: '1px solid #eee', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: COLS, padding: '8px 12px', background: '#f4f1ee', fontSize: 12, fontWeight: 600, color: '#666' }}>
            <div>Reference</div><div>Subject</div><div>Author</div><div>Waiting for</div><div>Status</div>
          </div>
          {loading && <SkeletonListRows rows={6} />}
          {!loading && visible.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: '#999' }}>
              {tab.key === 'to_act' ? 'Nothing is waiting for your decision.' : 'No memos in this view.'}
            </div>
          )}
          {!loading && visible.map(m => (
            <Link key={m.id} to={m.status === 'draft' ? `/memos/${m.id}/edit` : `/memos/${m.id}`}
              style={{ display: 'grid', gridTemplateColumns: COLS, padding: '10px 12px', borderTop: '1px solid #eee', alignItems: 'center', fontSize: 14, color: 'inherit', textDecoration: 'none' }}>
              <div style={{ fontSize: 12, color: '#666' }}>{m.reference || 'Draft'}
                <div style={{ color: '#999' }}>{m.type_name}</div></div>
              <div><strong>{m.subject || '(no subject)'}</strong>
                <div style={{ fontSize: 12, color: '#999' }}>
                  {fmtDate(m.memo_date)}{m.revision_no > 1 ? ` · revision ${m.revision_no}` : ''}
                  {m.amount ? ` · ${Number(m.amount).toLocaleString('en-GB')} ${m.currency || ''}` : ''}
                </div></div>
              <div style={{ fontSize: 13, color: '#555', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.author_email}</div>
              <div style={{ fontSize: 13, color: '#666' }}>{m.status === 'in_review' || m.status === 'approved' ? (m.waiting_for || '—') : '—'}</div>
              <div><MemoStatusBadge status={m.status} /></div>
            </Link>
          ))}
        </div>
      </div>
    </Layout>
  );
}
