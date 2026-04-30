export class ApiError extends Error {
  status: number;
  payload: unknown;
  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.status = status;
    this.payload = payload;
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
  const res = await fetch(url.pathname + url.search);
  if (!res.ok) {
    let payload: unknown = null;
    try { payload = await res.json(); } catch { /* ignore */ }
    throw new ApiError(`${res.status} ${res.statusText}`, res.status, payload);
  }
  return res.json() as Promise<T>;
}
