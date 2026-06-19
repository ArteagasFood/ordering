import { useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { DistributionDto } from '@panaderia/shared';
import { useBakeListControls } from './useBakeListControls';
import { BakeListControlsBar } from './BakeListControls';

/**
 * The distribution / pick list (TDD §9.3, §17). The bake list inverted: once the total
 * is baked, this tells the producer how many of each item go to each buyer store —
 * "10 to Store A, 16 to Store B". One clear list to deliver from.
 */
export function DistributionPage() {
  const controls = useBakeListControls();
  const { producerStoreId, serviceDay, storesError } = controls;

  const [data, setData] = useState<DistributionDto | null>(null);
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
      .get<DistributionDto>(
        `/bake-list/distribution?producerStoreId=${producerStoreId}&serviceDay=${serviceDay}`,
      )
      .then((dto) => {
        if (!cancelled) setData(dto);
      })
      .catch((err) => {
        if (cancelled) return;
        setData(null);
        setError(err instanceof ApiError ? err.message : 'Could not load the distribution list.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [producerStoreId, serviceDay]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold">Distribution</h1>
          <p className="text-muted-foreground">Where each item goes — the pick list per store.</p>
        </div>
        <Button variant="outline" size="lg" onClick={() => window.print()} disabled={!data}>
          <Printer className="h-4 w-4" />
          Print
        </Button>
      </div>

      <BakeListControlsBar controls={controls} />

      {storesError && <p className="text-sm text-destructive print:hidden">{storesError}</p>}
      {error && <p className="text-sm text-destructive print:hidden">{error}</p>}

      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-semibold">{data?.producerStoreName ?? 'Distribution'}</h2>
        <span className="text-sm text-muted-foreground">{serviceDay}</span>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!loading && data && data.rows.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No frozen orders to distribute for this day.
        </p>
      )}

      {!loading &&
        data &&
        data.rows.map((row) => (
          <Card key={row.catalogItemId}>
            <CardHeader>
              <CardTitle className="flex items-baseline justify-between gap-4">
                <span>{row.catalogItemName}</span>
                <span className="text-sm font-normal text-muted-foreground">
                  {row.totalAllocated} total
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Deliver to</th>
                    <th className="py-2 pl-4 text-right font-medium">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {row.allocations.map((alloc) => (
                    <tr key={alloc.buyerStoreId} className="border-b last:border-0">
                      <td className="py-3 pr-4 font-medium">{alloc.buyerStoreName}</td>
                      <td className="py-3 pl-4 text-right text-lg font-semibold tabular-nums">
                        {alloc.qty}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        ))}
    </div>
  );
}
