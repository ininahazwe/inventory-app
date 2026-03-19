// src/components/AllowedEmailsManager.tsx
import { useEffect, useState } from 'react';
import { rpc } from '../lib/apiClient';

type AllowedEmail = { id: number; email: string; added_at: string; notes: string | null; protected: boolean; };

export default function AllowedEmailsManager({ onClose }: { onClose?: () => void }) {
  const [emails, setEmails] = useState<AllowedEmail[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    const { data, error } = await rpc<AllowedEmail[]>('list_allowed_emails');
    if (error) setError(error);
    else setEmails(data ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = newEmail.trim().toLowerCase();
    if (!email) { setError('Email requis'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('Format invalide'); return; }
    setAdding(true); setError(null);
    const { error } = await rpc('add_allowed_email', { p_email: email, p_notes: newNotes.trim() || null });
    if (error) setError(error.includes('duplicate') ? 'Email déjà dans la liste.' : error);
    else { setNewEmail(''); setNewNotes(''); await load(); }
    setAdding(false);
  };

  const handleRemove = async (id: number, email: string) => {
    if (!confirm(`Retirer ${email} de la liste autorisée ?`)) return;
    const { error } = await rpc('remove_allowed_email', { p_id: id });
    if (error) setError(error);
    else await load();
  };

  return (
    <div style={{ minWidth: 400 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>Seuls les emails listés ici peuvent se connecter</div>
        {onClose && <button className="pill" onClick={onClose}>Fermer</button>}
      </div>

      <form onSubmit={handleAdd} style={{ marginBottom: 20 }}>
        <div style={{ display: 'grid', gap: 10 }}>
          <input className="input" type="email" placeholder="nouvel@email.com" value={newEmail} onChange={e => setNewEmail(e.target.value)} disabled={adding} />
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input" type="text" placeholder="Notes (optionnel)" value={newNotes} onChange={e => setNewNotes(e.target.value)} disabled={adding} style={{ flex: 1 }} />
            <button className="pill green-light" type="submit" disabled={adding}>{adding ? '…' : '+ Ajouter'}</button>
          </div>
        </div>
      </form>

      {error && <div style={{ padding: '10px 14px', background: '#fee', color: 'crimson', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{error}</div>}

      {loading ? <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)' }}>Chargement...</div> : (
        <div style={{ maxHeight: 400, overflowY: 'auto' }}>
          <table className="table" style={{ fontSize: 13 }}>
            <thead><tr style={{ background: '#8D86C9' }}><th>Email</th><th>Notes</th><th>Ajouté</th><th></th></tr></thead>
            <tbody>
              {emails.map(item => (
                <tr key={item.id}>
                  <td style={{ fontWeight: 500 }}>
                    {item.email}
                    {item.protected && <span style={{ marginLeft: 8, fontSize: 10, background: '#e8f5e8', color: '#2d5a2d', padding: '2px 6px', borderRadius: 4 }}>protégé</span>}
                  </td>
                  <td style={{ color: 'var(--muted)' }}>{item.notes || '—'}</td>
                  <td style={{ color: 'var(--muted)', fontSize: 12 }}>{new Date(item.added_at).toLocaleDateString()}</td>
                  <td>{item.protected ? <span style={{ color: 'var(--muted)', fontSize: 11 }}>—</span> : (
                    <button className="pill" style={{ background: '#f3d0d0', fontSize: 12, padding: '6px 10px' }} onClick={() => handleRemove(item.id, item.email)}>Retirer</button>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
