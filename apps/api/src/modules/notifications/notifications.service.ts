import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../../db/client';
import {
  emailPreferences,
  emailPreferencePolicies,
  users,
  stores,
  reconciliationFlags,
  orderLines,
} from '../../db/schema';
import { resolveSetting } from '../../lib/settings';
import { getEmailProvider } from '../../lib/email';
import { EMAIL_TRIGGERS } from '@panaderia/shared';
import type {
  EmailTrigger,
  EmailPreferenceDto,
  EmailPolicyDto,
} from '@panaderia/shared';
import type { Db } from '../../db/client';

/**
 * Notifications & email service (TDD §14). Holds the non-trivial, pure logic behind the
 * router: the per-user preference resolution (a thin specialization of the shared
 * settings-resolution primitive, §5.2) and the three transactional-message builders
 * (§14.1). Authorization lives in `lib/authz` and is asserted in the routes; this module
 * assumes the caller has already passed the relevant action/row scope checks.
 */

/* ------------------------------------------------------------------ *
 * Preference resolution
 * ------------------------------------------------------------------ */

/** The admin policy inputs for one trigger, as selected from `email_preference_policies`. */
export interface PolicyRow {
  trigger: EmailTrigger;
  globalDefault: boolean;
  overrideEnabled: boolean | null;
  locked: boolean;
}

/**
 * Resolve a user's *effective* preference for one trigger (TDD §5.2, §14).
 *
 * This is the settings-resolution pattern specialized to a boolean opt-in. Resolution
 * order, highest precedence first:
 *
 *   1. admin override (locked)  — `policy.overrideEnabled` when `policy.locked` is true.
 *   2. the user's own value     — their `email_preferences.enabled` row, if any.
 *   3. the admin global default — `policy.globalDefault`.
 *   4. the system default       — `false` (opt-in: silence unless a user opts in).
 *
 * An override that is present but NOT locked is treated as advisory only and does not
 * win here, mirroring the pricing/cutoff resolvers where an admin must lock a value to
 * force it. We therefore only feed the resolver an `override` candidate when the policy
 * is locked, so an unlocked override never silently overrides a user's explicit choice.
 *
 * Preconditions: `policy` may be null (no admin policy row → all-defaults). `userValue`
 * is the user's stored boolean or null when they have never set this trigger.
 * Postcondition: `locked` is true exactly when an admin lock is in force, so the UI can
 * disable the toggle.
 *
 * Complexity: O(1).
 */
export function resolvePreference(
  trigger: EmailTrigger,
  userValue: boolean | null,
  policy: PolicyRow | null,
): EmailPreferenceDto {
  const lockedOverride =
    policy && policy.locked && policy.overrideEnabled != null
      ? { value: policy.overrideEnabled, locked: true }
      : null;

  const effective = resolveSetting<boolean>({
    override: lockedOverride,
    storeValue: userValue,
    globalDefault: policy ? policy.globalDefault : null,
    systemDefault: false,
  });

  return { trigger, enabled: effective.value, locked: effective.locked };
}

/**
 * Resolve every trigger's effective preference for one user (the GET /preferences body).
 *
 * Loads the user's stored rows and all admin policies in two queries, then resolves each
 * of the fixed `EMAIL_TRIGGERS` so the response always covers the complete vocabulary
 * (a trigger the user has never touched still appears, at its default). Complexity: two
 * indexed queries + O(#triggers) resolution.
 */
export async function resolveUserPreferences(
  userId: string,
  tx: Db = db,
): Promise<EmailPreferenceDto[]> {
  const prefRows = await tx
    .select({ trigger: emailPreferences.trigger, enabled: emailPreferences.enabled })
    .from(emailPreferences)
    .where(eq(emailPreferences.userId, userId));

  const userValues = new Map<EmailTrigger, boolean>();
  for (const r of prefRows) userValues.set(r.trigger, r.enabled);

  const policies = await loadPolicies(tx);

  return EMAIL_TRIGGERS.map((trigger) =>
    resolvePreference(trigger, userValues.get(trigger) ?? null, policies.get(trigger) ?? null),
  );
}

