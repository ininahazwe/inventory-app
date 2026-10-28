// src/hooks/useMemoAccess.ts
// Memos est réservé aux admins et aux personnes déclarées dans /memos/admin (tous niveaux, agent
// compris). Le serveur applique la règle sur toute l'API ; ce hook sert à masquer l'entrée du module
// (accueil, menu) et à éviter d'afficher une page cassée. Résultat mis en cache par utilisateur.
import { useEffect, useState } from 'react';
import { api } from '../lib/apiClient';
import { usePermissions } from './usePermissions';

let cache: { email: string; access: boolean } | null = null;

export function useMemoAccess(): { allowed: boolean; loading: boolean } {
  const { isAdmin, userInfo, loading: permsLoading } = usePermissions();
  const email = userInfo?.email || '';
  const cached = cache && cache.email === email ? cache.access : null;
  const [access, setAccess] = useState<boolean | null>(cached);

  useEffect(() => {
    if (permsLoading || isAdmin || !email) return;
    if (cache && cache.email === email) { setAccess(cache.access); return; }
    let cancelled = false;
    api.get<{ access: boolean }>('/memos/access').then(({ data }) => {
      cache = { email, access: !!data?.access };
      if (!cancelled) setAccess(cache.access);
    });
    return () => { cancelled = true; };
  }, [permsLoading, isAdmin, email]);

  if (isAdmin) return { allowed: true, loading: false };
  if (permsLoading || access === null) return { allowed: false, loading: true };
  return { allowed: access, loading: false };
}
