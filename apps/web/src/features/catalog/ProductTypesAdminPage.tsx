import { useState } from 'react';
import { Plus } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { CreateProductTypeRequest, ProductTypeDto } from '@panaderia/shared';
import { useProductTypes } from './useCatalogData';

/**
 * ProductTypesAdminPage (TDD §5.1). Admin-only management of the typing dimension on
 * catalog items (bread, dessert, …). Adding a new type is a configuration change, not a
 * migration. Non-admins never reach this page (gated in nav), but we also guard here.
 */
export function ProductTypesAdminPage() {
  const user = useAuth((s) => s.user);
  const { data: types, loading, error, reload } = useProductTypes();
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (user?.role !== 'admin') {
    return <p className="text-muted-foreground">You do not have access to this page.</p>;
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const payload: CreateProductTypeRequest = { name: trimmed };
      await api.post<ProductTypeDto>('/product-types', payload);
      setName('');
      await reload();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not add the product type.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Product types</h1>
        <p className="text-muted-foreground">
          The typing dimension on every catalog item. Add a new line when the menu grows.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add a product type</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={add} className="flex items-end gap-3" noValidate>
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="pt-name">Name</Label>
              <Input
                id="pt-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Bread"
              />
            </div>
            <Button type="submit" disabled={submitting || !name.trim()}>
              <Plus className="h-5 w-5" /> Add
            </Button>
          </form>
          {formError && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {formError}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All product types</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading && <p className="text-muted-foreground">Loading…</p>}
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          {!loading && !error && types.length === 0 && (
            <p className="text-muted-foreground">No product types yet.</p>
          )}
          {types.map((t) => (
            <div key={t.id} className="rounded-md border p-3 font-medium">
              {t.name}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
