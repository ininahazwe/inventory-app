// src/screens/IncidentsList.tsx
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useIncidents } from '../hooks/useIncidents';
import type { Incident } from '../hooks/useIncidents';
import { IncidentBadge } from '../components/IncidentBadge';

export const IncidentsList: React.FC = () => {
  const navigate = useNavigate();
  const { incidents, loading, error, fetchIncidents } = useIncidents();

  const [filters, setFilters] = useState({
    status: '',
    severity: '',
  });
  const [filteredIncidents, setFilteredIncidents] = useState<Incident[]>([]);

  // Charger les incidents au montage
  useEffect(() => {
    fetchIncidents();
  }, [fetchIncidents]);

  // Appliquer les filtres
  useEffect(() => {
    let filtered = [...incidents];

    if (filters.status) {
      filtered = filtered.filter(i => i.status === filters.status);
    }
    if (filters.severity) {
      filtered = filtered.filter(i => i.severity === filters.severity);
    }

    setFilteredIncidents(filtered);
  }, [incidents, filters]);

  const handleRowClick = (incidentId: number) => {
    navigate(`/incidents/${incidentId}`);
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
        <h2 style={{ margin: '0 0 16px 0' }}>Incidents</h2>
        <p style={{ margin: 0, color: 'var(--muted)', fontSize: '14px' }}>
          {filteredIncidents.length} incident{filteredIncidents.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Filters */}
      <div className="filters" style={{ display: 'flex', gap: '12px', marginBottom: '20px', alignItems: 'center' }}>
        <select
          value={filters.status}
          onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value }))}
          className="select"
          style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--line)' }}
        >
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="resolved">Resolved</option>
        </select>

        <select
          value={filters.severity}
          onChange={(e) => setFilters(prev => ({ ...prev, severity: e.target.value }))}
          className="select"
          style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--line)' }}
        >
          <option value="">All severities</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>

        <div style={{ color: 'var(--muted)', fontSize: '13px', marginLeft: 'auto' }}>
          {loading && 'Loading...'}
          {error && <span style={{ color: '#991b1b' }}>Error: {error}</span>}
        </div>
      </div>

      {/* Table */}
      {filteredIncidents.length > 0 ? (
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
            <tr style={{ backgroundColor: 'var(--brand)', color: '#fff' }}>
              <th style={{ padding: '12px', textAlign: 'left' }}>Asset</th>
              <th style={{ padding: '12px', textAlign: 'left' }}>Type</th>
              <th style={{ padding: '12px', textAlign: 'left' }}>Severity</th>
              <th style={{ padding: '12px', textAlign: 'left' }}>Status</th>
              <th style={{ padding: '12px', textAlign: 'left' }}>Reported By</th>
              <th style={{ padding: '12px', textAlign: 'left' }}>Date</th>
              <th style={{ padding: '12px', textAlign: 'right' }}>Actions</th>
            </tr>
            </thead>
            <tbody>
            {filteredIncidents.map(incident => (
              <tr
                key={incident.id}
                style={{
                  borderBottom: '1px solid var(--line)',
                  cursor: 'pointer',
                  transition: 'background-color .2s ease',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#fbf8f6')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                <td style={{ padding: '12px' }}>
                    <span
                      style={{ color: 'var(--brand)', fontWeight: 500, cursor: 'pointer' }}
                      onClick={() => handleRowClick(incident.id)}
                    >
                      {incident.asset_label || `Asset #${incident.asset_id}`}
                    </span>
                </td>
                <td style={{ padding: '12px' }}>
                  <IncidentBadge type="type" value={incident.incident_type} />
                </td>
                <td style={{ padding: '12px' }}>
                  <IncidentBadge type="severity" value={incident.severity} />
                </td>
                <td style={{ padding: '12px' }}>
                  <IncidentBadge type="status" value={incident.status} />
                </td>
                <td style={{ padding: '12px', fontSize: '13px', color: 'var(--muted)' }}>
                  {incident.reported_by_email}
                </td>
                <td style={{ padding: '12px', fontSize: '13px', color: 'var(--muted)' }}>
                  {formatDate(incident.created_at)}
                </td>
                <td style={{ padding: '12px', textAlign: 'right' }}>
                  <button
                    className="pill"
                    style={{ padding: '6px 12px', fontSize: '12px' }}
                    onClick={() => handleRowClick(incident.id)}
                  >
                    View
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
          <p style={{ margin: 0 }}>No incidents found</p>
        </div>
      )}
    </div>
  );
};
