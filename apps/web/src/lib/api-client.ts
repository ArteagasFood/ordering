import type { ApiErrorBody } from '@panaderia/shared';

/**
 * The typed API client — the single way the SPA talks to the Express API.
 *
 * Every request is same-origin (the Vite proxy / production reverse proxy forwards
 * `/api`), so `credentials: 'include'` sends the httpOnly session cookie automatically;
 * the SPA never handles a token. Non-2xx responses are thrown as `ApiError`, carrying
 * the server's stable code, message, and field errors so callers can branch on `code`
 * and forms can surface field-level messages.
 */
const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error?.message ?? 'Request failed');
    this.name = 'ApiError';
    this.status = status;
    this.code = body.error?.code ?? 'error';
    this.fields = body.error?.fields;
  }
}

async function request<T>(method: string, path: string, payload?: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    credentials: 'include',
    headers: payload !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: payload !== undefined ? JSON.stringify(payload) : undefined,
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;

  if (!res.ok) {
    throw new ApiError(res.status, (data as ApiErrorBody) ?? { error: { code: 'error', message: res.statusText } });
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
};
