// src/screens/IncidentReport.tsx
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useIncidents } from '../hooks/useIncidents';
import Modal from '../components/Modal';

type Asset = {
  id: number;
  label: string;
  serial_no: string | null;
  category_name: string | null;
};

export const IncidentReport: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { reportIncident, loading: reportLoading, error: reportError } = useIncidents();

  const [asset, setAsset] = useState<Asset | null>(null);
  const [user, setUser] = useState<any>(null);
  const [loadingAsset, setLoadingAsset] = useState(true);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);

  const [formData, setFormData] = useState({
    incidentType: 'damage',
    severity: 'medium',
    description: '',
    location: '',
  });

  const assetId = id ? parseInt(id) : null;

  // Vérifier l'utilisateur et charger l'asset
  useEffect(() => {
    const init = async () => {
      try {
        // Vérifier si authentifié
        const { data: sessionData } = await supabase.auth.getSession();
        const currentUser = sessionData?.session?.user;

        if (!currentUser) {
          // Pas authentifié → afficher modal auth
          setAuthModalOpen(true);
          return;
        }

        setUser(currentUser);

        // Charger l'asset
        if (assetId) {
          const { data, error } = await supabase
            .from('v_asset_overview')
            .select('id, label, serial_no, category_name')
            .eq('id', assetId)
            .single();

          if (error) {
            console.error('Error loading asset:', error);
            setLoadingAsset(false);
            return;
          }

          setAsset(data as Asset);
        }
      } catch (err) {
        console.error('Init error:', err);
      } finally {
        setLoadingAsset(false);
      }
    };

    init();
  }, [assetId]);

  // Écouter les changements d'auth
  useEffect(() => {
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser(session.user);
        setAuthModalOpen(false);
      }
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  const handleGoogleAuth = async () => {
    try {
      setAuthLoading(true);
      await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/asset/${assetId}/report-incident`,
        },
      });
    } catch (error) {
      console.error('Auth error:', error);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.description.trim()) {
      alert('Veuillez décrire l\'incident');
      return;
    }

    if (!assetId) {
      alert('Asset non trouvé');
      return;
    }

    try {
      const incidentId = await reportIncident(
        assetId,
        formData.incidentType,
        formData.severity,
        formData.description,
        formData.location || undefined
      );
      // Rediriger vers le détail de l'incident créé
      navigate(`/incidents/${incidentId}`);
    } catch (err) {
      console.error('Error reporting incident:', err);
    }
  };

  // Pas authentifié
  if (!user && !authModalOpen) {
    return (
      <>
        <Modal
          open={true}
          onClose={() => {}}
          title="Authentification requise"
        >
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <p style={{ color: 'var(--muted)', marginBottom: 20 }}>
              Vous devez être connecté pour signaler un incident.
            </p>
            <button
              onClick={handleGoogleAuth}
              disabled={authLoading}
              className="pill"
              style={{
                width: '100%',
                padding: '12px 20px',
                background: '#1f2937',
                color: '#fff',
                marginBottom: 12,
              }}
            >
              {authLoading ? 'Connexion...' : 'Continuer avec Google'}
            </button>
          </div>
        </Modal>
      </>
    );
  }

  if (loadingAsset) {
    return (
      <div className="main-card" style={{ textAlign: 'center', padding: '40px 20px' }}>
        <p style={{ color: 'var(--muted)' }}>Chargement...</p>
      </div>
    );
  }

  if (!asset) {
    return (
      <div className="main-card" style={{ textAlign: 'center', padding: '40px 20px' }}>
        <p style={{ color: '#991b1b' }}>Matériel non trouvé</p>
        <button
          className="pill"
          onClick={() => window.history.back()}
          style={{ marginTop: '12px' }}
        >
          Retour
        </button>
      </div>
    );
  }

  return (
    <div className="main-card">
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ margin: '0 0 8px 0' }}>Signaler un incident</h2>
        <p style={{ margin: 0, color: 'var(--muted)', fontSize: '14px' }}>
          Matériel: <strong>{asset.label}</strong> (SN: {asset.serial_no})
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="form-grid">
          {/* Asset Info - Read Only */}
          <div className="span-2">
            <label className="label">Matériel concerné</label>
            <div style={{
              padding: '10px 12px',
              backgroundColor: '#f4f1ee',
              borderRadius: '12px',
              color: 'var(--muted)',
              fontSize: '14px',
            }}>
              {asset.label}
            </div>
          </div>

          {/* Incident Type */}
          <div>
            <label htmlFor="incidentType" className="label">Type d'incident</label>
            <select
              id="incidentType"
              name="incidentType"
              value={formData.incidentType}
              onChange={handleChange}
              className="field"
            >
              <option value="damage">Dommage</option>
              <option value="loss">Perte</option>
              <option value="malfunction">Dysfonctionnement</option>
              <option value="theft">Vol</option>
              <option value="other">Autre</option>
            </select>
          </div>

          {/* Severity */}
          <div>
            <label htmlFor="severity" className="label">Sévérité</label>
            <select
              id="severity"
              name="severity"
              value={formData.severity}
              onChange={handleChange}
              className="field"
            >
              <option value="low">Faible</option>
              <option value="medium">Moyen</option>
              <option value="high">Élevé</option>
              <option value="critical">Critique</option>
            </select>
          </div>

          {/* Location */}
          <div className="span-2">
            <label htmlFor="location" className="label">Localisation (optionnel)</label>
            <input
              type="text"
              id="location"
              name="location"
              placeholder="Bureau, Magasin, etc."
              value={formData.location}
              onChange={handleChange}
              className="field"
            />
          </div>

          {/* Description */}
          <div className="span-2">
            <label htmlFor="description" className="label">Description de l'incident *</label>
            <textarea
              id="description"
              name="description"
              placeholder="Décrivez en détail ce qui s'est passé..."
              value={formData.description}
              onChange={handleChange}
              className="field"
              rows={4}
              required
              style={{ resize: 'vertical' }}
            />
          </div>
        </div>

        {(reportError) && (
          <div style={{
            marginTop: '12px',
            padding: '10px 12px',
            backgroundColor: '#fef2f2',
            color: '#991b1b',
            borderRadius: '8px',
            fontSize: '13px',
          }}>
            {reportError}
          </div>
        )}

        <div className="modal-actions">
          <button
            type="button"
            onClick={() => window.history.back()}
            className="pill pill--muted"
            disabled={reportLoading}
          >
            Annuler
          </button>
          <button
            type="submit"
            className="pill"
            disabled={reportLoading}
          >
            {reportLoading ? 'Création...' : 'Signaler l\'incident'}
          </button>
        </div>
      </form>
    </div>
  );
};
