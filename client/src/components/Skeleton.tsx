// Loading placeholders. Wrap in <SkeletonGroup> so they only appear if the
// load takes longer than ~150 ms (see .skel-delay in theme.css).
import React from 'react';

export function Skeleton({ width = '100%', height = 16, radius, style }: {
  width?: number | string; height?: number | string; radius?: number; style?: React.CSSProperties;
}) {
  return <span className="skel" style={{ width, height, borderRadius: radius, ...style }} aria-hidden />;
}

export function SkeletonGroup({ children, label = 'Loading…', style }: {
  children: React.ReactNode; label?: string; style?: React.CSSProperties;
}) {
  return (
    <div className="skel-delay" role="status" aria-label={label} aria-busy="true" style={style}>
      {children}
    </div>
  );
}

/** Table body rows (use inside <tbody>). */
export function SkeletonTableRows({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i} className="skel-delay">
          {Array.from({ length: cols }).map((__, j) => (
            <td key={j}><Skeleton width={j === 0 ? '70%' : '50%'} height={14} /></td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** Row of stat cards (counters). */
export function SkeletonStatRow({ count = 6, height = 64 }: { count?: number; height?: number }) {
  return (
    <SkeletonGroup style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '20px 0' }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{ flex: '1 1 120px' }}><Skeleton height={height} radius={6} /></div>
      ))}
    </SkeletonGroup>
  );
}

/** List rows (div based, e.g. the Loans list). */
export function SkeletonListRows({ rows = 6 }: { rows?: number }) {
  return (
    <SkeletonGroup>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ padding: '14px 12px', borderTop: '1px solid #eee' }}>
          <Skeleton width="45%" height={14} />
          <Skeleton width="25%" height={11} style={{ marginTop: 8 }} />
        </div>
      ))}
    </SkeletonGroup>
  );
}

/** Generic detail / form page: title line + a few content blocks. */
export function SkeletonDetail({ blocks = 3 }: { blocks?: number }) {
  return (
    <SkeletonGroup style={{ maxWidth: 900, margin: '0 auto', padding: 20 }}>
      <Skeleton width="35%" height={28} />
      <Skeleton width="55%" height={14} style={{ marginTop: 10 }} />
      {Array.from({ length: blocks }).map((_, i) => (
        <Skeleton key={i} height={110} radius={8} style={{ marginTop: 20 }} />
      ))}
    </SkeletonGroup>
  );
}
