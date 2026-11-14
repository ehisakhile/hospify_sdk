/** Shared HTTP plumbing for the client and server SDKs. */

export const DEFAULT_BASE_URL = "https://api.hospify.cloud";
export const SDK_VERSION = "1.0.0";

/** Every failed call: the API's error code (e.g. "kyb_required"), a message for people, and the HTTP status. */
export class HospifyError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "HospifyError";
    this.code = code;
    this.status = status;
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  headers?: Record<string, string>;
}

export async function call<T>(fetchImpl: FetchLike, baseUrl: string, path: string, auth: string, opts: RequestOptions = {}): Promise<T> {
  const url = new URL(baseUrl.replace(/\/$/, "") + path);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  let res: Response;
  try {
    res = await fetchImpl(url.toString(), {
      method: opts.method ?? "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${auth}`,
        "Hospify-Sdk": `typescript/${SDK_VERSION}`,
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(opts.headers ?? {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    throw new HospifyError("network_error", "Couldn't reach Hospify. Check the connection and try again.", 0);
  }
  if (res.status === 204) return undefined as T;
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = data?.error ?? {};
    throw new HospifyError(err.code ?? "http_error", err.message ?? `Hospify answered ${res.status}.`, res.status);
  }
  return data as T;
}

export function defaultFetch(): FetchLike {
  if (typeof fetch !== "function") {
    throw new HospifyError("no_fetch", "This environment has no fetch. Pass one in the options: { fetch }.", 0);
  }
  return fetch.bind(globalThis) as FetchLike;
}
