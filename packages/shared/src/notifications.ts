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

export { EMAIL_TRIGGERS };
