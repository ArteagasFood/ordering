import { z } from 'zod';
import { EMAIL_TRIGGERS } from './enums';
import type { EmailTrigger } from './enums';
import type { Id } from './common';

/**
 * Notifications & email contract (TDD §14). Transactional email goes through a
 * provider (stubbed to console in dev). Preferences follow the settings-resolution
 * pattern (§5.2): a user configures their own, and the admin can set globals,
 * override, and lock them.
 */

/** A user's effective preference for one trigger, with provenance/lock from resolution. */
export interface EmailPreferenceDto {
  trigger: EmailTrigger;
  /** Whether the user receives this notification. */
  enabled: boolean;
  /** True when admin-locked, so the UI disables the toggle. */
  locked: boolean;
}

/** A user updates their own opt-in preferences (e.g. the cutoff reminder, TDD §8.2). */
export const zUpdatePreferenceRequest = z.object({
  trigger: z.enum(EMAIL_TRIGGERS),
  enabled: z.boolean(),
});
export type UpdatePreferenceRequest = z.infer<typeof zUpdatePreferenceRequest>;

/** A record of a sent (or stubbed) message, surfaced in a dev outbox view. */
export interface SentMessageDto {
  id: Id;
  trigger: EmailTrigger;
  toEmail: string;
  subject: string;
  body: string;
  sentAt: string;
}

/**
 * The admin-governed policy for one trigger (TDD §5.2, §14): the org-wide default, an
 * optional forced override, and a lock. These are the "admin global / override / locked"
 * inputs to the settings resolver. When `locked` is true, the resolved override value
 * wins over (and disables) every user's own choice.
 */
export interface EmailPolicyDto {
  trigger: EmailTrigger;
  /** Whether users receive this notification absent any per-user row. */
  globalDefault: boolean;
  /** A forced value; null means "no override". Only takes effect when paired with `locked`. */
  overrideEnabled: boolean | null;
  /** When true (with a non-null override), the override wins and user toggles are disabled. */
  locked: boolean;
}

/** An admin sets or clears the policy for one trigger (the trigger comes from the path). */
export const zUpdatePolicyRequest = z.object({
  globalDefault: z.boolean(),
  /** null clears the override; a boolean forces that value (effective only when locked). */
  overrideEnabled: z.boolean().nullable(),
  locked: z.boolean(),
});
export type UpdatePolicyRequest = z.infer<typeof zUpdatePolicyRequest>;

/** An admin sends a sample message to demonstrate the provider/outbox while email is stubbed. */
export const zTestSendRequest = z.object({
  trigger: z.enum(EMAIL_TRIGGERS),
  toEmail: z.string().email().max(254),
});
export type TestSendRequest = z.infer<typeof zTestSendRequest>;

export { EMAIL_TRIGGERS };
