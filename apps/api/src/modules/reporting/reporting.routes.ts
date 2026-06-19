import { Router } from 'express';
import { zReportQuery, type ReportSummaryDto } from '@panaderia/shared';
import { asyncHandler, query, send } from '../../lib/http';
import { badRequest } from '../../lib/errors';
import { currentUser, isGlobal, storeScopeId } from '../../lib/authz';
import { buildSummary } from './reporting.service';

/**
 * Reporting routes (TDD §13), mounted at `/reports` by the integrator.
 *
 * Authorization is the security boundary, not a convenience: a Store User may only ever
 * see their OWN store, so the requested `storeId` is ignored and forced to their bound
 * store. A global role (Admin/AP) may target any single store or, by omitting `storeId`,
 * span every store. This mirrors the row-scope rule the rest of the system uses
 * (`storeScopeId`) — never trust the client's storeId for a scoped principal.
 */
export const reportsRouter: Router = Router();

reportsRouter.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const user = currentUser(req); // 401 if unauthenticated
    const q = query(zReportQuery, req); // 422 on invalid range/lens

    if (q.from > q.to) {
      throw badRequest("The 'from' date must not be after the 'to' date.");
    }

    // Resolve the effective store scope. A store user is pinned to their own store
    // regardless of what storeId they ask for; a global role may use the requested
    // storeId, or null to mean "all stores".
    const scope = storeScopeId(user); // null = global/unscoped, else the user's store id
    const storeId = scope ?? (isGlobal(user) ? q.storeId ?? null : null);

    const summary = await buildSummary({
      from: q.from,
      to: q.to,
      lens: q.lens ?? 'seller',
      storeId,
    });

    send<ReportSummaryDto>(res, summary);
  }),
);
