// src/components/SupplyTrendChart.tsx
// Line chart: quantité achetée sur la période vs stock en fin de période, par catégorie.
// Données issues du ledger (/supply-movements/summary), déjà filtrées par la page parente.
import React from 'react';

export interface SupplyTrendPoint {
  category: string;
  purchased: number;   // achats de la période
  stock: number;       // stock en fin de période
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
  const data = stats.filter(s => s.purchased !== 0 || s.stock !== 0);

  if (data.length === 0) {
    return null;
  }

  const plotWidth = WIDTH - PADDING_LEFT - PADDING_RIGHT;
  const plotHeight = HEIGHT - PADDING_TOP - PADDING_BOTTOM;
  const maxVal = Math.max(1, ...data.map(d => Math.max(d.purchased, d.stock)));

  const xFor = (i: number) => data.length === 1
    ? PADDING_LEFT + plotWidth / 2
    : PADDING_LEFT + (i / (data.length - 1)) * plotWidth;
  const yFor = (v: number) => PADDING_TOP + plotHeight - (Math.max(0, v) / maxVal) * plotHeight;

  const purchasedPoints = data.map((d, i) => `${xFor(i)},${yFor(d.purchased)}`).join(' ');
  const stockPoints = data.map((d, i) => `${xFor(i)},${yFor(d.stock)}`).join(' ');

  // Y-axis ticks (0, mid, max)
  const yTicks = [0, Math.round(maxVal / 2), maxVal];

  return (
    <div style={{ marginTop: 30 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ margin: 0, color: 'var(--ink)', fontSize: '16px', fontWeight: 600 }}>
          Purchased (period) vs Stock (end of period) — by Category
        </h3>
        <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--muted)' }}>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: '#1e40af', marginRight: 6 }} />Quantity Purchased</span>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: '#15803d', marginRight: 6 }} />Stock at End of Period</span>
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
          <polyline points={stockPoints} fill="none" stroke="#15803d" strokeWidth={2.5} />

          {/* Points + tooltips */}
          {data.map((d, i) => (
            <g key={`p-${d.category}`}>
              <circle cx={xFor(i)} cy={yFor(d.purchased)} r={4} fill="#1e40af">
                <title>{`${d.category} — Purchased: ${d.purchased}`}</title>
              </circle>
              <circle cx={xFor(i)} cy={yFor(d.stock)} r={4} fill="#15803d">
                <title>{`${d.category} — Stock at end: ${d.stock}`}</title>
              </circle>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
};

export default SupplyTrendChart;
