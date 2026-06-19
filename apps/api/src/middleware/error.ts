import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError, notFound as notFoundError } from '../lib/errors';
import { isProd } from '../env';

/** 404 for any API route that didn't match. Placed after all routers. */
export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(notFoundError('No such endpoint.'));
};

/**
 * Central error handler — the single place request failures become HTTP responses.
 * Known `AppError`s serialize to their status + envelope; stray `ZodError`s become a
 * 422; anything else is an unexpected 500 whose details are hidden in production but
 * shown in development to aid debugging. Stack traces are logged, never returned.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json(err.toBody());
    return;
  }
  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of err.issues) {
      const key = issue.path.join('.') || '_';
      if (!fields[key]) fields[key] = issue.message;
    }
    res.status(422).json({ error: { code: 'validation_error', message: 'Validation failed.', fields } });
    return;
  }
  // eslint-disable-next-line no-console
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: {
      code: 'internal_error',
      message: isProd ? 'Something went wrong.' : String((err as Error)?.message ?? err),
    },
  });
};
