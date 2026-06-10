// src/screens/SuppliesList.tsx
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/apiClient';
import { useSupplies } from '../hooks/useSupplies';
import { useSupplyAssignments } from '../hooks/useSupplyAssignments';
import { AssignSupplyModal } from '../components/AssignSupplyModal';
import Modal from '../components/Modal';

const ITEMS_PER_PAGE = 5;

export const SuppliesList: React.FC = () => {
  const navigate = useNavigate();
  const { supplies, loading, error, fetchSupplies, deleteSupply } = useSupplies();
  const { fetchAssignments } = useSupplyAssignments();
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0')
  );
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteSupplyId, setDeleteSupplyId] = useState<number | null>(null);
  const [deleteSupplyName, setDeleteSupplyName] = useState<string>('');
  const [assignments, setAssignments] = useState<any[]>([]);

  useEffect(() => {
    fetchSupplies();
    loadAssignments();
  }, [fetchSupplies]);

  // ✅ Load assignments to calculate remaining stock
  const loadAssignments = async () => {
    try {
      const { data } = await api.get<any[]>('/supply-assignments?status=active');
      if (Array.isArray(data)) {
        setAssignments(data);
      }
    } catch (err) {
      console.error('Failed to load assignments:', err);
    }
  };

  // ✅ Calculate remaining stock
  const getRemaining = (supplyId: number): number => {
    const supply = supplies.find(s => s.id === supplyId);
    if (!supply) return 0;

    const assignedQty = assignments
      .filter(a => a.supply_id === supplyId && a.status === 'active')
      .reduce((sum, a) => sum + (a.quantity_assigned || 0), 0);

    return Math.max(0, supply.quantity - assignedQty);
  };

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
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('fr-FR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  // ✅ Filter by category
  const filteredSupplies = selectedCategory
    ? supplies.filter(s => s.category_name === selectedCategory)
    : supplies;

  // ✅ Get unique categories
  const categories = Array.from(new Set(supplies.map(s => s.category_name).filter(Boolean)));

  // ✅ Filter by date (YYYY-MM format)
  const dateFilteredSupplies = filteredSupplies.filter(s => {
    if (!selectedDate) return true;
    const date = new Date(s.purchase_date);
    const year = date.getFullYear().toString();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const dateStr = `${year}-${month}`;
    return dateStr === selectedDate;
  });

  // ✅ Calculate stats by category
  const statsByCategory = categories.map(cat => {
    const suppliesInCat = dateFilteredSupplies.filter(s => s.category_name === cat);
    const totalCostCat = suppliesInCat.reduce((sum, s) => {
      const cost = parseFloat(String(s.cost)) || 0;
      return sum + cost;
    }, 0);
    const totalQty = suppliesInCat.reduce((sum, s) => sum + (parseInt(String(s.quantity)) || 1), 0);
    const costPerUnit = totalQty > 0 ? totalCostCat / totalQty : 0;

    return {
      category: cat,
      count: suppliesInCat.length,
      totalCost: totalCostCat,
      costPerUnit: costPerUnit,
      totalQty: totalQty,
    };
  });

  // ✅ Sort by total cost descending
  const sortedStats = [...statsByCategory].sort((a, b) => b.totalCost - a.totalCost);

  // ✅ Overall stats
  const overallStats = {
    totalSupplies: dateFilteredSupplies.length,
    totalCost: dateFilteredSupplies.reduce((sum, s) => {
      const cost = parseFloat(String(s.cost)) || 0;
      return sum + cost;
    }, 0),
    uniqueReceivers: new Set(dateFilteredSupplies.map(s => s.receiver_email).filter(Boolean)).size,
    uniqueCategories: sortedStats.filter(s => s.count > 0).length,
  };

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
  }, [selectedCategory, selectedDate]);

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

  return (
    <div className="">
      <div style={{ marginBottom: '20px' }}>
        <h2 style={{ margin: '0 0 16px 0' }}>Supplies</h2>
        {/*<p style={{ margin: 0, color: 'var(--muted)', fontSize: '14px' }}>
          Total Cost: GH₵ {parseFloat(String(totalCost)).toFixed(2)}
        </p>*/}
      </div>

      {/* Filters Bar */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          className="pill"
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

      {/* Table */}
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
                <th style={{ padding: '12px', textAlign: 'left' }}>Cost</th>
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
                  </td>
                  <td style={{ padding: '12px', fontWeight: 500 }}>GH₵ {parseFloat(String(supply.cost)).toFixed(2)}</td>
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
              <button className="pill" onClick={() => setCurrentPage(p => p - 1)} disabled={currentPage === 1} style={{ opacity: currentPage === 1 ? 0.5 : 1 }}>← Previous</button>
              {getPageNumbers().map((page, i) => page === '...' ? <span key={i} style={{ padding: '0 8px', color: 'var(--muted)' }}>…</span> : (
                <button key={page} className="pill" onClick={() => setCurrentPage(page as number)} style={{ background: currentPage === page ? 'var(--brand)' : '#f4f1ee', color: currentPage === page ? 'white' : 'var(--ink)', minWidth: 36, textAlign: 'center' }}>{page}</button>
              ))}
              <button className="pill" onClick={() => setCurrentPage(p => p + 1)} disabled={currentPage === totalPages} style={{ opacity: currentPage === totalPages ? 0.5 : 1 }}>Next →</button>
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
          <p style={{ margin: 0 }}>No supplies found for {formatDateDisplay(selectedDate)} {selectedCategory && `in ${selectedCategory}`}</p>
        </div>
      )}

      {/* ✅ Advanced Statistics */}
      {dateFilteredSupplies.length > 0 && (
        <div style={{ marginTop: '30px' }}>
          {/* Overall Stats */}
          <div style={{ marginBottom: 30 }}>
            <h3 style={{ margin: '0 0 16px 0', color: 'var(--ink)', fontSize: '16px', fontWeight: 600 }}>
              Period Overview - {formatDateDisplay(selectedDate)} {selectedCategory && `(${selectedCategory})`}
            </h3>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '12px',
            }}>
              <div style={{ padding: '16px', background: '#f0f9ff', borderRadius: '8px' }}>
                <div style={{ fontSize: '13px', color: 'var(--muted)', marginBottom: '6px' }}>Total Cost</div>
                <div style={{ fontSize: '24px', fontWeight: 600, color: '#1e40af' }}>
                  GH₵ {overallStats.totalCost.toFixed(2)}
                </div>
              </div>

              <div style={{ padding: '16px', background: '#fce7f3', borderRadius: '8px' }}>
                <div style={{ fontSize: '13px', color: 'var(--muted)', marginBottom: '6px' }}>Receivers</div>
                <div style={{ fontSize: '24px', fontWeight: 600, color: '#be185d' }}>
                  {overallStats.uniqueReceivers}
                </div>
              </div>

              <div style={{ padding: '16px', background: '#fff7ed', borderRadius: '8px' }}>
                <div style={{ fontSize: '13px', color: 'var(--muted)', marginBottom: '6px' }}>Categories Used</div>
                <div style={{ fontSize: '24px', fontWeight: 600, color: '#b45309' }}>
                  {overallStats.uniqueCategories}
                </div>
              </div>

              <div style={{ padding: '16px', background: '#f3e8ff', borderRadius: '8px' }}>
                <div style={{ fontSize: '13px', color: 'var(--muted)', marginBottom: '6px' }}>Supplies</div>
                <div style={{ fontSize: '24px', fontWeight: 600, color: '#a21caf' }}>
                  {overallStats.totalSupplies}
                </div>
              </div>
            </div>
          </div>

          {/* Cost by Category */}
          {!selectedCategory && sortedStats.filter(s => s.count > 0).length > 0 && (
            <div>
              <h3 style={{ margin: '0 0 16px 0', color: 'var(--ink)', fontSize: '16px', fontWeight: 600 }}>
                Cost Breakdown by Category
              </h3>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                gap: '12px',
              }}>
                {sortedStats.filter(s => s.count > 0).map((stat, idx) => {
                  const colors = [
                    { bg: '#dbeafe', border: '#93c5fd', text: '#1e40af' },
                    { bg: '#dcfce7', border: '#86efac', text: '#15803d' },
                    { bg: '#fef3c7', border: '#fcd34d', text: '#b45309' },
                    { bg: '#fecaca', border: '#fca5a5', text: '#991b1b' },
                    { bg: '#d8b4fe', border: '#e9d5ff', text: '#7c3aed' },
                    { bg: '#fbcfe8', border: '#f472b6', text: '#be185d' },
                  ];
                  const color = colors[idx % colors.length];

                  return (
                    <div
                      key={stat.category}
                      style={{
                        padding: '16px',
                        background: color.bg,
                        //border: `1px solid ${color.border}`,
                        borderRadius: '8px',
                      }}
                    >
                      <div style={{ fontSize: '14px', fontWeight: 600, color: color.text, marginBottom: '8px' }}>
                        {stat.category}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>
                        Items: <strong>{stat.count}</strong>
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>
                        Qty: <strong>{stat.totalQty}</strong>
                      </div>
                      {/*<div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '8px' }}>
                        Cost/Unit: <strong>GH₵ {stat.costPerUnit.toFixed(2)}</strong>
                      </div>*/}
                      <div style={{ fontSize: '18px', fontWeight: 600, color: color.text }}>
                        GH₵ {stat.totalCost.toFixed(2)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ✅ Assign Supply Modal */}
      {showAssignModal && (
        <AssignSupplyModal
          supplies={supplies}
          onAssigned={() => {
            fetchSupplies();
            fetchAssignments();
          }}
          onClose={() => setShowAssignModal(false)}
        />
      )}

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
