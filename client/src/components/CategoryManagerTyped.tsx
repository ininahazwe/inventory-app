// src/components/CategoryManagerTyped.tsx
import React, { useState } from 'react';

interface CategoryManagerTypedProps {
  type: 'asset' | 'supply';
  onCreated?: () => void;
}

export const CategoryManagerTyped: React.FC<CategoryManagerTypedProps> = ({ type, onCreated }) => {
  const [newCategory, setNewCategory] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleCreateCategory = async () => {
    if (!newCategory.trim()) {
      setError('Category name required');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setSuccess(false);

      const token = localStorage.getItem('jwt_token');
      const response = await fetch('http://localhost:3003/api/categories', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: newCategory.trim(),
          type: type, // ✅ Pass type
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create category');
      }

      setSuccess(true);
      setNewCategory('');
      setTimeout(() => {
        setSuccess(false);
        onCreated?.();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create category');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      padding: '16px',
      background: '#f9f9f9',
      borderRadius: '8px',
      border: '1px solid var(--line)',
    }}>
      <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', color: 'var(--ink)' }}>
        Create New {type === 'asset' ? 'Asset' : 'Supply'} Category
      </h3>

      {success && (
        <div style={{
          padding: 8,
          margin: '8px 0',
          background: '#d4edda',
          color: '#155724',
          borderRadius: 4,
          fontSize: 12,
        }}>
          ✅ Category created!
        </div>
      )}

      {error && (
        <div style={{
          padding: 8,
          margin: '8px 0',
          background: '#f8d7da',
          color: '#721c24',
          borderRadius: 4,
          fontSize: 12,
        }}>
          ❌ {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          placeholder="Category name..."
          value={newCategory}
          onChange={(e) => setNewCategory(e.target.value)}
          onKeyPress={(e) => {
            if (e.key === 'Enter') handleCreateCategory();
          }}
          style={{
            flex: 1,
            padding: '8px',
            border: '1px solid var(--line)',
            borderRadius: '4px',
            fontSize: '13px',
          }}
          disabled={loading}
        />
        <button
          onClick={handleCreateCategory}
          disabled={loading}
          style={{
            padding: '8px 16px',
            background: 'var(--brand)',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.6 : 1,
            fontSize: '13px',
            fontWeight: 500,
          }}
        >
          {loading ? 'Creating...' : 'Create'}
        </button>
      </div>
    </div>
  );
};
