// src/screens/NewSupply.tsx
import React, { useState } from 'react';
import { api } from '../lib/apiClient';
import Autocomplete from '../components/Autocomplete';

type AssignableUser = {
  id: string;
  email: string;
  role?: string;
};

type Props = { onCreated?: () => void; onCancel?: () => void };

export default function NewSupply({ onCreated, onCancel }: Props) {
  const [name, setName]                 = useState('');
  const [categoryName, setCategoryName] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().split('T')[0]);
  const [cost, setCost]                 = useState<string>('');
  const [brand, setBrand]               = useState('');
  const [quantity, setQuantity]         = useState<string>('1');
  const [receiverEmail, setReceiverEmail] = useState('');
  const [saving, setSaving]             = useState(false);
  const [err, setErr]                   = useState<string | null>(null);
  const [users, setUsers]               = useState<AssignableUser[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<AssignableUser[]>([]);
  const [userSearch, setUserSearch]     = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);

  React.useEffect(() => {
    loadUsers();
  }, []);

  React.useEffect(() => {
    if (!userSearch.trim()) {
      setFilteredUsers(users);
    } else {
      const searchLower = userSearch.toLowerCase();
      setFilteredUsers(users.filter(u => u.email.toLowerCase().includes(searchLower)));
    }
  }, [userSearch, users]);

  // Load assignable users
  async function loadUsers() {
    try {
      const { data } = await api.get<AssignableUser[]>('/users/assignable');
      if (Array.isArray(data)) {
        setUsers(data);
        setFilteredUsers(data);
      }
    } catch (err) {
      console.error('Failed to load users:', err);
    }
  }

  // ✅ Fetch ONLY supply categories
  async function fetchCategoryOptions(q: string) {
    const query = new URLSearchParams();
    query.append('type', 'supply'); // ✅ Filter by supply type
    if (q) query.append('q', q);

    const { data } = await api.get<{ id: number; name: string; type: string }[]>(
      `/categories?${query.toString()}`
    );
    return (data ?? []).map(d => d.name);
  }

  // ✅ Create/get category with type='supply'
  async function getOrCreateCategoryId(name: string): Promise<number | null> {
    const trimmed = name.trim();
    if (!trimmed) return null;

    const { data, error } = await api.post<{ id: number }>(
      '/categories',
      {
        name: trimmed,
        type: 'supply' // ✅ Pass type
      }
    );
    if (error) throw new Error(error);
    return data?.id ?? null;
  }

  function handleSelectUser(user: AssignableUser) {
    setReceiverEmail(user.email);
    setUserSearch(user.email);
    setDropdownOpen(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSaving(true);

    try {
      if (!name.trim()) throw new Error('Supply name is required');
      if (!purchaseDate) throw new Error('Purchase date is required');
      if (!cost) throw new Error('Cost is required');
      if (!quantity) throw new Error('Quantity is required');
      if (!receiverEmail) throw new Error('Receiver is required');

      const category_id = await getOrCreateCategoryId(categoryName);

      const { data: inserted, error } = await api.post<{ id: number }>('/supplies', {
        name: name.trim(),
        purchase_date: purchaseDate,
        cost: Number(cost),
        brand: brand.trim() || null,
        quantity: Number(quantity),
        receiver_uid: receiverEmail, // Email string
        category_id: category_id || null,
      });

      if (error) throw new Error(error);
      if (!inserted?.id) throw new Error('Failed to create supply');

      // Reset form
      setName('');
      setCategoryName('');
      setPurchaseDate(new Date().toISOString().split('T')[0]);
      setCost('');
      setBrand('');
      setQuantity('1');
      setReceiverEmail('');
      onCreated?.();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to create supply');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="form-grid">
      {/* Name */}
      <div className="span-2">
        <label className="label">Supply Name *</label>
        <input
          className="field"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g., Office Chairs"
          required
        />
      </div>

      {/* Category */}
      <div className="span-2">
        <label className="label">Category</label>
        <Autocomplete
          className="field"
          value={categoryName}
          onChange={setCategoryName}
          fetchOptions={fetchCategoryOptions}
          placeholder="Search/add…"
        />
      </div>

      {/* Purchase Date */}
      <div>
        <label className="label">Purchase Date *</label>
        <input
          className="field"
          type="date"
          value={purchaseDate}
          onChange={e => setPurchaseDate(e.target.value)}
          required
        />
      </div>

      {/* Cost */}
      <div>
        <label className="label">Cost (GH₵) *</label>
        <input
          className="field"
          type="number"
          step="0.01"
          min="0"
          value={cost}
          onChange={e => setCost(e.target.value)}
          placeholder="0.00"
          required
        />
      </div>

      {/* Brand */}
      <div>
        <label className="label">Brand</label>
        <input
          className="field"
          value={brand}
          onChange={e => setBrand(e.target.value)}
          placeholder="e.g., IKEA"
        />
      </div>

      {/* Quantity */}
      <div>
        <label className="label">Quantity *</label>
        <input
          className="field"
          type="number"
          min="1"
          value={quantity}
          onChange={e => setQuantity(e.target.value)}
          required
        />
      </div>

      {/* Receiver Dropdown */}
      <div className="span-2">
        <label className="label">Receiver *</label>
        <div style={{ position: 'relative' }}>
          <input
            className="field"
            type="text"
            placeholder="Search by email..."
            value={userSearch}
            onChange={(e) => {
              setUserSearch(e.target.value);
              setDropdownOpen(true);
            }}
            onFocus={() => setDropdownOpen(true)}
            onBlur={() => setTimeout(() => setDropdownOpen(false), 200)}
            required={!receiverEmail}
          />

          {dropdownOpen && filteredUsers.length > 0 && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              background: 'white',
              border: '1px solid var(--line)',
              borderTop: 'none',
              borderRadius: '0 0 4px 4px',
              maxHeight: 200,
              overflowY: 'auto',
              zIndex: 10,
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            }}>
              {filteredUsers.map((user) => (
                <div
                  key={user.id}
                  onMouseDown={() => handleSelectUser(user)}
                  style={{
                    padding: '10px',
                    borderBottom: '1px solid var(--line)',
                    cursor: 'pointer',
                    background: receiverEmail === user.email ? '#e3f2fd' : 'white',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.backgroundColor =
                      receiverEmail === user.email ? '#e3f2fd' : '#f9f9f9';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.backgroundColor =
                      receiverEmail === user.email ? '#e3f2fd' : 'white';
                  }}
                >
                  <strong>{user.email}</strong>
                  {user.role && <span style={{ color: '#666', marginLeft: 8, fontSize: 12 }}>({user.role})</span>}
                </div>
              ))}
            </div>
          )}

          {dropdownOpen && userSearch && filteredUsers.length === 0 && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              background: 'white',
              border: '1px solid var(--line)',
              borderTop: 'none',
              borderRadius: '0 0 4px 4px',
              padding: '10px',
              color: '#999',
              zIndex: 10,
            }}>
              No users found
            </div>
          )}
        </div>
      </div>

      {/* Error */}
      {err && <p className="span-2" style={{ color: 'crimson' }}>{err}</p>}

      {/* Actions */}
      <div className="span-2 modal-actions">
        {onCancel && <button type="button" className="pill pill--muted" onClick={onCancel}>Cancel</button>}
        <button className="pill" disabled={saving}>{saving ? 'Saving…' : 'Create'}</button>
      </div>
    </form>
  );
}
