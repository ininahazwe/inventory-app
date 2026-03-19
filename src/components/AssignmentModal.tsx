// src/components/AssignmentModal.tsx
import { useState } from 'react';
import { rpc, api } from '../lib/apiClient';
import Modal from './Modal';
import Autocomplete from './Autocomplete';

export function AssignmentModal({ open, onClose, assetId, onDone }: { open: boolean; onClose: () => void; assetId: number; onDone: () => Promise<void> | void; }) {
  const [assignTarget, setAssignTarget] = useState('');
  const [assignNotes, setAssignNotes]   = useState('');
  const [assigning, setAssigning]       = useState(false);

  async function fetchPeopleOptions(q: string) {
    const { data } = await api.get<string[]>(`/assignments/autocomplete/names${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    return data ?? [];
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignTarget.trim()) return;
    setAssigning(true);
    try {
      const { error } = await rpc('assign_asset', { p_asset_id: assetId, p_name: assignTarget.trim(), p_email: null, p_notes: assignNotes || null });
      if (error) throw new Error(error);
      onClose(); setAssignTarget(''); setAssignNotes('');
      await onDone();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Erreur assignation');
    } finally {
      setAssigning(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Attribuer cet équipement">
      <form onSubmit={onSubmit} className="form-grid">
        <div className="span-2">
          <label className="label">Utilisateur</label>
          <Autocomplete className="field" value={assignTarget} onChange={setAssignTarget} fetchOptions={fetchPeopleOptions} placeholder="Nom ou email…" />
        </div>
        <div className="span-2">
          <label className="label">Notes (optionnel)</label>
          <textarea className="field" rows={2} value={assignNotes} onChange={e => setAssignNotes(e.target.value)} />
        </div>
        <div className="span-2 modal-actions">
          <button type="button" className="pill pill--muted" onClick={onClose}>Annuler</button>
          <button className="pill" disabled={assigning}>{assigning ? 'Attribution…' : 'Attribuer'}</button>
        </div>
      </form>
    </Modal>
  );
}
