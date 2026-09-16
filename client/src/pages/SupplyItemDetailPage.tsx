// src/pages/SupplyItemDetailPage.tsx
// Phase 4a — la fiche article : identité, seuils, stock courant, historique
// complet. L'écran qui manquait ; tout se lit depuis le ledger via les
// nouvelles routes /api/supply-items (Phase 3).
import React from "react";
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/apiClient';
import Layout from "../Layout.tsx";

const PAGE_SIZE = 20;

type ItemStock = {
  id: number;
  code: string;
  name: string;
  reorder_point: number | null;
  target_level: number | null;
  qty_on_hand: number | string;
  value_on_hand: number | string;
  avg_unit_cost: number | string | null;
  avg_daily_qty_out: number | string | null;
  cover_days: number | string | null;
};

type LedgerEntry = {
  id: number;
  movement_date: string;
  reason: 'receipt' | 'issue' | 'return' | 'count_variance' | 'write_off';
  quantity_base: number | string;
  unit_cost_base: number | string;
  value: number | string;
  location_id: number | null;
  location_name: string | null;
  source_table: string;
  source_line_id: number;
  reverses_id: number | null;
  created_by_uid: string | null;
  document_reference: string | null;
};

const REASON_STYLES: Record<LedgerEntry['reason'], { label: string; bg: string; color: string }> = {
  receipt: { label: 'Receipt', bg: '#dbeafe', color: '#1e40af' },
  issue: { label: 'Issued', bg: '#fee2e2', color: '#991b1b' },
  return: { label: 'Returned', bg: '#dcfce7', color: '#15803d' },
  count_variance: { label: 'Count variance', bg: '#fef3c7', color: '#b45309' },
  write_off: { label: 'Write-off', bg: '#fecaca', color: '#7f1d1d' },
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Nom lisible depuis l'email (pas de colonne name en base) — même logique que
// SuppliesList.displayUser, dupliquée ici volontairement (petite fonction pure,
// pas encore de lib partagée pour ça).
const displayUser = (value: string | null): string => {
  if (!value) return '—';
  if (!value.includes('@')) {
    return value.length === 36 ? '—' : value;
  }
  return value
    .split('@')[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map(p => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
};

export default function SupplyItemDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [stock, setStock] = useState<ItemStock | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStock = async () => {
    setLoading(true);
    const { data, error } = await api.get<ItemStock>(`/supply-items/${id}/stock`);
    if (error || !data) {
      setError(error || 'Item not found');
      setStock(null);
    } else {
      setStock(data);
      setError(null);
    }
    setLoading(false);
  };

  const loadLedger = async (p: number) => {
    setLedgerLoading(true);
    const { data } = await api.get<{ entries: LedgerEntry[]; total: number; page: number; per_page: number }>(
      `/supply-items/${id}/ledger?page=${p}&per_page=${PAGE_SIZE}`
    );
    setEntries(data?.entries ?? []);
    setTotal(data?.total ?? 0);
    setLedgerLoading(false);
  };

  useEffect(() => { loadStock(); }, [id]);
  useEffect(() => { loadLedger(page); }, [id, page]);

  // ✅ movement_date est une colonne DATE ('YYYY-MM-DD'). Affichage forcé en
  // UTC pour ne pas dépendre du fuseau du navigateur.
  const formatDate = (dateString: string) => {
    const [y, m, d] = dateString.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('fr-FR', {
      year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
    });
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    const maxVisible = 5;
    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      const start = Math.max(1, page - 2);
      const end = Math.min(totalPages, start + maxVisible - 1);
      if (start > 1) { pages.push(1); if (start > 2) pages.push('...'); }
      for (let i = start; i <= end; i++) pages.push(i);
      if (end < totalPages) { if (end < totalPages - 1) pages.push('...'); pages.push(totalPages); }
    }
    return pages;
  };

  const statCard = (label: string, value: React.ReactNode, bg: string, color: string) => (
    <div style={{ padding: '16px', background: bg, borderRadius: '8px' }}>
      <div style={{ fontSize: '13px', color: 'var(--muted)', marginBottom: '6px' }}>{label}</div>
      <div style={{ fontSize: '24px', fontWeight: 600, color }}>{value}</div>
    </div>
  );

  if (loading) {
    return (
      <Layout>
        <div className="shell-inner">
          <p style={{ padding: 20, color: 'var(--muted)' }}>Loading…</p>
        </div>
      </Layout>
    );
  }

  if (error || !stock) {
    return (
      <Layout>
        <div className="shell-inner">
          <div style={{ padding: 12, background: '#fee', color: 'crimson', borderRadius: 8, fontSize: 14 }}>
            ⚠️ {error ?? 'Item not found'}
          </div>
          <button className="pill" style={{ marginTop: 16 }} onClick={() => navigate('/supply-items')}>
            ← Back to items
          </button>
        </div>
      </Layout>
    );
  }

  const isLow = stock.reorder_point != null && num(stock.qty_on_hand) <= stock.reorder_point;

  return (
    <Layout>
      <div className="shell-inner">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, padding: '12px 12px 0' }}>
          <div>
            <button
              className="pill"
              style={{ fontSize: 11, padding: '4px 10px', marginBottom: 10, background: '#f4f1ee' }}
              onClick={() => navigate('/supply-items')}
            >
              ← Back to items
            </button>
            <h2 style={{ margin: 0, letterSpacing: 0.2 }}>
              {stock.name}
              <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 14, marginLeft: 10, fontFamily: 'monospace' }}>{stock.code}</span>
            </h2>
          </div>
        </div>

        {isLow && (
          <div style={{ margin: '16px 12px', padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#991b1b', fontSize: 14, fontWeight: 500 }}>
            ⚠️ Stock at or below reorder point ({stock.reorder_point})
          </div>
        )}

        {/* ═══ Stock courant ═══ */}
        <div style={{ padding: '12px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
          {statCard('Stock on hand', num(stock.qty_on_hand), '#ecfdf5', '#15803d')}
          {statCard('Stock value', `GH₵ ${num(stock.value_on_hand).toFixed(2)}`, '#f0f9ff', '#1e40af')}
          {statCard('Avg. unit cost', stock.avg_unit_cost != null ? `GH₵ ${num(stock.avg_unit_cost).toFixed(2)}` : '—', '#fff7ed', '#b45309')}
          {statCard('Cover', stock.cover_days != null ? `${Math.round(num(stock.cover_days))} days` : '—', '#f3e8ff', '#a21caf')}
        </div>

        {/* ═══ Seuils ═══ */}
        <div style={{ margin: '20px 12px', padding: '14px 16px', background: '#f4f1ee', borderRadius: 8, display: 'flex', gap: 32, flexWrap: 'wrap', fontSize: 14 }}>
          <div><span style={{ color: 'var(--muted)' }}>Reorder point: </span><strong>{stock.reorder_point ?? '—'}</strong></div>
          <div><span style={{ color: 'var(--muted)' }}>Target level: </span><strong>{stock.target_level ?? '—'}</strong></div>
        </div>

        {/* ═══ Historique complet ═══ */}
        <div style={{ padding: '20px 12px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, color: 'var(--ink)', fontSize: '16px', fontWeight: 600 }}>History</h3>
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>{total} {total === 1 ? 'entry' : 'entries'}</div>
        </div>

        <table className="table">
          <thead>
          <tr style={{ background: '#8D86C9' }}>
            <th>Date</th>
            <th>Reason</th>
            <th style={{ textAlign: 'right' }}>Qty</th>
            <th style={{ textAlign: 'right' }}>Unit cost</th>
            <th style={{ textAlign: 'right' }}>Value</th>
            <th>Location</th>
            <th>By</th>
          </tr>
          </thead>
          <tbody>
          {ledgerLoading ? (
            <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--muted)', padding: 20 }}>Loading…</td></tr>
          ) : entries.length === 0 ? (
            <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--muted)', padding: 20 }}>No ledger entries for this item</td></tr>
          ) : entries.map(e => {
            const style = REASON_STYLES[e.reason];
            const qty = num(e.quantity_base);
            return (
              <tr key={e.id}>
                <td style={{ fontSize: 13, color: 'var(--muted)' }}>{formatDate(e.movement_date)}</td>
                <td>
                  <span style={{ background: style.bg, color: style.color, padding: '3px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600 }}>
                    {style.label}
                  </span>
                  {e.reverses_id != null && (
                    <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--muted)' }} title={`Reverses ledger entry #${e.reverses_id}`}>↺ correction</span>
                  )}
                </td>
                <td style={{ textAlign: 'right', fontWeight: 600, color: qty >= 0 ? '#15803d' : '#991b1b' }}>
                  {qty > 0 ? `+${qty}` : qty}
                </td>
                <td style={{ textAlign: 'right', fontSize: 13, color: 'var(--muted)' }}>GH₵ {num(e.unit_cost_base).toFixed(2)}</td>
                <td style={{ textAlign: 'right', fontSize: 13, color: 'var(--muted)' }}>GH₵ {num(e.value).toFixed(2)}</td>
                <td style={{ fontSize: 13 }}>{e.location_name || '—'}</td>
                <td style={{ fontSize: 13, color: 'var(--muted)' }} title={e.created_by_uid || undefined}>{displayUser(e.created_by_uid)}</td>
              </tr>
            );
          })}
          </tbody>
        </table>

        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 20, padding: '16px 0' }}>
            <button className="pill" onClick={() => setPage(p => p - 1)} disabled={page === 1} style={{ opacity: page === 1 ? 0.5 : 1 }}>
              ← Previous
            </button>
            {getPageNumbers().map((p, i) =>
              p === '...' ? (
                <span key={i} style={{ padding: '0 8px', color: 'var(--muted)' }}>…</span>
              ) : (
                <button
                  key={p}
                  className="pill"
                  onClick={() => setPage(p as number)}
                  style={{ background: page === p ? 'var(--brand)' : '#f4f1ee', color: page === p ? 'white' : 'var(--ink)', minWidth: 36, textAlign: 'center' }}
                >
                  {p}
                </button>
              )
            )}
            <button className="pill admin" onClick={() => setPage(p => p + 1)} disabled={page === totalPages} style={{ opacity: page === totalPages ? 0.5 : 1 }}>
              Next →
            </button>
            {total > 0 && (
              <div style={{ marginLeft: 16, color: 'var(--muted)', fontSize: 14 }}>
                Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
