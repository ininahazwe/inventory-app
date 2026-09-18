// src/pages/SupplyAdjustFormPage.tsx
// Phase 4d — formulaire d'ajustement, un article à la fois. Remplace la
// modale "Stock Adjustment" (SuppliesList.tsx), qui postait un delta signé
// (direction + quantité) sur l'ancienne route /supply-movements — c'est ce
// modèle qui a permis la saisie d'un mauvais delta pour le Sanitizer le
// 24/08 (-50 au lieu de -2, cf. doc projet). La nouvelle route
// POST /api/supply-adjustments (server/src/routes/supplyAdjustments.ts) élimine
// la classe d'erreur à la racine : on ne saisit plus un delta, on saisit ce
// qu'on a compté, et le serveur calcule l'écart — jamais l'inverse.
//
// Admin/super_admin uniquement, comme l'exige la route serveur (403 sinon).
//
// "source" (colonne supply_adjustments.source, 'count' | 'event') n'est pas
// exposé à l'utilisateur : cet écran traite un article à la fois pour un motif
// ponctuel (perte, casse, péremption, correction, trouvaille), jamais un
// inventaire complet planifié — donc toujours 'event'. 'count' resterait
// pertinent pour un futur écran de comptage physique de tout le catalogue,
// hors périmètre ici.
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/apiClient';
import { todayDateString } from '../lib/dateHelpers';
import { usePermissions } from '../hooks/usePermissions';
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

type Reason = 'loss' | 'breakage' | 'expiry' | 'error' | 'found';

const REASONS: { value: Reason; label: string }[] = [
  { value: 'loss', label: 'Loss' },
  { value: 'breakage', label: 'Breakage' },
  { value: 'expiry', label: 'Expiry' },
  { value: 'error', label: 'Count correction (previous entry was wrong)' },
  { value: 'found', label: 'Found (extra stock discovered)' },
];

