// src/components/InventoryStats.tsx
import React from "react";
import { useEffect, useState } from 'react';
import { api, rpc } from '../lib/apiClient';

// ✅ Parse sûr: MySQL renvoie parfois les SUM/COUNT en string. Retourne 0 si NaN.
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

type StatsData = {
  total: number;           // All assets (including retired)
  available: number;       // Non-retired assets (in_stock + assigned + repair)
  inStock: number;
  assigned: number;
  repair: number;
  retired: number;         // Newly tracked
  categories: Array<{ name: string; count: number }>
};

type Props = {
  refreshTrigger?: number;
  onCategoryFilter?: (cat: string) => void;
  selectedCategory?: string;
};

export default function InventoryStats({
                                         refreshTrigger = 0,
                                         onCategoryFilter,
                                         selectedCategory = ''
                                       }: Props) {
  const [stats, setStats] = useState<StatsData>({
    total: 0,
    available: 0,
    inStock: 0,
    assigned: 0,
    repair: 0,
    retired: 0,
    categories: []
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);

    // ✅ Agrégation SQL côté serveur — plus de fetch limité à 1000 lignes recalculé en JS.
    Promise.all([
      rpc<{ total: number; in_stock: number; assigned: number; repair: number; retired: number }>('get_asset_stats'),
      api.get<{ id: number; name: string; type: string; assets_count: number }[]>('/categories?type=asset'),
    ]).then(([statsRes, catsRes]) => {
      const s = statsRes.data;
      const cats = catsRes.data ?? [];

      const totalCount = num(s?.total);
      const inStockCount = num(s?.in_stock);
      const assignedCount = num(s?.assigned);
      const repairCount = num(s?.repair);
      const retiredCount = num(s?.retired);
      const availableCount = inStockCount + assignedCount + repairCount; // Exclude retired

      const categorized = cats
        .map(c => ({ name: c.name, count: num(c.assets_count) }))
        .filter(c => c.count > 0);
      const categorizedTotal = categorized.reduce((sum, c) => sum + c.count, 0);
      const uncategorized = totalCount - categorizedTotal;
      if (uncategorized > 0) {
        categorized.push({ name: 'No category', count: uncategorized });
      }

      setStats({
        total: totalCount,
        available: availableCount,
        inStock: inStockCount,
        assigned: assignedCount,
        repair: repairCount,
        retired: retiredCount,
        categories: categorized.sort((a, b) => b.count - a.count),
      });
      setLoading(false);
    });
  }, [refreshTrigger]);

  const handleCategoryClick = (name: string) => {
    if (!onCategoryFilter) return;
    onCategoryFilter(selectedCategory === name ? '' : name);
  };

  if (loading) {
    return (
      <div style={{ marginTop: 32, padding: 20, textAlign: 'center' }}>
        Loading statistics…
      </div>
    );
  }

  return (
    <div style={{ marginTop: 32, padding: 20, borderRadius: 8 }}>
      {/* Summary Section */}
      <div style={{ marginBottom: 20 }}>
        <div style={{
          fontSize: 18,
          fontWeight: 600,
          marginBottom: 12,
          textAlign: 'center',
          color: 'var(--brand)'
        }}>
          {stats.available} assets available
        </div>
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          gap: 24,
          flexWrap: 'wrap'
        }}>
          <StatBox label="In Stock" value={stats.inStock} bg="#e8f5e8" color="#2d5a2d" />
          <StatBox label="Assigned" value={stats.assigned} bg="#e8f0ff" color="var(--brand)" />
          {stats.repair > 0 && (
            <StatBox label="In Repair" value={stats.repair} bg="#fff3cd" color="#b98b46" />
          )}
          {stats.retired > 0 && (
            <StatBox label="Retired" value={stats.retired} bg="#f5f5f5" color="#999" />
          )}
        </div>
      </div>

      {/* Category Breakdown */}
      {stats.categories.length > 0 && (
        <div>
          <div style={{
            fontSize: 16,
            fontWeight: 600,
            marginBottom: 12,
            textAlign: 'center',
            color: 'var(--ink)'
          }}>
            By Category
          </div>
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            gap: 12,
            flexWrap: 'wrap'
          }}>
            {stats.categories.map((cat, index) => (
              <div
                key={`${cat.name}-${index}`}
                onClick={() => handleCategoryClick(cat.name)}
                style={{
                  textAlign: 'center',
                  padding: '10px 14px',
                  borderRadius: 6,
                  minWidth: 80,
                  cursor: onCategoryFilter ? 'pointer' : 'default',
                  background: selectedCategory === cat.name ? 'var(--brand)' : '#fff',
                  color: selectedCategory === cat.name ? '#fff' : 'var(--ink)',
                  transition: 'all 0.2s ease'
                }}
              >
                <div style={{
                  fontSize: 12,
                  marginBottom: 4,
                  fontWeight: 500,
                  opacity: selectedCategory === cat.name ? 1 : 0.7
                }}>
                  {cat.name}
                </div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>
                  {cat.count}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Total info (smaller text) */}
      {stats.retired > 0 && (
        <div style={{
          marginTop: 16,
          textAlign: 'center',
          fontSize: 12,
          color: '#999'
        }}>
          Total: {stats.total} assets ({stats.available} available + {stats.retired} retired)
        </div>
      )}
    </div>
  );
}

function StatBox({
                   label,
                   value,
                   bg,
                   color
                 }: {
  label: string;
  value: number;
  bg: string;
  color: string
}) {
  return (
    <div style={{
      textAlign: 'center',
      padding: '8px 16px',
      background: bg,
      borderRadius: 6
    }}>
      <div style={{
        fontSize: 14,
        color: '#666',
        marginBottom: 2
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 20,
        fontWeight: 600,
        color
      }}>
        {value}
      </div>
    </div>
  );
}
