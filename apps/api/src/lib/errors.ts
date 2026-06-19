import type { ApiErrorBody } from '@panaderia/shared';

/**
 * Application error taxonomy.
 *
 * Every expected failure is an `AppError` carrying an HTTP status, a stable machine
 * code, and a user-safe message. The central error handler (middleware/error.ts)
 * serializes these into the shared `ApiErrorBody` shape, so the SPA always receives a
 * predictable error envelope. Throwing one of these from anywhere in a handler is the
 * idiomatic way to reject a request.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;

  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }

  toBody(): ApiErrorBody {
    return { error: { code: this.code, message: this.message, fields: this.fields } };
  }
}

export const badRequest = (message: string, fields?: Record<string, string>) =>
  new AppError(400, 'bad_request', message, fields);

export const unauthorized = (message = 'Authentication required.') =>
  new AppError(401, 'unauthorized', message);

export const forbidden = (message = 'You do not have permission to do that.') =>
  new AppError(403, 'forbidden', message);

export const notFound = (message = 'Not found.') => new AppError(404, 'not_found', message);

export const conflict = (message: string) => new AppError(409, 'conflict', message);

export const validationError = (fields: Record<string, string>, message = 'Validation failed.') =>
  new AppError(422, 'validation_error', message, fields);
