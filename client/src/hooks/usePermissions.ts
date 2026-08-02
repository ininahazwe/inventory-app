// src/hooks/usePermissions.ts
import { useEffect, useState } from 'react';
import { auth } from '../lib/apiClient';

export interface UserInfo {
  id: string;
  email: string;
  name: string;
  picture: string;
  role: 'user' | 'admin' | 'super_admin';
}

export function usePermissions() {
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [isUser, setIsUser] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkPermissions = async () => {
      try {
        const { data, error } = await auth.getUser();

        if (!error && data) {
          const userRole = data.role as 'user' | 'admin' | 'super_admin';

          setUserInfo({
            id: data.id,
            email: data.email,
            name: data.name,
            picture: data.picture,
            role: userRole,
          });

          // Set permissions based on role
          setIsSuperAdmin(userRole === 'super_admin');
          setIsAdmin(userRole === 'admin' || userRole === 'super_admin');
          setIsUser(userRole === 'user');
        }
      } catch (err) {
        console.error('Permission check error:', err);
      } finally {
        setLoading(false);
      }
    };

    checkPermissions();
  }, []);

  return {
    userInfo,
    isUser,
    isAdmin,
    isSuperAdmin,
    loading,
    role: userInfo?.role || null
  };
}
