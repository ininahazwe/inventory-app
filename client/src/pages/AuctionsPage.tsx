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

interface AuctionsResponse {
  data: Auction[];
  pagination: {
    page: number;
    limit: number;
    total: number;
  };
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

  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedAuction, setSelectedAuction] = useState<AuctionDetailView | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);

  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, totalCount);

  // 🔥 FIX: Adapter à la nouvelle API qui retourne { data, pagination }
  const load = useMemo(() => async () => {
    try {
      setLoading(true);
      setError(null);
      const { data: response, error: err } = await api.get<AuctionsResponse>('/auctions');

      if (err || !response) {
        setError(err || 'Failed to load auctions');
        return;
      }

      // Accéder au tableau d'enchères depuis la réponse paginée
      const auctionsList = response.data || [];

      // Utiliser le total depuis la pagination response
      const apiTotal = response.pagination?.total || auctionsList.length;

      // Filter by status (optionnel, peut être fait côté serveur à l'avenir)
      let filtered = auctionsList;
      if (filter !== 'all') {
        filtered = auctionsList.filter(a => a.status === filter);
      }

      // Utiliser le total API si 'all', sinon le count filtré local
      const totalToShow = filter === 'all' ? apiTotal : filtered.length;
      setTotalCount(totalToShow);

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

  const openHistory = async (auctionId: number) => {
    try {
      const { data, error: err } = await api.get<AuctionDetailView>(`/auctions/${auctionId}`);
      if (err || !data) {
        alert(err || 'Failed to load auction');
        return;
      }
      setSelectedAuction(data);
      setHistoryOpen(true);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to load auction');
    }
  };

  const closeHistory = () => {
    setHistoryOpen(false);
    setSelectedAuction(null);
  };

  const handleCancelAuction = async (auctionId: number) => {
    if (!window.confirm('Are you sure you want to cancel this auction?')) {
      return;
    }

    try {
      setCancelLoading(true);
      const { data, error: err } = await api.post(`/auctions/${auctionId}/cancel`, {});

      if (err || !data) {
        alert(err || 'Failed to cancel auction');
        return;
      }

      alert('✅ Auction cancelled');
      closeHistory();
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to cancel auction');
    } finally {
      setCancelLoading(false);
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
                  <div className="actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      className="pill"
                      onClick={() => openHistory(a.id)}
                      style={{ background: '#666', color: 'white', fontSize: 12 }}
                    >
                      History
                    </button>
                    <button
                      className="pill green-light"
                      onClick={() => navigate(`/auctions/${a.id}`)}
                      style={{ fontSize: 12 }}
                    >
                      {isActive ? 'Bid' : 'View'}
                    </button>
                    {isSuperAdmin && a.status === 'active' && (
                      <button
                        className="pill"
                        onClick={() => handleCancelAuction(a.id)}
                        style={{ background: '#d32f2f', color: 'white', fontSize: 12 }}
                        disabled={cancelLoading}
                      >
                        Cancel
                      </button>
                    )}
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

        {/* Modal Historique des mises */}
        <Modal open={historyOpen} onClose={closeHistory} title={selectedAuction ? `Bid History - ${selectedAuction.auction.label}` : ''}>
          {selectedAuction && (
            <div>
              {/* Prix actuel */}
              <div style={{
                background: '#f5f3ff',
                border: '1px solid #e0d7ff',
                borderRadius: 4,
                padding: 12,
                marginBottom: 16,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--muted)' }}>Current Bid:</span>
                  <span style={{ fontSize: 18, fontWeight: 700, color: '#8D86C9' }}>
                    ${selectedAuction.auction.current_highest_bid || selectedAuction.auction.starting_price}
                  </span>
                </div>
              </div>

              {/* Bid History */}
              {selectedAuction.bids.length === 0 ? (
                <p style={{ color: 'var(--muted)', textAlign: 'center', padding: 16 }}>No bids yet</p>
              ) : (
                <div>
                  {selectedAuction.bids.map((bid, idx) => (
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

              {/* Cancel Button */}
              {isSuperAdmin && selectedAuction.auction.status === 'active' && (
                <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #eee' }}>
                  <button
                    onClick={() => handleCancelAuction(selectedAuction.auction.id)}
                    disabled={cancelLoading}
                    className="pill"
                    style={{
                      width: '100%',
                      background: '#d32f2f',
                      color: 'white',
                      cursor: cancelLoading ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {cancelLoading ? 'Cancelling...' : '❌ Cancel Auction'}
                  </button>
                </div>
              )}
            </div>
          )}
        </Modal>
      </div>
    </Layout>
  );
}
