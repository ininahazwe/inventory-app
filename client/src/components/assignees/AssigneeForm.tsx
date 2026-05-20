// src/components/assignees/AssigneeForm.tsx
import React from "react";
import { useState } from 'react';
import { api } from '../../lib/apiClient';
import type { Assignee } from './type';

export default function AssigneeForm({ assignee, onSaved, onCancel }: { assignee: Assignee; onSaved: () => void; onCancel: () => void; }) {
  const [assignee_name, setAssigneeName] = useState(assignee.assignee_name ?? '');
  const [assignee_email, setAssigneeEmail] = useState(assignee.assignee_email ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const new_name = assignee_name.trim();
    const new_email = assignee_email.trim();

    if (!new_name) return setErr('Le nom est obligatoire');
    if (!new_email) return setErr('L\'email est obligatoire');
    if (!/^\S+@\S+\.\S+$/.test(new_email)) return setErr('Email invalide');

    setBusy(true);
    setErr(null);

    // ✅ REST: PATCH /assignments/assignee au lieu de RPC
    const { error } = await api.patch('/assignments/assignee', {
      old_email: assignee.assignee_email,
      new_name,
      new_email
    });

    setBusy(false);
    if (error) {
      setErr(error);
    } else {
      onSaved();
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>Met à jour toutes les lignes <code>assignments</code> correspondant à cette personne.</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div>
          <label style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Nom *</label>
          <input
            className="input"
            placeholder="Nom complet"
            value={assignee_name}
            onChange={e => setAssigneeName(e.target.value)}
          />
        </div>
        <div>
          <label style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Email *</label>
          <input
            className="input"
            placeholder="Email"
            value={assignee_email}
            onChange={e => setAssigneeEmail(e.target.value)}
          />
        </div>
      </div>
      {err && <p style={{ color: 'crimson', fontSize: 12 }}>{err}</p>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
        <button type="button" className="pill" style={{ background: '#bbb' }} onClick={onCancel} disabled={busy}>Annuler</button>
        <button type="submit" className="pill green-light" disabled={busy}>{busy ? 'Sauvegarde…' : 'Enregistrer'}</button>
      </div>
    </form>
  );
}
