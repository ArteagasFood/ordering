import { db } from '../db/client';
import { sentMessages } from '../db/schema';
import { env } from '../env';
import type { EmailTrigger } from '@panaderia/shared';

/**
 * Transactional email (TDD §14), behind a provider interface so the rest of the app
 * never depends on a vendor. In dev the ConsoleEmailProvider logs and records each
 * message to the `sent_messages` outbox; setting EMAIL_PROVIDER=resend swaps in the
 * Resend implementation by changing one env var. Every send is recorded to the outbox
 * regardless, so the dev UI can show "what would have been emailed."
 */
export interface OutgoingEmail {
  trigger: EmailTrigger;
  to: string;
  subject: string;
  body: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: OutgoingEmail): Promise<void>;
}

/** Persist a message to the dev outbox (shared by all providers). */
async function recordSent(message: OutgoingEmail, provider: string): Promise<void> {
  await db.insert(sentMessages).values({
    trigger: message.trigger,
    toEmail: message.to,
    subject: message.subject,
    body: message.body,
    provider,
  });
}

class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console';
  async send(message: OutgoingEmail): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(
      `[email:console] to=${message.to} trigger=${message.trigger} subject=${JSON.stringify(
        message.subject,
      )}`,
    );
    await recordSent(message, this.name);
  }
}

class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';
  constructor(private readonly apiKey: string) {}

  async send(message: OutgoingEmail): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: message.to,
        subject: message.subject,
        text: message.body,
      }),
    });
    if (!res.ok) {
      throw new Error(`Resend send failed: ${res.status} ${await res.text()}`);
    }
    await recordSent(message, this.name);
  }
}

let provider: EmailProvider | null = null;

/**
 * The process-wide email provider. Falls back to the console provider if Resend is
 * selected but no API key is configured, so a misconfiguration degrades gracefully
 * rather than breaking notification-triggering actions.
 */
export function getEmailProvider(): EmailProvider {
  if (provider) return provider;
  if (env.EMAIL_PROVIDER === 'resend' && env.RESEND_API_KEY) {
    provider = new ResendEmailProvider(env.RESEND_API_KEY);
  } else {
    provider = new ConsoleEmailProvider();
  }
  return provider;
}
