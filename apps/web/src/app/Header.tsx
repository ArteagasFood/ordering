import { Link, NavLink, useNavigate } from 'react-router-dom';
import { LogOut, Store } from 'lucide-react';
import { useAuth } from '@/lib/auth-store';
import { navRoutesFor } from './routes';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Human-readable role labels for the header badge. */
const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrator',
  accounts_payable: 'Accounts Payable',
  store_user: 'Store',
};

/**
 * Persistent top header (TDD §17.2). Anchors the app on every page: store identity, the
 * day's key actions (navigation), a slot for the cutoff countdown, and sign-out. Nav is
 * built from the route registry filtered by role, so users only ever see what's theirs.
 */
export function Header() {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const navigate = useNavigate();
  if (!user) return null;

  const navRoutes = navRoutesFor(user.role);

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <header className="sticky top-0 z-10 border-b bg-card/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4">
        <Link to="/" className="flex items-center gap-2 font-semibold text-primary">
          <Store className="h-5 w-5" />
          <span>Panadería Exchange</span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {navRoutes.map((r) => (
            <NavLink
              key={r.path}
              to={r.path}
              className={({ isActive }) =>
                cn(
                  'rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  isActive && 'bg-accent text-accent-foreground',
                )
              }
            >
              {r.label}
            </NavLink>
          ))}
        </nav>

        {/* Cutoff countdown slot (TDD §17.2) — populated by the orders slice in Phase 2. */}
        <div id="cutoff-countdown-slot" className="ml-auto" />

        <div className="flex items-center gap-3 text-right">
          <div className="leading-tight">
            <div className="text-sm font-medium">{user.name}</div>
            <div className="text-xs text-muted-foreground">
              {user.storeName ?? ROLE_LABELS[user.role] ?? user.role}
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={handleLogout} title="Sign out" aria-label="Sign out">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}
