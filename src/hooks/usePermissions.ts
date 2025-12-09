// src/hooks/usePermissions.ts
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

type Permissions = {
  isProtected: boolean;
  isSuperAdmin: boolean;
  isAdmin: boolean;
  canManageUsers: boolean;
  loading: boolean;
};

export function usePermissions(): Permissions {
  const [perms, setPerms] = useState<Permissions>({
    isProtected: false,
    isSuperAdmin: false,
    isAdmin: false,
    canManageUsers: false,
    loading: true,
  });

  useEffect(() => {
    const checkPermissions = async () => {
      try {
        // Vérifier si protégé
        const { data: protectedData } = await supabase.rpc('is_protected_admin');
        
        // Vérifier si super admin
        const { data: superAdminData } = await supabase.rpc('is_super_admin');
        
        // Vérifier si admin
        const { data: adminData } = await supabase.rpc('is_admin');

        const isProtected = !!protectedData;
        const isSuperAdmin = !!superAdminData;
        const isAdmin = !!adminData;
        const canManageUsers = isProtected || isSuperAdmin;

        setPerms({
          isProtected,
          isSuperAdmin,
          isAdmin,
          canManageUsers,
          loading: false,
        });
      } catch (error) {
        console.error("Error checking permissions:", error);
        setPerms({
          isProtected: false,
          isSuperAdmin: false,
          isAdmin: false,
          canManageUsers: false,
          loading: false,
        });
      }
    };

    checkPermissions();
  }, []);

  return perms;
}