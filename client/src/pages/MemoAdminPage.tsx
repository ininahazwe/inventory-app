// src/pages/MemoAdminPage.tsx
// Admin Mémos, en trois onglets :
//  - Signatories : qui signe à chaque niveau (titulaires et suppléants). Les niveaux sont
//    fixes (agent / manager / director / finance) ; un niveau sans titulaire bloque les soumissions.
//  - Projects : les projets / bailleurs proposés à la rédaction.
//  - Types & chains : les types de mémo et leurs circuits de validation.
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../Layout';
import { SkeletonDetail } from '../components/Skeleton';
import { ProjectsTab, TypesTab } from '../components/MemoAdminConfig';
import { memosApi, type AdminConfig } from '../hooks/useMemos';

type Holder = { id: number; user_email: string; holder_role: 'holder' | 'deputy'; is_active: number };
type Position = { id: number; code: string; label: string; is_active: number; holders: Holder[] };

export default function MemoAdminPage() {
  const [positions, setPositions] = useState<Position[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { email: string; role: 'holder' | 'deputy' }>>({});
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'holders' | 'projects' | 'types'>('holders');
  const [config, setConfig] = useState<AdminConfig | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const loadConfig = useCallback(async () => {
    const { data, error: e } = await memosApi.adminConfig();
    if (e) setError(e); else setConfig(data as AdminConfig);
  }, []);
  // Les onglets Projects et Types lisent la même configuration ; les titulaires (« holders »)
  // alimentent l'avertissement « personne d'assigné » : on recharge tout au changement d'onglet.
  useEffect(() => { if (tab !== 'holders') loadConfig(); }, [tab, loadConfig]);
  const act = async (key: string, fn: () => Promise<{ error: string | null }>): Promise<boolean> => {
    setBusyKey(key); setError(null);
    const { error: e } = await fn();
    if (e) { setBusyKey(null); setError(e); return false; }
    await loadConfig();
    setBusyKey(null);
    return true;
  };

  const load = useCallback(async () => {
    const { data, error: e } = await memosApi.positions();
    if (e) setError(e); else setPositions(data as Position[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (fn: () => Promise<{ error: string | null }>) => {
    setBusy(true); setError(null);
    const { error: e } = await fn();
    setBusy(false);
    if (e) setError(e); else await load();
  };

  if (!positions) return <Layout>{error ? <div style={{ padding: 20 }}>❌ {error}</div> : <SkeletonDetail />}</Layout>;

  return (
    <Layout>
      <div style={{ maxWidth: 860, margin: '0 auto', padding: 20 }}>
        <Link to="/memos" style={{ fontSize: 13, color: '#666' }}>← All memos</Link>
        <h1 style={{ margin: '10px 0 12px' }}>Memo administration</h1>
        <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #eee', marginBottom: 16 }}>
          {([['holders', 'Signatories'], ['projects', 'Projects'], ['types', 'Types & chains']] as const).map(([k, l]) => (
            <button key={k} onClick={() => { setTab(k); setError(null); }}
              style={{ padding: '8px 16px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14,
                       borderBottom: tab === k ? '2px solid var(--brand)' : '2px solid transparent', color: tab === k ? 'var(--brand)' : '#666', fontWeight: tab === k ? 600 : 400 }}>
              {l}
            </button>
          ))}
        </div>
        {tab === 'holders' && (
          <p style={{ color: '#666', fontSize: 14, marginTop: 0 }}>
            Who may recommend, approve or release at each level. Add a person by email (they must already have an account); a deputy acts for the holder.
            The author of a memo can never decide on their own memo. When a level has several managers, the author can choose which one recommends the memo.
            <strong> Memos is open to administrators and to the people listed here, at any level:</strong> add the people who may write memos to the Agent level.
          </p>
        )}
        {error && <div style={{ padding: 12, margin: '12px 0', background: '#f8d7da', color: '#721c24', borderRadius: 4 }}>❌ {error}</div>}

        {tab !== 'holders' && !config && !error && <SkeletonDetail />}
        {tab === 'projects' && config && <ProjectsTab config={config} busyKey={busyKey} act={act} />}
        {tab === 'types' && config && <TypesTab config={config} busyKey={busyKey} act={act} />}
        {tab === 'holders' && positions.map(p => {
          const d = drafts[p.code] || { email: '', role: 'holder' as const };
          const activeCount = p.holders.filter(h => h.is_active).length;
          const isAgent = p.code === 'agent';
          return (
            <div key={p.id} style={{ border: '1px solid #eee', borderRadius: 6, padding: 16, marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                <h2 style={{ fontSize: 17, margin: 0 }}>{p.label}</h2>
                <span style={{ fontSize: 12, color: !isAgent && activeCount === 0 ? '#b91c1c' : '#999' }}>
                  {isAgent
                    ? (activeCount === 0 ? 'Authors — nobody declared yet: only administrators can open Memos' : `Authors — ${activeCount} may write memos`)
                    : activeCount === 0 ? '⚠️ nobody assigned — memos cannot be submitted' : `${activeCount} active`}
                </span>
              </div>
              {(
                <>
                  {p.holders.length === 0 && <div style={{ color: '#999', fontSize: 14, margin: '8px 0' }}>No one yet.</div>}
                  {p.holders.map(h => (
                    <div key={h.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #f3f3f3', fontSize: 14, opacity: h.is_active ? 1 : 0.5 }}>
                      <span style={{ flex: 1 }}>{h.user_email}</span>
                      <select disabled={busy} value={h.holder_role} onChange={e => run(() => memosApi.patchHolder(h.id, { holder_role: e.target.value as any }))}
                        style={{ padding: 4, border: '1px solid #ddd', borderRadius: 4, background: '#fff' }}>
                        <option value="holder">Holder</option>
                        <option value="deputy">Deputy</option>
                      </select>
                      <button disabled={busy} onClick={() => run(() => memosApi.patchHolder(h.id, { is_active: !h.is_active }))}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: h.is_active ? '#b91c1c' : '#16a34a' }}>
                        {h.is_active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    <input type="email" placeholder="email@mfwa.org" value={d.email}
                      onChange={e => setDrafts({ ...drafts, [p.code]: { ...d, email: e.target.value } })}
                      style={{ flex: '1 1 220px', padding: 8, border: '1px solid #ddd', borderRadius: 4 }} />
                    <select value={d.role} onChange={e => setDrafts({ ...drafts, [p.code]: { ...d, role: e.target.value as any } })}
                      style={{ padding: 8, border: '1px solid #ddd', borderRadius: 4, background: '#fff' }}>
                      <option value="holder">Holder</option>
                      <option value="deputy">Deputy</option>
                    </select>
                    <button disabled={busy || !d.email.trim()} style={{ padding: '8px 16px', background: 'var(--brand)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
                      onClick={async () => { await run(() => memosApi.addHolder(p.code, d.email.trim(), d.role)); setDrafts({ ...drafts, [p.code]: { email: '', role: d.role } }); }}>
                      Add
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </Layout>
  );
}
