import postgres from 'postgres';
import { env, isProd } from '../env';

/**
 * DESTRUCTIVE dev helper: drops and recreates the `public` schema, wiping all data and
 * tables. Refuses to run when NODE_ENV=production. The package script chains this with
 * migrate + seed (`db:reset`). Never wired into the running server.
 */
async function main() {
  if (isProd) {
    throw new Error('Refusing to reset the database in production.');
  }
  const sql = postgres(env.DATABASE_URL, { max: 1 });
  // eslint-disable-next-line no-console
  console.log('Dropping and recreating schema "public" (and the drizzle journal) ...');
  // Drop the migration journal too (it lives in its own `drizzle` schema); otherwise
  // the migrator would believe migrations are still applied and skip recreating tables.
  await sql.unsafe(
    'DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;',
  );
  // eslint-disable-next-line no-console
  console.log('Schema reset. Run migrations + seed next.');
  await sql.end();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Reset failed:', err);
  process.exit(1);
});
