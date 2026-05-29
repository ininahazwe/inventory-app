// src/screens/Home.tsx
import React from "react";
import { useEffect, useMemo, useState } from 'react';
import { api, rpc } from '../lib/apiClient';
import { usePermissions } from '../hooks/usePermissions';
import { Link, useNavigate } from 'react-router-dom';
import Autocomplete from '../components/Autocomplete';
import AssignAsset from './AssignAsset';
import Modal from '../components/Modal';
import InventoryStats from '../components/InventoryStats';
import AuditDashboard from '../components/AuditDashboard';

type Row = { id: number; label: string; status: 'in_stock' | 'assigned' | 'repair' | 'retired'; serial_no: string | null; funder: string | null; category_name: string | null; assignee_name: string | null; assignee_email: string | null; };
const ITEMS_PER_PAGE = 10;

export default function Home({ onNew }: { onNew: () => void }) {
  const navigate = useNavigate();
  const { isSuperAdmin } = usePermissions();
  const { isAssignee } = usePermissions();
  const [rows, setRows]           = useState<Row[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [qLabel, setQLabel]       = useState('');
  const [qCategory, setQCategory] = useState('');
  const [statsRefreshTrigger, setStatsRefreshTrigger] = useState(0);
  const [auditOpen, setAuditOpen]                 = useState(false);
  const [assignOpen, setAssignOpen]               = useState(false);
  const [assignAssetId, setAssignAssetId]         = useState<number | null>(null);
  const [assignAssetLabel, setAssignAssetLabel]   = useState<string>('');
  const [returnOpen, setReturnOpen]               = useState(false);
  const [returnAssetId, setReturnAssetId]         = useState<number | null>(null);
  const [returnAssetLabel, setReturnAssetLabel]   = useState<string>('');

  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex   = Math.min(startIndex + ITEMS_PER_PAGE, totalCount);

  const load = useMemo(() => async () => {
    const params = new URLSearchParams({ page: String(currentPage), limit: String(ITEMS_PER_PAGE) });
    if (qCategory) params.set('category_name', qCategory);
    if (qLabel.trim()) params.set('label', qLabel.trim());
    const { data } = await api.get<{ data: Row[]; pagination: { total: number } }>(`/assets?${params}`);
    setRows((data as any)?.data ?? []);
    setTotalCount((data as any)?.pagination?.total ?? 0);
  }, [qLabel, qCategory, currentPage]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setCurrentPage(1); }, [qLabel, qCategory]);

  async function fetchCategoryOptions(q: string) {
    const { data } = await api.get<{ name: string }[]>(`/categories${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    return (data ?? []).map(d => d.name);
  }

  const openAssign = (id: number, label: string) => { setAssignAssetId(id); setAssignAssetLabel(label); setAssignOpen(true); };
  const closeAssign = () => { setAssignOpen(false); setAssignAssetId(null); setAssignAssetLabel(''); };
  const openReturn  = (id: number, label: string) => { setReturnAssetId(id); setReturnAssetLabel(label); setReturnOpen(true); };
  const closeReturn = () => { setReturnOpen(false); setReturnAssetId(null); setReturnAssetLabel(''); };

  const confirmReturn = async () => {
    if (returnAssetId == null) return;
    const { error } = await rpc('return_asset', { p_asset_id: returnAssetId });
    if (error) { alert(error); return; }
    closeReturn(); await load();
  };

  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    const maxVisible = 5;
    if (totalPages <= maxVisible) { for (let i = 1; i <= totalPages; i++) pages.push(i); }
    else {
      const start = Math.max(1, currentPage - 2);
      const end   = Math.min(totalPages, start + maxVisible - 1);
      if (start > 1) { pages.push(1); if (start > 2) pages.push('...'); }
      for (let i = start; i <= end; i++) pages.push(i);
      if (end < totalPages) { if (end < totalPages - 1) pages.push('...'); pages.push(totalPages); }
    }
    return pages;
  };

  return (
    <div>
      {!isAssignee && (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, padding: '12px' }}>
        <h2 style={{ margin: 0, letterSpacing: 0.2 }}>Inventory</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {isSuperAdmin && (
            <>
              <button className="pill" onClick={() => navigate('/incidents')}>Incidents</button>
              <button className="pill" onClick={() => navigate('/assignees')}>👥 User Management</button>
              <button className="pill" onClick={() => setAuditOpen(true)}>📋 Audit Log</button>
              <button className="pill" onClick={onNew}>+ New asset</button>
            </>
          )}
        </div>
      </div>
      )}

      <div className="filters">
        <input className="input" placeholder="Search by label, serial number, name, or email…" value={qLabel} onChange={e => setQLabel(e.target.value)} />
        <Autocomplete className="input" value={qCategory} onChange={setQCategory} fetchOptions={fetchCategoryOptions} placeholder="Category…" />
      </div>

      <table className="table">
        <thead><tr style={{ background: '#8D86C9' }}><th>Name</th><th>Category</th><th className="status">Status</th><th className="status">Funder</th><th>Assigned to</th><th></th></tr></thead>
        <tbody>
        {rows.map(r => (
          <tr key={r.id}>
            <td><Link className="asset-link" to={`/asset/${r.id}`}>{r.label}</Link>{r.serial_no && <div style={{ color: 'var(--muted)', fontSize: 12 }}>SN: {r.serial_no}</div>}</td>
            <td>{r.category_name ?? '—'}</td>
            <td style={{ textTransform: 'capitalize' }} className="status">{r.status}</td>
            <td style={{ textTransform: 'capitalize' }} className="status">{r.funder ?? '—'}</td>
            <td>{r.assignee_name ? <>{r.assignee_name}{r.assignee_email && <div style={{ color: 'var(--muted)', fontSize: 12 }}>{r.assignee_email}</div>}</> : '—'}</td>
            <td><div className="actions">
              {r.status !== 'assigned' ? <button className="pill green-light" onClick={() => openAssign(r.id, r.label)}>Assign</button> : <button className="pill" onClick={() => openReturn(r.id, r.label)}>Return</button>}
            </div></td>
          </tr>
        ))}
        {rows.length === 0 && <tr><td colSpan={6} style={{ padding: 16, color: 'var(--muted)' }}>No result</td></tr>}
        </tbody>
      </table>

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 20, padding: '16px 0' }}>
          <button className="pill" onClick={() => setCurrentPage(p => p - 1)} disabled={currentPage === 1} style={{ opacity: currentPage === 1 ? 0.5 : 1 }}>← Previous</button>
          {getPageNumbers().map((page, i) => page === '...' ? <span key={i} style={{ padding: '0 8px', color: 'var(--muted)' }}>…</span> : (
            <button key={page} className="pill" onClick={() => setCurrentPage(page as number)} style={{ background: currentPage === page ? 'var(--brand)' : '#f4f1ee', color: currentPage === page ? 'white' : 'var(--ink)', minWidth: 36, textAlign: 'center' }}>{page}</button>
          ))}
          <button className="pill" onClick={() => setCurrentPage(p => p + 1)} disabled={currentPage === totalPages} style={{ opacity: currentPage === totalPages ? 0.5 : 1 }}>Next →</button>
          {totalCount > 0 && <div style={{ marginLeft: 16, color: 'var(--muted)', fontSize: 14 }}>Showing {startIndex + 1}-{endIndex} of {totalCount}</div>}
        </div>
      )}

      <Modal open={assignOpen} onClose={closeAssign} title={`Assign: ${assignAssetLabel}`}>
        {assignAssetId != null && <AssignAsset assetId={assignAssetId} onDone={async () => { closeAssign(); await load(); setStatsRefreshTrigger(t => t + 1); }} />}
      </Modal>
      <Modal open={returnOpen} onClose={closeReturn} title={`Return: ${returnAssetLabel}`}>
        <p>Confirm return of this asset to stock?</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="pill" style={{ background: '#bbb' }} onClick={closeReturn}>Cancel</button>
          <button className="pill" onClick={confirmReturn}>Confirm</button>
        </div>
      </Modal>

      {isSuperAdmin && (
        <>
          <Modal open={auditOpen} onClose={() => setAuditOpen(false)} title="📋 Audit Log">
            <AuditDashboard />
          </Modal>
        </>
      )}
      <InventoryStats refreshTrigger={statsRefreshTrigger} onCategoryFilter={setQCategory} selectedCategory={qCategory} />
    </div>
  );
}
