import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api-client';

/**
 * A tiny read-and-reload hook for an admin list resource. It owns the three states every
 * admin table needs — loading, error, and data — and exposes `reload` so a mutation can
 * re-fetch the canonical list rather than optimistically guessing the new state. Keeping
 * this slice-local (per the slice guide) avoids pulling in a data-fetching dependency for
 * three simple admin screens.
 *
 * @param path the API path to GET (e.g. '/stores'); relative to the api-client base.
 */
export function useResource<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<T>(path));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, loading, error, reload, setError } as const;
}
