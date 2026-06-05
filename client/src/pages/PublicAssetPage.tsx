// src/pages/PublicAssetDetail.tsx
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, auth } from '../lib/apiClient';
import Modal from '../components/Modal';

type Asset = {
  id: number;
  label: string;
  category_name: string | null;
  serial_no: string | null;
  purchased_at: string | null;
  purchase_price: number | null;
  status: 'in_stock' | 'assigned' | 'repair' | 'retired';
};

const formatDate = (dateStr: string | null | undefined): string => {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '—';
    const day = String(d.getUTCDate()).padStart(2, '0');
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const year = d.getUTCFullYear();
    return `${day}/${month}/${year}`;
  } catch {
    return '—';
  }
};

export default function PublicAssetDetail() {
  const { id } = useParams();
  const assetId = Number(id);
  const navigate = useNavigate();

  const [asset, setAsset] = useState<Asset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showIncidentModal, setShowIncidentModal] = useState(false);
  const [incidentTitle, setIncidentTitle] = useState('');
  const [incidentDescription, setIncidentDescription] = useState('');
  const [incidentSeverity, setIncidentSeverity] = useState<'low' | 'medium' | 'high'>('medium');
  const [submittingIncident, setSubmittingIncident] = useState(false);
  const [incidentError, setIncidentError] = useState<string | null>(null);
  const [incidentSuccess, setIncidentSuccess] = useState(false);

  // Load asset on mount
  useEffect(() => {
    const loadAsset = async () => {
      try {
        setLoading(true);
        const { data, error: err } = await api.get<Asset>(
          `/assets/${assetId}`,
          false // No auth required
        );

        if (err || !data) {
          setError(err || 'Asset not found');
          return;
        }

        setAsset(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load asset');
      } finally {
        setLoading(false);
      }
    };

    loadAsset();
  }, [assetId]);

  const handleReportIncident = async () => {
    // Check if user is authenticated
    const isAuth = auth.isAuthenticated();

    if (!isAuth) {
      // Trigger Google Sign-In
      await auth.signInWithGoogle();
      // Show incident modal after auth (handled in AuthGateWrapper)
      setShowIncidentModal(true);
      return;
    }

    // User is authenticated, show incident modal
    setShowIncidentModal(true);
  };

  const handleSubmitIncident = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!incidentTitle.trim() || !incidentDescription.trim()) {
      setIncidentError('Please fill in all fields');
      return;
    }

    try {
      setSubmittingIncident(true);
      setIncidentError(null);

      const { data, error: err } = await api.post<{ id: number }>(
        '/incidents',
        {
          asset_id: assetId,
          title: incidentTitle,
          description: incidentDescription,
          severity: incidentSeverity,
          status: 'open',
        }
      );

      if (err || !data) {
        setIncidentError(err || 'Failed to report incident');
        return;
      }

      // Success
      setIncidentSuccess(true);
      setTimeout(() => {
        navigate(`/incidents/${data.id}`);
      }, 1500);
    } catch (e) {
      setIncidentError(e instanceof Error ? e.message : 'Failed to report incident');
    } finally {
      setSubmittingIncident(false);
    }
  };

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f5f5f5'
      }}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 18, color: '#666' }}>Loading asset…</p>
        </div>
      </div>
    );
  }

  if (error || !asset) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f5f5f5',
        padding: 20
      }}>
        <div style={{
          textAlign: 'center',
          background: '#fff',
          padding: 32,
          borderRadius: 8,
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
          maxWidth: 400
        }}>
          <p style={{ fontSize: 18, fontWeight: 600, color: '#c00', marginBottom: 8 }}>
            ⚠️ Asset Not Found
          </p>
          <p style={{ color: '#666', marginBottom: 24 }}>
            {error || 'The asset you are looking for does not exist'}
          </p>
          <button
            onClick={() => window.location.href = '/'}
            style={{
              padding: '10px 20px',
              background: 'var(--brand)',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontWeight: 500
            }}
          >
            Go Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#f5f5f5',
      padding: 20
    }}>
      <div style={{
        maxWidth: 500,
        margin: '0 auto',
        background: '#fff',
        borderRadius: 8,
        boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
        padding: 32
      }}>
        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <h1 style={{
            margin: '0 0 8px 0',
            fontSize: 28,
            fontWeight: 700,
            color: '#000'
          }}>
            {asset.label}
          </h1>
          <p style={{
            margin: 0,
            fontSize: 14,
            color: '#666'
          }}>
            Asset Information
          </p>
        </div>

        {/* Key Information */}
        <div style={{
          display: 'grid',
          gap: 20,
          marginBottom: 28,
          paddingBottom: 28,
          borderBottom: '1px solid #eee'
        }}>
          <InfoRow
            label="Serial Number"
            value={asset.serial_no || '—'}
          />
          <InfoRow
            label="Category"
            value={asset.category_name || '—'}
          />
          <InfoRow
            label="Purchase Date"
            value={formatDate(asset.purchased_at)}
          />
          {asset.purchase_price && (
            <InfoRow
              label="Purchase Price"
              value={`$${asset.purchase_price.toFixed(2)}`}
            />
          )}
          <InfoRow
            label="Status"
            value={asset.status.charAt(0).toUpperCase() + asset.status.slice(1)}
          />
        </div>

        {/* Report Incident Button */}
        <button
          onClick={handleReportIncident}
          style={{
            width: '100%',
            padding: 12,
            background: '#b98b46',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            fontSize: 16,
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'background 0.2s',
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = '#a07a38'}
          onMouseLeave={(e) => e.currentTarget.style.background = '#b98b46'}
        >
          📋 Report an Incident
        </button>
      </div>

      {/* Incident Modal */}
      <Modal
        open={showIncidentModal}
        onClose={() => {
          if (!submittingIncident && !incidentSuccess) {
            setShowIncidentModal(false);
            setIncidentTitle('');
            setIncidentDescription('');
            setIncidentSeverity('medium');
            setIncidentError(null);
          }
        }}
        title="Report an Incident"
      >
        {incidentSuccess ? (
          <div style={{ textAlign: 'center', padding: 20 }}>
            <p style={{ fontSize: 18, fontWeight: 600, color: '#2d5a2d', marginBottom: 8 }}>
              ✅ Incident Reported Successfully
            </p>
            <p style={{ color: '#666' }}>
              Redirecting to incident details…
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmitIncident}>
            <div style={{ marginBottom: 16 }}>
              <label style={{
                display: 'block',
                fontSize: 14,
                fontWeight: 600,
                marginBottom: 6,
                color: '#000'
              }}>
                Title *
              </label>
              <input
                type="text"
                value={incidentTitle}
                onChange={(e) => setIncidentTitle(e.target.value)}
                placeholder="Brief description of the issue"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid #ddd',
                  borderRadius: 4,
                  fontSize: 14,
                  fontFamily: 'inherit',
                  boxSizing: 'border-box'
                }}
                disabled={submittingIncident}
                required
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{
                display: 'block',
                fontSize: 14,
                fontWeight: 600,
                marginBottom: 6,
                color: '#000'
              }}>
                Description *
              </label>
              <textarea
                value={incidentDescription}
                onChange={(e) => setIncidentDescription(e.target.value)}
                placeholder="Detailed description of the incident"
                rows={4}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid #ddd',
                  borderRadius: 4,
                  fontSize: 14,
                  fontFamily: 'inherit',
                  boxSizing: 'border-box',
                  resize: 'vertical'
                }}
                disabled={submittingIncident}
                required
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{
                display: 'block',
                fontSize: 14,
                fontWeight: 600,
                marginBottom: 6,
                color: '#000'
              }}>
                Severity
              </label>
              <select
                value={incidentSeverity}
                onChange={(e) => setIncidentSeverity(e.target.value as 'low' | 'medium' | 'high')}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid #ddd',
                  borderRadius: 4,
                  fontSize: 14,
                  fontFamily: 'inherit',
                  boxSizing: 'border-box',
                }}
                disabled={submittingIncident}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>

            {incidentError && (
              <p style={{
                color: '#c00',
                fontSize: 14,
                marginBottom: 16,
                padding: 10,
                background: '#fee',
                borderRadius: 4
              }}>
                ❌ {incidentError}
              </p>
            )}

            <div style={{
              display: 'flex',
              gap: 10,
              justifyContent: 'flex-end'
            }}>
              <button
                type="button"
                onClick={() => {
                  setShowIncidentModal(false);
                  setIncidentTitle('');
                  setIncidentDescription('');
                  setIncidentSeverity('medium');
                  setIncidentError(null);
                }}
                style={{
                  padding: '10px 20px',
                  background: '#eee',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: 500
                }}
                disabled={submittingIncident}
              >
                Cancel
              </button>
              <button
                type="submit"
                style={{
                  padding: '10px 20px',
                  background: 'var(--brand)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  cursor: submittingIncident ? 'not-allowed' : 'pointer',
                  fontSize: 14,
                  fontWeight: 600,
                  opacity: submittingIncident ? 0.7 : 1
                }}
                disabled={submittingIncident}
              >
                {submittingIncident ? 'Reporting…' : 'Report Incident'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p style={{
        margin: '0 0 6px 0',
        fontSize: 12,
        fontWeight: 600,
        color: '#999',
        textTransform: 'uppercase',
        letterSpacing: '0.5px'
      }}>
        {label}
      </p>
      <p style={{
        margin: 0,
        fontSize: 16,
        fontWeight: 500,
        color: '#000'
      }}>
        {value}
      </p>
    </div>
  );
}
