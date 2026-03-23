// src/hooks/usePermissions.ts
import { useEffect, useState } from 'react';
import { auth, rpcMethods } from '../lib/apiClient';

export interface UserInfo {
  id: string;
  email: string;
  name: string;
  picture: string;
  role: string;
}

export function usePermissions() {
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkPermissions = async () => {
      try {
        const { data, error } = await auth.getUser();

        if (!error && data) {
          setUserInfo({
            id: data.id,
            email: data.email,
            name: data.name,
            picture: data.picture,
            role: data.role,
          });

          // Check if admin
          const { data: isAdminData } = await rpcMethods.is_admin(data.email);
          setIsAdmin(isAdminData?.result ?? false);

          // Check if super admin
          const { data: isSuperAdminData } = await rpcMethods.is_super_admin(data.email);
          setIsSuperAdmin(isSuperAdminData?.result ?? false);
        }
      } catch (err) {
        console.error('Permission check error:', err);
      } finally {
        setLoading(false);
      }
    };

    checkPermissions();
  }, []);

  return { userInfo, isAdmin, isSuperAdmin, loading };
}
