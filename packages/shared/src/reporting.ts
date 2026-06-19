import { z } from 'zod';
import { zIsoDate } from './common';
import type { Cents, Id } from './common';

/**
 * Reporting contract (TDD §13). Every report is an aggregation over the wide
 * order-line table sliced by a few dimensions. Two lenses: as seller (revenue —
 * the headline growth metric) and as buyer (spend). Charts render with D3.
 */

export const zReportQuery = z.object({
  /** Inclusive service-day range. */
  from: zIsoDate,
  to: zIsoDate,
  /** Optional single-store focus; omitted = across all stores. */
  storeId: z.string().uuid().optional(),
  /** Which performance lens to compute (TDD §13.2). */
  lens: z.enum(['seller', 'buyer']).default('seller'),
});
export type ReportQuery = z.infer<typeof zReportQuery>;

/** A time-bucketed revenue/volume point for trend charts. */
export interface TrendPointDto {
  /** Bucket key (a service day or month). */
  period: string;
  revenueCents: Cents;
  units: number;
}

/** An item/category/type ranking row (top sellers, dead items). */
export interface RankRowDto {
  key: Id | string;
  label: string;
  revenueCents: Cents;
  units: number;
}

export interface WasteRowDto {
  key: Id | string;
  label: string;
  wasteUnits: number;
}

/**
 * The trend bucketing granularity. A short range reads best day-by-day; a long range
 * (multiple months) reads best collapsed to months so the chart is not a hairball.
 */
export type TrendGranularity = 'day' | 'month';

/**
 * One denormalized order line as the reporting math sees it — the analytical grain
 * (TDD §13.3). This is the exact shape the pure aggregation functions consume, so they
 * can be unit-tested over plain arrays with no database. It mirrors the `order_lines`
 * columns the reports depend on; `label` fields are the human names joined in at query
 * time (item/category/product-type names) so rankings read in plain bakery language.
 */
export interface ReportLineRecord {
  /** Service day (YYYY-MM-DD) used for time bucketing. */
  serviceDay: string;
  sellerStoreId: Id;
  buyerStoreId: Id;
  catalogItemId: Id;
  catalogItemName: string;
  /** Null when the line carries no category (categoryId is nullable on the table). */
  categoryId: Id | null;
  categoryName: string | null;
  productTypeId: Id;
  productTypeName: string;
  orderedQty: number;
  /** Null until the buyer confirms receiving; units fall back to orderedQty then. */
  receivedQty: number | null;
  /** Optional informational waste annotation. */
  wasteQty: number | null;
  /** Effective revenue for the line, computed on write ((received ?? ordered) × price). */
  lineTotalCents: Cents;
}

/** The bundle backing a store's (or the global) dashboard. */
export interface ReportSummaryDto {
  lens: 'seller' | 'buyer';
  totalRevenueCents: Cents;
  totalUnits: number;
  trend: TrendPointDto[];
  topItems: RankRowDto[];
  deadItems: RankRowDto[];
  byCategory: RankRowDto[];
  byProductType: RankRowDto[];
  waste: WasteRowDto[];
}
