import { call, defaultFetch, DEFAULT_BASE_URL, HospifyError, type FetchLike, type RequestOptions } from "./http.js";
import type { Agent, SosState } from "./types.js";

/** A position from the device. */
export interface LocationFix {
  latitude: number;
  longitude: number;
  accuracy_m?: number | null;
  /** Battery percentage, 0 to 100, if you know it. */
  battery?: number | null;
}

/**
 * Where the agent is. In a browser the SDK uses navigator.geolocation by default; React Native
 * and other platforms pass their own (see @hospify/org-sdk-react-native).
 */
export interface LocationProvider {
  /** One fix now, or null if location is off or refused. */
  current(): Promise<LocationFix | null>;
  /** Optional: continuous fixes while an SOS is open. Returns a function that stops watching. */
  watch?(onFix: (fix: LocationFix) => void): () => void;
}

export interface HospifyOptions {
  /** Your publishable key: hpk_test_... or hpk_live_... */
  publishableKey: string;
  /** Asks YOUR server for a session token for the signed-in agent (it calls POST /v1/org/agents/{id}/sessions). */
  getToken: () => Promise<string>;
  /** How to read the device's location. false: send none. */
  location?: LocationProvider | false;
  /** How often to send location while an SOS is open (default 10 s). */
  locationEveryMs?: number;
  /** How often to check who's responding while an SOS is open (default 5 s). */
  pollEveryMs?: number;
  baseUrl?: string;
  fetch?: FetchLike;
}

export interface MeResult {
  agent: Agent;
  open_sos: SosState | null;
}

type Listener = (state: SosState) => void;

/** Browser location, when there is one. */
export function browserLocation(): LocationProvider | null {
  const geo = typeof navigator !== "undefined" ? navigator.geolocation : undefined;
  if (!geo) return null;
  const battery = async (): Promise<number | null> => {
    try {
      const b = await (navigator as any).getBattery?.();
      return b ? Math.round(b.level * 100) : null;
    } catch {
      return null;
    }
  };
  const toFix = async (p: GeolocationPosition): Promise<LocationFix> => ({
    latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy_m: p.coords.accuracy, battery: await battery(),
  });
  return {
    current: () =>
      new Promise((resolve) => {
        geo.getCurrentPosition((p) => toFix(p).then(resolve), () => resolve(null), { enableHighAccuracy: true, timeout: 8000, maximumAge: 15000 });
      }),
    watch: (onFix) => {
      const id = geo.watchPosition((p) => void toFix(p).then(onFix), () => undefined, { enableHighAccuracy: true, maximumAge: 5000 });
      return () => geo.clearWatch(id);
    },
  };
}

/**
 * Hospify SOS inside your app.
 *
 *   const hospify = Hospify.start({ publishableKey: "hpk_test_...", getToken: () => api.hospifyToken() });
 *   await hospify.sos.start({ note: "Need help" });
 */
export class Hospify {
  readonly sos: Sos;
  private readonly opts: Required<Omit<HospifyOptions, "location" | "fetch" | "baseUrl">> & { baseUrl: string };
  private readonly fetchImpl: FetchLike;
  readonly location: LocationProvider | null;
  private token: string | null = null;
  private tokenPromise: Promise<string> | null = null;

  static start(options: HospifyOptions): Hospify {
    return new Hospify(options);
  }

  constructor(options: HospifyOptions) {
    if (!options?.publishableKey?.startsWith("hpk_")) {
      throw new HospifyError("invalid_key", "Use your publishable key (hpk_test_... or hpk_live_...) in the app. Never the secret key.", 0);
    }
    if (typeof options.getToken !== "function") {
      throw new HospifyError("missing_get_token", "Pass getToken: a function that asks your server for the agent's session token.", 0);
    }
    this.opts = {
      publishableKey: options.publishableKey,
      getToken: options.getToken,
      locationEveryMs: options.locationEveryMs ?? 10_000,
      pollEveryMs: options.pollEveryMs ?? 5_000,
      baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
    };
    this.fetchImpl = options.fetch ?? defaultFetch();
    this.location = options.location === false ? null : options.location ?? browserLocation();
    this.sos = new Sos(this);
  }

  /** True for hpk_test_ keys: the whole flow runs, nobody is alerted. */
  get testMode(): boolean {
    return this.opts.publishableKey.startsWith("hpk_test_");
  }

  get settings() {
    return this.opts;
  }

  private async sessionToken(fresh = false): Promise<string> {
    if (this.token && !fresh) return this.token;
    if (!this.tokenPromise) {
      this.tokenPromise = this.opts.getToken().then(
        (t) => {
          this.tokenPromise = null;
          if (!t || !t.startsWith("hst_")) {
            throw new HospifyError("invalid_session", "getToken must return the session token (hst_...) from your server.", 0);
          }
          this.token = t;
          return t;
        },
        (e) => {
          this.tokenPromise = null;
          throw e instanceof HospifyError ? e : new HospifyError("token_failed", "Couldn't get a session token from your server.", 0);
        },
      );
    }
    return this.tokenPromise;
  }

