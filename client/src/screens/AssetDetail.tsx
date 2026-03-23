// src/screens/AssetDetail.tsx
import React from "react";
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, type Variants } from 'framer-motion';
import { api, rpc, token } from '../lib/apiClient';
import { usePermissions } from '../hooks/usePermissions';
import Modal from '../components/Modal';
import Autocomplete from '../components/Autocomplete';
import AssignAsset from './AssignAsset';
import LifecycleModal from '../components/LifecycleModal';
import AuditLog from '../components/AuditLog';
import PublicAssetCard from './PublicAssetCard';
import { IncidentForm } from '../components/IncidentForm';

type Asset = { id: number; label: string; category_id: number | null; category_name: string | null; serial_no: string | null; status: 'in_stock' | 'assigned' | 'repair' | 'retired'; purchased_at: string | null; purchase_price: number | null; supplier: string | null; funder: string | null; warranty_end: string | null; qr_slug: string | null; notes: string | null; created_at: string; };
type LastAssignment = { asset_id: number; assignment_id: number | null; assignee_name: string | null; assignee_email: string | null; assigned_at: string | null; returned_at: string | null; status: 'active' | 'returned' | null; };
type LifeEvent = { event_id: number; event_type: string; event_at: string; notes: string | null; actor_uid: string | null; repair_cost?: number | null; };
type LifecycleAction = 'repair' | 'exit_repair' | 'retire';

