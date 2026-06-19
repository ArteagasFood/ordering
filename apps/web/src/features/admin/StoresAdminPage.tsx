import { useState } from 'react';
import { Store as StoreIcon, Plus, Power, Save } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { StoreDto, CreateStoreRequest, UpdateStoreRequest } from '@panaderia/shared';
import { AdminGate } from './AdminGate';
import { useResource } from './useResource';

/**
 * Store administration (TDD §5.1, §6.2). The admin lists every store (active and
 * inactive), creates new ones, toggles the three capabilities (bake / sell / buy),
 * sets the producer cutoff, and soft-deactivates a store. The cutoff shown is the
 * RESOLVED effective value from the server; an admin-locked cutoff is surfaced as such.
 */

/** A labeled checkbox for a store capability toggle. */
function CapabilityToggle(props: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        className="h-4 w-4 accent-primary"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      {props.label}
    </label>
  );
}

/** The create-store form. Capabilities default to a buyer (the common case). */
function CreateStoreForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState<CreateStoreRequest>({
    name: '',
    canBake: false,
    canSell: false,
    canBuy: true,
    cutoffTime: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const payload: CreateStoreRequest = {
        name: form.name,
        canBake: form.canBake,
        canSell: form.canSell,
        canBuy: form.canBuy,
        // Omit an empty cutoff so the store inherits the global default.
        ...(form.cutoffTime ? { cutoffTime: form.cutoffTime } : {}),
      };
      await api.post<StoreDto>('/stores', payload);
      setForm({ name: '', canBake: false, canSell: false, canBuy: true, cutoffTime: '' });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the store.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Plus className="h-4 w-4" /> Add a store
        </CardTitle>
        <CardDescription>A new store can buy by default; enable baking to let it produce.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="new-store-name">Store name</Label>
            <Input
              id="new-store-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Panadería Centro"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-store-cutoff">Cutoff time (optional)</Label>
            <Input
              id="new-store-cutoff"
              type="time"
              value={form.cutoffTime ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, cutoffTime: e.target.value }))}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-6">
          <CapabilityToggle label="Can bake" checked={form.canBake} onChange={(v) => setForm((f) => ({ ...f, canBake: v }))} />
          <CapabilityToggle label="Can sell" checked={form.canSell} onChange={(v) => setForm((f) => ({ ...f, canSell: v }))} />
          <CapabilityToggle label="Can buy" checked={form.canBuy} onChange={(v) => setForm((f) => ({ ...f, canBuy: v }))} />
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button onClick={submit} disabled={busy || !form.name.trim()}>
          {busy ? 'Adding…' : 'Add store'}
        </Button>
      </CardContent>
    </Card>
  );
}

/** A single editable store row. */
function StoreRow({ store, onChanged }: { store: StoreDto; onChanged: () => void }) {
  const [draft, setDraft] = useState<StoreDto>(store);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const dirty =
    draft.name !== store.name ||
    draft.canBake !== store.canBake ||
    draft.canSell !== store.canSell ||
    draft.canBuy !== store.canBuy ||
    draft.cutoffTime !== store.cutoffTime;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const patch: UpdateStoreRequest = {
        name: draft.name,
        canBake: draft.canBake,
        canSell: draft.canSell,
        canBuy: draft.canBuy,
        cutoffTime: draft.cutoffTime,
      };
      await api.patch<StoreDto>(`/stores/${store.id}`, patch);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save changes.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive() {
    setBusy(true);
    setError(null);
    try {
      if (store.active) {
        await api.del<StoreDto>(`/stores/${store.id}`);
      } else {
        await api.patch<StoreDto>(`/stores/${store.id}`, { active: true } satisfies UpdateStoreRequest);
      }
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change status.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className={cn(!store.active && 'opacity-60')}>
      <CardContent className="space-y-4 pt-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`name-${store.id}`}>Name</Label>
            <Input
              id={`name-${store.id}`}
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`cutoff-${store.id}`}>
              Cutoff time {store.cutoffLocked && <span className="text-muted-foreground">(locked by admin)</span>}
            </Label>
            <Input
              id={`cutoff-${store.id}`}
              type="time"
              value={draft.cutoffTime}
              disabled={store.cutoffLocked}
              onChange={(e) => setDraft((d) => ({ ...d, cutoffTime: e.target.value }))}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <CapabilityToggle label="Can bake" checked={draft.canBake} onChange={(v) => setDraft((d) => ({ ...d, canBake: v }))} />
          <CapabilityToggle label="Can sell" checked={draft.canSell} onChange={(v) => setDraft((d) => ({ ...d, canSell: v }))} />
          <CapabilityToggle label="Can buy" checked={draft.canBuy} onChange={(v) => setDraft((d) => ({ ...d, canBuy: v }))} />
          {!store.active && <span className="text-xs font-medium text-destructive">Inactive</span>}
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button size="sm" onClick={save} disabled={busy || !dirty || !draft.name.trim()}>
            <Save className="h-4 w-4" /> Save
          </Button>
          <Button
            size="sm"
            variant={store.active ? 'destructive' : 'secondary'}
            onClick={toggleActive}
            disabled={busy}
          >
            <Power className="h-4 w-4" /> {store.active ? 'Deactivate' : 'Reactivate'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function StoresAdminPage() {
  const { data, loading, error, reload } = useResource<StoreDto[]>('/stores');

  return (
    <AdminGate>
      <div className="space-y-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <StoreIcon className="h-6 w-6 text-primary" /> Stores
          </h1>
          <p className="text-muted-foreground">Manage stores, their capabilities, and order cutoffs.</p>
        </div>

        <CreateStoreForm onCreated={reload} />

        {loading && <p className="text-sm text-muted-foreground">Loading stores…</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        <div className="space-y-4">
          {data?.map((s) => <StoreRow key={s.id} store={s} onChanged={reload} />)}
          {data && data.length === 0 && <p className="text-sm text-muted-foreground">No stores yet.</p>}
        </div>
      </div>
    </AdminGate>
  );
}
