// src/pages/SupplyItemsPage.tsx
// Phase 4a — le catalogue des articles (supply_items), avec leur stock courant
// calculé depuis le ledger. Point d'entrée vers la fiche article.
import React from "react";
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/apiClient';
import Layout from "../Layout.tsx";

const PAGE_SIZE = 10;

type SupplyItem = {
  id: number;
  code: string;
  name: string;
  category_id: number | null;
  category_name: string | null;
  base_unit: string;
  is_batch_tracked: number | boolean;
  reorder_point: number | null;
  target_level: number | null;
  is_active: number | boolean;
  qty_on_hand: number | string;
  value_on_hand: number | string;
  avg_unit_cost: number | string | null;
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export default function SupplyItemsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<SupplyItem[]>([]);
  const [q, setQ] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useMemo(() => async () => {
    setLoading(true);
    const { data, error } = await api.get<SupplyItem[]>('/supply-items');
    if (error) {
      setError(error);
      setItems([]);
    } else {
      setItems(data ?? []);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const categories = Array.from(new Set(items.map(i => i.category_name).filter(Boolean))) as string[];

  const filtered = items.filter(i => {
    const matchesQ = !q.trim() ||
      i.name.toLowerCase().includes(q.toLowerCase()) ||
      i.code.toLowerCase().includes(q.toLowerCase());
    const matchesCategory = !selectedCategory || i.category_name === selectedCategory;
    return matchesQ && matchesCategory;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

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

  const isLow = (i: SupplyItem) => i.reorder_point != null && num(i.qty_on_hand) <= num(i.reorder_point);

  return (
    <Layout>
      <div className="shell-inner">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, padding: '12px' }}>
          <div>
            <button
              className="pill"
              style={{ fontSize: 11, padding: '4px 10px', marginBottom: 10, background: '#f4f1ee' }}
              onClick={() => navigate('/supplies')}
            >
              ← Back to Supplies
            </button>
            <h2 style={{ margin: 0, letterSpacing: 0.2 }}>Items</h2>
            <p style={{ margin: '6px 0 0', color: 'var(--muted)', fontSize: 13 }}>
              Le catalogue — un article regroupe tous ses lots d'achat. Stock calculé depuis le ledger, jamais stocké.
            </p>
          </div>
        </div>

        {error && (
          <div style={{ padding: 12, background: '#fee', color: 'crimson', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>
            ⚠️ {error}
          </div>
        )}

        <div className="filters" style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <input
            className="input"
            placeholder="Search by name or code…"
            value={q}
            onChange={e => { setQ(e.target.value); setPage(1); }}
          />
          <select
            value={selectedCategory}
            onChange={e => { setSelectedCategory(e.target.value); setPage(1); }}
            style={{ padding: '8px 12px', border: '1px solid var(--line)', borderRadius: '6px', fontSize: '14px', background: 'white', cursor: 'pointer' }}
          >
            <option value="">All Categories</option>
            {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
          </select>
        </div>

        <table className="table">
          <thead>
          <tr style={{ background: '#8D86C9' }}>
            <th>Code</th>
            <th>Name</th>
            <th>Category</th>
            <th style={{ textAlign: 'right' }}>Stock on hand</th>
            <th style={{ textAlign: 'right' }}>Avg. unit cost</th>
          </tr>
          </thead>
          <tbody>
          {paginated.length === 0 ? (
            <tr>
              <td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)', padding: 20 }}>
                {loading ? 'Loading…' : 'No items found'}
              </td>
            </tr>
          ) : paginated.map(item => (
            <tr key={item.id} onClick={() => navigate(`/supply-items/${item.id}`)} style={{ cursor: 'pointer' }}>
              <td style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--muted)' }}>{item.code}</td>
              <td style={{ fontWeight: 500 }}>
                {item.name}
                {!item.is_active && (
                  <span style={{ marginLeft: 8, fontSize: 11, padding: '2px 6px', background: '#eee', color: '#666', borderRadius: 999 }}>archived</span>
                )}
              </td>
              <td style={{ fontSize: 13 }}>{item.category_name || '—'}</td>
              <td style={{ textAlign: 'right', fontWeight: 500, color: isLow(item) ? '#991b1b' : 'var(--ink)' }}>
                {num(item.qty_on_hand)} {item.base_unit}
                {isLow(item) && (
                  <span title={`Reorder point: ${item.reorder_point}`} style={{ marginLeft: 6, fontSize: 11, padding: '2px 6px', background: '#fee2e2', color: '#991b1b', borderRadius: 999 }}>
                    low
                  </span>
                )}
              </td>
              <td style={{ textAlign: 'right', color: 'var(--muted)', fontSize: 13 }}>
                {item.avg_unit_cost != null ? `GH₵ ${num(item.avg_unit_cost).toFixed(2)}` : '—'}
              </td>
            </tr>
          ))}
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
            {filtered.length > 0 && (
              <div style={{ marginLeft: 16, color: 'var(--muted)', fontSize: 14 }}>
                Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
