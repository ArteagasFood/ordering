import { z } from 'zod';
import { zId, zIsoDate } from './common';
import type { Id, IsoDate } from './common';

/**
 * Bake list & distribution contract (TDD §9). Two views of the same frozen-order
 * data: aggregate up to know what to bake, break down to know where it goes.
 * Building both from one source guarantees they always agree.
 */

/**
 * Query parameters for both bake-list views. `req.query` carries strings, so these
 * fields validate string inputs (a UUID and a YYYY-MM-DD service day).
 */
export const zBakeListQuery = z.object({
  producerStoreId: zId,
  serviceDay: zIsoDate,
});
export type BakeListQuery = z.infer<typeof zBakeListQuery>;

/** One row of the bake list: total to bake for an item on a service day (TDD §9.2). */
export interface BakeListRowDto {
  catalogItemId: Id;
  catalogItemName: string;
  /** Σ incoming order quantities for this item across all frozen orders. */
  orderedTotal: number;
  /** The producer's own par for this item (TDD §9.1). */
  producerPar: number;
  /** bakeQty = orderedTotal + producerPar (TDD §9.2 formula). */
  bakeQty: number;
}

export interface BakeListDto {
  producerStoreId: Id;
  /** The producing store's display name (TDD §17 — speak the user's language). */
  producerStoreName: string;
  serviceDay: IsoDate;
  rows: BakeListRowDto[];
}

/** One destination's pick list for an item (TDD §9.3 — the bake list inverted). */
export interface DistributionAllocationDto {
  buyerStoreId: Id;
  buyerStoreName: string;
  qty: number;
}

export interface DistributionRowDto {
  catalogItemId: Id;
  catalogItemName: string;
  allocations: DistributionAllocationDto[];
  /** Σ allocations — must equal the bake list's orderedTotal for the item. */
  totalAllocated: number;
}

export interface DistributionDto {
  producerStoreId: Id;
  /** The producing store's display name (TDD §17 — speak the user's language). */
  producerStoreName: string;
  serviceDay: IsoDate;
  rows: DistributionRowDto[];
}

/**
 * A single normalized frozen order line, the common input both views aggregate over
 * (TDD §9 — "same underlying lines, two directions"). The service extracts these from
 * `order_lines`; the pure transforms in `bakelist.service.ts` operate only on this
 * shape, which is also what the unit tests construct.
 */
export interface BakeListLine {
  catalogItemId: Id;
  catalogItemName: string;
  buyerStoreId: Id;
  buyerStoreName: string;
  orderedQty: number;
}

/** A producer's own par for one catalog item (from `store_menu_items.par`, TDD §9.1). */
export interface ProducerParEntry {
  catalogItemId: Id;
  catalogItemName: string;
  producerPar: number;
}
