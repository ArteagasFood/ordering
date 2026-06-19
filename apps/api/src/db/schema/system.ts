import { pgTable, uuid, text, boolean, timestamp, jsonb, unique } from 'drizzle-orm/pg-core';
import { auditActionEnum, emailTriggerEnum } from './enums';
import { users } from './identity';

/**
 * System tables: feature flags, audit log, email preferences/policies, the dev email
 * outbox, and a generic admin settings store (TDD §6.1, §14, §16.2, §5.2).
 */

/** Global feature-flag registry (TDD §6.1). Governs capabilities, never catalog structure. */
export const featureFlags = pgTable('feature_flags', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique(),
  description: text('description').notNull().default(''),
  enabled: boolean('enabled').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Immutable audit log (TDD §16.2). Append-only: rows are never updated or deleted.
 * before/after are JSON snapshots; reason is mandatory at the application layer.
 */
export const auditEntries = pgTable('audit_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorId: uuid('actor_id')
    .notNull()
    .references(() => users.id),
  action: auditActionEnum('action').notNull(),
  /** The entity touched, e.g. 'order_line:<uuid>'. */
  target: text('target').notNull(),
  before: jsonb('before'),
  after: jsonb('after'),
  reason: text('reason').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** A user's own email preference per trigger (TDD §14). The "store/user value" input to the resolver. */
export const emailPreferences = pgTable(
  'email_preferences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    trigger: emailTriggerEnum('trigger').notNull(),
    enabled: boolean('enabled').notNull(),
  },
  (t) => ({
    uniqUserTrigger: unique('email_preferences_user_trigger_uniq').on(t.userId, t.trigger),
  }),
);

/**
 * Admin policy per email trigger (TDD §5.2, §14): the global default, an optional
 * override value, and a lock. The "admin global / override / locked" inputs to the resolver.
 */
export const emailPreferencePolicies = pgTable('email_preference_policies', {
  trigger: emailTriggerEnum('trigger').primaryKey(),
  globalDefault: boolean('global_default').notNull().default(false),
  /** When non-null and `locked`, this value overrides the user's choice. */
  overrideEnabled: boolean('override_enabled'),
  locked: boolean('locked').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Dev email outbox (TDD §14): every message the EmailProvider sends or stubs is recorded. */
export const sentMessages = pgTable('sent_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  trigger: emailTriggerEnum('trigger').notNull(),
  toEmail: text('to_email').notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  provider: text('provider').notNull().default('console'),
  sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Generic admin settings (TDD §5.2 system/global defaults), e.g. the global cutoff
 * time. Key/value (JSON) so a new governed default is a row, not a migration.
 */
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
