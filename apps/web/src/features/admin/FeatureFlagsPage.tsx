import { useState } from 'react';
import { Flag, Plus } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import type { FeatureFlagDto, CreateFlagRequest, UpdateFlagRequest } from '@panaderia/shared';
import { AdminGate } from './AdminGate';
import { useResource } from './useResource';

/**
 * Feature-flag administration (TDD §6.1). A first-class, admin-only registry that gates
 * application capabilities. The admin registers a flag by key, writes a short
 * description, and toggles it on or off. Flags never govern catalog or menu structure.
 */

function CreateFlagForm({ onCreated }: { onCreated: () => void }) {
  const [key, setKey] = useState('');
  const [description, setDescription] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.post<FeatureFlagDto>('/flags', { key, description, enabled } satisfies CreateFlagRequest);
      setKey('');
      setDescription('');
      setEnabled(false);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the flag.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Plus className="h-4 w-4" /> Register a flag
        </CardTitle>
        <CardDescription>Keys use lowercase letters, digits, dots, and underscores.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="nf-key">Key</Label>
            <Input
              id="nf-key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="reconciliation.digest"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nf-desc">Description</Label>
            <Input
              id="nf-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this flag controls"
            />
          </div>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Enabled
        </label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button onClick={submit} disabled={busy || !key.trim()}>
          {busy ? 'Registering…' : 'Register flag'}
        </Button>
      </CardContent>
    </Card>
  );
}

function FlagRow({ flag, onChanged }: { flag: FeatureFlagDto; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      await api.patch<FeatureFlagDto>(`/flags/${flag.id}`, {
        enabled: !flag.enabled,
      } satisfies UpdateFlagRequest);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not toggle the flag.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm font-medium">{flag.key}</code>
            <span
              className={
                flag.enabled
                  ? 'text-xs font-medium text-primary'
                  : 'text-xs font-medium text-muted-foreground'
              }
            >
              {flag.enabled ? 'On' : 'Off'}
            </span>
          </div>
          {flag.description && <p className="text-sm text-muted-foreground">{flag.description}</p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <Button
          size="sm"
          variant={flag.enabled ? 'destructive' : 'default'}
          onClick={toggle}
          disabled={busy}
        >
          {flag.enabled ? 'Turn off' : 'Turn on'}
        </Button>
      </CardContent>
    </Card>
  );
}

export function FeatureFlagsPage() {
  const { data, loading, error, reload } = useResource<FeatureFlagDto[]>('/flags');

  return (
    <AdminGate>
      <div className="space-y-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Flag className="h-6 w-6 text-primary" /> Feature flags
          </h1>
          <p className="text-muted-foreground">Turn application capabilities on or off.</p>
        </div>

        <CreateFlagForm onCreated={reload} />

        {loading && <p className="text-sm text-muted-foreground">Loading flags…</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        <div className="space-y-4">
          {data?.map((f) => <FlagRow key={f.id} flag={f} onChanged={reload} />)}
          {data && data.length === 0 && <p className="text-sm text-muted-foreground">No flags registered yet.</p>}
        </div>
      </div>
    </AdminGate>
  );
}
