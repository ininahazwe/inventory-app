
import Modal from "../components/Modal";
import Autocomplete from "../components/Autocomplete";
import {useState} from "react";
import {supabase} from "../lib/supabaseClient.ts";


export function EditAssetModal({
                                   open,
                                   onClose,
                                   asset,
                                   onSaved,
                               }: {
    open: boolean;
    onClose: () => void;
    asset: any; // type Asset du screen parent
    onSaved: () => Promise<void> | void;
}) {
    const [edSerial, setEdSerial] = useState(asset?.serial_no ?? "");
    const [edCategoryName, setEdCategoryName] = useState("");
    const [edPurchasedAt, setEdPurchasedAt] = useState(asset?.purchased_at ?? "");
    const [edPrice, setEdPrice] = useState<string>(asset?.purchase_price != null ? String(asset.purchase_price) : "");
    const [edSupplier, setEdSupplier] = useState(asset?.supplier ?? "");
    const [edWarrantyEnd, setEdWarrantyEnd] = useState(asset?.warranty_end ?? "");
    const [edNotes, setEdNotes] = useState(asset?.notes ?? "");
    const [saving, setSaving] = useState(false);
    const [errMsg, setErrMsg] = useState<string | null>(null);


    async function fetchCategoryOptions(q: string) {
        const base = supabase.from("categories").select("name").order("name").limit(10);
        const { data, error } = q ? await base.ilike("name", `%${q}%`) : await base;
        if (error) return [];
        return (data ?? []).map((d: any) => d.name as string);
    }


    async function getOrCreateCategoryId(name: string): Promise<number | null> {
        const trimmed = name.trim();
        if (!trimmed) return null;
        const { data: found } = await supabase.from("categories").select("id").eq("name", trimmed).maybeSingle();
        if (found?.id) return found.id as number;
        const { data: created, error } = await supabase.from("categories").insert({ name: trimmed }).select("id").single();
        if (error) {
            const { data: retry } = await supabase.from("categories").select("id").eq("name", trimmed).maybeSingle();
            if (retry?.id) return retry.id as number;
            throw new Error(error.message || "Impossible to create the category.");
        }
        return created?.id ?? null;
    }

    const onSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!asset) return;
        setSaving(true);
        setErrMsg(null);
        try {
            const category_id = await getOrCreateCategoryId(edCategoryName);
            const priceNum =
                edPrice.trim() === ""
                    ? null
                    : Number.isNaN(Number(edPrice.replace(",", ".")))
                        ? (() => {
                            throw new Error("Invalid price");
                        })()
                        : Number((+edPrice.replace(",", ".")).toFixed(2));


            const { error } = await supabase
                .from("assets")
                .update({
                    serial_no: edSerial.trim() || null,
                    category_id,
                    purchased_at: edPurchasedAt || null,
                    purchase_price: priceNum,
                    supplier: edSupplier.trim() || null,
                    warranty_end: edWarrantyEnd || null,
                    notes: edNotes.trim() || null,
                })
                .eq("id", asset.id);


            if (error) throw new Error(error.message);
            onClose();
            await onSaved();
        } catch (err: any) {
            setErrMsg(err.message || "Saving error");
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal open={open} onClose={onClose} title={`Edit : ${asset?.label ?? "Asset"}`}>
            <form onSubmit={onSubmit} className="form-grid">
                <div className="span-2">
                    <label className="label">Category</label>
                    <Autocomplete
                        className="field"
                        value={edCategoryName}
                        onChange={setEdCategoryName}
                        fetchOptions={fetchCategoryOptions}
                        placeholder="Search/add…"
                    />
                </div>
                <div>
                    <label className="label">Serial number</label>
                    <input className="field" value={edSerial} onChange={(e) => setEdSerial(e.target.value)} placeholder="SN…" />
                </div>
                <div>
                    <label className="label">Purchase price</label>
                    <input className="field" type="text" inputMode="decimal" value={edPrice} onChange={(e) => setEdPrice(e.target.value)} placeholder="0.00" />
                </div>
                <div>
                    <label className="label">Purchase date</label>
                    <input className="field" type="date" value={edPurchasedAt} onChange={(e) => setEdPurchasedAt(e.target.value)} />
                </div>
                <div>
                    <label className="label">End of warranty</label>
                    <input className="field" type="date" value={edWarrantyEnd} onChange={(e) => setEdWarrantyEnd(e.target.value)} />
                </div>
                <div className="span-2">
                    <label className="label">Supplier</label>
                    <input className="field" value={edSupplier} onChange={(e) => setEdSupplier(e.target.value)} placeholder="Ex : ABC Ltd." />
                </div>
                <div className="span-2">
                    <label className="label">Notes</label>
                    <textarea className="field" rows={3} value={edNotes} onChange={(e) => setEdNotes(e.target.value)} />
                </div>
                {errMsg && (
                    <p className="span-2" style={{ color: "crimson" }}>{errMsg}</p>
                )}
                <div className="span-2 modal-actions">
                    <button type="button" className="pill pill--muted" onClick={onClose}>Cancel</button>
                    <button className="pill" disabled={saving}>{saving ? "Enregistrement…" : "Enregistrer"}</button>
                </div>
            </form>
        </Modal>
    );
}
