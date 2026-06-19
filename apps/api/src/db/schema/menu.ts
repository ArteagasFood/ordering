import { pgTable, uuid, integer, boolean, date, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { stores, users } from './identity';
import { catalogItems, categories } from './catalog';

/**
 * Store menu & pricing tables (TDD §6.3, §7, §9.1).
 *
 * Price resolution (TDD §7.1) draws from three sources: a locked admin override
 * (price_overrides) wins; otherwise the store's own price (store_menu_items); else
 * the admin global price (global_prices). The resolver lives in the app (lib/),
 * these tables are its inputs.
 */

export const storeMenuItems = pgTable(
  'store_menu_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id),
    catalogItemId: uuid('catalog_item_id')
      .notNull()
      .references(() => catalogItems.id),
    categoryId: uuid('category_id').references(() => categories.id),
    /** The store's own price in cents; null means fall back to the global price. */
    storePriceCents: integer('store_price_cents'),
    /** Store-controlled visibility (TDD §6.3 axis 2). */
    visible: boolean('visible').notNull().default(true),
    /** Admin top-down disable (TDD §6.3 axis 1) — wins over everything. */
    adminDisabled: boolean('admin_disabled').notNull().default(false),
    /** Future availability date; before it the item is not orderable (TDD §6.3 axis 3). */
    availableFrom: date('available_from'),
    /** The producer's own par for this item (TDD §9.1). */
    par: integer('par').notNull().default(0),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /** A store offers any catalog item at most once. */
    uniqStoreItem: unique('store_menu_items_store_item_uniq').on(t.storeId, t.catalogItemId),
  }),
);

/** Admin global default price per catalog item (TDD §7.1). */
export const globalPrices = pgTable('global_prices', {
  catalogItemId: uuid('catalog_item_id')
    .primaryKey()
    .references(() => catalogItems.id),
  priceCents: integer('price_cents').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Admin price override on a specific store's menu item (TDD §7.1). When `locked`, it
 * wins over the store price and prevents the store from editing. Creating/altering an
 * override is an audited action (TDD §16.2).
 */
export const priceOverrides = pgTable('price_overrides', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeMenuItemId: uuid('store_menu_item_id')
    .notNull()
    .unique()
    .references(() => storeMenuItems.id),
  priceCents: integer('price_cents').notNull(),
  locked: boolean('locked').notNull().default(true),
  reason: text('reason').notNull().default(''),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
