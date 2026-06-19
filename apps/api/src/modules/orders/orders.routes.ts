import { Router, type Request } from 'express';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../../db/client';
import { orders, orderLines, reconciliationFlags } from '../../db/schema';
import { asyncHandler, body, query, send, created } from '../../lib/http';
import { notFound, forbidden, conflict, badRequest } from '../../lib/errors';
import { currentUser, assertRole, assertStoreScope, storeScopeId } from '../../lib/authz';
import { writeAudit } from '../../lib/audit';
import {
  zPlaceOrderRequest,
  zEditOrderRequest,
  zReceiveOrderRequest,
  zRecordWasteRequest,
  zApCorrectionRequest,
  zListOrdersQuery,
  type OrderDto,
} from '@panaderia/shared';
import {
  listOrders,
  getOrderHeader,
  getOrderDto,
  resolveLines,
  resolveVarianceThreshold,
  evaluateVariance,
  lineTotalCents,
  asDb,
} from './orders.service';

/**
 * Orders & lifecycle router (TDD §8, §10, §11). Mounted at `/orders` by the integrator.
 *
 * Authorization invariants enforced here (the security boundary, TDD §2.3):
 *   - Listing/reading is row-scoped: a store user sees only orders touching their store.
 *   - Placing/editing/receiving/waste are buyer actions, scoped to the buyer store.
 *   - Freezing is a producer (or admin) action, modeling the cutoff lock.
 *   - Quantity corrections are AP-only and always audited (segregation of duties, §3.2).
 */
export const ordersRouter: Router = Router();

/** Read a required path parameter (narrowing away `string | undefined`). */
function param(req: Request, name: string): string {
  const value = req.params[name];
  if (!value) throw badRequest(`Missing path parameter: ${name}.`);
  return value;
}

/** Whether the caller may view this order: buyer store, producer store, or a global role. */
function assertCanView(
  user: ReturnType<typeof currentUser>,
  order: { buyerStoreId: string; producerStoreId: string },
): void {
  if (storeScopeId(user) === null) return; // global
  if (user.storeId === order.buyerStoreId || user.storeId === order.producerStoreId) return;
  throw forbidden('You can only view orders involving your own store.');
}

// GET / — list orders visible to the caller, with optional filters.
ordersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const filters = query(zListOrdersQuery, req);
    const list = await listOrders({
      scopeStoreId: storeScopeId(user),
      serviceDay: filters.serviceDay,
      status: filters.status,
      role: filters.role,
    });
    send<OrderDto[]>(res, list);
  }),
);

// POST / — a buyer places an order against a producer for a service day (TDD §8.1).
ordersRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    assertRole(user, 'store_user', 'admin');
    const input = body(zPlaceOrderRequest, req);

    // The buyer store is the caller's own store; an admin acts on behalf and must say so
    // — but PlaceOrderRequest carries no buyer field, so an admin without a store cannot
    // place an order. A store user buys for their own store.
    const buyerStoreId = storeScopeId(user);
    if (buyerStoreId === null) {
      throw badRequest('An order must be placed by a buying store user.');
    }
    if (buyerStoreId === input.producerStoreId) {
      throw badRequest('A store cannot place an order with itself.');
    }

    const dto = await db.transaction(async (tx) => {
      const resolved = await resolveLines(
        {
          producerStoreId: input.producerStoreId,
          buyerStoreId,
          serviceDay: input.serviceDay,
          lines: input.lines,
        },
        tx,
      );

      const [orderRow] = await tx
        .insert(orders)
        .values({
          buyerStoreId,
          producerStoreId: input.producerStoreId,
          serviceDay: input.serviceDay,
          status: 'open',
          createdBy: user.id,
        })
        .returning({ id: orders.id });
      if (!orderRow) throw badRequest('Failed to create the order.');

      await tx.insert(orderLines).values(
        resolved.map((l) => ({
          orderId: orderRow.id,
          sellerStoreId: l.sellerStoreId,
          buyerStoreId: l.buyerStoreId,
          catalogItemId: l.catalogItemId,
          categoryId: l.categoryId,
          productTypeId: l.productTypeId,
          serviceDay: l.serviceDay,
          orderedQty: l.orderedQty,
          unitPriceSnapshotCents: l.unitPriceSnapshotCents,
          lineTotalCents: l.lineTotalCents,
        })),
      );

      return getOrderDto(orderRow.id, tx);
    });

    created(res, dto);
  }),
);

