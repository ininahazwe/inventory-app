import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import Autocomplete from "../components/Autocomplete";

export default function AssignAsset({ assetId, onDone }: { assetId: number; onDone?: () => void }) {
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    async function fetchPeopleNames(q: string) {
        const base = supabase.from("assignments").select("assignee_name").not("assignee_name", "is", null);
        const { data, error } = q
            ? await base.ilike("assignee_name", `%${q}%`).order("assignee_name").limit(10)
            : await base.order("assignee_name").limit(10);
        if (error) return [];
        // distinct côté client
        return Array.from(new Set((data ?? []).map(d => d.assignee_name as string)));
    }

    async function fetchPeopleEmails(q: string) {
        const base = supabase.from("assignments").select("assignee_email").not("assignee_email", "is", null);
        const { data, error } = q
            ? await base.ilike("assignee_email", `%${q}%`).order("assignee_email").limit(10)
            : await base.order("assignee_email").limit(10);
        if (error) return [];
        return Array.from(new Set((data ?? []).map(d => d.assignee_email as string)));
    }

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true); setErr(null);
        const { error } = await supabase.rpc("assign_asset", {
            p_asset_id: assetId,
            p_name: name,
            p_email: email || null,
        });
        setLoading(false);
        if (error) { setErr(error.message); return; }
        setName(""); setEmail("");
        onDone?.();
    };

    return (
        <form onSubmit={submit} style={{ display: "grid", gap: 12, maxWidth: 420, margin: "auto" }}>
            <label>Nom de l’utilisateur *</label>
            <Autocomplete value={name} onChange={setName} fetchOptions={fetchPeopleNames} placeholder="Ex: Ama, Kofi…" />
            <label>Email (optionnel)</label>
            <Autocomplete value={email} onChange={setEmail} fetchOptions={fetchPeopleEmails} placeholder="ex: ama@exemple.org" />
            <button className="pill green-light" disabled={loading}>{loading ? "Attribution..." : "Attribuer"}</button>
            {err && <p style={{ color:"crimson" }}>{err}</p>}
        </form>
    );
}
