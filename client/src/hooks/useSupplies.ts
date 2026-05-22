import { useState, useCallback } from 'react';
import { api } from '../lib/apiClient'; // ✅ USE APICLIENT

export interface Supply {
  id: number;
  name: string;
  purchase_date: string;
  cost: number;
  brand?: string;
  quantity: number;
  receiver_uid?: string; // Email string from response
  receiver_email?: string; // Alternative field from response
  category_id?: number;
  category_name?: string;
  created_at: string;
  updated_at?: string;
}

// ✅ Interface pour créer une supply (ce qu'on envoie)
export interface SupplyInput {
  name: string;
  purchase_date: string;
  cost: number;
  brand?: string;
  quantity: number;
  receiver_uid: string; // Email string
  category_id?: number;
}

export const useSupplies = () => {
  const [supplies, setSupplies] = useState<Supply[]>([]);
  const [totalCost, setTotalCost] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ✅ FETCH SUPPLIES (using apiClient)
  const fetchSupplies = useCallback(async (categoryId?: number) => {
    try {
      setLoading(true);
      setError(null);

      let path = '/supplies';
      if (categoryId) {
        path += `?category_id=${categoryId}`;
      }

      // ✅ Use apiClient instead of fetch
      const { data, error: apiError } = await api.get<{
        supplies: Supply[];
        totalCost: number;
      }>(path);

      if (apiError || !data) {
        throw new Error(apiError || 'Failed to fetch supplies');
      }

      setSupplies(data.supplies || []);
      setTotalCost(data.totalCost || 0);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch supplies';
      setError(message);
      console.error('Error fetching supplies:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // ✅ CREATE SUPPLY (using apiClient)
  const createSupply = useCallback(async (supply: SupplyInput) => {
    try {
      setError(null);

      // ✅ Use apiClient instead of fetch
      const { data, error: apiError } = await api.post<Supply>(
        '/supplies',
        supply
      );

      if (apiError || !data) {
        throw new Error(apiError || 'Failed to create supply');
      }

      setSupplies(prev => [data, ...prev]);
      await fetchSupplies(); // Refresh to get updated totals
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create supply';
      setError(message);
      console.error('Error creating supply:', err);
      return false;
    }
  }, [fetchSupplies]);

  // ✅ UPDATE SUPPLY (using apiClient)
  const updateSupply = useCallback(async (id: number, updates: Partial<SupplyInput>) => {
    try {
      setError(null);

      // ✅ Use apiClient instead of fetch
      const { data, error: apiError } = await api.patch<Supply>(
        `/supplies/${id}`,
        updates
      );

      if (apiError || !data) {
        throw new Error(apiError || 'Failed to update supply');
      }

      setSupplies(prev => prev.map(s => s.id === id ? data : s));
      await fetchSupplies(); // Refresh to get updated totals
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update supply';
      setError(message);
      console.error('Error updating supply:', err);
      return false;
    }
  }, [fetchSupplies]);

  // ✅ DELETE SUPPLY (using apiClient)
  const deleteSupply = useCallback(async (id: number) => {
    try {
      setError(null);

      // ✅ Use apiClient instead of fetch
      const { error: apiError } = await api.delete<void>(`/supplies/${id}`);

      if (apiError) {
        throw new Error(apiError || 'Failed to delete supply');
      }

      setSupplies(prev => prev.filter(s => s.id !== id));
      await fetchSupplies(); // Refresh to get updated totals
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete supply';
      setError(message);
      console.error('Error deleting supply:', err);
      return false;
    }
  }, [fetchSupplies]);

  return {
    supplies,
    totalCost,
    loading,
    error,
    fetchSupplies,
    createSupply,
    updateSupply,
    deleteSupply,
    refetchSupplies: fetchSupplies,
  };
};
