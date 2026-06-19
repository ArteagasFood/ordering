import { useCallback, useEffect, useState } from 'react';
import { Mail, RefreshCw } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { SentMessageDto, EmailTrigger } from '@panaderia/shared';

/**
 * The dev email outbox (TDD §14). While email is stubbed to the console provider, every
 * message is still recorded so this view can show "what would have been emailed":
 * subject, body, recipient, and time. An admin sees the whole outbox; any other user
 * sees only the messages addressed to them (scoped by the API).
 */

const TRIGGER_LABEL: Record<EmailTrigger, string> = {
  cutoff_reminder: 'Cutoff reminder',
  reconciliation_digest: 'Reconciliation digest',
  month_close_alert: 'Month-close alert',
};

function formatSentAt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function OutboxPage() {
  const user = useAuth((s) => s.user);
  const [messages, setMessages] = useState<SentMessageDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setMessages(await api.get<SentMessageDto[]>('/notifications/outbox'));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the outbox.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!user) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Email outbox</h1>
          <p className="text-muted-foreground">
            {user.role === 'admin'
              ? 'Every message the app has sent or stubbed, newest first.'
              : 'Messages addressed to you, newest first.'}
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className="h-4 w-4" aria-hidden />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : messages.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
            <Mail className="h-8 w-8" aria-hidden />
            <p>No messages yet. Notifications appear here as they are sent.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {messages.map((m) => (
            <Card key={m.id}>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-base">{m.subject}</CardTitle>
                  <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
                    {TRIGGER_LABEL[m.trigger]}
                  </span>
                </div>
                <CardDescription>
                  To {m.toEmail} · {formatSentAt(m.sentAt)}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="whitespace-pre-wrap font-sans text-sm text-foreground">{m.body}</pre>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
