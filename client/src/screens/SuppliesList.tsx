// src/screens/SuppliesList.tsx
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSupplies } from '../hooks/useSupplies';

export const SuppliesList: React.FC = () => {
  const navigate = useNavigate();
  const { supplies, totalCost, loading, error, fetchSupplies, deleteSupply } = useSupplies();
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0')
  );

  useEffect(() => {
    fetchSupplies();
  }, [fetchSupplies]);

  const handleDelete = async (id: number) => {
    if (window.confirm('Confirm deletion?')) {
      await deleteSupply(id);
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
      const qty = parseInt(String(s.quantity)) || 1;
      return sum + (cost * qty);
    }, 0);
    const avgCostCat = suppliesInCat.length > 0
      ? suppliesInCat.reduce((sum, s) => sum + (parseFloat(String(s.cost)) || 0), 0) / suppliesInCat.length
      : 0;
    const totalQty = suppliesInCat.reduce((sum, s) => sum + (parseInt(String(s.quantity)) || 1), 0);

    return {
      category: cat,
      count: suppliesInCat.length,
      totalCost: totalCostCat,
      avgCost: avgCostCat,
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
      const qty = parseInt(String(s.quantity)) || 1;
      return sum + (cost * qty);
    }, 0),
    totalQuantity: dateFilteredSupplies.reduce((sum, s) => sum + (parseInt(String(s.quantity)) || 1), 0),
    avgCost: dateFilteredSupplies.length > 0
      ? dateFilteredSupplies.reduce((sum, s) => sum + (parseFloat(String(s.cost)) || 0), 0) / dateFilteredSupplies.length
      : 0,
    uniqueReceivers: new Set(dateFilteredSupplies.map(s => s.receiver_email).filter(Boolean)).size,
    uniqueCategories: sortedStats.filter(s => s.count > 0).length,
  };

  // ✅ Format date for display
  const formatDateDisplay = (dateStr: string) => {
    const [year, month] = dateStr.split('-');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${monthNames[parseInt(month) - 1]} ${year}`;
  };

  return (
    <div className="">
      <div style={{ marginBottom: '20px' }}>
        <h2 style={{ margin: '0 0 16px 0' }}>Supplies</h2>
        <p style={{ margin: 0, color: 'var(--muted)', fontSize: '14px' }}>
          Total Cost: GH₵ {parseFloat(String(totalCost)).toFixed(2)}
        </p>
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
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
            <tr style={{ backgroundColor: 'var(--brand)', color: '#fff' }}>
              <th style={{ padding: '12px', textAlign: 'left' }}>Name</th>
              <th style={{ padding: '12px', textAlign: 'left' }}>Category</th>
              <th style={{ padding: '12px', textAlign: 'left' }}>Purchase Date</th>
              <th style={{ padding: '12px', textAlign: 'left' }}>Cost</th>
              <th style={{ padding: '12px', textAlign: 'left' }}>Brand</th>
              <th style={{ padding: '12px', textAlign: 'left' }}>Quantity</th>
              <th style={{ padding: '12px', textAlign: 'left' }}>Receiver</th>
              <th style={{ padding: '12px', textAlign: 'right' }}>Actions</th>
            </tr>
            </thead>
            <tbody>
            {dateFilteredSupplies.map(supply => (
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
                <td style={{ padding: '12px', fontWeight: 500 }}>GH₵ {parseFloat(String(supply.cost)).toFixed(2)}</td>
                <td style={{ padding: '12px', fontSize: '13px', color: 'var(--muted)' }}>
                  {supply.brand || '—'}
                </td>
                <td style={{ padding: '12px', textAlign: 'center' }}>{supply.quantity}</td>
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
                    onClick={() => handleDelete(supply.id)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            </tbody>
          </table>
        </div>
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
              <div style={{ padding: '16px', background: '#f0f9ff', border: '1px solid #bfdbfe', borderRadius: '8px' }}>
                <div style={{ fontSize: '13px', color: 'var(--muted)', marginBottom: '6px' }}>Total Cost</div>
                <div style={{ fontSize: '24px', fontWeight: 600, color: '#1e40af' }}>
                  GH₵ {overallStats.totalCost.toFixed(2)}
                </div>
              </div>

              <div style={{ padding: '16px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px' }}>
                <div style={{ fontSize: '13px', color: 'var(--muted)', marginBottom: '6px' }}>Total Quantity</div>
                <div style={{ fontSize: '24px', fontWeight: 600, color: '#15803d' }}>
                  {overallStats.totalQuantity} units
                </div>
              </div>

              <div style={{ padding: '16px', background: '#faf5ff', border: '1px solid #f3e8ff', borderRadius: '8px' }}>
                <div style={{ fontSize: '13px', color: 'var(--muted)', marginBottom: '6px' }}>Avg Cost/Item</div>
                <div style={{ fontSize: '24px', fontWeight: 600, color: '#7c3aed' }}>
                  GH₵ {isFinite(overallStats.avgCost) ? overallStats.avgCost.toFixed(2) : '0.00'}
                </div>
              </div>

              <div style={{ padding: '16px', background: '#fce7f3', border: '1px solid #fbcfe8', borderRadius: '8px' }}>
                <div style={{ fontSize: '13px', color: 'var(--muted)', marginBottom: '6px' }}>Receivers</div>
                <div style={{ fontSize: '24px', fontWeight: 600, color: '#be185d' }}>
                  {overallStats.uniqueReceivers}
                </div>
              </div>

              <div style={{ padding: '16px', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '8px' }}>
                <div style={{ fontSize: '13px', color: 'var(--muted)', marginBottom: '6px' }}>Categories Used</div>
                <div style={{ fontSize: '24px', fontWeight: 600, color: '#b45309' }}>
                  {overallStats.uniqueCategories}
                </div>
              </div>

              <div style={{ padding: '16px', background: '#f3e8ff', border: '1px solid #e9d5ff', borderRadius: '8px' }}>
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
                        border: `1px solid ${color.border}`,
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
                      <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '8px' }}>
                        Avg: <strong>GH₵ {stat.avgCost.toFixed(2)}</strong>
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
        </div>
      )}
    </div>
  );
};
