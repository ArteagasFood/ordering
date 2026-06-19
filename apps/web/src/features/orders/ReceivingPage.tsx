import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check } from 'lucide-react';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCents } from '@/lib/utils';
import type { OrderDto, ReceiveOrderRequest } from '@panaderia/shared';
import { ordersApi } from './orders-api';
import { ShortedBadge } from './order-ui';

/**
 * ReceivingPage (TDD §10.1, §17.2) — built for the loading dock. Each line gets a big
 * count input pre-filled with what was ordered (the most common case is "all arrived"),
 * so confirming is one motion. The shorted indicator makes a shortfall obvious before
 * the user confirms. The buyer's confirmed counts become the billable quantities, and a
 * large variance is auto-flagged server-side for reconciliation.
 */
export function ReceivingPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [order, setOrder] = useState<OrderDto | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    ordersApi
      .get(id)
      .then((o) => {
        if (cancelled) return;
        setOrder(o);
        // Default each received count to what was ordered — the common "all arrived" case.
        const seed: Record<string, number> = {};
        for (const line of o.lines) seed[line.id] = line.receivedQty ?? line.orderedQty;
        setCounts(seed);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Could not load the order.'),
      )
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading && !order) return <p className="text-sm text-muted-foreground">Loading delivery…</p>;
  if (!order || !id) return error ? <p className="text-sm text-destructive">{error}</p> : null;

  const confirm = async () => {
    if (!window.confirm('Confirm these received counts? They become the billable quantities.')) {
      return;
    }
    setSubmitting(true);
    setError(null);
    const req: ReceiveOrderRequest = {
      lines: order.lines.map((line) => ({
        lineId: line.id,
        receivedQty: Math.max(0, counts[line.id] ?? 0),
      })),
    };
    try {
      await ordersApi.receive(id, req);
      navigate(`/orders/${id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not confirm the delivery.');
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Receive delivery</h1>
        <p className="text-muted-foreground">
          {order.producerStoreName} → {order.buyerStoreName} · {order.serviceDay}
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Count what arrived</CardTitle>
          <CardDescription>
            Each box is pre-filled with what was ordered. Change it only where the count differs.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {order.lines.map((line) => {
            const received = counts[line.id] ?? 0;
            return (
              <div
                key={line.id}
                className="flex items-center justify-between gap-4 rounded-md border p-4"
              >
                <div>
                  <div className="text-lg font-medium">{line.catalogItemName}</div>
                  <div className="text-sm text-muted-foreground">Ordered {line.orderedQty}</div>
                </div>
                <div className="flex items-center gap-4">
                  <ShortedBadge ordered={line.orderedQty} received={received} />
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={received}
                    onChange={(e) =>
                      setCounts((p) => ({
                        ...p,
                        [line.id]: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                      }))
                    }
                    className="h-16 w-28 rounded-md border-2 border-input bg-card px-3 text-center text-2xl font-semibold tabular-nums"
                    aria-label={`Received count for ${line.catalogItemName}`}
                  />
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <div className="sticky bottom-0 flex items-center justify-end gap-3 rounded-md border bg-card p-4 shadow-sm">
        <Button
          variant="outline"
          size="lg"
          disabled={submitting}
          onClick={() => navigate(`/orders/${id}`)}
        >
          Cancel
        </Button>
        <Button size="lg" disabled={submitting} onClick={confirm}>
          <Check className="h-5 w-5" /> {submitting ? 'Confirming…' : 'Confirm received'}
        </Button>
      </div>
    </div>
  );
}
