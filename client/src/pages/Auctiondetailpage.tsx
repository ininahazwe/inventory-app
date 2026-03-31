// src/pages/AuctionDetailPage.tsx
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, auth } from '../lib/apiClient';
import { useToast } from '../hooks/useToast';
import Layout from '../Layout';

interface AuctionDetail {
  id: number;
  asset_id: number;
  label: string;
  serial_no: string | null;
  category: string;
  starting_price: number;
  current_highest_bid: number | null;
  duration_days: number;
  status: 'active' | 'ended' | 'cancelled';
  end_date: string;
  purchase_price: number | null;
  created_by: string;
  winner_email: string | null;
}

interface Bid {
  id: number;
  amount: number;
  bidder_email: string;
  user_uid: string;
}

interface AuctionDetailView {
  auction: AuctionDetail;
  bids: Bid[];
  images: string[];
}

interface BidResponse {
  success: boolean;
  your_bid: number;
  current_highest_bid: number;
  message: string;
  toast?: {
    type: 'success' | 'error' | 'info' | 'warning';
    title: string;
    message: string;
  };
}

export default function AuctionDetailPage() {
  const { auctionId } = useParams<{ auctionId: string }>();
  const navigate = useNavigate();
  const { success: showSuccess, error: showError } = useToast();

  const [data, setData] = useState<AuctionDetailView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bidAmount, setBidAmount] = useState<string>('');
  const [bidLoading, setBidLoading] = useState(false);
  const [bidError, setBidError] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  useEffect(() => {
    setIsLoggedIn(auth.isAuthenticated());
    loadAuctionDetail();
  }, [auctionId]);

  const loadAuctionDetail = async () => {
    try {
      setLoading(true);
      setError(null);
      const { data: result, error: err } = await api.get<AuctionDetailView>(`/auctions/${auctionId}`);

      if (err || !result) {
        setError(err || 'Failed to load auction');
        return;
      }

      setData(result);
      // Set first image as selected if available
      if (result.images && result.images.length > 0) {
        setSelectedImage(result.images[0]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load auction');
    } finally {
      setLoading(false);
    }
  };

  const handlePlaceBid = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isLoggedIn) {
      showError('❌ Non authentifié', 'Veuillez vous connecter pour placer une enchère');
      return;
    }

    if (!data || !bidAmount) return;

    const amount = parseFloat(bidAmount);
    const minBid = data.auction.current_highest_bid
      ? data.auction.current_highest_bid + 1
      : data.auction.starting_price;

    if (amount < minBid) {
      setBidError(`Minimum bid is ${minBid}`);
      showError('❌ Montant invalide', `L'enchère minimum est ${minBid}`);
      return;
    }

    try {
      setBidLoading(true);
      setBidError(null);

      const { data: result, error: err } = await api.post<BidResponse>(
        `/auctions/${auctionId}/bid`,
        { amount }
      );

      if (err || !result) {
        const errorMsg = err || 'Failed to place bid';
        setBidError(errorMsg);
        showError('❌ Erreur', errorMsg);
        return;
      }

      // ✅ Afficher le toast depuis la réponse du backend
      if (result.toast) {
        showSuccess(result.toast.title, result.toast.message);
      } else {
        // Fallback si pas de toast dans la réponse
        showSuccess('✅ Enchère placée', `Votre enchère de ${amount} FCFA a été acceptée`);
      }

      // Refresh
      await loadAuctionDetail();
      setBidAmount('');
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to place bid';
      setBidError(errorMsg);
      showError('❌ Erreur', errorMsg);
    } finally {
      setBidLoading(false);
    }
  };

  const handleShareAuction = () => {
    const url = `${window.location.origin}/auctions/${auctionId}`;
    navigator.clipboard.writeText(url);
    showSuccess('✅ Lien copié', 'Le lien de l\'enchère a été copié dans le presse-papiers');
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = date.getTime() - now.getTime();
    if (diff < 0) return 'Ended';
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    if (days > 0) return `${days}j ${hours}h`;
    if (hours > 0) return `${hours}h`;
    return 'Closing soon';
  };

  if (loading) {
    return (
      <Layout>
        <div style={{ maxWidth: 800, margin: '0 auto', padding: '24px 12px', textAlign: 'center' }}>
          <p>Loading auction...</p>
        </div>
      </Layout>
    );
  }

  if (error || !data) {
    return (
      <Layout>
        <div style={{ maxWidth: 800, margin: '0 auto', padding: '24px 12px' }}>
          <div style={{ padding: 12, background: '#fee', color: '#c00', borderRadius: 4 }}>
            {error || 'Auction not found'}
          </div>
          {isLoggedIn && (
            <button
              onClick={() => navigate('/auctions')}
              className="pill"
              style={{ marginTop: 16, background: 'var(--brand)', color: 'white' }}
            >
              ← Back to Auctions
            </button>
          )}
        </div>
      </Layout>
    );
  }

  const { auction, bids, images: auctionImages } = data;
  const isActive = auction.status === 'active';
  const currentBid = auction.current_highest_bid || auction.starting_price;

  return (
    <Layout>
      <div style={{ maxWidth: 800, margin: '0 auto', padding: '24px 12px' }}>
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          {/* Bouton "Back" visible seulement pour les admins */}
          {isLoggedIn && (
            <button
              onClick={() => navigate('/auctions')}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--brand)',
                cursor: 'pointer',
                fontSize: 14,
                marginBottom: 12,
                padding: 0,
              }}
            >
              ← Back to Auctions
            </button>
          )}
          <h1 style={{ margin: '0 0 8px 0' }}>{auction.label}</h1>
          {auction.serial_no && (
            <p style={{ margin: '0 0 12px 0', color: 'var(--muted)', fontSize: 14 }}>
              SN: {auction.serial_no}
            </p>
          )}
        </div>

        {/* Image Gallery */}
        {auctionImages && auctionImages.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
              gap: 12,
              maxHeight: 300,
              overflowY: 'auto',
              marginBottom: 12,
            }}>
              {auctionImages.map((img, idx) => (
                <div
                  key={idx}
                  onClick={() => setSelectedImage(img)}
                  style={{
                    cursor: 'pointer',
                    borderRadius: 4,
                    overflow: 'hidden',
                    border: selectedImage === img ? '3px solid var(--brand)' : '1px solid #ddd',
                    transition: 'border 0.2s',
                  }}
                >
                  <img
                    src={img}
                    alt={`auction ${idx}`}
                    style={{
                      width: '100%',
                      height: '100px',
                      objectFit: 'cover',
                    }}
                  />
                </div>
              ))}
            </div>
            {selectedImage && (
              <div style={{
                borderRadius: 4,
                overflow: 'hidden',
                border: '1px solid #ddd',
                background: '#f5f5f5',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                minHeight: 200,
              }}>
                <img
                  src={selectedImage}
                  alt="selected"
                  style={{
                    maxWidth: '100%',
                    maxHeight: '400px',
                    objectFit: 'contain',
                  }}
                />
              </div>
            )}
          </div>
        )}

        {/* Status & Time */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
          <div>
            <p style={{ color: 'var(--muted)', fontSize: 12, margin: '0 0 4px 0' }}>Status</p>
            <p style={{ fontWeight: 600, margin: 0 }}>
              {isActive ? '🔨 Active' : auction.status === 'ended' ? 'Ended' : 'Cancelled'}
            </p>
          </div>
          <div>
            <p style={{ color: 'var(--muted)', fontSize: 12, margin: '0 0 4px 0' }}>Time Left</p>
            <p style={{
              fontWeight: 600,
              margin: 0,
              color: isActive && formatTime(auction.end_date).includes('h') ? '#d32f2f' : 'inherit',
            }}>
              {formatTime(auction.end_date)}
            </p>
          </div>
          <div>
            <p style={{ color: 'var(--muted)', fontSize: 12, margin: '0 0 4px 0' }}>Category</p>
            <p style={{ fontWeight: 600, margin: 0 }}>{auction.category || '—'}</p>
          </div>
          {auction.purchase_price && (
            <div>
              <p style={{ color: 'var(--muted)', fontSize: 12, margin: '0 0 4px 0' }}>Purchase Price</p>
              <p style={{ fontWeight: 600, margin: 0 }}>${auction.purchase_price}</p>
            </div>
          )}
        </div>

        {/* Share Button */}
        <div style={{ marginBottom: 24 }}>
          <button
            onClick={handleShareAuction}
            style={{
              width: '100%',
              padding: '12px 16px',
              background: '#f0f0f0',
              border: '1px solid #ddd',
              borderRadius: 4,
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'background 0.2s',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#e0e0e0'}
            onMouseLeave={(e) => e.currentTarget.style.background = '#f0f0f0'}
          >
            🔗 Share Auction Link
          </button>
        </div>

        {/* Price Box */}
        <div style={{
          background: '#f5f3ff',
          border: '1px solid #e0d7ff',
          borderRadius: 4,
          padding: 16,
          marginBottom: 24,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ color: 'var(--muted)' }}>Starting Price:</span>
            <span style={{ fontWeight: 600 }}>${auction.starting_price}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 12, borderTop: '1px solid #e0d7ff' }}>
            <span style={{ fontWeight: 600 }}>Current Bid:</span>
            <span style={{ fontSize: 20, fontWeight: 700, color: '#8D86C9' }}>
              ${currentBid}
            </span>
          </div>
        </div>

        {/* Bid Form */}
        {isActive ? (
          !isLoggedIn ? (
            <div style={{
              background: '#fff3cd',
              border: '1px solid #ffc107',
              borderRadius: 4,
              padding: 16,
              marginBottom: 24,
              textAlign: 'center',
            }}>
              <p style={{ margin: '0 0 12px 0', fontWeight: 500 }}>
                Please log in to place a bid
              </p>
              <button
                onClick={() => navigate('/')}
                className="pill"
                style={{ background: 'var(--brand)', color: 'white' }}
              >
                Log In
              </button>
            </div>
          ) : (
            <form onSubmit={handlePlaceBid} style={{ marginBottom: 24 }}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>
                  Your Bid
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={bidAmount}
                  onChange={(e) => setBidAmount(e.target.value)}
                  placeholder={`Min: $${
                    auction.current_highest_bid
                      ? auction.current_highest_bid + 1
                      : auction.starting_price
                  }`}
                  className="input"
                  style={{ marginBottom: 4 }}
                />
                <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>
                  Minimum bid: $
                  {auction.current_highest_bid
                    ? auction.current_highest_bid + 1
                    : auction.starting_price}
                </p>
              </div>
              {bidError && <p style={{ color: '#c00', fontSize: 12, marginBottom: 12 }}>{bidError}</p>}
              <button
                type="submit"
                disabled={bidLoading || !bidAmount}
                className="pill"
                style={{
                  width: '100%',
                  background: bidLoading || !bidAmount ? '#ccc' : 'var(--brand)',
                  color: 'white',
                  cursor: bidLoading || !bidAmount ? 'not-allowed' : 'pointer',
                }}
              >
                {bidLoading ? 'Placing bid...' : 'Place Bid'}
              </button>
            </form>
          )
        ) : (
          // Auction ended - show winner
          <div style={{
            background: auction.winner_email ? '#e8f5e9' : '#f5f5f5',
            border: auction.winner_email ? '2px solid #4caf50' : '1px solid #ddd',
            borderRadius: 4,
            padding: 16,
            marginBottom: 24,
            textAlign: 'center',
          }}>
            {auction.winner_email ? (
              <>
                <p style={{ margin: '0 0 8px 0', fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>
                  🏆 AUCTION ENDED - WINNER
                </p>
                <p style={{ margin: '0 0 12px 0', fontWeight: 700, fontSize: 18, color: '#2e7d32' }}>
                  {auction.winner_email}
                </p>
                <p style={{ margin: '0 0 12px 0', fontSize: 12, color: 'var(--muted)' }}>
                  Winning bid: <strong style={{ color: '#8D86C9' }}>${auction.current_highest_bid}</strong>
                </p>
              </>
            ) : (
              <>
                <p style={{ margin: '0 0 8px 0', fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>
                  AUCTION ENDED
                </p>
                <p style={{ margin: 0, fontWeight: 500 }}>No bids were placed</p>
              </>
            )}
          </div>
        )}

        {/* Bid History */}
        <div>
          <h3 style={{ fontWeight: 600, marginBottom: 12 }}>Bid History</h3>
          {bids.length === 0 ? (
            <p style={{ color: 'var(--muted)', textAlign: 'center', padding: 16 }}>No bids yet</p>
          ) : (
            <div style={{ maxHeight: 400, overflowY: 'auto' }}>
              {bids.map((bid, idx) => (
                <div
                  key={bid.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px 0',
                    borderBottom: '1px solid #eee',
                  }}
                >
                  <div>
                    <p style={{ margin: 0, fontWeight: 500 }}>
                      {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '•'} {bid.bidder_email}
                    </p>
                  </div>
                  <p style={{ margin: 0, fontWeight: 600, color: '#8D86C9' }}>${bid.amount}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
