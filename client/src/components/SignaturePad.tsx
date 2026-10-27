// src/components/SignaturePad.tsx
// Capture de la signature : dessinée au doigt/souris, tapée (rendue en script),
// ou importée depuis une image. Dans les trois cas on produit un PNG transparent
// (≤ 600×200 px, bien en deçà des limites serveur) enregistré et réutilisé ensuite.
import React, { useEffect, useRef, useState } from 'react';
import { memosApi } from '../hooks/useMemos';

const W = 600;
const H = 200;
type Mode = 'draw' | 'type' | 'upload';

const isBlank = (c: HTMLCanvasElement) => {
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return false;
  return true;
};

export default function SignaturePad({ onSaved, onCancel, title = 'Your signature' }: {
  onSaved: () => void; onCancel?: () => void; title?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [mode, setMode] = useState<Mode>('draw');
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ctx = () => ref.current!.getContext('2d')!;
  const clear = () => ctx().clearRect(0, 0, W, H);
  const ink = () => { const c = ctx(); c.strokeStyle = '#111827'; c.fillStyle = '#111827'; c.lineWidth = 3; c.lineCap = 'round'; c.lineJoin = 'round'; return c; };

  useEffect(() => { clear(); setErr(null); }, [mode]);

  // Mode « taper » : on repeint à chaque frappe.
  useEffect(() => {
    if (mode !== 'type') return;
    clear();
    if (!text.trim()) return;
    const c = ink();
    let size = 90;
    c.textBaseline = 'middle';
    do { c.font = `italic ${size}px "Segoe Script","Brush Script MT","Snell Roundhand",cursive`; size -= 4; }
    while (c.measureText(text).width > W - 40 && size > 20);
    c.textAlign = 'center';
    c.fillText(text, W / 2, H / 2);
  }, [text, mode]);

  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  const down = (e: React.PointerEvent) => {
    if (mode !== 'draw') return;
    drawing.current = true; (e.target as Element).setPointerCapture(e.pointerId);
    const c = ink(); const p = pos(e); c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x + 0.1, p.y + 0.1); c.stroke();
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const c = ctx(); const p = pos(e); c.lineTo(p.x, p.y); c.stroke();
  };
  const up = () => { drawing.current = false; };

  const onFile = (f: File | undefined) => {
    if (!f) return;
    setErr(null);
    if (!f.type.startsWith('image/') || f.type === 'image/svg+xml') { setErr('Pick a PNG or JPG image.'); return; }
    const img = new Image();
    const url = URL.createObjectURL(f);
    img.onload = () => {
      clear();
      const k = Math.min((W - 20) / img.width, (H - 20) / img.height, 1);
      const w = img.width * k, h = img.height * k;
      ctx().drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
      URL.revokeObjectURL(url);
    };
    img.onerror = () => { setErr('This image could not be read.'); URL.revokeObjectURL(url); };
    img.src = url;
  };

  const save = async () => {
    const c = ref.current!;
    if (isBlank(c)) { setErr('Draw, type or upload your signature first.'); return; }
    setBusy(true); setErr(null);
    const source = mode === 'draw' ? 'drawn' : mode === 'type' ? 'typed' : 'uploaded';
    const { error } = await memosApi.saveSignature(c.toDataURL('image/png'), source);
    setBusy(false);
    if (error) { setErr(error); return; }
    onSaved();
  };

  const tab = (m: Mode, label: string) => (
    <button key={m} type="button" onClick={() => setMode(m)} style={{
      padding: '5px 12px', borderRadius: 999, fontSize: 13, cursor: 'pointer',
      border: '1px solid ' + (mode === m ? 'var(--brand)' : '#ddd'),
      background: mode === m ? 'var(--brand)' : '#fff', color: mode === m ? '#fff' : '#444',
    }}>{label}</button>
  );

  return (
    <div>
      <strong>{title}</strong>
      <p style={{ fontSize: 13, color: '#666', margin: '4px 0 10px' }}>
        It is saved once and applied, with a timestamp, each time you sign a memo.
      </p>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {tab('draw', 'Draw')}{tab('type', 'Type')}{tab('upload', 'Upload')}
      </div>
      {mode === 'type' && (
        <input type="text" value={text} onChange={e => setText(e.target.value)} placeholder="Type your name"
          style={{ width: '100%', padding: 8, marginBottom: 8, border: '1px solid #ddd', borderRadius: 4, boxSizing: 'border-box' }} />
      )}
      {mode === 'upload' && (
        <input type="file" accept="image/png,image/jpeg" onChange={e => onFile(e.target.files?.[0])} style={{ marginBottom: 8 }} />
      )}
      <canvas ref={ref} width={W} height={H}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
        style={{
          width: '100%', maxWidth: W, aspectRatio: `${W} / ${H}`, touchAction: 'none',
          border: '1px dashed #bbb', borderRadius: 6, background: '#fff', cursor: mode === 'draw' ? 'crosshair' : 'default',
          display: 'block',
        }} />
      {err && <div style={{ marginTop: 8, padding: 8, background: '#f8d7da', color: '#721c24', borderRadius: 4, fontSize: 13 }}>❌ {err}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button type="button" disabled={busy} onClick={save}
          style={{ padding: '8px 16px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
          Save signature
        </button>
        <button type="button" onClick={() => { clear(); setText(''); setErr(null); }}
          style={{ padding: '8px 16px', background: '#f4f1ee', border: 'none', borderRadius: 4, cursor: 'pointer' }}>Clear</button>
        {onCancel && (
          <button type="button" onClick={onCancel}
            style={{ padding: '8px 16px', background: 'transparent', border: 'none', color: '#666', cursor: 'pointer' }}>Cancel</button>
        )}
      </div>
    </div>
  );
}
