import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import AssignAsset from "./AssignAsset";
import { Link } from "react-router-dom";

type Asset = {
    id: number;
    label: string;
    category: string | null;
    serial_no: string | null;
    status: "in_stock" | "assigned" | "repair" | "retired";
    purchased_at: string | null;
};

export default function AssetsList() {
    const [rows, setRows] = useState<Asset[]>([]);
    const [loading, setLoading] = useState(true);
    const [isAdmin, setIsAdmin] = useState(false);
    const [assignForId, setAssignForId] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = async () => {
        const { data, error } = await supabase
            .from("assets")
            .select("*")
            .order("created_at", { ascending: false });
        if (error) console.error(error);
        setRows(data ?? []);
    };

    useEffect(() => {
        (async () => {
            setLoading(true);
            await load();
            const { data: adminData } = await supabase.rpc("is_current_admin");
            setIsAdmin(!!adminData);
            setLoading(false);
        })();
    }, []);

    const handleReturn = async (assetId: number) => {
        setError(null);
        const { error } = await supabase.rpc("return_asset", { p_asset_id: assetId });
        if (error) { setError(error.message); return; }
        await load();
    };

    if (loading) return <p style={{ padding: 24 }}>Chargement...</p>;

    return (
        <div style={{ padding: 24 }}>
            <h1>Matériel</h1>
            {error && <p style={{ color: "crimson" }}>{error}</p>}
            <ul style={{ display: "grid", gap: 8, paddingLeft: 0, listStyle: "none" }}>
                {rows.map((r) => (
                    <li key={r.id} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                            <div>
                                <strong><Link to={`/asset/${r.id}`}>{r.label}</Link></strong> — {r.status}
                                {r.serial_no ? ` — SN: ${r.serial_no}` : ""}
                                {r.category ? ` — Cat.: ${r.category}` : ""}
                            </div>
                            {isAdmin && (
                                <div style={{ display: "flex", gap: 8 }}>
                                    {r.status !== "assigned" && (
                                        <button onClick={() => setAssignForId(r.id)}>Attribuer</button>
                                    )}
                                    {r.status === "assigned" && (
                                        <button onClick={() => handleReturn(r.id)}>Retourner</button>
                                    )}
                                </div>
                            )}
                        </div>

                        {assignForId === r.id && (
                            <div style={{ marginTop: 12 }}>
                                <AssignAsset
                                    assetId={r.id}
                                    onDone={async () => {
                                        setAssignForId(null);
                                        await load();
                                    }}
                                />
                                <button onClick={() => setAssignForId(null)} style={{ marginTop: 8 }}>
                                    Annuler
                                </button>
                            </div>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    );
}
