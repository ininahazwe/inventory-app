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

interface AssetsResponse {
  data: Asset[];
  pagination: {
    page: number;
    limit: number;
    total: number;
  };
}

interface UploadedImage {
  url: string;
  public_id: string;
}

export default function CreateAuctionPage() {
  const navigate = useNavigate();
  const { isAdmin, loading: permissionsLoading } = usePermissions();

  // Redirect if not admin
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
    notes: '',
  });

  const [assets, setAssets] = useState<Asset[]>([]);
  const [allAssets, setAllAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [assetSearch, setAssetSearch] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // Images
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Load all in_stock assets on mount
  useEffect(() => {
    loadAllAssets();
  }, []);

  // Filter assets based on search
  useEffect(() => {
    if (!assetSearch.trim()) {
      setAssets(allAssets);
    } else {
      const searchLower = assetSearch.toLowerCase();
      const filtered = allAssets.filter(a =>
        a.label.toLowerCase().includes(searchLower) ||
        (a.serial_no && a.serial_no.toLowerCase().includes(searchLower)) ||
        (a.category_name && a.category_name.toLowerCase().includes(searchLower))
      );
      setAssets(filtered);
    }
  }, [assetSearch, allAssets]);

  const loadAllAssets = async () => {
    try {
      const { data: response, error: err } = await api.get<AssetsResponse>(
        '/assets?status=in_stock&limit=1000'
      );
      if (!err && response?.data) {
        setAllAssets(response.data);
        setAssets(response.data);
      }
    } catch (err) {
      console.error('Failed to load assets:', err);
    }
  };

  const handleSelectAsset = (asset: Asset) => {
    setFormData(prev => ({ ...prev, asset_id: asset.id.toString() }));
    setAssetSearch(asset.label);
    setDropdownOpen(false);
  };

  const handleUploadImages = async (files: FileList | null) => {
    if (!files) return;

    setUploading(true);
    setUploadError(null);

    try {
      const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
      const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

      if (!cloudName || !uploadPreset) {
        throw new Error('Cloudinary config missing');
      }

      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('upload_preset', uploadPreset);

        const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          throw new Error('Upload failed');
        }

        const data = await response.json();
        setUploadedImages(prev => [
          ...prev,
          { url: data.secure_url, public_id: data.public_id }
        ]);
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const removeImage = (publicId: string) => {
    setUploadedImages(prev => prev.filter(img => img.public_id !== publicId));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.asset_id || !formData.starting_price || !formData.duration_days) {
      setError('Please fill in all required fields');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Send auction + images together (Cloudinary URLs)
      const { data, error: err } = await api.post<{ id: number; asset_id: number }>(
        '/auctions',
        {
          asset_id: parseInt(formData.asset_id),
          starting_price: parseFloat(formData.starting_price),
          duration_days: parseInt(formData.duration_days),
          notes: formData.notes || null,
          images: uploadedImages.map(img => img.url), // Send Cloudinary URLs
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

  return (
    <Layout>
      <div style={{ maxWidth: 600, margin: '0 auto', padding: 20 }}>
        <h1>Create Auction</h1>

        {success && (
          <div style={{
            padding: 12,
            margin: '12px 0',
            background: '#d4edda',
            color: '#155724',
            borderRadius: 4,
          }}>
            ✅ Auction created successfully! Redirecting...
          </div>
        )}

        {error && (
          <div style={{
            padding: 12,
            margin: '12px 0',
            background: '#f8d7da',
            color: '#721c24',
            borderRadius: 4,
          }}>
            ❌ {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Asset Selection */}
          <div style={{ marginBottom: 20 }}>
            <label>
              <strong>Asset *</strong>
              <div style={{ position: 'relative', marginTop: 8 }}>
                <input
                  type="text"
                  placeholder="Search asset..."
                  value={assetSearch}
                  onChange={(e) => {
                    setAssetSearch(e.target.value);
                    setDropdownOpen(true);
                  }}
                  onFocus={() => setDropdownOpen(true)}
                  onBlur={() => {
                    // Delay to allow click on dropdown items
                    setTimeout(() => setDropdownOpen(false), 200);
                  }}
                  style={{
                    width: '100%',
                    padding: 8,
                    border: dropdownOpen ? '2px solid var(--brand)' : '1px solid #ddd',
                    borderRadius: 4,
                    boxSizing: 'border-box',
                    transition: 'border-color 0.2s',
                  }}
                />

                {dropdownOpen && assets.length > 0 && (
                  <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    background: 'white',
                    border: '1px solid #ddd',
                    borderTop: 'none',
                    borderRadius: '0 0 4px 4px',
                    maxHeight: 200,
                    overflowY: 'auto',
                    zIndex: 10,
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                  }}>
                    {assets.map((asset) => (
                      <div
                        key={asset.id}
                        onMouseDown={() => handleSelectAsset(asset)}
                        style={{
                          padding: 10,
                          borderBottom: '1px solid #eee',
                          cursor: 'pointer',
                          background: formData.asset_id === asset.id.toString() ? '#e3f2fd' : 'white',
                          transition: 'background-color 0.1s',
                        }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLElement).style.backgroundColor = formData.asset_id === asset.id.toString() ? '#e3f2fd' : '#f9f9f9';
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLElement).style.backgroundColor = formData.asset_id === asset.id.toString() ? '#e3f2fd' : 'white';
                        }}
                      >
                        <strong>{asset.label}</strong> {asset.serial_no && `(${asset.serial_no})`}
                        {asset.category_name && <span style={{ color: '#666', marginLeft: 4, fontSize: 12 }}>{asset.category_name}</span>}
                      </div>
                    ))}
                  </div>
                )}

                {/* Show message if no results */}
                {dropdownOpen && assetSearch && assets.length === 0 && (
                  <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    background: 'white',
                    border: '1px solid #ddd',
                    borderTop: 'none',
                    borderRadius: '0 0 4px 4px',
                    padding: 10,
                    color: '#999',
                    zIndex: 10,
                  }}>
                    No assets found
                  </div>
                )}
              </div>
            </label>
          </div>

          {/* Starting Price */}
          <div style={{ marginBottom: 20 }}>
            <label>
              <strong>Starting Price (ghs) *</strong>
              <input
                type="number"
                step="0.01"
                min="0"
                value={formData.starting_price}
                onChange={(e) => setFormData(prev => ({ ...prev, starting_price: e.target.value }))}
                style={{
                  width: '100%',
                  padding: 8,
                  marginTop: 8,
                  border: '1px solid #ddd',
                  borderRadius: 4,
                  boxSizing: 'border-box',
                }}
              />
            </label>
          </div>

          {/* Duration */}
          <div style={{ marginBottom: 20 }}>
            <label>
              <strong>Duration (days) *</strong>
              <input
                type="number"
                min="1"
                max="365"
                value={formData.duration_days}
                onChange={(e) => setFormData(prev => ({ ...prev, duration_days: e.target.value }))}
                style={{
                  width: '100%',
                  padding: 8,
                  marginTop: 8,
                  border: '1px solid #ddd',
                  borderRadius: 4,
                  boxSizing: 'border-box',
                }}
              />
            </label>
          </div>

          {/* Notes */}
          <div style={{ marginBottom: 20 }}>
            <label>
              <strong>Notes</strong>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="Additional notes..."
                style={{
                  width: '100%',
                  padding: 8,
                  marginTop: 8,
                  border: '1px solid #ddd',
                  borderRadius: 4,
                  boxSizing: 'border-box',
                  minHeight: 80,
                  fontFamily: 'inherit',
                }}
              />
            </label>
          </div>

          {/* Images Upload */}
          <div style={{ marginBottom: 20 }}>
            <label>
              <strong>Images</strong>
              <input
                type="file"
                multiple
                accept="image/*"
                onChange={(e) => handleUploadImages(e.target.files)}
                disabled={uploading}
                style={{ display: 'block', marginTop: 8 }}
              />
              {uploading && <p style={{ margin: '8px 0 0 0', color: '#666' }}>Uploading...</p>}
              {uploadError && <p style={{ margin: '8px 0 0 0', color: '#c00' }}>❌ {uploadError}</p>}
            </label>

            {uploadedImages.length > 0 && (
              <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {uploadedImages.map((img) => (
                  <div key={img.public_id} style={{ position: 'relative' }}>
                    <img
                      src={img.url}
                      alt="Auction"
                      style={{
                        width: 80,
                        height: 80,
                        objectFit: 'cover',
                        borderRadius: 4,
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => removeImage(img.public_id)}
                      style={{
                        position: 'absolute',
                        top: -8,
                        right: -8,
                        width: 24,
                        height: 24,
                        borderRadius: '50%',
                        background: '#c00',
                        color: 'white',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: 14,
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Submit */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="submit"
              disabled={loading}
              style={{
                flex: 1,
                padding: 12,
                background: 'var(--brand)',
                color: 'white',
                border: 'none',
                borderRadius: 4,
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? 'Creating...' : 'Create Auction'}
            </button>
            <button
              type="button"
              onClick={() => navigate('/auctions')}
              style={{
                flex: 1,
                padding: 12,
                background: '#f4f1ee',
                color: 'var(--ink)',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
}
