// src/pages/SupplyIssueFormPage.tsx
// Phase 4c — formulaire de sortie (grille article x lieu), remplace la
// modale "Assign Supply". Une seule destination (personne et/ou lieu) par
// sortie ; poste sur POST /api/supply-issues (server/src/routes/supplyIssues.ts),
// qui écrit dans le ledger et refuse toute quantité > stock disponible.
// Le stock affiché (qty_on_hand) vient de GET /api/supply-items, déjà calculé
// depuis le ledger — plus de calcul client-side comme dans l'ancienne modale.
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/apiClient';
import { todayDateString } from '../lib/dateHelpers';
import Layout from '../Layout';

type SupplyItemOption = {
  id: number;
  code: string;
  name: string;
  category_name: string | null;
  base_unit: string;
  qty_on_hand: number;
  is_active: number;
};

type AssignableUser = {
  id: string;
  email: string;
  role?: string;
};

type LocationOption = {
  id: number;
  name: string;
  floor: string | null;
};

export default function SupplyIssueFormPage() {
  const navigate = useNavigate();

  const [items, setItems] = useState<SupplyItemOption[]>([]);
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [search, setSearch] = useState('');

  const [users, setUsers] = useState<AssignableUser[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<AssignableUser[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AssignableUser | null>(null);

  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [locationId, setLocationId] = useState('');

  const [issueDate, setIssueDate] = useState(todayDateString());
  const [purpose, setPurpose] = useState('');

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    Promise.all([loadItems(), loadUsers(), loadLocations()]).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!userSearch.trim()) {
      setFilteredUsers(users);
    } else {
      const s = userSearch.toLowerCase();
      setFilteredUsers(users.filter(u => u.email.toLowerCase().includes(s)));
    }
  }, [userSearch, users]);

  const loadItems = async () => {
    try {
      const { data } = await api.get<SupplyItemOption[]>('/supply-items?active=1');
      if (Array.isArray(data)) setItems(data);
    } catch (err) {
      console.error('Failed to load supply items:', err);
    }
  };

  const loadUsers = async () => {
    try {
      const { data } = await api.get<AssignableUser[]>('/users/assignable');
      if (Array.isArray(data)) {
        setUsers(data);
        setFilteredUsers(data);
      }
    } catch (err) {
      console.error('Failed to load users:', err);
    }
  };

  const loadLocations = async () => {
    try {
      const { data } = await api.get<LocationOption[]>('/locations');
      if (Array.isArray(data)) setLocations(data);
    } catch (err) {
      console.error('Failed to load locations:', err);
    }
  };

  const handleSelectUser = (user: AssignableUser) => {
    setSelectedUser(user);
    setUserSearch(user.email);
    setDropdownOpen(false);
  };

  const handleClearUser = () => {
    setSelectedUser(null);
    setUserSearch('');
  };

  const setQuantity = (itemId: number, value: string) => {
    setQuantities(prev => ({ ...prev, [itemId]: value }));
  };

  const filteredItems = useMemo(() => {
    if (!search.trim()) return items;
    const s = search.toLowerCase();
    return items.filter(it => it.name.toLowerCase().includes(s) || it.code.toLowerCase().includes(s));
  }, [items, search]);

  const lines = useMemo(() => {
    return Object.entries(quantities)
      .map(([itemId, qty]) => ({ item_id: parseInt(itemId, 10), quantity_base: parseInt(qty, 10) }))
      .filter(l => Number.isInteger(l.quantity_base) && l.quantity_base > 0);
  }, [quantities]);

  const totalLines = lines.length;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!issueDate) {
      setError('Issue date is required.');
      return;
    }
    if (!selectedUser && !locationId) {
      setError('Select a recipient, a location, or both.');
      return;
    }
    if (lines.length === 0) {
      setError('Enter a quantity for at least one item.');
      return;
    }
    for (const line of lines) {
      const item = items.find(it => it.id === line.item_id);
      if (item && line.quantity_base > item.qty_on_hand) {
        setError(`${item.name}: only ${item.qty_on_hand} ${item.base_unit}(s) available (requested ${line.quantity_base}).`);
        return;
      }
    }

    try {
      setSubmitting(true);
      const { data, error: apiError } = await api.post<{ id: number }>('/supply-issues', {
        issue_date: issueDate,
        destination_location_id: locationId ? parseInt(locationId, 10) : undefined,
        recipient_uid: selectedUser?.id || undefined,
        purpose: purpose || undefined,
        lines,
      });

      if (apiError) throw new Error(apiError);
      if (!data?.id) throw new Error('Failed to record the issue');

      setSuccess(true);
      setTimeout(() => navigate('/supplies'), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record the issue');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div style={{ padding: 20, textAlign: 'center' }}>Loading…</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div style={{ maxWidth: 800, margin: '0 auto', padding: 20 }}>
        <h1>Issue Supplies</h1>
        <p style={{ color: '#666', marginTop: -8, marginBottom: 20, fontSize: 14 }}>
          Enter a quantity for each item you're issuing, then choose who or where it's going. One issue can cover several items at once.
        </p>

        {success && (
          <div style={{ padding: 12, margin: '12px 0', background: '#d4edda', color: '#155724', borderRadius: 4 }}>
            ✅ Issue recorded! Redirecting…
          </div>
        )}
        {error && (
          <div style={{ padding: 12, margin: '12px 0', background: '#f8d7da', color: '#721c24', borderRadius: 4 }}>
            ❌ {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Destination */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
            <label style={{ flex: '1 1 240px' }}>
              <strong>Recipient</strong>
              <div style={{ position: 'relative', marginTop: 8 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    placeholder="Search by email…"
                    value={userSearch}
                    onChange={(e) => { setUserSearch(e.target.value); setDropdownOpen(true); if (!e.target.value) setSelectedUser(null); }}
                    onFocus={() => setDropdownOpen(true)}
                    onBlur={() => setTimeout(() => setDropdownOpen(false), 200)}
                    style={{ flex: 1, padding: 8, border: dropdownOpen ? '2px solid var(--brand)' : '1px solid #ddd', borderRadius: 4, boxSizing: 'border-box' }}
                  />
                  {selectedUser && (
                    <button type="button" onClick={handleClearUser} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888', fontSize: 18 }} title="Clear">×</button>
                  )}
                </div>
                {dropdownOpen && filteredUsers.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1px solid #ddd', borderTop: 'none', borderRadius: '0 0 4px 4px', maxHeight: 200, overflowY: 'auto', zIndex: 10, boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
                    {filteredUsers.map(user => (
                      <div
                        key={user.id}
                        onMouseDown={() => handleSelectUser(user)}
                        style={{ padding: 10, borderBottom: '1px solid #eee', cursor: 'pointer', background: selectedUser?.id === user.id ? '#e3f2fd' : 'white' }}
                      >
                        <strong>{user.email}</strong>
                        {user.role && <span style={{ color: '#666', marginLeft: 8, fontSize: 12 }}>({user.role})</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </label>

            <label style={{ flex: '1 1 200px' }}>
              <strong>Location</strong>
              <select value={locationId} onChange={e => setLocationId(e.target.value)} style={{ width: '100%', padding: 8, marginTop: 8, border: '1px solid #ddd', borderRadius: 4, boxSizing: 'border-box', background: 'white' }}>
                <option value="">— Select a location —</option>
                {locations.map(loc => (
                  <option key={loc.id} value={loc.id}>{loc.name}{loc.floor ? ` · ${loc.floor}` : ''}</option>
                ))}
              </select>
            </label>

            <label style={{ flex: '1 1 160px' }}>
              <strong>Date *</strong>
              <input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} style={{ width: '100%', padding: 8, marginTop: 8, border: '1px solid #ddd', borderRadius: 4, boxSizing: 'border-box' }} />
            </label>
          </div>

          <div style={{ marginBottom: 20 }}>
            <label>
              <strong>Purpose</strong>
              <input type="text" placeholder="e.g., Monthly office restock (optional)" value={purpose} onChange={e => setPurpose(e.target.value)} style={{ width: '100%', padding: 8, marginTop: 8, border: '1px solid #ddd', borderRadius: 4, boxSizing: 'border-box' }} />
            </label>
          </div>

          {/* Item grid */}
          <div style={{ marginBottom: 12 }}>
            <input
              type="text"
              placeholder="Search items…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: '100%', padding: 8, border: '1px solid #ddd', borderRadius: 4, boxSizing: 'border-box' }}
            />
          </div>

          <div style={{ border: '1px solid #eee', borderRadius: 4, overflow: 'hidden', marginBottom: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 0, padding: '8px 12px', background: '#f4f1ee', fontSize: 12, fontWeight: 600, color: '#666' }}>
              <div>Item</div>
              <div>Category</div>
              <div>On hand</div>
              <div>Qty to issue</div>
            </div>
            <div style={{ maxHeight: 420, overflowY: 'auto' }}>
              {filteredItems.map(item => {
                const qty = quantities[item.id] || '';
                const exceeds = qty !== '' && parseInt(qty, 10) > item.qty_on_hand;
                return (
                  <div
                    key={item.id}
                    style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 0, padding: '8px 12px', borderTop: '1px solid #eee', alignItems: 'center', fontSize: 14 }}
                  >
                    <div>
                      <strong>{item.name}</strong>
                      <div style={{ fontSize: 12, color: '#999' }}>{item.code}</div>
                    </div>
                    <div style={{ fontSize: 13, color: '#666' }}>{item.category_name || '—'}</div>
                    <div style={{ fontSize: 13, color: item.qty_on_hand === 0 ? '#b91c1c' : '#666' }}>
                      {item.qty_on_hand} {item.base_unit}
                    </div>
                    <div>
                      <input
                        type="number"
                        min="0"
                        max={item.qty_on_hand}
                        placeholder="0"
                        value={qty}
                        disabled={item.qty_on_hand === 0}
                        onChange={e => setQuantity(item.id, e.target.value)}
                        style={{ width: '100%', padding: 6, border: exceeds ? '1px solid #dc3545' : '1px solid #ddd', borderRadius: 4, boxSizing: 'border-box' }}
                      />
                    </div>
                  </div>
                );
              })}
              {filteredItems.length === 0 && (
                <div style={{ padding: 20, textAlign: 'center', color: '#999' }}>No items match your search.</div>
              )}
            </div>
          </div>

          <div style={{ marginBottom: 20, fontSize: 13, color: '#666' }}>
            {totalLines} item{totalLines !== 1 ? 's' : ''} selected
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" disabled={submitting} style={{ flex: 1, padding: 12, background: 'var(--brand)', color: 'white', border: 'none', borderRadius: 4, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.6 : 1 }}>
              {submitting ? 'Recording…' : 'Record Issue'}
            </button>
            <button type="button" onClick={() => navigate('/supplies')} style={{ flex: 1, padding: 12, background: '#f4f1ee', color: 'var(--ink)', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
}
