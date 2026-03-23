// src/hooks/useIncidents.ts
import { useState, useCallback } from 'react';
import { api } from '../lib/apiClient';

export type Incident = {
  id: number;
  asset_id: number;
  asset_label: string;
  serial_no: string | null;
  incident_type: string;
  severity: string;
  description: string;
  location: string | null;
  status: string;
  reported_by_email: string;
  assigned_to_email: string | null;
  created_at: string;
  resolved_at: string | null;
};

export function useIncidents() {
  const [incidents, setIncidents]   = useState<Incident[]>([]);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);

  const fetchIncidents = useCallback(async () => {
    setLoading(true); setError(null);
    const { data, error } = await api.get<Incident[]>('/incidents');
    if (error) setError(error); else setIncidents(data ?? []);
    setLoading(false);
  }, []);

  const fetchIncidentById = useCallback(async (id: number): Promise<Incident | null> => {
    const { data, error } = await api.get<Incident>(`/incidents/${id}`);
    if (error) { setError(error); return null; }
    return data;
  }, []);

  const reportIncident = useCallback(async (
    assetId: number,
    incidentType: string,
    severity: string,
    description: string,
    location?: string
  ): Promise<number> => {
    setLoading(true); setError(null);
    const { data, error } = await api.post<{ id: number }>('/incidents', {
      asset_id: assetId, incident_type: incidentType,
      severity, description, location: location || null,
    });
    setLoading(false);
    if (error) { setError(error); throw new Error(error); }
    return data!.id;
  }, []);

  const updateIncidentStatus = useCallback(async (id: number, status: string): Promise<void> => {
    const { error } = await api.patch(`/incidents/${id}/status`, { status });
    if (error) { setError(error); throw new Error(error); }
  }, []);

  return { incidents, loading, error, fetchIncidents, fetchIncidentById, reportIncident, updateIncidentStatus };
}
