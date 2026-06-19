import type { ReactNode } from 'react';
import type { Role } from '@panaderia/shared';

/**
 * The frontend route registry — the ONE place slice pages are wired in (mirror of the
 * backend router registry). Phase-1 slices export their pages but never edit this file;
 * the integrator registers them here in Phase 2. The header builds its navigation from
 * the entries flagged `nav`, filtered by the current user's role, so a control that
 * would fail is simply never shown (TDD §17 — "never present a control that will fail").
 */
export interface FeatureRoute {
  path: string;
  label: string;
  element: ReactNode;
  /** Roles allowed to see/use this route; omitted = any authenticated user. */
  roles?: Role[];
  /** Whether to surface this route in the top navigation. */
  nav?: boolean;
}

export const featureRoutes: FeatureRoute[] = [
  // Registered during Phase 2 integration, e.g.:
  // { path: 'orders', label: 'Orders', element: <OrdersPage />, nav: true },
];

/** Routes visible in the nav for a given role. */
export function navRoutesFor(role: Role): FeatureRoute[] {
  return featureRoutes.filter((r) => r.nav && (!r.roles || r.roles.includes(role)));
}
