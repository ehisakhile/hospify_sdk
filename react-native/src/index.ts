/**
 * @hospify/org-sdk-react-native: Hospify for Organisations SOS in React Native.
 *
 *   import * as Location from "expo-location";
 *   import { Hospify, expoLocation, useHospifySos } from "@hospify/org-sdk-react-native";
 *
 *   const hospify = Hospify.start({ publishableKey: "hpk_test_...", getToken: api.hospifyToken, location: expoLocation(Location) });
 *   const { state, start, safe, busy, error } = useHospifySos(hospify);
 *
 * Docs: https://developers.hospify.africa/docs/react-native
 */
import { useCallback, useEffect, useState } from "react";
import { Hospify, HospifyError, type LocationFix, type LocationProvider, type SosState } from "@hospify/org-sdk";

export * from "@hospify/org-sdk";

/** The parts of expo-location this uses (pass the module: import * as Location from "expo-location"). */
export interface ExpoLocationModule {
  requestForegroundPermissionsAsync(): Promise<{ status: string }>;
  getCurrentPositionAsync(options?: { accuracy?: number }): Promise<{ coords: { latitude: number; longitude: number; accuracy: number | null } }>;
  watchPositionAsync(options: { accuracy?: number; timeInterval?: number; distanceInterval?: number },
                     cb: (p: { coords: { latitude: number; longitude: number; accuracy: number | null } }) => void): Promise<{ remove(): void }>;
  Accuracy?: { High?: number };
}

/** Location from expo-location. Asks for permission the first time it's needed. */
export function expoLocation(Location: ExpoLocationModule, battery?: () => Promise<number | null>): LocationProvider {
  let allowed: boolean | null = null;
  const ok = async () => (allowed ??= (await Location.requestForegroundPermissionsAsync()).status === "granted");
  const accuracy = Location.Accuracy?.High;
  const fix = async (c: { latitude: number; longitude: number; accuracy: number | null }): Promise<LocationFix> =>
    ({ latitude: c.latitude, longitude: c.longitude, accuracy_m: c.accuracy, battery: battery ? await battery().catch(() => null) : null });
  return {
    current: async () => {
      if (!(await ok())) return null;
      try {
        return await fix((await Location.getCurrentPositionAsync({ accuracy })).coords);
      } catch {
        return null;
      }
    },
    watch: (onFix) => {
      let sub: { remove(): void } | null = null;
      let stopped = false;
      void ok().then(async (yes) => {
        if (!yes || stopped) return;
        sub = await Location.watchPositionAsync({ accuracy, timeInterval: 5000, distanceInterval: 5 }, (p) => void fix(p.coords).then(onFix));
        if (stopped) sub.remove();
      });
      return () => {
        stopped = true;
        sub?.remove();
      };
    },
  };
}

/** The parts of @react-native-community/geolocation this uses (pass its default export). */
export interface CommunityGeolocation {
  getCurrentPosition(ok: (p: { coords: { latitude: number; longitude: number; accuracy: number } }) => void, err: (e: unknown) => void,
                     options?: object): void;
  watchPosition(ok: (p: { coords: { latitude: number; longitude: number; accuracy: number } }) => void, err?: (e: unknown) => void,
                options?: object): number;
  clearWatch(id: number): void;
}

/** Location from @react-native-community/geolocation (ask for permission in your app first). */
export function communityLocation(Geolocation: CommunityGeolocation, battery?: () => Promise<number | null>): LocationProvider {
  const fix = async (c: { latitude: number; longitude: number; accuracy: number }): Promise<LocationFix> =>
    ({ latitude: c.latitude, longitude: c.longitude, accuracy_m: c.accuracy, battery: battery ? await battery().catch(() => null) : null });
  return {
    current: () =>
      new Promise((resolve) => {
        Geolocation.getCurrentPosition((p) => void fix(p.coords).then(resolve), () => resolve(null),
                                       { enableHighAccuracy: true, timeout: 8000, maximumAge: 15000 });
      }),
    watch: (onFix) => {
      const id = Geolocation.watchPosition((p) => void fix(p.coords).then(onFix), () => undefined,
                                           { enableHighAccuracy: true, distanceFilter: 5, interval: 5000 });
      return () => Geolocation.clearWatch(id);
    },
  };
}

export interface UseHospifySos {
  /** The agent's SOS, or null. */
  state: SosState | null;
  /** True while it's open or acknowledged. */
  isOpen: boolean;
  busy: boolean;
  error: HospifyError | null;
  start: (note?: string) => Promise<void>;
  safe: (note?: string) => Promise<void>;
  cancel: (note?: string) => Promise<void>;
}

/** State and actions for an SOS button. Picks up an SOS left open (say after the app was killed) on mount. */
export function useHospifySos(hospify: Hospify): UseHospifySos {
  const [state, setState] = useState<SosState | null>(hospify.sos.current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<HospifyError | null>(null);

  useEffect(() => {
    const off = hospify.sos.onUpdate(setState);
    hospify.sos.resume().then((s) => s && setState(s)).catch(() => undefined);
    return off;
  }, [hospify]);

  const run = useCallback(async (fn: () => Promise<SosState>) => {
    setBusy(true);
    setError(null);
    try {
      setState(await fn());
    } catch (e) {
      setError(e instanceof HospifyError ? e : new HospifyError("unknown", String(e), 0));
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    state,
    isOpen: !!state && (state.status === "open" || state.status === "acknowledged"),
    busy,
    error,
    start: (note) => run(() => hospify.sos.start({ note })),
    safe: (note) => run(() => hospify.sos.safe(note)),
    cancel: (note) => run(() => hospify.sos.cancel(note)),
  };
}
