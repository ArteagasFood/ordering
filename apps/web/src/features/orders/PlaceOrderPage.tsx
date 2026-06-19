import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { formatCents } from '@/lib/utils';
import type { StoreDto, StoreMenuItemDto, PlaceOrderRequest } from '@panaderia/shared';
import { ordersApi } from './orders-api';
import { CutoffCountdown } from './CutoffCountdown';

/**
 * PlaceOrderPage (TDD §8.1, §17) — the buyer's order-entry screen. The flow is the
 * obvious common path: pick a producer, pick a service day, then enter a quantity per
 * orderable item with a running total and the deadline always shown. Quantities default
 * to 0; only positive lines are submitted. The cutoff countdown reassures the user about
 * the deadline rather than punishing them for it.
 */
export function PlaceOrderPage() {
  const navigate = useNavigate();

  const [producers, setProducers] = useState<StoreDto[]>([]);
  const [producerId, setProducerId] = useState('');
  const [serviceDay, setServiceDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [items, setItems] = useState<StoreMenuItemDto[]>([]);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [loadingItems, setLoadingItems] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const producer = producers.find((p) => p.id === producerId) ?? null;

  // Load the producing stores the buyer may order from.
  useEffect(() => {
    ordersApi
      .producers()
      .then(setProducers)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Could not load producers.'),
      );
  }, []);

  // When a producer is chosen, load its orderable items and reset quantities.
  useEffect(() => {
    if (!producerId) {
      setItems([]);
      setQty({});
      return;
    }
    let cancelled = false;
    setLoadingItems(true);
    setError(null);
    ordersApi
      .orderableItems(producerId)
      .then((rows) => {
        if (cancelled) return;
        setItems(rows.filter((r) => r.orderable));
        setQty({});
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load items.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingItems(false);
      });
    return () => {
      cancelled = true;
    };
  }, [producerId]);

  const lines = useMemo(
    () =>
      items
        .map((it) => ({ item: it, orderedQty: qty[it.catalogItemId] ?? 0 }))
        .filter((l) => l.orderedQty > 0),
    [items, qty],
  );

  const runningTotalCents = lines.reduce(
    (sum, l) => sum + l.orderedQty * l.item.effectivePriceCents,
    0,
  );

  const setItemQty = (catalogItemId: string, value: number) => {
    setQty((prev) => ({ ...prev, [catalogItemId]: Math.max(0, Math.floor(value || 0)) }));
  };

  const submit = async () => {
    if (!producerId || lines.length === 0) return;
    setSubmitting(true);
    setError(null);
    const req: PlaceOrderRequest = {
      producerStoreId: producerId,
      serviceDay,
      lines: lines.map((l) => ({ catalogItemId: l.item.catalogItemId, orderedQty: l.orderedQty })),
    };
    try {
      const order = await ordersApi.place(req);
      navigate(`/orders/${order.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not place the order.');
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">New order</h1>
          <p className="text-muted-foreground">Pick a bakery and a day, then enter quantities.</p>
        </div>
        {producer && <CutoffCountdown cutoffTime={producer.cutoffTime} label={`${producer.name} cutoff`} />}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Where and when</CardTitle>
          <CardDescription>The producing store and the service day for this order.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-6">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="producer">Bakery</Label>
            <select
              id="producer"
              value={producerId}
              onChange={(e) => setProducerId(e.target.value)}
              className="h-12 min-w-56 rounded-md border border-input bg-card px-3 text-base"
            >
              <option value="">Choose a bakery…</option>
              {producers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="serviceDay">Service day</Label>
            <input
              id="serviceDay"
              type="date"
              value={serviceDay}
              onChange={(e) => setServiceDay(e.target.value)}
              className="h-12 rounded-md border border-input bg-card px-3 text-base"
            />
          </div>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {producerId && (
        <Card>
          <CardHeader>
            <CardTitle>What to order</CardTitle>
            <CardDescription>
              Enter how many of each item. Items default to none — only what you enter is ordered.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingItems && <p className="text-sm text-muted-foreground">Loading items…</p>}
            {!loadingItems && items.length === 0 && (
              <p className="text-sm text-muted-foreground">This bakery has no orderable items right now.</p>
            )}
            {!loadingItems && items.length > 0 && (
              <div className="space-y-2">
                {items.map((it) => (
                  <div
                    key={it.catalogItemId}
                    className="flex items-center justify-between gap-4 rounded-md border p-3"
                  >
                    <div>
                      <div className="font-medium">{it.catalogItemName}</div>
                      <div className="text-sm text-muted-foreground">
                        {formatCents(it.effectivePriceCents)} each
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        value={qty[it.catalogItemId] ?? 0}
                        onChange={(e) => setItemQty(it.catalogItemId, Number(e.target.value))}
                        className="h-12 w-24 rounded-md border border-input bg-card px-3 text-center text-lg tabular-nums"
                        aria-label={`Quantity of ${it.catalogItemName}`}
                      />
                      <div className="w-24 text-right tabular-nums text-muted-foreground">
                        {formatCents((qty[it.catalogItemId] ?? 0) * it.effectivePriceCents)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="sticky bottom-0 flex items-center justify-between gap-4 rounded-md border bg-card p-4 shadow-sm">
        <div className="text-lg">
          <span className="text-muted-foreground">Running total: </span>
          <span className="font-semibold tabular-nums">{formatCents(runningTotalCents)}</span>
          <span className="ml-2 text-sm text-muted-foreground">
            ({lines.length} item{lines.length === 1 ? '' : 's'})
          </span>
        </div>
        <Button size="lg" disabled={!producerId || lines.length === 0 || submitting} onClick={submit}>
          {submitting ? 'Placing…' : 'Place order'}
        </Button>
      </div>
    </div>
  );
}
