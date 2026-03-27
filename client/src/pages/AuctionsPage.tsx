// src/pages/AuctionsPage.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/apiClient';
import { usePermissions } from '../hooks/usePermissions';
import { useNavigate } from 'react-router-dom';
import Modal from '../components/Modal';
import Layout from "../Layout.tsx";

interface Auction {
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
  bid_count: number;
  created_by: string;
}

interface AuctionDetail extends Auction {
  purchase_price: number | null;
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
}

const ITEMS_PER_PAGE = 10;

export default function AuctionsPage() {
  const navigate = useNavigate();
  const { isSuperAdmin } = usePermissions();

  const [auctions, setAuctions] = useState<Auction[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [filter, setFilter] = useState<'active' | 'ended' | 'all'>('active');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedAuction, setSelectedAuction] = useState<AuctionDetailView | null>(null);
  const [bidAmount, setBidAmount] = useState<string>('');
  const [bidLoading, setBidLoading] = useState(false);
  const [bidError, setBidError] = useState<string | null>(null);

  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, totalCount);

  const load = useMemo(() => async () => {
    try {
      setLoading(true);
      setError(null);
      const { data, error: err } = await api.get<Auction[]>('/auctions');

      if (err || !data) {
        setError(err || 'Failed to load auctions');
        return;
      }

      // Filter by status
      let filtered = data;
      if (filter !== 'all') {
        filtered = data.filter(a => a.status === filter);
      }

      setTotalCount(filtered.length);
      // Paginate
      const paginated = filtered.slice(
        (currentPage - 1) * ITEMS_PER_PAGE,
        currentPage * ITEMS_PER_PAGE
      );
      setAuctions(paginated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load auctions');
    } finally {
      setLoading(false);
    }
  }, [filter, currentPage]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filter]);

  const openDetail = async (auctionId: number) => {
    try {
      const { data, error: err } = await api.get<AuctionDetailView>(`/auctions/${auctionId}`);
      if (err || !data) {
        alert(err || 'Failed to load auction detail');
        return;
      }
      setSelectedAuction(data);
      setBidError(null);
      setBidAmount('');
      setDetailOpen(true);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to load auction');
    }
  };

  const closeDetail = () => {
    setDetailOpen(false);
    setSelectedAuction(null);
    setBidAmount('');
    setBidError(null);
  };

  const handlePlaceBid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAuction || !bidAmount) return;

    const amount = parseFloat(bidAmount);
    const minBid = selectedAuction.auction.current_highest_bid
      ? selectedAuction.auction.current_highest_bid + 1
      : selectedAuction.auction.starting_price;

    if (amount < minBid) {
      setBidError(`Minimum bid is ${minBid}`);
      return;
    }

    try {
      setBidLoading(true);
      setBidError(null);
      const { data, error: err } = await api.post<{
        success: boolean;
        your_bid: number;
        current_highest_bid: number;
        message: string;
      }>(`/auctions/${selectedAuction.auction.id}/bid`, { amount });

      if (err || !data) {
        setBidError(err || 'Failed to place bid');
        return;
      }

      // Refresh detail
      const refreshResult = await api.get<AuctionDetailView>(`/auctions/${selectedAuction.auction.id}`);
      if (refreshResult.data) {
        setSelectedAuction(refreshResult.data);
      }

      setBidAmount('');
      alert('Bid placed successfully!');
      await load();
    } catch (err) {
      setBidError(err instanceof Error ? err.message : 'Failed to place bid');
    } finally {
      setBidLoading(false);
    }
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

  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    const maxVisible = 5;
    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      const start = Math.max(1, currentPage - 2);
      const end = Math.min(totalPages, start + maxVisible - 1);
      if (start > 1) {
        pages.push(1);
        if (start > 2) pages.push('...');
      }
      for (let i = start; i <= end; i++) pages.push(i);
      if (end < totalPages) {
        if (end < totalPages - 1) pages.push('...');
        pages.push(totalPages);
      }
    }
    return pages;
  };

  return (
    <Layout>
      <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, padding: '12px' }}>
        <h2 style={{ margin: 0, letterSpacing: 0.2 }}>🔨 Enchères</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {isSuperAdmin && (
            <button className="pill" onClick={() => navigate('/auctions/create')}>
              + Create Auction
            </button>
          )}
        </div>
      </div>

      {error && (
        <div style={{ padding: 12, margin: 12, background: '#fee', color: '#c00', borderRadius: 4 }}>
          {error}
        </div>
      )}

      {/* Filtres */}
      <div className="filters" style={{ marginBottom: 16 }}>
        <button
          className="pill"
          onClick={() => setFilter('active')}
          style={{
            background: filter === 'active' ? 'var(--brand)' : '#f4f1ee',
            color: filter === 'active' ? 'white' : 'var(--ink)',
          }}
        >
          Active
        </button>
        <button
          className="pill"
          onClick={() => setFilter('ended')}
          style={{
            background: filter === 'ended' ? 'var(--brand)' : '#f4f1ee',
            color: filter === 'ended' ? 'white' : 'var(--ink)',
          }}
        >
          Ended
        </button>
        <button
          className="pill"
          onClick={() => setFilter('all')}
          style={{
            background: filter === 'all' ? 'var(--brand)' : '#f4f1ee',
            color: filter === 'all' ? 'white' : 'var(--ink)',
          }}
        >
          All
        </button>
      </div>

      {/* Table */}
      <table className="table">
        <thead>
        <tr style={{ background: '#8D86C9' }}>
          <th>Asset</th>
          <th>Category</th>
          <th className="status">Status</th>
          <th className="status">Starting</th>
          <th className="status">Current Bid</th>
          <th className="status">Time Left</th>
          <th className="status">Bids</th>
          <th></th>
        </tr>
        </thead>
        <tbody>
        {auctions.map((a) => {
          const isActive = a.status === 'active';
          const currentBid = a.current_highest_bid || a.starting_price;

          return (
            <tr key={a.id}>
              <td>
                <div style={{ fontWeight: 500 }}>{a.label}</div>
                {a.serial_no && (
                  <div style={{ color: 'var(--muted)', fontSize: 12 }}>SN: {a.serial_no}</div>
                )}
              </td>
              <td>{a.category || '—'}</td>
              <td className="status" style={{ textTransform: 'capitalize' }}>
                  <span style={{
                    display: 'inline-block',
                    padding: '4px 8px',
                    borderRadius: 4,
                    background: isActive ? '#e8f5e9' : a.status === 'ended' ? '#f5f5f5' : '#ffebee',
                    color: isActive ? '#2e7d32' : a.status === 'ended' ? '#666' : '#c62828',
                    fontSize: 12,
                    fontWeight: 500,
                  }}>
                    {isActive ? '🔨 Active' : a.status === 'ended' ? 'Ended' : 'Cancelled'}
                  </span>
              </td>
              <td className="status">${a.starting_price}</td>
              <td className="status" style={{ color: '#8D86C9', fontWeight: 600 }}>
                ${currentBid}
              </td>
              <td className="status" style={{
                color: isActive && formatTime(a.end_date).includes('h') ? '#d32f2f' : 'inherit',
                fontWeight: formatTime(a.end_date).includes('h') ? 600 : 400,
              }}>
                {formatTime(a.end_date)}
              </td>
              <td className="status">{a.bid_count}</td>
              <td>
                <div className="actions">
                  <button className="pill green-light" onClick={() => openDetail(a.id)}>
                    {isActive ? 'Bid' : 'View'}
                  </button>
                </div>
              </td>
            </tr>
          );
        })}
        {auctions.length === 0 && !loading && (
          <tr>
            <td colSpan={8} style={{ padding: 16, color: 'var(--muted)', textAlign: 'center' }}>
              No auctions found
            </td>
          </tr>
        )}
        {loading && (
          <tr>
            <td colSpan={8} style={{ padding: 16, color: 'var(--muted)', textAlign: 'center' }}>
              Loading...
            </td>
          </tr>
        )}
        </tbody>
      </table>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 20, padding: '16px 0' }}>
          <button
            className="pill"
            onClick={() => setCurrentPage(p => p - 1)}
            disabled={currentPage === 1}
            style={{ opacity: currentPage === 1 ? 0.5 : 1 }}
          >
            ← Previous
          </button>
          {getPageNumbers().map((page, i) =>
            page === '...' ? (
              <span key={i} style={{ padding: '0 8px', color: 'var(--muted)' }}>
                …
              </span>
            ) : (
              <button
                key={page}
                className="pill"
                onClick={() => setCurrentPage(page as number)}
                style={{
                  background: currentPage === page ? 'var(--brand)' : '#f4f1ee',
                  color: currentPage === page ? 'white' : 'var(--ink)',
                  minWidth: 36,
                  textAlign: 'center',
                }}
              >
                {page}
              </button>
            )
          )}
          <button
            className="pill"
            onClick={() => setCurrentPage(p => p + 1)}
            disabled={currentPage === totalPages}
            style={{ opacity: currentPage === totalPages ? 0.5 : 1 }}
          >
            Next →
          </button>
          {totalCount > 0 && (
            <div style={{ marginLeft: 16, color: 'var(--muted)', fontSize: 14 }}>
              Showing {startIndex + 1}-{endIndex} of {totalCount}
            </div>
          )}
        </div>
      )}

      {/* Modal Détail + Bid */}
      <Modal open={detailOpen} onClose={closeDetail} title={selectedAuction ? `${selectedAuction.auction.label}` : ''}>
        {selectedAuction && (
          <div>
            {/* Asset Info */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
              <div>
                <p style={{ color: 'var(--muted)', fontSize: 12, margin: '0 0 4px 0' }}>Category</p>
                <p style={{ fontWeight: 500, margin: 0 }}>{selectedAuction.auction.category}</p>
              </div>
              <div>
                <p style={{ color: 'var(--muted)', fontSize: 12, margin: '0 0 4px 0' }}>Status</p>
                <p style={{ fontWeight: 500, margin: 0, textTransform: 'capitalize' }}>
                  {selectedAuction.auction.status}
                </p>
              </div>
              {selectedAuction.auction.purchase_price && (
                <div>
                  <p style={{ color: 'var(--muted)', fontSize: 12, margin: '0 0 4px 0' }}>Purchase Price</p>
                  <p style={{ fontWeight: 500, margin: 0 }}>${selectedAuction.auction.purchase_price}</p>
                </div>
              )}
              <div>
                <p style={{ color: 'var(--muted)', fontSize: 12, margin: '0 0 4px 0' }}>Time Left</p>
                <p style={{ fontWeight: 500, margin: 0 }}>
                  {selectedAuction.auction.status === 'active' ? formatTime(selectedAuction.auction.end_date) : 'Ended'}
                </p>
              </div>
            </div>

            {/* Price Box */}
            <div style={{
              background: '#f5f3ff',
              border: '1px solid #e0d7ff',
              borderRadius: 4,
              padding: 12,
              marginBottom: 20,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ color: 'var(--muted)' }}>Starting:</span>
                <span style={{ fontWeight: 600 }}>${selectedAuction.auction.starting_price}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, borderTop: '1px solid #e0d7ff' }}>
                <span style={{ fontWeight: 600 }}>Current Bid:</span>
                <span style={{ fontSize: 18, fontWeight: 700, color: '#8D86C9' }}>
                  ${selectedAuction.auction.current_highest_bid || selectedAuction.auction.starting_price}
                </span>
              </div>
            </div>

            {/* Bid Form */}
            {selectedAuction.auction.status === 'active' && (
              <form onSubmit={handlePlaceBid} style={{ marginBottom: 20 }}>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500 }}>
                    Your Bid
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={bidAmount}
                    onChange={(e) => setBidAmount(e.target.value)}
                    placeholder={`Min: $${
                      selectedAuction.auction.current_highest_bid
                        ? selectedAuction.auction.current_highest_bid + 1
                        : selectedAuction.auction.starting_price
                    }`}
                    className="input"
                    style={{ marginBottom: 4 }}
                  />
                  <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>
                    Minimum bid: $
                    {selectedAuction.auction.current_highest_bid
                      ? selectedAuction.auction.current_highest_bid + 1
                      : selectedAuction.auction.starting_price}
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
            )}

            {selectedAuction.auction.status === 'ended' && (
              <div style={{
                background: '#f5f5f5',
                border: '1px solid #ddd',
                borderRadius: 4,
                padding: 12,
                marginBottom: 20,
                textAlign: 'center',
              }}>
                <p style={{ margin: 0, fontWeight: 500 }}>
                  {selectedAuction.auction.winner_email
                    ? `Won by: ${selectedAuction.auction.winner_email}`
                    : 'No bids placed'}
                </p>
              </div>
            )}

            {/* Bid History */}
            <div>
              <p style={{ fontWeight: 600, marginBottom: 12 }}>Bid History</p>
              {selectedAuction.bids.length === 0 ? (
                <p style={{ color: 'var(--muted)', textAlign: 'center', padding: 16 }}>No bids yet</p>
              ) : (
                <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                  {selectedAuction.bids.map((bid, idx) => (
                    <div
                      key={bid.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '8px 12px',
                        background: idx % 2 === 0 ? '#fafafa' : 'white',
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
        )}
      </Modal>
    </div>
    </Layout>
  );
}
