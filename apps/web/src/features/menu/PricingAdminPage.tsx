import { useCallback, useEffect, useMemo, useState } from 'react';
import { Lock } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { formatCents } from '@/lib/utils';
import type {
  StoreDto,
  CatalogItemDto,
  StoreMenuItemDto,
  SetGlobalPriceRequest,
  SetPriceOverrideRequest,
} from '@panaderia/shared';

/**
 * Admin pricing console (TDD §7.1, §16.2). Two governed controls:
 *
 *   1. Global default prices per catalog item — the fallback when a store sets none.
 *   2. Per-store price overrides — set with a REQUIRED reason and locked, so they win
 *      over the store price and prevent store edits. Every override change is audited.
 *
 * Admin-only; the integrator gates the route on role === 'admin', and this page never
 * renders for anyone else.
 */
export function PricingAdminPage() {
  const [catalog, setCatalog] = useState<CatalogItemDto[]>([]);
  const [stores, setStores] = useState<StoreDto[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [cat, sto] = await Promise.all([
        api.get<CatalogItemDto[]>('/catalog'),
        api.get<StoreDto[]>('/stores'),
      ]);
      setCatalog(cat.filter((c) => c.active));
      setStores(sto.filter((s) => s.active));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load pricing data.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Pricing</h1>
        <p className="text-muted-foreground">
          Set global default prices and lock per-store overrides. Overrides require a reason and
          are recorded in the audit log.
        </p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <GlobalPricesCard catalog={catalog} />
      <OverridesCard stores={stores} />
    </div>
  );
}

/** Set the admin global default price for any catalog item. */
function GlobalPricesCard({ catalog }: { catalog: CatalogItemDto[] }) {
  const [catalogItemId, setCatalogItemId] = useState('');
  const [priceDollars, setPriceDollars] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!catalogItemId || priceDollars.trim() === '') {
      setError('Pick an item and enter a price.');
      return;
    }
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const payload: SetGlobalPriceRequest = {
        catalogItemId,
        priceCents: dollarsToCents(priceDollars),
      };
      await api.post('/prices/global', payload);
      setNote('Global price saved.');
      setPriceDollars('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the global price.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Global default prices</CardTitle>
        <CardDescription>
          Used when a store sets no price of its own. A store price or a locked override still
          wins over this.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="gp-item">Catalog item</Label>
            <select
              id="gp-item"
              className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
              value={catalogItemId}
              onChange={(e) => setCatalogItemId(e.target.value)}
            >
              <option value="">Select an item…</option>
              {catalog.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gp-price">Price ($)</Label>
            <Input
              id="gp-price"
              type="number"
              step="0.01"
              min="0"
              value={priceDollars}
              onChange={(e) => setPriceDollars(e.target.value)}
            />
          </div>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? 'Saving…' : 'Save global price'}
          </Button>
        </div>
        {note && <p className="mt-2 text-sm text-muted-foreground">{note}</p>}
        {error && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** Set or clear a locked per-store override on a specific menu item, with a required reason. */
function OverridesCard({ stores }: { stores: StoreDto[] }) {
  const [storeId, setStoreId] = useState('');
  const [items, setItems] = useState<StoreMenuItemDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMenu = useCallback(async (id: string) => {
    if (!id) {
      setItems([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setItems(await api.get<StoreMenuItemDto[]>(`/menu?storeId=${id}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the store's menu.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMenu(storeId);
  }, [storeId, loadMenu]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Per-store price overrides</CardTitle>
        <CardDescription>
          A locked override fixes the price and prevents the store from editing it. Every change
          is audited with the reason you give.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5 sm:max-w-xs">
          <Label htmlFor="ov-store">Store</Label>
          <select
            id="ov-store"
            className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
          >
            <option value="">Select a store…</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {storeId && (
          <div className="space-y-3">
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : items.length === 0 ? (
              <p className="text-sm text-muted-foreground">This store has no menu items.</p>
            ) : (
              items.map((item) => (
                <OverrideRow key={item.id} item={item} onChanged={() => loadMenu(storeId)} />
              ))
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** One menu item with controls to set or clear its locked override. */
function OverrideRow({ item, onChanged }: { item: StoreMenuItemDto; onChanged: () => Promise<void> }) {
  const locked = item.priceLocked;
  const [priceDollars, setPriceDollars] = useState(
    locked ? centsToDollars(item.effectivePriceCents) : '',
  );
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setOverride() {
    if (priceDollars.trim() === '' || reason.trim() === '') {
      setError('A price and a reason are both required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload: SetPriceOverrideRequest = {
        storeMenuItemId: item.id,
        priceCents: dollarsToCents(priceDollars),
        reason: reason.trim(),
      };
      await api.post<StoreMenuItemDto>('/prices/override', payload);
      setReason('');
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not set the override.');
    } finally {
      setBusy(false);
    }
  }

  async function clearOverride() {
    setBusy(true);
    setError(null);
    try {
      await api.del<void>(`/prices/override/${item.id}`, {
        reason: reason.trim() || 'Override removed by admin.',
      });
      setReason('');
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not clear the override.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-input p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="font-medium">{item.catalogItemName}</span>
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          Effective {formatCents(item.effectivePriceCents)}
          {locked && (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
              <Lock className="h-3 w-3" aria-hidden /> locked
            </span>
          )}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor={`ov-price-${item.id}`}>Override ($)</Label>
          <Input
            id={`ov-price-${item.id}`}
            type="number"
            step="0.01"
            min="0"
            value={priceDollars}
            onChange={(e) => setPriceDollars(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`ov-reason-${item.id}`}>Reason (required)</Label>
          <Input
            id={`ov-reason-${item.id}`}
            value={reason}
            placeholder="Why this override?"
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <Button onClick={() => void setOverride()} disabled={busy}>
            {locked ? 'Update lock' : 'Lock price'}
          </Button>
          {locked && (
            <Button variant="ghost" onClick={() => void clearOverride()} disabled={busy}>
              Clear
            </Button>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** Convert a dollar string (e.g. "2.50") to integer cents, rounding to the nearest cent. */
function dollarsToCents(dollars: string): number {
  return Math.round(Number.parseFloat(dollars) * 100);
}

/** Convert integer cents to a plain dollar string for an editable field. */
function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}
