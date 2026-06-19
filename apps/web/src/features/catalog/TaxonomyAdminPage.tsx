import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type {
  CategoryDto,
  CreateCategoryRequest,
  CreateDepartmentRequest,
  DepartmentDto,
  UpdateTaxonomyNodeRequest,
} from '@panaderia/shared';
import { useCategories, useDepartments } from './useCatalogData';

/**
 * TaxonomyAdminPage (TDD §5.3). Admin-only management of the centralized taxonomy:
 * departments and the categories within them. Stores never reorganize taxonomy — they
 * only file data into it — so create/edit lives here behind the admin role. Items are
 * soft-deactivated (active=false) rather than deleted, preserving history (§16.1).
 */
export function TaxonomyAdminPage() {
  const user = useAuth((s) => s.user);
  const depts = useDepartments();
  const cats = useCategories();

  const [deptName, setDeptName] = useState('');
  const [catName, setCatName] = useState('');
  const [catDeptId, setCatDeptId] = useState('');
  const [deptError, setDeptError] = useState<string | null>(null);
  const [catError, setCatError] = useState<string | null>(null);

  // Group categories under their department for display.
  const categoriesByDept = useMemo(() => {
    const map = new Map<string, CategoryDto[]>();
    for (const c of cats.data) {
      const list = map.get(c.departmentId) ?? [];
      list.push(c);
      map.set(c.departmentId, list);
    }
    return map;
  }, [cats.data]);

  if (user?.role !== 'admin') {
    return <p className="text-muted-foreground">You do not have access to this page.</p>;
  }

  async function addDepartment(e: React.FormEvent) {
    e.preventDefault();
    const name = deptName.trim();
    if (!name) return;
    setDeptError(null);
    try {
      const payload: CreateDepartmentRequest = { name };
      await api.post<DepartmentDto>('/taxonomy/departments', payload);
      setDeptName('');
      await depts.reload();
    } catch (err) {
      setDeptError(err instanceof ApiError ? err.message : 'Could not add the department.');
    }
  }

  async function addCategory(e: React.FormEvent) {
    e.preventDefault();
    const name = catName.trim();
    if (!name || !catDeptId) return;
    setCatError(null);
    try {
      const payload: CreateCategoryRequest = { name, departmentId: catDeptId };
      await api.post<CategoryDto>('/taxonomy/categories', payload);
      setCatName('');
      await cats.reload();
    } catch (err) {
      setCatError(err instanceof ApiError ? err.message : 'Could not add the category.');
    }
  }

  async function toggleDepartment(d: DepartmentDto) {
    const patch: UpdateTaxonomyNodeRequest = { active: !d.active };
    await api.patch<DepartmentDto>(`/taxonomy/departments/${d.id}`, patch);
    await depts.reload();
  }

  async function toggleCategory(c: CategoryDto) {
    const patch: UpdateTaxonomyNodeRequest = { active: !c.active };
    await api.patch<CategoryDto>(`/taxonomy/categories/${c.id}`, patch);
    await cats.reload();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Taxonomy</h1>
        <p className="text-muted-foreground">
          Departments and categories are defined centrally and shared by every store.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add a department</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={addDepartment} className="flex items-end gap-3" noValidate>
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="dept-name">Name</Label>
              <Input
                id="dept-name"
                value={deptName}
                onChange={(e) => setDeptName(e.target.value)}
                placeholder="e.g. Bakery"
              />
            </div>
            <Button type="submit" disabled={!deptName.trim()}>
              <Plus className="h-5 w-5" /> Add
            </Button>
          </form>
          {deptError && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {deptError}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Add a category</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={addCategory} className="flex flex-wrap items-end gap-3" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="cat-dept">Department</Label>
              <select
                id="cat-dept"
                className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={catDeptId}
                onChange={(e) => setCatDeptId(e.target.value)}
              >
                <option value="" disabled>
                  Choose a department
                </option>
                {depts.data.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="cat-name">Name</Label>
              <Input
                id="cat-name"
                value={catName}
                onChange={(e) => setCatName(e.target.value)}
                placeholder="e.g. Conchas"
              />
            </div>
            <Button type="submit" disabled={!catName.trim() || !catDeptId}>
              <Plus className="h-5 w-5" /> Add
            </Button>
          </form>
          {catError && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {catError}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Departments &amp; categories</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {(depts.loading || cats.loading) && <p className="text-muted-foreground">Loading…</p>}
          {(depts.error || cats.error) && (
            <p role="alert" className="text-destructive">
              Could not load the taxonomy.
            </p>
          )}
          {!depts.loading && depts.data.length === 0 && (
            <p className="text-muted-foreground">No departments yet.</p>
          )}
          {depts.data.map((d) => (
            <div key={d.id} className="rounded-md border p-4">
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  {d.name}
                  {!d.active && <span className="ml-2 text-xs text-muted-foreground">(inactive)</span>}
                </span>
                <Button variant="outline" size="sm" onClick={() => void toggleDepartment(d)}>
                  {d.active ? 'Deactivate' : 'Activate'}
                </Button>
              </div>
              <div className="mt-3 space-y-2 pl-4">
                {(categoriesByDept.get(d.id) ?? []).map((c) => (
                  <div key={c.id} className="flex items-center justify-between text-sm">
                    <span>
                      {c.name}
                      {!c.active && (
                        <span className="ml-2 text-xs text-muted-foreground">(inactive)</span>
                      )}
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => void toggleCategory(c)}>
                      {c.active ? 'Deactivate' : 'Activate'}
                    </Button>
                  </div>
                ))}
                {(categoriesByDept.get(d.id) ?? []).length === 0 && (
                  <p className="text-sm text-muted-foreground">No categories.</p>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
