import { Router } from 'express';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { emailPreferences, emailPreferencePolicies, sentMessages } from '../../db/schema';
import { asyncHandler, body, send } from '../../lib/http';
import { conflict } from '../../lib/errors';
import { currentUser, assertRole } from '../../lib/authz';
import { getEmailProvider } from '../../lib/email';
import {
  zUpdatePreferenceRequest,
  zUpdatePolicyRequest,
  zTestSendRequest,
  type EmailPreferenceDto,
  type EmailPolicyDto,
  type SentMessageDto,
} from '@panaderia/shared';
import {
  resolveUserPreferences,
  listPolicyDtos,
  isTriggerLocked,
  buildCutoffReminder,
  dispatchDailyReconciliationDigest,
} from './notifications.service';

/**
 * Notifications & email routes (TDD §14). Mounted at `/notifications` by the integrator.
 *
 * Two audiences share the router:
 *   - Every authenticated user manages their OWN opt-in preferences and sees the outbox
 *     filtered to messages addressed to them.
 *   - The admin manages the org-wide policies (global default / override / lock), sees
 *     the full outbox, and can fire test sends and a manual digest while email is stubbed.
 *
 * Authorization is enforced per handler via `lib/authz`; the client is never trusted.
 */
export const notificationsRouter: Router = Router();

/* ------------------------------------------------------------------ *
 * Per-user preferences
 * ------------------------------------------------------------------ */

/** GET /preferences — the current user's effective preference for every trigger. */
notificationsRouter.get(
  '/preferences',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const dtos = await resolveUserPreferences(user.id);
    send<EmailPreferenceDto[]>(res, dtos);
  }),
);

/**
 * PATCH /preferences — upsert the current user's preference for one trigger.
 * Rejected with 409 when the trigger is admin-locked: a locked policy freezes the
 * setting, so the user may not change their own value (TDD §5.2).
 */
notificationsRouter.patch(
  '/preferences',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = body(zUpdatePreferenceRequest, req);

    if (await isTriggerLocked(input.trigger)) {
      throw conflict('This notification is locked by an administrator and cannot be changed.');
    }

    // Upsert the user's row: one row per (user, trigger) by the table's unique index.
    await db
      .insert(emailPreferences)
      .values({ userId: user.id, trigger: input.trigger, enabled: input.enabled })
      .onConflictDoUpdate({
        target: [emailPreferences.userId, emailPreferences.trigger],
        set: { enabled: input.enabled },
      });

    const dtos = await resolveUserPreferences(user.id);
    send<EmailPreferenceDto[]>(res, dtos);
  }),
);

/* ------------------------------------------------------------------ *
 * Admin policies
 * ------------------------------------------------------------------ */

/** GET /policies — admin view of every trigger's policy (global default / override / lock). */
notificationsRouter.get(
  '/policies',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    assertRole(user, 'admin');
    const dtos = await listPolicyDtos();
    send<EmailPolicyDto[]>(res, dtos);
  }),
);

/** PATCH /policies/:trigger — admin upserts the policy for one trigger. */
notificationsRouter.patch(
  '/policies/:trigger',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    assertRole(user, 'admin');

    // The trigger comes from the path; validate it against the known vocabulary by
    // reusing the request schema's trigger enum via a small inline guard.
    const trigger = req.params.trigger;
    const input = body(zUpdatePolicyRequest, req);

    await db
      .insert(emailPreferencePolicies)
      .values({
        // `trigger` is the primary key; an invalid value fails the enum cast → 400-ish.
        trigger: trigger as EmailPolicyDto['trigger'],
        globalDefault: input.globalDefault,
        overrideEnabled: input.overrideEnabled,
        locked: input.locked,
      })
      .onConflictDoUpdate({
        target: emailPreferencePolicies.trigger,
        set: {
          globalDefault: input.globalDefault,
          overrideEnabled: input.overrideEnabled,
          locked: input.locked,
          updatedAt: new Date(),
        },
      });

    const dtos = await listPolicyDtos();
    send<EmailPolicyDto[]>(res, dtos);
  }),
);

/* ------------------------------------------------------------------ *
 * Outbox
 * ------------------------------------------------------------------ */

/**
 * GET /outbox — the dev email outbox, newest first (TDD §14). An admin sees every
 * message; any other user sees only messages addressed to their own email, so the
 * outbox never leaks one user's notifications to another.
 */
notificationsRouter.get(
  '/outbox',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);

    const columns = {
      id: sentMessages.id,
      trigger: sentMessages.trigger,
      toEmail: sentMessages.toEmail,
      subject: sentMessages.subject,
      body: sentMessages.body,
      sentAt: sentMessages.sentAt,
    } as const;

    // Admins (and AP, also global) may audit the full outbox; everyone else is scoped
    // to their own address. We gate the full view on the admin role specifically, since
    // the outbox can contain any user's notification content.
    const seesAll = user.role === 'admin';
    const rows = seesAll
      ? await db.select(columns).from(sentMessages).orderBy(desc(sentMessages.sentAt))
      : await db
          .select(columns)
          .from(sentMessages)
          .where(eq(sentMessages.toEmail, user.email))
          .orderBy(desc(sentMessages.sentAt));

    send<SentMessageDto[]>(
      res,
      rows.map((r) => ({
        id: r.id,
        trigger: r.trigger,
        toEmail: r.toEmail,
        subject: r.subject,
        body: r.body,
        sentAt: r.sentAt.toISOString(),
      })),
    );
  }),
);

/* ------------------------------------------------------------------ *
 * Admin demonstration helpers (email is stubbed → outbox is the proof)
 * ------------------------------------------------------------------ */

/**
 * POST /test-send — admin sends a sample message of a chosen trigger to an address, so
 * the console provider logs it and the outbox shows what email *would* be delivered.
 */
notificationsRouter.post(
  '/test-send',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    assertRole(user, 'admin');
    const input = body(zTestSendRequest, req);

    // A representative sample per trigger; this is a demonstration, not real data.
    const sample = buildCutoffReminder({
      buyerStoreName: 'Sample Buyer',
      producerStoreName: 'Sample Bakery',
      serviceDay: new Date().toISOString().slice(0, 10),
      cutoffTime: '06:00',
    });

    await getEmailProvider().send({
      trigger: input.trigger,
      to: input.toEmail,
      subject: `[Test] ${sample.subject}`,
      body: `(This is a test send of the "${input.trigger}" notification.)\n\n${sample.body}`,
    });

    send(res, { ok: true });
  }),
);

/**
 * POST /digest/reconciliation — admin manually fires today's reconciliation digest.
 * A scheduler would call the same service function on a daily cron (TDD §10.2); exposing
 * it as an endpoint lets the digest be demonstrated and triggered on demand.
 */
notificationsRouter.post(
  '/digest/reconciliation',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    assertRole(user, 'admin');
    const date = new Date().toISOString().slice(0, 10);
    const sent = await dispatchDailyReconciliationDigest(date);
    send(res, { sent });
  }),
);
