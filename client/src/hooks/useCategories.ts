import { useState, useEffect } from 'react';

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

      const token = localStorage.getItem('jwt_token');
      let url = 'http://localhost:3003/api/categories';
      const params = new URLSearchParams();

      if (type) {
        params.append('type', type);
      }
      if (searchTerm) {
        params.append('q', searchTerm);
      }

      if (params.toString()) {
        url += '?' + params.toString();
      }

      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error('Failed to load categories');
      }

      const data = (await response.json()) as Category[];
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