/** Load all admin policy rows into a map keyed by trigger (missing rows → absent key). */
export async function loadPolicies(tx: Db = db): Promise<Map<EmailTrigger, PolicyRow>> {
  const rows = await tx
    .select({
      trigger: emailPreferencePolicies.trigger,
      globalDefault: emailPreferencePolicies.globalDefault,
      overrideEnabled: emailPreferencePolicies.overrideEnabled,
      locked: emailPreferencePolicies.locked,
    })
    .from(emailPreferencePolicies);
  const map = new Map<EmailTrigger, PolicyRow>();
  for (const r of rows) map.set(r.trigger, r);
  return map;
}

/**
 * Shape every trigger's policy for the admin view (GET /policies). Triggers without a
 * stored policy row are returned at their effective defaults (globalDefault=false,
 * no override, unlocked) so the admin sees and can edit the full vocabulary.
 */
export async function listPolicyDtos(tx: Db = db): Promise<EmailPolicyDto[]> {
  const policies = await loadPolicies(tx);
  return EMAIL_TRIGGERS.map((trigger) => {
    const p = policies.get(trigger);
    return {
      trigger,
      globalDefault: p ? p.globalDefault : false,
      overrideEnabled: p ? p.overrideEnabled : null,
      locked: p ? p.locked : false,
    };
  });
}

/**
 * Is `trigger` admin-locked? A locked policy forbids a user from changing their own
 * preference (the PATCH /preferences guard, returning 409). A lock without a concrete
 * override value is meaningless for resolution but we still treat it as locked for the
 * write guard, since the admin has expressed intent to freeze the setting.
 */
export async function isTriggerLocked(trigger: EmailTrigger, tx: Db = db): Promise<boolean> {
  const [row] = await tx
    .select({ locked: emailPreferencePolicies.locked })
    .from(emailPreferencePolicies)
    .where(eq(emailPreferencePolicies.trigger, trigger))
    .limit(1);
  return row?.locked ?? false;
}

/* ------------------------------------------------------------------ *
 * Message builders (TDD §14.1) — pure, return {subject, body}
 * ------------------------------------------------------------------ */

export interface ComposedMessage {
  subject: string;
  body: string;
}

/**
 * Compose the order-cutoff reminder a buyer opted into (TDD §8.2, §14.1). The reminder
 * always reflects the *live* cutoff: the caller resolves it (so a mid-month change is
 * picked up) and passes it in. Pure: identical inputs always produce identical text.
 */
export function buildCutoffReminder(args: {
  buyerStoreName: string;
  producerStoreName: string;
  serviceDay: string;
  cutoffTime: string;
}): ComposedMessage {
  const { buyerStoreName, producerStoreName, serviceDay, cutoffTime } = args;
  return {
    subject: `Order reminder: ${producerStoreName} cutoff is ${cutoffTime}`,
    body:
      `Hi ${buyerStoreName},\n\n` +
      `This is a friendly reminder to submit your order to ${producerStoreName} for the ` +
      `${serviceDay} service day. Orders must be in by ${cutoffTime}; after that the ` +
      `order freezes and can no longer be edited.\n\n` +
      `— Panadería Exchange`,
  };
}

/** One flagged reconciliation line, summarized for the digest. */
export interface ReconciliationFlagSummary {
  buyerStoreName: string;
  producerStoreName: string;
  itemName: string;
  serviceDay: string;
  orderedQty: number;
  receivedQty: number;
  variance: number;
}

/**
 * Compose the daily reconciliation-exception digest for the admin (TDD §10.2, §14.1).
 * A single batched email lists every line flagged for large variance rather than one
 * message per incident. With an empty list the body states that no lines were flagged,
 * so the digest is safe to send unconditionally. Pure.
 */
