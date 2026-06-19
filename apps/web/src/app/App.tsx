import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth-store';
import { RequireAuth } from './RequireAuth';
import { AppLayout } from './AppLayout';
import { featureRoutes } from './routes';
import { LoginPage } from '@/features/auth/LoginPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';

/** A calm full-screen loader shown while the session resolves on startup. */
function FullScreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center text-muted-foreground">
      Loading…
    </div>
  );
}

/**
 * Application root. Resolves the session once on startup (so a returning user with a
 * valid cookie lands straight in the app), then renders the router: a public login
 * route and the authenticated tree guarded by RequireAuth. Slice pages from the route
 * registry are mounted under the layout; unknown paths fall back to the dashboard.
 */
export function App() {
  const bootstrap = useAuth((s) => s.bootstrap);
  const status = useAuth((s) => s.status);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (status === 'loading') return <FullScreenLoader />;

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<AppLayout />}>
            <Route index element={<DashboardPage />} />
            {featureRoutes.map((r) => (
              <Route key={r.path} path={r.path} element={r.element} />
            ))}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
