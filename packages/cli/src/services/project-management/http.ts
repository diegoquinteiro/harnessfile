export type HttpFetch = typeof globalThis.fetch;

/** Avoid including provider response bodies: they can echo credentials or private inputs. */
export class ProviderHttpError extends Error {
  readonly retryable: boolean;
  constructor(readonly provider: string, readonly status: number, readonly uncertain: boolean) {
    super(`${provider} request failed (HTTP ${status})${uncertain ? "; reconcile before retrying the mutation" : ""}`);
    this.name = "ProviderHttpError";
    this.retryable = status === 429 || status >= 500;
  }
}

export function apiUrl(value: unknown, fallback: string): string {
  if (value !== undefined && typeof value !== "string") throw new Error("apiUrl must be a URL string");
  const url = new URL(value ?? fallback);
  if (url.username || url.password || url.search || url.hash) throw new Error("apiUrl must not contain credentials, query parameters, or a fragment");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
    throw new Error("Provider APIs require HTTPS (HTTP is allowed only on loopback)");
  }
  return url.toString().replace(/\/$/, "");
}

export function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}

export function string(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a nonempty string`);
  return value;
}

export class JsonApi {
  constructor(readonly provider: string, readonly base: string, private readonly fetcher: HttpFetch = globalThis.fetch) {}

  async request<T>(path: string, credential: string, method = "GET", body?: unknown): Promise<T> {
    if (!credential) throw new Error(`${this.provider} requires an identity credential`);
    let response: Response;
    try {
      response = await this.fetcher(`${this.base}${path}`, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
        headers: {
          "Content-Type": "application/json",
          ...(this.provider === "GitHub" ? {
            Accept: "application/vnd.github+json", Authorization: `Bearer ${credential}`,
            "X-GitHub-Api-Version": "2022-11-28",
          } : { "PRIVATE-TOKEN": credential }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new Error(`${this.provider} request could not complete${method === "GET" ? "" : "; mutation outcome is unknown; reconcile before retrying"}`);
    }
    if (!response.ok) throw new ProviderHttpError(this.provider, response.status, method !== "GET" && response.status >= 500);
    if (response.status === 204) return undefined as T;
    try { return await response.json() as T; }
    catch { throw new Error(`${this.provider} returned an invalid JSON response`); }
  }
}
