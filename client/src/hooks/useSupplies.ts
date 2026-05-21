import { useState, useCallback } from 'react';

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

  const getAuthHeader = () => {
    const token = localStorage.getItem('jwt_token');
    return { 'Authorization': `Bearer ${token}` };
  };

  const fetchSupplies = useCallback(async (categoryId?: number) => {
    try {
      setLoading(true);
      setError(null);

      let url = 'http://localhost:3003/api/supplies';
      if (categoryId) {
        url += `?category_id=${categoryId}`;
      }

      const response = await fetch(url, {
        headers: getAuthHeader(),
      });

      if (!response.ok) {
        throw new Error('Failed to fetch supplies');
      }

      const data = await response.json();
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

  // ✅ Accept SupplyInput (ce qu'on envoie au backend)
  const createSupply = useCallback(async (supply: SupplyInput) => {
    try {
      setError(null);

      const response = await fetch('http://localhost:3003/api/supplies', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeader(),
        },
        body: JSON.stringify(supply),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create supply');
      }

      const newSupply = await response.json();
      setSupplies(prev => [newSupply, ...prev]);
      await fetchSupplies(); // Refresh to get updated totals
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create supply';
      setError(message);
      console.error('Error creating supply:', err);
      return false;
    }
  }, [fetchSupplies]);

  const updateSupply = useCallback(async (id: number, updates: Partial<SupplyInput>) => {
    try {
      setError(null);

      const response = await fetch(`http://localhost:3003/api/supplies/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeader(),
        },
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update supply');
      }

      const updated = await response.json();
      setSupplies(prev => prev.map(s => s.id === id ? updated : s));
      await fetchSupplies(); // Refresh to get updated totals
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update supply';
      setError(message);
      console.error('Error updating supply:', err);
      return false;
    }
  }, [fetchSupplies]);

  const deleteSupply = useCallback(async (id: number) => {
    try {
      setError(null);

      const response = await fetch(`http://localhost:3003/api/supplies/${id}`, {
        method: 'DELETE',
        headers: getAuthHeader(),
      });

      if (!response.ok) {
        throw new Error('Failed to delete supply');
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