export default function SupplyAdjustFormPage() {
  const navigate = useNavigate();
  const { isAdmin, loading: permissionsLoading } = usePermissions();

  useEffect(() => {
    if (!permissionsLoading && !isAdmin) {
      alert('Only admins can adjust stock');
      navigate('/supplies');
    }
  }, [isAdmin, permissionsLoading, navigate]);

  const [items, setItems] = useState<SupplyItemOption[]>([]);
  const [search, setSearch] = useState('');
  const [selectedItem, setSelectedItem] = useState<SupplyItemOption | null>(null);

  const [adjustmentDate, setAdjustmentDate] = useState(todayDateString());
  const [reason, setReason] = useState<Reason | ''>('');
  const [countedQuantity, setCountedQuantity] = useState('');
  const [notes, setNotes] = useState('');

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    loadItems().finally(() => setLoading(false));
  }, []);

  const loadItems = async () => {
    try {
      const { data } = await api.get<SupplyItemOption[]>('/supply-items?active=1');
      if (Array.isArray(data)) setItems(data);
    } catch (err) {
      console.error('Failed to load supply items:', err);
    }
  };

  const filteredItems = useMemo(() => {
    if (!search.trim()) return items;
    const s = search.toLowerCase();
    return items.filter(it => it.name.toLowerCase().includes(s) || it.code.toLowerCase().includes(s));
  }, [items, search]);

  const selectItem = (item: SupplyItemOption) => {
    setSelectedItem(item);
    setSearch(item.name);
    setCountedQuantity('');
    setError(null);
  };

  const clearItem = () => {
    setSelectedItem(null);
    setSearch('');
    setCountedQuantity('');
  };

  // L'écart se calcule et s'affiche avant validation, jamais après (cf. le
  // commentaire de conception dans supplyAdjustments.ts) — c'est le point
  // central de cet écran : l'utilisateur voit ce qu'il s'apprête à déclarer
  // avant de valider, plutôt que de saisir un delta à l'aveugle.
  const variance = useMemo(() => {
    if (!selectedItem || countedQuantity === '') return null;
    const counted = parseInt(countedQuantity, 10);
    if (!Number.isInteger(counted)) return null;
    return counted - selectedItem.qty_on_hand;
  }, [selectedItem, countedQuantity]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!selectedItem) { setError('Select an item.'); return; }
    if (!adjustmentDate) { setError('Date is required.'); return; }
    if (!reason) { setError('Select a reason.'); return; }
    const counted = parseInt(countedQuantity, 10);
    if (countedQuantity === '' || !Number.isInteger(counted) || counted < 0) {
      setError('Enter the quantity you counted (0 or more).');
      return;
    }
    if (variance === 0) {
      setError('Counted quantity matches the current stock — nothing to adjust.');
      return;
    }

    try {
      setSubmitting(true);
      const { data, error: apiError } = await api.post<{ id: number }>('/supply-adjustments', {
        adjustment_date: adjustmentDate,
        source: 'event',
        reason,
        lines: [{ item_id: selectedItem.id, counted_quantity: counted, notes: notes || undefined }],
      });

      if (apiError) throw new Error(apiError);
      if (!data?.id) throw new Error('Failed to record the adjustment');

      setSuccess(true);
      setTimeout(() => navigate('/supplies'), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record the adjustment');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || permissionsLoading) {
    return (
      <Layout>
        <div style={{ padding: 20, textAlign: 'center' }}>Loading…</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: 20 }}>
        <h1>Adjust Stock</h1>
        <p style={{ color: '#666', marginTop: -8, marginBottom: 20, fontSize: 14 }}>
          For a loss, breakage, expiry, or a miscount you need to correct. Enter what you actually counted — the variance is calculated for you.
        </p>

        {success && (
          <div style={{ padding: 12, margin: '12px 0', background: '#d4edda', color: '#155724', borderRadius: 4 }}>
            ✅ Adjustment recorded! Redirecting…
          </div>
        )}
        {error && (
          <div style={{ padding: 12, margin: '12px 0', background: '#f8d7da', color: '#721c24', borderRadius: 4 }}>
            ❌ {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 20 }}>
            <label>
              <strong>Item *</strong>
              <div style={{ position: 'relative', marginTop: 8 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    placeholder="Search by name or code…"
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); if (!e.target.value) setSelectedItem(null); }}
                    disabled={!!selectedItem}
                    style={{ flex: 1, padding: 8, border: '1px solid #ddd', borderRadius: 4, boxSizing: 'border-box', background: selectedItem ? '#f4f1ee' : 'white' }}
                  />
                  {selectedItem && (
                    <button type="button" onClick={clearItem} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888', fontSize: 18 }} title="Change item">×</button>
                  )}
                </div>
                {!selectedItem && search.trim() && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1px solid #ddd', borderTop: 'none', borderRadius: '0 0 4px 4px', maxHeight: 240, overflowY: 'auto', zIndex: 10, boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
                    {filteredItems.length === 0 && (
                      <div style={{ padding: 12, color: '#999', fontSize: 14 }}>No items match your search.</div>
                    )}
                    {filteredItems.map(item => (
                      <div
                        key={item.id}
                        onMouseDown={() => selectItem(item)}
                        style={{ padding: '8px 12px', cursor: 'pointer', borderTop: '1px solid #f4f1ee', fontSize: 14, display: 'flex', justifyContent: 'space-between' }}
                      >
                        <span><strong>{item.name}</strong> <span style={{ color: '#999' }}>{item.code}</span></span>
                        <span style={{ color: '#666' }}>{item.qty_on_hand} {item.base_unit}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </label>
          </div>

          {selectedItem && (
            <div style={{ padding: 12, marginBottom: 20, background: '#f4f1ee', borderRadius: 4, fontSize: 14 }}>
              Current system stock for <strong>{selectedItem.name}</strong>: {selectedItem.qty_on_hand} {selectedItem.base_unit}
            </div>
          )}

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
            <label style={{ flex: '1 1 200px' }}>
              <strong>Reason *</strong>
              <select
                value={reason}
                onChange={e => setReason(e.target.value as Reason)}
                style={{ width: '100%', padding: 8, marginTop: 8, border: '1px solid #ddd', borderRadius: 4, boxSizing: 'border-box' }}
              >
                <option value="">— Select a reason —</option>
                {REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </label>
            <label style={{ flex: '1 1 160px' }}>
              <strong>Date *</strong>
              <input
                type="date"
                value={adjustmentDate}
                onChange={e => setAdjustmentDate(e.target.value)}
                style={{ width: '100%', padding: 8, marginTop: 8, border: '1px solid #ddd', borderRadius: 4, boxSizing: 'border-box' }}
              />
            </label>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label>
              <strong>Counted quantity *</strong>
              <input
                type="number"
                min="0"
                placeholder={selectedItem ? `Current: ${selectedItem.qty_on_hand}` : '0'}
                value={countedQuantity}
                onChange={e => setCountedQuantity(e.target.value)}
                disabled={!selectedItem}
                style={{ width: '100%', padding: 8, marginTop: 8, border: '1px solid #ddd', borderRadius: 4, boxSizing: 'border-box' }}
              />
            </label>
          </div>

          {variance !== null && (
            <div
              style={{
                padding: 12,
                marginBottom: 20,
                borderRadius: 4,
                fontSize: 14,
                fontWeight: 600,
                background: variance === 0 ? '#f4f1ee' : variance > 0 ? '#d4edda' : '#f8d7da',
                color: variance === 0 ? '#666' : variance > 0 ? '#155724' : '#721c24',
              }}
            >
              Variance: {variance > 0 ? '+' : ''}{variance} {selectedItem?.base_unit}
              {variance === 0 && ' — matches current stock, nothing to adjust'}
            </div>
          )}

          <div style={{ marginBottom: 20 }}>
            <label>
              <strong>Notes</strong>
              <input
                type="text"
                placeholder="e.g., 2 broken during move (optional)"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                style={{ width: '100%', padding: 8, marginTop: 8, border: '1px solid #ddd', borderRadius: 4, boxSizing: 'border-box' }}
              />
            </label>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" disabled={submitting} style={{ flex: 1, padding: 12, background: '#b45309', color: 'white', border: 'none', borderRadius: 4, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.6 : 1 }}>
              {submitting ? 'Recording…' : 'Save Adjustment'}
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
