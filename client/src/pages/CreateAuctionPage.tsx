// src/pages/CreateAuctionPage.tsx
import React, { useEffect, useState } from 'react';
import { api } from '../lib/apiClient';
import { useNavigate } from 'react-router-dom';
import { usePermissions } from '../hooks/usePermissions';
import Layout from '../Layout';

interface Asset {
  id: number;
  label: string;
  serial_no: string | null;
  status: string;
  category_name: string | null;
}

export default function CreateAuctionPage() {
  const navigate = useNavigate();
  const { isAdmin, loading: permissionsLoading } = usePermissions();

  // Redirect si pas admin - mais attendre le chargement d'abord
  useEffect(() => {
    if (!permissionsLoading && !isAdmin) {
      alert('Only admins can create auctions');
      navigate('/auctions');
    }
  }, [isAdmin, permissionsLoading, navigate]);

  const [formData, setFormData] = useState({
    asset_id: '',
    starting_price: '',
    duration_days: '7',
  });

  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [assetSearch, setAssetSearch] = useState('');

  // Charger les assets "in_stock"
  useEffect(() => {
    loadAssets();
  }, [assetSearch]);

  const loadAssets = async () => {
    try {
      const { data, error: err } = await api.get<{ data: Asset[]; count: number }>(
        `/assets?limit=50${assetSearch ? `&label=${encodeURIComponent(assetSearch)}` : ''}`
      );

      if (!err && data) {
        const inStock = (data as any).data.filter((a: Asset) => a.status === 'in_stock');
        setAssets(inStock);
      }
    } catch (err) {
      console.error('Error loading assets:', err);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.asset_id || !formData.starting_price || !formData.duration_days) {
      setError('All fields are required');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const { data, error: err } = await api.post<{ id: number; asset_id: number }>(
        '/auctions',
        {
          asset_id: parseInt(formData.asset_id),
          starting_price: parseFloat(formData.starting_price),
          duration_days: parseInt(formData.duration_days),
        }
      );

      if (err || !data) {
        setError(err || 'Failed to create auction');
        return;
      }

      setSuccess(true);
      setTimeout(() => {
        navigate('/auctions');
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create auction');
    } finally {
      setLoading(false);
    }
  };

  const selectedAsset = assets.find(a => a.id === parseInt(formData.asset_id || '0'));

  // Afficher loader pendant chargement des permissions
  if (permissionsLoading) {
    return (
      <Layout>
        <div style={{ maxWidth: 600, margin: '0 auto', padding: '24px 12px', textAlign: 'center' }}>
          <p>Loading permissions...</p>
        </div>
      </Layout>
    );
  }

  // Si pas admin après chargement, le useEffect redirige déjà
  if (!isAdmin) {
    return null;
  }

  return (
    <Layout>
      <div style={{ maxWidth: 600, margin: '0 auto', padding: '24px 12px' }}>
        <h1 style={{ marginBottom: 24 }}>🔨 Create Auction</h1>

        {error && (
          <div style={{
            padding: 12,
            background: '#fee',
            color: '#c00',
            borderRadius: 4,
            marginBottom: 16,
          }}>
            {error}
          </div>
        )}

        {success && (
          <div style={{
            padding: 12,
            background: '#efe',
            color: '#0a0',
            borderRadius: 4,
            marginBottom: 16,
          }}>
            ✅ Auction created successfully! Redirecting...
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Asset Selection */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>
              Asset *
            </label>
            <input
              type="text"
              placeholder="Search assets..."
              value={assetSearch}
              onChange={(e) => setAssetSearch(e.target.value)}
              className="input"
              style={{ marginBottom: 8 }}
            />

            {assets.length > 0 ? (
              <div style={{
                border: '1px solid #ddd',
                borderRadius: 4,
                maxHeight: 200,
                overflowY: 'auto',
              }}>
                {assets.map(asset => (
                  <div
                    key={asset.id}
                    onClick={() => {
                      setFormData(prev => ({ ...prev, asset_id: String(asset.id) }));
                      setAssetSearch('');
                    }}
                    style={{
                      padding: 12,
                      borderBottom: '1px solid #eee',
                      cursor: 'pointer',
                      background: formData.asset_id === String(asset.id) ? '#f0f0f0' : 'white',
                      transition: 'background 0.2s',
                    }}
                    onMouseEnter={(e) => {
                      if (formData.asset_id !== String(asset.id)) {
                        (e.currentTarget as HTMLDivElement).style.background = '#fafafa';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (formData.asset_id !== String(asset.id)) {
                        (e.currentTarget as HTMLDivElement).style.background = 'white';
                      }
                    }}
                  >
                    <div style={{ fontWeight: 500 }}>{asset.label}</div>
                    {asset.serial_no && (
                      <div style={{ fontSize: 12, color: '#666' }}>SN: {asset.serial_no}</div>
                    )}
                    {asset.category_name && (
                      <div style={{ fontSize: 12, color: '#999' }}>{asset.category_name}</div>
                    )}
                  </div>
                ))}
              </div>
            ) : assetSearch ? (
              <div style={{ padding: 12, color: '#999', textAlign: 'center' }}>
                No assets found
              </div>
            ) : (
              <div style={{ padding: 12, color: '#999', textAlign: 'center' }}>
                Type to search for in-stock assets
              </div>
            )}

            {selectedAsset && (
              <div style={{
                marginTop: 12,
                padding: 12,
                background: '#f5f5f5',
                borderRadius: 4,
              }}>
                <p style={{ margin: '0 0 4px 0', fontWeight: 500 }}>Selected:</p>
                <p style={{ margin: 0, fontWeight: 600 }}>{selectedAsset.label}</p>
                {selectedAsset.serial_no && (
                  <p style={{ margin: '4px 0 0 0', fontSize: 12, color: '#666' }}>
                    SN: {selectedAsset.serial_no}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Starting Price */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>
              Starting Price ($) *
            </label>
            <input
              type="number"
              name="starting_price"
              value={formData.starting_price}
              onChange={handleChange}
              placeholder="e.g., 100"
              step="0.01"
              min="0"
              className="input"
              required
            />
          </div>

          {/* Duration */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>
              Duration (days) *
            </label>
            <select
              name="duration_days"
              value={formData.duration_days}
              onChange={handleChange}
              className="input"
              required
            >
              <option value="1">1 day</option>
              <option value="3">3 days</option>
              <option value="7">7 days (default)</option>
              <option value="14">14 days</option>
              <option value="21">21 days</option>
              <option value="30">30 days</option>
            </select>
          </div>

          {/* Form Actions */}
          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => navigate('/auctions')}
              className="pill"
              style={{ background: '#bbb', color: 'white' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !formData.asset_id}
              className="pill"
              style={{
                background: loading || !formData.asset_id ? '#ccc' : 'var(--brand)',
                color: 'white',
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? 'Creating...' : 'Create Auction'}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
}
