// src/pages/CreateSupplyPage.tsx
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/apiClient';
import Autocomplete from '../components/Autocomplete';
import Layout from '../Layout';

type AssignableUser = {
  id: string;
  email: string;
  role?: string;
};

type SupplyNameSuggestion = {
  name: string;
  category_id: number | null;
  category_name: string | null;
  brand: string | null;
  usage_count: number;
};

interface SupplyInput {
  name: string;
  purchase_date: string;
  cost: number;
  brand?: string;
  quantity: number;
  receiver_uid: string;
  category_id?: number;
}

export default function CreateSupplyPage() {
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    name: '',
    purchase_date: new Date().toISOString().split('T')[0],
    cost: '',
    brand: '',
    quantity: '1',
    receiver_uid: '',
    categoryName: '',
  });

  const [users, setUsers] = useState<AssignableUser[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<AssignableUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);

  // ✅ Existing-supply name suggestions (avoid logging the same supply under different names)
  const [nameSuggestions, setNameSuggestions] = useState<SupplyNameSuggestion[]>([]);
  const [nameDropdownOpen, setNameDropdownOpen] = useState(false);
  const [matchedSupply, setMatchedSupply] = useState<SupplyNameSuggestion | null>(null);

  useEffect(() => {
    loadUsers();
  }, []);

  // ✅ Query existing supply names after 3+ characters
  useEffect(() => {
    const trimmed = formData.name.trim();
    setMatchedSupply(prev => (prev && prev.name.toLowerCase() === trimmed.toLowerCase() ? prev : null));

    if (trimmed.length < 3) {
      setNameSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const { data } = await api.get<SupplyNameSuggestion[]>(
          `/supplies/search-names?q=${encodeURIComponent(trimmed)}`
        );
        setNameSuggestions(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('Failed to fetch supply name suggestions:', err);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [formData.name]);

  const handleSelectNameSuggestion = (s: SupplyNameSuggestion) => {
    setFormData(prev => ({
      ...prev,
      name: s.name,
      categoryName: s.category_name || prev.categoryName,
      brand: s.brand || prev.brand,
    }));
    setMatchedSupply(s);
    setNameDropdownOpen(false);
  };

  useEffect(() => {
    if (!userSearch.trim()) {
      setFilteredUsers(users);
    } else {
      const searchLower = userSearch.toLowerCase();
      setFilteredUsers(users.filter(u => u.email.toLowerCase().includes(searchLower)));
    }
  }, [userSearch, users]);

  const loadUsers = async () => {
    try {
      const { data } = await api.get<AssignableUser[]>('/users/all');
      if (Array.isArray(data)) {
        setUsers(data);
        setFilteredUsers(data);
      }
    } catch (err) {
      console.error('Failed to load users:', err);
    }
  };

  // ✅ Fetch ONLY supply categories
  async function fetchCategoryOptions(q: string) {
    const query = new URLSearchParams();
    query.append('type', 'supply');
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
        type: 'supply'
      }
    );
    if (error) throw new Error(error);
    return data?.id ?? null;
  }

  const handleSelectUser = (user: AssignableUser) => {
    setFormData(prev => ({ ...prev, receiver_uid: user.email }));
    setUserSearch(user.email);
    setDropdownOpen(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name || !formData.purchase_date || !formData.cost || !formData.quantity || !formData.receiver_uid) {
      setError('Please fill in all required fields');
      return;
    }

    try {
      setCreateLoading(true);
      setError(null);

      // ✅ Create category if needed
      const category_id = await getOrCreateCategoryId(formData.categoryName);

      // ✅ Build payload
      const payload: SupplyInput = {
        name: formData.name,
        purchase_date: formData.purchase_date,
        cost: parseFloat(formData.cost),
        brand: formData.brand || undefined,
        quantity: parseInt(formData.quantity),
        receiver_uid: formData.receiver_uid,
        category_id: category_id || undefined,
      };

      const { data: inserted, error } = await api.post<{ id: number }>('/supplies', payload);

      if (error) throw new Error(error);
      if (!inserted?.id) throw new Error('Failed to create supply');

      setSuccess(true);
      setTimeout(() => {
        navigate('/supplies');
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create supply');
    } finally {
      setCreateLoading(false);
    }
  };

  return (
    <Layout>
      <div style={{ maxWidth: 600, margin: '0 auto', padding: 20 }}>
        <h1>Create Supply</h1>

        {success && (
          <div style={{
            padding: 12,
            margin: '12px 0',
            background: '#d4edda',
            color: '#155724',
            borderRadius: 4,
          }}>
            ✅ Supply created successfully! Redirecting...
          </div>
        )}

        {error && (
          <div style={{
            padding: 12,
            margin: '12px 0',
            background: '#f8d7da',
            color: '#721c24',
            borderRadius: 4,
          }}>
            ❌ {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Name */}
          <div style={{ marginBottom: 20 }}>
            <label>
              <strong>Supply Name *</strong>
              <div style={{ position: 'relative', marginTop: 8 }}>
                <input
                  type="text"
                  placeholder="e.g., Office Chairs"
                  value={formData.name}
                  onChange={(e) => {
                    setFormData(prev => ({ ...prev, name: e.target.value }));
                    setNameDropdownOpen(true);
                  }}
                  onFocus={() => { if (nameSuggestions.length) setNameDropdownOpen(true); }}
                  onBlur={() => setTimeout(() => setNameDropdownOpen(false), 200)}
                  style={{
                    width: '100%',
                    padding: 8,
                    border: '1px solid #ddd',
                    borderRadius: 4,
                    boxSizing: 'border-box',
                  }}
                />

                {nameDropdownOpen && nameSuggestions.length > 0 && (
                  <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    background: 'white',
                    border: '1px solid #ddd',
                    borderTop: 'none',
                    borderRadius: '0 0 4px 4px',
                    maxHeight: 220,
                    overflowY: 'auto',
                    zIndex: 10,
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                  }}>
                    {nameSuggestions.map((s, i) => (
                      <div
                        key={`${s.name}-${i}`}
                        onMouseDown={() => handleSelectNameSuggestion(s)}
                        style={{ padding: 10, borderBottom: '1px solid #eee', cursor: 'pointer' }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = '#f9f9f9'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'white'; }}
                      >
                        <strong>{s.name}</strong>
                        <span style={{ color: '#666', marginLeft: 8, fontSize: 12 }}>
                          {[s.category_name, s.brand].filter(Boolean).join(' · ') || 'no category/brand'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {matchedSupply && (
                <div style={{ marginTop: 6, fontSize: 12, color: '#166534' }}>
                  ✅ Existing supply matched — category/brand pre-filled from past entries ({matchedSupply.usage_count} prior record{matchedSupply.usage_count > 1 ? 's' : ''}). Adjust below if this purchase differs.
                </div>
              )}
              {!matchedSupply && formData.name.trim().length >= 3 && nameSuggestions.length > 0 && (
                <div style={{ marginTop: 6, fontSize: 12, color: '#b45309' }}>
                  ⚠️ Similar supplies exist — pick one from the list to keep stats consistent, or continue if this is genuinely new.
                </div>
              )}
            </label>
          </div>

          {/* ✅ Category Autocomplete */}
          <div style={{ marginBottom: 20 }}>
            <label>
              <strong>Category</strong>
              <Autocomplete
                value={formData.categoryName}
                onChange={(value) => setFormData(prev => ({ ...prev, categoryName: value }))}
                fetchOptions={fetchCategoryOptions}
                placeholder="Search/add category…"
                className="field"
              />
            </label>
          </div>

          {/* Purchase Date */}
          <div style={{ marginBottom: 20 }}>
            <label>
              <strong>Purchase Date *</strong>
              <input
                type="date"
                value={formData.purchase_date}
                onChange={(e) => setFormData(prev => ({ ...prev, purchase_date: e.target.value }))}
                style={{
                  width: '100%',
                  padding: 8,
                  marginTop: 8,
                  border: '1px solid #ddd',
                  borderRadius: 4,
                  boxSizing: 'border-box',
                }}
              />
            </label>
          </div>

          {/* Cost */}
          <div style={{ marginBottom: 20 }}>
            <label>
              <strong>Cost (GH₵) *</strong>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={formData.cost}
                onChange={(e) => setFormData(prev => ({ ...prev, cost: e.target.value }))}
                style={{
                  width: '100%',
                  padding: 8,
                  marginTop: 8,
                  border: '1px solid #ddd',
                  borderRadius: 4,
                  boxSizing: 'border-box',
                }}
              />
            </label>
          </div>

          {/* Brand */}
          <div style={{ marginBottom: 20 }}>
            <label>
              <strong>Brand</strong>
              <input
                type="text"
                placeholder="e.g., IKEA"
                value={formData.brand}
                onChange={(e) => setFormData(prev => ({ ...prev, brand: e.target.value }))}
                style={{
                  width: '100%',
                  padding: 8,
                  marginTop: 8,
                  border: '1px solid #ddd',
                  borderRadius: 4,
                  boxSizing: 'border-box',
                }}
              />
            </label>
          </div>

          {/* Quantity */}
          <div style={{ marginBottom: 20 }}>
            <label>
              <strong>Quantity *</strong>
              <input
                type="number"
                min="1"
                value={formData.quantity}
                onChange={(e) => setFormData(prev => ({ ...prev, quantity: e.target.value }))}
                style={{
                  width: '100%',
                  padding: 8,
                  marginTop: 8,
                  border: '1px solid #ddd',
                  borderRadius: 4,
                  boxSizing: 'border-box',
                }}
              />
            </label>
          </div>

          {/* Receiver (Dropdown) */}
          <div style={{ marginBottom: 20 }}>
            <label>
              <strong>Receiver *</strong>
              <div style={{ position: 'relative', marginTop: 8 }}>
                <input
                  type="text"
                  placeholder="Search by email..."
                  value={userSearch}
                  onChange={(e) => {
                    setUserSearch(e.target.value);
                    setDropdownOpen(true);
                  }}
                  onFocus={() => setDropdownOpen(true)}
                  onBlur={() => setTimeout(() => setDropdownOpen(false), 200)}
                  style={{
                    width: '100%',
                    padding: 8,
                    border: dropdownOpen ? '2px solid var(--brand)' : '1px solid #ddd',
                    borderRadius: 4,
                    boxSizing: 'border-box',
                    transition: 'border-color 0.2s',
                  }}
                />

                {dropdownOpen && filteredUsers.length > 0 && (
                  <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    background: 'white',
                    border: '1px solid #ddd',
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
                          padding: 10,
                          borderBottom: '1px solid #eee',
                          cursor: 'pointer',
                          background: formData.receiver_uid === user.email ? '#e3f2fd' : 'white',
                        }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLElement).style.backgroundColor = formData.receiver_uid === user.email ? '#e3f2fd' : '#f9f9f9';
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLElement).style.backgroundColor = formData.receiver_uid === user.email ? '#e3f2fd' : 'white';
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
                    border: '1px solid #ddd',
                    borderTop: 'none',
                    borderRadius: '0 0 4px 4px',
                    padding: 10,
                    color: '#999',
                    zIndex: 10,
                  }}>
                    No users found
                  </div>
                )}
              </div>
            </label>
          </div>

          {/* Submit */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="submit"
              disabled={createLoading}
              style={{
                flex: 1,
                padding: 12,
                background: 'var(--brand)',
                color: 'white',
                border: 'none',
                borderRadius: 4,
                cursor: createLoading ? 'not-allowed' : 'pointer',
                opacity: createLoading ? 0.6 : 1,
              }}
            >
              {createLoading ? 'Creating...' : 'Create Supply'}
            </button>
            <button
              type="button"
              onClick={() => navigate('/supplies')}
              style={{
                flex: 1,
                padding: 12,
                background: '#f4f1ee',
                color: 'var(--ink)',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
}
