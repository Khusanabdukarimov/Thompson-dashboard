import { getStoredToken, clearStoredToken } from '@/lib/auth';

export class ApiError extends Error {
  status: number;
  payload: unknown;
  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

function authHeaders(): Record<string, string> {
  const t = getStoredToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

function handle401() {
  clearStoredToken();
  if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
    window.location.href = '/login';
  }
}

export async function apiGet<T>(path: string, params?: Record<string, string | number | undefined | null>): Promise<T> {
  const url = new URL(path, window.location.origin);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue;
      url.searchParams.set(k, String(v));
    }
  }
  const res = await window.fetch(url.pathname + url.search, { headers: authHeaders() });
  if (res.status === 401) handle401();
  if (!res.ok) {
    let payload: unknown = null;
    try { payload = await res.json(); } catch { /* ignore */ }
    throw new ApiError(`${res.status} ${res.statusText}`, res.status, payload);
  }
  return res.json() as Promise<T>;
}

/** Wrapper around fetch that adds auth header and handles 401. */
export async function authedFetch(input: RequestInfo, init: RequestInit = {}): Promise<Response> {
  const headers = { ...(init.headers as Record<string, string> | undefined ?? {}), ...authHeaders() };
  const res = await window.fetch(input, { ...init, headers });
  if (res.status === 401) handle401();
  return res;
}
