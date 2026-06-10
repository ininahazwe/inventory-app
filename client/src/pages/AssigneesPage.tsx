// src/screens/AssigneesPage.tsx
import React from "react";
import { useEffect, useMemo, useState } from 'react';
import { rpc } from '../lib/apiClient';
import Layout from "../Layout.tsx";
import Modal from "../components/Modal.tsx";

const PAGE_SIZE = 10;

type User = { id: string; email: string; role: 'user' | 'admin' | 'super_admin' | 'assignee'; created_at: string; created_by_email: string | null; };

export default function AssigneesPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<'user' | 'admin' | 'assignee'>('user');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);

  const load = useMemo(() => async () => {
    setLoading(true);
    const { data, error } = await rpc<User[]>('list_all_users');
    if (error) {
      setError(error);
      setUsers([]);
    } else {
      setUsers(data ?? []);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAddUser = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = newEmail.trim().toLowerCase();
    if (!trimmed) { setError('Email requis'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) { setError('Format invalide'); return; }
    setAdding(true); setError(null);
    const { error } = await rpc('add_user', { p_email: trimmed, p_role: newRole });
    if (error) setError(error);
    else { setNewEmail(''); setNewRole('user'); await load(); }
    setAdding(false);
  };

  const handleChangeRole = async (userId: string, role: string) => {
    const { error } = await rpc('change_user_role', { p_user_id: userId, p_new_role: role });
    if (error) setError(error);
    else { setEditingUser(null); await load(); }
  };

  const handleDeleteUser = (user: User) => {
    setUserToDelete(user);
    setDeleteConfirmOpen(true);
  };

  const confirmDelete = async () => {
    if (!userToDelete) return;
    const { error } = await rpc('delete_user', { p_user_id: userToDelete.id });
    if (error) setError(error); else await load();
    setDeleteConfirmOpen(false);
    setUserToDelete(null);
  };

  const closeDeleteConfirm = () => {
    setDeleteConfirmOpen(false);
    setUserToDelete(null);
  };

  // Filtrer et paginer
  const filteredUsers = users.filter(u =>
    !q.trim() || u.email.toLowerCase().includes(q.toLowerCase())
  );
  const paginatedUsers = filteredUsers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalFilteredPages = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE));

  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    const maxVisible = 5;
    if (totalFilteredPages <= maxVisible) {
      for (let i = 1; i <= totalFilteredPages; i++) pages.push(i);
    } else {
      const start = Math.max(1, page - 2);
      const end = Math.min(totalFilteredPages, start + maxVisible - 1);
      if (start > 1) {
        pages.push(1);
        if (start > 2) pages.push('...');
      }
      for (let i = start; i <= end; i++) pages.push(i);
      if (end < totalFilteredPages) {
        if (end < totalFilteredPages - 1) pages.push('...');
        pages.push(totalFilteredPages);
      }
    }
    return pages;
  };

  return (
    <Layout>
      <div className="shell-inner">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, padding: '12px' }}>
          <h2 style={{ margin: 0, letterSpacing: 0.2 }}>User Management</h2>
        </div>

        {error && <div style={{ padding: 12, background: '#fee', color: 'crimson', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>⚠️ {error}</div>}

        <form onSubmit={handleAddUser} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: 8, marginBottom: 20, alignItems: 'end' }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>Email</label>
            <input type="email" className="input" placeholder="user@example.com" value={newEmail} onChange={e => setNewEmail(e.target.value)} disabled={adding} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>Rôle</label>
            <select className="input" value={newRole} onChange={e => setNewRole(e.target.value as 'user' | 'admin' | 'assignee')} disabled={adding}>
              <option value="user">User</option>
              <option value="admin">Admin</option>
              <option value="assignee">Assignee</option>
            </select>
          </div>
          <button className="pill" type="submit" disabled={adding}>{adding ? '…' : '+ Ajouter'}</button>
        </form>

        <div className="filters">
          <input
            className="input"
            placeholder="Search by email…"
            value={q}
            onChange={e => { setQ(e.target.value); setPage(1); }}
          />
          <div style={{ flex: 1 }} />
        </div>

        <table className="table">
          <thead><tr style={{ background: '#8D86C9' }}><th>Email</th><th style={{ width: 120 }}>Rôle</th><th style={{ width: 130 }}>Créé</th><th style={{ width: 120 }}>Par</th><th style={{ width: 180 }}></th></tr></thead>
          <tbody>
          {paginatedUsers.length === 0 ? (
            <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)', padding: 20 }}>{loading ? 'Chargement…' : 'Aucun utilisateur'}</td></tr>
          ) : paginatedUsers.map(user => (
            <tr key={user.id}>
              <td>{user.email}</td>
              <td>
                {editingUser?.id === user.id ? (
                  <select className="input" value={editingUser.role} onChange={e => setEditingUser({ ...editingUser, role: e.target.value as User['role'] })} style={{ width: '100%' }}>
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                    <option value="super_admin">Super Admin</option>
                    <option value="assignee">Assignee</option>
                  </select>
                ) : <span style={{ textTransform: 'capitalize' }}>{user.role}</span>}
              </td>
              <td style={{ fontSize: 12, color: 'var(--muted)' }}>{new Date(user.created_at).toLocaleDateString()}</td>
              <td style={{ fontSize: 12, color: 'var(--muted)' }}>{user.created_by_email || '—'}</td>
              <td>
                <div style={{ display: 'flex', gap: 6 }}>
                  {editingUser?.id === user.id ? (
                    <>
                      <button className="pill" style={{ fontSize: 11, padding: '5px 8px' }} onClick={() => handleChangeRole(user.id, editingUser.role)}>Save</button>
                      <button className="pill" style={{ fontSize: 11, padding: '5px 8px', background: '#bbb' }} onClick={() => setEditingUser(null)}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button className="pill" style={{ fontSize: 11, padding: '5px 8px' }} onClick={() => setEditingUser(user)}>Edit</button>
                      <button className="pill" style={{ fontSize: 11, padding: '5px 8px', background: '#f3d0d0' }} onClick={() => handleDeleteUser(user)}>Delete</button>
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
          </tbody>
        </table>

        {totalFilteredPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 20, padding: '16px 0' }}>
            <button
              className="pill"
              onClick={() => setPage(p => p - 1)}
              disabled={page === 1}
              style={{ opacity: page === 1 ? 0.5 : 1 }}
            >
              ← Previous
            </button>
            {getPageNumbers().map((p, i) =>
              p === '...' ? (
                <span key={i} style={{ padding: '0 8px', color: 'var(--muted)' }}>
                  …
                </span>
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
            <button
              className="pill"
              onClick={() => setPage(p => p + 1)}
              disabled={page === totalFilteredPages}
              style={{ opacity: page === totalFilteredPages ? 0.5 : 1 }}
            >
              Next →
            </button>
            {filteredUsers.length > 0 && (
              <div style={{ marginLeft: 16, color: 'var(--muted)', fontSize: 14 }}>
                Showing {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, filteredUsers.length)} of {filteredUsers.length}
              </div>
            )}
          </div>
        )}
      </div>
      <Modal open={deleteConfirmOpen} onClose={closeDeleteConfirm} title={`Delete: ${userToDelete?.email}`}>
        <p>Are you sure you want to delete this user? This action cannot be undone.</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="pill" style={{ background: '#bbb' }} onClick={closeDeleteConfirm}>Cancel</button>
          <button className="pill" style={{ background: '#991b1b', color: '#fff' }} onClick={confirmDelete}>Delete</button>
        </div>
      </Modal>
    </Layout>
  );
}
