export function LifecycleActions({
                                     isAdmin,
                                     status,
                                     sendToRepair,
                                     exitRepair,
                                     retireAsset,
                                     returnAsset,
                                     busy,
                                 }: {
    isAdmin: boolean;
    status: "En stock" | "assigned" | "repair" | "retired";
    sendToRepair: () => void | Promise<void>;
    exitRepair: () => void | Promise<void>;
    retireAsset: () => void | Promise<void>;
    returnAsset: () => void | Promise<void>;
    busy: boolean;
}) {
    if (!isAdmin) return null;
    return (
        <section style={{ borderTop: "1px solid var(--line)", paddingTop: 12, marginBottom: 15 }}>
            <h3 style={{ margin: "8px 0" }}>Cycle de vie</h3>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {status !== "repair" && (
                    <button className="pill" onClick={sendToRepair} disabled={busy}>
                        {busy ? "…" : "Mettre en réparation"}
                    </button>
                )}
                {status === "repair" && (
                    <button className="pill" onClick={exitRepair} disabled={busy}>
                        {busy ? "…" : "Sortie de réparation"}
                    </button>
                )}
                {status !== "retired" && (
                    <button className="pill" onClick={retireAsset} disabled={busy}>
                        {busy ? "…" : "Retirer définitivement"}
                    </button>
                )}
                {status === "assigned" && (
                    <button className="pill" onClick={returnAsset} disabled={busy}>
                        {busy ? "…" : "Marquer comme retourné"}
                    </button>
                )}
            </div>
        </section>
    );
}