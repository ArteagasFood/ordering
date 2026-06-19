import type { ReactNode } from 'react';
import type { Role } from '@panaderia/shared';

// Slice feature pages (registered here by the integrator in Phase 2).
import { CatalogPage, TaxonomyAdminPage, ProductTypesAdminPage } from '@/features/catalog';
import { StoresAdminPage, UsersAdminPage, FeatureFlagsPage } from '@/features/admin';
import { MenuPage, PricingAdminPage } from '@/features/menu';
import {
  OrdersPage,
  PlaceOrderPage,
  OrderDetailPage,
  ReceivingPage,
} from '@/features/orders';
import { BakeListPage, DistributionPage } from '@/features/bakelist';
import { ReconciliationPage, ThresholdsAdminPage } from '@/features/reconciliation';
import { SettlementPage } from '@/features/invoicing';
import { ReportsPage } from '@/features/reporting';
import { NotificationsPage, OutboxPage } from '@/features/notifications';

/**
 * The frontend route registry — the ONE place slice pages are wired in (mirror of the
 * backend router registry). The header builds its navigation from the entries flagged
 * `nav`, filtered by the current user's role, so a control that would fail is simply
 * never shown (TDD §17 — "never present a control that will fail").
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

const ALL_STORE = ['store_user', 'admin', 'accounts_payable'] as const;
const GLOBAL: Role[] = ['admin', 'accounts_payable'];

export const featureRoutes: FeatureRoute[] = [
  // --- Daily / shared ---
  { path: 'orders', label: 'Orders', element: <OrdersPage />, nav: true },
  { path: 'orders/new', label: 'New order', element: <PlaceOrderPage /> },
  { path: 'orders/:id', label: 'Order', element: <OrderDetailPage /> },
  { path: 'orders/:id/receive', label: 'Receive', element: <ReceivingPage /> },
  { path: 'bake-list', label: 'Bake list', element: <BakeListPage />, roles: [...ALL_STORE], nav: true },
  { path: 'bake-list/distribution', label: 'Distribution', element: <DistributionPage />, roles: [...ALL_STORE] },
  { path: 'reconciliation', label: 'Exceptions', element: <ReconciliationPage />, nav: true },
  { path: 'reports', label: 'Reports', element: <ReportsPage />, nav: true },
  { path: 'catalog', label: 'Catalog', element: <CatalogPage />, nav: true },
  { path: 'menu', label: 'Menu', element: <MenuPage />, roles: ['store_user'], nav: true },
  { path: 'settlement', label: 'Settlement', element: <SettlementPage />, roles: GLOBAL, nav: true },
  { path: 'notifications', label: 'Notifications', element: <NotificationsPage />, nav: true },
  { path: 'notifications/outbox', label: 'Email outbox', element: <OutboxPage /> },

  // --- Admin configuration ---
  { path: 'admin/stores', label: 'Stores', element: <StoresAdminPage />, roles: ['admin'], nav: true },
  { path: 'admin/users', label: 'Users', element: <UsersAdminPage />, roles: ['admin'], nav: true },
  { path: 'admin/pricing', label: 'Pricing', element: <PricingAdminPage />, roles: ['admin'], nav: true },
  { path: 'admin/taxonomy', label: 'Taxonomy', element: <TaxonomyAdminPage />, roles: ['admin'] },
  { path: 'admin/product-types', label: 'Product types', element: <ProductTypesAdminPage />, roles: ['admin'] },
  { path: 'admin/flags', label: 'Feature flags', element: <FeatureFlagsPage />, roles: ['admin'] },
  { path: 'admin/thresholds', label: 'Variance thresholds', element: <ThresholdsAdminPage />, roles: ['admin'] },
];

/** Routes visible in the nav for a given role. */
export function navRoutesFor(role: Role): FeatureRoute[] {
  return featureRoutes.filter((r) => r.nav && (!r.roles || r.roles.includes(role)));
}
