// Route guard: only admins / super admins may open the wrapped pages.
// Everyone else is sent back to the home hub. (The server enforces the same
// rule on the API; this just avoids showing a broken page.)
import { Navigate, Outlet } from 'react-router-dom';
import { usePermissions } from '../hooks/usePermissions';

export default function RequireAdmin() {
  const { isAdmin, loading } = usePermissions();
  if (loading) return null;
  if (!isAdmin) return <Navigate to="/" replace />;
  return <Outlet />;
}
