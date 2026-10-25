/** Ошибка API в едином формате сервера: { error: { status, message, details? } }. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let token: string | null = null;
let onUnauthorized: (() => Promise<boolean>) | null = null;

export function setSessionToken(value: string | null): void {
  token = value;
}

/** Обработчик 401: пытается войти заново; true — можно повторить запрос. */
export function setUnauthorizedHandler(handler: (() => Promise<boolean>) | null): void {
  onUnauthorized = handler;
}

const NETWORK_ERROR = 'Нет связи с сервером. Проверьте интернет и повторите.';

async function request<T>(
  method: string,
  path: string,
  body: unknown,
  retried: boolean,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, NETWORK_ERROR);
  }

  if (res.status === 401 && !retried && onUnauthorized && path !== '/auth/telegram') {
    if (await onUnauthorized()) return request<T>(method, path, body, true);
  }
  if (res.status === 204) return undefined as T;

  const payload = (await res.json().catch(() => null)) as {
    error?: { message?: string; details?: unknown };
  } | null;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      payload?.error?.message ?? `Ошибка сервера (${res.status})`,
      payload?.error?.details,
    );
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path, undefined, false),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}, false),
};
