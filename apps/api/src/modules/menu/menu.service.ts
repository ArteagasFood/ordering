import { and, eq } from 'drizzle-orm';
import { db, type Db } from '../../db/client';
import {
  storeMenuItems,
  globalPrices,
  priceOverrides,
  catalogItems,
} from '../../db/schema';
import { resolvePrice } from '../../lib/settings';
import { isOrderable } from '../../lib/menu-pricing';
import type { Cents, EffectiveValue, StoreMenuItemDto } from '@panaderia/shared';

/**
 * Menu & pricing service (TDD §6.3, §7, §9.1).
 *
 * The two governing computations — effective price and orderability — are NOT
 * reimplemented here. Price precedence flows through `resolvePrice` (lib/settings) and
 * the orderability axes through `isOrderable` (lib/menu-pricing), so the orders slice,
 * which snapshots line prices, sees byte-for-byte the same numbers this slice shows
 * (TDD §7.2). This module only joins the rows those resolvers need and shapes the DTO.
 */

/**
 * A flattened store-menu-item row joined with its catalog name and the three pricing
 * inputs. This is exactly the data the pure DTO builder needs; isolating it lets the
 * orderability/lock logic be unit-tested without a database.
 */
export interface MenuItemRow {
  id: string;
  storeId: string;
  catalogItemId: string;
  catalogItemName: string;
  categoryId: string | null;
  storePriceCents: Cents | null;
  visible: boolean;
  adminDisabled: boolean;
  availableFrom: string | null;
  par: number;
  active: boolean;
  /** Admin override price in cents for this menu item, or null when none exists. */
  overrideCents: Cents | null;
  /** Whether the override (if any) is locked; meaningless when overrideCents is null. */
  overrideLocked: boolean;
  /** The admin global default price for the catalog item, or null when none is set. */
  globalPriceCents: Cents | null;
}

/**
 * Build the public DTO for a store menu item.
 *
 * Pure (no I/O), so it is the unit under test for both the lock rule and orderability.
 *
 *   Precondition:  `row` carries the three pricing inputs and the four visibility axes.
 *   Postcondition: `effectivePriceCents` follows §7.1 precedence (override → store →
 *                  global → 0); `priceLocked` is true exactly when a locked admin
 *                  override governs the price; `orderable` follows the §6.3 axes in
 *                  order (active → admin-disabled → hidden → availability date).
 *
 * `today` is injectable (ISO YYYY-MM-DD) purely so availability-date tests are
 * deterministic.
 */
export function toStoreMenuItemDto(row: MenuItemRow, today?: string): StoreMenuItemDto {
  const price: EffectiveValue<Cents> = resolvePrice({
    overrideCents: row.overrideCents,
    overrideLocked: row.overrideLocked,
    storePriceCents: row.storePriceCents,
    globalPriceCents: row.globalPriceCents,
  });

  const orderable = isOrderable(
    {
      active: row.active,
      adminDisabled: row.adminDisabled,
      visible: row.visible,
      availableFrom: row.availableFrom,
    },
    today,
  );

  return {
    id: row.id,
    storeId: row.storeId,
    catalogItemId: row.catalogItemId,
    catalogItemName: row.catalogItemName,
    categoryId: row.categoryId,
    storePriceCents: row.storePriceCents,
    effectivePriceCents: price.value,
    // A price is locked against store edits exactly when a *locked* admin override wins.
    priceLocked: price.source === 'admin_override' && price.locked,
    visible: row.visible,
    adminDisabled: row.adminDisabled,
    availableFrom: row.availableFrom,
    par: row.par,
    orderable,
  };
}

/**
 * Load every menu item of a store (active and inactive — the owning store manages both),
 * joined with catalog name and the override/global pricing inputs, as flat rows.
 *
 * Complexity: one query with two left joins, O(n) in the store's item count.
 */
