// src/components/AuditDashboard.tsx
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import Modal from "./Modal";
import AuditLog from "./AuditLog";

type AuditEntry = {
  id: number;
  action: string;
  entity_type: string;
  entity_id: string;
  actor_email: string;
  description: string;
  created_at: string;
};

export default function AuditDashboard() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "asset" | "user" | "assignment">("all");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<AuditEntry | null>(null);

  useEffect(() => {
    loadAudit();
  }, [filter]);

  const loadAudit = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase.rpc("get_audit_log", {
        p_limit: 100,
        p_offset: 0,
        p_entity_type: filter === "all" ? null : filter,
        p_entity_id: null,
        p_action: null,
      });

      if (err) {
        setError(err.message);
        return;
      }

      setEntries(data || []);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Error loading audit";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const getActionColor = (action: string): string => {
    if (action.includes("deleted")) return "#dc3545";
    if (action.includes("created")) return "#28a745";
    if (action.includes("updated") || action.includes("changed")) return "#ffc107";
    if (action.includes("assigned") || action.includes("returned")) return "#007bff";
    return "#6c757d";
  };

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <p style={{ margin: "0 0 16px 0", color: "var(--muted)", fontSize: 14 }}>
          Full activity log
        </p>

        {/* Filtres */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(["all", "asset", "user", "assignment"] as const).map((f) => (
            <button
              key={f}
              className="pill"
              onClick={() => setFilter(f)}
              style={{
                background: filter === f ? "var(--brand)" : "#f4f1ee",
                color: filter === f ? "#fff" : "var(--ink)",
              }}
            >
              {f === "all" ? "Tous" : f === "asset" ? "Assets" : f === "user" ? "Users" : "Assignments"}
            </button>
          ))}
        </div>
      </div>

      {/* Contenu */}
      {loading ? (
        <p style={{ color: "var(--muted)" }}>Loading...</p>
      ) : error ? (
        <p style={{ color: "crimson" }}>Errot: {error}</p>
      ) : entries.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>No event registered</p>
      ) : (
        <table className="table">
          <thead>
          <tr style={{ background: "#8D86C9" }}>
            <th style={{ width: "15%" }}>Action</th>
            <th style={{ width: "50%" }}>Description</th>
            <th style={{ width: "20%" }}>By</th>
            <th style={{ width: "15%" }}>Date</th>
          </tr>
          </thead>
          <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} onClick={() => { setSelectedEntry(entry); setDetailsOpen(true); }} style={{ cursor: "pointer" }}>
              <td>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "4px 8px",
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#fff",
                      backgroundColor: getActionColor(entry.action),
                      whiteSpace: "nowrap",
                    }}
                  >
                    {entry.action.replace(/_/g, " ")}
                  </span>
              </td>
              <td style={{ maxWidth: 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {entry.description}
              </td>
              <td style={{ fontSize: 13, color: "var(--muted)" }}>{entry.actor_email}</td>
              <td style={{ fontSize: 13, color: "var(--muted)" }}>
                {new Date(entry.created_at).toLocaleString("fr-FR", {
                  year: "2-digit",
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </td>
            </tr>
          ))}
          </tbody>
        </table>
      )}

      {/* Modal détails */}
      <Modal open={detailsOpen} onClose={() => setDetailsOpen(false)} title="Détails de l'événement">
        {selectedEntry && (
          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <label style={{ fontWeight: 600, display: "block", marginBottom: 4 }}>Action</label>
              <p style={{ margin: 0 }}>{selectedEntry.action}</p>
            </div>
            <div>
              <label style={{ fontWeight: 600, display: "block", marginBottom: 4 }}>Description</label>
              <p style={{ margin: 0 }}>{selectedEntry.description}</p>
            </div>
            <div>
              <label style={{ fontWeight: 600, display: "block", marginBottom: 4 }}>Par</label>
              <p style={{ margin: 0 }}>{selectedEntry.actor_email}</p>
            </div>
            <div>
              <label style={{ fontWeight: 600, display: "block", marginBottom: 4 }}>Date</label>
              <p style={{ margin: 0 }}>{new Date(selectedEntry.created_at).toLocaleString("fr-FR")}</p>
            </div>
            <AuditLog limit={1} />
          </div>
        )}
      </Modal>
    </div>
  );
}
