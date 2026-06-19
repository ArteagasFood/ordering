import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, type Db } from '../../db/client';
import {
  orders,
  orderLines,
  stores,
  catalogItems,
  storeMenuItems,
  reconciliationFlags,
  varianceThresholds,
} from '../../db/schema';
import { getEffectivePrice } from '../../lib/menu-pricing';
import { notFound, badRequest } from '../../lib/errors';
import type { OrderDto, OrderLineDto } from '@panaderia/shared';

/**
 * A database connection that is either the pool (`db`) or a transaction handle. Drizzle
 * types a transaction handle as a structurally distinct `PgTransaction`, so we accept
 * the union everywhere a function must run inside *or* outside a transaction, and narrow
 * to `Db` only at the boundary of the shared lib helpers that declare a `Db` parameter.
 */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Conn = Db | Tx;

/** Narrow a Conn to the `Db` shape the shared lib helpers declare (both run the query). */
export const asDb = (conn: Conn): Db => conn as Db;

/**
 * Orders & lifecycle service (TDD §8, §10, §11, §13.3).
 *
 * The handful of money/decision rules that the whole slice depends on are extracted as
 * small PURE functions below so they can be tested without a database and so the very
 * same arithmetic is reused on placement, edit, receive, and AP correction. Everything
 * else here is the I/O shell: it reads the inputs those rules need, applies them, and
 * persists the result.
 */

// --------------------------------------------------------------------------------------
// Pure rules (unit-tested in orders.service.test.ts)
// --------------------------------------------------------------------------------------

/**
 * The billable quantity of a line (TDD §10.1). Before receiving, an order line is
 * valued at the quantity ordered; once the buyer has confirmed a received count, the
 * received count is canonical and becomes billable — including a short delivery, which
 * simply bills for what arrived ("bill what shipped").
 *
 * Precondition: orderedQty ≥ 0 and (receivedQty is null or ≥ 0).
 * Postcondition: returns a non-negative integer.
 */
export function billableQty(orderedQty: number, receivedQty: number | null): number {
  return receivedQty ?? orderedQty;
}

/**
 * A line's total in integer cents = billable quantity × the price snapshot copied onto
 * the line at creation (TDD §7.2). Revenue is always derived from the snapshot, never
 * from the live catalog price, so historical lines stay immutable as prices change.
 *
 * Precondition: snapshotCents ≥ 0; quantities are non-negative integers.
 * Postcondition: returns a non-negative integer number of cents.
 */
export function lineTotalCents(
  orderedQty: number,
  receivedQty: number | null,
  unitPriceSnapshotCents: number,
): number {
  return billableQty(orderedQty, receivedQty) * unitPriceSnapshotCents;
}

/** The applicable variance threshold for a line (absolute units and a 0..1 fraction). */
export interface VarianceThreshold {
  absolute: number;
  percentage: number;
}

/** The verdict of evaluating a received line against its threshold. */
export interface VarianceVerdict {
  /** receivedQty − orderedQty (negative = short). */
  variance: number;
  /** |variance| / orderedQty as a 0..1 fraction (0 when orderedQty is 0). */
  variancePct: number;
  /** True when |variance| crosses EITHER the absolute OR the percentage threshold. */
  flagged: boolean;
}

/**
 * Decide whether a received line should raise a reconciliation flag (TDD §10.2).
 *
 * A line is flagged when its variance is "large" by EITHER measure:
 *   |variance| ≥ threshold.absolute   OR   |variance| / orderedQty ≥ threshold.percentage
 *
 * The percentage test is skipped when orderedQty is 0 (no meaningful denominator); in
 * that degenerate case only the absolute test can flag the line. A flagged line still
 * bills on its received count — the flag is informational only ("bill it and flag it").
 *
 * Precondition: orderedQty, receivedQty ≥ 0; threshold values ≥ 0.
 * Postcondition: `variance` and `variancePct` are reported regardless of `flagged`.
 */
