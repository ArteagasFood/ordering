import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodError, type ZodSchema } from 'zod';
import { validationError } from './errors';

/**
 * HTTP plumbing shared by every route handler.
 *
 * `asyncHandler` lets handlers be `async` and `throw`; any rejection is forwarded to
 * the central error middleware instead of hanging the request. `validate` parses and
 * coerces input with a Zod schema, converting a ZodError into our field-keyed
 * validation error. These two helpers keep individual handlers free of try/catch and
 * manual validation boilerplate.
 */
export function asyncHandler(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

/** Flatten a ZodError into a { 'path.to.field': message } map for the error envelope. */
function zodToFields(err: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}

/** Parse `data` with `schema`, throwing a 422 validation error on failure. */
export function parse<T>(schema: ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw validationError(zodToFields(result.error));
  }
  return result.data;
}

/** Convenience: validate `req.body` against a schema and return the typed value. */
export const body = <T>(schema: ZodSchema<T>, req: Request): T => parse(schema, req.body);

/** Convenience: validate `req.query` against a schema and return the typed value. */
export const query = <T>(schema: ZodSchema<T>, req: Request): T => parse(schema, req.query);

/** Send a JSON body with an explicit status (defaults to 200). */
export function send<T>(res: Response, payload: T, status = 200): void {
  res.status(status).json(payload);
}

/** 201 Created helper. */
export function created<T>(res: Response, payload: T): void {
  res.status(201).json(payload);
}

/** A no-op next reference for handlers that don't need it (keeps signatures tidy). */
export type Handler = (req: Request, res: Response, next: NextFunction) => unknown;
