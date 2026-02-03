// src/hooks/usePermissions.ts
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

type Permissions = {
  role: 'user' | 'admin' | 'super_admin';
  isAdmin: boolean;      // admin ou super_admin
  isSuperAdmin: boolean;
  loading: boolean;
};

export function usePermissions(): Permissions {
  const [perms, setPerms] = useState<Permissions>({
    role: 'user',
    isAdmin: false,
    isSuperAdmin: false,
    loading: true,
  });

  useEffect(() => {
    const checkPermissions = async () => {
      try {
        const [
          { data: roleData },
          { data: isAdminData },
          { data: isSuperAdminData },
        ] = await Promise.all([
          supabase.rpc('get_my_role'),
          supabase.rpc('is_admin'),
          supabase.rpc('is_super_admin'),
        ]);

        setPerms({
          role: (roleData as any) ?? 'user',
          isAdmin: !!isAdminData,
          isSuperAdmin: !!isSuperAdminData,
          loading: false,
        });
      } catch (error) {
        console.error("Error checking permissions:", error);
        setPerms((prev) => ({ ...prev, loading: false }));
      }
    };

    checkPermissions();
  }, []);

  return perms;
}
