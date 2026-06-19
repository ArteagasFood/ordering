import { useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { BakeListDto } from '@panaderia/shared';
import { useBakeListControls } from './useBakeListControls';
import { BakeListControlsBar } from './BakeListControls';

/**
 * The bake list (TDD §9.2, §17). One calm, printable list a panadero bakes from:
 * for each item, what was ordered, plus the bakery's own par, equals the quantity to
 * bake. "No interpretation required" — the bake-qty column is the answer.
 */
export function BakeListPage() {
  const controls = useBakeListControls();
  const { producerStoreId, serviceDay, storesError } = controls;

  const [data, setData] = useState<BakeListDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!producerStoreId || !serviceDay) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get<BakeListDto>(`/bake-list?producerStoreId=${producerStoreId}&serviceDay=${serviceDay}`)
      .then((dto) => {
        if (!cancelled) setData(dto);
      })
      .catch((err) => {
        if (cancelled) return;
        setData(null);
        setError(err instanceof ApiError ? err.message : 'Could not load the bake list.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [producerStoreId, serviceDay]);

  const totalToBake = data?.rows.reduce((sum, r) => sum + r.bakeQty, 0) ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold">Bake list</h1>
          <p className="text-muted-foreground">What to bake today, ordered plus your par.</p>
        </div>
        <Button variant="outline" size="lg" onClick={() => window.print()} disabled={!data}>
          <Printer className="h-4 w-4" />
          Print
        </Button>
      </div>

      <BakeListControlsBar controls={controls} />

      {storesError && <p className="text-sm text-destructive print:hidden">{storesError}</p>}
      {error && <p className="text-sm text-destructive print:hidden">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-baseline justify-between gap-4">
            <span>{data?.producerStoreName ?? 'Bake list'}</span>
            <span className="text-sm font-normal text-muted-foreground">{serviceDay}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

          {!loading && data && data.rows.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nothing to bake for this day yet — no frozen orders and no par set.
            </p>
          )}

          {!loading && data && data.rows.length > 0 && (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Item</th>
                  <th className="py-2 px-4 text-right font-medium">Ordered</th>
                  <th className="py-2 px-4 text-right font-medium">+ Par</th>
                  <th className="py-2 pl-4 text-right font-medium">= Bake</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.catalogItemId} className="border-b last:border-0">
                    <td className="py-3 pr-4 font-medium">{row.catalogItemName}</td>
                    <td className="py-3 px-4 text-right tabular-nums">{row.orderedTotal}</td>
                    <td className="py-3 px-4 text-right tabular-nums text-muted-foreground">
                      {row.producerPar}
                    </td>
                    <td className="py-3 pl-4 text-right text-lg font-semibold tabular-nums">
                      {row.bakeQty}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="py-3 pr-4 font-semibold" colSpan={3}>
                    Total to bake
                  </td>
                  <td className="py-3 pl-4 text-right text-lg font-semibold tabular-nums">
                    {totalToBake}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
