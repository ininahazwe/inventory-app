import { useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import type { Assignee } from "./type";

export default function AssigneeForm({
  assignee,
  onSaved,
  onCancel,
}: {
  assignee: Assignee;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [full_name, setFullName] = useState(assignee.full_name ?? "");
  const [email, setEmail] = useState(assignee.email ?? "");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const new_name = full_name.trim() || null;
    const new_email = email.trim() || null;
    if (new_email && !/^\S+@\S+\.\S+$/.test(new_email)) {
      return alert("Email invalide");
    }

    setBusy(true);
    try {
      const { error } = await supabase.rpc("assignees_rename", {
        old_email: assignee.email,
        old_name: assignee.full_name,
        new_name,
        new_email,
      });
      if (error) throw error;
      onSaved();
    } catch (e: any) {
      alert(e?.message ?? "Erreur lors de la mise à jour");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display:"grid", gap:8 }}>
      <div style={{ fontSize:12, color:"var(--muted)" }}>
        Met à jour toutes les lignes <code>assignments</code> correspondant à cette personne.
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
        <input className="input" placeholder="Nom complet" value={full_name} onChange={e=>setFullName(e.target.value)} />
        <input className="input" placeholder="Email (optionnel)" value={email} onChange={e=>setEmail(e.target.value)} />
      </div>

      <div style={{ display:"flex", gap:8, justifyContent:"flex-end", marginTop:8 }}>
        <button type="button" className="pill" style={{ background:"#bbb" }} onClick={onCancel} disabled={busy}>Annuler</button>
        <button type="submit" className="pill green-light" disabled={busy}>Enregistrer</button>
      </div>
    </form>
  );
}
