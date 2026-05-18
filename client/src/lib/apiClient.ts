// Utiliser URL relative pour que ça marche en prod ET dev
// /api → proxy automatiquement via Apache en prod, ou Vite dev server
const BASE_URL = '/api';

let googleInitialized = false;
let googleInitPromise: Promise<void> | null = null;

// ─── Token JWT ────────────────────────────────────────────────────────────────
export const token = {
  get: (): string | null => localStorage.getItem('jwt_token'),
  set: (t: string) => localStorage.setItem('jwt_token', t),
  remove: () => localStorage.removeItem('jwt_token'),
};

// ─── Client HTTP ──────────────────────────────────────────────────────────────
async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  requiresAuth = true
): Promise<{ data: T | null; error: string | null }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (requiresAuth) {
    const t = token.get();
    if (!t) return { data: null, error: 'Not authenticated' };
    headers['Authorization'] = `Bearer ${t}`;
  }

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const json = await res.json().catch(() => null);
    if (!res.ok) return { data: null, error: json?.error || `Error ${res.status}` };
    return { data: json as T, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Network error' };
  }
}

// ─── HTTP Methods ────────────────────────────────────────────────────────────
export const api = {
  get: <T>(path: string, auth = true) => request<T>('GET', path, undefined, auth),
  post: <T>(path: string, body?: unknown, auth = true) => request<T>('POST', path, body, auth),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};

// ─── User type ───────────────────────────────────────────────────────────────
export interface GoogleUser {
  id: string;
  email: string;
  name: string;
  picture: string;
  role: string;
}

// ─── RPC Routes Map ───────────────────────────────────────────────────────────
const rpcRouteMap: Record<string, { method: 'GET' | 'POST'; path: (params: any) => string }> = {
  // ✅ Query RPCs (GET)
  'is_admin': { method: 'GET', path: (p) => `/users/is_admin?email=${encodeURIComponent(p?.email || '')}` },
  'is_super_admin': { method: 'GET', path: (p) => `/users/is_super_admin?email=${encodeURIComponent(p?.email || '')}` },
  'is_email_allowed': { method: 'GET', path: (p) => `/users/is_email_allowed?email=${encodeURIComponent(p?.email || '')}` },
  'is_current_admin': { method: 'GET', path: () => '/me/is-admin' },
  'get_asset_stats': { method: 'POST', path: () => '/rpc/get_asset_stats' },

  // ✅ Asset RPCs (POST)
  'return_asset': { method: 'POST', path: () => '/rpc/return_asset' },
  'send_to_repair': { method: 'POST', path: () => '/rpc/send_to_repair' },
  'exit_repair': { method: 'POST', path: () => '/rpc/exit_repair' },
  'retire_asset': { method: 'POST', path: () => '/rpc/retire_asset' },

  // ✅ Assignment RPCs (POST)
  'assign_asset': { method: 'POST', path: () => '/rpc/assign_asset' },
  'unassign_asset': { method: 'POST', path: () => '/rpc/unassign_asset' },
  'assignees_rename': { method: 'POST', path: () => '/rpc/assignees_rename' },
  'assignees_delete': { method: 'POST', path: () => '/rpc/assignees_delete' },

  // Legacy/Admin RPCs
  'list_allowed_emails': { method: 'GET', path: () => '/allowed-emails' },
  'add_allowed_email': { method: 'POST', path: () => '/allowed-emails' },
  'remove_allowed_email': { method: 'POST', path: () => '/allowed-emails/remove' },
  'list_all_users': { method: 'GET', path: () => '/users' },
  'add_user': { method: 'POST', path: () => '/users' },
  'change_user_role': { method: 'POST', path: () => '/users/role' },
  'delete_user': { method: 'POST', path: () => '/users/delete' },
};

// ─── RPC Generic Call ────────────────────────────────────────────────────────
export async function rpc<T = unknown>(
  name: string,
  params?: Record<string, unknown>
): Promise<{ data: T | null; error: string | null }> {
  const route = rpcRouteMap[name];
  if (!route) {
    console.warn(`Unknown RPC function: ${name}`);
    return { data: null, error: `Unknown RPC function: ${name}` };
  }

  const path = route.path(params);

  if (route.method === 'GET') {
    return api.get<T>(path);
  } else {
    return api.post<T>(path, params);
  }
}

