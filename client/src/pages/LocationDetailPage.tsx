// src/pages/LocationDetailPage.tsx
import React from "react";
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/apiClient';
import Layout from "../Layout.tsx";

const PAGE_SIZE = 10;

type Location = {
  id: number;
  name: string;
  floor: string | null;
  description: string | null;
};

type SupplyAssignment = {
  id: number;
  supply_id: number;
  supply_name: string;
  quantity_assigned: number;
  assigned_at: string;
  assignee_name: string;
  assignee_email: string;
  status: 'active' | 'returned';
};

export default function LocationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [location, setLocation] = useState<Location | null>(null);
  const [assignments, setAssignments] = useState<SupplyAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const load = async () => {
    setLoading(true);
    setError(null);

    const [locRes, assignRes] = await Promise.all([
      api.get<Location>(`/locations/${id}`),
      api.get<SupplyAssignment[]>(`/supply-assignments?location_id=${id}&status=active`),
    ]);

    if (locRes.error) {
      setError(locRes.error);
      setLoading(false);
      return;
    }

    setLocation(locRes.data ?? null);
    setAssignments(assignRes.data ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [id]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('fr-FR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const totalPages = Math.max(1, Math.ceil(assignments.length / PAGE_SIZE));
  const paginated = assignments.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

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

  if (loading) {
    return (
      <Layout>
        <div className="shell-inner">
          <p style={{ padding: 20, color: 'var(--muted)' }}>Loading…</p>
        </div>
      </Layout>
    );
  }

  if (error || !location) {
    return (
      <Layout>
        <div className="shell-inner">
          <div style={{ padding: 12, background: '#fee', color: 'crimson', borderRadius: 8, fontSize: 14 }}>
            ⚠️ {error ?? 'Location not found'}
          </div>
          <button className="pill" style={{ marginTop: 16 }} onClick={() => navigate('/locations')}>
            ← Back to locations
          </button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="shell-inner">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, padding: '12px 12px 0' }}>
          <div>
            <button
              className="pill"
              style={{ fontSize: 11, padding: '4px 10px', marginBottom: 10, background: '#f4f1ee' }}
              onClick={() => navigate('/locations')}
            >
              ← Back
            </button>
            <h2 style={{ margin: 0, letterSpacing: 0.2 }}>
              {location.name}{location.floor ? <span style={{ color: 'var(--muted)', fontWeight: 400 }}> · {location.floor}</span> : ''}
            </h2>
            {location.description && (
              <p style={{ margin: '6px 0 0', color: 'var(--muted)', fontSize: 13 }}>{location.description}</p>
            )}
          </div>
        </div>

        <div style={{ padding: '16px 12px 8px', fontSize: 14, color: 'var(--muted)' }}>
          {assignments.length} {assignments.length === 1 ? 'supply' : 'supplies'} assigned here
        </div>

        <table className="table">
          <thead>
          <tr style={{ background: '#8D86C9' }}>
            <th>Supply</th>
            <th style={{ width: 100, textAlign: 'center' }}>Quantity</th>
            <th style={{ width: 130 }}>Assigned on</th>
            <th>Assigned by</th>
          </tr>
          </thead>
          <tbody>
          {paginated.length === 0 ? (
            <tr>
              <td colSpan={4} style={{ textAlign: 'center', color: 'var(--muted)', padding: 20 }}>
                No supplies assigned to this location
              </td>
            </tr>
          ) : paginated.map(a => (
            <tr key={a.id}>
              <td>{a.supply_name}</td>
              <td style={{ textAlign: 'center', fontWeight: 500 }}>{a.quantity_assigned}</td>
              <td style={{ color: 'var(--muted)', fontSize: 13 }}>{formatDate(a.assigned_at)}</td>
              <td style={{ color: 'var(--muted)', fontSize: 13 }}>{a.assignee_email || '—'}</td>
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
                  style={{
                    background: page === p ? 'var(--brand)' : '#f4f1ee',
                    color: page === p ? 'white' : 'var(--ink)',
                    minWidth: 36,
                    textAlign: 'center'
                  }}
                >
                  {p}
                </button>
              )
            )}
            <button className="pill" onClick={() => setPage(p => p + 1)} disabled={page === totalPages} style={{ opacity: page === totalPages ? 0.5 : 1 }}>
              Next →
            </button>
            {assignments.length > 0 && (
              <div style={{ marginLeft: 16, color: 'var(--muted)', fontSize: 14 }}>
                Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, assignments.length)} of {assignments.length}
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
