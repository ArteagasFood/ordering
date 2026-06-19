import { z } from 'zod';
import { zQuantity, zIsoDate } from './common';
import { ORDER_STATUSES } from './enums';
import type { Cents, Id, IsoDate } from './common';
import type { OrderStatus } from './enums';

/**
 * Order lifecycle contract (TDD §8, §10, §11). No draft state: an order is live and
 * editable from creation until the producer's cutoff, then frozen, then received and
 * counted. The buyer's confirmed received count is the billable quantity (TDD §10.1).
 *
 * Each line carries a price *snapshot* copied at creation (TDD §7.2) plus denormalized
 * seller/buyer/item/category/type for reporting (TDD §13.3). Two after-the-fact
 * figures live on a line: received (billable) and waste (informational, TDD §11).
 */
export interface OrderLineDto {
  id: Id;
  catalogItemId: Id;
  catalogItemName: string;
  orderedQty: number;
  /** Buyer's confirmed received count; null until receiving (TDD §10.1). */
  receivedQty: number | null;
  /** Optional post-order waste annotation (TDD §11). */
  wasteQty: number | null;
  /** Effective price copied onto the line at creation; never re-read from catalog. */
  unitPriceSnapshotCents: Cents;
  /** receivedQty (or orderedQty before receiving) × snapshot. */
  lineTotalCents: Cents;
}

export interface OrderDto {
  id: Id;
  buyerStoreId: Id;
  buyerStoreName: string;
  producerStoreId: Id;
  producerStoreName: string;
  serviceDay: IsoDate;
  status: OrderStatus;
  /** Set when the order froze at cutoff (TDD §8.1 step 3). */
  frozenAt: string | null;
  lines: OrderLineDto[];
  totalCents: Cents;
}

const zOrderLineInput = z.object({
  catalogItemId: z.string().uuid(),
  orderedQty: zQuantity,
});

/** Buyer: place an order against a producer for a service day (TDD §8.1 step 1). */
export const zPlaceOrderRequest = z.object({
  producerStoreId: z.string().uuid(),
  serviceDay: zIsoDate,
  lines: z.array(zOrderLineInput).min(1),
});
export type PlaceOrderRequest = z.infer<typeof zPlaceOrderRequest>;

/** Buyer: edit quantities freely until cutoff (TDD §8.1 step 2). Replaces the line set. */
export const zEditOrderRequest = z.object({
  lines: z.array(zOrderLineInput).min(1),
});
export type EditOrderRequest = z.infer<typeof zEditOrderRequest>;

/** Buyer: receive & confirm counts (TDD §8.1 step 6, §10.1). */
export const zReceiveOrderRequest = z.object({
  lines: z
    .array(z.object({ lineId: z.string().uuid(), receivedQty: zQuantity }))
    .min(1),
});
export type ReceiveOrderRequest = z.infer<typeof zReceiveOrderRequest>;

/** Record waste against lines after the fact (TDD §11). */
export const zRecordWasteRequest = z.object({
  lines: z.array(z.object({ lineId: z.string().uuid(), wasteQty: zQuantity })).min(1),
});
export type RecordWasteRequest = z.infer<typeof zRecordWasteRequest>;

/**
 * AP-only audited quantity correction (TDD §3.2, §10). A reason is mandatory and
 * the change is written to the audit log with before/after values.
 */
export const zApCorrectionRequest = z.object({
  lineId: z.string().uuid(),
  field: z.enum(['ordered_qty', 'received_qty']),
  newValue: zQuantity,
  reason: z.string().min(1).max(500),
});
export type ApCorrectionRequest = z.infer<typeof zApCorrectionRequest>;

/**
 * Query filters for listing orders (GET /orders). All optional and AND-composed:
 *
 *  - `serviceDay`  — restrict to one service day (YYYY-MM-DD).
 *  - `status`      — restrict to one lifecycle state.
 *  - `role`        — narrow a store user's view to only the orders where their store is
 *                    the buyer, or only those where it is the producer. Ignored for
 *                    global roles unless combined with a store-scoped query upstream.
 */
export const zListOrdersQuery = z.object({
  serviceDay: zIsoDate.optional(),
  status: z.enum(ORDER_STATUSES).optional(),
  role: z.enum(['buyer', 'producer']).optional(),
});
export type ListOrdersQuery = z.infer<typeof zListOrdersQuery>;

export { ORDER_STATUSES };
