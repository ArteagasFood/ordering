import {
  pgTable,
  uuid,
  integer,
  date,
  timestamp,
  boolean,
  doublePrecision,
  unique,
  index,
} from 'drizzle-orm/pg-core';
import { orderStatusEnum } from './enums';
import { stores, users } from './identity';
import { catalogItems, categories, productTypes } from './catalog';

/**
 * Order lifecycle tables (TDD §8, §10, §11, §13.3).
 *
 * `order_lines` is intentionally WIDE (denormalized). It copies the seller, buyer,
 * item, category, product type, service day, and a price snapshot at creation time so
 * that every historical line and report is immutable and correct even after catalog
 * prices or item metadata later change (TDD §7.2). This denormalization is the grain
 * the entire reporting module aggregates over.
 */

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    buyerStoreId: uuid('buyer_store_id')
      .notNull()
      .references(() => stores.id),
    producerStoreId: uuid('producer_store_id')
      .notNull()
      .references(() => stores.id),
    serviceDay: date('service_day').notNull(),
    status: orderStatusEnum('status').notNull().default('open'),
    /** Set when the order froze at the producer's cutoff (TDD §8.1 step 3). */
    frozenAt: timestamp('frozen_at', { withTimezone: true }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /** One order per buyer→producer per service day. */
    uniqTriple: unique('orders_buyer_producer_day_uniq').on(
      t.buyerStoreId,
      t.producerStoreId,
      t.serviceDay,
    ),
    byProducerDay: index('orders_producer_day_idx').on(t.producerStoreId, t.serviceDay),
  }),
);

export const orderLines = pgTable(
  'order_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    /** Denormalized parties (TDD §13.3). seller = producer, buyer = ordering store. */
    sellerStoreId: uuid('seller_store_id')
      .notNull()
      .references(() => stores.id),
    buyerStoreId: uuid('buyer_store_id')
      .notNull()
      .references(() => stores.id),
    /** Denormalized item dimensions for reporting (TDD §13.3). */
    catalogItemId: uuid('catalog_item_id')
      .notNull()
      .references(() => catalogItems.id),
    categoryId: uuid('category_id').references(() => categories.id),
    productTypeId: uuid('product_type_id')
      .notNull()
      .references(() => productTypes.id),
    /** Denormalized service day for time-based slicing (TDD §13.3). */
    serviceDay: date('service_day').notNull(),
    orderedQty: integer('ordered_qty').notNull(),
    /** Buyer's confirmed received count; null until receiving. Billable quantity (TDD §10.1). */
    receivedQty: integer('received_qty'),
    /** Optional informational waste annotation (TDD §11). */
    wasteQty: integer('waste_qty'),
    /** Effective price copied at creation; revenue is computed from this, never the live price. */
    unitPriceSnapshotCents: integer('unit_price_snapshot_cents').notNull(),
    /** (receivedQty ?? orderedQty) × snapshot, maintained on write. */
    lineTotalCents: integer('line_total_cents').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byOrder: index('order_lines_order_idx').on(t.orderId),
    bySellerDay: index('order_lines_seller_day_idx').on(t.sellerStoreId, t.serviceDay),
    byBuyerDay: index('order_lines_buyer_day_idx').on(t.buyerStoreId, t.serviceDay),
  }),
);

/**
 * Reconciliation flags (TDD §10.2). Auto-created when received-vs-expected variance
 * crosses the applicable threshold. A flag is informational and never blocks billing.
 */
export const reconciliationFlags = pgTable('reconciliation_flags', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderLineId: uuid('order_line_id')
    .notNull()
    .unique()
    .references(() => orderLines.id),
  /** receivedQty − orderedQty (negative = short). */
  variance: integer('variance').notNull(),
  /** |variance| / orderedQty, stored as a 0..1 fraction. */
  variancePct: doublePrecision('variance_pct').notNull(),
  thresholdAbsolute: integer('threshold_absolute').notNull(),
  thresholdPercentage: doublePrecision('threshold_percentage').notNull(),
  resolved: boolean('resolved').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Variance thresholds (TDD §10.2 step 1). A row with null storeId is the global
 * default; a row with a storeId overrides it for that store ("large" differs by size).
 */
export const varianceThresholds = pgTable('variance_thresholds', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeId: uuid('store_id')
    .references(() => stores.id)
    .unique(),
  absolute: integer('absolute').notNull(),
  percentage: doublePrecision('percentage').notNull(),
});
