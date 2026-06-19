import { and, asc, eq, gte, lte } from 'drizzle-orm';
import type {
  ReportLineRecord,
  ReportSummaryDto,
  RankRowDto,
  TrendGranularity,
  TrendPointDto,
  WasteRowDto,
} from '@panaderia/shared';
import { db } from '../../db/client';
import { orderLines, catalogItems, categories, productTypes } from '../../db/schema';

/**
 * Reporting service (TDD §13). Every report is an aggregation over the wide
 * `order_lines` table, which denormalizes seller/buyer/item/category/type/serviceDay
 * plus the price snapshot precisely so reports are straightforward sums and rankings,
 * not history reconstruction (§13.3).
 *
 * The aggregation MATH lives in pure functions below (no I/O): they take an array of
 * `ReportLineRecord` and return the report pieces, so the rules — unit attribution,
 * trend bucketing, top/dead ranking, totals — are unit-tested over plain arrays with
 * no database. The only impure function, `fetchReportLines`, does the scoped query.
 */

// ============================================================================
// Pure aggregation math (no I/O) — unit-tested in reporting.service.test.ts
// ============================================================================

/**
 * Billable units for a line. The buyer's confirmed `receivedQty` is the source of
 * truth once receiving has happened (TDD §10.1); until then we fall back to the
 * `orderedQty`. Note the deliberate `?? ` rather than `||` so a received count of 0
 * (a fully shorted delivery) counts as zero, not as the ordered quantity.
 *
 * Precondition: orderedQty is a non-negative integer; receivedQty is null or a
 * non-negative integer.
 */
export function lineUnits(line: ReportLineRecord): number {
  return line.receivedQty ?? line.orderedQty;
}

/** Total revenue (cents) over the lines — a plain sum of the maintained line totals. */
export function totalRevenueCents(lines: readonly ReportLineRecord[]): number {
  let sum = 0;
  for (const line of lines) sum += line.lineTotalCents;
  return sum;
}

/** Total billable units over the lines (received-or-ordered, per `lineUnits`). */
export function totalUnits(lines: readonly ReportLineRecord[]): number {
  let sum = 0;
  for (const line of lines) sum += lineUnits(line);
  return sum;
}

/**
 * Choose the trend bucket granularity from the span of the range. A range spanning at
 * most `MONTH_THRESHOLD_DAYS` reads best day-by-day; anything longer collapses to
 * months so a year-long report is twelve legible points, not a hairball of 365.
 *
 * Preconditions: `from` and `to` are ISO `YYYY-MM-DD` strings with from ≤ to.
 * Complexity: O(1).
 */
export const MONTH_THRESHOLD_DAYS = 92; // ~3 months

export function chooseGranularity(from: string, to: string): TrendGranularity {
  const spanDays = daysBetweenInclusive(from, to);
  return spanDays > MONTH_THRESHOLD_DAYS ? 'month' : 'day';
}

/** Inclusive day count between two ISO dates (UTC, so no DST/timezone drift). */
function daysBetweenInclusive(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.floor((b - a) / MS_PER_DAY) + 1;
}

/** The bucket key for a line's service day at a given granularity (day = full date, month = YYYY-MM). */
function periodKey(serviceDay: string, granularity: TrendGranularity): string {
  return granularity === 'month' ? serviceDay.slice(0, 7) : serviceDay;
}

/**
 * Bucket lines into a time-ordered trend of (period, revenue, units) points.
 *
 * Algorithm: a single O(n) pass accumulates revenue and units into a map keyed by the
 * line's period (day or month); the keys are then sorted lexicographically, which for
 * ISO `YYYY-MM-DD` / `YYYY-MM` strings is exactly chronological order. Only periods
 * that actually have lines appear (a sparse trend); gaps are the caller's to fill if a
 * continuous axis is wanted.
 *
 * Postcondition: points are strictly increasing by `period`; sum of point revenues
 * equals `totalRevenueCents(lines)` and sum of units equals `totalUnits(lines)`.
 * Complexity: O(n + k log k) for n lines and k distinct periods.
 */
