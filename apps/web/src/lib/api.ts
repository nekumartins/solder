import { COPY, type ApiErrorBody } from '@solder/shared';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'include',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    // fetch only rejects on a network-level failure. Being genuinely offline
    // and failing to reach the server are different problems with different
    // fixes, so they get different errors.
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    throw offline
      ? new ApiError(0, 'offline', COPY.errors.offline)
      : new ApiError(0, 'unreachable', COPY.errors.unreachable);
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let payload: unknown = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      // Something between us and the API answered instead — a proxy, a gateway,
      // an error page. Whatever it said, it is not the API, and showing a
      // parser's complaint to someone trying to send money helps nobody.
      throw new ApiError(response.status, 'unreachable', COPY.errors.unreachable);
    }
  }

  if (!response.ok) {
    const error = (payload as ApiErrorBody).error;
    throw new ApiError(
      response.status,
      error?.code ?? 'server_error',
      error?.message ?? 'Something went wrong. Try again.',
    );
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
};
