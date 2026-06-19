import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit configuration. Migrations are generated from the schema modules in
 * src/db/schema and written to ./drizzle. The dialect is PostgreSQL.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/panaderia_dev',
  },
  strict: true,
  verbose: true,
});
