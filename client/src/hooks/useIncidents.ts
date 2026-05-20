// src/hooks/useIncidents.ts
import { useState, useCallback } from 'react';
import { api } from '../lib/apiClient';

export type Incident = {
  id: number;
  asset_id: number;
  asset_label?: string;
  incident_type: string;
  severity: string;
  description: string;
  status: string;
  reported_by_email: string;
  assigned_to?: string | null;
  created_at: string;
  resolved_at?: string | null;
  notes?: string | null;
};

export function useIncidents() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchIncidents = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await api.get<Incident[]>('/incidents');
    if (error) {
      setError(error);
    } else {
      setIncidents(data ?? []);
    }
    setLoading(false);
  }, []);

  const fetchIncidentById = useCallback(async (id: number): Promise<Incident | null> => {
    setLoading(true);
    setError(null);
    const { data, error } = await api.get<Incident>(`/incidents/${id}`);
    if (error) {
      setError(error);
      setLoading(false);
      return null;
    }
    setLoading(false);
    return data || null;
  }, []);

  const reportIncident = useCallback(
    async (
      assetId: number,
      incidentType: string,
      severity: string,
      description: string,
      //location?: string
    ): Promise<number> => {
      setLoading(true);
      setError(null);
      const { data, error } = await api.post<{ id: number }>('/incidents', {
        asset_id: assetId,
        incident_type: incidentType,
        severity,
        description,
        // Note: 'location' field is not in current schema, so we don't send it
        // location: location || null,
      });
      setLoading(false);
      if (error) {
        setError(error);
        throw new Error(error);
      }
      if (!data || !data.id) {
        throw new Error('Invalid response: no incident ID');
      }
      // Refresh list
      await fetchIncidents();
      return data.id;
    },
    [fetchIncidents]
  );

  const updateIncidentStatus = useCallback(
    async (id: number, status: string): Promise<void> => {
      setLoading(true);
      setError(null);
      const { error } = await api.patch(`/incidents/${id}/status`, { status });
      setLoading(false);
      if (error) {
        setError(error);
        throw new Error(error);
      }
      // Refresh list
      await fetchIncidents();
    },
    [fetchIncidents]
  );

  const assignIncident = useCallback(
    async (id: number, assignedToEmail: string): Promise<void> => {
      setLoading(true);
      setError(null);
      const { error } = await api.patch(`/incidents/${id}/assign`, {
        assigned_to: assignedToEmail,
      });
      setLoading(false);
      if (error) {
        setError(error);
        throw new Error(error);
      }
      // Refresh list
      await fetchIncidents();
    },
    [fetchIncidents]
  );

  const updateIncidentNotes = useCallback(
    async (id: number, notes: string): Promise<void> => {
      setLoading(true);
      setError(null);
      const { error } = await api.patch(`/incidents/${id}/notes`, { notes });
      setLoading(false);
      if (error) {
        setError(error);
        throw new Error(error);
      }
      // Refresh list
      await fetchIncidents();
    },
    [fetchIncidents]
  );

  return {
    incidents,
    loading,
    error,
    fetchIncidents,
    fetchIncidentById,
    reportIncident,
    updateIncidentStatus,
    assignIncident,
    updateIncidentNotes,
  };
}