// ─── Named RPC Methods (for convenience and autocomplete) ───────────────────
export const rpcMethods = {
  is_admin: (email: string) => rpc<{ result: boolean }>('is_admin', { email }),
  is_super_admin: (email: string) => rpc<{ result: boolean }>('is_super_admin', { email }),
  is_email_allowed: (email: string) => rpc<{ result: boolean }>('is_email_allowed', { email }),
  assign_asset: (assetId: string, userEmail: string, assignedByEmail: string) =>
    rpc<{ success: boolean }>('assign_asset', { asset_id: assetId, user_email: userEmail, assigned_by_email: assignedByEmail }),
  unassign_asset: (assetId: string, unassignedByEmail: string) =>
    rpc<{ success: boolean }>('unassign_asset', { asset_id: assetId, unassigned_by_email: unassignedByEmail }),
  return_asset: (assetId: number) =>
    rpc<{ success: boolean }>('return_asset', { p_asset_id: assetId }),
  send_to_repair: (assetId: number, notes?: string) =>
    rpc<{ success: boolean }>('send_to_repair', { p_asset_id: assetId, p_notes: notes }),
  exit_repair: (assetId: number, notes?: string, cost?: number) =>
    rpc<{ success: boolean; repair_cost?: number }>('exit_repair', { p_asset_id: assetId, p_notes: notes, p_cost: cost }),
  retire_asset: (assetId: number, notes?: string) =>
    rpc<{ success: boolean }>('retire_asset', { p_asset_id: assetId, p_notes: notes }),
};

// ─── Wait for Google SDK to load ───────────────────────────────────────────
const waitForGoogle = (): Promise<void> => {
  return new Promise((resolve) => {
    if (window.google) {
      resolve();
      return;
    }

    let attempts = 0;
    const maxAttempts = 100; // 5 seconds with 50ms intervals

    const checkGoogle = setInterval(() => {
      if (window.google) {
        clearInterval(checkGoogle);
        resolve();
      }
      attempts++;
      if (attempts >= maxAttempts) {
        clearInterval(checkGoogle);
        console.error('Google SDK failed to load after 5 seconds');
        resolve(); // Resolve anyway to prevent hanging
      }
    }, 50);
  });
};

// 🔥 FIX: Obtenir client_id depuis import.meta.env (build-time) en priorité
const getGoogleClientId = (): string | undefined => {
  // 1. import.meta.env (Vite - constant à la build, toujours présent en prod/dev)
  if (import.meta.env.VITE_GOOGLE_CLIENT_ID) {
    console.log('✅ Google Client ID from import.meta.env (build-time)');
    return import.meta.env.VITE_GOOGLE_CLIENT_ID;
  }

  // 2. Fallback: window.__ENV__ (runtime override si besoin)
  if (typeof window !== 'undefined' && (window as any).__ENV__?.VITE_GOOGLE_CLIENT_ID) {
    console.log('✅ Google Client ID from window.__ENV__ (runtime override)');
    return (window as any).__ENV__.VITE_GOOGLE_CLIENT_ID;
  }

  // 3. Erreur
  console.error('❌ Google Client ID not found in import.meta.env or window.__ENV__');
  return undefined;
};

// ─── Auth (Google ID Token Flow) ─────────────────────────────────────────────
export const auth = {
  initGoogle: (): Promise<void> => {
    if (googleInitPromise) return googleInitPromise;

    googleInitPromise = (async () => {
      await waitForGoogle();

      if (googleInitialized || !window.google) return;
      googleInitialized = true;

      const clientId = getGoogleClientId();
      if (!clientId) {
        console.error('❌ Cannot initialize Google Sign-In: client_id is missing');
        return;
      }

      console.log('Initializing Google Sign-In...');

      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async (response: { credential?: string }) => {
          console.log('Google callback received:', !!response.credential);

          if (!response.credential) {
            console.error('No credential in Google response');
            return;
          }

          try {
            const { data, error } = await api.post<{
              token: string;
              user: GoogleUser;
            }>('/auth/google', { token: response.credential }, false);

            if (error || !data) {
              console.error('Auth failed:', error);
              return;
            }

            console.log('Auth successful, redirecting...');
            token.set(data.token);
            window.location.href = '/';
          } catch (err) {
            console.error('Sign-in error:', err);
          }
        },
      });

      console.log('Google Sign-In initialized');
    })();

    return googleInitPromise;
  },

  signInWithGoogle: async (): Promise<void> => {
    await auth.initGoogle();

    if (!window.google) {
      console.error('Google SDK not loaded');
      return;
    }

    console.log('Rendering Google Sign-In button...');

    window.google.accounts.id.renderButton(
      document.getElementById('google-signin-button') || document.body,
      { theme: 'outline', size: 'large' }
    );

    // Also show the One Tap prompt
    window.google.accounts.id.prompt((notification) => {
      console.log('One Tap notification:', notification);
    });
  },

  signOut: async () => {
    if (window.google) {
      window.google.accounts.id.disableAutoSelect();
    }
    token.remove();
    await api.post('/auth/logout', {}, false);
    window.location.href = '/';
  },

  getUser: async () => {
    return api.get<GoogleUser>('/auth/me');
  },

  isAuthenticated: (): boolean => !!token.get(),
};

// ─── Global type for Google SDK ──────────────────────────────────────────────
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback?: (response: { credential?: string }) => void;
          }) => void;
          renderButton: (element: HTMLElement | null, options: Record<string, unknown>) => void;
          prompt: (callback?: (notification: { isNotDisplayed: () => boolean; isSkippedMoment: () => boolean }) => void) => void;
          disableAutoSelect: () => void;
          callback?: (response: { credential?: string }) => void;
        };
      };
    };
  }
}
