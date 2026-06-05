// src/components/InventoryStats.tsx
import React from "react";
import { useEffect, useState } from 'react';
import { api } from '../lib/apiClient';

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
    api.get<{ id: number; status: string; category_name: string | null }[]>(
      '/assets?limit=1000'
    ).then(({ data }) => {
      // ✅ Extract data from paginated response or direct array
      const rows = (data as unknown as { data: typeof data; count: number })?.data ?? data ?? [];

      // ✅ Count by status
      const statusCounts = (rows as { status: string }[]).reduce(
        (acc, a) => {
          acc[a.status] = (acc[a.status] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );

      // ✅ Count by category
      const catMap = new Map<string, number>();
      (rows as { category_name: string | null }[]).forEach(a => {
        const c = a.category_name || 'No category';
        catMap.set(c, (catMap.get(c) || 0) + 1);
      });

      // ✅ Calculate stats
      const inStockCount = statusCounts.in_stock || 0;
      const assignedCount = statusCounts.assigned || 0;
      const repairCount = statusCounts.repair || 0;
      const retiredCount = statusCounts.retired || 0;
      const totalCount = (rows as unknown[]).length;
      const availableCount = inStockCount + assignedCount + repairCount; // Exclude retired

      setStats({
        total: totalCount,
        available: availableCount,
        inStock: inStockCount,
        assigned: assignedCount,
        repair: repairCount,
        retired: retiredCount,
        categories: Array.from(catMap.entries())
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count),
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
