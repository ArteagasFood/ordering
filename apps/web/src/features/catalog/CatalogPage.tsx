import { useMemo, useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { Plus, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { CatalogItemDto, CreateCatalogItemRequest } from '@panaderia/shared';
import { useCatalogItems, useProductTypes } from './useCatalogData';

/**
 * CatalogPage (TDD §5.3). Browses the shared, immediately-global catalog grouped by
 * product type. Any authenticated user may add a new item via the dialog; the server
 * attributes it to the user's store automatically. The catalog is intentionally not
 * store-scoped — everyone sees the same items.
 */

interface Group {
  productTypeId: string;
  productTypeName: string;
  items: CatalogItemDto[];
}

/** Group items by product type, groups by type name and items by item name. */
function groupByType(items: CatalogItemDto[]): Group[] {
  const byId = new Map<string, Group>();
  for (const item of items) {
    let g = byId.get(item.productTypeId);
    if (!g) {
      g = { productTypeId: item.productTypeId, productTypeName: item.productTypeName, items: [] };
      byId.set(item.productTypeId, g);
    }
    g.items.push(item);
  }
  const groups = [...byId.values()];
  for (const g of groups) g.items.sort((a, b) => a.name.localeCompare(b.name));
  groups.sort((a, b) => a.productTypeName.localeCompare(b.productTypeName));
  return groups;
}

export function CatalogPage() {
  const user = useAuth((s) => s.user);
  const { data: items, loading, error, reload } = useCatalogItems();
  const [adding, setAdding] = useState(false);

  const groups = useMemo(() => groupByType(items), [items]);

  // Any authenticated store_user or admin may contribute to the shared catalog.
  const canAdd = user?.role === 'store_user' || user?.role === 'admin';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Catalog</h1>
          <p className="text-muted-foreground">
            Every shared product, grouped by type. Anyone can add what's missing.
          </p>
        </div>
        {canAdd && (
          <Button size="lg" onClick={() => setAdding(true)}>
            <Plus className="h-5 w-5" /> Add item
          </Button>
        )}
      </div>

      {loading && <p className="text-muted-foreground">Loading catalog…</p>}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}

      {!loading && !error && groups.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            No catalog items yet. {canAdd ? 'Add the first one.' : ''}
          </CardContent>
        </Card>
      )}

      <div className="space-y-6">
        {groups.map((group) => (
          <Card key={group.productTypeId}>
            <CardHeader>
              <CardTitle>{group.productTypeName}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.items.map((item) => (
                <div key={item.id} className="rounded-md border p-3">
                  <p className="font-medium text-foreground">{item.name}</p>
                  {item.description && (
                    <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      {adding && (
        <AddItemDialog
          onClose={() => setAdding(false)}
          onCreated={async () => {
            setAdding(false);
            await reload();
          }}
        />
      )}
    </div>
  );
}

/** Modal form to create a new shared catalog item (name, description, product type). */
function AddItemDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const { data: productTypes, loading } = useProductTypes();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: { name: '', description: '', productTypeId: '' },
    onSubmit: async ({ value }) => {
      setFormError(null);
      try {
        const payload: CreateCatalogItemRequest = {
          name: value.name.trim(),
          description: value.description.trim(),
          productTypeId: value.productTypeId,
        };
        await api.post<CatalogItemDto>('/catalog', payload);
        await onCreated();
      } catch (err) {
        setFormError(err instanceof ApiError ? err.message : 'Could not add the item.');
      }
    },
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
    >
      <Card className="w-full max-w-md">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Add a catalog item</CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </Button>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void form.handleSubmit();
            }}
            className="space-y-4"
            noValidate
          >
            <form.Field name="name">
              {(field) => (
                <div className="space-y-1.5">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    autoFocus
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                </div>
              )}
            </form.Field>

            <form.Field name="description">
              {(field) => (
                <div className="space-y-1.5">
                  <Label htmlFor="description">Description (optional)</Label>
                  <Input
                    id="description"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                </div>
              )}
            </form.Field>

            <form.Field name="productTypeId">
              {(field) => (
                <div className="space-y-1.5">
                  <Label htmlFor="productTypeId">Product type</Label>
                  <select
                    id="productTypeId"
                    className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    disabled={loading}
                  >
                    <option value="" disabled>
                      {loading ? 'Loading…' : 'Choose a type'}
                    </option>
                    {productTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </form.Field>

            {formError && (
              <p role="alert" className="text-sm text-destructive">
                {formError}
              </p>
            )}

            <form.Subscribe selector={(s) => [s.isSubmitting, s.values] as const}>
              {([isSubmitting, values]) => (
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={isSubmitting || !values.name.trim() || !values.productTypeId}
                  >
                    {isSubmitting ? 'Adding…' : 'Add item'}
                  </Button>
                </div>
              )}
            </form.Subscribe>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
