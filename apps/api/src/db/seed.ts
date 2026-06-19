import { client, db } from './client';
import {
  users,
  stores,
  productTypes,
  catalogItems,
  departments,
  categories,
  storeMenuItems,
  globalPrices,
  orders,
  orderLines,
  reconciliationFlags,
  varianceThresholds,
  emailPreferencePolicies,
  appSettings,
} from './schema';
import { hashPassword } from '../lib/password';
import { env } from '../env';
import { EMAIL_TRIGGERS } from '@panaderia/shared';
import { PASTRIES, SEED_CATEGORIES, seedPriceCents, type SeedCategory } from './seed-data';

/**
 * Development seed. Populates a fresh database with enough realistic data to exercise
 * every flow immediately (TDD §17): an admin and AP user, three stores (one producer,
 * two buyers), the real pastry catalog filed into a taxonomy, the producer's priced
 * menu, and a few orders spanning the lifecycle (open → frozen → received) including a
 * short delivery that trips a reconciliation flag.
 *
 * Idempotency is by reset: run `npm run db:reset` to wipe-migrate-seed. The seed itself
 * assumes an empty schema.
 */

/** Map a taxonomy category to a coarse product type (the reporting top-dimension). */
function typeForCategory(cat: SeedCategory): string {
  switch (cat) {
    case 'Croissants':
      return 'Croissant';
    case 'Cookies':
      return 'Cookie';
    case 'Savory':
      return 'Savory';
    case 'Cakes & Bars':
    case 'Tarts':
      return 'Dessert';
    case 'Pan Dulce':
    default:
      return 'Pan Dulce';
  }
}

