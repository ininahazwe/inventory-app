// src/hooks/useIncidents.ts
import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';

export interface Incident {
  id: number;
  asset_id: number;
  asset_label: string;
  serial_no: string;
  category_name: string;
  incident_type: 'damage' | 'loss' | 'malfunction' | 'theft' | 'other';
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  location: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  assigned_to: string | null;
  assigned_to_email: string | null;
  reported_by: string;
  reported_by_email: string;
}

export interface IncidentFilters {
  status?: string;
  severity?: string;
  asset_id?: number;
}

export function useIncidents() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Récupérer tous les incidents avec filtres optionnels
  const fetchIncidents = useCallback(async (filters?: IncidentFilters) => {
    try {
      setLoading(true);
      setError(null);

      let query = supabase
        .from('v_incident_overview')
        .select('*')
        .order('created_at', { ascending: false });

      if (filters?.status) {
        query = query.eq('status', filters.status);
      }
      if (filters?.severity) {
        query = query.eq('severity', filters.severity);
      }
      if (filters?.asset_id) {
        query = query.eq('asset_id', filters.asset_id);
      }

      const { data, error: fetchError } = await query;

      if (fetchError) throw fetchError;
      setIncidents(data || []);
      return data || [];
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement';
      setError(message);
      console.error('Fetch incidents error:', err);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  // Récupérer un incident spécifique
  const fetchIncidentById = useCallback(async (id: number) => {
    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('v_incident_overview')
        .select('*')
        .eq('id', id)
        .single();

      if (fetchError) throw fetchError;
      return data as Incident;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement';
      setError(message);
      console.error('Fetch incident error:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // Signaler un nouvel incident
  const reportIncident = useCallback(async (
    assetId: number,
    incidentType: string,
    severity: string,
    description: string,
    location?: string
  ) => {
    try {
      setLoading(true);
      setError(null);

      const { data, error: callError } = await supabase.rpc('report_incident', {
        p_asset_id: assetId,
        p_incident_type: incidentType,
        p_severity: severity,
        p_description: description,
        p_location: location || null,
      });

      if (callError) throw callError;
      return data as number; // Retourne l'ID du nouvel incident
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la création';
      setError(message);
      console.error('Report incident error:', err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // Assigner un incident à un admin
  const assignIncident = useCallback(async (
    incidentId: number,
    assignToUserId: string
  ) => {
    try {
      setLoading(true);
      setError(null);

      const { error: callError } = await supabase.rpc('assign_incident', {
        p_incident_id: incidentId,
        p_assigned_to: assignToUserId,
      });

      if (callError) throw callError;
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de l\'assignation';
      setError(message);
      console.error('Assign incident error:', err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // Mettre à jour le statut d'un incident
  const updateIncidentStatus = useCallback(async (
    incidentId: number,
    newStatus: string
  ) => {
    try {
      setLoading(true);
      setError(null);

      const { error: callError } = await supabase.rpc('update_incident_status', {
        p_incident_id: incidentId,
        p_status: newStatus,
      });

      if (callError) throw callError;
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la mise à jour';
      setError(message);
      console.error('Update incident status error:', err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    incidents,
    loading,
    error,
    fetchIncidents,
    fetchIncidentById,
    reportIncident,
    assignIncident,
    updateIncidentStatus,
  };
}
