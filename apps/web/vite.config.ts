import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/**
 * Vite configuration for the SPA (TDD §2.2 — a pure static bundle).
 *
 * In development the dev server proxies `/api` to the Express API on :4000, so the
 * browser sees a single origin. That keeps the session cookie first-party (no CORS,
 * clean SameSite=Lax) and mirrors how a production reverse proxy would route. The build
 * output is plain static assets, portable to any host.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
