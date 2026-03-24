// src/components/UserManagementPanel.tsx
import React from "react";
import { useEffect, useState } from 'react';
import { rpc } from '../lib/apiClient';

type User = { id: string; email: string; role: 'user' | 'admin' | 'super_admin'; created_at: string; created_by_email: string | null; };

export default function UserManagementPanel({ onClose }: { onClose?: () => void }) {
  const [users, setUsers]         = useState<User[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [newEmail, setNewEmail]   = useState('');
  const [newRole, setNewRole]     = useState<'user' | 'admin'>('user');
  const [adding, setAdding]       = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await rpc<User[]>('list_all_users');
    if (error) setError(error); else { setUsers(data ?? []); setError(null); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

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

  const handleDeleteUser = async (userId: string, email: string) => {
    if (!confirm(`Supprimer ${email} ? Action irréversible.`)) return;
    const { error } = await rpc('delete_user', { p_user_id: userId });
    if (error) setError(error); else await load();
  };

  if (loading) return <div style={{ padding: 20 }}>Chargement…</div>;

  return (
    <div style={{ minWidth: 600 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        {onClose && <button className="pill" onClick={onClose}>Fermer</button>}
      </div>

      {error && <div style={{ padding: 12, background: '#fee', color: 'crimson', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>⚠️ {error}</div>}

      <form onSubmit={handleAddUser} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: 8, marginBottom: 20, alignItems: 'end' }}>
        <div>
          <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>Email</label>
          <input type="email" className="input" placeholder="user@example.com" value={newEmail} onChange={e => setNewEmail(e.target.value)} disabled={adding} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>Rôle</label>
          <select className="input" value={newRole} onChange={e => setNewRole(e.target.value as 'user' | 'admin')} disabled={adding}>
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <button className="pill" type="submit" disabled={adding}>{adding ? '…' : '+ Ajouter'}</button>
      </form>

      <table className="table">
        <thead><tr style={{ background: '#8D86C9' }}><th>Email</th><th style={{ width: 120 }}>Rôle</th><th style={{ width: 130 }}>Créé</th><th style={{ width: 120 }}>Par</th><th style={{ width: 180 }}></th></tr></thead>
        <tbody>
          {users.length === 0 ? (
            <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)', padding: 20 }}>Aucun utilisateur</td></tr>
          ) : users.map(user => (
            <tr key={user.id}>
              <td>{user.email}</td>
              <td>
                {editingUser?.id === user.id ? (
                  <select className="input" value={editingUser.role} onChange={e => setEditingUser({ ...editingUser, role: e.target.value as User['role'] })} style={{ width: '100%' }}>
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                    <option value="super_admin">Super Admin</option>
                  </select>
                ) : <span style={{ textTransform: 'capitalize' }}>{user.role}</span>}
              </td>
              <td style={{ fontSize: 12, color: 'var(--muted)' }}>{new Date(user.created_at).toLocaleDateString()}</td>
              <td style={{ fontSize: 12, color: 'var(--muted)' }}>{user.created_by_email || '—'}</td>
              <td>
                <div style={{ display: 'flex', gap: 6 }}>
                  {editingUser?.id === user.id ? (
                    <>
                      <button className="pill" style={{ fontSize: 11, padding: '5px 8px' }} onClick={() => handleChangeRole(user.id, editingUser.role)}>Sauver</button>
                      <button className="pill" style={{ fontSize: 11, padding: '5px 8px', background: '#bbb' }} onClick={() => setEditingUser(null)}>Annuler</button>
                    </>
                  ) : (
                    <>
                      <button className="pill" style={{ fontSize: 11, padding: '5px 8px' }} onClick={() => setEditingUser(user)}>Éditer</button>
                      <button className="pill" style={{ fontSize: 11, padding: '5px 8px', background: '#f3d0d0' }} onClick={() => handleDeleteUser(user.id, user.email)}>Supprimer</button>
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
