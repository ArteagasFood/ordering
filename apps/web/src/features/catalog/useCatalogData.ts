import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import type {
  CatalogItemDto,
  CategoryDto,
  DepartmentDto,
  ProductTypeDto,
} from '@panaderia/shared';

/**
 * Small data hooks for the catalog & taxonomy feature. Each owns one resource's
 * fetch/loading/error state and exposes a `reload` so a successful create/edit can
 * refresh the list. Kept inside the feature folder (slice-local state) per the slice
 * guide; the SPA has no global query cache.
 */

interface Resource<T> {
  data: T;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

function useResource<T>(path: string, initial: T): Resource<T> {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<T>(path));
    } catch {
      setError('Could not load data. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, loading, error, reload };
}

export const useCatalogItems = (includeInactive = false): Resource<CatalogItemDto[]> =>
  useResource<CatalogItemDto[]>(
    includeInactive ? '/catalog?includeInactive=true' : '/catalog',
    [],
  );

export const useProductTypes = (): Resource<ProductTypeDto[]> =>
  useResource<ProductTypeDto[]>('/product-types', []);

export const useDepartments = (): Resource<DepartmentDto[]> =>
  useResource<DepartmentDto[]>('/taxonomy/departments', []);

export const useCategories = (): Resource<CategoryDto[]> =>
  useResource<CategoryDto[]>('/taxonomy/categories', []);
