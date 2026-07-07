// src/components/SupplyTrendChart.tsx
// Line chart: quantity purchased vs quantity remaining in stock, per category.
// Data passed in is already scoped to the parent's active filters (date + category).
import React from 'react';

export interface SupplyTrendPoint {
  category: string;
  count: number;
  totalQty: number;
  remainingQty: number;
}

interface Props {
  stats: SupplyTrendPoint[];
}

const WIDTH = 800;
const HEIGHT = 320;
const PADDING_LEFT = 48;
const PADDING_RIGHT = 24;
const PADDING_TOP = 24;
const PADDING_BOTTOM = 64;

export const SupplyTrendChart: React.FC<Props> = ({ stats }) => {
  const data = stats.filter(s => s.count > 0);

  if (data.length === 0) {
    return null;
  }

  const plotWidth = WIDTH - PADDING_LEFT - PADDING_RIGHT;
  const plotHeight = HEIGHT - PADDING_TOP - PADDING_BOTTOM;
  const maxVal = Math.max(1, ...data.map(d => Math.max(d.totalQty, d.remainingQty)));

  const xFor = (i: number) => data.length === 1
    ? PADDING_LEFT + plotWidth / 2
    : PADDING_LEFT + (i / (data.length - 1)) * plotWidth;
  const yFor = (v: number) => PADDING_TOP + plotHeight - (v / maxVal) * plotHeight;

  const purchasedPoints = data.map((d, i) => `${xFor(i)},${yFor(d.totalQty)}`).join(' ');
  const remainingPoints = data.map((d, i) => `${xFor(i)},${yFor(d.remainingQty)}`).join(' ');

  // Y-axis ticks (0, mid, max)
  const yTicks = [0, Math.round(maxVal / 2), maxVal];

  return (
    <div style={{ marginTop: 30 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ margin: 0, color: 'var(--ink)', fontSize: '16px', fontWeight: 600 }}>
          Purchased vs Remaining Stock — by Category
        </h3>
        <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--muted)' }}>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: '#1e40af', marginRight: 6 }} />Quantity Purchased</span>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: '#15803d', marginRight: 6 }} />Remaining in Stock</span>
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{ width: '100%', minWidth: 480, height: 'auto' }}>
          {/* Gridlines + Y labels */}
          {yTicks.map((tick, i) => {
            const y = yFor(tick);
            return (
              <g key={i}>
                <line x1={PADDING_LEFT} y1={y} x2={WIDTH - PADDING_RIGHT} y2={y} stroke="var(--line)" strokeWidth={1} />
                <text x={PADDING_LEFT - 8} y={y + 4} textAnchor="end" fontSize={11} fill="var(--muted)">{tick}</text>
              </g>
            );
          })}

          {/* X axis category labels */}
          {data.map((d, i) => (
            <text
              key={d.category}
              x={xFor(i)}
              y={HEIGHT - PADDING_BOTTOM + 20}
              textAnchor="end"
              fontSize={11}
              fill="var(--muted)"
              transform={`rotate(-35 ${xFor(i)} ${HEIGHT - PADDING_BOTTOM + 20})`}
            >
              {d.category}
            </text>
          ))}

          {/* Lines */}
          <polyline points={purchasedPoints} fill="none" stroke="#1e40af" strokeWidth={2.5} />
          <polyline points={remainingPoints} fill="none" stroke="#15803d" strokeWidth={2.5} />

          {/* Points + tooltips */}
          {data.map((d, i) => (
            <g key={`p-${d.category}`}>
              <circle cx={xFor(i)} cy={yFor(d.totalQty)} r={4} fill="#1e40af">
                <title>{`${d.category} — Purchased: ${d.totalQty}`}</title>
              </circle>
              <circle cx={xFor(i)} cy={yFor(d.remainingQty)} r={4} fill="#15803d">
                <title>{`${d.category} — Remaining: ${d.remainingQty}`}</title>
              </circle>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
};

export default SupplyTrendChart;