export function buildTrend(
  lines: readonly ReportLineRecord[],
  granularity: TrendGranularity,
): TrendPointDto[] {
  const buckets = new Map<string, { revenueCents: number; units: number }>();
  for (const line of lines) {
    const key = periodKey(line.serviceDay, granularity);
    const bucket = buckets.get(key) ?? { revenueCents: 0, units: 0 };
    bucket.revenueCents += line.lineTotalCents;
    bucket.units += lineUnits(line);
    buckets.set(key, bucket);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([period, v]) => ({ period, revenueCents: v.revenueCents, units: v.units }));
}

/** A dimension selector: pulls the (key, label) pair a ranking groups by from a line. */
type Dimension = (line: ReportLineRecord) => { key: string; label: string } | null;

const byItem: Dimension = (l) => ({ key: l.catalogItemId, label: l.catalogItemName });
const byProductTypeDim: Dimension = (l) => ({ key: l.productTypeId, label: l.productTypeName });
const byCategoryDim: Dimension = (l) =>
  l.categoryId ? { key: l.categoryId, label: l.categoryName ?? l.categoryId } : null;

/**
 * Group lines by an arbitrary dimension into rank rows of (revenue, units).
 *
 * A line whose dimension selector returns null (e.g. an uncategorized line under the
 * category dimension) is skipped so it does not pollute the ranking with a phantom
 * group. Rows are returned in descending revenue, ties broken by descending units then
 * by label so the order is deterministic for tests.
 *
 * Complexity: O(n + k log k) for n lines and k distinct groups.
 */
export function rankBy(lines: readonly ReportLineRecord[], dimension: Dimension): RankRowDto[] {
  const groups = new Map<string, RankRowDto>();
  for (const line of lines) {
    const d = dimension(line);
    if (!d) continue;
    const row = groups.get(d.key) ?? { key: d.key, label: d.label, revenueCents: 0, units: 0 };
    row.revenueCents += line.lineTotalCents;
    row.units += lineUnits(line);
    groups.set(d.key, row);
  }
  return [...groups.values()].sort(
    (a, b) =>
      b.revenueCents - a.revenueCents ||
      b.units - a.units ||
      a.label.localeCompare(b.label),
  );
}

/**
 * Top sellers by revenue: the first `limit` rows of the item ranking (already in
 * descending-revenue order). The headline "what's selling" answer (TDD §13.1).
 */
export function topItems(lines: readonly ReportLineRecord[], limit = 10): RankRowDto[] {
  return rankBy(lines, byItem).slice(0, limit);
}

/**
 * Dead items: the WORST sellers — items that appear in the data but earn little or no
 * revenue (TDD §13.1 "what isn't selling"). We rank items ascending by revenue (ties
 * broken by ascending units) and return the bottom `limit`. This surfaces "at least
 * the lowest sellers" as required; a richer definition (items on a menu with zero
 * sales) would need the menu set, which the summary query does not join.
 *
 * Postcondition: rows are in ascending revenue order (worst first).
 */
export function deadItems(lines: readonly ReportLineRecord[], limit = 10): RankRowDto[] {
  const ascending = rankBy(lines, byItem).sort(
    (a, b) =>
      a.revenueCents - b.revenueCents ||
      a.units - b.units ||
      a.label.localeCompare(b.label),
  );
  return ascending.slice(0, limit);
}

/** Revenue/units broken down by category (uncategorized lines excluded). */
export function byCategory(lines: readonly ReportLineRecord[]): RankRowDto[] {
  return rankBy(lines, byCategoryDim);
}

/** Revenue/units broken down by product type. */
export function byProductType(lines: readonly ReportLineRecord[]): RankRowDto[] {
  return rankBy(lines, byProductTypeDim);
}

/**
 * Waste by item: sum of `wasteQty` grouped by catalog item, descending by waste so the
 * biggest waste sources read first (TDD §13.1 "what is being made but wasted"). Lines
 * with null or zero waste contribute nothing and items with no waste are omitted.
 *
 * Complexity: O(n + k log k).
 */
