import type { Id, IsoDate } from './common';

/**
 * Bake list & distribution contract (TDD §9). Two views of the same frozen-order
 * data: aggregate up to know what to bake, break down to know where it goes.
 * Building both from one source guarantees they always agree.
 */

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
  serviceDay: IsoDate;
  rows: DistributionRowDto[];
}
