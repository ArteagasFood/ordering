import { useCallback, useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type {
  EmailPreferenceDto,
  EmailPolicyDto,
  EmailTrigger,
  UpdatePreferenceRequest,
  UpdatePolicyRequest,
} from '@panaderia/shared';

/**
 * Notification settings (TDD §5.2, §14). Every user toggles their own per-trigger
 * opt-ins; a trigger an admin has locked is shown disabled with an explanatory note,
 * never as an editable control the user cannot actually change (empathetic UI, §17).
 * Admins additionally get the org-wide policy controls below, gated on role.
 */

/** Human-friendly labels for the fixed trigger vocabulary (TDD §14.1). */
const TRIGGER_LABELS: Record<EmailTrigger, { title: string; description: string }> = {
  cutoff_reminder: {
    title: 'Order cutoff reminder',
    description: 'A nudge to submit your order before the producer’s cutoff.',
  },
  reconciliation_digest: {
    title: 'Reconciliation exception digest',
    description: 'A daily summary of lines flagged for large variance.',
  },
  month_close_alert: {
    title: 'Month-close alert',
    description: 'Amounts are ready — issue checks and close the month.',
  },
};

export function NotificationsPage() {
  const user = useAuth((s) => s.user);
  const [prefs, setPrefs] = useState<EmailPreferenceDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<EmailTrigger | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPrefs(await api.get<EmailPreferenceDto[]>('/notifications/preferences'));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your preferences.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (pref: EmailPreferenceDto) => {
    if (pref.locked) return; // belt-and-braces; the control is already disabled.
    setPending(pref.trigger);
    setError(null);
    try {
      const payload: UpdatePreferenceRequest = { trigger: pref.trigger, enabled: !pref.enabled };
      const next = await api.patch<EmailPreferenceDto[]>('/notifications/preferences', payload);
      setPrefs(next);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not update that preference. Please try again.',
      );
    } finally {
      setPending(null);
    }
  };

  if (!user) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Notifications</h1>
        <p className="text-muted-foreground">Choose which emails you receive.</p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Your preferences</CardTitle>
          <CardDescription>
            Email is currently delivered through a stub; see the outbox for what would be sent.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            prefs.map((pref) => {
              const meta = TRIGGER_LABELS[pref.trigger];
              return (
                <div
                  key={pref.trigger}
                  className="flex items-start justify-between gap-4 rounded-md border border-border p-4"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 font-medium">
                      {meta.title}
                      {pref.locked && <Lock className="h-4 w-4 text-muted-foreground" aria-hidden />}
                    </div>
                    <p className="text-sm text-muted-foreground">{meta.description}</p>
                    {pref.locked && (
                      <p className="text-xs text-muted-foreground">
                        Locked by an administrator — you can’t change this.
                      </p>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant={pref.enabled ? 'default' : 'outline'}
                    disabled={pref.locked || pending === pref.trigger}
                    onClick={() => void toggle(pref)}
                    aria-pressed={pref.enabled}
                  >
                    {pref.enabled ? 'On' : 'Off'}
                  </Button>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {user.role === 'admin' && <PolicyControls onChanged={() => void load()} />}
    </div>
  );
}

/**
 * Admin-only org-wide policy controls (TDD §5.2). For each trigger the admin sets the
 * global default (applies when a user has no preference of their own), an optional
 * forced override, and a lock. A locked override wins over every user's choice and
 * disables their toggle.
 */
function PolicyControls({ onChanged }: { onChanged: () => void }) {
  const [policies, setPolicies] = useState<EmailPolicyDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<EmailTrigger | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPolicies(await api.get<EmailPolicyDto[]>('/notifications/policies'));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load policies.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (trigger: EmailTrigger, patch: Partial<UpdatePolicyRequest>) => {
    const current = policies.find((p) => p.trigger === trigger);
    if (!current) return;
    const payload: UpdatePolicyRequest = {
      globalDefault: current.globalDefault,
      overrideEnabled: current.overrideEnabled,
      locked: current.locked,
      ...patch,
    };
    setPending(trigger);
    setError(null);
    try {
      const next = await api.patch<EmailPolicyDto[]>(
        `/notifications/policies/${trigger}`,
        payload,
      );
      setPolicies(next);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the policy.');
    } finally {
      setPending(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Organization policies</CardTitle>
        <CardDescription>
          Set the default for everyone, force a value, or lock a notification so users
          can’t change it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          policies.map((p) => {
            const busy = pending === p.trigger;
            return (
              <div key={p.trigger} className="space-y-3 rounded-md border border-border p-4">
                <div className="font-medium">{TRIGGER_LABELS[p.trigger].title}</div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Default for everyone:</span>
                  <Button
                    type="button"
                    size="sm"
                    variant={p.globalDefault ? 'default' : 'outline'}
                    disabled={busy}
                    onClick={() => void save(p.trigger, { globalDefault: !p.globalDefault })}
                  >
                    {p.globalDefault ? 'On' : 'Off'}
                  </Button>

                  <span className="ml-4 text-muted-foreground">Forced override:</span>
                  <Button
                    type="button"
                    size="sm"
                    variant={p.overrideEnabled === true ? 'default' : 'outline'}
                    disabled={busy}
                    onClick={() => void save(p.trigger, { overrideEnabled: true })}
                  >
                    On
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={p.overrideEnabled === false ? 'default' : 'outline'}
                    disabled={busy}
                    onClick={() => void save(p.trigger, { overrideEnabled: false })}
                  >
                    Off
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={p.overrideEnabled === null ? 'secondary' : 'ghost'}
                    disabled={busy}
                    onClick={() => void save(p.trigger, { overrideEnabled: null })}
                  >
                    None
                  </Button>

                  <Button
                    type="button"
                    size="sm"
                    variant={p.locked ? 'destructive' : 'outline'}
                    disabled={busy}
                    className={cn('ml-4 gap-1')}
                    onClick={() => void save(p.trigger, { locked: !p.locked })}
                  >
                    <Lock className="h-3.5 w-3.5" aria-hidden />
                    {p.locked ? 'Locked' : 'Lock'}
                  </Button>
                </div>
                {p.locked && p.overrideEnabled === null && (
                  <p className="text-xs text-muted-foreground">
                    Locked, but no forced value is set — the lock only prevents users from
                    editing; choose On or Off to force a value.
                  </p>
                )}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
