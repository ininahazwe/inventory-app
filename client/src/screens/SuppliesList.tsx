// src/screens/SuppliesList.tsx
// Page admin fournitures, organisée en 3 blocs :
//   1. Actions + filtres (mois, catégorie)
//   2. Period Overview — onglets Cost / Stock / Movements (branchés sur le ledger)
//   3. Purchases (lignes d'achat) + chart
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/apiClient';
import { todayDateString } from '../lib/dateHelpers';
import { useSupplies } from '../hooks/useSupplies';
import { useSupplyAssignments } from '../hooks/useSupplyAssignments';
import { usePermissions } from '../hooks/usePermissions';
import { AssignSupplyModal } from '../components/AssignSupplyModal';
import Modal from '../components/Modal';
import { SupplyTrendChart } from '../components/SupplyTrendChart';
import { exportToXlsx } from '../lib/exportXlsx';
import { exportToPdf } from '../lib/exportPdf';

const ITEMS_PER_PAGE = 5;
const STOCK_PER_PAGE = 8;
const MOVEMENTS_PER_PAGE = 10;

// ─── Barre de pagination réutilisable (même style pour les 3 tableaux) ───
const PaginationBar: React.FC<{
  page: number;
  totalItems: number;
  perPage: number;
  onChange: (p: number) => void;
}> = ({ page, totalItems, perPage, onChange }) => {
  const totalPages = Math.ceil(totalItems / perPage);
  if (totalPages <= 1) return null;

  const startIndex = (page - 1) * perPage;
  const endIndex = Math.min(startIndex + perPage, totalItems);

  const pages: (number | string)[] = [];
  const maxVisible = 5;
  if (totalPages <= maxVisible) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    const start = Math.max(1, page - 2);
    const end = Math.min(totalPages, start + maxVisible - 1);
    if (start > 1) {
      pages.push(1);
      if (start > 2) pages.push('...');
    }
    for (let i = start; i <= end; i++) pages.push(i);
    if (end < totalPages) {
      if (end < totalPages - 1) pages.push('...');
      pages.push(totalPages);
    }
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 16, padding: '8px 0' }}>
      <button className="pill admin" onClick={() => onChange(page - 1)} disabled={page === 1} style={{ opacity: page === 1 ? 0.5 : 1 }}>← Previous</button>
      {pages.map((p, i) => p === '...' ? <span key={`e${i}`} style={{ padding: '0 8px', color: 'var(--muted)' }}>…</span> : (
        <button key={p} className="pill" onClick={() => onChange(p as number)} style={{ background: page === p ? 'var(--brand)' : '#f4f1ee', color: page === p ? 'white' : 'var(--ink)', minWidth: 36, textAlign: 'center' }}>{p}</button>
      ))}
      <button className="pill admin" onClick={() => onChange(page + 1)} disabled={page === totalPages} style={{ opacity: page === totalPages ? 0.5 : 1 }}>Next →</button>
      <div style={{ marginLeft: 16, color: 'var(--muted)', fontSize: 14 }}>Showing {startIndex + 1}-{endIndex} of {totalItems}</div>
    </div>
  );
};

type CategorySummary = {
  category_name: string;
  period_purchased: number;
  period_issued: number;
  period_returned: number;
  period_adjusted: number;
  stock_at_end: number;
};

type Movement = {
  id: number;
  supply_id: number;
  supply_name: string;
  category_name: string | null;
  type: 'purchase' | 'issue' | 'return' | 'adjustment';
  qty: number;
  movement_date: string;
  notes: string | null;
  created_by: string | null;
};

type ActiveAssignment = {
  supply_id: number;
  status: string;
  quantity_assigned: number;
};

const MOVEMENT_STYLES: Record<Movement['type'], { label: string; bg: string; color: string }> = {
  purchase: { label: 'Purchase', bg: '#dbeafe', color: '#1e40af' },
  issue: { label: 'Issued', bg: '#fee2e2', color: '#991b1b' },
  return: { label: 'Returned', bg: '#dcfce7', color: '#15803d' },
  adjustment: { label: 'Adjustment', bg: '#fef3c7', color: '#b45309' },
};

