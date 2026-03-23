const BASE_URL = (window.__ENV__?.VITE_API_URL || import.meta.env.VITE_API_URL || "/api");
//const BASE_URL = import.meta.env.VITE_API_URL || '/api';

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
  'is_admin': { method: 'GET', path: (p) => `/rpc/is_admin?email=${encodeURIComponent(p?.email || '')}` },
  'is_super_admin': { method: 'GET', path: (p) => `/rpc/is_super_admin?email=${encodeURIComponent(p?.email || '')}` },
  'is_email_allowed': { method: 'GET', path: (p) => `/rpc/is_email_allowed?email=${encodeURIComponent(p?.email || '')}` },
  'is_current_admin': { method: 'GET', path: () => '/me/is-admin' },
  'assign_asset': { method: 'POST', path: () => '/rpc/assign_asset' },
  'unassign_asset': { method: 'POST', path: () => '/rpc/unassign_asset' },
  'return_asset': { method: 'POST', path: () => '/assets/return' },
  'list_allowed_emails': { method: 'GET', path: () => '/allowed-emails' },
  'add_allowed_email': { method: 'POST', path: () => '/allowed-emails' },
  'remove_allowed_email': { method: 'POST', path: () => '/allowed-emails/remove' },
  'list_all_users': { method: 'GET', path: () => '/users' },
  'add_user': { method: 'POST', path: () => '/users' },
  'change_user_role': { method: 'POST', path: () => '/users/role' },
  'delete_user': { method: 'POST', path: () => '/users/delete' },
  'assignees_rename': { method: 'POST', path: () => '/assignees/rename' },
  'assignees_delete': { method: 'POST', path: () => '/assignees/delete' },
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

// ─── Auth (Google ID Token Flow) ─────────────────────────────────────────────
export const auth = {
  initGoogle: (): Promise<void> => {
    if (googleInitPromise) return googleInitPromise;

    googleInitPromise = (async () => {
      await waitForGoogle();

      if (googleInitialized || !window.google) return;
      googleInitialized = true;

      console.log('Initializing Google Sign-In...');

      window.google.accounts.id.initialize({
          client_id: window.__ENV__?.VITE_GOOGLE_CLIENT_ID || import.meta.env.VITE_GOOGLE_CLIENT_ID,
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
    return api.get<GoogleUser>('/me');
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
