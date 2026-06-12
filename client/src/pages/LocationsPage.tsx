// src/pages/LocationsPage.tsx
import React from "react";
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/apiClient';
import Layout from "../Layout.tsx";
import Modal from "../components/Modal.tsx";

const PAGE_SIZE = 10;

type Location = {
  id: number;
  name: string;
  floor: string | null;
  description: string | null;
  created_at: string;
};

type FormState = { name: string; floor: string; description: string };
const EMPTY_FORM: FormState = { name: '', floor: '', description: '' };

export default function LocationsPage() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modal create/edit
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Location | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);

  // Modal delete
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [locationToDelete, setLocationToDelete] = useState<Location | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  const load = useMemo(() => async () => {
    setLoading(true);
    const { data, error } = await api.get<Location[]>('/locations');
    if (error) {
      setError(error);
      setLocations([]);
    } else {
      setLocations(data ?? []);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setFormErr(null);
    setModalOpen(true);
  };

  const openEdit = (loc: Location) => {
    setEditTarget(loc);
    setForm({ name: loc.name, floor: loc.floor ?? '', description: loc.description ?? '' });
    setFormErr(null);
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!form.name.trim()) { setFormErr('Name is required'); return; }
    setSaving(true);
    setFormErr(null);

    const payload = {
      name: form.name.trim(),
      floor: form.floor.trim() || null,
      description: form.description.trim() || null,
    };

    const { error } = editTarget
      ? await api.put(`/locations/${editTarget.id}`, payload)
      : await api.post('/locations', payload);

    setSaving(false);
    if (error) { setFormErr(error); return; }
    setModalOpen(false);
    setEditTarget(null);
    await load();
  };

  const handleDeleteClick = (loc: Location) => {
    setDeleteErr(null);
    setLocationToDelete(loc);
    setDeleteConfirmOpen(true);
  };

  const confirmDelete = async () => {
    if (!locationToDelete) return;
    setDeleting(true);
    setDeleteErr(null);
    const { error } = await api.delete(`/locations/${locationToDelete.id}`);
    setDeleting(false);
    if (error) { setDeleteErr(error); return; }
    setDeleteConfirmOpen(false);
    setLocationToDelete(null);
    await load();
  };

  const closeDeleteConfirm = () => {
    setDeleteConfirmOpen(false);
    setLocationToDelete(null);
    setDeleteErr(null);
  };

  // Filter + paginate
  const filtered = locations.filter(loc =>
    !q.trim() ||
    loc.name.toLowerCase().includes(q.toLowerCase()) ||
    (loc.floor ?? '').toLowerCase().includes(q.toLowerCase())
  );
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

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

  return (
    <Layout>
      <div className="shell-inner">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, padding: '12px' }}>
          <h2 style={{ margin: 0, letterSpacing: 0.2 }}>Locations</h2>
          <button className="pill" onClick={openCreate}>+ Add location</button>
        </div>

        {error && (
          <div style={{ padding: 12, background: '#fee', color: 'crimson', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>
            ⚠️ {error}
          </div>
        )}

        <div className="filters">
          <input
            className="input"
            placeholder="Search by name or floor…"
            value={q}
            onChange={e => { setQ(e.target.value); setPage(1); }}
          />
          <div style={{ flex: 1 }} />
        </div>

        <table className="table">
          <thead>
          <tr style={{ background: '#8D86C9' }}>
            <th>Name</th>
            <th style={{ width: 140 }}>Floor</th>
            <th>Description</th>
            <th style={{ width: 180 }}></th>
          </tr>
          </thead>
          <tbody>
          {paginated.length === 0 ? (
            <tr>
              <td colSpan={4} style={{ textAlign: 'center', color: 'var(--muted)', padding: 20 }}>
                {loading ? 'Loading…' : 'No locations found'}
              </td>
            </tr>
          ) : paginated.map(loc => (
            <tr key={loc.id}>
              <td>{loc.name}</td>
              <td style={{ color: 'var(--muted)', fontSize: 13 }}>{loc.floor ?? '—'}</td>
              <td style={{ color: 'var(--muted)', fontSize: 13 }}>{loc.description ?? '—'}</td>
              <td>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="pill" style={{ fontSize: 11, padding: '5px 8px' }} onClick={() => openEdit(loc)}>
                    Edit
                  </button>
                  <button
                    className="pill"
                    style={{ fontSize: 11, padding: '5px 8px', background: '#f3d0d0' }}
                    onClick={() => handleDeleteClick(loc)}
                  >
                    Delete
                  </button>
                </div>
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
            {filtered.length > 0 && (
              <div style={{ marginLeft: 16, color: 'var(--muted)', fontSize: 14 }}>
                Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Create / Edit Modal ── */}
      <Modal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditTarget(null); }}
        title={editTarget ? `Edit: ${editTarget.name}` : 'New location'}
      >
        <form onSubmit={handleSave} style={{ display: 'grid', gap: 14 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>Name *</label>
            <input
              className="input"
              placeholder="e.g. Finance Office"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              disabled={saving}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>Floor</label>
            <input
              className="input"
              placeholder="e.g. 2nd Floor"
              value={form.floor}
              onChange={e => setForm(f => ({ ...f, floor: e.target.value }))}
              disabled={saving}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>Description</label>
            <textarea
              className="input"
              rows={3}
              placeholder="Optional notes…"
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              disabled={saving}
              style={{ resize: 'vertical' }}
            />
          </div>
          {formErr && <p style={{ color: 'crimson', margin: 0, fontSize: 13 }}>⚠️ {formErr}</p>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="pill" style={{ background: '#bbb' }} onClick={() => { setModalOpen(false); setEditTarget(null); }} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="pill" disabled={saving}>
              {saving ? '…' : editTarget ? 'Save changes' : 'Create'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ── Delete Confirm Modal ── */}
      <Modal
        open={deleteConfirmOpen}
        onClose={closeDeleteConfirm}
        title={`Delete: ${locationToDelete?.name}`}
      >
        <p>Are you sure you want to delete this location? This action cannot be undone.</p>
        {deleteErr && (
          <div style={{ padding: 10, background: '#fee', color: 'crimson', borderRadius: 6, fontSize: 13, marginBottom: 12 }}>
            ⚠️ {deleteErr}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="pill" style={{ background: '#bbb' }} onClick={closeDeleteConfirm} disabled={deleting}>
            Cancel
          </button>
          <button className="pill" style={{ background: '#991b1b', color: '#fff' }} onClick={confirmDelete} disabled={deleting}>
            {deleting ? '…' : 'Delete'}
          </button>
        </div>
      </Modal>
    </Layout>
  );
}