export const SuppliesList: React.FC = () => {
  const navigate = useNavigate();
  const { isAdmin } = usePermissions();
  const { supplies, loading, error, fetchSupplies, deleteSupply } = useSupplies();
  const { fetchAssignments } = useSupplyAssignments();
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0')
  );
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [overviewTab, setOverviewTab] = useState<'cost' | 'stock' | 'movements'>('cost');
  const [currentPage, setCurrentPage] = useState(1);
  const [stockPage, setStockPage] = useState(1);
  const [movementsPage, setMovementsPage] = useState(1);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteSupplyId, setDeleteSupplyId] = useState<number | null>(null);
  const [deleteSupplyName, setDeleteSupplyName] = useState<string>('');
  const [assignments, setAssignments] = useState<ActiveAssignment[]>([]);

  // ✅ Ledger data (période = mois sélectionné)
  const [summary, setSummary] = useState<CategorySummary[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);

  // ✅ Adjustment modal (admin)
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjSupplyId, setAdjSupplyId] = useState<string>('');
  const [adjDirection, setAdjDirection] = useState<'out' | 'in'>('out');
  const [adjQty, setAdjQty] = useState<string>('1');
  const [adjDate, setAdjDate] = useState<string>(todayDateString());
  const [adjNotes, setAdjNotes] = useState<string>('');
  const [adjError, setAdjError] = useState<string | null>(null);
  const [adjSaving, setAdjSaving] = useState(false);

  // Nom lisible depuis l'email (pas de colonne name en base).
  // uid résiduel (36 chars sans @) -> '—'
  const displayUser = (value: string | null): string => {
    if (!value) return '—';
    if (!value.includes('@')) {
      return value.length === 36 ? '—' : value;
    }
    return value
      .split('@')[0]
      .split(/[._-]+/)
      .filter(Boolean)
      .map(p => p.charAt(0).toUpperCase() + p.slice(1))
      .join(' ');
  };

  // Conversion sûre (les SUM MySQL arrivent en string; undefined -> 0)
  const num = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  // Bornes de la période (mois sélectionné)
  const periodBounds = (yyyyMm: string): { from: string; to: string } => {
    const [y, m] = yyyyMm.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    return {
      from: `${yyyyMm}-01`,
      to: `${yyyyMm}-${String(lastDay).padStart(2, '0')}`,
    };
  };

  useEffect(() => {
    fetchSupplies();
    loadAssignments();
  }, [fetchSupplies]);

  // ✅ Ledger: summary + journal de la période
  const loadLedger = async () => {
    if (!selectedDate) return;
    const { from, to } = periodBounds(selectedDate);
    try {
      const [{ data: sumData }, { data: movData }] = await Promise.all([
        api.get<{ categories: CategorySummary[] }>(`/supply-movements/summary?from=${from}&to=${to}`),
        api.get<Movement[]>(`/supply-movements?from=${from}&to=${to}`),
      ]);
      setSummary(sumData?.categories ?? []);
      setMovements(Array.isArray(movData) ? movData : []);
    } catch (err) {
      console.error('Failed to load ledger:', err);
    }
  };

  useEffect(() => {
    loadLedger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  // ✅ Load assignments to calculate remaining stock (colonne Remaining du tableau)
  const loadAssignments = async () => {
    try {
      const { data } = await api.get<ActiveAssignment[]>('/supply-assignments?status=active');
      if (Array.isArray(data)) {
        setAssignments(data);
      }
    } catch (err) {
      console.error('Failed to load assignments:', err);
    }
  };

  // ✅ Stock restant temps réel par ligne d'achat
  const getRemaining = (supplyId: number): number => {
    const supply = supplies.find(s => s.id === supplyId);
    if (!supply) return 0;

    const assignedQty = assignments
      .filter(a => a.supply_id === supplyId && a.status === 'active')
      .reduce((sum, a) => sum + (a.quantity_assigned || 0), 0);

    return Math.max(0, supply.quantity - assignedQty);
  };

  // ✅ Alertes stock bas: seuil configuré (low_stock_threshold non null) ET
  // stock restant <= seuil. Réutilise getRemaining() — même définition du
  // "stock restant" que la colonne Remaining du tableau, pas de second calcul
  // divergent (ex: via le ledger complet) qui afficherait un chiffre différent.
  const lowStockSupplies = supplies.filter(
    s => s.low_stock_threshold != null && getRemaining(s.id) <= s.low_stock_threshold
  );

  const openDeleteConfirm = (id: number, name: string) => {
    setDeleteSupplyId(id);
    setDeleteSupplyName(name);
    setDeleteConfirmOpen(true);
  };

  const closeDeleteConfirm = () => {
    setDeleteConfirmOpen(false);
    setDeleteSupplyId(null);
    setDeleteSupplyName('');
  };

  const confirmDelete = async () => {
    if (deleteSupplyId !== null) {
      await deleteSupply(deleteSupplyId);
      closeDeleteConfirm();
      await loadLedger();
    }
  };

  // ✅ Adjustment (admin)
  const openAdjust = () => {
    setAdjSupplyId('');
    setAdjDirection('out');
    setAdjQty('1');
    setAdjDate(todayDateString());
    setAdjNotes('');
    setAdjError(null);
    setAdjustOpen(true);
  };

  const submitAdjust = async () => {
    setAdjError(null);
    const qtyNum = parseInt(adjQty, 10);
    if (!adjSupplyId) { setAdjError('Select a supply'); return; }
    if (isNaN(qtyNum) || qtyNum < 1) { setAdjError('Quantity must be at least 1'); return; }
    if (!adjDate) { setAdjError('Date required'); return; }

    try {
      setAdjSaving(true);
      const { error: apiError } = await api.post('/supply-movements', {
        supply_id: parseInt(adjSupplyId, 10),
        qty: adjDirection === 'out' ? -qtyNum : qtyNum,
        movement_date: adjDate,
        notes: adjNotes || undefined,
      });
      if (apiError) { setAdjError(apiError); return; }
      setAdjustOpen(false);
      await loadLedger();
    } finally {
      setAdjSaving(false);
    }
  };

  // ✅ dateString est une colonne DATE ('YYYY-MM-DD', pas d'heure/fuseau).
  // On force l'affichage en UTC pour ne pas dépendre du fuseau du navigateur
  // (sinon new Date('YYYY-MM-DD') est interprété comme minuit UTC, puis
  // toLocaleDateString() sans timeZone re-projette en local et peut afficher
  // le jour précédent pour un fuseau à offset négatif).
  const formatDate = (dateString: string) => {
    const [y, m, d] = dateString.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('fr-FR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
  };

  // ✅ Filter by category
  const filteredSupplies = selectedCategory
    ? supplies.filter(s => s.category_name === selectedCategory)
    : supplies;

  // ✅ Get unique categories
  const categories = Array.from(new Set(supplies.map(s => s.category_name).filter(Boolean)));

  // ✅ Filter by date (YYYY-MM format) — purchase_date est 'YYYY-MM-DD' brut
  // (colonne DATE), on découpe la chaîne directement plutôt que de passer par
  // new Date() + getters locaux, qui pouvaient décaler le mois d'une unité
  // selon le fuseau du navigateur.
  const dateFilteredSupplies = filteredSupplies.filter(s => {
    if (!selectedDate) return true;
    const dateStr = s.purchase_date.slice(0, 7); // 'YYYY-MM-DD' -> 'YYYY-MM'
    return dateStr === selectedDate;
  });

  // ✅ Cost stats par catégorie (achats de la période — cost = coût total de la ligne)
  const statsByCategory = categories.map(cat => {
    const suppliesInCat = dateFilteredSupplies.filter(s => s.category_name === cat);
    const totalCostCat = suppliesInCat.reduce((sum, s) => {
      const cost = parseFloat(String(s.cost)) || 0;
      return sum + cost;
    }, 0);
    const totalQty = suppliesInCat.reduce((sum, s) => sum + (parseInt(String(s.quantity)) || 1), 0);

    return {
      category: cat,
      count: suppliesInCat.length,
      totalCost: totalCostCat,
      totalQty: totalQty,
    };
  });

  const sortedStats = [...statsByCategory].sort((a, b) => b.totalCost - a.totalCost);

  // ✅ Ledger summary filtré par catégorie sélectionnée
  const filteredSummary = selectedCategory
    ? summary.filter(s => s.category_name === selectedCategory)
    : summary;

  const filteredMovements = selectedCategory
    ? movements.filter(m => m.category_name === selectedCategory)
    : movements;

  // ✅ Stock overview (depuis le ledger — historique exact de la période)
  const stockOverview = {
    stockAtEnd: filteredSummary.reduce((s, c) => s + num(c.stock_at_end), 0),
    periodIn: filteredSummary.reduce((s, c) => s + num(c.period_purchased) + num(c.period_returned) + Math.max(0, num(c.period_adjusted)), 0),
    periodOut: filteredSummary.reduce((s, c) => s + num(c.period_issued) + Math.max(0, -num(c.period_adjusted)), 0),
    depletedCategories: filteredSummary.filter(c => num(c.stock_at_end) === 0 && (num(c.period_purchased) > 0 || num(c.period_issued) > 0)).length,
  };

  // ✅ Cost overview (achats de la période)
  const overallStats = {
    totalSupplies: dateFilteredSupplies.length,
    totalCost: dateFilteredSupplies.reduce((sum, s) => {
      const cost = parseFloat(String(s.cost)) || 0;
      return sum + cost;
    }, 0),
    uniqueReceivers: new Set(dateFilteredSupplies.map(s => s.receiver_email).filter(Boolean)).size,
    uniqueCategories: sortedStats.filter(s => s.count > 0).length,
  };

  // ✅ Chart data (ledger)
  const chartData = filteredSummary.map(c => ({
    category: c.category_name,
    purchased: num(c.period_purchased),
    stock: num(c.stock_at_end),
  }));

  // ✅ Format date for display
  const formatDateDisplay = (dateStr: string) => {
    const [year, month] = dateStr.split('-');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${monthNames[parseInt(month) - 1]} ${year}`;
  };

  // ✅ Pagination
  const totalPages = Math.ceil(dateFilteredSupplies.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, dateFilteredSupplies.length);
  const paginatedSupplies = dateFilteredSupplies.slice(startIndex, endIndex);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
    setStockPage(1);
    setMovementsPage(1);
  }, [selectedCategory, selectedDate]);

  // ✅ Pagination onglets Stock / Movements
  const paginatedSummary = filteredSummary.slice((stockPage - 1) * STOCK_PER_PAGE, stockPage * STOCK_PER_PAGE);
  const paginatedMovements = filteredMovements.slice((movementsPage - 1) * MOVEMENTS_PER_PAGE, movementsPage * MOVEMENTS_PER_PAGE);

  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    const maxVisible = 5;
    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      const start = Math.max(1, currentPage - 2);
      const end = Math.min(totalPages, start + maxVisible - 1);
      if (start > 1) {
        pages.push(1);
        if (start > 2) pages.push('...');
      }
      for (let i = start; i <= end; i++) pages.push(i);
      if (end < totalPages) {
        if (end < totalPages - 1) pages.push('...');
        pages.push(totalPages);
      }
    }
    return pages;
  };

  const purchaseExportRows = () => dateFilteredSupplies.map(s => ({
    Name: s.name,
    Category: s.category_name || '',
    'Purchase Date': s.purchase_date,
    Quantity: s.quantity,
    Remaining: getRemaining(s.id),
    'Cost (GH₵)': parseFloat(String(s.cost)) || 0,
    Brand: s.brand || '',
    Receiver: s.receiver_email || '',
  }));

  const movementExportRows = () => filteredMovements.map(m => ({
    Date: m.movement_date,
    Supply: m.supply_name,
    Category: m.category_name || '',
    Type: MOVEMENT_STYLES[m.type].label,
    Qty: m.qty,
    By: displayUser(m.created_by),
    Notes: m.notes || '',
  }));

  const statCard = (label: string, value: React.ReactNode, bg: string, color: string) => (
    <div style={{ padding: '16px', background: bg, borderRadius: '8px' }}>
      <div style={{ fontSize: '13px', color: 'var(--muted)', marginBottom: '6px' }}>{label}</div>
      <div style={{ fontSize: '24px', fontWeight: 600, color }}>{value}</div>
    </div>
  );

  return (
    <div className="">
      <div style={{ marginBottom: '20px' }}>
        <h2 style={{ margin: '0 0 16px 0' }}>Supplies</h2>
      </div>

      {/* ═══ 1. Actions + Filters ═══ */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          className="pill admin"
          onClick={() => navigate('/supplies/create')}
          style={{ padding: '8px 16px', fontSize: '14px' }}
        >
          Add Supply
        </button>

        <button
          className="pill"
          onClick={() => setShowAssignModal(true)}
          style={{ padding: '8px 16px', fontSize: '14px', backgroundColor: 'var(--brand)', color: '#fff' }}
        >
          Assign Supply
        </button>

        {isAdmin && (
          <button
            className="pill"
            onClick={openAdjust}
            style={{ padding: '8px 16px', fontSize: '14px', backgroundColor: '#b45309', color: '#fff' }}
            title="Loss, breakage, inventory correction"
          >
            Adjust Stock
          </button>
        )}

        {/* Date Selector (YYYY-MM) */}
        <input
          type="month"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          style={{
            padding: '8px 12px',
            border: '1px solid var(--line)',
            borderRadius: '6px',
            fontSize: '14px',
            background: 'white',
            cursor: 'pointer',
          }}
        />

        {/* Category Filter */}
        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          style={{
            padding: '8px 12px',
            border: '1px solid var(--line)',
            borderRadius: '6px',
            fontSize: '14px',
            background: 'white',
            cursor: 'pointer',
          }}
        >
          <option value="">All Categories</option>
          {categories.map(cat => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>

        <div style={{ color: 'var(--muted)', fontSize: '13px', marginLeft: 'auto' }}>
          {loading && 'Loading...'}
          {error && <span style={{ color: '#991b1b' }}>Error: {error}</span>}
        </div>
      </div>

      {/* ✅ Bannière alertes stock bas */}
      {lowStockSupplies.length > 0 && (
        <div style={{
          marginBottom: '20px',
          padding: '12px 16px',
          background: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: '8px',
        }}>
          <div style={{ fontWeight: 600, color: '#991b1b', marginBottom: 6, fontSize: '14px' }}>
            ⚠️ {lowStockSupplies.length} supply {lowStockSupplies.length > 1 ? 'lines' : 'line'} low on stock
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {lowStockSupplies.map(s => (
              <span
                key={s.id}
                style={{
                  fontSize: '12px',
                  padding: '4px 10px',
                  background: '#fee2e2',
                  color: '#991b1b',
                  borderRadius: '999px',
                }}
                title={`Threshold: ${s.low_stock_threshold}`}
              >
                {s.name}: {getRemaining(s.id)} left
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ═══ 2. Period Overview (Cost / Stock / Movements) ═══ */}
      <div style={{ marginBottom: 30 }}>
        <h3 style={{ margin: '0 0 16px 0', color: 'var(--ink)', fontSize: '16px', fontWeight: 600 }}>
          Period Overview - {formatDateDisplay(selectedDate)} {selectedCategory && `(${selectedCategory})`}
        </h3>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', borderBottom: '1px solid var(--line)' }}>
          {([['cost', 'Cost'], ['stock', 'Stock'], ['movements', 'Movements']] as const).map(([tab, label]) => (
            <button
              key={tab}
              onClick={() => setOverviewTab(tab)}
              style={{
                padding: '8px 16px',
                fontSize: '14px',
                fontWeight: 600,
                border: 'none',
                borderBottom: overviewTab === tab ? '2px solid var(--brand)' : '2px solid transparent',
                background: 'transparent',
                color: overviewTab === tab ? 'var(--brand)' : 'var(--muted)',
                cursor: 'pointer',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── Cost tab ── */}
        {overviewTab === 'cost' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
              {statCard('Total Cost', <>GH₵ {overallStats.totalCost.toFixed(2)}</>, '#f0f9ff', '#1e40af')}
              {statCard('Receivers', overallStats.uniqueReceivers, '#fce7f3', '#be185d')}
              {statCard('Categories Used', overallStats.uniqueCategories, '#fff7ed', '#b45309')}
              {statCard('Purchases', overallStats.totalSupplies, '#f3e8ff', '#a21caf')}
            </div>

            {!selectedCategory && sortedStats.filter(s => s.count > 0).length > 0 && (
              <div style={{ marginTop: 20 }}>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                  gap: '12px',
                }}>
                  {sortedStats.filter(s => s.count > 0).map((stat, idx) => {
                    const colors = [
                      { bg: '#dbeafe', text: '#1e40af' },
                      { bg: '#dcfce7', text: '#15803d' },
                      { bg: '#fef3c7', text: '#b45309' },
                      { bg: '#fecaca', text: '#991b1b' },
                      { bg: '#d8b4fe', text: '#7c3aed' },
                      { bg: '#fbcfe8', text: '#be185d' },
                    ];
                    const color = colors[idx % colors.length];

                    return (
                      <div key={stat.category} style={{ padding: '16px', background: color.bg, borderRadius: '8px' }}>
                        <div style={{ fontSize: '14px', fontWeight: 600, color: color.text, marginBottom: '8px' }}>
                          {stat.category}
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>
                          Purchases: <strong>{stat.count}</strong> · Qty: <strong>{stat.totalQty}</strong>
                        </div>
                        <div style={{ fontSize: '18px', fontWeight: 600, color: color.text }}>
                          GH₵ {stat.totalCost.toFixed(2)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {/* ── Stock tab (ledger: état exact de la période) ── */}
        {overviewTab === 'stock' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
              {statCard('Stock at End of Period', stockOverview.stockAtEnd, '#ecfdf5', '#15803d')}
              {statCard('In (period)', `+${stockOverview.periodIn}`, '#f0f9ff', '#1e40af')}
              {statCard('Out (period)', `-${stockOverview.periodOut}`, '#fef2f2', '#991b1b')}
              {statCard('Depleted Categories', stockOverview.depletedCategories, '#fff7ed', '#b45309')}
            </div>

            {filteredSummary.length > 0 && (
              <div style={{ marginTop: 20, overflowX: 'auto' }}>
                <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                  <tr style={{ backgroundColor: 'var(--brand)', color: '#fff' }}>
                    <th style={{ padding: '10px 12px', textAlign: 'left' }}>Category</th>
                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>Purchased</th>
                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>Issued</th>
                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>Returned</th>
                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>Adjusted</th>
                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>Stock at End</th>
                  </tr>
                  </thead>
                  <tbody>
                  {paginatedSummary.map(c => (
                    <tr key={c.category_name} style={{ borderBottom: '1px solid var(--line)' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 500 }}>{c.category_name}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: '#1e40af' }}>{num(c.period_purchased) > 0 ? `+${num(c.period_purchased)}` : '—'}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: '#991b1b' }}>{num(c.period_issued) > 0 ? `-${num(c.period_issued)}` : '—'}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: '#15803d' }}>{num(c.period_returned) > 0 ? `+${num(c.period_returned)}` : '—'}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: '#b45309' }}>{num(c.period_adjusted) !== 0 ? (num(c.period_adjusted) > 0 ? `+${num(c.period_adjusted)}` : num(c.period_adjusted)) : '—'}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, color: num(c.stock_at_end) === 0 ? '#991b1b' : 'var(--ink)' }}>{num(c.stock_at_end)}</td>
                    </tr>
                  ))}
                  </tbody>
                </table>
                <PaginationBar page={stockPage} totalItems={filteredSummary.length} perPage={STOCK_PER_PAGE} onChange={setStockPage} />
              </div>
            )}
          </>
        )}

        {/* ── Movements tab (journal du mois) ── */}
        {overviewTab === 'movements' && (
          filteredMovements.length > 0 ? (
            <div style={{ overflowX: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 8 }}>
                <button
                  className="pill admin"
                  style={{ padding: '6px 12px', fontSize: '12px' }}
                  onClick={() => exportToXlsx(`supply-movements-${selectedDate}.xlsx`, 'Movements', movementExportRows())}
                >
                  ⬇ XLSX
                </button>
                <button
                  className="pill admin"
                  style={{ padding: '6px 12px', fontSize: '12px' }}
                  onClick={() => exportToPdf(`supply-movements-${selectedDate}.pdf`, `Movements - ${formatDateDisplay(selectedDate)}`, movementExportRows())}
                >
                  ⬇ PDF
                </button>
              </div>
              <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>

                <tr style={{ backgroundColor: 'var(--brand)', color: '#fff' }}>
                  <th style={{ padding: '10px 12px', textAlign: 'left' }}>Date</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left' }}>Supply</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left' }}>Category</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left' }}>Type</th>
                  <th style={{ padding: '10px 12px', textAlign: 'right' }}>Qty</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left' }}>By</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left' }}>Notes</th>
                </tr>
                </thead>
                <tbody>
                {paginatedMovements.map(m => {
                  const ms = MOVEMENT_STYLES[m.type];
                  return (
                    <tr key={m.id} style={{ borderBottom: '1px solid var(--line)' }}>
                      <td style={{ padding: '10px 12px', fontSize: '13px', color: 'var(--muted)' }}>{formatDate(m.movement_date)}</td>
                      <td style={{ padding: '10px 12px', fontWeight: 500 }}>{m.supply_name}</td>
                      <td style={{ padding: '10px 12px', fontSize: '13px' }}>{m.category_name || '—'}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{ background: ms.bg, color: ms.color, padding: '3px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }}>
                          {ms.label}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, color: m.qty >= 0 ? '#15803d' : '#991b1b' }}>
                        {m.qty > 0 ? `+${m.qty}` : m.qty}
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: '13px', color: 'var(--muted)' }} title={m.created_by || undefined}>{displayUser(m.created_by)}</td>
                      <td style={{ padding: '10px 12px', fontSize: '13px', color: 'var(--muted)' }}>{m.notes || '—'}</td>
                    </tr>
                  );
                })}
                </tbody>
              </table>
              <PaginationBar page={movementsPage} totalItems={filteredMovements.length} perPage={MOVEMENTS_PER_PAGE} onChange={setMovementsPage} />
            </div>
          ) : (
            <div style={{ padding: '30px 20px', textAlign: 'center', color: 'var(--muted)', backgroundColor: '#f4f1ee', borderRadius: '14px' }}>
              No stock movements for {formatDateDisplay(selectedDate)} {selectedCategory && `in ${selectedCategory}`}
            </div>
          )
        )}
      </div>

      {/* ═══ 3. Purchases (lignes d'achat de la période) ═══ */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ margin: 0, color: 'var(--ink)', fontSize: '16px', fontWeight: 600 }}>
          Purchases - {formatDateDisplay(selectedDate)}
        </h3>
        {dateFilteredSupplies.length > 0 && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="pill admin"
              style={{ padding: '6px 12px', fontSize: '12px' }}
              onClick={() => exportToXlsx(`supplies-purchases-${selectedDate}.xlsx`, 'Purchases', purchaseExportRows())}
            >
              ⬇ XLSX
            </button>
            <button
              className="pill admin"
              style={{ padding: '6px 12px', fontSize: '12px' }}
              onClick={() => exportToPdf(`supplies-purchases-${selectedDate}.pdf`, `Purchases - ${formatDateDisplay(selectedDate)}`, purchaseExportRows())}
            >
              ⬇ PDF
            </button>
          </div>
        )}
      </div>
      {dateFilteredSupplies.length > 0 ? (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
              <tr style={{ backgroundColor: 'var(--brand)', color: '#fff' }}>
                <th style={{ padding: '12px', textAlign: 'left' }}>Name</th>
                <th style={{ padding: '12px', textAlign: 'left' }}>Category</th>
                <th style={{ padding: '12px', textAlign: 'left' }}>Purchase Date</th>
                <th style={{ padding: '12px', textAlign: 'left' }}>Quantity</th>
                <th style={{ padding: '12px', textAlign: 'left' }}>Remaining</th>
                <th style={{ padding: '12px', textAlign: 'left' }}>Cost (GH₵)</th>
                <th style={{ padding: '12px', textAlign: 'left' }}>Brand</th>
                <th style={{ padding: '12px', textAlign: 'left' }}>Receiver</th>
                <th style={{ padding: '12px', textAlign: 'right' }}>Actions</th>
              </tr>
              </thead>
              <tbody>
              {paginatedSupplies.map(supply => (
                <tr
                  key={supply.id}
                  style={{
                    borderBottom: '1px solid var(--line)',
                    transition: 'background-color .2s ease',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#fbf8f6')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <td style={{ padding: '12px', fontWeight: 500 }}>{supply.name}</td>
                  <td style={{ padding: '12px', fontSize: '13px' }}>
                    {supply.category_name ? (
                      <span style={{
                        background: '#e3f2fd',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '12px',
                      }}>
                        {supply.category_name}
                      </span>
                    ) : '—'}
                  </td>
                  <td style={{ padding: '12px', fontSize: '13px', color: 'var(--muted)' }}>
                    {formatDate(supply.purchase_date)}
                  </td>
                  <td style={{ padding: '12px', textAlign: 'center' }}>{supply.quantity}</td>
                  <td style={{ padding: '12px', textAlign: 'center', fontWeight: 500, color: getRemaining(supply.id) === 0 ? '#991b1b' : 'var(--ink)' }}>
                    {getRemaining(supply.id)}
                    {supply.low_stock_threshold != null && getRemaining(supply.id) <= supply.low_stock_threshold && (
                      <span
                        title={`Low stock (threshold: ${supply.low_stock_threshold})`}
                        style={{
                          marginLeft: 6,
                          fontSize: '11px',
                          padding: '2px 6px',
                          background: '#fee2e2',
                          color: '#991b1b',
                          borderRadius: '999px',
                        }}
                      >
                        low
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '12px', fontWeight: 500 }}>{parseFloat(String(supply.cost)).toFixed(2)}</td>
                  <td style={{ padding: '12px', fontSize: '13px', color: 'var(--muted)' }}>
                    {supply.brand || '—'}
                  </td>
                  <td style={{ padding: '12px', fontSize: '13px', color: 'var(--muted)' }}>
                    {supply.receiver_email || '—'}
                  </td>
                  <td style={{ padding: '12px', textAlign: 'right' }}>
                    <button
                      className="pill"
                      style={{ padding: '6px 12px', fontSize: '12px', backgroundColor: 'var(--brand)', color: '#fff', marginRight: '6px' }}
                      onClick={() => navigate(`/supplies/${supply.id}/edit`)}
                    >
                      Edit
                    </button>
                    <button
                      className="pill"
                      style={{ padding: '6px 12px', fontSize: '12px', backgroundColor: '#991b1b', color: '#fff' }}
                      onClick={() => openDeleteConfirm(supply.id, supply.name)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              </tbody>
            </table>
          </div>

          {/* ✅ Pagination */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 20, padding: '16px 0' }}>
              <button className="pill admin" onClick={() => setCurrentPage(p => p - 1)} disabled={currentPage === 1} style={{ opacity: currentPage === 1 ? 0.5 : 1 }}>← Previous</button>
              {getPageNumbers().map((page, i) => page === '...' ? <span key={i} style={{ padding: '0 8px', color: 'var(--muted)' }}>…</span> : (
                <button key={page} className="pill" onClick={() => setCurrentPage(page as number)} style={{ background: currentPage === page ? 'var(--brand)' : '#f4f1ee', color: currentPage === page ? 'white' : 'var(--ink)', minWidth: 36, textAlign: 'center' }}>{page}</button>
              ))}
              <button className="pill admin" onClick={() => setCurrentPage(p => p + 1)} disabled={currentPage === totalPages} style={{ opacity: currentPage === totalPages ? 0.5 : 1 }}>Next →</button>
              {dateFilteredSupplies.length > 0 && <div style={{ marginLeft: 16, color: 'var(--muted)', fontSize: 14 }}>Showing {startIndex + 1}-{endIndex} of {dateFilteredSupplies.length}</div>}
            </div>
          )}
        </>
      ) : (
        <div
          style={{
            padding: '40px 20px',
            textAlign: 'center',
            color: 'var(--muted)',
            backgroundColor: '#f4f1ee',
            borderRadius: '14px',
          }}
        >
          <p style={{ margin: 0 }}>No purchases for {formatDateDisplay(selectedDate)} {selectedCategory && `in ${selectedCategory}`}</p>
        </div>
      )}

      {/* ═══ 4. Chart (ledger de la période) ═══ */}
      <SupplyTrendChart stats={chartData} />

      {/* ✅ Assign Supply Modal */}
      {showAssignModal && (
        <AssignSupplyModal
          supplies={supplies}
          onAssigned={() => {
            fetchSupplies();
            fetchAssignments();
            loadAssignments();
            loadLedger();
          }}
          onClose={() => setShowAssignModal(false)}
        />
      )}

      {/* ✅ Adjustment Modal (admin) */}
      <Modal open={adjustOpen} onClose={() => setAdjustOpen(false)} title="Stock Adjustment">
        <div style={{ display: 'grid', gap: 14 }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <strong>Supply *</strong>
            <select
              className="field"
              value={adjSupplyId}
              onChange={e => setAdjSupplyId(e.target.value)}
              style={{ padding: 8, border: '1px solid #ddd', borderRadius: 4 }}
            >
              <option value="">— Select a supply —</option>
              {supplies.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name}{s.brand ? ` (${s.brand})` : ''} — bought {s.quantity}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <strong>Direction *</strong>
            <select
              className="field"
              value={adjDirection}
              onChange={e => setAdjDirection(e.target.value as 'out' | 'in')}
              style={{ padding: 8, border: '1px solid #ddd', borderRadius: 4 }}
            >
              <option value="out">Out — loss, breakage, write-off (−)</option>
              <option value="in">In — inventory correction (+)</option>
            </select>
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <strong>Quantity *</strong>
              <input
                type="number"
                min="1"
                value={adjQty}
                onChange={e => setAdjQty(e.target.value)}
                style={{ padding: 8, border: '1px solid #ddd', borderRadius: 4 }}
              />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <strong>Date *</strong>
              <input
                type="date"
                value={adjDate}
                onChange={e => setAdjDate(e.target.value)}
                style={{ padding: 8, border: '1px solid #ddd', borderRadius: 4 }}
              />
            </label>
          </div>

          <label style={{ display: 'grid', gap: 6 }}>
            <strong>Notes</strong>
            <input
              type="text"
              placeholder="e.g., 2 broken during move"
              value={adjNotes}
              onChange={e => setAdjNotes(e.target.value)}
              style={{ padding: 8, border: '1px solid #ddd', borderRadius: 4 }}
            />
          </label>

          {adjError && <p style={{ color: 'crimson', margin: 0 }}>{adjError}</p>}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="pill" style={{ background: '#bbb' }} onClick={() => setAdjustOpen(false)}>Cancel</button>
            <button className="pill" style={{ background: '#b45309', color: '#fff' }} disabled={adjSaving} onClick={submitAdjust}>
              {adjSaving ? 'Saving…' : 'Save Adjustment'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ✅ Delete Confirmation Modal */}
      <Modal open={deleteConfirmOpen} onClose={closeDeleteConfirm} title={`Delete: ${deleteSupplyName}`}>
        <p>Are you sure you want to delete this supply? This action cannot be undone.</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="pill" style={{ background: '#bbb' }} onClick={closeDeleteConfirm}>Cancel</button>
          <button className="pill" style={{ background: '#991b1b', color: '#fff' }} onClick={confirmDelete}>Delete</button>
        </div>
      </Modal>
    </div>
  );
};
