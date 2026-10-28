// src/hooks/useMemos.ts
// Types, libellés et couleurs partagés du module Memos, plus un petit accès
// aux routes /api/memos. La machine à états reste celle du serveur : les
// boutons affichés viennent de `capabilities`, jamais d'une règle recopiée ici.
import { useEffect, useState } from 'react';
import { api, token } from '../lib/apiClient';

export type MemoStatus =
  | 'draft' | 'in_review' | 'approved' | 'released'
  | 'release_refused' | 'returned' | 'rejected' | 'withdrawn';

export const MEMO_STATUS_LABEL: Record<MemoStatus, string> = {
  draft: 'Draft',
  in_review: 'In review',
  approved: 'Approved',
  released: 'Released',
  release_refused: 'Release refused',
  returned: 'Returned',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};

export const MEMO_STATUS_COLOR: Record<MemoStatus, string> = {
  draft: '#6b7280',
  in_review: '#b45309',
  approved: '#2563eb',
  released: '#16a34a',
  release_refused: '#c2410c',
  returned: '#d97706',
  rejected: '#b91c1c',
  withdrawn: '#9ca3af',
};

export const STEP_STATUS_LABEL: Record<string, string> = {
  pending: 'Waiting', active: 'Awaiting action', done: 'Done',
  returned: 'Returned', rejected: 'Rejected', refused: 'Refused', skipped: 'Skipped',
};

export const STEP_KIND_VERB: Record<string, string> = {
  submit: 'Submitted', recommend: 'Recommended', approve: 'Approved', release: 'Released',
};

export type MemoType = {
  id: number; code: string; name: string;
  requires_amount: number; requires_project: number; requires_attachment: number;
};
export type ChainStep = {
  template_id: number; step_no: number; kind: 'recommend' | 'approve' | 'release';
  label: string; position_code: string; position_label: string; holders: number;
};
export type ChainTemplate = { id: number; type_id: number; name: string; is_default: number; steps: ChainStep[] };
export type MemoProject = { id: number; code: string; title: string; donor: string | null; default_currency: string | null };
export type MemoMeta = {
  types: MemoType[]; templates: ChainTemplate[]; projects: MemoProject[];
  managers: Array<{ position_code: string; email: string; holder_role: 'holder' | 'deputy' }>;
  signature: { id: number; source: string; created_at: string } | null;
};

// ─── Administration (projets, types, circuits) ─────────────────────────────
export type ChainKind = 'recommend' | 'approve' | 'release';
export type AdminChainStep = { step_no: number; kind: ChainKind; label: string; position_code: string; position_label: string; holders: number };
export type AdminTemplate = { id: number; type_id: number; name: string; is_default: number; is_active: number; memo_count: number; steps: AdminChainStep[] };
export type AdminType = {
  id: number; code: string; name: string; requires_amount: number; requires_project: number; requires_attachment: number;
  is_active: number; memo_count: number; templates: AdminTemplate[];
};
export type AdminProject = { id: number; code: string; title: string; donor: string | null; default_currency: string | null; is_active: number; memo_count: number };
export type AdminConfig = { types: AdminType[]; projects: AdminProject[]; levels: Array<{ code: string; label: string }> };
export type ChainStepDraft = { kind: ChainKind; position_code: string; label: string };

export type MemoRow = {
  id: number; reference: string | null; type_id: number; author_email: string;
  to_label: string; from_label: string; subject: string; memo_date: string | null;
  amount: string | number | null; currency: string | null; status: MemoStatus;
  revision_no: number; current_step_no: number; type_name: string;
  project_code: string | null; waiting_for: string | null;
  last_event_at: string | null; updated_at: string; submitted_at: string | null;
};

export type MemoStep = {
  id: number; revision_no: number; step_no: number; kind: string; label: string; status: string; assigned_email: string | null;
  acted_by_email: string | null; acted_at: string | null; comment: string | null;
  signed: number; position_code: string; position_label: string;
};
export type MemoEvent = {
  id: number; revision_no: number; step_no: number | null; event_type: string;
  from_status: string | null; to_status: string | null; actor_email: string | null;
  event_at: string; payload: any; notes: string | null;
};
export type MemoCapabilities = {
  edit: boolean; submit: boolean; withdraw: boolean; decide: boolean;
  release: boolean; reinstruct: boolean; reassign: boolean; waiting_for: string | null;
};
export type MemoFull = MemoRow & {
  body: string | null; to_label: string; from_label: string; activity_ref: string | null;
  project_id: number | null; project_title: string | null; project_donor: string | null; release_reference: string | null;
  template_id: number | null; manager_email: string | null;
  steps: MemoStep[]; attachments: any[]; events: MemoEvent[]; capabilities: MemoCapabilities;
};

