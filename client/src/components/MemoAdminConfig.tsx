// src/components/MemoAdminConfig.tsx
// Admin Mémos : projets, types de mémo et circuits de validation. Les niveaux sont fixes ;
// on ordonne les pas d'un circuit et on choisit le niveau et le rôle de chacun. Un circuit
// modifié ne s'applique qu'aux mémos soumis ensuite (les mémos en cours gardent le leur).
import React, { useState } from 'react';
import { Spinner } from './MemoSpinner';
import {
  memosApi, type AdminConfig, type AdminProject, type AdminTemplate, type AdminType, type ChainKind, type ChainStepDraft,
} from '../hooks/useMemos';

type Result = { error: string | null };
type Act = (key: string, fn: () => Promise<Result>) => Promise<boolean>;
type Common = { config: AdminConfig; busyKey: string | null; act: Act };

const card: React.CSSProperties = { border: '1px solid #eee', borderRadius: 6, padding: 16, marginBottom: 16, background: '#fff' };
const field: React.CSSProperties = { padding: 8, border: '1px solid #ddd', borderRadius: 4, background: '#fff', boxSizing: 'border-box' };
const primary: React.CSSProperties = { padding: '8px 16px', background: 'var(--brand)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' };
const link = (color = 'var(--brand)'): React.CSSProperties => ({ background: 'none', border: 'none', cursor: 'pointer', color, padding: 0, fontSize: 13 });
const KIND_LABEL: Record<ChainKind, string> = { recommend: 'Recommend', approve: 'Approve', release: 'Release payment' };
const DEFAULT_LABEL: Record<ChainKind, string> = { recommend: 'Recommended for approval', approve: 'Approved', release: 'Funds released' };

// ─── Projets ────────────────────────────────────────────────────────────────

export function ProjectsTab({ config, busyKey, act }: Common) {
  const [form, setForm] = useState({ code: '', title: '', donor: '', default_currency: '' });
  const [editId, setEditId] = useState<number | null>(null);
  const [edit, setEdit] = useState({ title: '', donor: '', default_currency: '' });

  const startEdit = (p: AdminProject) => { setEditId(p.id); setEdit({ title: p.title, donor: p.donor || '', default_currency: p.default_currency || '' }); };

  return (
    <>
      <p style={{ color: '#666', fontSize: 14, marginTop: 0 }}>
        Projects (and donors) a memo can be charged to. A project is never deleted, only deactivated, because memos refer to it; its code cannot change.
      </p>
      <div style={card}>
        <strong>New project</strong>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <input style={{ ...field, flex: '1 1 110px' }} placeholder="Code, e.g. EU-2026" value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} />
          <input style={{ ...field, flex: '3 1 220px' }} placeholder="Title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
          <input style={{ ...field, flex: '2 1 150px' }} placeholder="Donor (optional)" value={form.donor} onChange={e => setForm({ ...form, donor: e.target.value })} />
          <input style={{ ...field, width: 80 }} placeholder="EUR" maxLength={3} value={form.default_currency} onChange={e => setForm({ ...form, default_currency: e.target.value.toUpperCase() })} />
          <button style={primary} disabled={!!busyKey || !form.code.trim() || !form.title.trim()}
            onClick={async () => { if (await act('project-new', () => memosApi.createProject(form))) setForm({ code: '', title: '', donor: '', default_currency: '' }); }}>
            {busyKey === 'project-new' && <Spinner />}Add project
          </button>
        </div>
      </div>

      {config.projects.length === 0 && <div style={{ color: '#999', fontSize: 14 }}>No project yet.</div>}
      {config.projects.map(p => (
        <div key={p.id} style={{ ...card, padding: 12, marginBottom: 8, opacity: p.is_active ? 1 : 0.55 }}>
          {editId === p.id ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <strong style={{ width: 110 }}>{p.code}</strong>
              <input style={{ ...field, flex: '3 1 220px' }} value={edit.title} onChange={e => setEdit({ ...edit, title: e.target.value })} />
              <input style={{ ...field, flex: '2 1 150px' }} placeholder="Donor" value={edit.donor} onChange={e => setEdit({ ...edit, donor: e.target.value })} />
              <input style={{ ...field, width: 80 }} maxLength={3} placeholder="EUR" value={edit.default_currency} onChange={e => setEdit({ ...edit, default_currency: e.target.value.toUpperCase() })} />
              <button style={primary} disabled={!!busyKey || !edit.title.trim()}
                onClick={async () => { if (await act(`project-${p.id}`, () => memosApi.patchProject(p.id, edit))) setEditId(null); }}>
                {busyKey === `project-${p.id}` && <Spinner />}Save
              </button>
              <button style={link('#666')} onClick={() => setEditId(null)}>Cancel</button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: 14 }}>
              <strong style={{ width: 110 }}>{p.code}</strong>
              <span style={{ flex: '3 1 200px' }}>{p.title}{p.donor ? <span style={{ color: '#888' }}> · {p.donor}</span> : null}</span>
              <span style={{ color: '#888', fontSize: 12 }}>{p.default_currency || '—'} · {p.memo_count} memo{p.memo_count === 1 ? '' : 's'}</span>
              <button style={link()} disabled={!!busyKey} onClick={() => startEdit(p)}>Edit</button>
              <button style={link(p.is_active ? '#b91c1c' : '#16a34a')} disabled={!!busyKey}
                onClick={() => act(`project-${p.id}`, () => memosApi.patchProject(p.id, { is_active: !p.is_active }))}>
                {busyKey === `project-${p.id}` && <Spinner color="#666" />}{p.is_active ? 'Deactivate' : 'Reactivate'}
              </button>
            </div>
          )}
        </div>
      ))}
    </>
  );
}

