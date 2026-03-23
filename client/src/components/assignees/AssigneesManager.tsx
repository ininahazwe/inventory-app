// src/components/assignees/AssigneesManager.tsx
import React from "react";
import { useEffect, useMemo, useState } from 'react';
import { api, rpc } from '../../lib/apiClient';
import type { Assignee } from './type';
import AssigneesTable from './AssigneesTable';
import AssigneeForm from './AssigneeForm.tsx';

const PAGE_SIZE = 10;

export default function AssigneesManager({ onClose }: { onClose?: () => void }) {
  const [rows, setRows]     = useState<Assignee[]>([]);
  const [count, setCount]   = useState(0);
  const [q, setQ]           = useState('');
  const [page, setPage]     = useState(1);
  const [busy, setBusy]     = useState(false);
  const [editing, setEditing] = useState<Assignee | null>(null);

  const load = useMemo(() => async () => {
    setBusy(true);
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
    if (q.trim()) params.set('q', q.trim());
    const { data } = await api.get<{ data: Assignee[]; count: number }>(`/assignments/assignees?${params}`);
    setRows(data?.data ?? []);
    setCount(data?.count ?? 0);
    setBusy(false);
  }, [q, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [q]);

  const onDelete = async (a: Assignee) => {
    if (!confirm(`Supprimer toutes les attributions de ${a.full_name ?? '—'} ?`)) return;
    if (!confirm('Confirmer la suppression DÉFINITIVE ?')) return;
    const { data, error } = await rpc<number>('assignees_delete', { p_email: a.email, p_name: a.full_name });
    if (error) { alert(error); return; }
    alert(`${data ?? 0} attribution(s) supprimée(s).`);
    await load();
  };

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input className="input" style={{ marginTop: 12 }} placeholder="Rechercher par nom ou email…" value={q} onChange={e => setQ(e.target.value)} />
        <div style={{ flex: 1 }} />
        <button className="pill" onClick={() => onClose?.()}>Fermer</button>
      </div>
      <AssigneesTable rows={rows} busy={busy} onEdit={setEditing} onDelete={onDelete} />
      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="pill" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>←</button>
          <span style={{ color: 'var(--muted)' }}>{page} / {totalPages}</span>
          <button className="pill" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>→</button>
        </div>
      )}
      {editing && (
        <div style={{ marginTop: 16, padding: 12, border: '1px solid var(--line)', borderRadius: 8 }}>
          <AssigneeForm assignee={editing} onCancel={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); }} />
        </div>
      )}
    </div>
  );
}
