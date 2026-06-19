import { and, asc, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { db, type Db } from '../../db/client';
import {
  reconciliationFlags,
  varianceThresholds,
  orderLines,
  orders,
  stores,
  catalogItems,
} from '../../db/schema';
import type { ReconciliationFlagDto, VarianceThresholdDto } from '@panaderia/shared';

/**
 * Reconciliation service (TDD §10.2). The orders slice owns flag *creation* at receive
 * time; this slice owns the threshold configuration and the read/resolve surface. The
 * variance math below is the tested reference implementation of the seam logic — the
 * orders slice carries its own copy for flag creation, and pinning the definition here
 * keeps both sides honest.
 */

/**
 * Signed variance of a received-vs-ordered line.
 *
 * Postcondition: `receivedVariance(o, r) = r − o`. A negative result means the buyer
 * received fewer units than were ordered (a "short"); positive means an over-ship.
 */
export function receivedVariance(orderedQty: number, receivedQty: number): number {
  return receivedQty - orderedQty;
}

/**
 * Variance as a fraction of the ordered quantity, in [0, ∞).
 *
 * Definition: `|received − ordered| / ordered`. The magnitude is what the percentage
 * threshold compares against, so the sign is dropped here (the sign lives in
 * `receivedVariance`). By convention an ordered quantity of 0 yields a percentage of 0:
 * there is no meaningful denominator, and a line that ordered nothing cannot be "short"
 * by a percentage. Callers that care about an absolute over-ship from a zero order still
 * see it through the absolute threshold.
 *
 * Precondition: orderedQty ≥ 0 (enforced upstream by `zQuantity`).
 */
export function variancePercentage(orderedQty: number, receivedQty: number): number {
  if (orderedQty === 0) return 0;
  return Math.abs(receivedVariance(orderedQty, receivedQty)) / orderedQty;
}

/**
 * Does this line's variance cross *either* configured threshold (TDD §10.2 step 2)?
 *
 * A line is flagged when its absolute unit variance is at least `absolute`, OR its
 * percentage variance is at least `percentage`. "Crossing" is inclusive of the
 * boundary: a variance exactly equal to a threshold flags, matching the operator's
 * intuition that "10 units off" trips a 10-unit threshold. Both thresholds look at the
 * magnitude of the variance, so a short of 12 and an over of 12 are treated alike.
 *
 * @param absolute   non-negative unit threshold (e.g. 10)
 * @param percentage threshold as a fraction in [0, 1] (e.g. 0.15 for 15%)
 * @returns true iff the line should be flagged as an exception
 */
export function crossesThreshold(
  orderedQty: number,
  receivedQty: number,
  absolute: number,
  percentage: number,
): boolean {
  const absVariance = Math.abs(receivedVariance(orderedQty, receivedQty));
  const pctVariance = variancePercentage(orderedQty, receivedQty);
  return absVariance >= absolute || pctVariance >= percentage;
}

// --- Threshold configuration -------------------------------------------------

/**
 * List the configured thresholds: the single global row (storeId === null) first, then
 * any per-store overrides ordered for stable display. Returns whatever is persisted;
 * the absence of a global row simply yields no null-store entry (the orders slice falls
 * back to its own seeded default at the seam).
 */
export async function listThresholds(dbx: Db = db): Promise<VarianceThresholdDto[]> {
  const rows = await dbx
    .select({
      storeId: varianceThresholds.storeId,
      absolute: varianceThresholds.absolute,
      percentage: varianceThresholds.percentage,
    })
    .from(varianceThresholds)
    // Global (null storeId) sorts first; per-store overrides follow.
    .orderBy(asc(sql`${varianceThresholds.storeId} IS NOT NULL`), asc(varianceThresholds.storeId));

  return rows.map((r) => ({
    storeId: r.storeId ?? null,
    absolute: r.absolute,
    percentage: r.percentage,
  }));
}

/**
 * Upsert one threshold row: the global default when `storeId` is null, or a per-store
 * override otherwise. Idempotent on the store key (a second call for the same store
 * updates rather than duplicates), which is why both the null-store and per-store rows
 * are unique in the schema.
 *
 * Postcondition: exactly one row exists for the given store key, holding the new values.
 */
export async function upsertThreshold(
  input: { storeId?: string | null; absolute: number; percentage: number },
  dbx: Db = db,
): Promise<VarianceThresholdDto> {
  const storeId = input.storeId ?? null;
  const target =
    storeId === null ? isNull(varianceThresholds.storeId) : eq(varianceThresholds.storeId, storeId);

  const [existing] = await dbx
    .select({ id: varianceThresholds.id })
    .from(varianceThresholds)
    .where(target)
    .limit(1);

  if (existing) {
    await dbx
      .update(varianceThresholds)
      .set({ absolute: input.absolute, percentage: input.percentage })
      .where(eq(varianceThresholds.id, existing.id));
  } else {
    await dbx.insert(varianceThresholds).values({
      storeId,
      absolute: input.absolute,
      percentage: input.percentage,
    });
  }

  return { storeId, absolute: input.absolute, percentage: input.percentage };
}

// --- Flag read / resolve -----------------------------------------------------

/** A flag joined with the order/store/item context needed for the exceptions panel. */
function selectFlags(dbx: Db) {
  return dbx
    .select({
      id: reconciliationFlags.id,
      orderLineId: reconciliationFlags.orderLineId,
      orderId: orderLines.orderId,
      producerStoreId: orderLines.sellerStoreId,
      buyerStoreId: orderLines.buyerStoreId,
      catalogItemName: catalogItems.name,
      serviceDay: orderLines.serviceDay,
      orderedQty: orderLines.orderedQty,
      receivedQty: orderLines.receivedQty,
      variance: reconciliationFlags.variance,
      variancePct: reconciliationFlags.variancePct,
      resolved: reconciliationFlags.resolved,
      createdAt: reconciliationFlags.createdAt,
      producerStoreName: stores.name,
    })
    .from(reconciliationFlags)
    .innerJoin(orderLines, eq(reconciliationFlags.orderLineId, orderLines.id))
    .innerJoin(catalogItems, eq(orderLines.catalogItemId, catalogItems.id))
    .innerJoin(stores, eq(orderLines.sellerStoreId, stores.id));
}

/**
 * List reconciliation flags visible to a principal, newest first.
 *
 * Row scope (TDD §3.2): a global role (`scope === null`) sees every flag; a store user
 * sees only flags on lines where their store is the producer or the buyer — they are a
 * party to the exception. The optional `resolved` filter narrows to open or closed
 * exceptions for the panel's toggle.
 *
 * Because the buyer-store name is not part of the line→producer join, it is resolved in
 * a second pass keyed by buyerStoreId; this keeps the primary query to a single join
 * chain and avoids a self-join on `stores`.
 */
export async function listFlags(
  opts: { scope: string | null; resolved?: boolean },
  dbx: Db = db,
): Promise<ReconciliationFlagDto[]> {
  const conditions = [];
  if (opts.scope !== null) {
    conditions.push(
      or(eq(orderLines.sellerStoreId, opts.scope), eq(orderLines.buyerStoreId, opts.scope)),
    );
  }
  if (opts.resolved !== undefined) {
    conditions.push(eq(reconciliationFlags.resolved, opts.resolved));
  }

  const base = selectFlags(dbx);
  const rows = await (conditions.length ? base.where(and(...conditions)) : base).orderBy(
    desc(reconciliationFlags.createdAt),
  );

  // Resolve buyer store names in one batched lookup keyed by id.
  const buyerIds = Array.from(new Set(rows.map((r) => r.buyerStoreId)));
  const buyerNames = new Map<string, string>();
  if (buyerIds.length) {
    const named = await dbx
      .select({ id: stores.id, name: stores.name })
      .from(stores)
      .where(sql`${stores.id} = ANY(${sql.raw(`ARRAY[${buyerIds.map((id) => `'${id}'::uuid`).join(',')}]`)})`);
    for (const s of named) buyerNames.set(s.id, s.name);
  }

  return rows.map((r) => ({
    id: r.id,
    orderLineId: r.orderLineId,
    orderId: r.orderId,
    producerStoreId: r.producerStoreId,
    producerStoreName: r.producerStoreName,
    buyerStoreId: r.buyerStoreId,
    buyerStoreName: buyerNames.get(r.buyerStoreId) ?? '',
    catalogItemName: r.catalogItemName,
    serviceDay: r.serviceDay,
    orderedQty: r.orderedQty,
    receivedQty: r.receivedQty ?? 0,
    variance: r.variance,
    variancePct: r.variancePct,
    resolved: r.resolved,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** A flag plus the two store ids that make a store user a party to it (for authz). */
export interface FlagParties {
  id: string;
  producerStoreId: string;
  buyerStoreId: string;
  resolved: boolean;
}

/** Fetch the parties of a single flag, or null when it does not exist. */
export async function getFlagParties(id: string, dbx: Db = db): Promise<FlagParties | null> {
  const [row] = await dbx
    .select({
      id: reconciliationFlags.id,
      producerStoreId: orderLines.sellerStoreId,
      buyerStoreId: orderLines.buyerStoreId,
      resolved: reconciliationFlags.resolved,
    })
    .from(reconciliationFlags)
    .innerJoin(orderLines, eq(reconciliationFlags.orderLineId, orderLines.id))
    .where(eq(reconciliationFlags.id, id))
    .limit(1);
  return row ?? null;
}

/** Set the resolved flag on a single exception. Idempotent. */
export async function setFlagResolved(id: string, resolved: boolean, dbx: Db = db): Promise<void> {
  await dbx.update(reconciliationFlags).set({ resolved }).where(eq(reconciliationFlags.id, id));
}
