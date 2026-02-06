// src/components/IncidentForm.tsx
import React, { useState } from 'react';
import { useIncidents } from '../hooks/useIncidents';

interface IncidentFormProps {
  assetId: number;
  assetLabel: string;
  onCreated: (incidentId: number) => void;
  onCancel: () => void;
}

export const IncidentForm: React.FC<IncidentFormProps> = ({
                                                            assetId,
                                                            assetLabel,
                                                            onCreated,
                                                            onCancel,
                                                          }) => {
  const { reportIncident, loading, error } = useIncidents();
  const [formData, setFormData] = useState({
    incidentType: 'damage',
    severity: 'medium',
    description: '',
    location: '',
  });

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

    try {
      const incidentId = await reportIncident(
        assetId,
        formData.incidentType,
        formData.severity,
        formData.description,
        formData.location || undefined
      );
      onCreated(incidentId);
    } catch (err) {
      console.error('Error creating incident:', err);
    }
  };

  return (
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
            {assetLabel}
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

      {error && (
        <div style={{
          marginTop: '12px',
          padding: '10px 12px',
          backgroundColor: '#fef2f2',
          color: '#991b1b',
          borderRadius: '8px',
          fontSize: '13px',
        }}>
          {error}
        </div>
      )}

      <div className="modal-actions">
        <button
          type="button"
          onClick={onCancel}
          className="pill pill--muted"
          disabled={loading}
        >
          Annuler
        </button>
        <button
          type="submit"
          className="pill"
          disabled={loading}
        >
          {loading ? 'Création...' : 'Signaler l\'incident'}
        </button>
      </div>
    </form>
  );
};
