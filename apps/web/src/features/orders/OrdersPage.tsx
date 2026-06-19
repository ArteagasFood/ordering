import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, RefreshCw } from 'lucide-react';
import { useAuth } from '@/lib/auth-store';
import { ApiError } from '@/lib/api-client';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { formatCents } from '@/lib/utils';
import type { OrderDto, OrderStatus } from '@panaderia/shared';
import { ordersApi, type ListOrdersParams } from './orders-api';
import { StatusBadge } from './order-ui';

/**
 * OrdersPage (TDD §8, §17) — the daily list of a user's orders. A store user sees the
 * orders where their store is the buyer or the producer; global roles (Admin/AP) see
 * all. Buyers get a prominent "New order" action — the common path made obvious. Light
 * filters (service day, status, role) let a busy user narrow to today's work fast.
 */
export function OrdersPage() {
  const user = useAuth((s) => s.user);
  const [orders, setOrders] = useState<OrderDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [serviceDay, setServiceDay] = useState('');
  const [status, setStatus] = useState<OrderStatus | ''>('');
  const [role, setRole] = useState<'' | 'buyer' | 'producer'>('');

  const canBuy = user?.role === 'store_user' || user?.role === 'admin';

  const params: ListOrdersParams = useMemo(
    () => ({
      serviceDay: serviceDay || undefined,
      status: status || undefined,
      role: role || undefined,
    }),
    [serviceDay, status, role],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    ordersApi
      .list(params)
      .then((rows) => {
        if (!cancelled) setOrders(rows);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load orders.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [params]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Orders</h1>
          <p className="text-muted-foreground">Your daily orders — place, freeze, and receive.</p>
        </div>
        {canBuy && (
          <Link to="/orders/new" className={buttonVariants({ size: 'lg' })}>
            <Plus className="h-5 w-5" /> New order
          </Link>
        )}
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-end gap-4 space-y-0">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Service day</span>
            <input
              type="date"
              value={serviceDay}
              onChange={(e) => setServiceDay(e.target.value)}
              className="h-10 rounded-md border border-input bg-card px-3 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Status</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as OrderStatus | '')}
              className="h-10 rounded-md border border-input bg-card px-3 text-sm"
            >
              <option value="">All</option>
              <option value="open">Open</option>
              <option value="frozen">Frozen</option>
              <option value="received">Received</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">My role</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as '' | 'buyer' | 'producer')}
              className="h-10 rounded-md border border-input bg-card px-3 text-sm"
            >
              <option value="">Buyer &amp; producer</option>
              <option value="buyer">As buyer</option>
              <option value="producer">As producer</option>
            </select>
          </label>
          <Button
            variant="outline"
            onClick={() => {
              setServiceDay('');
              setStatus('');
              setRole('');
            }}
          >
            <RefreshCw className="h-4 w-4" /> Clear
          </Button>
        </CardHeader>
        <CardContent>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {loading && <p className="text-sm text-muted-foreground">Loading orders…</p>}
          {!loading && !error && orders.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No orders yet.{' '}
              {canBuy && (
                <Link to="/orders/new" className="font-medium text-primary underline">
                  Place your first order.
                </Link>
              )}
            </p>
          )}
          {!loading && orders.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-2 pr-4 font-medium">Service day</th>
                    <th className="py-2 pr-4 font-medium">Buyer</th>
                    <th className="py-2 pr-4 font-medium">Producer</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 pr-4 text-right font-medium">Total</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id} className="border-b last:border-0">
                      <td className="py-3 pr-4 font-medium">{o.serviceDay}</td>
                      <td className="py-3 pr-4">{o.buyerStoreName}</td>
                      <td className="py-3 pr-4">{o.producerStoreName}</td>
                      <td className="py-3 pr-4">
                        <StatusBadge status={o.status} />
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums">
                        {formatCents(o.totalCents)}
                      </td>
                      <td className="py-3 text-right">
                        <Link
                          to={`/orders/${o.id}`}
                          className="font-medium text-primary underline"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
