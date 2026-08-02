import { useState, useEffect } from 'react';
import { api } from '../lib/apiClient';

export interface Category {
  id: number;
  name: string;
  type: 'asset' | 'supply';
  created_at: string;
  assets_count?: number;
  supplies_count?: number;
}

export const useCategories = (type?: 'asset' | 'supply') => {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCategories = async (searchTerm?: string) => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();

      if (type) {
        params.append('type', type);
      }
      if (searchTerm) {
        params.append('q', searchTerm);
      }

      const path = '/categories' + (params.toString() ? `?${params.toString()}` : '');
      const { data, error: apiError } = await api.get<Category[]>(path);

      if (apiError || !data) {
        throw new Error(apiError || 'Failed to load categories');
      }

      setCategories(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load categories';
      setError(message);
      console.error('Error loading categories:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCategories();
  }, [type]); // Reload when type changes

  return {
    categories,
    loading,
    error,
    loadCategories,
  };
};
