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
        <h2 style={{ margin: '0 0 16px 0' }}>Incidents list</h2>
        <p style={{ margin: 0, color: 'var(--muted)', fontSize: '14px' }}>
          {filteredIncidents.length} incident{filteredIncidents.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Filtres */}
      <div className="filters">
        <select
          value={filters.status}
          onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value }))}
          className="select"
        >
          <option value="">All status</option>
          <option value="open">Open</option>
          <option value="in_progress">In progress</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </select>

        <select
          value={filters.severity}
          onChange={(e) => setFilters(prev => ({ ...prev, severity: e.target.value }))}
          className="select"
        >
          <option value="">All severities</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>

        <div style={{ color: 'var(--muted)', fontSize: '13px', display: 'flex', alignItems: 'center' }}>
          {loading && 'Loading...'}
          {error && <span style={{ color: '#991b1b' }}>Erreur: {error}</span>}
        </div>
      </div>

      {/* Tableau */}
      {filteredIncidents.length > 0 ? (
        <table className="table">
          <thead>
          <tr style={{ backgroundColor: 'var(--brand)' }}>
            <th style={{ color: '#fff' }}>Materiel</th>
            <th style={{ color: '#fff' }}>Type</th>
            <th style={{ color: '#fff' }}>Severity</th>
            <th style={{ color: '#fff' }}>Status</th>
            <th style={{ color: '#fff' }}>Reported by</th>
            <th style={{ color: '#fff' }}>Date</th>
            <th style={{ color: '#fff', textAlign: 'right' }}>Actions</th>
          </tr>
          </thead>
          <tbody>
          {filteredIncidents.map(incident => (
            <tr key={incident.id} style={{ cursor: 'pointer' }}>
              <td>
                  <span
                    className="asset-link"
                    onClick={() => handleRowClick(incident.id)}
                  >
                    {incident.asset_label}
                  </span>
              </td>
              <td>
                <IncidentBadge type="type" value={incident.incident_type} />
              </td>
              <td>
                <IncidentBadge type="severity" value={incident.severity} />
              </td>
              <td>
                <IncidentBadge type="status" value={incident.status} />
              </td>
              <td style={{ fontSize: '13px', color: 'var(--muted)' }}>
                {incident.reported_by_email}
              </td>
              <td style={{ fontSize: '13px', color: 'var(--muted)' }}>
                {formatDate(incident.created_at)}
              </td>
              <td>
                <div className="actions">
                  <button
                    className="pill"
                    style={{ padding: '6px 12px', fontSize: '12px' }}
                    onClick={() => handleRowClick(incident.id)}
                  >
                    Voir
                  </button>
                </div>
              </td>
            </tr>
          ))}
          </tbody>
        </table>
      ) : (
        <div style={{
          padding: '40px 20px',
          textAlign: 'center',
          color: 'var(--muted)',
          backgroundColor: '#f4f1ee',
          borderRadius: '14px',
        }}>
          <p style={{ margin: 0 }}>Not incident found</p>
        </div>
      )}
    </div>
  );
};
