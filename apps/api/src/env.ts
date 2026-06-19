import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';

/**
 * Typed, validated environment configuration.
 *
 * The .env file lives at the repository root (one file for the whole workspace). We
 * resolve it relative to this module so it loads regardless of the process's cwd, then
 * validate with Zod so a missing or malformed variable fails fast at boot with a clear
 * message rather than surfacing as a mysterious runtime error later.
 */
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
loadDotenv({ path: resolve(repoRoot, '.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  SESSION_SECRET: z.string().min(1).default('dev-only-insecure-change-me'),
  SESSION_COOKIE_NAME: z.string().default('panaderia_sid'),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(7),
  SEED_ADMIN_EMAIL: z.string().email().default('admin@admin.com'),
  SEED_ADMIN_PASSWORD: z.string().min(1).default('123ABC'),
  EMAIL_PROVIDER: z.enum(['console', 'resend']).default('console'),
  EMAIL_FROM: z.string().default('no-reply@panaderia.local'),
  RESEND_API_KEY: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
/** Allowed CORS origins for the dev cross-port case (browser normally uses the Vite proxy). */
export const webOrigins = env.WEB_ORIGIN.split(',').map((s) => s.trim());
export { repoRoot };
