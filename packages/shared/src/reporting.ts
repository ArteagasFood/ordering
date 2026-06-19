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