export type MemoFields = {
  type_id: number; template_id?: number | null; to_label: string; from_label: string;
  subject: string; body: string; memo_date: string; amount?: string | number | null;
  currency?: string | null; project_id?: number | null; activity_ref?: string | null; manager_email?: string | null;
};

export const SIGNATURE_REQUIRED = 'SIGNATURE_REQUIRED';

/** Récupère une image protégée (JWT) et renvoie une URL d'objet affichable dans <img>. */
export async function fetchImageUrl(path: string): Promise<string | null> {
  try {
    const res = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${token.get() || ''}` } });
    if (!res.ok) return null;
    return URL.createObjectURL(await res.blob());
  } catch { return null; }
}

/** <img> d'une image protégée ; libère l'URL d'objet au démontage. */
export function useProtectedImage(path: string | null, refreshKey: unknown = 0) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path) { setUrl(null); return; }
    let revoked = false; let made: string | null = null;
    fetchImageUrl(path).then(u => { if (revoked) { if (u) URL.revokeObjectURL(u); } else { made = u; setUrl(u); } });
    return () => { revoked = true; if (made) URL.revokeObjectURL(made); };
  }, [path, refreshKey]);
  return url;
}

export const memosApi = {
  meta: () => api.get<MemoMeta>('/memos/meta'),
  stats: () => api.get<{ to_act: number; oldest_waiting_since: string | null; to_finish: number; in_progress: number }>('/memos/stats'),
  list: (query: string) => api.get<MemoRow[]>(`/memos${query}`),
  get: (id: number) => api.get<MemoFull>(`/memos/${id}`),
  create: (f: MemoFields) => api.post<{ id: number }>('/memos', f),
  update: (id: number, f: Partial<MemoFields>) => api.put<{ success: boolean }>(`/memos/${id}`, f),
  submit: (id: number) => api.patch<{ success: boolean; reference?: string }>(`/memos/${id}/submit`, {}),
  decide: (id: number, decision: 'approve' | 'return' | 'reject', comment?: string) =>
    api.patch<{ success: boolean; status: MemoStatus }>(`/memos/${id}/decision`, { decision, comment }),
  release: (id: number, body: { decision: 'release' | 'refuse'; release_reference?: string; comment?: string }) =>
    api.patch<{ success: boolean; status: MemoStatus }>(`/memos/${id}/release`, body),
  reinstruct: (id: number, comment: string) => api.patch(`/memos/${id}/reinstruct`, { comment }),
  reassign: (id: number, email: string | null) => api.patch<{ success: boolean; assigned_email: string | null }>(`/memos/${id}/assignee`, { email }),
  withdraw: (id: number, reason?: string) => api.patch(`/memos/${id}/withdraw`, { reason }),
  saveSignature: (image: string, source: 'drawn' | 'typed' | 'uploaded') =>
    api.post<{ success: boolean }>('/memos/signature', { image, source }),
  adminConfig: () => api.get<AdminConfig>('/memos/admin/config'),
  createProject: (b: { code: string; title: string; donor?: string; default_currency?: string }) => api.post<{ id: number }>('/memos/admin/projects', b),
  patchProject: (id: number, b: Partial<{ title: string; donor: string; default_currency: string; is_active: boolean }>) => api.patch(`/memos/admin/projects/${id}`, b),
  createType: (b: { code: string; name: string; requires_amount?: boolean; requires_project?: boolean; requires_attachment?: boolean }) => api.post<{ id: number }>('/memos/admin/types', b),
  patchType: (id: number, b: Partial<{ name: string; requires_amount: boolean; requires_project: boolean; requires_attachment: boolean; is_active: boolean }>) => api.patch(`/memos/admin/types/${id}`, b),
  createChain: (typeId: number, b: { name: string; steps: ChainStepDraft[]; is_default?: boolean }) => api.post<{ id: number }>(`/memos/admin/types/${typeId}/templates`, b),
  patchChain: (id: number, b: Partial<{ name: string; is_default: boolean; is_active: boolean }>) => api.patch(`/memos/admin/templates/${id}`, b),
  saveChain: (id: number, steps: ChainStepDraft[]) => api.put(`/memos/admin/templates/${id}/chain`, { steps }),
  positions: () => api.get<any[]>('/memos/admin/positions'),
  addHolder: (code: string, email: string, holder_role: 'holder' | 'deputy') =>
    api.post(`/memos/admin/positions/${code}/holders`, { email, holder_role }),
  patchHolder: (id: number, body: { is_active?: boolean; holder_role?: 'holder' | 'deputy' }) =>
    api.patch(`/memos/admin/holders/${id}`, body),
};

export const fmtDate = (v: string | null | undefined) => (v ? new Date(v).toLocaleDateString('en-GB') : '—');
export const fmtDateTime = (v: string | null | undefined) => (v ? new Date(v).toLocaleString('en-GB') : '—');
