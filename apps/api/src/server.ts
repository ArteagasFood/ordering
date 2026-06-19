import { createApp } from './app';
import { env } from './env';

/**
 * Process entrypoint. Long-lived Express service (TDD §2.2) — all backend logic lives
 * here. Started via `npm run dev` (tsx watch) in development.
 */
const app = createApp();

const server = app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Panadería API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
});

// Graceful shutdown so tsx watch restarts don't leak the port.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
