import React, { useEffect, useState } from 'react';
import { api } from '../lib/apiClient';
import { useSupplyAssignments, type SupplyAssignmentInput } from '../hooks/useSupplyAssignments';

type User = {
  id: string;
  email: string;
  role?: string;
};

type Location = {
  id: number;
  name: string;
  floor: string | null;
};

type Supply = {
  id: number;
  name: string;
  quantity: number;
};

interface AssignSupplyModalProps {
  supplies: Supply[];
  onAssigned?: () => void;
  onClose: () => void;
}

export const AssignSupplyModal: React.FC<AssignSupplyModalProps> = ({
                                                                      supplies,
                                                                      onAssigned,
                                                                      onClose,
                                                                    }) => {
  const { createAssignment, loading: assignLoading } = useSupplyAssignments();

  const [selectedSupply, setSelectedSupply] = useState<Supply | null>(null);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<string>('');
  const [assignedDate, setAssignedDate] = useState(new Date().toISOString().split('T')[0]);
  const [quantity, setQuantity] = useState<string>('1');

  const [users, setUsers] = useState<User[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<User[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const [locations, setLocations] = useState<Location[]>([]);

  const [supplySearch, setSupplySearch] = useState('');
  const [filteredSupplies, setFilteredSupplies] = useState<Supply[]>(supplies);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // ✅ Fetch assignments to calculate available stock
  const [assignments, setAssignments] = useState<any[]>([]);

  useEffect(() => {
    loadUsers();
    loadLocations();
    loadAssignments();
  }, []);

  // ✅ Load all assignments to calculate stock
  const loadAssignments = async () => {
    try {
      const { data } = await api.get<any[]>('/supply-assignments?status=active');
      if (Array.isArray(data)) {
        setAssignments(data);
      }
    } catch (err) {
      console.error('Failed to load assignments:', err);
    }
  };

  // ✅ Load locations
  const loadLocations = async () => {
    try {
      const { data } = await api.get<Location[]>('/locations');
      if (Array.isArray(data)) {
        setLocations(data);
      }
    } catch (err) {
      console.error('Failed to load locations:', err);
    }
  };

  // ✅ Calculate available stock for a supply
  const getAvailableStock = (supplyId: number): { assigned: number; available: number } => {
    const supply = supplies.find(s => s.id === supplyId);
    if (!supply) return { assigned: 0, available: 0 };

    const assignedQty = assignments
      .filter(a => a.supply_id === supplyId && a.status === 'active')
      .reduce((sum, a) => sum + (a.quantity_assigned || 0), 0);

    return {
      assigned: assignedQty,
      available: Math.max(0, supply.quantity - assignedQty),
    };
  };

  useEffect(() => {
    if (!supplySearch.trim()) {
      setFilteredSupplies(supplies);
    } else {
      const searchLower = supplySearch.toLowerCase();
      setFilteredSupplies(supplies.filter(s => s.name.toLowerCase().includes(searchLower)));
    }
  }, [supplySearch, supplies]);

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
      const { data } = await api.get<User[]>('/users/assignable');
      if (Array.isArray(data)) {
        setUsers(data);
        setFilteredUsers(data);
      }
    } catch (err) {
      console.error('Failed to load users:', err);
    }
  };

  const handleClearUser = () => {
    setSelectedUser(null);
    setUserSearch('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!selectedSupply || !assignedDate || !quantity) {
      setError('Supply, quantity and date are required');
      return;
    }

    if (!selectedUser && !selectedLocationId) {
      setError('Select a user, a location, or both');
      return;
    }

    const stock = getAvailableStock(selectedSupply.id);
    const qtyRequested = parseInt(quantity, 10);

    if (isNaN(qtyRequested) || qtyRequested < 1) {
      setError('Quantity must be at least 1');
      return;
    }

    if (qtyRequested > stock.available) {
      setError(`Only ${stock.available} units available. You requested ${qtyRequested}.`);
      return;
    }

    try {
      setLoading(true);

      const payload: SupplyAssignmentInput = {
        supply_id: selectedSupply.id,
        assigned_user_id: selectedUser?.id || undefined,
        location_id: selectedLocationId ? parseInt(selectedLocationId, 10) : undefined,
        quantity_assigned: qtyRequested,
        assigned_at: assignedDate,
      };

      const success = await createAssignment(payload);

      if (success) {
        await loadAssignments(); // refresh local stock before form resets/closes
        // Reset form
        setSelectedSupply(null);
        setSelectedUser(null);
        setSelectedLocationId('');
        setSupplySearch('');
        setUserSearch('');
        setQuantity('1');
        setAssignedDate(new Date().toISOString().split('T')[0]);
        onAssigned?.();
        onClose();
      } else {
        setError('Failed to assign supply');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign supply');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
    }}>
      <div style={{
        background: 'white',
        borderRadius: '8px',
        padding: '24px',
        width: '100%',
        maxWidth: '500px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
      }}>
        <h2 style={{ margin: '0 0 20px 0', color: 'var(--ink)' }}>Assign Supply</h2>

        {error && (
          <div style={{
            padding: 12,
            margin: '12px 0',
            background: '#f8d7da',
            color: '#721c24',
            borderRadius: 4,
            fontSize: 14,
          }}>
            ❌ {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Supply Selection */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>
              Supply *
            </label>
            <input
              type="text"
              placeholder="Search supplies..."
              value={supplySearch}
              onChange={(e) => setSupplySearch(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #ddd',
                borderRadius: 4,
                boxSizing: 'border-box',
                marginBottom: 8,
              }}
            />
            {supplySearch && filteredSupplies.length > 0 && (
              <div style={{
                border: '1px solid #ddd',
                borderRadius: 4,
                maxHeight: 150,
                overflowY: 'auto',
              }}>
                {filteredSupplies.map(supply => {
                  const stock = getAvailableStock(supply.id);
                  return (
                    <div
                      key={supply.id}
                      onClick={() => {
                        if (stock.available === 0) return;
                        setSelectedSupply(supply);
                        setSupplySearch('');
                      }}
                      style={{
                        padding: '8px',
                        borderBottom: '1px solid #eee',
                        cursor: stock.available === 0 ? 'not-allowed' : 'pointer',
                        background: selectedSupply?.id === supply.id ? '#e3f2fd' : 'white',
                        opacity: stock.available === 0 ? 0.5 : 1,
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.backgroundColor =
                          selectedSupply?.id === supply.id ? '#e3f2fd' : stock.available === 0 ? 'white' : '#f9f9f9';
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.backgroundColor =
                          selectedSupply?.id === supply.id ? '#e3f2fd' : 'white';
                      }}
                    >
                      <strong>{supply.name}</strong>
                      <div style={{ fontSize: 12, color: '#666' }}>
                        Total: {supply.quantity} | Assigned: {stock.assigned} | Available: {stock.available}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {selectedSupply && (
              <div style={{
                padding: 8,
                background: '#e3f2fd',
                borderRadius: 4,
                fontSize: 14,
              }}>
                ✓ {selectedSupply.name} — Total: {selectedSupply.quantity} | Available: {getAvailableStock(selectedSupply.id).available}
              </div>
            )}
          </div>

          {/* Quantity */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>
              Quantity *
            </label>
            <input
              type="number"
              min="1"
              max={selectedSupply ? getAvailableStock(selectedSupply.id).available : 1}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #ddd',
                borderRadius: 4,
                boxSizing: 'border-box',
              }}
            />
            {selectedSupply && (
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                Available: {getAvailableStock(selectedSupply.id).available}
              </div>
            )}
          </div>

          {/* User Selection */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>
              Assign to user
            </label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="text"
                placeholder="Search by email..."
                value={userSearch}
                onChange={(e) => {
                  setUserSearch(e.target.value);
                  setDropdownOpen(true);
                  if (!e.target.value) setSelectedUser(null);
                }}
                onFocus={() => setDropdownOpen(true)}
                onBlur={() => setTimeout(() => setDropdownOpen(false), 200)}
                style={{
                  flex: 1,
                  padding: '8px',
                  border: dropdownOpen ? '2px solid var(--brand)' : '1px solid #ddd',
                  borderRadius: 4,
                  boxSizing: 'border-box',
                }}
              />
              {selectedUser && (
                <button
                  type="button"
                  onClick={handleClearUser}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888', fontSize: 18 }}
                  title="Clear user"
                >
                  ×
                </button>
              )}
            </div>

            {dropdownOpen && filteredUsers.length > 0 && (
              <div style={{
                border: '1px solid #ddd',
                borderRadius: 4,
                maxHeight: 150,
                overflowY: 'auto',
                marginTop: 8,
              }}>
                {filteredUsers.map(user => (
                  <div
                    key={user.id}
                    onMouseDown={() => {
                      setSelectedUser(user);
                      setUserSearch(user.email);
                      setDropdownOpen(false);
                    }}
                    style={{
                      padding: '8px',
                      borderBottom: '1px solid #eee',
                      cursor: 'pointer',
                      background: selectedUser?.id === user.id ? '#e3f2fd' : 'white',
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.backgroundColor =
                        selectedUser?.id === user.id ? '#e3f2fd' : '#f9f9f9';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.backgroundColor =
                        selectedUser?.id === user.id ? '#e3f2fd' : 'white';
                    }}
                  >
                    <strong>{user.email}</strong>
                    {user.role && <span style={{ color: '#666', marginLeft: 8, fontSize: 12 }}>({user.role})</span>}
                  </div>
                ))}
              </div>
            )}
            {selectedUser && (
              <div style={{
                padding: 8,
                background: '#e3f2fd',
                borderRadius: 4,
                fontSize: 14,
                marginTop: 8,
              }}>
                ✓ {selectedUser.email}
              </div>
            )}
          </div>

          {/* Location Selection */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>
              Assign to location
            </label>
            <select
              value={selectedLocationId}
              onChange={(e) => setSelectedLocationId(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #ddd',
                borderRadius: 4,
                boxSizing: 'border-box',
                background: 'white',
              }}
            >
              <option value="">— Select a location —</option>
              {locations.map(loc => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}{loc.floor ? ` · ${loc.floor}` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Date */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>
              Date *
            </label>
            <input
              type="date"
              value={assignedDate}
              onChange={(e) => setAssignedDate(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #ddd',
                borderRadius: 4,
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="submit"
              disabled={loading || assignLoading || (!selectedUser && !selectedLocationId)}
              style={{
                flex: 1,
                padding: 12,
                background: 'var(--brand)',
                color: 'white',
                border: 'none',
                borderRadius: 4,
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: (loading || (!selectedUser && !selectedLocationId)) ? 0.6 : 1,
                fontWeight: 500,
              }}
            >
              {loading ? 'Assigning...' : 'Assign'}
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                flex: 1,
                padding: 12,
                background: '#f4f1ee',
                color: 'var(--ink)',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