export default function AssetDetail() {
  const { id } = useParams();
  const assetId = Number(id);
  const navigate = useNavigate();
  const { isAdmin } = usePermissions();

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authChecked, setAuthChecked]         = useState(false);
  const [asset, setAsset]                     = useState<Asset | null>(null);
  const [last, setLast]                       = useState<LastAssignment | null>(null);
  const [timeline, setTimeline]               = useState<LifeEvent[]>([]);
  const [loading, setLoading]                 = useState(true);
  const [err, setErr]                         = useState<string | null>(null);
  const [busy, setBusy]                       = useState(false);

  const [lifecycleModalOpen, setLifecycleModalOpen]   = useState(false);
  const [currentLifecycleAction, setCurrentLifecycleAction] = useState<LifecycleAction | null>(null);
  const [assignOpen, setAssignOpen]                   = useState(false);
  const [returnOpen, setReturnOpen]                   = useState(false);
  const [editOpen, setEditOpen]                       = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen]     = useState(false);
  const [showIncidentForm, setShowIncidentForm]       = useState(false);

  const [edLabel, setEdLabel]               = useState('');
  const [edSerial, setEdSerial]             = useState('');
  const [edCategoryName, setEdCategoryName] = useState('');
  const [edPurchasedAt, setEdPurchasedAt]   = useState('');
  const [edPrice, setEdPrice]               = useState<string>('');
  const [edSupplier, setEdSupplier]         = useState('');
  const [edFunder, setEdFunder]             = useState('');
  const [edWarrantyEnd, setEdWarrantyEnd]   = useState('');
  const [edNotes, setEdNotes]               = useState('');
  const [savingEdit, setSavingEdit]         = useState(false);
  const [errEdit, setErrEdit]               = useState<string | null>(null);

  const sweep: Variants = { initial: { y: 40, opacity: 0 }, animate: { y: 0, opacity: 1, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } }, exit: { y: 20, opacity: 0, transition: { duration: 0.24, ease: 'easeInOut' } } };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') navigate('/'); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [navigate]);

  useEffect(() => {
    setIsAuthenticated(!!token.get());
    setAuthChecked(true);
  }, []);

  const siteUrl = import.meta.env.VITE_SITE_URL || window.location.origin;
  const qrDataUrl = useMemo(() => { if (!asset) return ''; const slug = asset.qr_slug || `asset/${asset.id}`; return `${siteUrl}/${slug}`; }, [asset, siteUrl]);
  const qrImg     = useMemo(() => { if (!qrDataUrl) return ''; return `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrDataUrl)}`; }, [qrDataUrl]);
  const warrantyDaysLeft = useMemo(() => { if (!asset?.warranty_end) return null; const end = new Date(asset.warranty_end + 'T00:00:00'); const ms = end.getTime() - new Date(new Date().toDateString()).getTime(); return Math.floor(ms / 86400000); }, [asset?.warranty_end]);

  const load = async () => {
    setErr(null);
    const { data: a, error: ea } = await api.get<Asset>(`/assets/${assetId}`);
    if (ea) { setErr(ea); return; }
    setAsset(a);
    const { data: la } = await api.get<LastAssignment>(`/assets/${assetId}/last-assignment`);
    setLast(la ?? null);
    const { data: tl } = await api.get<LifeEvent[]>(`/assets/${assetId}/timeline`);
    setTimeline(tl ?? []);
  };

  useEffect(() => { (async () => { setLoading(true); await load(); setLoading(false); })(); }, [assetId]);

  const openLifecycleModal = (action: LifecycleAction) => { setCurrentLifecycleAction(action); setLifecycleModalOpen(true); };
  const closeLifecycleModal = () => { setLifecycleModalOpen(false); setCurrentLifecycleAction(null); };

  const handleLifecycleAction = async (data: { notes?: string; cost?: number }) => {
    if (!currentLifecycleAction) return;
    setBusy(true); setErr(null);
    const rpcMap = { repair: 'send_to_repair', exit_repair: 'exit_repair', retire: 'retire_asset' };
    const params: Record<string, unknown> = { p_asset_id: assetId, p_notes: data.notes || null };
    if (currentLifecycleAction === 'exit_repair') params.p_cost = data.cost || null;
    const { error } = await rpc(rpcMap[currentLifecycleAction], params);
    setBusy(false);
    if (error) throw new Error(error);
    closeLifecycleModal(); await load();
  };

  const returnAsset = async () => {
    setBusy(true);
    const { error } = await rpc('return_asset', { p_asset_id: assetId });
    if (error) setErr(`Erreur : ${error}`);
    else await load();
    setBusy(false);
  };

  const deleteAsset = async () => {
    setBusy(true); setErr(null);
    const { error } = await api.delete(`/assets/${assetId}`);
    setBusy(false);
    if (error) { setErr(`Erreur : ${error}`); return; }
    setDeleteConfirmOpen(false); navigate('/');
  };

  const openEdit = () => {
    if (!asset) return;
    setEdLabel(asset.label); setEdSerial(asset.serial_no ?? ''); setEdCategoryName(asset.category_name ?? '');
    setEdPurchasedAt(asset.purchased_at ?? ''); setEdPrice(asset.purchase_price != null ? String(asset.purchase_price) : '');
    setEdSupplier(asset.supplier ?? ''); setEdFunder(asset.funder ?? ''); setEdWarrantyEnd(asset.warranty_end ?? '');
    setEdNotes(asset.notes ?? ''); setErrEdit(null); setEditOpen(true);
  };

  async function fetchCategoryOptions(q: string) {
    const { data } = await api.get<{ name: string }[]>(`/categories${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    return (data ?? []).map(d => d.name);
  }

  async function getOrCreateCategoryId(name: string): Promise<number | null> {
    const trimmed = name.trim(); if (!trimmed) return null;
    const { data, error } = await api.post<{ id: number }>('/categories', { name: trimmed });
    if (error) throw new Error(error);
    return data?.id ?? null;
  }

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!asset) return;
    setSavingEdit(true); setErrEdit(null);
    try {
      if (!edLabel.trim()) throw new Error('Label requis');
      const category_id = await getOrCreateCategoryId(edCategoryName);
      const priceNum = edPrice.trim() === '' ? null : Number.isNaN(Number(edPrice.replace(',', '.'))) ? (() => { throw new Error('Prix invalide'); })() : Number((+edPrice.replace(',', '.')).toFixed(2));
      const { error } = await api.put(`/assets/${asset.id}`, { label: edLabel.trim(), serial_no: edSerial.trim() || null, category_id, purchased_at: edPurchasedAt || null, purchase_price: priceNum, supplier: edSupplier.trim() || null, funder: edFunder.trim() || null, warranty_end: edWarrantyEnd || null, notes: edNotes.trim() || null });
      if (error) throw new Error(error);
      setEditOpen(false); await load();
    } catch (e: unknown) { setErrEdit(e instanceof Error ? e.message : 'Erreur'); }
    finally { setSavingEdit(false); }
  };

  if (!authChecked) return <main className="shell"><div className="shell-inner"><p style={{ padding: 24 }}>Vérification…</p></div></main>;
  if (!isAuthenticated) return <PublicAssetCard />;
  if (loading) return <main className="shell"><div className="shell-inner"><p style={{ padding: 24 }}>Loading…</p></div></main>;
  if (!asset) return <main className="shell"><div className="shell-inner"><p style={{ padding: 24 }}>Asset not found</p>{err && <p style={{ padding: 24, color: 'crimson' }}>{err}</p>}</div></main>;

  return (
    <motion.main className="shell" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8 }}>
      <div className="shell-inner">
        <button aria-label="Close" onClick={() => navigate('/')} style={{ position: 'absolute', top: 0, right: 0, width: 36, height: 36, borderRadius: 999, border: '1px solid var(--line)', background: '#fff', color: 'var(--brand)', fontSize: 24, lineHeight: 1, display: 'grid', placeItems: 'center', cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,.06)', zIndex: 3 }}>×</button>

        <motion.div className="shell-body" variants={sweep} initial="initial" animate="animate" exit="exit">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: 48 }}>
            <h2 style={{ margin: 0 }}>{asset.label}</h2>
            <span style={{ padding: '6px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, border: '1px solid var(--line)', color: asset.status === 'assigned' || asset.status === 'repair' ? '#fff' : 'var(--ink)', background: asset.status === 'assigned' ? 'var(--brand)' : asset.status === 'repair' ? '#b98b46' : asset.status === 'retired' ? '#eee' : '#f4f1ee' }}>{asset.status}</span>
          </div>

          <section className="infos">
            <div className="presentation">
              <Info label="Serial number" value={asset.serial_no || '—'} />
              <Info label="Category" value={asset.category_name || '—'} />
              <Info label="Purchase date" value={asset.purchased_at || '—'} />
              <Info label="Purchase price" value={asset.purchase_price != null ? asset.purchase_price.toFixed(2) : '—'} />
              <Info label="Supplier" value={asset.supplier || '—'} />
              <Info label="Warranty end" value={asset.warranty_end ? `${asset.warranty_end}${typeof warrantyDaysLeft === 'number' ? ` — ${warrantyDaysLeft >= 0 ? `${warrantyDaysLeft} days left` : `${Math.abs(warrantyDaysLeft)} days overdue`}` : ''}` : '—'} />
              <Info label="Funder" value={asset.funder || '—'} />
              {asset.notes && <Info className="span-2" label="Notes" value={asset.notes} />}
            </div>

            <div>
              <div className="qr-section">
                <img src={qrImg} alt="QR" width={180} height={180} />
                <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                  <a href={qrImg} download={`asset-${asset.id}-qr.png`} className="pill" style={{ textDecoration: 'none' }}>Download QR</a>
                </div>
              </div>
            </div>

            <div>
              {last?.assignment_id ? (
                <div style={{ display: 'grid', gap: 4 }}>
                  <div>{last.status === 'active' ? 'Assigned to ' : 'Last assignee'} : <strong>{last.assignee_name ?? '—'}</strong>{last.assignee_email ? ` (${last.assignee_email})` : ''}</div>
                  <small style={{ color: 'var(--muted)' }}>{last.assigned_at ? `since ${last.assigned_at}` : ''}{last.returned_at ? ` — returned on ${last.returned_at}` : ''}</small>
                </div>
              ) : <div>No assignments</div>}
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                {asset.status !== 'assigned' ? <button className="pill" onClick={() => setAssignOpen(true)} disabled={busy}>{busy ? '…' : 'Assign'}</button> : <button className="pill" onClick={() => setReturnOpen(true)} disabled={busy}>{busy ? '…' : 'Mark as Returned'}</button>}
              </div>
            </div>
          </section>

          {asset.status !== 'retired' && (
            <section style={{ borderTop: '1px solid var(--line)', margin: '20px 6px' }}>
              <h3 style={{ margin: '8px 0' }}>Lifecycle</h3>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {asset.status !== 'repair' && <button className="pill" onClick={() => openLifecycleModal('repair')} disabled={busy}>{busy ? '…' : 'Send for repair'}</button>}
                {asset.status === 'repair' && <button className="pill" onClick={() => openLifecycleModal('exit_repair')} disabled={busy}>{busy ? '…' : 'Return from repair'}</button>}
                <button className="pill" onClick={() => openLifecycleModal('retire')} disabled={busy} style={{ backgroundColor: '#dc3545', color: 'white' }}>{busy ? '…' : 'Retire permanently'}</button>
              </div>
            </section>
          )}

          <section style={{ borderTop: '1px solid var(--line)', margin: '20px 6px' }}>
            <h3 style={{ margin: '8px 0' }}>Activity log</h3>
            {timeline.length === 0 ? <p style={{ color: 'var(--muted)' }}>No events</p> : (
              <ul style={{ margin: 0, paddingLeft: 16 }} className="journal">
                {timeline.map(ev => (
                  <li key={ev.event_id}><code>{new Date(ev.event_at).toLocaleString()}</code> — <strong>{ev.event_type}</strong>{ev.notes ? ` — ${ev.notes}` : ''}{ev.event_type === 'maintenance' && ev.repair_cost != null ? ` — coût : ${ev.repair_cost.toFixed(2)}` : ''}</li>
                ))}
              </ul>
            )}
          </section>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button className="pill" onClick={() => setShowIncidentForm(true)} style={{ background: '#b98b46' }}>📋 Report an incident</button>
            <button className="pill" onClick={openEdit} disabled={busy}>{busy ? '…' : 'Edit'}</button>
            {isAdmin && <button className="pill" style={{ background: '#dc3545', color: 'white' }} onClick={() => setDeleteConfirmOpen(true)} disabled={busy}>{busy ? '…' : 'Delete'}</button>}
          </div>

          {err && <p style={{ color: 'crimson', marginTop: 16 }}>{err}</p>}

          <Modal open={showIncidentForm} onClose={() => setShowIncidentForm(false)} title="Signaler un incident">
            <IncidentForm assetId={asset.id} assetLabel={asset.label} onCreated={incidentId => { setShowIncidentForm(false); navigate(`/incidents/${incidentId}`); }} onCancel={() => setShowIncidentForm(false)} />
          </Modal>
        </motion.div>

        <LifecycleModal open={lifecycleModalOpen} onClose={closeLifecycleModal} action={currentLifecycleAction} assetLabel={asset.label} onConfirm={handleLifecycleAction} busy={busy} />

        <Modal open={assignOpen} onClose={() => setAssignOpen(false)} title={`Assign: ${asset.label}`}>
          <AssignAsset assetId={asset.id} onDone={async () => { setAssignOpen(false); await load(); }} />
        </Modal>

        <Modal open={returnOpen} onClose={() => setReturnOpen(false)} title={`Return: ${asset.label}`}>
          <p>Confirm return of this asset to stock?</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="pill" style={{ background: '#bbb' }} onClick={() => setReturnOpen(false)} type="button" disabled={busy}>Cancel</button>
            <button className="pill" onClick={async () => { await returnAsset(); setReturnOpen(false); }} type="button" disabled={busy}>{busy ? '…' : 'Confirm'}</button>
          </div>
        </Modal>

        <Modal open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)} title={`Delete: ${asset.label}`}>
          <div style={{ paddingBottom: 16 }}>
            <p style={{ color: '#c00', fontWeight: 600, marginBottom: 12 }}>⚠️ This action cannot be undone.</p>
            <p>Are you sure you want to permanently delete this asset?</p>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="pill" style={{ background: '#bbb' }} onClick={() => setDeleteConfirmOpen(false)} type="button" disabled={busy}>Cancel</button>
            <button className="pill" style={{ background: '#dc3545', color: 'white' }} onClick={deleteAsset} type="button" disabled={busy}>{busy ? '…' : 'Delete Permanently'}</button>
          </div>
        </Modal>

        <Modal open={editOpen} onClose={() => setEditOpen(false)} title={`Edit: ${asset.label}`}>
          <form onSubmit={saveEdit} className="form-grid">
            <div className="span-2"><label className="label">Label *</label><input className="field" value={edLabel} onChange={e => setEdLabel(e.target.value)} required /></div>
            <div className="span-2"><label className="label">Category</label><Autocomplete className="field" value={edCategoryName} onChange={setEdCategoryName} fetchOptions={fetchCategoryOptions} placeholder="Search/add…" /></div>
            <div><label className="label">Serial Number</label><input className="field" value={edSerial} onChange={e => setEdSerial(e.target.value)} /></div>
            <div><label className="label">Purchase Price</label><input className="field" type="text" inputMode="decimal" value={edPrice} onChange={e => setEdPrice(e.target.value)} placeholder="0.00" /></div>
            <div><label className="label">Purchase Date</label><input className="field" type="date" value={edPurchasedAt} onChange={e => setEdPurchasedAt(e.target.value)} /></div>
            <div><label className="label">Warranty End</label><input className="field" type="date" value={edWarrantyEnd} onChange={e => setEdWarrantyEnd(e.target.value)} /></div>
            <div><label className="label">Supplier</label><input className="field" value={edSupplier} onChange={e => setEdSupplier(e.target.value)} /></div>
            <div><label className="label">Funder</label><input className="field" value={edFunder} onChange={e => setEdFunder(e.target.value)} /></div>
            <div className="span-2"><label className="label">Notes</label><textarea className="field" rows={3} value={edNotes} onChange={e => setEdNotes(e.target.value)} /></div>
            {errEdit && <p className="span-2" style={{ color: 'crimson' }}>{errEdit}</p>}
            <div className="span-2 modal-actions">
              <button type="button" className="pill pill--muted" onClick={() => setEditOpen(false)} disabled={savingEdit}>Cancel</button>
              <button className="pill" disabled={savingEdit}>{savingEdit ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </Modal>
      </div>

      <section style={{ borderTop: '1px solid var(--line)', margin: '20px 6px' }}>
        <h3 style={{ margin: '8px 0' }}>📋 Complete Audit History</h3>
        <AuditLog entityType="asset" entityId={asset.id.toString()} limit={20} />
      </section>
    </motion.main>
  );
}

function Info({ label, value, className }: { label: string; value: string; className?: string }) {
  return <div className={className} style={{ display: 'grid', gap: 4 }}><span style={{ fontWeight: 600 }}>{label}</span><span style={{ color: 'var(--ink)' }}>{value}</span></div>;
}
