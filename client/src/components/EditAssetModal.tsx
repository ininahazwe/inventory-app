// src/components/EditAssetModal.tsx
import React from "react";
import Modal from './Modal';
import Autocomplete from './Autocomplete';
import { useState } from 'react';
import { api } from '../lib/apiClient';

export function EditAssetModal({ open, onClose, asset, onSaved }: { open: boolean; onClose: () => void; asset: any; onSaved: () => Promise<void> | void; }) {
  // Helper: convert any date format to YYYY-MM-DD for input[type="date"]
  const normalizeDate = (dateStr: string | null | undefined): string => {
    if (!dateStr) return '';
    // If it's already YYYY-MM-DD, return as-is
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
    // If it has timestamp (YYYY-MM-DDTHH:mm:ss), extract just the date part
    if (dateStr.includes('T')) return dateStr.split('T')[0];
    // Otherwise try to parse and format
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return '';
      return d.toISOString().split('T')[0];
    } catch {
      return '';
    }
  };

  const [edLabel, setEdLabel]               = useState(asset?.label ?? '');
  const [edSerial, setEdSerial]             = useState(asset?.serial_no ?? '');
  const [edCategoryName, setEdCategoryName] = useState(asset?.category_name ?? '');
  const [edPurchasedAt, setEdPurchasedAt]   = useState(() => normalizeDate(asset?.purchased_at));
  const [edPrice, setEdPrice]               = useState<string>(asset?.purchase_price != null ? String(asset.purchase_price) : '');
  const [edSupplier, setEdSupplier]         = useState(asset?.supplier ?? '');
  const [edFunder, setEdFunder]             = useState(asset?.funder ?? '');
  const [edWarrantyEnd, setEdWarrantyEnd]   = useState(() => normalizeDate(asset?.warranty_end));
  const [edNotes, setEdNotes]               = useState(asset?.notes ?? '');
  const [saving, setSaving]                 = useState(false);
  const [errMsg, setErrMsg]                 = useState<string | null>(null);

  async function fetchCategoryOptions(q: string) {
    const { data } = await api.get<{ name: string }[]>(`/categories${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    return (data ?? []).map(d => d.name);
  }

  async function getOrCreateCategoryId(name: string): Promise<number | null> {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const { data, error } = await api.post<{ id: number }>('/categories', { name: trimmed });
    if (error) throw new Error(error);
    return data?.id ?? null;
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!asset) return;
    setSaving(true);
    setErrMsg(null);

    try {
      // Validate label
      if (!edLabel.trim()) {
        throw new Error('Label requis');
      }

      // Get or create category
      const category_id = await getOrCreateCategoryId(edCategoryName);

      // Parse price with validation
      let priceNum: number | null = null;
      if (edPrice.trim() !== '') {
        const normalized = edPrice.replace(',', '.');
        priceNum = parseFloat(normalized);
        if (isNaN(priceNum)) {
          throw new Error('Prix invalide');
        }
        priceNum = parseFloat(priceNum.toFixed(2));
      }

      // Make API call
      const { error } = await api.put(`/assets/${asset.id}`, {
        label: edLabel.trim(),
        serial_no: edSerial.trim() || null,
        category_id,
        purchased_at: edPurchasedAt || null,
        purchase_price: priceNum,
        supplier: edSupplier.trim() || null,
        funder: edFunder.trim() || null,
        warranty_end: edWarrantyEnd || null,
        notes: edNotes.trim() || null
      });

      if (error) throw new Error(error);

      onClose();
      await onSaved();
    } catch (err: unknown) {
      setErrMsg(err instanceof Error ? err.message : 'Erreur de sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Edit: ${asset?.label ?? 'Asset'}`}>
      <form onSubmit={onSubmit} className="form-grid">
        <div className="span-2">
          <label className="label">Label *</label>
          <input
            className="field"
            value={edLabel}
            onChange={e => setEdLabel(e.target.value)}
            required
          />
        </div>

        <div className="span-2">
          <label className="label">Category</label>
          <Autocomplete
            className="field"
            value={edCategoryName}
            onChange={setEdCategoryName}
            fetchOptions={fetchCategoryOptions}
            placeholder="Search/add…"
          />
        </div>

        <div>
          <label className="label">Serial number</label>
          <input
            className="field"
            value={edSerial}
            onChange={e => setEdSerial(e.target.value)}
            placeholder="SN…"
          />
        </div>

        <div>
          <label className="label">Purchase price</label>
          <input
            className="field"
            type="text"
            inputMode="decimal"
            value={edPrice}
            onChange={e => setEdPrice(e.target.value)}
            placeholder="0.00"
          />
        </div>

        <div>
          <label className="label">Purchase date</label>
          <input
            className="field"
            type="date"
            value={edPurchasedAt}
            onChange={e => setEdPurchasedAt(e.target.value)}
          />
        </div>

        <div>
          <label className="label">Warranty end</label>
          <input
            className="field"
            type="date"
            value={edWarrantyEnd}
            onChange={e => setEdWarrantyEnd(e.target.value)}
          />
        </div>

        <div className="span-2">
          <label className="label">Supplier</label>
          <input
            className="field"
            value={edSupplier}
            onChange={e => setEdSupplier(e.target.value)}
            placeholder="e.g., ABC Ltd."
          />
        </div>

        <div className="span-2">
          <label className="label">Funder</label>
          <input
            className="field"
            value={edFunder}
            onChange={e => setEdFunder(e.target.value)}
            placeholder="e.g., Donor name"
          />
        </div>

        <div className="span-2">
          <label className="label">Notes</label>
          <textarea
            className="field"
            rows={3}
            value={edNotes}
            onChange={e => setEdNotes(e.target.value)}
          />
        </div>

        {errMsg && <p className="span-2" style={{ color: 'crimson' }}>{errMsg}</p>}

        <div className="span-2 modal-actions">
          <button type="button" className="pill pill--muted" onClick={onClose}>
            Cancel
          </button>
          <button className="pill" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
