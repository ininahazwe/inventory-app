// src/hooks/useLoans.ts
// Accès aux routes /api/loans. Le statut « overdue » n'est pas un statut stocké :
// le serveur le renvoie calculé (is_overdue / days_past_due) à chaque lecture —
// on ne le recalcule jamais côté client, pour qu'il n'existe qu'une définition.
import { useCallback, useState } from 'react';
import { api } from '../lib/apiClient';

export type LoanStatus = 'requested' | 'approved' | 'rejected' | 'cancelled' | 'checked_out' | 'returned';
export type ConditionIn = 'good' | 'fair' | 'damaged' | 'lost';

export type Loan = {
  id: number;
  asset_id: number;
  asset_label?: string | null;
  asset_serial_no?: string | null;
  asset_category?: string | null;
  asset_status?: string | null;
  borrower_uid: string | null;
  borrower_email: string;
  purpose: string | null;
  start_date: string;
  due_date: string;
  status: LoanStatus;
  requested_by_email: string;
  requested_at: string | null;
  decided_by_email: string | null;
  decided_at: string | null;
  decision_notes: string | null;
  checked_out_at: string | null;
  checked_out_by_email: string | null;
  condition_out: string | null;
  returned_at: string | null;
  received_by_email: string | null;
  condition_in: string | null;
  return_location_id: number | null;
  return_location_name?: string | null;
  incident_id: number | null;
  extended_count: number;
  notes: string | null;
  is_overdue: number;
  days_past_due: number;
};

export type LoanEvent = {
  id: number;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  actor_email: string | null;
  event_at: string;
  payload: Record<string, any> | null;
  notes: string | null;
};

export type LoanStats = {
  pending: number; approved: number; out: number;
  overdue: number; due_today: number; returned: number;
};

export function useLoans() {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [stats, setStats] = useState<LoanStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLoans = useCallback(async (query = '') => {
    setLoading(true);
    setError(null);
    const { data, error } = await api.get<Loan[]>(`/loans${query}`);
    if (error) setError(error); else setLoans(data ?? []);
    setLoading(false);
  }, []);

  const fetchStats = useCallback(async () => {
    const { data } = await api.get<LoanStats>('/loans/stats');
    if (data) setStats(data);
  }, []);

  const fetchLoan = useCallback(async (id: number) => {
    const { data, error } = await api.get<Loan & { events: LoanEvent[] }>(`/loans/${id}`);
    if (error) { setError(error); return null; }
    return data;
  }, []);

  const checkAvailability = useCallback(
    async (assetId: number, startDate: string, dueDate: string) => {
      const { data, error } = await api.get<{ available: boolean; reason?: string; upcoming?: any[] }>(
        `/loans/availability?asset_id=${assetId}&start_date=${startDate}&due_date=${dueDate}`
      );
      if (error) return { available: false, reason: error };
      return data!;
    },
    []
  );

  const requestLoan = useCallback(
    async (body: { asset_id: number; start_date: string; due_date: string; purpose?: string; borrower_uid?: string }) =>
      api.post<{ id: number; status: LoanStatus }>('/loans', body),
    []
  );

  const decide = useCallback(
    (id: number, decision: 'approved' | 'rejected', notes?: string) =>
      api.patch(`/loans/${id}/decision`, { decision, notes }),
    []
  );

  const cancel = useCallback((id: number, reason?: string) => api.patch(`/loans/${id}/cancel`, { reason }), []);

  const checkout = useCallback(
    (id: number, condition_out: string, notes?: string) =>
      api.patch(`/loans/${id}/checkout`, { condition_out, notes }),
    []
  );

  const extend = useCallback(
    (id: number, due_date: string, reason?: string) => api.patch(`/loans/${id}/extend`, { due_date, reason }),
    []
  );

  const checkin = useCallback(
    (id: number, body: { condition_in: ConditionIn; return_location_id?: number; notes?: string; open_incident?: boolean }) =>
      api.patch<{ incident_id: number | null; asset_status: string }>(`/loans/${id}/checkin`, body),
    []
  );

  return {
    loans, stats, loading, error,
    fetchLoans, fetchStats, fetchLoan, checkAvailability,
    requestLoan, decide, cancel, checkout, extend, checkin,
  };
}

// ─── Présentation partagée entre les écrans ──────────────────────────────────
export const LOAN_STATUS_LABEL: Record<LoanStatus, string> = {
  requested: 'Pending approval',
  approved: 'Approved — awaiting pickup',
  rejected: 'Declined',
  cancelled: 'Cancelled',
  checked_out: 'Out',
  returned: 'Returned',
};

export const LOAN_STATUS_COLOR: Record<LoanStatus, string> = {
  requested: '#b45309',
  approved: '#2563eb',
  rejected: '#b91c1c',
  cancelled: '#6b7280',
  checked_out: '#7c3aed',
  returned: '#16a34a',
};