/** ISO date (YYYY-MM-DD) offset by `days` from today (negative = past). */
function isoDay(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function main() {
  // eslint-disable-next-line no-console
  console.log('Seeding database...');
  const pwHash = await hashPassword(env.SEED_ADMIN_PASSWORD);

  // --- Stores (TDD §6.2 capability toggles) ---
  const [central] = await db
    .insert(stores)
    .values({ name: 'Panadería Central', canBake: true, canSell: true, canBuy: true, cutoffTime: '07:00' })
    .returning({ id: stores.id });
  const [norte] = await db
    .insert(stores)
    .values({ name: 'Tienda Norte', canBake: false, canSell: false, canBuy: true, cutoffTime: null })
    .returning({ id: stores.id });
  const [sur] = await db
    .insert(stores)
    .values({ name: 'Tienda Sur', canBake: false, canSell: false, canBuy: true, cutoffTime: null })
    .returning({ id: stores.id });
  const centralId = central!.id;
  const norteId = norte!.id;
  const surId = sur!.id;

  // --- Users (TDD §3, §4): global admin + AP, plus one Store User per store ---
  const [adminRow] = await db
    .insert(users)
    .values([
      { email: env.SEED_ADMIN_EMAIL.toLowerCase(), name: 'Global Admin', role: 'admin', storeId: null, passwordHash: pwHash },
      { email: 'ap@panaderia.local', name: 'Accounts Payable', role: 'accounts_payable', storeId: null, passwordHash: pwHash },
      { email: 'central@panaderia.local', name: 'Central Baker', role: 'store_user', storeId: centralId, passwordHash: pwHash },
      { email: 'norte@panaderia.local', name: 'Norte Manager', role: 'store_user', storeId: norteId, passwordHash: pwHash },
      { email: 'sur@panaderia.local', name: 'Sur Manager', role: 'store_user', storeId: surId, passwordHash: pwHash },
    ])
    .returning({ id: users.id });
  const adminUserId = adminRow!.id;

  // --- Product types (TDD §5.1) ---
  const typeNames = Array.from(new Set(PASTRIES.map((p) => typeForCategory(p.category))));
  const typeRows = await db
    .insert(productTypes)
    .values(typeNames.map((name) => ({ name })))
    .returning({ id: productTypes.id, name: productTypes.name });
  const typeId = new Map(typeRows.map((t) => [t.name, t.id]));

  // --- Taxonomy (TDD §5.3): one department, the seed categories within it ---
  const [bakery] = await db
    .insert(departments)
    .values({ name: 'Bakery' })
    .returning({ id: departments.id });
  const catRows = await db
    .insert(categories)
    .values(SEED_CATEGORIES.map((name) => ({ name, departmentId: bakery!.id })))
    .returning({ id: categories.id, name: categories.name });
  const categoryId = new Map(catRows.map((c) => [c.name, c.id]));

  // --- Catalog items (TDD §5.1), created by the producing store ---
  const itemRows = await db
    .insert(catalogItems)
    .values(
      PASTRIES.map((p) => ({
        name: p.name,
        description: p.description,
        productTypeId: typeId.get(typeForCategory(p.category))!,
        createdByStore: centralId,
      })),
    )
    .returning({ id: catalogItems.id, name: catalogItems.name });
  const itemId = new Map(itemRows.map((r) => [r.name, r.id]));

  // --- Producer's menu (TDD §7, §9.1): price + par per item, filed by category ---
  const menuValues = PASTRIES.map((p, i) => ({
    storeId: centralId,
    catalogItemId: itemId.get(p.name)!,
    categoryId: categoryId.get(p.category)!,
    storePriceCents: seedPriceCents(i),
    par: 6 + (i % 5) * 2,
    visible: true,
  }));
  await db.insert(storeMenuItems).values(menuValues);

  // A handful of admin global prices (defaults used when a store sets none).
  await db.insert(globalPrices).values(
    PASTRIES.slice(0, 5).map((p, i) => ({ catalogItemId: itemId.get(p.name)!, priceCents: seedPriceCents(i) })),
  );

  // --- Governed defaults (TDD §5.2, §10.2) ---
  await db.insert(varianceThresholds).values({ storeId: null, absolute: 10, percentage: 0.15 });
  await db.insert(emailPreferencePolicies).values(
    EMAIL_TRIGGERS.map((trigger) => ({ trigger, globalDefault: trigger === 'cutoff_reminder', locked: false })),
  );
  await db.insert(appSettings).values({ key: 'global_cutoff_time', value: '06:00' });

  // --- Seed orders spanning the lifecycle (TDD §8) ---
  const priceOf = new Map(PASTRIES.map((p, i) => [p.name, seedPriceCents(i)]));
  const catOf = new Map(PASTRIES.map((p) => [p.name, p.category]));
  const typeOf = new Map(PASTRIES.map((p) => [p.name, typeForCategory(p.category)]));

  type LineSpec = { name: string; ordered: number; received?: number };

  async function seedOrder(args: {
    buyerId: string;
    serviceDay: string;
    status: 'open' | 'frozen' | 'received';
    frozen: boolean;
    lines: LineSpec[];
  }) {
    const [order] = await db
      .insert(orders)
      .values({
        buyerStoreId: args.buyerId,
        producerStoreId: centralId,
        serviceDay: args.serviceDay,
        status: args.status,
        frozenAt: args.frozen ? new Date() : null,
        createdBy: adminUserId,
      })
      .returning({ id: orders.id });

    for (const ln of args.lines) {
      const snapshot = priceOf.get(ln.name)!;
      const billedQty = ln.received ?? ln.ordered;
      const [line] = await db
        .insert(orderLines)
        .values({
          orderId: order!.id,
          sellerStoreId: centralId,
          buyerStoreId: args.buyerId,
          catalogItemId: itemId.get(ln.name)!,
          categoryId: categoryId.get(catOf.get(ln.name)!)!,
          productTypeId: typeId.get(typeOf.get(ln.name)!)!,
          serviceDay: args.serviceDay,
          orderedQty: ln.ordered,
          receivedQty: ln.received ?? null,
          unitPriceSnapshotCents: snapshot,
          lineTotalCents: billedQty * snapshot,
        })
        .returning({ id: orderLines.id });

      // Auto-flag a large short on received lines (TDD §10.2).
      if (ln.received != null) {
        const variance = ln.received - ln.ordered;
        const pct = ln.ordered === 0 ? 0 : Math.abs(variance) / ln.ordered;
        if (Math.abs(variance) >= 10 || pct >= 0.15) {
          await db.insert(reconciliationFlags).values({
            orderLineId: line!.id,
            variance,
            variancePct: pct,
            thresholdAbsolute: 10,
            thresholdPercentage: 0.15,
          });
        }
      }
    }
  }

  // Open (live, editable) order for today.
  await seedOrder({
    buyerId: norteId,
    serviceDay: isoDay(0),
    status: 'open',
    frozen: false,
    lines: [
      { name: 'Concha con Crema Batida', ordered: 24 },
      { name: 'Butter Croissant', ordered: 18 },
      { name: 'Oreja', ordered: 12 },
    ],
  });

  // Frozen order (cutoff passed) for yesterday.
  await seedOrder({
    buyerId: surId,
    serviceDay: isoDay(-1),
    status: 'frozen',
    frozen: true,
    lines: [
      { name: 'Banderilla', ordered: 30 },
      { name: 'Chocolate Croissant', ordered: 20 },
      { name: 'Empanada', ordered: 15 },
    ],
  });

  // Received order (counted) for two days ago — one line shorted to trip a flag.
  await seedOrder({
    buyerId: norteId,
    serviceDay: isoDay(-2),
    status: 'received',
    frozen: true,
    lines: [
      { name: 'Cinnamon Roll', ordered: 20, received: 20 },
      { name: 'Cookie', ordered: 40, received: 25 }, // short by 15 → flagged
      { name: 'Galleta de Fresa', ordered: 16, received: 16 },
    ],
  });

  // eslint-disable-next-line no-console
  console.log(
    `Seed complete: 3 stores, 5 users, ${PASTRIES.length} catalog items, producer menu, 3 orders.`,
  );
  // eslint-disable-next-line no-console
  console.log(`Admin login: ${env.SEED_ADMIN_EMAIL} / ${env.SEED_ADMIN_PASSWORD}`);
}

main()
  .then(() => client.end())
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error('Seed failed:', err);
    await client.end();
    process.exit(1);
  });
