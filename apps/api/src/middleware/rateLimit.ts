import rateLimit from 'express-rate-limit';
import { AppError } from '../lib/errors';

/**
 * Rate limiting (TDD §4.1 — brute-force protection). Two limiters:
 *
 *  - `loginLimiter`: a tight cap on the login endpoint per client IP, providing the
 *    "short lockout after repeated failures" the TDD requires. Successful logins are
 *    not skipped here for simplicity, but the window is short enough not to impede a
 *    legitimate user while throttling credential-stuffing.
 *  - `apiLimiter`: a generous global ceiling guarding the API from runaway clients.
 *
 * Both reject with our standard 429 error envelope via the central error handler.
 */
function tooMany(): AppError {
  return new AppError(429, 'too_many_requests', 'Too many attempts. Please wait and try again.');
}

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10, // 10 attempts per IP per window
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, _res, next) => next(tooMany()),
});

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, _res, next) => next(tooMany()),
});
