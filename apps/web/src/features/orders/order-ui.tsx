import { cn } from '@/lib/utils';
import type { OrderStatus, OrderDto } from '@panaderia/shared';

/**
 * Small presentational helpers shared across the orders screens. Keeping the
 * status vocabulary and the shorted indicator in one place ensures the bakery
 * language (TDD §17 "speak the user's language") is consistent everywhere.
 */

const STATUS_LABEL: Record<OrderStatus, string> = {
  open: 'Open',
  frozen: 'Frozen',
  received: 'Received',
};

const STATUS_CLASS: Record<OrderStatus, string> = {
  open: 'border-primary/30 bg-primary/10 text-primary',
  frozen: 'border-amber-500/30 bg-amber-500/10 text-amber-700',
  received: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700',
};

export function StatusBadge({ status, className }: { status: OrderStatus; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
        STATUS_CLASS[status],
        className,
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

/**
 * The shorted indicator (TDD §17.2): when a line received fewer than ordered, surface
 * the shortfall plainly. Returns null when nothing is short or not yet received.
 */
export function ShortedBadge({ ordered, received }: { ordered: number; received: number | null }) {
  if (received == null) return null;
  const variance = received - ordered;
  if (variance === 0) return null;
  const short = variance < 0;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold',
        short
          ? 'border-destructive/40 bg-destructive/10 text-destructive'
          : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700',
      )}
    >
      {short ? `Short ${Math.abs(variance)}` : `Over ${variance}`}
    </span>
  );
}

/** True when the signed-in user's store is the buyer on this order (may edit/receive). */
export function isBuyer(order: OrderDto, storeId: string | null): boolean {
  return storeId != null && order.buyerStoreId === storeId;
}

/** True when the signed-in user's store is the producer on this order (may freeze). */
export function isProducer(order: OrderDto, storeId: string | null): boolean {
  return storeId != null && order.producerStoreId === storeId;
}
