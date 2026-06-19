import { z } from 'zod';
import { zTimeOfDay } from './common';
import type { Id } from './common';

/**
 * Store contract (TDD §5.1, §6.2). A store is a grocery location that may produce,
 * buy, or both, governed by capability toggles. `cutoffTime` is the producer's
 * order cutoff for a service day (TDD §8.2); it participates in the
 * settings-resolution pattern, so reads expose the effective value.
 */
export interface StoreDto {
  id: Id;
  name: string;
  canBake: boolean;
  canSell: boolean;
  canBuy: boolean;
  /** Effective producer cutoff time-of-day (HH:MM), resolved per TDD §5.2. */
  cutoffTime: string;
  /** True if the store's cutoff is admin-locked (store cannot edit it). */
  cutoffLocked: boolean;
  active: boolean;
}

/** Admin: create a store. */
export const zCreateStoreRequest = z.object({
  name: z.string().min(1).max(120),
  canBake: z.boolean().default(false),
  canSell: z.boolean().default(false),
  canBuy: z.boolean().default(true),
  cutoffTime: zTimeOfDay.optional(),
});
export type CreateStoreRequest = z.infer<typeof zCreateStoreRequest>;

/** Admin: update a store, or a Store User updating their own store's allowed fields. */
export const zUpdateStoreRequest = z.object({
  name: z.string().min(1).max(120).optional(),
  canBake: z.boolean().optional(),
  canSell: z.boolean().optional(),
  canBuy: z.boolean().optional(),
  cutoffTime: zTimeOfDay.optional(),
  active: z.boolean().optional(),
});
export type UpdateStoreRequest = z.infer<typeof zUpdateStoreRequest>;
