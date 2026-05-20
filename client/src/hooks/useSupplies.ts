// src/hooks/useSupplies.ts
import { useState, useCallback } from 'react';

export interface Supply {
  id: number;
  name: string;
  purchase_date: string;
  cost: number;
  brand?: string;
  quantity: number;
  receiver_uid: number;
  receiver_email?: string;
}

export const useSupplies = () => {
  const [supplies, setSupplies] = useState<Supply[]>([]);
  const [totalCost, setTotalCost] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiUrl = 'http://localhost:3003/api/supplies';

  const fetchSupplies = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('jwt_token');
      if (!token) {
        setError('No authentication token found');
        return;
      }

      const response = await fetch(apiUrl, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!response.ok) {
        const data = await response.json();
        setError(`Error ${response.status}: ${data.message || 'Failed to fetch supplies'}`);
        return;
      }

      const data = await response.json();
      setSupplies(data.supplies || []);
      setTotalCost(data.totalCost || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  const createSupply = useCallback(
    async (supply: Omit<Supply, 'id'>) => {
      try {
        const token = localStorage.getItem('jwt_token');
        if (!token) {
          setError('No authentication token found');
          return false;
        }

        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify(supply),
        });

        if (!response.ok) {
          const data = await response.json();
          setError(`Error ${response.status}: ${data.message || 'Failed to create supply'}`);
          return false;
        }

        await fetchSupplies();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        return false;
      }
    },
    [fetchSupplies]
  );

  const updateSupply = useCallback(
    async (id: number, supply: Partial<Supply>) => {
      try {
        const token = localStorage.getItem('jwt_token');
        if (!token) {
          setError('No authentication token found');
          return false;
        }

        const response = await fetch(`${apiUrl}/${id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify(supply),
        });

        if (!response.ok) {
          const data = await response.json();
          setError(`Error ${response.status}: ${data.message || 'Failed to update supply'}`);
          return false;
        }

        await fetchSupplies();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        return false;
      }
    },
    [fetchSupplies]
  );

  const deleteSupply = useCallback(
    async (id: number) => {
      try {
        const token = localStorage.getItem('jwt_token');
        if (!token) {
          setError('No authentication token found');
          return false;
        }

        const response = await fetch(`${apiUrl}/${id}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` },
        });

        if (!response.ok) {
          const data = await response.json();
          setError(`Error ${response.status}: ${data.message || 'Failed to delete supply'}`);
          return false;
        }

        await fetchSupplies();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        return false;
      }
    },
    [fetchSupplies]
  );

  return {
    supplies,
    totalCost,
    loading,
    error,
    fetchSupplies,
    createSupply,
    updateSupply,
    deleteSupply,
  };
};
