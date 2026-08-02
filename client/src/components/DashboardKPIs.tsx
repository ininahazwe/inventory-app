// src/components/DashboardKPIs.tsx
// KPIs croisés pour la page d'accueil: valeur du parc, coût supplies du mois,
// incidents ouverts, enchères actives — vue transversale plutôt qu'une entrée
// par module (chaque chiffre vient déjà d'une table différente, agrégé côté serveur).
import React from 'react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { rpc } from '../lib/apiClient';

type Kpis = {
  fleet_value: number;
  supplies_cost_month: number;
  open_incidents: number;
  active_auctions: number;
};

export default function DashboardKPIs() {
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    rpc<Kpis>('get_dashboard_kpis').then(({ data }) => {
      if (!cancelled && data) setKpis(data);
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) return null;
  if (!kpis) return null;

  const cards: { label: string; value: string; bg: string; color: string; to: string }[] = [
    { label: 'Fleet Value', value: `GH₵${kpis.fleet_value.toLocaleString('en-GB', { maximumFractionDigits: 0 })}`, bg: '#e8f0ff', color: '#1e40af', to: '/' },
    { label: 'Supplies Cost (This Month)', value: `GH₵${kpis.supplies_cost_month.toLocaleString('en-GB', { maximumFractionDigits: 0 })}`, bg: '#f0fdf4', color: '#15803d', to: '/supplies' },
    { label: 'Open Incidents', value: String(kpis.open_incidents), bg: kpis.open_incidents > 0 ? '#fee2e2' : '#f4f1ee', color: kpis.open_incidents > 0 ? '#991b1b' : '#6b7280', to: '/incidents' },
    { label: 'Active Auctions', value: String(kpis.active_auctions), bg: '#ede9fe', color: '#6d28d9', to: '/auctions' },
  ];

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: 12,
      marginBottom: 20,
    }}>
      {cards.map(c => (
        <Link
          key={c.label}
          to={c.to}
          style={{
            padding: '14px 16px',
            background: c.bg,
            borderRadius: 8,
            textDecoration: 'none',
            display: 'block',
          }}
        >
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 4 }}>{c.label}</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: c.color }}>{c.value}</div>
        </Link>
      ))}
    </div>
  );
}
