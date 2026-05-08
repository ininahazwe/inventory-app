// src/components/AuditLog.tsx
import React from "react";
import { useEffect, useState } from 'react';
import { api } from '../lib/apiClient';

type AuditEntry = {
  id: number;
  user_id: string;
  action: string;
  target_table: string;
  target_id: number;
  old_value: Record<string, unknown> | null;  // ✅ Objet JSON, pas string
  new_value: Record<string, unknown> | null;  // ✅ Objet JSON, pas string
  created_at: string;
};

type AuditLogProps = {
  entityType?: string;
  entityId?: string;
};

export default function AuditLog({ entityType, entityId }: AuditLogProps) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const LIMIT = 10;

  const loadEntries = async (newOffset: number) => {
    try {
      const isInitial = newOffset === 0;
      if (isInitial) setLoading(true);
      else setLoadingMore(true);

      const params = new URLSearchParams();
      if (entityType) params.set('entity_type', entityType);
      if (entityId) params.set('entity_id', entityId);
      params.set('limit', String(LIMIT));
      params.set('offset', String(newOffset));

      // ✅ Use /api/audit endpoint (matches backend route)
      const { data, error: err } = await api.get<AuditEntry[]>(`/audit?${params.toString()}`);

      if (err) {
        setError(err);
        return;
      }

      const newEntries = data ?? [];

      if (isInitial) {
        setEntries(newEntries);
      } else {
        setEntries(prev => [...prev, ...newEntries]);
      }

      // Si on a reçu moins d'entrées que la limite, il n'y en a plus
      setHasMore(newEntries.length === LIMIT);
      setOffset(newOffset + LIMIT);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de chargement');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    loadEntries(0);
  }, [entityType, entityId]);

  const handleLoadMore = () => {
    loadEntries(offset);
  };

  const getActionColor = (action: string) => {
    if (action.includes('deleted')) return '#dc3545';
    if (action.includes('created')) return '#28a745';
    if (action.includes('updated') || action.includes('changed')) return '#ffc107';
    if (action.includes('repair')) return '#b98b46';
    if (action.includes('retired')) return '#6c757d';
    if (action.includes('returned')) return '#007bff';
    return '#6c757d';
  };

  const getActionLabel = (action: string) => ({
    asset_created: '✨ Créé',
    asset_updated: '✏️ Modifié',
    asset_deleted: '🗑️ Supprimé',
    asset_returned: '📥 Retourné',
    asset_sent_to_repair: '🔧 En réparation',
    asset_repair_completed: '✅ Réparation terminée',
    asset_retired: '🚫 Retiré du service',
  }[action] || action.replace(/_/g, ' '));

  const formatDate = (dateStr: string): string => {
    try {
      return new Date(dateStr).toLocaleString('fr-FR');
    } catch {
      return dateStr;
    }
  };

  // ✅ CORRIGÉ : oldValue et newValue sont des objets, pas des strings
  const getDifferences = (
    oldValue: Record<string, unknown> | null,
    newValue: Record<string, unknown> | null
  ): { key: string; oldVal: string; newVal: string }[] => {
    if (!oldValue || !newValue) return [];

    try {
      // oldValue et newValue sont DÉJÀ des objets (pas besoin de JSON.parse)
      const old = oldValue as Record<string, unknown>;
      const newVal = newValue as Record<string, unknown>;
      const changes: { key: string; oldVal: string; newVal: string }[] = [];

      const allKeys = new Set([...Object.keys(old), ...Object.keys(newVal)]);

      allKeys.forEach((key) => {
        if (old[key] !== newVal[key]) {
          changes.push({
            key,
            oldVal: String(old[key] ?? 'null'),
            newVal: String(newVal[key] ?? 'null'),
          });
        }
      });

      return changes;
    } catch (err) {
      console.error('Error comparing audit values:', err);
      return [];
    }
  };

  if (loading) return <p style={{ padding: 16, color: 'var(--muted)' }}>Chargement…</p>;
  if (error) return <p style={{ padding: 16, color: 'crimson' }}>Erreur : {error}</p>;
  if (!entries.length) return <p style={{ padding: 16, color: 'var(--muted)' }}>No event</p>;

  return (
    <div style={{ padding: '16px 0' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {entries.map(entry => {
          const differences = getDifferences(entry.old_value, entry.new_value);

          return (
            <div
              key={entry.id}
              style={{
                padding: 12,
                border: '1px solid var(--line)',
                borderRadius: 8,
                backgroundColor: '#fafaf9',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'start', gap: 12, marginBottom: 8 }}>
                <div
                  style={{
                    padding: '4px 8px',
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 600,
                    color: '#fff',
                    backgroundColor: getActionColor(entry.action),
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  {getActionLabel(entry.action)}
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: 500, color: 'var(--ink)' }}>
                    {entry.action.replace(/_/g, ' ').toUpperCase()}
                  </p>
                  <small style={{ color: 'var(--muted)' }}>
                    Par <strong>{entry.user_id}</strong> • {formatDate(entry.created_at)}
                  </small>
                </div>
              </div>

              {/* Show differences if any */}
              {differences.length > 0 && (
                <details style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 500 }}>Changements ({differences.length})</summary>
                  <div style={{ marginTop: 8, paddingLeft: 16, borderLeft: '2px solid var(--line)' }}>
                    {differences.map((diff, idx) => (
                      <div key={idx} style={{ marginBottom: 8 }}>
                        <strong>{diff.key}:</strong>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                          <span style={{ color: '#dc3545' }}>{diff.oldVal}</span>
                          {' → '}
                          <span style={{ color: '#28a745' }}>{diff.newVal}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {/* Show raw JSON if no differences but we have values */}
              {differences.length === 0 && (entry.old_value || entry.new_value) && (
                <details style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 500 }}>Détails</summary>
                  <div style={{ marginTop: 8, paddingLeft: 16, borderLeft: '2px solid var(--line)' }}>
                    {entry.old_value && (
                      <div style={{ marginBottom: 8 }}>
                        <strong>Avant :</strong>
                        <pre
                          style={{
                            margin: '4px 0',
                            padding: 8,
                            background: '#f5f5f5',
                            borderRadius: 4,
                            fontSize: 11,
                            overflow: 'auto',
                          }}
                        >
                          {/* ✅ CORRIGÉ : stringify directement sur l'objet */}
                          {JSON.stringify(entry.old_value, null, 2)}
                        </pre>
                      </div>
                    )}
                    {entry.new_value && (
                      <div>
                        <strong>Après :</strong>
                        <pre
                          style={{
                            margin: '4px 0',
                            padding: 8,
                            background: '#f5f5f5',
                            borderRadius: 4,
                            fontSize: 11,
                            overflow: 'auto',
                          }}
                        >
                          {/* ✅ CORRIGÉ : stringify directement sur l'objet */}
                          {JSON.stringify(entry.new_value, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                </details>
              )}
            </div>
          );
        })}
      </div>

      {/* Load More Button */}
      {hasMore && (
        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'center' }}>
          <button
            className="pill"
            onClick={handleLoadMore}
            disabled={loadingMore}
            style={{
              background: loadingMore ? '#ccc' : 'var(--brand)',
              color: 'white',
              cursor: loadingMore ? 'not-allowed' : 'pointer',
            }}
          >
            {loadingMore ? 'Chargement…' : 'Charger plus'}
          </button>
        </div>
      )}
    </div>
  );
}
