import { call, defaultFetch, DEFAULT_BASE_URL, HospifyError, type FetchLike } from "./http.js";
import type { Agent, HospifyEvent, Incident, Page } from "./types.js";

export { HospifyError } from "./http.js";
export * from "./types.js";

export interface HospifyServerOptions {
  /** Your secret key: hsk_test_... or hsk_live_... Keep it on your server. */
  secretKey: string;
  baseUrl?: string;
  fetch?: FetchLike;
}

export interface AgentInput {
  /** What supervisors see. An alias is fine. Required when creating. */
  display_name?: string;
  team?: string | null;
  site?: string | null;
  active?: boolean;
}

export interface Account {
  organisation: { id: number; name: string };
  livemode: boolean;
  kyb: "pending" | "approved" | "rejected";
  live_allowed: boolean;
  live_blocked_reason: string | null;
}

export interface Session {
  token: string;
  expires_in: number;
  agent: Agent;
}

const enc = encodeURIComponent;

/**
 * Hospify for Organisations on your server: onboard agents, give your app session tokens,
 * and run your own back office (incidents, actions, the event feed).
 *
 *   const hospify = new HospifyServer({ secretKey: process.env.HOSPIFY_SECRET_KEY! });
 *   await hospify.agents.upsert("AGT-20931", { display_name: "Field agent, Ikeja", team: "Ikeja" });
 *   const { token } = await hospify.sessions.create("AGT-20931");
 */
export class HospifyServer {
  private readonly key: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: HospifyServerOptions) {
    if (!options?.secretKey?.startsWith("hsk_")) {
      throw new HospifyError("invalid_key", "Use your secret key (hsk_test_... or hsk_live_...) on your server.", 0);
    }
    this.key = options.secretKey;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchImpl = options.fetch ?? defaultFetch();
  }

  private req<T>(path: string, opts: Parameters<typeof call>[4] = {}): Promise<T> {
    return call<T>(this.fetchImpl, this.baseUrl, `/v1/org${path}`, this.key, opts);
  }

  /** Your organisation, test or live, and whether KYB lets you go live. */
  account(): Promise<Account> {
    return this.req<Account>("/account");
  }

  readonly agents = {
    /** Create the agent, or update the fields you send. Uses YOUR id for the person. */
    upsert: (externalId: string, input: AgentInput) => this.req<Agent>(`/agents/${enc(externalId)}`, { method: "PUT", body: input }),
    /** Up to 500 at once. */
    batch: (agents: (AgentInput & { external_id: string })[]) =>
      this.req<{ created: number; updated: number; errors: { external_id: string; code: string; message: string }[] }>(
        "/agents/batch", { method: "POST", body: { agents } }),
    get: (externalId: string) => this.req<Agent>(`/agents/${enc(externalId)}`),
    list: (params: { active?: boolean; limit?: number; after?: string } = {}) => this.req<Page<Agent>>("/agents", { query: params }),
    /** Removes the agent and erases everything Hospify holds about them. */
    remove: (externalId: string) => this.req<void>(`/agents/${enc(externalId)}`, { method: "DELETE" }),
  };

  /** Every agent, page by page: for await (const a of hospify.allAgents()) { ... } */
  async *allAgents(params: { active?: boolean } = {}): AsyncGenerator<Agent> {
    let after: string | undefined;
    for (;;) {
      const page = await this.agents.list({ ...params, limit: 500, after });
      yield* page.data;
      if (!page.has_more || !page.next) return;
      after = page.next;
    }
  }

  readonly sessions = {
    /** A one hour session token for the agent's app. Call it when they sign in, and when the SDK asks again. */
    create: (externalId: string) => this.req<Session>(`/agents/${enc(externalId)}/sessions`, { method: "POST" }),
  };

  readonly incidents = {
    list: (params: { status?: "open" | "closed" | "all"; limit?: number; after?: string } = {}) =>
      this.req<Page<Incident>>("/incidents", { query: params }),
    /** With the timeline; trail: every location point. */
    get: (id: string, options: { trail?: boolean } = {}) => this.req<Incident>(`/incidents/${enc(id)}`, { query: { trail: options.trail } }),
    acknowledge: (id: string, input: { note?: string; by?: string } = {}) =>
      this.req<Incident>(`/incidents/${enc(id)}/acknowledge`, { method: "POST", body: input }),
    note: (id: string, input: { note: string; by?: string }) => this.req<Incident>(`/incidents/${enc(id)}/notes`, { method: "POST", body: input }),
    resolve: (id: string, input: { outcome?: "resolved" | "false_alarm"; note?: string; by?: string } = {}) =>
      this.req<Incident>(`/incidents/${enc(id)}/resolve`, { method: "POST", body: input }),
  };

  readonly events = {
    /** The event feed, oldest first. Keep the last id and pass it as after to catch up. */
    list: (params: { after?: string; type?: string; limit?: number } = {}) =>
      this.req<{ data: HospifyEvent[]; has_more: boolean }>("/events", { query: params }),
  };
}

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Checks a webhook really came from Hospify and returns the event. Pass the raw request body
 * (the exact text, before JSON parsing), the Hospify-Signature header and your webhook secret (whsec_...).
 * Throws HospifyError("invalid_signature") otherwise. Works in Node 18+, Deno, Bun and edge runtimes.
 */
export async function verifyWebhook(rawBody: string, signatureHeader: string | null | undefined, secret: string,
                                    toleranceSeconds = 300): Promise<HospifyEvent> {
  const parts = Object.fromEntries((signatureHeader ?? "").split(",").map((p) => p.trim().split("=", 2) as [string, string]));
  const t = Number(parts.t);
  if (!parts.v1 || !Number.isFinite(t)) throw new HospifyError("invalid_signature", "Missing or malformed Hospify-Signature header.", 400);
  if (Math.abs(Date.now() / 1000 - t) > toleranceSeconds) {
    throw new HospifyError("invalid_signature", "The webhook is too old. Check your server's clock.", 400);
  }
  // Node 18 has Web Crypto in node:crypto but not as a global (that came in Node 19).
  const subtle: SubtleCrypto | undefined =
    globalThis.crypto?.subtle ??
    (await import("node:crypto" as string).then((m: any) => m.webcrypto?.subtle).catch(() => undefined));
  if (!subtle) throw new HospifyError("no_crypto", "This runtime has no Web Crypto. Use Node 18 or later.", 0);
  const key = await subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = hex(await subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${rawBody}`)));
  if (!safeEqual(mac, parts.v1)) throw new HospifyError("invalid_signature", "The signature doesn't match. Check your webhook secret.", 400);
  return JSON.parse(rawBody) as HospifyEvent;
}