  /** An agent call: refreshes the session token once if it has expired. */
  async request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const send = async (fresh: boolean) =>
      call<T>(this.fetchImpl, this.opts.baseUrl, path, await this.sessionToken(fresh), {
        ...opts,
        headers: { "Hospify-Publishable-Key": this.opts.publishableKey, ...(opts.headers ?? {}) },
      });
    try {
      return await send(false);
    } catch (e) {
      if (e instanceof HospifyError && e.status === 401 && (e.code === "session_expired" || e.code === "invalid_session")) {
        this.token = null;
        return send(true);
      }
      throw e;
    }
  }

  /** The signed-in agent, and their open SOS if there is one. */
  me(): Promise<MeResult> {
    return this.request<MeResult>("/v1/org/me");
  }

  /** Stops location and status timers (for example when the agent signs out). */
  stop(): void {
    this.sos.stopTracking();
    this.token = null;
  }
}

export class Sos {
  private state: SosState | null = null;
  private listeners = new Set<Listener>();
  private locationTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private stopWatch: (() => void) | null = null;
  private lastFix: LocationFix | null = null;
  private sending = false;

  constructor(private readonly h: Hospify) {}

  /** The agent's SOS as last seen, or null. */
  get current(): SosState | null {
    return this.state;
  }

  get isOpen(): boolean {
    return !!this.state && (this.state.status === "open" || this.state.status === "acknowledged");
  }

  /**
   * Raises an SOS (or updates the agent's open one) with their location, then keeps sending location
   * and checking who is responding until it's closed.
   */
  async start(options: { note?: string } = {}): Promise<SosState> {
    const fix = this.h.location ? await this.h.location.current().catch(() => null) : null;
    if (fix) this.lastFix = fix;
    const state = await this.h.request<SosState>("/v1/org/sos", {
      method: "POST",
      body: { note: options.note, latitude: fix?.latitude, longitude: fix?.longitude, accuracy_m: fix?.accuracy_m ?? undefined,
              battery: fix?.battery ?? undefined },
    });
    this.set(state);
    this.track();
    return state;
  }

  /** The agent is safe: closes the SOS and tells everyone who was alerted. */
  async safe(note?: string): Promise<SosState> {
    return this.close("safe", note);
  }

  /** Raised by mistake: closes it as a false alarm and tells everyone who was alerted. */
  async cancel(note?: string): Promise<SosState> {
    return this.close("cancel", note);
  }

  /** After an app restart: picks up an SOS that's still open and carries on tracking it. */
  async resume(): Promise<SosState | null> {
    const me = await this.h.me();
    if (me.open_sos) {
      this.set(me.open_sos);
      this.track();
    }
    return me.open_sos;
  }

  /** Asks Hospify now: is anyone responding? */
  async refresh(): Promise<SosState | null> {
    if (!this.state) return null;
    const state = await this.h.request<SosState>(`/v1/org/sos/${this.state.id}`);
    this.set(state);
    return state;
  }

  /** Called whenever the SOS changes: acknowledged, escalated, closed. Returns a function that unsubscribes. */
  onUpdate(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  stopTracking(): void {
    if (this.locationTimer) clearInterval(this.locationTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.stopWatch?.();
    this.locationTimer = this.pollTimer = null;
    this.stopWatch = null;
  }

  private async close(action: "safe" | "cancel", note?: string): Promise<SosState> {
    if (!this.state) throw new HospifyError("no_sos", "There's no SOS to close.", 0);
    const state = await this.h.request<SosState>(`/v1/org/sos/${this.state.id}/${action}`, { method: "POST", body: note ? { note } : {} });
    this.set(state);
    this.stopTracking();
    return state;
  }

  private set(state: SosState): void {
    const changed = JSON.stringify(state) !== JSON.stringify(this.state);
    this.state = state;
    if (changed) for (const l of this.listeners) l(state);
    if (!this.isOpen) this.stopTracking();
  }

  private track(): void {
    if (!this.isOpen || this.pollTimer) return;
    const { locationEveryMs, pollEveryMs } = this.h.settings;
    const loc = this.h.location;
    if (loc?.watch) this.stopWatch = loc.watch((fix) => (this.lastFix = fix));
    if (loc) {
      this.locationTimer = setInterval(() => void this.sendLocation(), locationEveryMs);
    }
    this.pollTimer = setInterval(() => void this.refresh().catch(() => undefined), pollEveryMs);
  }

  private async sendLocation(): Promise<void> {
    if (!this.state || this.sending || !this.h.location) return;
    this.sending = true;
    try {
      const fix = this.h.location.watch && this.lastFix ? this.lastFix : await this.h.location.current();
      if (!fix) return;
      this.lastFix = fix;
      await this.h.request<void>(`/v1/org/sos/${this.state.id}/location`, {
        method: "POST",
        body: { latitude: fix.latitude, longitude: fix.longitude, accuracy_m: fix.accuracy_m ?? undefined, battery: fix.battery ?? undefined },
      });
    } catch (e) {
      if (e instanceof HospifyError && e.code === "incident_closed") await this.refresh().catch(() => undefined);
    } finally {
      this.sending = false;
    }
  }
}
