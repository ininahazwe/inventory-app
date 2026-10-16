// src/hooks/usePermissions.ts
import { useEffect, useState } from 'react';
import { auth, token } from '../lib/apiClient';

export interface UserInfo {
  id: string;
  email: string;
  name: string;
  picture: string;
  role: 'user' | 'admin' | 'super_admin';
}

// Shared cache: every component calling usePermissions() used to refetch
// /auth/me on mount, so on each page change the header briefly rendered
// without the user (no admin links, "Sign in" instead of "Log out") and then
// popped them in. With a module-level cache the first render is already correct.
let cachedUser: UserInfo | null = null;
let cachedToken: string | null = null;
let inflight: Promise<UserInfo | null> | null = null;

function currentToken() {
  try { return token.get() || null; } catch { return null; }
}

function loadUser(): Promise<UserInfo | null> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data, error } = await auth.getUser();
      if (!error && data) {
        cachedUser = {
          id: data.id,
          email: data.email,
          name: data.name,
          picture: data.picture,
          role: data.role as UserInfo['role'],
        };
        cachedToken = currentToken();
      } else {
        cachedUser = null;
      }
    } catch (err) {
      console.error('Permission check error:', err);
    } finally {
      inflight = null;
    }
    return cachedUser;
  })();
  return inflight;
}

export function getCachedUser(): UserInfo | null {
  // A different token (logout / login as someone else) invalidates the cache.
  if (cachedUser && cachedToken !== currentToken()) cachedUser = null;
  return cachedUser;
}

export function usePermissions() {
  const [userInfo, setUserInfo] = useState<UserInfo | null>(getCachedUser);
  const [loading, setLoading] = useState(getCachedUser() === null);

  useEffect(() => {
    // Always revalidate once in the background (the server re-reads the role
    // from the DB), but without resetting what is already displayed.
    let alive = true;
    loadUser().then(u => {
      if (!alive) return;
      setUserInfo(u);
      setLoading(false);
    });
    return () => { alive = false; };
  }, []);

  const role = userInfo?.role || null;
  return {
    userInfo,
    isUser: role === 'user',
    isAdmin: role === 'admin' || role === 'super_admin',
    isSuperAdmin: role === 'super_admin',
    loading,
    role,
  };
}
