import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import type { BakeListControls } from './useBakeListControls';

/**
 * The producer + service-day picker shared by both views. When the user is pinned to a
 * single producing store, we show its name as static text instead of a dropdown (TDD
 * §17 — never present a control the user doesn't need; less on screen to misread).
 */
export function BakeListControlsBar({ controls }: { controls: BakeListControls }) {
  const { producerStores, producerStoreId, setProducerStoreId, serviceDay, setServiceDay, isSingleStore } =
    controls;
  const selected = producerStores.find((s) => s.id === producerStoreId);

  return (
    <div className="flex flex-wrap items-end gap-4 print:hidden">
      <div className="space-y-1.5">
        <Label htmlFor="producer-store">Bakery</Label>
        {isSingleStore ? (
          <p id="producer-store" className="flex h-10 items-center text-base font-medium">
            {selected?.name ?? '—'}
          </p>
        ) : (
          <select
            id="producer-store"
            value={producerStoreId}
            onChange={(e) => setProducerStoreId(e.target.value)}
            className="flex h-10 w-56 rounded-md border border-input bg-card px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {producerStores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="service-day">Service day</Label>
        <Input
          id="service-day"
          type="date"
          value={serviceDay}
          onChange={(e) => setServiceDay(e.target.value)}
          className="w-48"
        />
      </div>
    </div>
  );
}