export function evaluateVariance(
  orderedQty: number,
  receivedQty: number,
  threshold: VarianceThreshold,
): VarianceVerdict {
  const variance = receivedQty - orderedQty;
  const magnitude = Math.abs(variance);
  const variancePct = orderedQty > 0 ? magnitude / orderedQty : 0;

  const crossesAbsolute = magnitude >= threshold.absolute;
  const crossesPercentage = orderedQty > 0 && variancePct >= threshold.percentage;

  return { variance, variancePct, flagged: crossesAbsolute || crossesPercentage };
}

// --------------------------------------------------------------------------------------
// DTO assembly
// --------------------------------------------------------------------------------------

interface LineRow {
  id: string;
  catalogItemId: string;
  catalogItemName: string;
  orderedQty: number;
  receivedQty: number | null;
  wasteQty: number | null;
  unitPriceSnapshotCents: number;
  lineTotalCents: number;
}

interface OrderHeaderRow {
  id: string;
  buyerStoreId: string;
  buyerStoreName: string;
  producerStoreId: string;
  producerStoreName: string;
  serviceDay: string;
  status: 'open' | 'frozen' | 'received';
  frozenAt: Date | null;
}

function toLineDto(row: LineRow): OrderLineDto {
  return {
    id: row.id,
    catalogItemId: row.catalogItemId,
    catalogItemName: row.catalogItemName,
    orderedQty: row.orderedQty,
    receivedQty: row.receivedQty,
    wasteQty: row.wasteQty,
    unitPriceSnapshotCents: row.unitPriceSnapshotCents,
    lineTotalCents: row.lineTotalCents,
  };
}

function toOrderDto(header: OrderHeaderRow, lineRows: LineRow[]): OrderDto {
  const lines = lineRows.map(toLineDto);
  return {
    id: header.id,
    buyerStoreId: header.buyerStoreId,
    buyerStoreName: header.buyerStoreName,
    producerStoreId: header.producerStoreId,
    producerStoreName: header.producerStoreName,
    serviceDay: header.serviceDay,
    status: header.status,
    frozenAt: header.frozenAt ? header.frozenAt.toISOString() : null,
    lines,
    totalCents: lines.reduce((sum, l) => sum + l.lineTotalCents, 0),
  };
}

/** Load order headers matching the WHERE clause, newest service day first. */
async function loadHeaders(where: ReturnType<typeof and> | undefined, conn: Conn) {
  const rows = await conn
    .select({
      id: orders.id,
      buyerStoreId: orders.buyerStoreId,
      producerStoreId: orders.producerStoreId,
      serviceDay: orders.serviceDay,
      status: orders.status,
      frozenAt: orders.frozenAt,
    })
    .from(orders)
    .where(where)
    .orderBy(sql`${orders.serviceDay} desc, ${orders.createdAt} desc`);
  return rows;
}

