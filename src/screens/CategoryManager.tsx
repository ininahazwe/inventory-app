// src/screens/CategoryManager.tsx
import { useEffect, useState } from 'react';
import { api } from '../lib/apiClient';

type Category = { id: number; name: string };

export default function CategoryManager() {
  const [rows, setRows]       = useState<Category[]>([]);
  const [name, setName]       = useState('');
  const [err, setErr]         = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const { data } = await api.get<Category[]>('/categories');
    setRows(data ?? []);
  };

  useEffect(() => { (async () => { setLoading(true); await load(); setLoading(false); })(); }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!name.trim()) return;
    const { error } = await api.post('/categories', { name: name.trim() });
    if (error) { setErr(error); return; }
    setName(''); await load();
  };

  const remove = async (id: number) => {
    if (!confirm('Supprimer cette catégorie ?')) return;
    const { error } = await api.delete(`/categories/${id}`);
    if (error) { setErr(error); return; }
    await load();
  };

  if (loading) return <p style={{ padding: 24 }}>Chargement…</p>;

  return (
    <div style={{ padding: 24, maxWidth: 520 }}>
      <h2>Catégories</h2>
      <form onSubmit={add} style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
        <input placeholder="Nouvelle catégorie" value={name} onChange={e => setName(e.target.value)} />
        <button>Ajouter</button>
      </form>
      {err && <p style={{ color: 'crimson' }}>{err}</p>}
      <ul style={{ listStyle: 'none', paddingLeft: 0 }}>
        {rows.map(c => (
          <li key={c.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #eee' }}>
            <span>{c.name}</span>
            <button onClick={() => remove(c.id)}>Supprimer</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
