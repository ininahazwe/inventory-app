// src/components/MemoAttachments.tsx
// Pièces jointes d'un mémo : liste, téléchargement authentifié et, pour l'auteur
// d'un brouillon / mémo retourné, ajout et retrait. Le fichier part tel quel
// (corps brut) ; le nom voyage dans X-File-Name.
import React, { useRef, useState } from 'react';
import { api, token } from '../lib/apiClient';
import { fmtDate } from '../hooks/useMemos';

type Attachment = { id: number; revision_no: number; original_name: string; mime_type: string; size_bytes: number; uploaded_by_email: string; uploaded_at: string };

const MAX_MB = 10;
const ACCEPT = '.pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx,.csv';
const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', csv: 'text/csv',
  doc: 'application/msword', xls: 'application/vnd.ms-excel',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

const size = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default function MemoAttachments({ memoId, revisionNo, attachments, editable, required, onChanged }: {
  memoId: number; revisionNo: number; attachments: Attachment[]; editable: boolean; required: boolean; onChanged: () => void | Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = attachments.filter(a => a.revision_no === revisionNo);
  const earlier = attachments.filter(a => a.revision_no < revisionNo);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (file.size > MAX_MB * 1024 * 1024) { setError(`This file is larger than ${MAX_MB} MB.`); return; }
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const mime = file.type || MIME_BY_EXT[ext] || '';
    setBusy(true);
    try {
      const res = await fetch(`/api/memos/${memoId}/attachments`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token.get() || ''}`, 'Content-Type': mime, 'X-File-Name': encodeURIComponent(file.name) },
        body: file,
      });
      if (!res.ok) setError((await res.json().catch(() => null))?.error || `Error ${res.status}`);
      else await onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : 'Network error'); }
    setBusy(false);
    if (input.current) input.current.value = '';
  };

  const download = async (a: Attachment) => {
    setError(null);
    const res = await fetch(`/api/memos/${memoId}/attachments/${a.id}`, { headers: { Authorization: `Bearer ${token.get() || ''}` } });
    if (!res.ok) { setError((await res.json().catch(() => null))?.error || `Error ${res.status}`); return; }
    const url = URL.createObjectURL(await res.blob());
    const link = document.createElement('a');
    link.href = url; link.download = a.original_name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const remove = async (a: Attachment) => {
    setBusy(true); setError(null);
    const { error: e } = await api.delete(`/memos/${memoId}/attachments/${a.id}`);
    setBusy(false);
    if (e) setError(e); else await onChanged();
  };

  if (!editable && attachments.length === 0) return null;

  return (
    <div style={{ marginTop: 14, marginBottom: 6 }}>
      <div style={{ fontSize: 13, color: '#666' }}>
        📎 Attachments{required && editable ? ' (required for this type)' : ''}
      </div>
      {current.map(a => (
        <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #f3f3f3', fontSize: 14 }}>
          <button type="button" onClick={() => download(a)} style={{ background: 'none', border: 'none', color: 'var(--brand)', cursor: 'pointer', padding: 0, textAlign: 'left' }}>{a.original_name}</button>
          <span style={{ color: '#999', fontSize: 12 }}>{size(a.size_bytes)} · {a.uploaded_by_email} · {fmtDate(a.uploaded_at)}</span>
          {editable && <button type="button" disabled={busy} onClick={() => remove(a)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer' }}>Remove</button>}
        </div>
      ))}
      {earlier.length > 0 && (
        <div style={{ fontSize: 12, color: '#999', marginTop: 6 }}>
          Earlier revisions: {earlier.map(a => (
            <button key={a.id} type="button" onClick={() => download(a)} style={{ background: 'none', border: 'none', color: '#777', cursor: 'pointer', textDecoration: 'underline', padding: '0 6px 0 0' }}>{a.original_name}</button>
          ))}
        </div>
      )}
      {editable && (
        <div style={{ marginTop: 8 }}>
          <input ref={input} type="file" accept={ACCEPT} disabled={busy} onChange={e => upload(e.target.files?.[0])} />
          <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>PDF, image, Word, Excel or CSV — up to {MAX_MB} MB.</div>
        </div>
      )}
      {error && <div style={{ marginTop: 6, padding: 8, background: '#f8d7da', color: '#721c24', borderRadius: 4, fontSize: 13 }}>❌ {error}</div>}
    </div>
  );
}
