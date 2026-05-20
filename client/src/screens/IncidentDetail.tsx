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
  const { fetchIncidentById, updateIncidentStatus, assignIncident, updateIncidentNotes, loading, error } = useIncidents();
  const { isAdmin, isSuperAdmin } = usePermissions();

  const [incident, setIncident] = useState<Incident | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [notesText, setNotesText] = useState('');
  const [isEditingAssign, setIsEditingAssign] = useState(false);
  const [assignEmail, setAssignEmail] = useState('');

  useEffect(() => {
    const loadIncident = async () => {
      if (id) {
        const data = await fetchIncidentById(parseInt(id));
        setIncident(data);
        setNotesText(data?.notes || '');
        setAssignEmail(data?.assigned_to || '');
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

  const handleSaveNotes = async () => {
    if (!incident) return;

    try {
      await updateIncidentNotes(incident.id, notesText);
      const updated = await fetchIncidentById(incident.id);
      setIncident(updated);
      setIsEditingNotes(false);
    } catch (err) {
      console.error('Error updating notes:', err);
    }
  };

  const handleSaveAssign = async () => {
    if (!incident || !assignEmail.trim()) return;

    try {
      await assignIncident(incident.id, assignEmail);
      const updated = await fetchIncidentById(incident.id);
      setIncident(updated);
      setIsEditingAssign(false);
    } catch (err) {
      console.error('Error assigning incident:', err);
    }
  };

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return '—';
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
        <p style={{ color: 'var(--muted)' }}>Loading...</p>
      </div>
    );
  }

  if (error || !incident) {
    return (
      <div className="main-card" style={{ textAlign: 'center', padding: '40px 20px' }}>
        <p style={{ color: '#991b1b' }}>
          {error ? `Error: ${error}` : 'Incident not found'}
        </p>
        <button
          className="pill"
          onClick={() => navigate('/incidents')}
          style={{ marginTop: '12px' }}
        >
          Back to list
        </button>
      </div>
    );
  }

  const canManage = isAdmin || isSuperAdmin;

  return (
    <div className="main-card">
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: '24px',
          paddingBottom: '16px',
          borderBottom: '1px solid var(--line)',
        }}
      >
        <div>
          <h2 style={{ margin: '0 0 8px 0' }}>Incident #{incident.id}</h2>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: '14px' }}>
            Asset: <strong>{incident.asset_label || `Asset #${incident.asset_id}`}</strong>
          </p>
        </div>

        <button
          className="pill"
          style={{ padding: '6px 12px', fontSize: '13px' }}
          onClick={() => navigate('/incidents')}
        >
          ← Back
        </button>
      </div>

      {/* Info Row: Type, Severity, Status */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: '24px',
          marginBottom: '24px',
        }}
      >
        <div>
          <p
            style={{
              margin: '0 0 8px 0',
              fontSize: '12px',
              color: 'var(--muted)',
              textTransform: 'uppercase',
              letterSpacing: '.08em',
            }}
          >
            Type
          </p>
          <IncidentBadge type="type" value={incident.incident_type} />
        </div>

        <div>
          <p
            style={{
              margin: '0 0 8px 0',
              fontSize: '12px',
              color: 'var(--muted)',
              textTransform: 'uppercase',
              letterSpacing: '.08em',
            }}
          >
            Severity
          </p>
          <IncidentBadge type="severity" value={incident.severity} />
        </div>

        <div>
          <p
            style={{
              margin: '0 0 8px 0',
              fontSize: '12px',
              color: 'var(--muted)',
              textTransform: 'uppercase',
              letterSpacing: '.08em',
            }}
          >
            Status
          </p>
          <div style={{ position: 'relative' }}>
            <button
              className="pill padding"
              onClick={() => setShowStatusDropdown(!showStatusDropdown)}
              disabled={!canManage || isUpdatingStatus}
              style={{
                opacity: !canManage ? 0.6 : 1,
                cursor: canManage ? 'pointer' : 'not-allowed',
                paddingRight: '10px',
              }}
            >
              <IncidentBadge type="status" value={incident.status} /> click to update
            </button>

            {canManage && showStatusDropdown && (
              <div className="incident-status-dropdown">
                {['open', 'in_progress', 'resolved'].map(status => (
                  <button
                    key={status}
                    onClick={() => handleStatusChange(status)}
                    disabled={isUpdatingStatus}
                    className={incident.status === status ? 'active' : ''}
                  >
                    {status === 'open' && 'Open'}
                    {status === 'in_progress' && 'In Progress'}
                    {status === 'resolved' && 'Resolved'}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Description */}
      <div style={{ marginBottom: '24px' }}>
        <p
          style={{
            margin: '0 0 8px 0',
            fontSize: '12px',
            color: 'var(--muted)',
            textTransform: 'uppercase',
            letterSpacing: '.08em',
          }}
        >
          Description
        </p>
        <div
          style={{
            padding: '14px',
            backgroundColor: '#f4f1ee',
            borderRadius: '12px',
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {incident.description}
        </div>
      </div>

      {/* Timeline Info */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: '24px',
          marginBottom: '24px',
        }}
      >
        <div>
          <p
            style={{
              margin: '0 0 8px 0',
              fontSize: '12px',
              color: 'var(--muted)',
              textTransform: 'uppercase',
              letterSpacing: '.08em',
            }}
          >
            Reported By
          </p>
          <p style={{ margin: 0, color: 'var(--ink)' }}>{incident.reported_by_email}</p>
        </div>

        <div>
          <p
            style={{
              margin: '0 0 8px 0',
              fontSize: '12px',
              color: 'var(--muted)',
              textTransform: 'uppercase',
              letterSpacing: '.08em',
            }}
          >
            Created At
          </p>
          <p style={{ margin: 0, color: 'var(--ink)', fontSize: '13px' }}>
            {formatDate(incident.created_at)}
          </p>
        </div>

        <div>
          <p
            style={{
              margin: '0 0 8px 0',
              fontSize: '12px',
              color: 'var(--muted)',
              textTransform: 'uppercase',
              letterSpacing: '.08em',
            }}
          >
            Resolved At
          </p>
          <p style={{ margin: 0, color: 'var(--ink)', fontSize: '13px' }}>
            {formatDate(incident.resolved_at)}
          </p>
        </div>
      </div>

      {/* Assigned To Section (Admin only) */}
      {canManage && (
        <div style={{ marginBottom: '24px', padding: '16px', backgroundColor: '#fbf8f6', borderRadius: '12px' }}>
          <p
            style={{
              margin: '0 0 12px 0',
              fontSize: '12px',
              color: 'var(--muted)',
              textTransform: 'uppercase',
              letterSpacing: '.08em',
            }}
          >
            Assigned To
          </p>
          {!isEditingAssign ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <p style={{ margin: 0, color: 'var(--ink)' }}>
                {incident.assigned_to || '—'}
              </p>
              <button
                className="pill"
                style={{ padding: '6px 12px', fontSize: '12px' }}
                onClick={() => setIsEditingAssign(true)}
              >
                Edit
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="email"
                value={assignEmail}
                onChange={(e) => setAssignEmail(e.target.value)}
                placeholder="Technician email"
                className="field"
                style={{ flex: 1 }}
              />
              <button className="pill" onClick={handleSaveAssign} style={{ padding: '8px 12px' }}>
                Save
              </button>
              <button
                className="pill pill--muted"
                onClick={() => {
                  setIsEditingAssign(false);
                  setAssignEmail(incident.assigned_to || '');
                }}
                style={{ padding: '8px 12px' }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {/* Notes Section (Admin only) */}
      {canManage && (
        <div style={{ marginBottom: '24px', padding: '16px', backgroundColor: '#fbf8f6', borderRadius: '12px' }}>
          <p
            style={{
              margin: '0 0 12px 0',
              fontSize: '12px',
              color: 'var(--muted)',
              textTransform: 'uppercase',
              letterSpacing: '.08em',
            }}
          >
            Repair Notes
          </p>
          {!isEditingNotes ? (
            <div>
              <div
                style={{
                  padding: '12px',
                  backgroundColor: '#fff',
                  borderRadius: '8px',
                  marginBottom: '8px',
                  minHeight: '40px',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {notesText || '—'}
              </div>
              <button
                className="pill"
                style={{ padding: '6px 12px', fontSize: '12px' }}
                onClick={() => setIsEditingNotes(true)}
              >
                Edit
              </button>
            </div>
          ) : (
            <div>
              <textarea
                value={notesText}
                onChange={(e) => setNotesText(e.target.value)}
                placeholder="Add repair notes..."
                className="field"
                style={{ width: '100%', minHeight: '100px', marginBottom: '8px' }}
              />
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="pill" onClick={handleSaveNotes} style={{ padding: '8px 12px' }}>
                  Save
                </button>
                <button
                  className="pill pill--muted"
                  onClick={() => {
                    setIsEditingNotes(false);
                    setNotesText(incident.notes || '');
                  }}
                  style={{ padding: '8px 12px' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