async function loadMenuRows(storeId: string, conn: Db = db): Promise<MenuItemRow[]> {
  const rows = await conn
    .select({
      id: storeMenuItems.id,
      storeId: storeMenuItems.storeId,
      catalogItemId: storeMenuItems.catalogItemId,
      catalogItemName: catalogItems.name,
      categoryId: storeMenuItems.categoryId,
      storePriceCents: storeMenuItems.storePriceCents,
      visible: storeMenuItems.visible,
      adminDisabled: storeMenuItems.adminDisabled,
      availableFrom: storeMenuItems.availableFrom,
      par: storeMenuItems.par,
      active: storeMenuItems.active,
      overrideCents: priceOverrides.priceCents,
      overrideLocked: priceOverrides.locked,
      globalPriceCents: globalPrices.priceCents,
    })
    .from(storeMenuItems)
    .innerJoin(catalogItems, eq(catalogItems.id, storeMenuItems.catalogItemId))
    .leftJoin(priceOverrides, eq(priceOverrides.storeMenuItemId, storeMenuItems.id))
    .leftJoin(globalPrices, eq(globalPrices.catalogItemId, storeMenuItems.catalogItemId))
    .where(eq(storeMenuItems.storeId, storeId));

  return rows.map((r) => ({
    id: r.id,
    storeId: r.storeId,
    catalogItemId: r.catalogItemId,
    catalogItemName: r.catalogItemName,
    categoryId: r.categoryId ?? null,
    storePriceCents: r.storePriceCents ?? null,
    visible: r.visible,
    adminDisabled: r.adminDisabled,
    availableFrom: r.availableFrom ?? null,
    par: r.par,
    active: r.active,
    overrideCents: r.overrideCents ?? null,
    overrideLocked: r.overrideLocked ?? false,
    globalPriceCents: r.globalPriceCents ?? null,
  }));
}

/** A store's full menu (every item the store offers), as resolved DTOs. */
export async function listStoreMenu(storeId: string, conn: Db = db): Promise<StoreMenuItemDto[]> {
  const rows = await loadMenuRows(storeId, conn);
  return rows.map((r) => toStoreMenuItemDto(r));
}

/**
 * A store's *orderable* menu (TDD §6.3): only items a buyer may order right now, with
 * effective prices. This is what the orders slice renders and snapshots against.
 */
export async function listOrderableMenu(
  producerStoreId: string,
  conn: Db = db,
): Promise<StoreMenuItemDto[]> {
  const dtos = await listStoreMenu(producerStoreId, conn);
  return dtos.filter((d) => d.orderable);
}

/** Load a single menu item row by id (across all stores), or null. Used by mutations. */
export async function getMenuItemRow(id: string, conn: Db = db): Promise<MenuItemRow | null> {
  const rows = await conn
    .select({
      id: storeMenuItems.id,
      storeId: storeMenuItems.storeId,
      catalogItemId: storeMenuItems.catalogItemId,
      catalogItemName: catalogItems.name,
      categoryId: storeMenuItems.categoryId,
      storePriceCents: storeMenuItems.storePriceCents,
      visible: storeMenuItems.visible,
      adminDisabled: storeMenuItems.adminDisabled,
      availableFrom: storeMenuItems.availableFrom,
      par: storeMenuItems.par,
      active: storeMenuItems.active,
      overrideCents: priceOverrides.priceCents,
      overrideLocked: priceOverrides.locked,
      globalPriceCents: globalPrices.priceCents,
    })
    .from(storeMenuItems)
    .innerJoin(catalogItems, eq(catalogItems.id, storeMenuItems.catalogItemId))
    .leftJoin(priceOverrides, eq(priceOverrides.storeMenuItemId, storeMenuItems.id))
    .leftJoin(globalPrices, eq(globalPrices.catalogItemId, storeMenuItems.catalogItemId))
    .where(eq(storeMenuItems.id, id))
    .limit(1);

  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    storeId: r.storeId,
    catalogItemId: r.catalogItemId,
    catalogItemName: r.catalogItemName,
    categoryId: r.categoryId ?? null,
    storePriceCents: r.storePriceCents ?? null,
    visible: r.visible,
    adminDisabled: r.adminDisabled,
    availableFrom: r.availableFrom ?? null,
    par: r.par,
    active: r.active,
    overrideCents: r.overrideCents ?? null,
    overrideLocked: r.overrideLocked ?? false,
    globalPriceCents: r.globalPriceCents ?? null,
  };
}

/**
 * Whether a menu item currently has a *locked* admin price override.
 *
 * This is the predicate behind the 409 on a store price edit: a locked override fixes
 * the price (§7.1), so the store may not change `storePriceCents` while one exists.
 */
export function hasLockedOverride(row: Pick<MenuItemRow, 'overrideCents' | 'overrideLocked'>): boolean {
  return row.overrideCents != null && row.overrideLocked;
}
