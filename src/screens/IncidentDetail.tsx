// src/screens/IncidentDetail.tsx
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useIncidents } from '../hooks/useIncidents';
import type { Incident } from '../hooks/useIncidents';
import { IncidentBadge } from '../components/IncidentBadge';
import { usePermissions } from '../hooks/usePermissions';

export const IncidentDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { fetchIncidentById, updateIncidentStatus, loading, error } = useIncidents();
  const { isAdmin, isSuperAdmin } = usePermissions();

  const [incident, setIncident] = useState<Incident | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);

  useEffect(() => {
    const loadIncident = async () => {
      if (id) {
        const data = await fetchIncidentById(parseInt(id));
        setIncident(data);
      }
    };

    loadIncident();
  }, [id, fetchIncidentById]);

  const handleStatusChange = async (newStatus: string) => {
    if (!incident) return;

    try {
      setIsUpdatingStatus(true);
      await updateIncidentStatus(incident.id, newStatus);

      // Refresh incident data
      const updated = await fetchIncidentById(incident.id);
      setIncident(updated);
      setShowStatusDropdown(false);
    } catch (err) {
      console.error('Error updating status:', err);
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('fr-FR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="main-card" style={{ textAlign: 'center', padding: '40px 20px' }}>
        <p style={{ color: 'var(--muted)' }}>Chargement...</p>
      </div>
    );
  }

  if (error || !incident) {
    return (
      <div className="main-card" style={{ textAlign: 'center', padding: '40px 20px' }}>
        <p style={{ color: '#991b1b' }}>
          {error ? `Erreur: ${error}` : 'Incident non trouvé'}
        </p>
        <button
          className="pill"
          onClick={() => navigate('/incidents')}
          style={{ marginTop: '12px' }}
        >
          Retour à la liste
        </button>
      </div>
    );
  }

  const canManage = isAdmin || isSuperAdmin;

  return (
    <div className="main-card">
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: '24px',
        paddingBottom: '16px',
        borderBottom: '1px solid var(--line)',
      }}>
        <div>
          <h2 style={{ margin: '0 0 8px 0' }}>
            Incident #{incident.id}
          </h2>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: '14px' }}>
            Matériel: <strong>{incident.asset_label}</strong> (SN: {incident.serial_no})
          </p>
        </div>

        <button
          className="pill"
          style={{ padding: '6px 12px', fontSize: '13px' }}
          onClick={() => navigate('/incidents')}
        >
          ← Retour
        </button>
      </div>

      {/* Info Row 1: Type, Severity, Status */}
      <div className="infos">
        <div>
          <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em' }}>
            Type
          </p>
          <IncidentBadge type="type" value={incident.incident_type} />
        </div>

        <div>
          <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em' }}>
            Sévérité
          </p>
          <IncidentBadge type="severity" value={incident.severity} />
        </div>

        <div>
          <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em' }}>
            Statut
          </p>
          <div style={{ position: 'relative' }}>
            <button
              className="pill"
              onClick={() => setShowStatusDropdown(!showStatusDropdown)}
              disabled={!canManage || isUpdatingStatus}
              style={{
                opacity: !canManage ? 0.6 : 1,
                cursor: canManage ? 'pointer' : 'not-allowed',
              }}
            >
              <IncidentBadge type="status" value={incident.status} />
            </button>

            {canManage && showStatusDropdown && (
              <div style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                marginTop: '4px',
                backgroundColor: '#fff',
                border: '1px solid var(--line)',
                borderRadius: '12px',
                boxShadow: '0 10px 24px rgba(0,0,0,.08)',
                zIndex: 10,
                minWidth: '160px',
              }}>
                {['open', 'in_progress', 'resolved', 'closed'].map(status => (
                  <button
                    key={status}
                    onClick={() => handleStatusChange(status)}
                    disabled={isUpdatingStatus}
                    style={{
                      display: 'block',
                      width: '100%',
                      padding: '10px 12px',
                      border: 'none',
                      background: incident.status === status ? '#f4f1ee' : 'transparent',
                      textAlign: 'left',
                      cursor: 'pointer',
                      fontSize: '13px',
                      color: 'var(--ink)',
                      transition: 'background .2s ease',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#fbf8f6')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = incident.status === status ? '#f4f1ee' : 'transparent')}
                  >
                    {status === 'open' && 'Ouvert'}
                    {status === 'in_progress' && 'En cours'}
                    {status === 'resolved' && 'Résolu'}
                    {status === 'closed' && 'Fermé'}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Description */}
      <div style={{ marginTop: '24px', marginBottom: '24px' }}>
        <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em' }}>
          Description
        </p>
        <div style={{
          padding: '14px',
          backgroundColor: '#f4f1ee',
          borderRadius: '12px',
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}>
          {incident.description}
        </div>
      </div>

      {/* Location */}
      {incident.location && (
        <div style={{ marginBottom: '24px' }}>
          <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em' }}>
            Localisation
          </p>
          <p style={{ margin: 0, color: 'var(--ink)' }}>{incident.location}</p>
        </div>
      )}

      {/* Timeline Info */}
      <div className="infos">
        <div>
          <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em' }}>
            Signalé par
          </p>
          <p style={{ margin: 0, color: 'var(--ink)' }}>
            {incident.reported_by_email}
          </p>
        </div>

        <div>
          <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em' }}>
            Date de création
          </p>
          <p style={{ margin: 0, color: 'var(--ink)', fontSize: '13px' }}>
            {formatDate(incident.created_at)}
          </p>
        </div>

        <div>
          <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em' }}>
            Assigné à
          </p>
          <p style={{ margin: 0, color: 'var(--ink)' }}>
            {incident.assigned_to_email || '—'}
          </p>
        </div>
      </div>

      {incident.resolved_at && (
        <div style={{
          marginTop: '24px',
          padding: '12px',
          backgroundColor: '#f0fdf4',
          borderLeft: '3px solid #22c55e',
          borderRadius: '6px',
        }}>
          <p style={{ margin: 0, fontSize: '13px', color: '#166534' }}>
            Résolu le {formatDate(incident.resolved_at)}
          </p>
        </div>
      )}
    </div>
  );
};
