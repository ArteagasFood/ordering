import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../env';
import * as schema from './schema/index';

/**
 * The shared database client.
 *
 * A single postgres-js connection pool backs the whole API process (TDD §2.2 — one
 * long-lived Express service). Drizzle wraps it with the full schema so every query is
 * fully typed. Import `db` anywhere a query is needed; import `sql`/`client` only for
 * migration and maintenance scripts.
 */
export const client = postgres(env.DATABASE_URL, {
  max: 10,
  // Keep idle connections modest for local dev.
  idle_timeout: 20,
});

export const db = drizzle(client, { schema });

export type Db = typeof db;
export { schema };
