import React from "react";
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
    status: "in_stock" | "assigned" | "repair" | "retired";
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
                        {busy ? "…" : "Send for repair"}
                    </button>
                )}
                {status === "repair" && (
                    <button className="pill" onClick={exitRepair} disabled={busy}>
                        {busy ? "…" : "Return from repair"}
                    </button>
                )}
                {status !== "retired" && (
                    <button className="pill" onClick={retireAsset} disabled={busy}>
                        {busy ? "…" : "Retire permanently"}
                    </button>
                )}
                {status === "assigned" && (
                    <button className="pill" onClick={returnAsset} disabled={busy}>
                        {busy ? "…" : "Mark as returned"}
                    </button>
                )}
            </div>
        </section>
    );
}
