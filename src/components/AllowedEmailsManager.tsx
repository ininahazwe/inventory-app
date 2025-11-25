// src/components/AllowedEmailsManager.tsx
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

type AllowedEmail = {
  id: number;
  email: string;
  added_at: string;
  notes: string | null;
  protected: boolean;
};

export default function AllowedEmailsManager({ onClose }: { onClose?: () => void }) {
  const [emails, setEmails] = useState<AllowedEmail[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase.rpc("list_allowed_emails");
      if (error) throw error;
      setEmails((data as AllowedEmail[]) ?? []);
    } catch (e: any) {
      setError(e.message || "Loading error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = newEmail.trim().toLowerCase();
    
    if (!email) {
      setError("Email is required");
      return;
    }
    
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Invalid email format");
      return;
    }

    setAdding(true);
    setError(null);
    
    try {
      const { error } = await supabase.rpc("add_allowed_email", {
        p_email: email,
        p_notes: newNotes.trim() || null,
      });
      if (error) throw error;
      
      setNewEmail("");
      setNewNotes("");
      await load();
    } catch (e: any) {
      if (e.message?.includes("duplicate")) {
        setError("This email address is already in the list.");
      } else {
        setError(e.message || "Error adding");
      }
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (id: number, email: string) => {
    if (!confirm(`Remove ${email} from authorized list ?\n\nThis user will no longer be able to log in.`)) {
      return;
    }

    try {
      const { error } = await supabase.rpc("remove_allowed_email", { p_id: id });
      if (error) throw error;
      await load();
    } catch (e: any) {
      setError(e.message || "Erreur lors de la suppression");
    }
  };

  return (
    <div style={{ minWidth: 400 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ color: "var(--muted)", fontSize: 13 }}>
            Only email addresses listed here can log in
        </div>
        {onClose && (
          <button className="pill" onClick={onClose}>
            Close
          </button>
        )}
      </div>

      {/* Formulaire d'ajout */}
      <form onSubmit={handleAdd} style={{ marginBottom: 20 }}>
        <div style={{ display: "grid", gap: 10 }}>
          <input
            className="input"
            type="email"
            placeholder="nouvel@email.com"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            disabled={adding}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <input
              className="input"
              type="text"
              placeholder="Notes (optional)"
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
              disabled={adding}
              style={{ flex: 1 }}
            />
            <button className="pill green-light" type="submit" disabled={adding}>
              {adding ? "…" : "+ Add"}
            </button>
          </div>
        </div>
      </form>

      {/* Erreur */}
      {error && (
        <div style={{ 
          padding: "10px 14px", 
          background: "#fee", 
          color: "crimson", 
          borderRadius: 8,
          marginBottom: 16,
          fontSize: 13
        }}>
          {error}
        </div>
      )}

      {/* Liste des emails */}
      {loading ? (
        <div style={{ padding: 20, textAlign: "center", color: "var(--muted)" }}>
          Loading...
        </div>
      ) : emails.length === 0 ? (
        <div style={{ padding: 20, textAlign: "center", color: "var(--muted)" }}>
          No email addresses allowed. Add one to get started.
        </div>
      ) : (
        <div style={{ maxHeight: 400, overflowY: "auto" }}>
          <table className="table" style={{ fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#8D86C9" }}>
                <th>Email</th>
                <th>Notes</th>
                <th>Added</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {emails.map((item) => (
                <tr key={item.id}>
                  <td style={{ fontWeight: 500 }}>
                    {item.email}
                    {item.protected && (
                      <span style={{ 
                        marginLeft: 8, 
                        fontSize: 10, 
                        background: "#e8f5e8", 
                        color: "#2d5a2d",
                        padding: "2px 6px",
                        borderRadius: 4
                      }}>
                        protected
                      </span>
                    )}
                  </td>
                  <td style={{ color: "var(--muted)" }}>{item.notes || "—"}</td>
                  <td style={{ color: "var(--muted)", fontSize: 12 }}>
                    {new Date(item.added_at).toLocaleDateString()}
                  </td>
                  <td style={{ width: 80 }}>
                    {item.protected ? (
                      <span style={{ color: "var(--muted)", fontSize: 11 }}>—</span>
                    ) : (
                      <button
                        className="pill"
                        style={{ background: "#f3d0d0", fontSize: 12, padding: "6px 10px" }}
                        onClick={() => handleRemove(item.id, item.email)}
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Info */}
      <div style={{ 
        marginTop: 16, 
        padding: "12px 14px", 
        background: "#f8f9fa", 
        borderRadius: 8,
        fontSize: 12,
        color: "var(--muted)"
      }}>
        <strong>Note :</strong> Removing an email address prevents new logins,but does not disconnect active sessions. To force a logout, delete the user from the Supabase dashboard.
      </div>
    </div>
  );
}