export function buildReconciliationDigest(args: {
  date: string;
  flags: ReconciliationFlagSummary[];
}): ComposedMessage {
  const { date, flags } = args;
  const subject = `Reconciliation digest for ${date}: ${flags.length} flagged ${
    flags.length === 1 ? 'line' : 'lines'
  }`;

  if (flags.length === 0) {
    return {
      subject,
      body: `No lines were flagged for large variance on ${date}. Nothing to review.\n\n— Panadería Exchange`,
    };
  }

  const lines = flags
    .map((f) => {
      const direction = f.variance < 0 ? 'short' : 'over';
      return (
        `• ${f.itemName} — ${f.buyerStoreName} from ${f.producerStoreName} (${f.serviceDay}): ` +
        `ordered ${f.orderedQty}, received ${f.receivedQty} ` +
        `(${f.variance >= 0 ? '+' : ''}${f.variance}, ${direction})`
      );
    })
    .join('\n');

  return {
    subject,
    body:
      `The following ${flags.length} ${flags.length === 1 ? 'line was' : 'lines were'} ` +
      `flagged for large variance on ${date}. Each still bills on the received count; ` +
      `the flag is informational, for offline follow-up.\n\n${lines}\n\n— Panadería Exchange`,
  };
}

/**
 * Compose the month-close alert for Accounts Payable (TDD §12.3, §14.1): the amounts are
 * ready, so AP can issue checks and close the month. Pure.
 */
export function buildMonthCloseAlert(args: {
  month: string;
  statementCount: number;
  totalCents: number;
}): ComposedMessage {
  const { month, statementCount, totalCents } = args;
  const dollars = (totalCents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });
  return {
    subject: `Month-close ready: ${month}`,
    body:
      `The settlement amounts for ${month} are ready.\n\n` +
      `${statementCount} ${statementCount === 1 ? 'statement totals' : 'statements total'} ` +
      `${dollars}. Please review, issue checks, and close the month when payments are recorded.\n\n` +
      `— Panadería Exchange`,
  };
}

/* ------------------------------------------------------------------ *
 * Send wrappers — resolve recipients + preferences, then call the provider
 * ------------------------------------------------------------------ */

/** A recipient resolved for a trigger: their address and whether they opted in. */
interface ResolvedRecipient {
  userId: string;
  email: string;
}

/**
 * The subset of users who would actually receive `trigger`, after resolving each one's
 * effective preference. Used by the send wrappers so a notification respects per-user
 * opt-outs and admin locks alike. Active users only.
 */
async function recipientsFor(
  trigger: EmailTrigger,
  candidateUserIds: string[],
  tx: Db = db,
): Promise<ResolvedRecipient[]> {
  if (candidateUserIds.length === 0) return [];

  const userRows = await tx
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(and(inArray(users.id, candidateUserIds), eq(users.active, true)));

  const prefRows = await tx
    .select({
      userId: emailPreferences.userId,
      trigger: emailPreferences.trigger,
      enabled: emailPreferences.enabled,
    })
    .from(emailPreferences)
    .where(and(inArray(emailPreferences.userId, candidateUserIds), eq(emailPreferences.trigger, trigger)));

  const userValues = new Map<string, boolean>();
  for (const r of prefRows) userValues.set(r.userId, r.enabled);

  const policies = await loadPolicies(tx);
  const policy = policies.get(trigger) ?? null;

  const out: ResolvedRecipient[] = [];
  for (const u of userRows) {
    const pref = resolvePreference(trigger, userValues.get(u.id) ?? null, policy);
    if (pref.enabled) out.push({ userId: u.id, email: u.email });
  }
  return out;
}

/** Find the active users bound to a store, as send candidates (e.g. a buyer's staff). */
async function usersOfStore(storeId: string, tx: Db = db): Promise<string[]> {
  const rows = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.storeId, storeId), eq(users.active, true)));
  return rows.map((r) => r.id);
}

/** Find the active users holding a given role (e.g. admins, accounts_payable). */
async function usersWithRole(
  role: 'admin' | 'accounts_payable' | 'store_user',
  tx: Db = db,
): Promise<string[]> {
  const rows = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, role), eq(users.active, true)));
  return rows.map((r) => r.id);
}

