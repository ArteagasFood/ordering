import { useEffect, useMemo, useState } from 'react';
import { Save } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { StoreDto, VarianceThresholdDto } from '@panaderia/shared';
import { fetchThresholds, saveThreshold } from './api';

/**
 * Admin page to set variance thresholds (TDD §10.2 step 1). The global default applies
 * everywhere; a per-store override exists because "large" differs by store size. Both
 * carry an absolute (units) and a percentage component; a line is flagged when *either*
 * is crossed. Percentages are entered as whole-number percent for the operator and
 * converted to the 0..1 fraction the contract expects.
 */

/** The form's working copy of a threshold, with the percentage as whole-number percent. */
interface DraftRow {
  storeId: string | null;
  absolute: string;
  percent: string; // whole-number percent, e.g. "15"
}

const EMPTY_DRAFT: DraftRow = { storeId: '', absolute: '', percent: '' };

export function ThresholdsAdminPage() {
  const [thresholds, setThresholds] = useState<VarianceThresholdDto[]>([]);
  const [stores, setStores] = useState<StoreDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Global default draft (storeId always null).
  const [global, setGlobal] = useState<DraftRow>({ storeId: null, absolute: '', percent: '' });
  // Per-store override draft.
  const [override, setOverride] = useState<DraftRow>({ ...EMPTY_DRAFT });

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchThresholds();
      setThresholds(rows);
      const g = rows.find((r) => r.storeId === null);
      if (g) setGlobal({ storeId: null, absolute: String(g.absolute), percent: pctToWhole(g.percentage) });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load thresholds.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // Store names are a nicety for the per-store list; tolerate the endpoint being absent.
    api
      .get<StoreDto[]>('/stores')
      .then(setStores)
      .catch(() => setStores([]));
  }, []);

  const storeName = useMemo(() => {
    const byId = new Map(stores.map((s) => [s.id, s.name]));
    return (id: string | null) => (id === null ? 'Global default' : byId.get(id) ?? id);
  }, [stores]);

  const overrides = thresholds.filter((t) => t.storeId !== null);

  async function submit(draft: DraftRow) {
    setError(null);
    setNotice(null);
    const absolute = Number(draft.absolute);
    const percentage = Number(draft.percent) / 100;
    if (!Number.isInteger(absolute) || absolute < 0) {
      setError('Absolute threshold must be a whole number of units (0 or more).');
      return;
    }
    if (!Number.isFinite(percentage) || percentage < 0 || percentage > 1) {
      setError('Percentage must be between 0 and 100.');
      return;
    }
    if (draft.storeId !== null && !draft.storeId) {
      setError('Pick a store for the override.');
      return;
    }
    try {
      await saveThreshold({ storeId: draft.storeId, absolute, percentage });
      setNotice(`Saved ${storeName(draft.storeId)} threshold.`);
      if (draft.storeId !== null) setOverride({ ...EMPTY_DRAFT });
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the threshold.');
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Variance thresholds</h1>
        <p className="text-muted-foreground">
          A received line is flagged when it differs from the order by at least this many
          units, OR by at least this percentage. Set a global default, then override per
          store where "large" means something different.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {notice && <p className="text-sm text-primary">{notice}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Global default</CardTitle>
          <CardDescription>Applies to every store without its own override.</CardDescription>
        </CardHeader>
        <CardContent>
          <ThresholdForm
            draft={global}
            onChange={setGlobal}
            onSubmit={() => submit(global)}
            disabled={loading}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Per-store override</CardTitle>
          <CardDescription>Pick a store and set its own thresholds.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="override-store">Store</Label>
            {stores.length > 0 ? (
              <select
                id="override-store"
                className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm"
                value={override.storeId ?? ''}
                onChange={(e) => setOverride({ ...override, storeId: e.target.value })}
              >
                <option value="">Select a store…</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                id="override-store"
                placeholder="Store id (UUID)"
                value={override.storeId ?? ''}
                onChange={(e) => setOverride({ ...override, storeId: e.target.value })}
              />
            )}
          </div>
          <ThresholdForm
            draft={override}
            onChange={setOverride}
            onSubmit={() => submit(override)}
            disabled={loading}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Current overrides</CardTitle>
          <CardDescription>Stores with their own thresholds.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : overrides.length === 0 ? (
            <p className="text-sm text-muted-foreground">No per-store overrides yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Store</th>
                  <th className="py-2 pr-4 text-right font-medium">Absolute</th>
                  <th className="py-2 text-right font-medium">Percentage</th>
                </tr>
              </thead>
              <tbody>
                {overrides.map((t) => (
                  <tr key={t.storeId} className="border-b last:border-0">
                    <td className="py-2 pr-4">{storeName(t.storeId)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{t.absolute}</td>
                    <td className="py-2 text-right tabular-nums">{pctToWhole(t.percentage)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Whole-number percent string for a 0..1 fraction (15% ← 0.15). */
function pctToWhole(fraction: number): string {
  return String(Math.round(fraction * 100));
}

/** The absolute + percentage inputs and a save button, shared by global and override. */
function ThresholdForm({
  draft,
  onChange,
  onSubmit,
  disabled,
}: {
  draft: DraftRow;
  onChange: (next: DraftRow) => void;
  onSubmit: () => void;
  disabled?: boolean;
}) {
  return (
    <form
      className="flex flex-wrap items-end gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor={`abs-${draft.storeId ?? 'global'}`}>Absolute (units)</Label>
        <Input
          id={`abs-${draft.storeId ?? 'global'}`}
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          className="w-32"
          value={draft.absolute}
          onChange={(e) => onChange({ ...draft, absolute: e.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`pct-${draft.storeId ?? 'global'}`}>Percentage (%)</Label>
        <Input
          id={`pct-${draft.storeId ?? 'global'}`}
          type="number"
          min={0}
          max={100}
          step={1}
          inputMode="numeric"
          className="w-32"
          value={draft.percent}
          onChange={(e) => onChange({ ...draft, percent: e.target.value })}
        />
      </div>
      <Button type="submit" disabled={disabled}>
        <Save className="h-4 w-4" /> Save
      </Button>
    </form>
  );
}
