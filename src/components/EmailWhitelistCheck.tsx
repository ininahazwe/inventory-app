// src/components/EmailWhitelistCheck.tsx
import { useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function EmailWhitelistCheck() {
  const [email, setEmail] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  const handleGoogleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email.trim()) {
      setError("Veuillez entrer votre email");
      return;
    }

    setChecking(true);

    try {
      // 1. Vérifier si l'email est autorisé
      const { data: isAllowed, error: checkError } = await supabase
        .rpc('is_email_whitelisted', { check_email: email });

      if (checkError) throw checkError;

      if (!isAllowed) {
        setError("Cet email n'est pas autorisé. Contactez l'administrateur.");
        setChecking(false);
        return;
      }

      // 2. Si autorisé, lancer l'auth Google avec hint
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
          queryParams: {
            login_hint: email, // Force Google à pré-remplir avec cet email
            prompt: 'select_account' // Force la sélection de compte
          }
        }
      });

      if (authError) throw authError;

    } catch (err: any) {
      setError(err.message || "Erreur lors de la connexion");
      setChecking(false);
    }
  };

  return (
    <form onSubmit={handleGoogleAuth} style={{ maxWidth: 400, margin: "0 auto" }}>
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", marginBottom: 8, fontWeight: 600 }}>
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
          style={{ width: "100%" }}
        />
      </div>

      {error && (
        <div style={{
          padding: 12,
          marginBottom: 16,
          background: "#fee",
          border: "1px solid #fcc",
          borderRadius: 8,
          color: "#c00"
        }}>
          {error}
        </div>
      )}

      <button
        type="submit"
        className="pill"
        disabled={checking}
        style={{ width: "100%", justifyContent: "center" }}
      >
        {checking ? "Vérification..." : "Se connecter avec Google"}
      </button>

      <p style={{ marginTop: 16, fontSize: 13, color: "var(--muted)", textAlign: "center" }}>
        Seuls les emails autorisés peuvent se connecter
      </p>
    </form>
  );
}