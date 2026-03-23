// src/components/InventoryStats.tsx
import React from "react";
import { useEffect, useState } from 'react';
import { api } from '../lib/apiClient';

type StatsData = { total: number; inStock: number; assigned: number; repair: number; categories: Array<{ name: string; count: number }>; };
type Props = { refreshTrigger?: number; onCategoryFilter?: (cat: string) => void; selectedCategory?: string; };

export default function InventoryStats({ refreshTrigger = 0, onCategoryFilter, selectedCategory = '' }: Props) {
  const [stats, setStats]   = useState<StatsData>({ total: 0, inStock: 0, assigned: 0, repair: 0, categories: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get<{ id: number; status: string; category_name: string | null }[]>('/assets?limit=1000').then(({ data }) => {
      const rows = (data as unknown as { data: typeof data; count: number })?.data ?? data ?? [];
      const statusCounts = (rows as { status: string }[]).reduce((acc, a) => { acc[a.status] = (acc[a.status] || 0) + 1; return acc; }, {} as Record<string, number>);
      const catMap = new Map<string, number>();
      (rows as { category_name: string | null }[]).forEach(a => {
        const c = a.category_name || 'Sans catégorie';
        catMap.set(c, (catMap.get(c) || 0) + 1);
      });
      setStats({
        total:    (rows as unknown[]).length,
        inStock:  statusCounts.in_stock  || 0,
        assigned: statusCounts.assigned  || 0,
        repair:   statusCounts.repair    || 0,
        categories: Array.from(catMap.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      });
      setLoading(false);
    });
  }, [refreshTrigger]);

  const handleCategoryClick = (name: string) => {
    if (!onCategoryFilter) return;
    onCategoryFilter(selectedCategory === name ? '' : name);
  };

  if (loading) return <div style={{ marginTop: 32, padding: 20, textAlign: 'center' }}>Chargement des statistiques...</div>;

  return (
    <div style={{ marginTop: 32, padding: 20, borderRadius: 8 }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 12, textAlign: 'center', color: 'var(--brand)' }}>{stats.total} assets disponibles</div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 24, flexWrap: 'wrap' }}>
          <StatBox label="En stock" value={stats.inStock} bg="#e8f5e8" color="#2d5a2d" />
          <StatBox label="Assigné" value={stats.assigned} bg="#e8f0ff" color="var(--brand)" />
          {stats.repair > 0 && <StatBox label="En réparation" value={stats.repair} bg="#fff3cd" color="#b98b46" />}
        </div>
      </div>
      {stats.categories.length > 0 && (
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, textAlign: 'center', color: 'var(--ink)' }}>Par catégorie</div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
            {stats.categories.map(cat => (
              <div key={cat.name}
                onClick={() => handleCategoryClick(cat.name)}
                style={{ textAlign: 'center', padding: '10px 14px', borderRadius: 6, minWidth: 80, cursor: onCategoryFilter ? 'pointer' : 'default', background: selectedCategory === cat.name ? 'var(--brand)' : '#fff', color: selectedCategory === cat.name ? '#fff' : 'var(--ink)', transition: 'all 0.2s ease' }}
              >
                <div style={{ fontSize: 12, marginBottom: 4, fontWeight: 500, opacity: selectedCategory === cat.name ? 1 : 0.7 }}>{cat.name}</div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>{cat.count}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatBox({ label, value, bg, color }: { label: string; value: number; bg: string; color: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '8px 16px', background: bg, borderRadius: 6 }}>
      <div style={{ fontSize: 14, color: '#666', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, color }}>{value}</div>
    </div>
  );
}
