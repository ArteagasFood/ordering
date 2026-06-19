import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/lib/auth-store';

/**
 * Route guard. Renders the protected tree only when authenticated; otherwise redirects
 * to the login screen. This is a UX gate, not the security boundary — the API enforces
 * authorization independently (TDD §2.3).
 */
export function RequireAuth() {
  const status = useAuth((s) => s.status);
  if (status === 'anon') return <Navigate to="/login" replace />;
  return <Outlet />;
}
