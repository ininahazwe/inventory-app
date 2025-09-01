// src/screens/NewAsset.tsx
import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import Autocomplete from "../components/Autocomplete";

type Props = { onCreated?: () => void; onCancel?: () => void };

export default function NewAsset({ onCreated, onCancel }: Props) {
    const [label, setLabel] = useState("");
    const [serial, setSerial] = useState("");
    const [categoryName, setCategoryName] = useState("");
    const [purchasedAt, setPurchasedAt] = useState(""); // yyyy-mm-dd
    const [purchasePrice, setPurchasePrice] = useState<string>("");
    const [supplier, setSupplier] = useState("");
    const [warrantyEnd, setWarrantyEnd] = useState(""); // yyyy-mm-dd
    const [notes, setNotes] = useState("");
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    async function fetchCategoryOptions(q: string) {
        const base = supabase.from("categories").select("name").order("name").limit(10);
        const { data } = q ? await base.ilike("name", `%${q}%`) : await base;
        return (data ?? []).map((d: any) => d.name as string);
    }

    async function getOrCreateCategoryId(name: string): Promise<number | null> {
        const trimmed = name.trim();
        if (!trimmed) return null;
        const { data: found } = await supabase.from("categories").select("id").eq("name", trimmed).maybeSingle();
        if (found?.id) return found.id as number;

        const { data: created, error } = await supabase
            .from("categories")
            .insert({ name: trimmed })
            .select("id")
            .single();
        if (error) {
            const { data: retry } = await supabase.from("categories").select("id").eq("name", trimmed).maybeSingle();
            if (retry?.id) return retry.id as number;
            throw new Error(error.message || "Impossible de créer la catégorie (droits admin requis).");
        }
        return created?.id ?? null;
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setErr(null);
        setSaving(true);
        try {
            if (!label.trim()) throw new Error("Le libellé est obligatoire.");

            const category_id = await getOrCreateCategoryId(categoryName);

            // 1) insert asset
            const { data: inserted, error: insertErr } = await supabase
                .from("assets")
                .insert({
                    label: label.trim(),
                    serial_no: serial.trim() || null,
                    category_id,
                    purchased_at: purchasedAt || null,
                    purchase_price: purchasePrice ? Number(purchasePrice) : null,
                    supplier: supplier.trim() || null,
                    warranty_end: warrantyEnd || null,
                    notes: notes.trim() || null,
                })
                .select("id")
                .single();
            if (insertErr) throw new Error(insertErr.message);

            const assetId = inserted!.id as number;

            // 2) set qr_slug = `asset/<id>`
            const { error: qrErr } = await supabase
                .from("assets")
                .update({ qr_slug: `asset/${assetId}` })
                .eq("id", assetId);
            if (qrErr) throw new Error(qrErr.message);

            // reset
            setLabel(""); setSerial(""); setCategoryName(""); setPurchasedAt("");
            setPurchasePrice(""); setSupplier(""); setWarrantyEnd(""); setNotes("");

            onCreated?.();
        } catch (e: any) {
            setErr(e.message || "Erreur lors de l’enregistrement.");
        } finally {
            setSaving(false);
        }
    }

    return (
        <form onSubmit={handleSubmit} className="form-grid">
            <div className="span-2">
                <label className="label">Libellé *</label>
                <input className="field" value={label} onChange={e=>setLabel(e.target.value)} required />
            </div>

            <div className="span-2">
                <label className="label">Catégorie</label>
                <Autocomplete
                    className="field"
                    value={categoryName}
                    onChange={setCategoryName}
                    fetchOptions={fetchCategoryOptions}
                    placeholder="Chercher/ajouter…"
                />
            </div>

            <div>
                <label className="label">Numéro de série</label>
                <input className="field" value={serial} onChange={e=>setSerial(e.target.value)} placeholder="SN…" />
            </div>
            <div>
                <label className="label">Prix d’achat</label>
                <input className="field" type="number" step="0.01" min="0" value={purchasePrice} onChange={e=>setPurchasePrice(e.target.value)} placeholder="0.00" />
            </div>

            <div>
                <label className="label">Date d’achat</label>
                <input className="field" type="date" value={purchasedAt} onChange={e=>setPurchasedAt(e.target.value)} />
            </div>
            <div>
                <label className="label">Fin de garantie</label>
                <input className="field" type="date" value={warrantyEnd} onChange={e=>setWarrantyEnd(e.target.value)} />
            </div>

            <div className="span-2">
                <label className="label">Fournisseur</label>
                <input className="field" value={supplier} onChange={e=>setSupplier(e.target.value)} placeholder="Ex : ABC Ltd." />
            </div>
            <div className="span-2">
                <label className="label">Notes</label>
                <textarea className="field" rows={3} value={notes} onChange={e=>setNotes(e.target.value)} />
            </div>

            {err && <p className="span-2" style={{ color:"crimson" }}>{err}</p>}

            <div className="span-2 modal-actions">
                {onCancel && <button type="button" className="pill pill--muted" onClick={onCancel}>Annuler</button>}
                <button className="pill" disabled={saving}>{saving ? "Enregistrement…" : "Créer"}</button>
            </div>
        </form>
    );
}
