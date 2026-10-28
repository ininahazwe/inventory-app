// Route guard: Memos is open to admins and to people declared in /memos/admin.
// Everyone else is sent back to the home hub. (The server enforces the same rule on the API.)
import { Navigate, Outlet } from 'react-router-dom';
import { useMemoAccess } from '../hooks/useMemoAccess';

export default function RequireMemoAccess() {
  const { allowed, loading } = useMemoAccess();
  if (loading) return null;
  if (!allowed) return <Navigate to="/" replace />;
  return <Outlet />;
}
