// src/screens/AssignAsset.tsx
import React, { useEffect, useState } from 'react';
import { api } from '../lib/apiClient';
import Autocomplete from '../components/Autocomplete';

type AssignableUser = { id: string; email: string };
type Location = { id: number; name: string; floor: string | null };

export default function AssignAsset({ assetId, onDone }: { assetId: number; onDone?: () => void }) {
  // User
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedUserEmail, setSelectedUserEmail] = useState('');

  // Location
  const [locations, setLocations] = useState<Location[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState('');

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Charger toutes les localisations au mount
  useEffect(() => {
    api.get<Location[]>('/locations').then(({ data }) => {
      if (data) setLocations(data);
    });
  }, []);

  async function fetchAssignableUsers(q: string) {
    const { data } = await api.get<AssignableUser[]>(
      `/users/assignable${q ? `?q=${encodeURIComponent(q)}` : ''}`
    );
    return (data ?? []).map(u => u.email);
  }

  const handleUserSelect = async (selectedEmail: string) => {
    setSelectedUserEmail(selectedEmail);
    const { data } = await api.get<AssignableUser[]>(
      `/users/assignable?q=${encodeURIComponent(selectedEmail)}`
    );
    if (data && data.length > 0) {
      const user = data.find(u => u.email === selectedEmail);
      if (user?.id) setSelectedUserId(user.id);
    }
  };

  const handleUserClear = () => {
    setSelectedUserId('');
    setSelectedUserEmail('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedUserId && !selectedLocationId) {
      setErr('Select a user, a location, or both');
      return;
    }

    setLoading(true);
    setErr(null);

    const { error } = await api.post('/assignments', {
      asset_id: assetId,
      assigned_user_id: selectedUserId || undefined,
      location_id: selectedLocationId ? parseInt(selectedLocationId, 10) : undefined,
    });

    setLoading(false);
    if (error) { setErr(error); return; }

    setSelectedUserId('');
    setSelectedUserEmail('');
    setSelectedLocationId('');
    onDone?.();
  };

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 16, maxWidth: 420, margin: 'auto' }}>

      {/* ── Assign to user ── */}
      <div style={{ display: 'grid', gap: 6 }}>
        <label style={{ fontWeight: 600 }}>Assign to user</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Autocomplete
            value={selectedUserEmail}
            onChange={(v) => { setSelectedUserEmail(v); if (!v) setSelectedUserId(''); }}
            onSelect={handleUserSelect}
            fetchOptions={fetchAssignableUsers}
            placeholder="Search by email…"
          />
          {selectedUserId && (
            <button
              type="button"
              onClick={handleUserClear}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888', fontSize: 18 }}
              title="Clear user"
            >
              ×
            </button>
          )}
        </div>
        {selectedUserId && (
          <span style={{ fontSize: 12, color: '#16a34a' }}>✓ {selectedUserEmail}</span>
        )}
      </div>

      {/* ── Assign to location ── */}
      <div style={{ display: 'grid', gap: 6 }}>
        <label style={{ fontWeight: 600 }}>Assign to location</label>
        <select
          className="field"
          value={selectedLocationId}
          onChange={(e) => setSelectedLocationId(e.target.value)}
        >
          <option value="">— Select a location —</option>
          {locations.map(loc => (
            <option key={loc.id} value={loc.id}>
              {loc.name}{loc.floor ? ` · ${loc.floor}` : ''}
            </option>
          ))}
        </select>
      </div>

      {err && <p style={{ color: 'crimson', margin: 0 }}>{err}</p>}

      <button className="pill green-light" disabled={loading || (!selectedUserId && !selectedLocationId)}>
        {loading ? 'Assigning…' : 'Assign'}
      </button>
    </form>
  );
}
