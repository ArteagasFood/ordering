import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { sessionMiddleware } from './middleware/session';
import { errorHandler, notFoundHandler } from './middleware/error';
import { apiLimiter } from './middleware/rateLimit';
import { buildApiRouter } from './router';
import { webOrigins } from './env';

/**
 * Assembles the Express application with the security middleware stack in the order
 * that matters (TDD §2.3, §4.1):
 *
 *   helmet → CORS → JSON body parsing → cookies → session resolution → /api router.
 *
 * Session resolution runs before the router so every handler sees `req.user`. The 404
 * and error handlers are mounted last so they catch everything below them.
 */
export function createApp(): Express {
  const app = express();

  // Trust the first proxy hop (the Vite dev proxy; a real LB in prod) so client IP and
  // protocol are read correctly for rate limiting and Secure cookies.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(cors({ origin: webOrigins, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(sessionMiddleware);

  app.use('/api', apiLimiter, buildApiRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
