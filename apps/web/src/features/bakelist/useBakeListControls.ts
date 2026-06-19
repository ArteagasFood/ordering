import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-store';
import type { StoreDto } from '@panaderia/shared';

/**
 * Shared controls for both bake-list views: which producing store and which service
 * day. The producer defaults to the logged-in store user's own store; a global role
 * (Admin/AP) gets a picker over all producing stores. The service day defaults to
 * today (TDD §17 — sensible defaults, the common path obvious).
 *
 * The store list comes from `GET /stores`, which the API already scopes by role — a
 * store user receives only their own store, so the picker collapses to that one store.
 * We surface only stores that `canBake`, since a non-producer has no bake list (§9).
 */
export interface BakeListControls {
  producerStoreId: string;
  setProducerStoreId: (id: string) => void;
  serviceDay: string;
  setServiceDay: (day: string) => void;
  /** Producing stores the user may view; empty until loaded. */
  producerStores: StoreDto[];
  /** True once the store user's single store has been resolved (no picker needed). */
  isSingleStore: boolean;
  storesError: string | null;
}

/** Today's date as a YYYY-MM-DD string in the user's local timezone. */
function todayIso(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function useBakeListControls(): BakeListControls {
  const user = useAuth((s) => s.user);
  const [producerStoreId, setProducerStoreId] = useState<string>(user?.storeId ?? '');
  const [serviceDay, setServiceDay] = useState<string>(todayIso());
  const [allStores, setAllStores] = useState<StoreDto[]>([]);
  const [storesError, setStoresError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<StoreDto[]>('/stores')
      .then((rows) => {
        if (cancelled) return;
        setAllStores(rows);
        // Default the producer to the only producing store we can see, if any and if
        // nothing is selected yet (covers both the single-store user and a global role
        // that happens to oversee exactly one producer).
        const producers = rows.filter((s) => s.canBake && s.active);
        setProducerStoreId((current) => current || (producers[0]?.id ?? ''));
      })
      .catch(() => {
        if (!cancelled) setStoresError('Could not load stores. Try again in a moment.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const producerStores = useMemo(
    () => allStores.filter((s) => s.canBake && s.active),
    [allStores],
  );

  return {
    producerStoreId,
    setProducerStoreId,
    serviceDay,
    setServiceDay,
    producerStores,
    isSingleStore: producerStores.length <= 1,
    storesError,
  };
}
