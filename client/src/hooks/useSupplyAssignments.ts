import { useState, useCallback } from 'react';
import { api } from '../lib/apiClient';

export interface SupplyAssignment {
  id: number;
  supply_id: number;
  supply_name?: string;
  assignee_name: string;
  assignee_email: string;
  assigned_user_id: string;
  user_email?: string;
  location_id?: number;
  location_name?: string;
  location_floor?: string;
  quantity_assigned: number;
  assigned_at: string;
  returned_at?: string;
  status: 'active' | 'returned';
  created_at: string;
}

export interface SupplyAssignmentInput {
  supply_id: number;
  assigned_user_id?: string;
  location_id?: number;
  quantity_assigned: number;
  assigned_at: string;
}

export const useSupplyAssignments = () => {
  const [assignments, setAssignments] = useState<SupplyAssignment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ✅ Fetch assignments (with optional filters)
  const fetchAssignments = useCallback(async (filters?: {
    supply_id?: number;
    status?: string;
  }) => {
    try {
      setLoading(true);
      setError(null);

      let path = '/supply-assignments';
      const params = new URLSearchParams();

      if (filters?.supply_id) {
        params.append('supply_id', filters.supply_id.toString());
      }
      if (filters?.status) {
        params.append('status', filters.status);
      }

      if (params.toString()) {
        path += '?' + params.toString();
      }

      const { data, error: apiError } = await api.get<SupplyAssignment[]>(path);

      if (apiError || !data) {
        throw new Error(apiError || 'Failed to fetch assignments');
      }

      setAssignments(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch assignments';
      setError(message);
      console.error('Error fetching assignments:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // ✅ Create assignment (user et/ou location)
  const createAssignment = useCallback(async (assignment: SupplyAssignmentInput) => {
    try {
      setError(null);

      const { data, error: apiError } = await api.post<SupplyAssignment>(
        '/supply-assignments',
        assignment
      );

      if (apiError || !data) {
        throw new Error(apiError || 'Failed to create assignment');
      }

      setAssignments(prev => [data, ...prev]);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create assignment';
      setError(message);
      console.error('Error creating assignment:', err);
      return false;
    }
  }, []);

  // ✅ Return assignment (mark as returned)
  const returnAssignment = useCallback(async (id: number, returned_at: string) => {
    try {
      setError(null);

      const { data, error: apiError } = await api.patch<SupplyAssignment>(
        `/supply-assignments/${id}`,
        {
          status: 'returned',
          returned_at
        }
      );

      if (apiError || !data) {
        throw new Error(apiError || 'Failed to return assignment');
      }

      setAssignments(prev => prev.map(a => a.id === id ? data : a));
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to return assignment';
      setError(message);
      console.error('Error returning assignment:', err);
      return false;
    }
  }, []);

  // ✅ Delete assignment
  const deleteAssignment = useCallback(async (id: number) => {
    try {
      setError(null);

      const { error: apiError } = await api.delete<void>(`/supply-assignments/${id}`);

      if (apiError) {
        throw new Error(apiError || 'Failed to delete assignment');
      }

      setAssignments(prev => prev.filter(a => a.id !== id));
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete assignment';
      setError(message);
      console.error('Error deleting assignment:', err);
      return false;
    }
  }, []);

  return {
    assignments,
    loading,
    error,
    fetchAssignments,
    createAssignment,
    returnAssignment,
    deleteAssignment,
  };
};
