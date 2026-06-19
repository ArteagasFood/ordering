import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { orders, orderLines, storeMenuItems, catalogItems, stores } from '../../db/schema';
import { notFound, forbidden } from '../../lib/errors';
import type {
  BakeListDto,
  BakeListRowDto,
  BakeListLine,
  DistributionDto,
  DistributionRowDto,
  ProducerParEntry,
} from '@panaderia/shared';

/**
 * Bake list & distribution service (TDD §9).
 *
 * The same frozen-order lines feed two views: aggregate upward (bake list) and break
 * down by destination (distribution). To guarantee the two can never disagree, both
 * are derived here from one in-memory source — an array of {@link BakeListLine}.
 *
 * The transforms below are PURE functions of (lines, pars): given the same inputs they
 * always produce the same DTO rows and perform no I/O. The DB-touching functions
 * (`loadBakeListData`, `getBakeList`, `getDistribution`) are thin wrappers that fetch
 * the lines and pars, then delegate to the pure transforms — which is what the unit
 * tests exercise directly.
 */

/** Order statuses that count as "frozen" for the bake list (TDD §9.2, §8.1). */
const FROZEN_STATUSES = ['frozen', 'received'] as const;

/**
 * Build the bake-list rows from frozen lines and the producer's pars.
 *
 * Algorithm (TDD §9.2 — "aggregate up"):
 *   bakeQty(item) = Σ orderedQty(item) + producerPar(item)
 *
 * We first sum ordered quantities per catalog item (a single pass over `lines`,
 * O(L)), then fold in every par entry (O(P)) so that an item with a par but zero
 * orders still appears with bakeQty = producerPar. Rows are returned sorted by item
 * name for a stable, human-scannable printout.
 *
 * Preconditions: `lines` and `pars` describe one producer + one service day.
 * Postcondition: for every row, bakeQty === orderedTotal + producerPar, and every item
 * that appears in either input appears exactly once in the output.
 *
 * @param lines frozen incoming order lines for this producer + service day
 * @param pars  the producer's own par per catalog item (may include items with no orders)
 */
export function buildBakeListRows(
  lines: readonly BakeListLine[],
  pars: readonly ProducerParEntry[],
): BakeListRowDto[] {
  // catalogItemId -> accumulating row. Using a Map preserves first-seen names and
  // keeps the merge of the two inputs O(L + P).
  const rows = new Map<string, BakeListRowDto>();

  const ensure = (catalogItemId: string, catalogItemName: string): BakeListRowDto => {
    let row = rows.get(catalogItemId);
    if (!row) {
      row = { catalogItemId, catalogItemName, orderedTotal: 0, producerPar: 0, bakeQty: 0 };
      rows.set(catalogItemId, row);
    }
    return row;
  };

  for (const line of lines) {
    const row = ensure(line.catalogItemId, line.catalogItemName);
    row.orderedTotal += line.orderedQty;
  }

  // Fold in pars — including items that received no orders (TDD §9.2: "Include items
  // with a par even if no orders").
  for (const par of pars) {
    const row = ensure(par.catalogItemId, par.catalogItemName);
    row.producerPar = par.producerPar;
  }

  for (const row of rows.values()) {
    row.bakeQty = row.orderedTotal + row.producerPar;
  }

  return [...rows.values()].sort((a, b) => a.catalogItemName.localeCompare(b.catalogItemName));
}

/**
 * Invert the same lines into a per-destination pick list (TDD §9.3 — "break down").
 *
 * For each catalog item we group its lines by buyer store, summing ordered quantities
 * into a per-buyer allocation. `totalAllocated` is Σ allocations and, because both
 * views consume the identical `lines`, it is identically equal to the bake list's
 * `orderedTotal` for that item — the invariant the TDD relies on.
 *
 * Pars play NO part here: pars are the producer's own stock, not destined for any
 * buyer, so they never appear in a distribution. Complexity is O(L) over the lines
 * plus O(I·log I + A·log A) to sort items and each item's allocations by name.
 *
 * @param lines frozen incoming order lines for this producer + service day
 */
