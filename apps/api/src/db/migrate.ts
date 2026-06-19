import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { env } from '../env';

/**
 * Applies all pending migrations from ./drizzle, then exits. Run via `npm run db:migrate`.
 * Uses a dedicated single connection (max: 1) so the script terminates cleanly.
 */
async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = resolve(here, '../../drizzle');
  const sql = postgres(env.DATABASE_URL, { max: 1 });
  const db = drizzle(sql);
  // eslint-disable-next-line no-console
  console.log(`Applying migrations from ${migrationsFolder} ...`);
  await migrate(db, { migrationsFolder });
  // eslint-disable-next-line no-console
  console.log('Migrations applied.');
  await sql.end();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Migration failed:', err);
  process.exit(1);
});
