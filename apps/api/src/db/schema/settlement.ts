import { pgTable, uuid, integer, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { stores, users } from './identity';

/**
 * Invoicing & settlement tables (TDD §12). Truth is always DIRECTIONAL: each
 * statement is unambiguously "payer owes payee for month". Netting is computed at
 * presentation time from these directional rows, so gross numbers are never lost and
 * any netted figure can be expanded back to its constituents (TDD §12.2).
 */

export const statements = pgTable(
  'statements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    payerStoreId: uuid('payer_store_id')
      .notNull()
      .references(() => stores.id),
    payeeStoreId: uuid('payee_store_id')
      .notNull()
      .references(() => stores.id),
    /** Month key YYYY-MM. */
    month: text('month').notNull(),
    grossAmountCents: integer('gross_amount_cents').notNull().default(0),
    /** Frozen at month close; non-null means the period is immutable (TDD §12.3 step 4). */
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqPayerPayeeMonth: unique('statements_payer_payee_month_uniq').on(
      t.payerStoreId,
      t.payeeStoreId,
      t.month,
    ),
  }),
);

/** Offline check payments recorded against a statement (TDD §12.3 step 3). */
export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  statementId: uuid('statement_id')
    .notNull()
    .references(() => statements.id),
  amountCents: integer('amount_cents').notNull(),
  reference: text('reference').notNull().default(''),
  recordedBy: uuid('recorded_by')
    .notNull()
    .references(() => users.id),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
});
