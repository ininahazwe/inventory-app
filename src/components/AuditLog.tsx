// src/components/AuditLog.tsx
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

type AuditEntry = {
  id: number;
  action: string;
  entity_type: string;
  entity_id: string;
  actor_email: string;
  description: string;
  created_at: string;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
};

type AuditLogProps = {
  entityType?: string;
  entityId?: string;
  limit?: number;
};

export default function AuditLog({ entityType, entityId, limit = 50 }: AuditLogProps) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadAuditLog();
  }, [entityType, entityId, limit]);

  const loadAuditLog = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const query = supabase.rpc("get_audit_log", {
        p_limit: limit,
        p_offset: 0,
        p_entity_type: entityType || null,
        p_entity_id: entityId || null,
        p_action: null,
      });

      const { data, error: err } = await query;

      if (err) {
        setError(err.message);
        return;
      }

      setEntries(data || []);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Error loading audit log";
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

  const getActionLabel = (action: string): string => {
    const labels: Record<string, string> = {
      asset_created: "✨ Created",
      asset_updated: "✏️ Edited",
      asset_deleted: "🗑️ Deleted",
      asset_assigned: "📤 Assigned",
      asset_returned: "📥 Returned",
      user_added: "👤 User added",
      user_role_changed: "🔐 Role changed",
      user_deleted: "🗑️ User deleted",
    };
    return labels[action] || action;
  };

  if (loading) {
    return <p style={{ padding: 16, color: "var(--muted)" }}>Log loading...</p>;
  }

  if (error) {
    return <p style={{ padding: 16, color: "crimson" }}>Error: {error}</p>;
  }

  if (entries.length === 0) {
    return <p style={{ padding: 16, color: "var(--muted)" }}>Aucun événement enregistré</p>;
  }

  return (
    <div style={{ padding: "16px 0" }}>
      <h3 style={{ margin: "0 0 16px 0", fontSize: 14, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".08em" }}>
        History
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {entries.map((entry) => (
          <div
            key={entry.id}
            style={{
              padding: 12,
              border: "1px solid var(--line)",
              borderRadius: 8,
              backgroundColor: "#fafaf9",
            }}
          >
            <div style={{ display: "flex", alignItems: "start", gap: 12, marginBottom: 8 }}>
              {/* Badge action */}
              <div
                style={{
                  padding: "4px 8px",
                  borderRadius: 4,
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#fff",
                  backgroundColor: getActionColor(entry.action),
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                {getActionLabel(entry.action)}
              </div>

              {/* Description */}
              <div style={{ flex: 1 }}>
                <p style={{ margin: "0 0 4px 0", fontWeight: 500, color: "var(--ink)" }}>
                  {entry.description}
                </p>
                <small style={{ color: "var(--muted)" }}>
                  Par <strong>{entry.actor_email}</strong> • {new Date(entry.created_at).toLocaleString("fr-FR")}
                </small>
              </div>
            </div>

            {/* Détails des changements */}
            {(entry.old_values || entry.new_values) && (
              <details style={{ marginTop: 8, fontSize: 12, color: "var(--muted)" }}>
                <summary style={{ cursor: "pointer", fontWeight: 500 }}>Changes</summary>
                <div style={{ marginTop: 8, paddingLeft: 16, borderLeft: "2px solid var(--line)" }}>
                  {entry.old_values && (
                    <div style={{ marginBottom: 8 }}>
                      <strong>Before:</strong>
                      <pre
                        style={{
                          margin: "4px 0",
                          padding: 8,
                          background: "#f5f5f5",
                          borderRadius: 4,
                          fontSize: 11,
                          overflow: "auto",
                        }}
                      >
                        {JSON.stringify(entry.old_values, null, 2)}
                      </pre>
                    </div>
                  )}
                  {entry.new_values && (
                    <div>
                      <strong>After:</strong>
                      <pre
                        style={{
                          margin: "4px 0",
                          padding: 8,
                          background: "#f5f5f5",
                          borderRadius: 4,
                          fontSize: 11,
                          overflow: "auto",
                        }}
                      >
                        {JSON.stringify(entry.new_values, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </details>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
