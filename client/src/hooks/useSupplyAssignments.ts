// src/hooks/useSupplyAssignments.ts
import { useState } from 'react';
import { api } from '../lib/apiClient';

export type SupplyAssignmentInput = {
  supply_id: number;
  assigned_user_id?: string;
  location_id?: number;
  quantity_assigned: number;
  assigned_at: string;
};

export function useSupplyAssignments() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createAssignment = async (payload: SupplyAssignmentInput): Promise<boolean> => {
    setLoading(true);
    setError(null);
    const { error } = await api.post('/supply-assignments', payload);
    setLoading(false);
    if (error) {
      setError(error);
      return false;
    }
    return true;
  };

  return { createAssignment, loading, error };
}
