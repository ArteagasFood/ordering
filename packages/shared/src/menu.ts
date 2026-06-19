import { z } from 'zod';
import { zPriceCents, zQuantity, zIsoDate } from './common';
import type { Cents, Id, IsoDate } from './common';

/**
 * Store menu & pricing contract (TDD §6.3, §7, §9.1).
 *
 * A store menu item is a store's offer of a shared catalog item: its price,
 * visibility, availability date, and par level. The *effective price* and
 * *orderability* are resolved server-side:
 *
 *  - Price resolution (TDD §7.1): locked override → store price → global price.
 *  - Visibility resolution (TDD §6.3), evaluated in order: admin-disabled →
 *    store-hidden → availability-date-in-future → otherwise orderable.
 */
export interface StoreMenuItemDto {
  id: Id;
  storeId: Id;
  catalogItemId: Id;
  catalogItemName: string;
  categoryId: Id | null;
  /** The store's own price in cents, if set (null falls back to the global price). */
  storePriceCents: Cents | null;
  /** The resolved effective price actually charged (TDD §7.1). */
  effectivePriceCents: Cents;
  /** True when an admin locked-override fixes the price (store cannot edit). */
  priceLocked: boolean;
  /** Store-controlled hide flag (TDD §6.3 axis 2). */
  visible: boolean;
  /** Admin top-down disable (TDD §6.3 axis 1). */
  adminDisabled: boolean;
  /** Availability date; before it, the item is not orderable (TDD §6.3 axis 3). */
  availableFrom: IsoDate | null;
  /** The producing store's own par for this item (TDD §9.1). */
  par: number;
  /** Final computed answer: is this item orderable right now? */
  orderable: boolean;
}

/** Store: add a catalog item to this store's menu. */
export const zCreateMenuItemRequest = z.object({
  catalogItemId: z.string().uuid(),
  categoryId: z.string().uuid().nullable().default(null),
  storePriceCents: zPriceCents.nullable().default(null),
  visible: z.boolean().default(true),
  availableFrom: zIsoDate.nullable().default(null),
  par: zQuantity.default(0),
});
export type CreateMenuItemRequest = z.infer<typeof zCreateMenuItemRequest>;

/** Store: edit own menu item. Price edits are rejected when an admin lock exists. */
export const zUpdateMenuItemRequest = z.object({
  categoryId: z.string().uuid().nullable().optional(),
  storePriceCents: zPriceCents.nullable().optional(),
  visible: z.boolean().optional(),
  availableFrom: zIsoDate.nullable().optional(),
  par: zQuantity.optional(),
});
export type UpdateMenuItemRequest = z.infer<typeof zUpdateMenuItemRequest>;

/**
 * Admin global price + override controls (TDD §7.1). A global price is the default
 * when a store sets none; a locked override wins over the store and prevents edits.
 */
export const zSetGlobalPriceRequest = z.object({
  catalogItemId: z.string().uuid(),
  priceCents: zPriceCents,
});
export type SetGlobalPriceRequest = z.infer<typeof zSetGlobalPriceRequest>;

export const zSetPriceOverrideRequest = z.object({
  storeMenuItemId: z.string().uuid(),
  priceCents: zPriceCents,
  /** Reason is required: overrides are audited (TDD §16.2). */
  reason: z.string().min(1).max(500),
});
export type SetPriceOverrideRequest = z.infer<typeof zSetPriceOverrideRequest>;
