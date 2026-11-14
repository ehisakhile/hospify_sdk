import assert from "node:assert/strict";
import { test } from "node:test";
import { communityLocation, expoLocation } from "../dist/index.js";

test("expo-location: asks permission once, gives fixes, stops watching", async () => {
  let asked = 0, removed = false, cb;
  const Location = {
    Accuracy: { High: 4 },
    requestForegroundPermissionsAsync: async () => (asked++, { status: "granted" }),
    getCurrentPositionAsync: async () => ({ coords: { latitude: 9.0765, longitude: 7.3986, accuracy: 9 } }),
    watchPositionAsync: async (_o, fn) => ((cb = fn), { remove: () => (removed = true) }),
  };
  const loc = expoLocation(Location, async () => 77);
  assert.deepEqual(await loc.current(), { latitude: 9.0765, longitude: 7.3986, accuracy_m: 9, battery: 77 });
  const fixes = [];
  const stop = loc.watch((f) => fixes.push(f));
  await new Promise((r) => setTimeout(r, 10));
  cb({ coords: { latitude: 9.08, longitude: 7.4, accuracy: 5 } });
  await new Promise((r) => setTimeout(r, 10));
  stop();
  assert.equal(fixes[0].latitude, 9.08);
  assert.equal(removed, true);
  assert.equal(asked, 1);
});

test("expo-location: permission refused means no location, not an error", async () => {
  const loc = expoLocation({ requestForegroundPermissionsAsync: async () => ({ status: "denied" }) });
  assert.equal(await loc.current(), null);
});

test("community geolocation: fixes and clearWatch", async () => {
  let cleared = null;
  const Geo = {
    getCurrentPosition: (ok) => ok({ coords: { latitude: 6.45, longitude: 3.39, accuracy: 20 } }),
    watchPosition: () => 42,
    clearWatch: (id) => (cleared = id),
  };
  const loc = communityLocation(Geo);
  assert.equal((await loc.current()).accuracy_m, 20);
  loc.watch(() => undefined)();
  assert.equal(cleared, 42);
});
