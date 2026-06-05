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
  });

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.description.trim()) {
      alert('Please describe the incident');
      return;
    }

    try {
      const incidentId = await reportIncident(
        assetId,
        formData.incidentType,
        formData.severity,
        formData.description
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
          <label className="label">Asset</label>
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
          <label htmlFor="incidentType" className="label">Incident Type</label>
          <select
            id="incidentType"
            name="incidentType"
            value={formData.incidentType}
            onChange={handleChange}
            className="field"
          >
            <option value="damage">Damage</option>
            <option value="loss">Loss</option>
            <option value="malfunction">Malfunction</option>
            <option value="theft">Theft</option>
            <option value="other">Other</option>
          </select>
        </div>

        {/* Severity */}
        <div>
          <label htmlFor="severity" className="label">Severity</label>
          <select
            id="severity"
            name="severity"
            value={formData.severity}
            onChange={handleChange}
            className="field"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </div>

        {/* Description */}
        <div className="span-2">
          <label htmlFor="description" className="label">Description *</label>
          <textarea
            id="description"
            name="description"
            placeholder="Describe what happened in detail..."
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
          Cancel
        </button>
        <button
          type="submit"
          className="pill"
          disabled={loading}
        >
          {loading ? 'Submitting...' : 'Report Incident'}
        </button>
      </div>
    </form>
  );
};
