import { pgEnum } from 'drizzle-orm/pg-core';
import { ROLES, ORDER_STATUSES, AUDIT_ACTIONS, EMAIL_TRIGGERS } from '@panaderia/shared';

/**
 * Postgres enum types, derived directly from the shared `as const` vocabulary so the
 * database and the application can never disagree on the allowed values — and so the
 * inferred column types are the precise literal unions (e.g. 'admin' | ...), not a
 * widened `string`. drizzle's pgEnum accepts these readonly tuples as-is.
 */
export const roleEnum = pgEnum('role', ROLES);
export const orderStatusEnum = pgEnum('order_status', ORDER_STATUSES);
export const auditActionEnum = pgEnum('audit_action', AUDIT_ACTIONS);
export const emailTriggerEnum = pgEnum('email_trigger', EMAIL_TRIGGERS);
