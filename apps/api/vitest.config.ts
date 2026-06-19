import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for the API. Tests live beside the code as `*.test.ts`. Pure
 * units (resolvers, authorization logic) run without a database; slice tests that need
 * data use the local Postgres configured in .env.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
