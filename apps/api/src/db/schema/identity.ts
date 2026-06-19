import { pgTable, uuid, text, boolean, timestamp } from 'drizzle-orm/pg-core';
import { roleEnum } from './enums';

/**
 * Identity tables: stores, users, sessions (TDD §4, §5.1, §15).
 *
 * Soft-delete convention (TDD §16.1): selectable entities carry an `active` flag and
 * are deactivated, never hard-deleted, so historical orders and statements stay
 * correct. Financial tables (orders, lines, statements, payments, audit) are append-
 * mostly and are never deleted at all.
 */

export const stores = pgTable('stores', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  /** Capability toggles (TDD §6.2): whether the store can produce, sell, and/or buy. */
  canBake: boolean('can_bake').notNull().default(false),
  canSell: boolean('can_sell').notNull().default(false),
  canBuy: boolean('can_buy').notNull().default(true),
  /** The store's own producer cutoff time-of-day (HH:MM); null falls back to global (TDD §8.2). */
  cutoffTime: text('cutoff_time'),
  /** When true, an admin has locked the cutoff and the store cannot edit it (TDD §5.2). */
  cutoffLocked: boolean('cutoff_locked').notNull().default(false),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  role: roleEnum('role').notNull(),
  /** Null for global Admin/AP; set for Store Users (TDD §3.1, §5.2). */
  storeId: uuid('store_id').references(() => stores.id),
  /** Argon2id hash; plaintext is never stored or logged (TDD §4.1). */
  passwordHash: text('password_hash').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Server-side sessions (TDD §4.1, §4.2). The browser holds only this opaque id in an
 * httpOnly cookie; deleting the row instantly revokes the session.
 */
export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});
