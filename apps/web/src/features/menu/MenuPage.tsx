import { useCallback, useEffect, useMemo, useState } from 'react';
import { Lock } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-store';
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
  StoreMenuItemDto,
  CatalogItemDto,
  CreateMenuItemRequest,
  UpdateMenuItemRequest,
} from '@panaderia/shared';

/**
 * Store menu manager (TDD §6.3, §7, §9.1). A store_user manages their OWN store's menu:
 * adds catalog items, and sets price, par, visibility, and availability date per item.
 *
 * Empathy (TDD §17): the effective price and a lock indicator are always shown; when an
 * admin has locked the price the price field is disabled, never a control that fails.
 * Money is displayed via `formatCents`; on the wire it stays integer cents.
 */
export function MenuPage() {
  const user = useAuth((s) => s.user);
  const storeId = user?.storeId ?? null;

  const [items, setItems] = useState<StoreMenuItemDto[]>([]);
  const [catalog, setCatalog] = useState<CatalogItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    setError(null);
    try {
      const [menu, cat] = await Promise.all([
        api.get<StoreMenuItemDto[]>(`/menu?storeId=${storeId}`),
        api.get<CatalogItemDto[]>('/catalog'),
      ]);
      setItems(menu);
      setCatalog(cat);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your menu.');
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Catalog items not yet on this store's menu — the only ones addable.
  const addable = useMemo(() => {
    const onMenu = new Set(items.map((i) => i.catalogItemId));
    return catalog.filter((c) => c.active && !onMenu.has(c.id));
  }, [catalog, items]);

  if (!storeId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Menu</CardTitle>
          <CardDescription>
            Only a store user can manage a store menu. Your account is not bound to a store.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Your menu</h1>
        <p className="text-muted-foreground">
          Set what {user?.storeName ?? 'your store'} offers, its price, par, and when it goes live.
        </p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <AddItemCard addable={addable} onAdded={load} />

      <div className="space-y-3">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing on your menu yet. Add a catalog item above to start selling it.
          </p>
        ) : (
          items.map((item) => <MenuItemRow key={item.id} item={item} onChanged={load} />)
        )}
      </div>
    </div>
  );
}

/** The "add a catalog item to my menu" form. */
function AddItemCard({
  addable,
  onAdded,
}: {
  addable: CatalogItemDto[];
  onAdded: () => Promise<void>;
}) {
  const [catalogItemId, setCatalogItemId] = useState('');
  const [priceDollars, setPriceDollars] = useState('');
  const [par, setPar] = useState('0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!catalogItemId) {
      setError('Pick an item to add.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload: CreateMenuItemRequest = {
        catalogItemId,
        categoryId: null,
        storePriceCents: priceDollars.trim() === '' ? null : dollarsToCents(priceDollars),
        visible: true,
        availableFrom: null,
        par: Number.parseInt(par, 10) || 0,
      };
      await api.post<StoreMenuItemDto>('/menu', payload);
      setCatalogItemId('');
      setPriceDollars('');
      setPar('0');
      await onAdded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add the item.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add an item</CardTitle>
        <CardDescription>Put a shared catalog item on your menu.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="add-item">Catalog item</Label>
            <select
              id="add-item"
              className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
              value={catalogItemId}
              onChange={(e) => setCatalogItemId(e.target.value)}
            >
              <option value="">Select an item…</option>
              {addable.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="add-price">Price ($)</Label>
            <Input
              id="add-price"
              type="number"
              step="0.01"
              min="0"
              placeholder="global"
              value={priceDollars}
              onChange={(e) => setPriceDollars(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="add-par">Par</Label>
            <Input
              id="add-par"
              type="number"
              min="0"
              value={par}
              onChange={(e) => setPar(e.target.value)}
            />
          </div>
          <Button onClick={() => void submit()} disabled={busy || addable.length === 0}>
            {busy ? 'Adding…' : 'Add'}
          </Button>
        </div>
        {addable.length === 0 && (
          <p className="mt-2 text-sm text-muted-foreground">
            Every active catalog item is already on your menu.
          </p>
        )}
        {error && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** A single editable menu row: price (lock-aware), par, visibility, availability date. */
function MenuItemRow({ item, onChanged }: { item: StoreMenuItemDto; onChanged: () => Promise<void> }) {
  const [priceDollars, setPriceDollars] = useState(
    item.storePriceCents == null ? '' : centsToDollars(item.storePriceCents),
  );
  const [par, setPar] = useState(String(item.par));
  const [visible, setVisible] = useState(item.visible);
  const [availableFrom, setAvailableFrom] = useState(item.availableFrom ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(patch: UpdateMenuItemRequest) {
    setBusy(true);
    setError(null);
    try {
      await api.patch<StoreMenuItemDto>(`/menu/${item.id}`, patch);
      await onChanged();
    } catch (err) {
      // A 409 means an admin lock fixes the price (TDD §7.1) — surface it plainly.
      setError(err instanceof ApiError ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Remove ${item.catalogItemName} from your menu?`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.del<void>(`/menu/${item.id}`);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove the item.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="font-medium">{item.catalogItemName}</span>
            {item.priceLocked && (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                <Lock className="h-3 w-3" aria-hidden /> Price locked by admin
              </span>
            )}
            {item.adminDisabled && (
              <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
                Disabled by admin
              </span>
            )}
          </div>
          <span className="text-sm text-muted-foreground">
            Effective: <span className="font-medium text-foreground">{formatCents(item.effectivePriceCents)}</span>
            {item.orderable ? '' : ' · not orderable'}
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor={`price-${item.id}`}>Your price ($)</Label>
            <Input
              id={`price-${item.id}`}
              type="number"
              step="0.01"
              min="0"
              placeholder="use global"
              value={priceDollars}
              disabled={item.priceLocked || busy}
              onChange={(e) => setPriceDollars(e.target.value)}
              onBlur={() => {
                if (item.priceLocked) return;
                const next = priceDollars.trim() === '' ? null : dollarsToCents(priceDollars);
                if (next !== item.storePriceCents) void save({ storePriceCents: next });
              }}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`par-${item.id}`}>Par</Label>
            <Input
              id={`par-${item.id}`}
              type="number"
              min="0"
              value={par}
              disabled={busy}
              onChange={(e) => setPar(e.target.value)}
              onBlur={() => {
                const next = Number.parseInt(par, 10) || 0;
                if (next !== item.par) void save({ par: next });
              }}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`from-${item.id}`}>Available from</Label>
            <Input
              id={`from-${item.id}`}
              type="date"
              value={availableFrom}
              disabled={busy}
              onChange={(e) => setAvailableFrom(e.target.value)}
              onBlur={() => {
                const next = availableFrom.trim() === '' ? null : availableFrom;
                if (next !== (item.availableFrom ?? null)) void save({ availableFrom: next });
              }}
            />
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={visible}
                disabled={busy}
                onChange={(e) => {
                  setVisible(e.target.checked);
                  void save({ visible: e.target.checked });
                }}
              />
              Visible
            </label>
            <Button variant="ghost" size="sm" onClick={() => void remove()} disabled={busy}>
              Remove
            </Button>
          </div>
        </div>

        {error && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** Convert a dollar string (e.g. "2.50") to integer cents, rounding to the nearest cent. */
function dollarsToCents(dollars: string): number {
  return Math.round(Number.parseFloat(dollars) * 100);
}

/** Convert integer cents to a plain dollar string for an editable field (no currency symbol). */
function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}