// GET /:id — one order with lines (buyer, producer, or global may view).
ordersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const orderId = param(req, 'id');
    const header = await getOrderHeader(orderId);
    assertCanView(user, header);
    send<OrderDto>(res, await getOrderDto(orderId));
  }),
);

// PATCH /:id — buyer replaces the line set, re-snapshotting prices. Rejected once frozen.
ordersRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = body(zEditOrderRequest, req);
    const header = await getOrderHeader(param(req, 'id'));
    assertStoreScope(user, header.buyerStoreId);

    if (header.status !== 'open') {
      throw conflict('This order is frozen and can no longer be edited.');
    }

    const dto = await db.transaction(async (tx) => {
      const resolved = await resolveLines(
        {
          producerStoreId: header.producerStoreId,
          buyerStoreId: header.buyerStoreId,
          serviceDay: header.serviceDay,
          lines: input.lines,
        },
        tx,
      );

      // Replace the line set: remove the old lines, insert the freshly snapshotted ones.
      await tx.delete(orderLines).where(eq(orderLines.orderId, header.id));
      await tx.insert(orderLines).values(
        resolved.map((l) => ({
          orderId: header.id,
          sellerStoreId: l.sellerStoreId,
          buyerStoreId: l.buyerStoreId,
          catalogItemId: l.catalogItemId,
          categoryId: l.categoryId,
          productTypeId: l.productTypeId,
          serviceDay: l.serviceDay,
          orderedQty: l.orderedQty,
          unitPriceSnapshotCents: l.unitPriceSnapshotCents,
          lineTotalCents: l.lineTotalCents,
        })),
      );

      return getOrderDto(header.id, tx);
    });

    send<OrderDto>(res, dto);
  }),
);

// POST /:id/freeze — producer (or admin) locks the order at cutoff (TDD §8.1 step 3).
ordersRouter.post(
  '/:id/freeze',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const header = await getOrderHeader(param(req, 'id'));
    // Only the producing store (or a global admin) may freeze.
    assertRole(user, 'store_user', 'admin');
    if (user.role === 'store_user') assertStoreScope(user, header.producerStoreId);

    if (header.status === 'received') {
      throw conflict('A received order cannot be frozen.');
    }

    await db
      .update(orders)
      .set({ status: 'frozen', frozenAt: new Date(), updatedAt: new Date() })
      .where(eq(orders.id, header.id));

    send<OrderDto>(res, await getOrderDto(header.id));
  }),
);

// POST /:id/receive — buyer counts the delivery; received count becomes billable, and
// large variances are auto-flagged for reconciliation (TDD §8.1 step 6, §10).
ordersRouter.post(
  '/:id/receive',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = body(zReceiveOrderRequest, req);
    const header = await getOrderHeader(param(req, 'id'));
    assertStoreScope(user, header.buyerStoreId);

    const dto = await db.transaction(async (tx) => {
      // Load the lines being received, keyed by id, to recompute totals and variances.
      const lineIds = input.lines.map((l) => l.lineId);
      const existing = await tx
        .select({
          id: orderLines.id,
          orderId: orderLines.orderId,
          orderedQty: orderLines.orderedQty,
          unitPriceSnapshotCents: orderLines.unitPriceSnapshotCents,
        })
        .from(orderLines)
        .where(and(eq(orderLines.orderId, header.id), inArray(orderLines.id, lineIds)));

      const byId = new Map(existing.map((l) => [l.id, l]));
      if (byId.size !== lineIds.length) {
        throw badRequest('One or more lines do not belong to this order.');
      }

      const threshold = await resolveVarianceThreshold(header.buyerStoreId, tx);

      for (const r of input.lines) {
        const line = byId.get(r.lineId)!;
        const newTotal = lineTotalCents(line.orderedQty, r.receivedQty, line.unitPriceSnapshotCents);
        await tx
          .update(orderLines)
          .set({ receivedQty: r.receivedQty, lineTotalCents: newTotal, updatedAt: new Date() })
          .where(eq(orderLines.id, r.lineId));

        // Reconciliation seam (TDD §10.2): flag a large variance. The reconciliation
        // slice owns listing/resolving; we only CREATE the flag on receive.
        const verdict = evaluateVariance(line.orderedQty, r.receivedQty, threshold);
        if (verdict.flagged) {
          await tx
            .insert(reconciliationFlags)
            .values({
              orderLineId: line.id,
              variance: verdict.variance,
              variancePct: verdict.variancePct,
              thresholdAbsolute: Number.isFinite(threshold.absolute) ? threshold.absolute : 0,
              thresholdPercentage: Number.isFinite(threshold.percentage)
                ? threshold.percentage
                : 0,
            })
            // A line is flagged at most once (the flag row is unique per line); re-receiving
            // should not raise a duplicate.
            .onConflictDoNothing({ target: reconciliationFlags.orderLineId });
        }
      }

      await tx
        .update(orders)
        .set({ status: 'received', updatedAt: new Date() })
        .where(eq(orders.id, header.id));

      return getOrderDto(header.id, tx);
    });

    send<OrderDto>(res, dto);
  }),
);