export function buildDistributionRows(lines: readonly BakeListLine[]): DistributionRowDto[] {
  // catalogItemId -> (buyerStoreId -> allocation)
  const byItem = new Map<
    string,
    { name: string; allocations: Map<string, { buyerStoreName: string; qty: number }> }
  >();

  for (const line of lines) {
    let item = byItem.get(line.catalogItemId);
    if (!item) {
      item = { name: line.catalogItemName, allocations: new Map() };
      byItem.set(line.catalogItemId, item);
    }
    let alloc = item.allocations.get(line.buyerStoreId);
    if (!alloc) {
      alloc = { buyerStoreName: line.buyerStoreName, qty: 0 };
      item.allocations.set(line.buyerStoreId, alloc);
    }
    alloc.qty += line.orderedQty;
  }

  const rows: DistributionRowDto[] = [];
  for (const [catalogItemId, item] of byItem) {
    const allocations = [...item.allocations.entries()]
      .map(([buyerStoreId, a]) => ({
        buyerStoreId,
        buyerStoreName: a.buyerStoreName,
        qty: a.qty,
      }))
      .sort((x, y) => x.buyerStoreName.localeCompare(y.buyerStoreName));
    const totalAllocated = allocations.reduce((sum, a) => sum + a.qty, 0);
    rows.push({ catalogItemId, catalogItemName: item.name, allocations, totalAllocated });
  }

  return rows.sort((a, b) => a.catalogItemName.localeCompare(b.catalogItemName));
}

/**
 * The data both views share: the producing store, its frozen incoming lines for the
 * service day, and its own pars. Loaded once so the bake list and distribution are
 * always two cuts of the same numbers.
 *
 * Authorization is the caller's responsibility *before* this is invoked; this function
 * still verifies the store exists and can bake (TDD §6.2 — only producers have a bake
 * list). A store that cannot bake is rejected with 403 rather than silently empty, so
 * the UI can explain why.
 */
async function loadBakeListData(producerStoreId: string, serviceDay: string): Promise<{
  storeName: string;
  lines: BakeListLine[];
  pars: ProducerParEntry[];
}> {
  const [store] = await db
    .select({ id: stores.id, name: stores.name, canBake: stores.canBake })
    .from(stores)
    .where(eq(stores.id, producerStoreId))
    .limit(1);

  if (!store) throw notFound('That store was not found.');
  if (!store.canBake) {
    throw forbidden('That store is not a producer, so it has no bake list.');
  }

  // Frozen incoming lines: order_lines whose parent order is for this producer + day
  // and whose status is frozen or received (TDD §9.2). order_lines denormalizes the
  // seller (= producer) and buyer, so we join only to read display names.
  const lineRows = await db
    .select({
      catalogItemId: orderLines.catalogItemId,
      catalogItemName: catalogItems.name,
      buyerStoreId: orderLines.buyerStoreId,
      buyerStoreName: stores.name,
      orderedQty: orderLines.orderedQty,
    })
    .from(orderLines)
    .innerJoin(orders, eq(orderLines.orderId, orders.id))
    .innerJoin(catalogItems, eq(orderLines.catalogItemId, catalogItems.id))
    .innerJoin(stores, eq(orderLines.buyerStoreId, stores.id))
    .where(
      and(
        eq(orders.producerStoreId, producerStoreId),
        eq(orders.serviceDay, serviceDay),
        inArray(orders.status, [...FROZEN_STATUSES]),
      ),
    );

  // The producer's own pars (TDD §9.1). Only active menu items with a positive par
  // contribute a standalone row; a zero par adds nothing and need not be surfaced.
  const parRows = await db
    .select({
      catalogItemId: storeMenuItems.catalogItemId,
      catalogItemName: catalogItems.name,
      producerPar: storeMenuItems.par,
    })
    .from(storeMenuItems)
    .innerJoin(catalogItems, eq(storeMenuItems.catalogItemId, catalogItems.id))
    .where(
      and(
        eq(storeMenuItems.storeId, producerStoreId),
        eq(storeMenuItems.active, true),
        sql`${storeMenuItems.par} > 0`,
      ),
    );

  return { storeName: store.name, lines: lineRows, pars: parRows };
}

/** Assemble the bake-list DTO for a producer + service day (TDD §9.2). */
export async function getBakeList(producerStoreId: string, serviceDay: string): Promise<BakeListDto> {
  const { storeName, lines, pars } = await loadBakeListData(producerStoreId, serviceDay);
  return {
    producerStoreId,
    producerStoreName: storeName,
    serviceDay,
    rows: buildBakeListRows(lines, pars),
  };
}

/** Assemble the distribution DTO for a producer + service day (TDD §9.3). */
export async function getDistribution(
  producerStoreId: string,
  serviceDay: string,
): Promise<DistributionDto> {
  const { storeName, lines } = await loadBakeListData(producerStoreId, serviceDay);
  return {
    producerStoreId,
    producerStoreName: storeName,
    serviceDay,
    rows: buildDistributionRows(lines),
  };
}
