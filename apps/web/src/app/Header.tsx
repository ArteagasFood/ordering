import { useEffect, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { LogOut, Store } from 'lucide-react';
import type { StoreDto } from '@panaderia/shared';
import { useAuth } from '@/lib/auth-store';
import { api } from '@/lib/api-client';
import { navRoutesFor } from './routes';
import { CutoffCountdown } from '@/features/orders';
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

  // A store user's own store cutoff is surfaced in the header (TDD §17 "Respect the
  // clock"). The countdown renders only when the store actually has a cutoff (producers).
  const [ownStore, setOwnStore] = useState<StoreDto | null>(null);
  useEffect(() => {
    if (user.role !== 'store_user' || !user.storeId) return;
    let cancelled = false;
    api
      .get<StoreDto[]>('/stores')
      .then((stores) => {
        if (!cancelled) setOwnStore(stores.find((s) => s.id === user.storeId) ?? stores[0] ?? null);
      })
      .catch(() => {
        /* non-fatal: the countdown is a convenience, not required */
      });
    return () => {
      cancelled = true;
    };
  }, [user.role, user.storeId]);

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

        {/* Cutoff countdown slot (TDD §17.2). */}
        <div className="ml-auto">
          {ownStore?.cutoffTime && (
            <CutoffCountdown cutoffTime={ownStore.cutoffTime} label={`Cutoff · ${ownStore.name}`} />
          )}
        </div>

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