/** Resolve display names for a set of store ids in one query. */
async function storeNames(ids: string[], conn: Conn): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await conn
    .select({ id: stores.id, name: stores.name })
    .from(stores)
    .where(inArray(stores.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Load all lines for a set of order ids, grouped by order id. */
async function linesByOrder(orderIds: string[], conn: Conn): Promise<Map<string, LineRow[]>> {
  const grouped = new Map<string, LineRow[]>();
  if (orderIds.length === 0) return grouped;
  const rows = await conn
    .select({
      orderId: orderLines.orderId,
      id: orderLines.id,
      catalogItemId: orderLines.catalogItemId,
      catalogItemName: catalogItems.name,
      orderedQty: orderLines.orderedQty,
      receivedQty: orderLines.receivedQty,
      wasteQty: orderLines.wasteQty,
      unitPriceSnapshotCents: orderLines.unitPriceSnapshotCents,
      lineTotalCents: orderLines.lineTotalCents,
    })
    .from(orderLines)
    .innerJoin(catalogItems, eq(orderLines.catalogItemId, catalogItems.id))
    .where(inArray(orderLines.orderId, orderIds));
  for (const r of rows) {
    const { orderId, ...line } = r;
    const list = grouped.get(orderId) ?? [];
    list.push(line);
    grouped.set(orderId, list);
  }
  return grouped;
}

/** Assemble full OrderDtos from header rows (resolving names + lines in two queries). */
async function assembleOrders(
  headers: OrderHeaderRow[] | Awaited<ReturnType<typeof loadHeaders>>,
  conn: Conn,
): Promise<OrderDto[]> {
  if (headers.length === 0) return [];
  const orderIds = headers.map((h) => h.id);
  const storeIds = [
    ...new Set(headers.flatMap((h) => [h.buyerStoreId, h.producerStoreId])),
  ];
  const [names, lines] = await Promise.all([
    storeNames(storeIds, conn),
    linesByOrder(orderIds, conn),
  ]);
  return headers.map((h) =>
    toOrderDto(
      {
        id: h.id,
        buyerStoreId: h.buyerStoreId,
        buyerStoreName: names.get(h.buyerStoreId) ?? '',
        producerStoreId: h.producerStoreId,
        producerStoreName: names.get(h.producerStoreId) ?? '',
        serviceDay: h.serviceDay,
        status: h.status,
        frozenAt: h.frozenAt,
      },
      lines.get(h.id) ?? [],
    ),
  );
}

// --------------------------------------------------------------------------------------
// Queries
// --------------------------------------------------------------------------------------

export interface ListOrdersOptions {
  /** null = global (see all orders); else restrict to orders touching this store. */
  scopeStoreId: string | null;
  serviceDay?: string;
  status?: 'open' | 'frozen' | 'received';
  /** Narrow to orders where the (scoped) store is specifically the buyer or producer. */
  role?: 'buyer' | 'producer';
}

/**
 * List orders visible to the caller (TDD §8). A store user sees orders where their store
 * is the buyer OR the producer; a global role sees all. Optional service-day/status/role
 * filters AND with the scope.
 */
export async function listOrders(opts: ListOrdersOptions, conn: Conn = db): Promise<OrderDto[]> {
  const clauses = [];

  if (opts.scopeStoreId) {
    const store = opts.scopeStoreId;
    if (opts.role === 'buyer') {
      clauses.push(eq(orders.buyerStoreId, store));
    } else if (opts.role === 'producer') {
      clauses.push(eq(orders.producerStoreId, store));
    } else {
      clauses.push(
        sql`(${orders.buyerStoreId} = ${store} OR ${orders.producerStoreId} = ${store})`,
      );
    }
  } else if (opts.role) {
    // Global caller asking for a role filter without a store is meaningless; ignore it.
  }

  if (opts.serviceDay) clauses.push(eq(orders.serviceDay, opts.serviceDay));
  if (opts.status) clauses.push(eq(orders.status, opts.status));

  const where = clauses.length > 0 ? and(...clauses) : undefined;
  const headers = await loadHeaders(where, conn);
  return assembleOrders(headers, conn);
}

/** Load a single order header (without lines/names). Throws 404 if absent. */
export async function getOrderHeader(orderId: string, conn: Conn = db) {
  const [row] = await conn
    .select({
      id: orders.id,
      buyerStoreId: orders.buyerStoreId,
      producerStoreId: orders.producerStoreId,
      serviceDay: orders.serviceDay,
      status: orders.status,
      frozenAt: orders.frozenAt,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!row) throw notFound('Order not found.');
  return row;
}

/** Load one order as a full DTO (lines + names). Throws 404 if absent. */
export async function getOrderDto(orderId: string, conn: Conn = db): Promise<OrderDto> {
  const header = await getOrderHeader(orderId, conn);
  const [dto] = await assembleOrders([header], conn);
  // assembleOrders returns one DTO per header; with a single header it always yields one.
  if (!dto) throw notFound('Order not found.');
  return dto;
}

// --------------------------------------------------------------------------------------
// Line snapshotting (creation & edit share this)
// --------------------------------------------------------------------------------------

/** The denormalized facts a line copies at creation (TDD §13.3). */
interface SnapshotInputLine {
  catalogItemId: string;
  orderedQty: number;
}

/** A fully-resolved line ready to insert (price snapshotted, dimensions denormalized). */
interface ResolvedLine {
  catalogItemId: string;
  sellerStoreId: string;
  buyerStoreId: string;
  categoryId: string | null;
  productTypeId: string;
  serviceDay: string;
  orderedQty: number;
  unitPriceSnapshotCents: number;
  lineTotalCents: number;
}

/**
 * For each requested line, snapshot the producer's effective price (TDD §7.2) and copy
 * the seller/buyer/category/productType/serviceDay onto the line (TDD §13.3). The
 * category comes from the producer's store_menu_item; the product type from the catalog
 * item. Throws 400 if a requested item is not on the producer's menu.
 */
export async function resolveLines(
  args: {
    producerStoreId: string;
    buyerStoreId: string;
    serviceDay: string;
    lines: SnapshotInputLine[];
  },
  conn: Conn,
): Promise<ResolvedLine[]> {
  const resolved: ResolvedLine[] = [];
  for (const line of args.lines) {
    const [meta] = await conn
      .select({
        categoryId: storeMenuItems.categoryId,
        productTypeId: catalogItems.productTypeId,
      })
      .from(storeMenuItems)
      .innerJoin(catalogItems, eq(storeMenuItems.catalogItemId, catalogItems.id))
      .where(
        and(
          eq(storeMenuItems.storeId, args.producerStoreId),
          eq(storeMenuItems.catalogItemId, line.catalogItemId),
        ),
      )
      .limit(1);

    if (!meta) {
      throw badRequest(
        `Item ${line.catalogItemId} is not on the producer's menu and cannot be ordered.`,
      );
    }

    const effective = await getEffectivePrice(args.producerStoreId, line.catalogItemId, asDb(conn));
    if (!effective) {
      throw badRequest(`Item ${line.catalogItemId} has no resolvable price.`);
    }
    const snapshot = effective.value;

    resolved.push({
      catalogItemId: line.catalogItemId,
      sellerStoreId: args.producerStoreId,
      buyerStoreId: args.buyerStoreId,
      categoryId: meta.categoryId,
      productTypeId: meta.productTypeId,
      serviceDay: args.serviceDay,
      orderedQty: line.orderedQty,
      unitPriceSnapshotCents: snapshot,
      // Before receiving, a line is valued at its ordered quantity.
      lineTotalCents: lineTotalCents(line.orderedQty, null, snapshot),
    });
  }
  return resolved;
}

// --------------------------------------------------------------------------------------
// Reconciliation seam (TDD §10.2) — this slice CREATES flags on receive; the
// reconciliation slice owns listing/resolving them.
// --------------------------------------------------------------------------------------

/**
 * The effective variance threshold for a buyer store: a row keyed to the store overrides
 * the global (null storeId) row, which in turn falls back to a permissive system default
 * that never flags. Models TDD §10.2 step 1's "overridable per store".
 */
export async function resolveVarianceThreshold(
  buyerStoreId: string,
  conn: Conn,
): Promise<VarianceThreshold> {
  const rows = await conn
    .select({
      storeId: varianceThresholds.storeId,
      absolute: varianceThresholds.absolute,
      percentage: varianceThresholds.percentage,
    })
    .from(varianceThresholds);

  const perStore = rows.find((r) => r.storeId === buyerStoreId);
  if (perStore) return { absolute: perStore.absolute, percentage: perStore.percentage };

  const global = rows.find((r) => r.storeId === null);
  if (global) return { absolute: global.absolute, percentage: global.percentage };

  // No threshold configured: a value nothing can cross, so no spurious flags.
  return { absolute: Number.POSITIVE_INFINITY, percentage: Number.POSITIVE_INFINITY };
}
