// src/components/AssetTimeline.tsx
// Historique unifié d'un asset: assignments + réparations (lifecycle_events) +
// incidents + enchères, fusionnés côté serveur (GET /assets/:id/timeline) et
// affichés en une seule frise chronologique plutôt que dispersés par module.
import React from 'react';
import { useEffect, useState } from 'react';
import { api } from '../lib/apiClient';

type TimelineEvent = {
  type: string;
  at: string;
  title: string;
  detail: string;
  status?: string | null;
  source_id: number;
};

const TYPE_STYLES: Record<string, { icon: string; bg: string; color: string }> = {
  assignment: { icon: '👤', bg: '#e8f0ff', color: '#1e40af' },
  repair: { icon: '🔧', bg: '#fef3c7', color: '#b45309' },
  maintenance: { icon: '✅', bg: '#dcfce7', color: '#15803d' },
  retired: { icon: '🗄️', bg: '#f4f1ee', color: '#6b7280' },
  incident: { icon: '⚠️', bg: '#fee2e2', color: '#991b1b' },
  auction: { icon: '🔨', bg: '#ede9fe', color: '#6d28d9' },
};

function styleFor(type: string) {
  return TYPE_STYLES[type] || { icon: '•', bg: '#f4f1ee', color: 'var(--ink)' };
}

function formatWhen(at: string): string {
  const d = new Date(at);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-FR', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function AssetTimeline({ assetId }: { assetId: number }) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.get<{ asset_id: number; events: TimelineEvent[] }>(`/assets/${assetId}/timeline`)
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) { setError(err); return; }
        setEvents(data?.events ?? []);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [assetId]);

  if (loading) return <p style={{ color: 'var(--muted)', fontSize: 13 }}>Loading history…</p>;
  if (error) return <p style={{ color: 'crimson', fontSize: 13 }}>{error}</p>;
  if (events.length === 0) return <p style={{ color: 'var(--muted)', fontSize: 13 }}>No history yet for this asset.</p>;

  return (
    <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
      {events.map((ev, i) => {
        const s = styleFor(ev.type);
        return (
          <div
            key={`${ev.type}-${ev.source_id}-${i}`}
            style={{
              display: 'flex',
              gap: 12,
              padding: '10px 12px',
              background: '#fff',
              border: '1px solid var(--line)',
              borderRadius: 8,
              alignItems: 'flex-start',
            }}
          >
            <div style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: s.bg,
              color: s.color,
              display: 'grid',
              placeItems: 'center',
              fontSize: 15,
              flexShrink: 0,
            }}>
              {s.icon}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 13 }}>{ev.title}</strong>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{formatWhen(ev.at)}</span>
              </div>
              {ev.detail && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{ev.detail}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