/**
 * Send the cutoff reminder for a specific open order to every opted-in user at the buyer
 * store. Resolves the live cutoff via the caller-supplied value so the message reflects
 * the current setting (TDD §8.2). Returns the number of messages dispatched.
 */
export async function sendCutoffReminder(args: {
  buyerStoreId: string;
  buyerStoreName: string;
  producerStoreName: string;
  serviceDay: string;
  cutoffTime: string;
}): Promise<number> {
  const message = buildCutoffReminder(args);
  const candidates = await usersOfStore(args.buyerStoreId);
  const recipients = await recipientsFor('cutoff_reminder', candidates);
  const provider = getEmailProvider();
  for (const r of recipients) {
    await provider.send({ trigger: 'cutoff_reminder', to: r.email, ...message });
  }
  return recipients.length;
}

/**
 * Send the reconciliation digest to every opted-in admin (TDD §10.2). The digest is
 * built from the supplied flag summaries; the caller assembles them (e.g. today's
 * unresolved flags). Returns the number of messages dispatched.
 */
export async function sendReconciliationDigest(args: {
  date: string;
  flags: ReconciliationFlagSummary[];
}): Promise<number> {
  const message = buildReconciliationDigest(args);
  const candidates = await usersWithRole('admin');
  const recipients = await recipientsFor('reconciliation_digest', candidates);
  const provider = getEmailProvider();
  for (const r of recipients) {
    await provider.send({ trigger: 'reconciliation_digest', to: r.email, ...message });
  }
  return recipients.length;
}

/**
 * Send the month-close alert to every opted-in Accounts Payable user (TDD §12.3).
 * Returns the number of messages dispatched.
 */
export async function sendMonthCloseAlert(args: {
  month: string;
  statementCount: number;
  totalCents: number;
}): Promise<number> {
  const message = buildMonthCloseAlert(args);
  const candidates = await usersWithRole('accounts_payable');
  const recipients = await recipientsFor('month_close_alert', candidates);
  const provider = getEmailProvider();
  for (const r of recipients) {
    await provider.send({ trigger: 'month_close_alert', to: r.email, ...message });
  }
  return recipients.length;
}

/**
 * Assemble today's reconciliation digest from unresolved flags and dispatch it (a
 * manual trigger for the admin endpoint; a scheduler would call this on a daily cron).
 * Joins flags to their order lines and store/item names for a readable summary.
 */
export async function dispatchDailyReconciliationDigest(date: string, tx: Db = db): Promise<number> {
  const buyerStore = stores;
  const rows = await tx
    .select({
      buyerStoreId: orderLines.buyerStoreId,
      sellerStoreId: orderLines.sellerStoreId,
      orderedQty: orderLines.orderedQty,
      receivedQty: orderLines.receivedQty,
      variance: reconciliationFlags.variance,
      serviceDay: orderLines.serviceDay,
    })
    .from(reconciliationFlags)
    .innerJoin(orderLines, eq(reconciliationFlags.orderLineId, orderLines.id))
    .where(eq(reconciliationFlags.resolved, false));

  // Resolve store names in a single follow-up lookup (small N; keeps the join simple).
  const storeIds = new Set<string>();
  for (const r of rows) {
    storeIds.add(r.buyerStoreId);
    storeIds.add(r.sellerStoreId);
  }
  const nameRows =
    storeIds.size > 0
      ? await tx
          .select({ id: buyerStore.id, name: buyerStore.name })
          .from(buyerStore)
          .where(inArray(buyerStore.id, [...storeIds]))
      : [];
  const names = new Map<string, string>();
  for (const n of nameRows) names.set(n.id, n.name);

  const flags: ReconciliationFlagSummary[] = rows.map((r) => ({
    buyerStoreName: names.get(r.buyerStoreId) ?? 'Unknown store',
    producerStoreName: names.get(r.sellerStoreId) ?? 'Unknown store',
    itemName: 'Order line',
    serviceDay: r.serviceDay,
    orderedQty: r.orderedQty,
    receivedQty: r.receivedQty ?? r.orderedQty,
    variance: r.variance,
  }));

  return sendReconciliationDigest({ date, flags });
}
