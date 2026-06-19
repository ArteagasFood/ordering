/**
 * Canonical enumerations shared by the API and the SPA.
 *
 * These are the fixed vocabulary of the domain (TDD §3, §6, §8, §14, §16). They
 * are declared once here so that the database schema, the request validators, and
 * the UI all agree on the exact set of allowed values — a single source of truth
 * prevents the classic drift where the frontend offers an option the backend
 * rejects.
 *
 * Each enum is expressed as a `const` tuple plus a derived union type. The tuple
 * is what Zod and Drizzle consume at runtime; the union type is what TypeScript
 * consumers use at compile time.
 */

/** The three fixed roles (TDD §3.1). RBAC is intentionally not configurable in v1. */
export const ROLES = ['admin', 'accounts_payable', 'store_user'] as const;
export type Role = (typeof ROLES)[number];

/**
 * Order lifecycle states (TDD §8). There is deliberately no draft state: an order
 * is `open` (live, freely editable) from creation until the producer's cutoff, at
 * which point it `frozen`s. `received` means the buyer has counted the delivery.
 */
export const ORDER_STATUSES = ['open', 'frozen', 'received'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * The three per-store capability toggles (TDD §6.2). A store may hold any
 * combination; the real-world constraint is simply whether it has a bakery.
 */
export const STORE_CAPABILITIES = ['can_bake', 'can_sell', 'can_buy'] as const;
export type StoreCapability = (typeof STORE_CAPABILITIES)[number];

/**
 * Settlement presentation modes at month close (TDD §12.1). Storage is always
 * directional; netting is a presentation rollup chosen by Accounts Payable.
 */
export const SETTLEMENT_VIEWS = ['netted', 'directional'] as const;
export type SettlementView = (typeof SETTLEMENT_VIEWS)[number];

/** Email notification triggers (TDD §14.1). */
export const EMAIL_TRIGGERS = [
  'cutoff_reminder',
  'reconciliation_digest',
  'month_close_alert',
] as const;
export type EmailTrigger = (typeof EMAIL_TRIGGERS)[number];

/**
 * Sensitive actions that must be written to the immutable audit log (TDD §16.2).
 * Every entry captures actor, before/after, and a reason.
 */
export const AUDIT_ACTIONS = [
  'ap_quantity_correction',
  'admin_price_override',
  'admin_price_lock',
  'admin_item_disable',
  'month_close',
  'payment_recorded',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * Origin of an effective setting value under the settings-resolution pattern
 * (TDD §5.2). Resolution order: admin override (locked) → store/user value →
 * admin global default → system default.
 */
export const SETTING_SOURCES = [
  'admin_override',
  'store_value',
  'global_default',
  'system_default',
] as const;
export type SettingSource = (typeof SETTING_SOURCES)[number];
