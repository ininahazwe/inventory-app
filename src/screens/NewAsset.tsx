// src/screens/NewAsset.tsx
import { useState } from 'react';
import { api } from '../lib/apiClient';
import Autocomplete from '../components/Autocomplete';

type Props = { onCreated?: () => void; onCancel?: () => void };

export default function NewAsset({ onCreated, onCancel }: Props) {
  const [label, setLabel]               = useState('');
  const [serial, setSerial]             = useState('');
  const [categoryName, setCategoryName] = useState('');
  const [purchasedAt, setPurchasedAt]   = useState('');
  const [purchasePrice, setPurchasePrice] = useState<string>('');
  const [supplier, setSupplier]         = useState('');
  const [warrantyEnd, setWarrantyEnd]   = useState('');
  const [notes, setNotes]               = useState('');
  const [funder, setFunder]             = useState('');
  const [saving, setSaving]             = useState(false);
  const [err, setErr]                   = useState<string | null>(null);

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setSaving(true);
    try {
      if (!label.trim()) throw new Error('Le libellé est obligatoire.');
      const category_id = await getOrCreateCategoryId(categoryName);
      const { data: inserted, error } = await api.post<{ id: number }>('/assets', {
        label: label.trim(), serial_no: serial.trim() || null, category_id,
        purchased_at: purchasedAt || null,
        purchase_price: purchasePrice ? Number(purchasePrice) : null,
        supplier: supplier.trim() || null, funder: funder || null,
        warranty_end: warrantyEnd || null, notes: notes.trim() || null,
      });
      if (error) throw new Error(error);
      if (!inserted?.id) throw new Error('ID non retourné');
      setLabel(''); setSerial(''); setCategoryName(''); setPurchasedAt('');
      setPurchasePrice(''); setSupplier(''); setFunder(''); setWarrantyEnd(''); setNotes('');
      onCreated?.();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Erreur lors de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="form-grid">
      <div className="span-2"><label className="label">Label *</label><input className="field" value={label} onChange={e => setLabel(e.target.value)} required /></div>
      <div className="span-2"><label className="label">Catégorie</label><Autocomplete className="field" value={categoryName} onChange={setCategoryName} fetchOptions={fetchCategoryOptions} placeholder="Chercher/ajouter…" /></div>
      <div><label className="label">Numéro de série</label><input className="field" value={serial} onChange={e => setSerial(e.target.value)} placeholder="SN…" /></div>
      <div><label className="label">Prix d'achat</label><input className="field" type="number" step="0.01" min="0" value={purchasePrice} onChange={e => setPurchasePrice(e.target.value)} placeholder="0.00" /></div>
      <div><label className="label">Date d'achat</label><input className="field" type="date" value={purchasedAt} onChange={e => setPurchasedAt(e.target.value)} /></div>
      <div><label className="label">Fin de garantie</label><input className="field" type="date" value={warrantyEnd} onChange={e => setWarrantyEnd(e.target.value)} /></div>
      <div className="span-2"><label className="label">Bailleur (optionnel)</label><input className="field" value={funder} onChange={e => setFunder(e.target.value)} placeholder="Ex : EU" /></div>
      <div className="span-2"><label className="label">Fournisseur</label><input className="field" value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="Ex : ABC Ltd." /></div>
      <div className="span-2"><label className="label">Notes</label><textarea className="field" rows={3} value={notes} onChange={e => setNotes(e.target.value)} /></div>
      {err && <p className="span-2" style={{ color: 'crimson' }}>{err}</p>}
      <div className="span-2 modal-actions">
        {onCancel && <button type="button" className="pill pill--muted" onClick={onCancel}>Annuler</button>}
        <button className="pill" disabled={saving}>{saving ? 'Enregistrement…' : 'Créer'}</button>
      </div>
    </form>
  );
}
