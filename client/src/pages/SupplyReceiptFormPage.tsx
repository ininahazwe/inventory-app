// src/pages/SupplyReceiptFormPage.tsx
// Phase 4b — remplace CreateSupplyPage / EditSupplyPage.
// Un seul écran : /supplies/create (réception d'un article du catalogue, ou
// d'un article tout nouveau créé à la volée) et /supplies/:id/edit
// (correction d'un lot déjà reçu). Voir server/src/routes/supplyReceipts.ts
// et server/src/routes/supplies.ts (PATCH) pour les contrats exacts.
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/apiClient';
import { todayDateString } from '../lib/dateHelpers';
import Autocomplete from '../components/Autocomplete';
import Layout from '../Layout';

type SupplyItemOption = {
  id: number;
  code: string;
  name: string;
  category_id: number | null;
  base_unit: string;
  is_active: number;
};

type AssignableUser = {
  id: string;
  email: string;
  role?: string;
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: 8,
  marginTop: 8,
  border: '1px solid #ddd',
  borderRadius: 4,
  boxSizing: 'border-box',
};

export default function SupplyReceiptFormPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);

  const [loading, setLoading] = useState(isEdit);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // ---- État mode création ----
  const [items, setItems] = useState<SupplyItemOption[]>([]);
  const [itemId, setItemId] = useState('');
  const [showNewItem, setShowNewItem] = useState(false);
  const [newItem, setNewItem] = useState({
    name: '',
    categoryName: '',
    base_unit: 'unit',
    reorder_point: '',
    target_level: '',
  });
  const [receivedDate, setReceivedDate] = useState(todayDateString());
  const [packSize, setPackSize] = useState('1');
  const [packsReceived, setPacksReceived] = useState('1');
  const [lineTotal, setLineTotal] = useState('');
  const [brand, setBrand] = useState('');

  // ---- État mode édition ----
  const [editData, setEditData] = useState({
    itemName: '',
    purchase_date: '',
    cost: '',
    brand: '',
    quantity: '1',
    receiver_uid: '',
    categoryName: '',
    lowStockThreshold: '',
  });
  const [users, setUsers] = useState<AssignableUser[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<AssignableUser[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);

  useEffect(() => {
    if (isEdit) {
      loadSupply();
      loadUsers();
    } else {
      loadItems();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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
      const { data } = await api.get<AssignableUser[]>('/users/all');
      if (Array.isArray(data)) {
        setUsers(data);
        setFilteredUsers(data);
      }
    } catch (err) {
      console.error('Failed to load users:', err);
    }
  };

  const loadSupply = async () => {
    try {
      const { data: supply, error: apiError } = await api.get<any>(`/supplies/${id}`);
      if (apiError || !supply) {
        setError(apiError || 'Failed to load supply');
        setLoading(false);
        return;
      }
      setEditData({
        itemName: supply.name || '',
        purchase_date: supply.purchase_date && supply.purchase_date.includes('T')
          ? supply.purchase_date.split('T')[0]
          : (supply.purchase_date || ''),
        cost: supply.cost?.toString() || '',
        brand: supply.brand || '',
        quantity: supply.quantity?.toString() || '1',
        receiver_uid: supply.receiver_email || '',
        categoryName: supply.category_name || '',
        lowStockThreshold: supply.low_stock_threshold != null ? String(supply.low_stock_threshold) : '',
      });
      setUserSearch(supply.receiver_email || '');
      setLoading(false);
    } catch (err) {
      console.error('Failed to load supply:', err);
      setError('Failed to load supply');
      setLoading(false);
    }
  };

  // Catégories : mêmes helpers que CreateSupplyPage/EditSupplyPage (type='supply' uniquement).
  async function fetchCategoryOptions(q: string) {
    const query = new URLSearchParams();
    query.append('type', 'supply');
    if (q) query.append('q', q);
    const { data } = await api.get<{ id: number; name: string; type: string }[]>(`/categories?${query.toString()}`);
    return (data ?? []).map(d => d.name);
  }

  async function getOrCreateCategoryId(name: string): Promise<number | null> {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const { data, error } = await api.post<{ id: number }>('/categories', { name: trimmed, type: 'supply' });
    if (error) throw new Error(error);
    return data?.id ?? null;
  }

  const handleSelectUser = (user: AssignableUser) => {
    setEditData(prev => ({ ...prev, receiver_uid: user.email }));
    setUserSearch(user.email);
    setDropdownOpen(false);
  };

  const quantityBase = useMemo(() => {
    const p = parseInt(packSize, 10);
    const n = parseInt(packsReceived, 10);
    if (!Number.isFinite(p) || !Number.isFinite(n) || p <= 0 || n <= 0) return 0;
    return p * n;
  }, [packSize, packsReceived]);

  const unitCostBase = useMemo(() => {
    const total = parseFloat(lineTotal);
    if (!Number.isFinite(total) || quantityBase <= 0) return 0;
    return Math.round((total / quantityBase) * 10000) / 10000;
  }, [lineTotal, quantityBase]);

  const selectedItemUnit = (!showNewItem && items.find(it => String(it.id) === itemId)?.base_unit) || newItem.base_unit || 'unité(s)';

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!showNewItem && !itemId) {
      setError('Choisissez un article, ou créez-en un nouveau.');
      return;
    }
    if (showNewItem && !newItem.name.trim()) {
      setError("Le nom du nouvel article est requis.");
      return;
    }
    if (!receivedDate || !packSize || !packsReceived || !lineTotal) {
      setError('Merci de renseigner tous les champs obligatoires.');
      return;
    }
    if (quantityBase <= 0) {
      setError('Le colisage et le nombre de colis doivent être des nombres positifs.');
      return;
    }

    try {
      setSubmitting(true);

      let resolvedItemId: number;
      if (showNewItem) {
        const category_id = await getOrCreateCategoryId(newItem.categoryName);
        const { data: created, error: createErr } = await api.post<{ id: number }>('/supply-items', {
          name: newItem.name.trim(),
          category_id: category_id || undefined,
          base_unit: newItem.base_unit.trim() || 'unit',
          reorder_point: newItem.reorder_point ? parseInt(newItem.reorder_point, 10) : undefined,
          target_level: newItem.target_level ? parseInt(newItem.target_level, 10) : undefined,
        });
        if (createErr) throw new Error(createErr);
        if (!created?.id) throw new Error("Échec de la création de l'article");
        resolvedItemId = created.id;
      } else {
        resolvedItemId = parseInt(itemId, 10);
      }

      const { data: receipt, error: receiptErr } = await api.post<{ id: number }>('/supply-receipts', {
        received_date: receivedDate,
        lines: [{
          item_id: resolvedItemId,
          pack_size: parseInt(packSize, 10),
          packs_received: parseInt(packsReceived, 10),
          quantity_base: quantityBase,
          line_total: parseFloat(lineTotal),
          unit_cost_base: unitCostBase,
          brand: brand || undefined,
        }],
      });

      if (receiptErr) throw new Error(receiptErr);
      if (!receipt?.id) throw new Error("Échec de l'enregistrement de la réception");

      setSuccess(true);
      setTimeout(() => navigate('/supplies'), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de l'enregistrement");
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!editData.purchase_date || !editData.cost || !editData.quantity || !editData.receiver_uid) {
      setError('Merci de renseigner tous les champs obligatoires.');
      return;
    }

    try {
      setSubmitting(true);

      const payload: Record<string, unknown> = {
        purchase_date: editData.purchase_date,
        cost: parseFloat(editData.cost),
        brand: editData.brand || undefined,
        quantity: parseInt(editData.quantity, 10),
        receiver_uid: editData.receiver_uid,
        low_stock_threshold: editData.lowStockThreshold ? parseInt(editData.lowStockThreshold, 10) : null,
      };
      if (editData.categoryName.trim()) {
        payload.category_id = await getOrCreateCategoryId(editData.categoryName);
      }

      const { data, error: apiError } = await api.patch<any>(`/supplies/${id}`, payload);
      if (apiError || !data) throw new Error(apiError || 'Échec de la mise à jour');

      setSuccess(true);
      setTimeout(() => navigate('/supplies'), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec de la mise à jour');
    } finally {
      setSubmitting(false);
    }
  };

  if (isEdit && loading) {
    return (
      <Layout>
        <div style={{ padding: 20, textAlign: 'center' }}>Chargement…</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div style={{ maxWidth: 600, margin: '0 auto', padding: 20 }}>
        <h1>{isEdit ? 'Modifier la réception' : 'Nouvelle réception'}</h1>

        {success && (
          <div style={{ padding: 12, margin: '12px 0', background: '#d4edda', color: '#155724', borderRadius: 4 }}>
            ✅ {isEdit ? 'Réception mise à jour' : 'Réception enregistrée'} ! Redirection…
          </div>
        )}
        {error && (
          <div style={{ padding: 12, margin: '12px 0', background: '#f8d7da', color: '#721c24', borderRadius: 4 }}>
            ❌ {error}
          </div>
        )}

        {isEdit ? (
          <form onSubmit={handleEditSubmit}>
            <div style={{ marginBottom: 20 }}>
              <strong>Article</strong>
              <div style={{ marginTop: 8, padding: 8, background: '#f4f1ee', borderRadius: 4, color: 'var(--ink)' }}>
                {editData.itemName}
              </div>
              <div style={{ marginTop: 4, fontSize: 12, color: '#666' }}>
                L'article d'un lot déjà reçu ne peut pas être changé ici.
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label>
                <strong>Date d'achat *</strong>
                <input type="date" value={editData.purchase_date} onChange={e => setEditData(prev => ({ ...prev, purchase_date: e.target.value }))} style={inputStyle} />
              </label>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label>
                <strong>Coût total (GH₵) *</strong>
                <input type="number" step="0.01" min="0" value={editData.cost} onChange={e => setEditData(prev => ({ ...prev, cost: e.target.value }))} style={inputStyle} />
              </label>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label>
                <strong>Marque</strong>
                <input type="text" placeholder="ex. IKEA" value={editData.brand} onChange={e => setEditData(prev => ({ ...prev, brand: e.target.value }))} style={inputStyle} />
              </label>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label>
                <strong>Quantité *</strong>
                <input type="number" min="1" value={editData.quantity} onChange={e => setEditData(prev => ({ ...prev, quantity: e.target.value }))} style={inputStyle} />
              </label>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label>
                <strong>Catégorie</strong>
                <Autocomplete
                  value={editData.categoryName}
                  onChange={(value) => setEditData(prev => ({ ...prev, categoryName: value }))}
                  fetchOptions={fetchCategoryOptions}
                  placeholder="Rechercher/ajouter une catégorie…"
                  className="field"
                />
                <div style={{ marginTop: 4, fontSize: 12, color: '#666' }}>
                  Partagée par tous les lots de cet article.
                </div>
              </label>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label>
                <strong>Seuil d'alerte stock bas</strong>
                <input type="number" min="0" placeholder="ex. 5 (laisser vide pour aucune alerte)" value={editData.lowStockThreshold} onChange={e => setEditData(prev => ({ ...prev, lowStockThreshold: e.target.value }))} style={inputStyle} />
              </label>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label>
                <strong>Réceptionnaire *</strong>
                <div style={{ position: 'relative', marginTop: 8 }}>
                  <input
                    type="text"
                    placeholder="Rechercher par email…"
                    value={userSearch}
                    onChange={(e) => { setUserSearch(e.target.value); setDropdownOpen(true); }}
                    onFocus={() => setDropdownOpen(true)}
                    onBlur={() => setTimeout(() => setDropdownOpen(false), 200)}
                    style={{ width: '100%', padding: 8, border: dropdownOpen ? '2px solid var(--brand)' : '1px solid #ddd', borderRadius: 4, boxSizing: 'border-box', transition: 'border-color 0.2s' }}
                  />
                  {dropdownOpen && filteredUsers.length > 0 && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1px solid #ddd', borderTop: 'none', borderRadius: '0 0 4px 4px', maxHeight: 200, overflowY: 'auto', zIndex: 10, boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
                      {filteredUsers.map((user) => (
                        <div
                          key={user.id}
                          onMouseDown={() => handleSelectUser(user)}
                          style={{ padding: 10, borderBottom: '1px solid #eee', cursor: 'pointer', background: editData.receiver_uid === user.email ? '#e3f2fd' : 'white' }}
                        >
                          <strong>{user.email}</strong>
                          {user.role && <span style={{ color: '#666', marginLeft: 8, fontSize: 12 }}>({user.role})</span>}
                        </div>
                      ))}
                    </div>
                  )}
                  {dropdownOpen && userSearch && filteredUsers.length === 0 && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1px solid #ddd', borderTop: 'none', borderRadius: '0 0 4px 4px', padding: 10, color: '#999', zIndex: 10 }}>
                      Aucun utilisateur trouvé
                    </div>
                  )}
                </div>
              </label>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" disabled={submitting} style={{ flex: 1, padding: 12, background: 'var(--brand)', color: 'white', border: 'none', borderRadius: 4, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.6 : 1 }}>
                {submitting ? 'Mise à jour…' : 'Mettre à jour'}
              </button>
              <button type="button" onClick={() => navigate('/supplies')} style={{ flex: 1, padding: 12, background: '#f4f1ee', color: 'var(--ink)', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                Annuler
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleCreateSubmit}>
            <div style={{ marginBottom: 20 }}>
              <strong>Article *</strong>
              {!showNewItem ? (
                <>
                  <select value={itemId} onChange={e => setItemId(e.target.value)} style={inputStyle}>
                    <option value="">— Choisir un article —</option>
                    {items.map(it => (
                      <option key={it.id} value={it.id}>{it.name} ({it.code})</option>
                    ))}
                  </select>
                  <button type="button" onClick={() => setShowNewItem(true)} style={{ marginTop: 8, background: 'none', border: 'none', color: 'var(--brand)', cursor: 'pointer', padding: 0, fontSize: 13 }}>
                    + Créer un nouvel article
                  </button>
                </>
              ) : (
                <div style={{ marginTop: 8, padding: 12, background: '#f9f9f9', border: '1px solid #eee', borderRadius: 4 }}>
                  <div style={{ marginBottom: 12 }}>
                    <label>
                      <strong style={{ fontSize: 13 }}>Nom de l'article *</strong>
                      <input type="text" placeholder="ex. Papier toilette (rouleau)" value={newItem.name} onChange={e => setNewItem(prev => ({ ...prev, name: e.target.value }))} style={inputStyle} />
                    </label>
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label>
                      <strong style={{ fontSize: 13 }}>Catégorie</strong>
                      <Autocomplete
                        value={newItem.categoryName}
                        onChange={(value) => setNewItem(prev => ({ ...prev, categoryName: value }))}
                        fetchOptions={fetchCategoryOptions}
                        placeholder="Rechercher/ajouter une catégorie…"
                        className="field"
                      />
                    </label>
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label>
                      <strong style={{ fontSize: 13 }}>Unité de base</strong>
                      <input type="text" placeholder="unit" value={newItem.base_unit} onChange={e => setNewItem(prev => ({ ...prev, base_unit: e.target.value }))} style={inputStyle} />
                    </label>
                  </div>
                  <div style={{ display: 'flex', gap: 12, marginBottom: 4 }}>
                    <label style={{ flex: 1 }}>
                      <strong style={{ fontSize: 13 }}>Seuil d'alerte</strong>
                      <input type="number" min="0" value={newItem.reorder_point} onChange={e => setNewItem(prev => ({ ...prev, reorder_point: e.target.value }))} style={inputStyle} />
                    </label>
                    <label style={{ flex: 1 }}>
                      <strong style={{ fontSize: 13 }}>Niveau cible</strong>
                      <input type="number" min="0" value={newItem.target_level} onChange={e => setNewItem(prev => ({ ...prev, target_level: e.target.value }))} style={inputStyle} />
                    </label>
                  </div>
                  <button type="button" onClick={() => setShowNewItem(false)} style={{ marginTop: 8, background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: 0, fontSize: 13 }}>
                    ← Choisir un article existant
                  </button>
                </div>
              )}
            </div>

            <div style={{ marginBottom: 20 }}>
              <label>
                <strong>Date de réception *</strong>
                <input type="date" value={receivedDate} onChange={e => setReceivedDate(e.target.value)} style={inputStyle} />
              </label>
            </div>

            <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
              <label style={{ flex: 1 }}>
                <strong>Colisage *</strong>
                <input type="number" min="1" value={packSize} onChange={e => setPackSize(e.target.value)} style={inputStyle} />
                <div style={{ marginTop: 4, fontSize: 12, color: '#666' }}>Unités par colis</div>
              </label>
              <label style={{ flex: 1 }}>
                <strong>Colis reçus *</strong>
                <input type="number" min="1" value={packsReceived} onChange={e => setPacksReceived(e.target.value)} style={inputStyle} />
              </label>
            </div>

            <div style={{ marginBottom: 20, padding: 8, background: '#f4f1ee', borderRadius: 4, fontSize: 13 }}>
              Quantité totale : <strong>{quantityBase || 0}</strong> {selectedItemUnit}
            </div>

            <div style={{ marginBottom: 20 }}>
              <label>
                <strong>Montant de la facture (GH₵) *</strong>
                <input type="number" step="0.01" min="0" placeholder="0.00" value={lineTotal} onChange={e => setLineTotal(e.target.value)} style={inputStyle} />
              </label>
            </div>

            <div style={{ marginBottom: 20, padding: 8, background: '#f4f1ee', borderRadius: 4, fontSize: 13 }}>
              Coût unitaire calculé : <strong>{unitCostBase ? unitCostBase.toFixed(4) : '0.0000'}</strong> GH₵
            </div>

            <div style={{ marginBottom: 20 }}>
              <label>
                <strong>Marque</strong>
                <input type="text" placeholder="ex. IKEA" value={brand} onChange={e => setBrand(e.target.value)} style={inputStyle} />
              </label>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" disabled={submitting} style={{ flex: 1, padding: 12, background: 'var(--brand)', color: 'white', border: 'none', borderRadius: 4, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.6 : 1 }}>
                {submitting ? 'Enregistrement…' : 'Enregistrer la réception'}
              </button>
              <button type="button" onClick={() => navigate('/supplies')} style={{ flex: 1, padding: 12, background: '#f4f1ee', color: 'var(--ink)', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                Annuler
              </button>
            </div>
          </form>
        )}
      </div>
    </Layout>
  );
}