export function wasteByItem(lines: readonly ReportLineRecord[]): WasteRowDto[] {
  const groups = new Map<string, WasteRowDto>();
  for (const line of lines) {
    const waste = line.wasteQty ?? 0;
    if (waste === 0) continue;
    const row = groups.get(line.catalogItemId) ?? {
      key: line.catalogItemId,
      label: line.catalogItemName,
      wasteUnits: 0,
    };
    row.wasteUnits += waste;
    groups.set(line.catalogItemId, row);
  }
  return [...groups.values()].sort(
    (a, b) => b.wasteUnits - a.wasteUnits || a.label.localeCompare(b.label),
  );
}

/**
 * Assemble the full dashboard summary from a set of lines (TDD §13). This is the one
 * pure entry point that composes every piece, so the whole report shape is testable
 * over a plain array with no database.
 *
 * `lens` is carried through verbatim (it determines which store dimension the caller
 * filtered/grouped by, which happens in the query, not here). The `from`/`to` range is
 * used only to choose the trend granularity.
 */
export function summarize(
  lines: readonly ReportLineRecord[],
  lens: 'seller' | 'buyer',
  from: string,
  to: string,
): ReportSummaryDto {
  return {
    lens,
    totalRevenueCents: totalRevenueCents(lines),
    totalUnits: totalUnits(lines),
    trend: buildTrend(lines, chooseGranularity(from, to)),
    topItems: topItems(lines),
    deadItems: deadItems(lines),
    byCategory: byCategory(lines),
    byProductType: byProductType(lines),
    waste: wasteByItem(lines),
  };
}

// ============================================================================
// Impure: the scoped query that materializes the lines for the math above
// ============================================================================

export interface FetchLinesParams {
  from: string;
  to: string;
  lens: 'seller' | 'buyer';
  /** When set, restrict to this store on the lens's side; when null, span all stores. */
  storeId: string | null;
}

/**
 * Fetch the denormalized order lines for a report, scoped to the range, lens, and
 * (optionally) a single store.
 *
 * The lens selects WHICH store column the optional `storeId` filters on: under the
 * seller lens a store's report is the revenue it EARNED (its `seller_store_id` rows);
 * under the buyer lens it is what the store SPENT (its `buyer_store_id` rows). When
 * `storeId` is null (a global role asking for "all stores") no store filter applies.
 *
 * Item/category/product-type names are joined in so rankings read in plain language.
 * The category join is a LEFT join because `category_id` is nullable on the line.
 */
export async function fetchReportLines(params: FetchLinesParams): Promise<ReportLineRecord[]> {
  const { from, to, lens, storeId } = params;
  const storeColumn = lens === 'seller' ? orderLines.sellerStoreId : orderLines.buyerStoreId;

  const conditions = [gte(orderLines.serviceDay, from), lte(orderLines.serviceDay, to)];
  if (storeId) conditions.push(eq(storeColumn, storeId));

  const rows = await db
    .select({
      serviceDay: orderLines.serviceDay,
      sellerStoreId: orderLines.sellerStoreId,
      buyerStoreId: orderLines.buyerStoreId,
      catalogItemId: orderLines.catalogItemId,
      catalogItemName: catalogItems.name,
      categoryId: orderLines.categoryId,
      categoryName: categories.name,
      productTypeId: orderLines.productTypeId,
      productTypeName: productTypes.name,
      orderedQty: orderLines.orderedQty,
      receivedQty: orderLines.receivedQty,
      wasteQty: orderLines.wasteQty,
      lineTotalCents: orderLines.lineTotalCents,
    })
    .from(orderLines)
    .innerJoin(catalogItems, eq(orderLines.catalogItemId, catalogItems.id))
    .innerJoin(productTypes, eq(orderLines.productTypeId, productTypes.id))
    .leftJoin(categories, eq(orderLines.categoryId, categories.id))
    .where(and(...conditions))
    .orderBy(asc(orderLines.serviceDay));

  return rows;
}

/** Convenience: fetch the lines for a report and reduce them to the summary DTO. */
export async function buildSummary(params: FetchLinesParams): Promise<ReportSummaryDto> {
  const lines = await fetchReportLines(params);
  return summarize(lines, params.lens, params.from, params.to);
}
