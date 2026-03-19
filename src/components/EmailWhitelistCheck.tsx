// src/components/EmailWhitelistCheck.tsx
import { useState } from 'react';
import { auth, rpc } from '../lib/apiClient';

export default function EmailWhitelistCheck() {
  const [email, setEmail] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');

  const handleGoogleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email.trim()) { setError('Veuillez entrer votre email'); return; }

    setChecking(true);
    try {
      const { data: isAllowed, error: checkError } = await rpc<boolean>(
        'is_email_whitelisted', { check_email: email }
      );
      if (checkError) throw new Error(checkError);
      if (!isAllowed) {
        setError("Cet email n'est pas autorisé. Contactez l'administrateur.");
        return;
      }
      auth.signInWithGoogle('/');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la connexion');
    } finally {
      setChecking(false);
    }
  };

  return (
    <form onSubmit={handleGoogleAuth} style={{ maxWidth: 400, margin: '0 auto' }}>
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', marginBottom: 8, fontWeight: 600 }}>
          Email autorisé
        </label>
        <input
          type="email"
          className="field"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="votre.email@exemple.com"
          required
          disabled={checking}
          style={{ width: '100%' }}
        />
      </div>
      {error && (
        <div style={{ padding: 12, marginBottom: 16, background: '#fee', border: '1px solid #fcc', borderRadius: 8, color: '#c00' }}>
          {error}
        </div>
      )}
      <button type="submit" className="pill" disabled={checking} style={{ width: '100%', justifyContent: 'center' }}>
        {checking ? 'Vérification...' : 'Se connecter avec Google'}
      </button>
      <p style={{ marginTop: 16, fontSize: 13, color: 'var(--muted)', textAlign: 'center' }}>
        Seuls les emails autorisés peuvent se connecter
      </p>
    </form>
  );
}
