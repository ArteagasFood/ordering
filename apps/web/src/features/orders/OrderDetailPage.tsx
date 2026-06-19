import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Snowflake } from 'lucide-react';
import { useAuth } from '@/lib/auth-store';
import { ApiError } from '@/lib/api-client';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCents } from '@/lib/utils';
import type { OrderDto, EditOrderRequest } from '@panaderia/shared';
import { ordersApi } from './orders-api';
import { StatusBadge, ShortedBadge, isBuyer, isProducer } from './order-ui';

/**
 * OrderDetailPage (TDD §8, §17) — view an order and edit it freely until it freezes.
 * Editing replaces line quantities (re-snapshotting prices server-side). A producer can
 * freeze the order at cutoff, behind a clear confirmation since the freeze is
 * irreversible for buyers (TDD §17 "forgiving by design"). Once received, the page shows
 * the confirmed counts with an obvious shorted indicator.
 */
export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const user = useAuth((s) => s.user);
  const [order, setOrder] = useState<OrderDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);

  const reload = (orderId: string) => {
    setLoading(true);
    ordersApi
      .get(orderId)
      .then(setOrder)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load the order.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (id) reload(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading && !order) return <p className="text-sm text-muted-foreground">Loading order…</p>;
  if (error && !order) return <p className="text-sm text-destructive">{error}</p>;
  if (!order || !id) return null;

  const storeId = user?.storeId ?? null;
  const buyer = isBuyer(order, storeId) || user?.role === 'admin';
  const producer = isProducer(order, storeId) || user?.role === 'admin';
  const canEdit = order.status === 'open' && buyer;
  const canFreeze = order.status === 'open' && producer;
  const canReceive = order.status === 'frozen' && buyer;

  const beginEdit = () => {
    const next: Record<string, number> = {};
    for (const line of order.lines) next[line.catalogItemId] = line.orderedQty;
    setDraft(next);
    setEditing(true);
  };

  const saveEdit = async () => {
    const lines = Object.entries(draft)
      .map(([catalogItemId, orderedQty]) => ({ catalogItemId, orderedQty: Math.max(0, orderedQty) }))
      .filter((l) => l.orderedQty > 0);
    if (lines.length === 0) {
      setError('An order needs at least one line.');
      return;
    }
    setBusy(true);
    setError(null);
    const req: EditOrderRequest = { lines };
    try {
      const updated = await ordersApi.edit(id, req);
      setOrder(updated);
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save changes.');
    } finally {
      setBusy(false);
    }
  };

  const freeze = async () => {
    if (!window.confirm('Freeze this order? Buyers will no longer be able to edit it.')) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await ordersApi.freeze(id);
      setOrder(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not freeze the order.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">Order · {order.serviceDay}</h1>
            <StatusBadge status={order.status} />
          </div>
          <p className="text-muted-foreground">
            {order.buyerStoreName} ordering from {order.producerStoreName}
          </p>
        </div>
        <div className="flex gap-2">
          {canReceive && (
            <Link to={`/orders/${order.id}/receive`} className={buttonVariants({ size: 'lg' })}>
              Receive delivery
            </Link>
          )}
          {canFreeze && (
            <Button variant="secondary" size="lg" disabled={busy} onClick={freeze}>
              <Snowflake className="h-5 w-5" /> Freeze order
            </Button>
          )}
          {canEdit && !editing && (
            <Button variant="outline" size="lg" onClick={beginEdit}>
              Edit quantities
            </Button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Lines</CardTitle>
          <CardDescription>
            {editing
              ? 'Adjust quantities; saving re-prices the order at the current menu prices.'
              : 'Prices are snapshotted at the moment the order was placed.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-4 font-medium">Item</th>
                  <th className="py-2 pr-4 text-right font-medium">Ordered</th>
                  <th className="py-2 pr-4 text-right font-medium">Received</th>
                  <th className="py-2 pr-4 text-right font-medium">Unit</th>
                  <th className="py-2 pr-4 text-right font-medium">Line total</th>
                </tr>
              </thead>
              <tbody>
                {order.lines.map((line) => (
                  <tr key={line.id} className="border-b last:border-0">
                    <td className="py-3 pr-4 font-medium">{line.catalogItemName}</td>
                    <td className="py-3 pr-4 text-right tabular-nums">
                      {editing ? (
                        <input
                          type="number"
                          min={0}
                          value={draft[line.catalogItemId] ?? 0}
                          onChange={(e) =>
                            setDraft((p) => ({
                              ...p,
                              [line.catalogItemId]: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                            }))
                          }
                          className="h-10 w-20 rounded-md border border-input bg-card px-2 text-center tabular-nums"
                          aria-label={`Quantity of ${line.catalogItemName}`}
                        />
                      ) : (
                        line.orderedQty
                      )}
                    </td>
                    <td className="py-3 pr-4 text-right tabular-nums">
                      <span className="inline-flex items-center gap-2">
                        {line.receivedQty ?? '—'}
                        <ShortedBadge ordered={line.orderedQty} received={line.receivedQty} />
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-right tabular-nums text-muted-foreground">
                      {formatCents(line.unitPriceSnapshotCents)}
                    </td>
                    <td className="py-3 pr-4 text-right tabular-nums">
                      {formatCents(line.lineTotalCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t">
                  <td className="py-3 pr-4 font-semibold" colSpan={4}>
                    Total
                  </td>
                  <td className="py-3 pr-4 text-right font-semibold tabular-nums">
                    {formatCents(order.totalCents)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {editing && (
            <div className="mt-4 flex gap-2">
              <Button disabled={busy} onClick={saveEdit}>
                {busy ? 'Saving…' : 'Save changes'}
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