// ─── Éditeur de circuit ─────────────────────────────────────────────────────

function ChainEditor({ config, initial, nameEditable, initialName, saveLabel, busyKey, busyId, onSave, onCancel }: {
  config: AdminConfig; initial: ChainStepDraft[]; nameEditable: boolean; initialName: string; saveLabel: string;
  busyKey: string | null; busyId: string; onSave: (name: string, steps: ChainStepDraft[]) => void; onCancel: () => void;
}) {
  const [steps, setSteps] = useState<ChainStepDraft[]>(initial);
  const [name, setName] = useState(initialName);
  const move = (i: number, d: -1 | 1) => {
    const j = i + d; if (j < 0 || j >= steps.length) return;
    const next = [...steps]; [next[i], next[j]] = [next[j], next[i]]; setSteps(next);
  };
  const set = (i: number, patch: Partial<ChainStepDraft>) => setSteps(steps.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  const hasApprove = steps.some(s => s.kind === 'approve');
  const firstRelease = steps.findIndex(s => s.kind === 'release');
  const releaseLast = firstRelease === -1 || steps.slice(firstRelease).every(s => s.kind === 'release');
  const problem = steps.length === 0 ? 'Add at least one step.'
    : !hasApprove ? 'A chain needs at least one approval step.'
    : !releaseLast ? 'Release steps must come last.'
    : steps.length > 8 ? 'At most 8 steps.' : null;

  return (
    <div style={{ background: '#fafafa', border: '1px solid #eee', borderRadius: 6, padding: 12, marginTop: 10 }}>
      {nameEditable && <input style={{ ...field, width: '100%', marginBottom: 10 }} placeholder="Chain name, e.g. Urgent" value={name} onChange={e => setName(e.target.value)} />}
      <div style={{ fontSize: 13, color: '#666', marginBottom: 6 }}>The author signs first, automatically. Then, in this order:</div>
      {steps.map((s, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
          <span style={{ width: 20, color: '#999' }}>{i + 1}.</span>
          <select style={field} value={s.kind} onChange={e => {
            const kind = e.target.value as ChainKind;
            set(i, { kind, label: !s.label || s.label === DEFAULT_LABEL[s.kind] ? DEFAULT_LABEL[kind] : s.label });
          }}>
            {(Object.keys(KIND_LABEL) as ChainKind[]).map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
          <select style={field} value={s.position_code} onChange={e => set(i, { position_code: e.target.value })}>
            {config.levels.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
          <input style={{ ...field, flex: '1 1 180px' }} value={s.label} placeholder={DEFAULT_LABEL[s.kind]} onChange={e => set(i, { label: e.target.value })} />
          <button style={link('#666')} title="Move up" disabled={i === 0} onClick={() => move(i, -1)}>▲</button>
          <button style={link('#666')} title="Move down" disabled={i === steps.length - 1} onClick={() => move(i, 1)}>▼</button>
          <button style={link('#b91c1c')} title="Remove" onClick={() => setSteps(steps.filter((_, k) => k !== i))}>✕</button>
        </div>
      ))}
      <button style={link()} disabled={steps.length >= 8}
        onClick={() => setSteps([...steps, { kind: 'approve', position_code: config.levels[0]?.code || 'manager', label: DEFAULT_LABEL.approve }])}>+ Add a step</button>
      {problem && <div style={{ color: '#b91c1c', fontSize: 13, marginTop: 8 }}>{problem}</div>}
      <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center' }}>
        <button style={primary} disabled={!!busyKey || !!problem || (nameEditable && !name.trim())} onClick={() => onSave(name, steps)}>
          {busyKey === busyId && <Spinner />}{saveLabel}
        </button>
        <button style={link('#666')} onClick={onCancel}>Cancel</button>
      </div>
      <div style={{ fontSize: 12, color: '#999', marginTop: 8 }}>Applies to memos submitted from now on. Memos already in progress keep the chain they were submitted with.</div>
    </div>
  );
}

const draftOf = (t: AdminTemplate): ChainStepDraft[] => t.steps.map(s => ({ kind: s.kind, position_code: s.position_code, label: s.label }));

// ─── Types de mémo et circuits ──────────────────────────────────────────────

function TypeCard({ type, config, busyKey, act }: Common & { type: AdminType }) {
  const [editChain, setEditChain] = useState<number | 'new' | null>(null);
  const [rename, setRename] = useState<string | null>(null);
  const flag = (col: 'requires_amount' | 'requires_project' | 'requires_attachment', label: string) => (
    <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
      <input type="checkbox" disabled={!!busyKey} checked={!!type[col]} onChange={e => act(`type-${type.id}`, () => memosApi.patchType(type.id, { [col]: e.target.checked }))} />
      {label}
    </label>
  );
  const baseChain = (type.templates.find(t => t.is_default) || type.templates[0]);

  return (
    <div style={{ ...card, opacity: type.is_active ? 1 : 0.6 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
        {rename === null
          ? <h2 style={{ fontSize: 17, margin: 0 }}>{type.name}</h2>
          : <input style={{ ...field, flex: '1 1 200px' }} value={rename} onChange={e => setRename(e.target.value)} />}
        <span style={{ fontSize: 12, color: '#999' }}>{type.code} · {type.memo_count} memo{type.memo_count === 1 ? '' : 's'}{type.is_active ? '' : ' · inactive'}</span>
        <span style={{ flex: 1 }} />
        {rename === null
          ? <button style={link()} disabled={!!busyKey} onClick={() => setRename(type.name)}>Rename</button>
          : <>
              <button style={link()} disabled={!!busyKey || !rename.trim()} onClick={async () => { if (await act(`type-${type.id}`, () => memosApi.patchType(type.id, { name: rename }))) setRename(null); }}>Save</button>
              <button style={link('#666')} onClick={() => setRename(null)}>Cancel</button>
            </>}
        <button style={link(type.is_active ? '#b91c1c' : '#16a34a')} disabled={!!busyKey}
          onClick={() => act(`type-${type.id}`, () => memosApi.patchType(type.id, { is_active: !type.is_active }))}>
          {busyKey === `type-${type.id}` && <Spinner color="#666" />}{type.is_active ? 'Deactivate' : 'Reactivate'}
        </button>
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', margin: '10px 0' }}>
        {flag('requires_amount', 'Amount required')}{flag('requires_project', 'Project required')}{flag('requires_attachment', 'Attachment required')}
      </div>

      {type.templates.map(t => {
        const missing = t.steps.filter(s => s.holders === 0);
        return (
          <div key={t.id} style={{ borderTop: '1px solid #f1f1f1', paddingTop: 10, marginTop: 10, opacity: t.is_active ? 1 : 0.55 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', fontSize: 14 }}>
              <strong>{t.name}</strong>
              {t.is_default ? <span style={{ fontSize: 11, background: '#dcfce7', color: '#166534', padding: '1px 6px', borderRadius: 8 }}>default</span> : null}
              {!t.is_active && <span style={{ fontSize: 11, color: '#999' }}>inactive</span>}
              <span style={{ color: '#888', fontSize: 12 }}>{t.memo_count} memo{t.memo_count === 1 ? '' : 's'}</span>
              <span style={{ flex: 1 }} />
              <button style={link()} disabled={!!busyKey} onClick={() => setEditChain(editChain === t.id ? null : t.id)}>Edit steps</button>
              {t.is_active && !t.is_default && <button style={link()} disabled={!!busyKey} onClick={() => act(`chain-${t.id}`, () => memosApi.patchChain(t.id, { is_default: true }))}>Make default</button>}
              <button style={link(t.is_active ? '#b91c1c' : '#16a34a')} disabled={!!busyKey} onClick={() => act(`chain-${t.id}`, () => memosApi.patchChain(t.id, { is_active: !t.is_active }))}>
                {busyKey === `chain-${t.id}` && <Spinner color="#666" />}{t.is_active ? 'Deactivate' : 'Reactivate'}
              </button>
            </div>
            <div style={{ fontSize: 14, margin: '6px 0', color: '#444' }}>
              Author {'→'} {t.steps.map(s => `${s.position_label} ${s.kind === 'release' ? 'releases' : s.kind === 'approve' ? 'approves' : 'recommends'}`).join(' → ')}
            </div>
            {missing.length > 0 && <div style={{ fontSize: 12, color: '#b91c1c' }}>⚠️ Nobody assigned at: {missing.map(s => s.position_label).join(', ')} — memos on this chain cannot be submitted.</div>}
            {editChain === t.id && (
              <ChainEditor config={config} initial={draftOf(t)} nameEditable={false} initialName={t.name} saveLabel="Save steps"
                busyKey={busyKey} busyId={`chain-steps-${t.id}`}
                onSave={async (_n, steps) => { if (await act(`chain-steps-${t.id}`, () => memosApi.saveChain(t.id, steps))) setEditChain(null); }}
                onCancel={() => setEditChain(null)} />
            )}
          </div>
        );
      })}

      <div style={{ marginTop: 12 }}>
        {editChain === 'new'
          ? <ChainEditor config={config} initial={baseChain ? draftOf(baseChain) : []} nameEditable initialName="" saveLabel="Create chain"
              busyKey={busyKey} busyId={`chain-new-${type.id}`}
              onSave={async (name, steps) => { if (await act(`chain-new-${type.id}`, () => memosApi.createChain(type.id, { name, steps }))) setEditChain(null); }}
              onCancel={() => setEditChain(null)} />
          : <button style={link()} disabled={!!busyKey} onClick={() => setEditChain('new')}>+ Add another chain for this type</button>}
      </div>
    </div>
  );
}

export function TypesTab({ config, busyKey, act }: Common) {
  const [form, setForm] = useState({ code: '', name: '', requires_amount: false, requires_project: false, requires_attachment: false });
  return (
    <>
      <p style={{ color: '#666', fontSize: 14, marginTop: 0 }}>
        Each memo type has one or more approval chains; the author sees the default one and can pick another if there are several.
        Types and chains are never deleted, only deactivated.
      </p>
      {config.types.map(t => <TypeCard key={t.id} type={t} config={config} busyKey={busyKey} act={act} />)}
      <div style={card}>
        <strong>New memo type</strong>
        <div style={{ fontSize: 12, color: '#999', margin: '2px 0 8px' }}>It starts with the chain Manager recommends → Director approves; adjust the steps afterwards.</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input style={{ ...field, flex: '1 1 140px' }} placeholder="code, e.g. travel_request" value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} />
          <input style={{ ...field, flex: '2 1 200px' }} placeholder="Name, e.g. Travel request" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          {([['requires_amount', 'Amount'], ['requires_project', 'Project'], ['requires_attachment', 'Attachment']] as const).map(([k, l]) => (
            <label key={k} style={{ fontSize: 13, display: 'flex', gap: 4, alignItems: 'center' }}>
              <input type="checkbox" checked={form[k]} onChange={e => setForm({ ...form, [k]: e.target.checked })} />{l}
            </label>
          ))}
          <button style={primary} disabled={!!busyKey || !form.code.trim() || !form.name.trim()}
            onClick={async () => { if (await act('type-new', () => memosApi.createType(form))) setForm({ code: '', name: '', requires_amount: false, requires_project: false, requires_attachment: false }); }}>
            {busyKey === 'type-new' && <Spinner />}Add type
          </button>
        </div>
      </div>
    </>
  );
}
