import { z } from 'zod';
import { zQuantity } from './common';
import type { Id, IsoDate } from './common';

/**
 * Reconciliation & exceptions contract (TDD §10). The system does not adjudicate
 * disputes; it makes variance visible. When received-vs-expected variance crosses
 * an admin-set threshold (absolute or percentage, overridable per store), the line
 * is auto-flagged. A flagged line still bills on the received count — the flag is
 * informational (TDD §10.2 "bill it and flag it").
 */

export interface ReconciliationFlagDto {
  id: Id;
  orderLineId: Id;
  orderId: Id;
  producerStoreId: Id;
  producerStoreName: string;
  buyerStoreId: Id;
  buyerStoreName: string;
  catalogItemName: string;
  serviceDay: IsoDate;
  orderedQty: number;
  receivedQty: number;
  /** receivedQty − orderedQty (negative = short). */
  variance: number;
  /** |variance| as a fraction of orderedQty, 0..1. */
  variancePct: number;
  resolved: boolean;
  createdAt: string;
}

/** Admin: set the global variance threshold (TDD §10.2 step 1). */
export const zSetVarianceThresholdRequest = z.object({
  /** Absolute unit threshold, e.g. 10. */
  absolute: zQuantity,
  /** Percentage threshold as a fraction 0..1, e.g. 0.15. */
  percentage: z.number().min(0).max(1),
  /** Null = the global default; a storeId sets a per-store override. */
  storeId: z.string().uuid().nullable().default(null),
});
export type SetVarianceThresholdRequest = z.infer<typeof zSetVarianceThresholdRequest>;

export interface VarianceThresholdDto {
  storeId: Id | null;
  absolute: number;
  percentage: number;
}

/** Mark a flag resolved (offline follow-up complete). */
export const zResolveFlagRequest = z.object({
  resolved: z.boolean().default(true),
});
export type ResolveFlagRequest = z.infer<typeof zResolveFlagRequest>;