// POST /:id/waste — buyer or producer records informational waste (TDD §11). Does NOT
// change billing.
ordersRouter.post(
  '/:id/waste',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = body(zRecordWasteRequest, req);
    const header = await getOrderHeader(param(req, 'id'));
    // Either party to the order may annotate waste; a global role may too.
    assertCanView(user, header);

    const lineIds = input.lines.map((l) => l.lineId);
    const existing = await db
      .select({ id: orderLines.id })
      .from(orderLines)
      .where(and(eq(orderLines.orderId, header.id), inArray(orderLines.id, lineIds)));
    if (existing.length !== lineIds.length) {
      throw badRequest('One or more lines do not belong to this order.');
    }

    await db.transaction(async (tx) => {
      for (const r of input.lines) {
        await tx
          .update(orderLines)
          .set({ wasteQty: r.wasteQty, updatedAt: new Date() })
          .where(eq(orderLines.id, r.lineId));
      }
    });

    send<OrderDto>(res, await getOrderDto(header.id));
  }),
);

// POST /lines/correct — AP-only audited quantity correction (TDD §3.2, §10).
ordersRouter.post(
  '/lines/correct',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    assertRole(user, 'accounts_payable');
    const input = body(zApCorrectionRequest, req);

    const dto = await db.transaction(async (tx) => {
      const [line] = await tx
        .select({
          id: orderLines.id,
          orderId: orderLines.orderId,
          orderedQty: orderLines.orderedQty,
          receivedQty: orderLines.receivedQty,
          unitPriceSnapshotCents: orderLines.unitPriceSnapshotCents,
          lineTotalCents: orderLines.lineTotalCents,
        })
        .from(orderLines)
        .where(eq(orderLines.id, input.lineId))
        .limit(1);
      if (!line) throw notFound('Order line not found.');

      const before = {
        orderedQty: line.orderedQty,
        receivedQty: line.receivedQty,
        lineTotalCents: line.lineTotalCents,
      };

      const newOrdered = input.field === 'ordered_qty' ? input.newValue : line.orderedQty;
      const newReceived = input.field === 'received_qty' ? input.newValue : line.receivedQty;
      const newTotal = lineTotalCents(newOrdered, newReceived, line.unitPriceSnapshotCents);

      await tx
        .update(orderLines)
        .set({ orderedQty: newOrdered, receivedQty: newReceived, lineTotalCents: newTotal, updatedAt: new Date() })
        .where(eq(orderLines.id, line.id));

      const after = { orderedQty: newOrdered, receivedQty: newReceived, lineTotalCents: newTotal };
      await writeAudit(
        {
          actorId: user.id,
          action: 'ap_quantity_correction',
          target: `order_line:${line.id}`,
          before,
          after,
          reason: input.reason,
        },
        asDb(tx),
      );

      return getOrderDto(line.orderId, tx);
    });

    send<OrderDto>(res, dto);
  }),
);
