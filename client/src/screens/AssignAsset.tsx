// src/screens/AssignAsset.tsx
import React from "react";
import { useState } from 'react';
import { api } from '../lib/apiClient';
import Autocomplete from '../components/Autocomplete';

type AssignableUser = {
  id: string;
  email: string;
};

export default function AssignAsset({ assetId, onDone }: { assetId: number; onDone?: () => void }) {
  const [selectedUserId, setSelectedUserId]   = useState('');
  const [selectedUserEmail, setSelectedUserEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr]         = useState<string | null>(null);

  // ✅ Récupère les users avec rôle 'assignee' depuis /users/assignable
  async function fetchAssignableUsers(q: string) {
    const { data } = await api.get<AssignableUser[]>(
      `/users/assignable${q ? `?q=${encodeURIComponent(q)}` : ''}`
    );
    return (data ?? []).map(u => u.email);  // Afficher l'email pour l'autocomplete
  }

  // ✅ Quand on sélectionne un email, remplir automatiquement l'ID
  const handleUserSelect = async (selectedEmail: string) => {
    setSelectedUserEmail(selectedEmail);

    // Chercher l'ID correspondant
    const { data } = await api.get<AssignableUser[]>(
      `/users/assignable?q=${encodeURIComponent(selectedEmail)}`
    );

    if (data && data.length > 0) {
      const user = data.find(u => u.email === selectedEmail);
      if (user?.id) {
        setSelectedUserId(user.id);
      }
    }
  };

  // ✅ POST avec assigned_user_id au lieu de assignee_name/email
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedUserId) {
      setErr('Please select a user');
      return;
    }

    setLoading(true);
    setErr(null);

    const { error } = await api.post('/assignments', {
      asset_id: assetId,
      assigned_user_id: selectedUserId
    });

    setLoading(false);
    if (error) { setErr(error); return; }
    setSelectedUserId('');
    setSelectedUserEmail('');
    onDone?.();
  };

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 12, maxWidth: 420, margin: 'auto' }}>
      <label>Assign to user *</label>
      <Autocomplete
        value={selectedUserEmail}
        onChange={setSelectedUserEmail}
        onSelect={handleUserSelect}
        fetchOptions={fetchAssignableUsers}
        placeholder="Search by email…"
      />

      <button className="pill green-light" disabled={loading || !selectedUserId}>
        {loading ? 'Assigning…' : 'Assign'}
      </button>
      {err && <p style={{ color: 'crimson' }}>{err}</p>}
    </form>
  );
}
