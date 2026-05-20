// src/screens/SuppliesList.tsx
import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSupplies } from '../hooks/useSupplies';

export const SuppliesList: React.FC = () => {
  const navigate = useNavigate();
  const { supplies, totalCost, loading, error, fetchSupplies, deleteSupply } = useSupplies();

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

  return (
    <div className="">
      <div style={{ marginBottom: '20px' }}>
        <h2 style={{ margin: '0 0 16px 0' }}>Supplies</h2>
        <p style={{ margin: 0, color: 'var(--muted)', fontSize: '14px' }}>
          Total Cost: GH₵ {parseFloat(String(totalCost)).toFixed(2)}
        </p>
      </div>

      {/* Status bar */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', alignItems: 'center' }}>
        <button
          className="pill"
          onClick={() => navigate('/supplies/create')}
          style={{ padding: '8px 16px', fontSize: '14px' }}
        >
          Add Supply
        </button>

        <div style={{ color: 'var(--muted)', fontSize: '13px', marginLeft: 'auto' }}>
          {loading && 'Loading...'}
          {error && <span style={{ color: '#991b1b' }}>Error: {error}</span>}
        </div>
      </div>

      {/* Table */}
      {supplies.length > 0 ? (
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
            <tr style={{ backgroundColor: 'var(--brand)', color: '#fff' }}>
              <th style={{ padding: '12px', textAlign: 'left' }}>Name</th>
              <th style={{ padding: '12px', textAlign: 'left' }}>Purchase Date</th>
              <th style={{ padding: '12px', textAlign: 'left' }}>Cost</th>
              <th style={{ padding: '12px', textAlign: 'left' }}>Brand</th>
              <th style={{ padding: '12px', textAlign: 'left' }}>Quantity</th>
              <th style={{ padding: '12px', textAlign: 'left' }}>Receiver</th>
              <th style={{ padding: '12px', textAlign: 'right' }}>Actions</th>
            </tr>
            </thead>
            <tbody>
            {supplies.map(supply => (
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
          <p style={{ margin: 0 }}>No supplies found</p>
        </div>
      )}
    </div>
  );
};
