import { Router } from 'express';
import { asyncHandler, body, query, send, created } from '../../lib/http';
import { notFound, forbidden } from '../../lib/errors';
import {
  currentUser,
  assertRole,
  isGlobal,
  storeScopeId,
} from '../../lib/authz';
import {
  zResolveFlagRequest,
  zSetVarianceThresholdRequest,
  zListFlagsQuery,
  type ReconciliationFlagDto,
  type VarianceThresholdDto,
} from '@panaderia/shared';
import {
  listFlags,
  setFlagResolved,
  getFlagParties,
  listThresholds,
  upsertThreshold,
} from './reconciliation.service';

/**
 * Reconciliation & exceptions routes (TDD §10.2), mounted at `/reconciliation`.
 *
 * SEAM: this slice never *creates* flags — the orders slice does that at receive time.
 * Here we own (a) the variance-threshold configuration the orders slice reads, and
 * (b) the read/resolve surface that makes flagged lines and their trend visible.
 */
export const reconciliationRouter: Router = Router();

/**
 * GET /flags — list exceptions visible to the caller.
 * Row scope: a store user sees flags on lines where they are the producer or buyer; a
 * global role sees all. `?resolved=true|false` narrows to closed/open exceptions.
 */
reconciliationRouter.get(
  '/flags',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const { resolved } = query(zListFlagsQuery, req);
    const scope = storeScopeId(user); // null = global (see all)
    // The query token is 'true' | 'false' | undefined; coerce to a tri-state boolean.
    const resolvedFilter = resolved === undefined ? undefined : resolved === 'true';
    const flags = await listFlags({ scope, resolved: resolvedFilter });
    send<ReconciliationFlagDto[]>(res, flags);
  }),
);

/**
 * PATCH /flags/:id — mark an exception resolved (offline follow-up complete).
 * Authorized for global roles, or the producer/buyer store user party to the flag.
 */
reconciliationRouter.patch(
  '/flags/:id',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = body(zResolveFlagRequest, req);

    const flagId = req.params.id ?? '';
    const flag = await getFlagParties(flagId);
    if (!flag) throw notFound('That exception no longer exists.');

    // Row scope: a store user must be a party (producer or buyer) to the flagged line.
    if (!isGlobal(user)) {
      const isParty = user.storeId === flag.producerStoreId || user.storeId === flag.buyerStoreId;
      if (!isParty) throw forbidden('You can only resolve exceptions for your own store.');
    }

    await setFlagResolved(flag.id, input.resolved ?? true);
    res.status(204).end();
  }),
);

/**
 * GET /thresholds — the global default (null store) plus any per-store overrides.
 * Visible to the global roles that govern reconciliation (admin and AP).
 */
reconciliationRouter.get(
  '/thresholds',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    assertRole(user, 'admin', 'accounts_payable');
    const thresholds = await listThresholds();
    send<VarianceThresholdDto[]>(res, thresholds);
  }),
);

/**
 * POST /thresholds — upsert the global default (storeId null) or a per-store override.
 * Admin-only: thresholds define what counts as a "large" variance org-wide (§10.2).
 */
reconciliationRouter.post(
  '/thresholds',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    assertRole(user, 'admin');
    const input = body(zSetVarianceThresholdRequest, req);
    const dto = await upsertThreshold(input);
    created(res, dto);
  }),
);
