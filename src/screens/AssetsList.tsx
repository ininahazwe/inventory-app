// src/screens/AssetsList.tsx
import { useEffect, useState } from 'react';
import { api, rpc } from '../lib/apiClient';
import AssignAsset from './AssignAsset';
import { Link } from 'react-router-dom';

type Asset = { id: number; label: string; category_name: string | null; serial_no: string | null; status: 'in_stock' | 'assigned' | 'repair' | 'retired'; purchased_at: string | null; };

export default function AssetsList() {
  const [rows, setRows]           = useState<Asset[]>([]);
  const [loading, setLoading]     = useState(true);
  const [isAdmin, setIsAdmin]     = useState(false);
  const [assignForId, setAssignForId] = useState<number | null>(null);
  const [error, setError]         = useState<string | null>(null);

  const load = async () => {
    const { data } = await api.get<{ data: Asset[]; count: number }>('/assets?limit=100');
    setRows((data as any)?.data ?? []);
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      await load();
      const { data } = await rpc<boolean>('is_current_admin');
      setIsAdmin(!!data);
      setLoading(false);
    })();
  }, []);

  const handleReturn = async (assetId: number) => {
    setError(null);
    const { error } = await rpc('return_asset', { p_asset_id: assetId });
    if (error) { setError(error); return; }
    await load();
  };

  if (loading) return <p style={{ padding: 24 }}>Chargement...</p>;

  return (
    <div style={{ padding: 24 }}>
      <h1>Matériel</h1>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      <ul style={{ display: 'grid', gap: 8, paddingLeft: 0, listStyle: 'none' }}>
        {rows.map(r => (
          <li key={r.id} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <strong><Link to={`/asset/${r.id}`}>{r.label}</Link></strong> — {r.status}
                {r.serial_no ? ` — SN: ${r.serial_no}` : ''}
                {r.category_name ? ` — Cat.: ${r.category_name}` : ''}
              </div>
              {isAdmin && (
                <div style={{ display: 'flex', gap: 8 }}>
                  {r.status !== 'assigned' && <button onClick={() => setAssignForId(r.id)}>Attribuer</button>}
                  {r.status === 'assigned' && <button onClick={() => handleReturn(r.id)}>Retourner</button>}
                </div>
              )}
            </div>
            {assignForId === r.id && (
              <div style={{ marginTop: 12 }}>
                <AssignAsset assetId={r.id} onDone={async () => { setAssignForId(null); await load(); }} />
                <button onClick={() => setAssignForId(null)} style={{ marginTop: 8 }}>Annuler</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
