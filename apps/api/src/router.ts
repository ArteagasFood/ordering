import { Router } from 'express';
import { authRouter } from './modules/auth/auth.routes';
import { storesRouter } from './modules/admin/stores.routes';
import { usersRouter } from './modules/admin/users.routes';
import { flagsRouter } from './modules/admin/flags.routes';
import { productTypesRouter, catalogRouter, taxonomyRouter } from './modules/catalog/catalog.routes';
import { menuRouter, pricesRouter } from './modules/menu/menu.routes';
import { ordersRouter } from './modules/orders/orders.routes';
import { bakeListRouter } from './modules/bakelist/bakelist.routes';
import { reconciliationRouter } from './modules/reconciliation/reconciliation.routes';
import { settlementRouter } from './modules/invoicing/invoicing.routes';
import { reportsRouter } from './modules/reporting/reporting.routes';
import { notificationsRouter } from './modules/notifications/notifications.routes';

/**
 * The central API router registry — the ONE place slice routers are wired in.
 *
 * Per the contract-first methodology (DECISIONS.md §7), Phase-1 slices each export a
 * router but never edit this file; the integrator registers them here in Phase 2 by
 * adding an entry to `modules`. This keeps parallel slice work conflict-free: nobody
 * but the integrator touches the registry.
 */
export interface RouteModule {
  path: string;
  router: Router;
}

const modules: RouteModule[] = [
  { path: '/auth', router: authRouter },
  // Admin slice
  { path: '/stores', router: storesRouter },
  { path: '/users', router: usersRouter },
  { path: '/flags', router: flagsRouter },
  // Catalog & taxonomy slice
  { path: '/product-types', router: productTypesRouter },
  { path: '/catalog', router: catalogRouter },
  { path: '/taxonomy', router: taxonomyRouter },
  // Menu & pricing slice
  { path: '/menu', router: menuRouter },
  { path: '/prices', router: pricesRouter },
  // Orders lifecycle slice
  { path: '/orders', router: ordersRouter },
  // Bake list & distribution slice
  { path: '/bake-list', router: bakeListRouter },
  // Reconciliation slice
  { path: '/reconciliation', router: reconciliationRouter },
  // Invoicing & settlement slice
  { path: '/settlement', router: settlementRouter },
  // Reporting slice
  { path: '/reports', router: reportsRouter },
  // Notifications slice
  { path: '/notifications', router: notificationsRouter },
];

export function buildApiRouter(): Router {
  const api = Router();

  /** Liveness probe — unauthenticated, used by the boot check and future monitors. */
  api.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  for (const m of modules) {
    api.use(m.path, m.router);
  }
  return api;
}
