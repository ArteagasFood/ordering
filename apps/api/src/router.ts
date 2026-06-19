import { Router } from 'express';
import { authRouter } from './modules/auth/auth.routes';

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
  // Phase 1 slices are registered here during Phase 2 integration, e.g.:
  // { path: '/stores', router: storesRouter },
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
