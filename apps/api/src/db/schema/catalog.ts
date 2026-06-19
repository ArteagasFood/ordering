import { pgTable, uuid, text, boolean, timestamp, unique } from 'drizzle-orm/pg-core';
import { stores } from './identity';

/**
 * Catalog & taxonomy tables (TDD §5.1, §5.3).
 *
 * The catalog is shared and immediately global; taxonomy (departments → categories)
 * is centrally defined by the admin and identical for every store. Every catalog item
 * is typed via product_types so new product lines are configuration, not migration.
 */

export const productTypes = pgTable('product_types', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const catalogItems = pgTable('catalog_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  productTypeId: uuid('product_type_id')
    .notNull()
    .references(() => productTypes.id),
  /** Which store first created the item; null for system/admin-seeded items. */
  createdByStore: uuid('created_by_store').references(() => stores.id),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const departments = pgTable('departments', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    departmentId: uuid('department_id')
      .notNull()
      .references(() => departments.id),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /** Category names are unique within a department, not globally. */
    uniqDeptName: unique('categories_department_name_uniq').on(t.departmentId, t.name),
  }),
);
