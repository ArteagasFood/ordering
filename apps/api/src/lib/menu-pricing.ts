import { and, eq } from 'drizzle-orm';
import { db, type Db } from '../db/client';
import { storeMenuItems, globalPrices, priceOverrides } from '../db/schema';
import { resolvePrice } from './settings';
import type { Cents, EffectiveValue } from '@panaderia/shared';

/**
 * Shared menu resolvers used by BOTH the menu slice (for display) and the orders slice
 * (to snapshot a line's price). Keeping the effective-price computation in one place is
 * essential: the orders slice must snapshot exactly the price the menu slice shows, or
 * invoices and the catalog would disagree (TDD §7.1, §7.2).
 */

/**
 * Resolve the effective price (in cents) a given store charges for a catalog item, or
 * null if the item is not on that store's menu. Applies the §7.1 precedence:
 * locked override → store price → global price → 0.
 */
export async function getEffectivePrice(
  storeId: string,
  catalogItemId: string,
  conn: Db = db,
): Promise<EffectiveValue<Cents> | null> {
  const [mi] = await conn
    .select({ id: storeMenuItems.id, storePriceCents: storeMenuItems.storePriceCents })
    .from(storeMenuItems)
    .where(and(eq(storeMenuItems.storeId, storeId), eq(storeMenuItems.catalogItemId, catalogItemId)))
    .limit(1);
  if (!mi) return null;

  const [override] = await conn
    .select({ priceCents: priceOverrides.priceCents, locked: priceOverrides.locked })
    .from(priceOverrides)
    .where(eq(priceOverrides.storeMenuItemId, mi.id))
    .limit(1);

  const [gp] = await conn
    .select({ priceCents: globalPrices.priceCents })
    .from(globalPrices)
    .where(eq(globalPrices.catalogItemId, catalogItemId))
    .limit(1);

  return resolvePrice({
    overrideCents: override?.priceCents ?? null,
    overrideLocked: override?.locked ?? false,
    storePriceCents: mi.storePriceCents ?? null,
    globalPriceCents: gp?.priceCents ?? null,
  });
}

/** The shape needed to decide orderability (a subset of a store_menu_items row). */
export interface OrderabilityInput {
  active: boolean;
  adminDisabled: boolean;
  visible: boolean;
  availableFrom: string | null;
}

/**
 * Whether an item is orderable right now (TDD §6.3), evaluating the axes in order:
 * admin-disabled → store-hidden → availability-date-in-future → otherwise orderable.
 * `today` is an ISO date (YYYY-MM-DD); injectable for testing.
 */
export function isOrderable(item: OrderabilityInput, today: string = new Date().toISOString().slice(0, 10)): boolean {
  if (!item.active) return false;
  if (item.adminDisabled) return false;
  if (!item.visible) return false;
  if (item.availableFrom && item.availableFrom > today) return false;
  return true;
}
