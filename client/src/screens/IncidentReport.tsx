// src/screens/IncidentReport.tsx
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/apiClient';
import { IncidentForm } from '../components/IncidentForm';

type Asset = { id: number; label: string };

export const IncidentReport: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [asset, setAsset] = useState<Asset | null>(null);
  const [loadingAsset, setLoadingAsset] = useState(true);

  const assetId = id ? parseInt(id) : null;

  useEffect(() => {
    if (assetId) {
      api
        .get<Asset>(`/assets/${assetId}`)
        .then(({ data, error }) => {
          if (!error && data) {
            setAsset(data);
          }
          setLoadingAsset(false);
        })
        .catch(() => {
          setLoadingAsset(false);
        });
    }
  }, [assetId]);

  const handleIncidentCreated = (incidentId: number) => {
    navigate(`/incidents/${incidentId}`);
  };

  const handleCancel = () => {
    navigate(-1);
  };

  if (loadingAsset) {
    return (
      <div className="main-card" style={{ textAlign: 'center', padding: '40px 20px' }}>
        <p style={{ color: 'var(--muted)' }}>Loading...</p>
      </div>
    );
  }

  if (!asset) {
    return (
      <div className="main-card" style={{ textAlign: 'center', padding: '40px 20px' }}>
        <p style={{ color: '#991b1b' }}>Asset not found</p>
        <button className="pill" onClick={handleCancel} style={{ marginTop: '12px' }}>
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="main-card">
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ margin: '0 0 8px 0' }}>Report an Incident</h2>
        <p style={{ margin: 0, color: 'var(--muted)', fontSize: '14px' }}>
          Asset: <strong>{asset.label}</strong>
        </p>
      </div>

      <IncidentForm
        assetId={asset.id}
        assetLabel={asset.label}
        onCreated={handleIncidentCreated}
        onCancel={handleCancel}
      />
    </div>
  );
};
