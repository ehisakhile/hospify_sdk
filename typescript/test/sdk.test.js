import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";

import { Hospify, HospifyError } from "../dist/index.js";
import { HospifyServer, verifyWebhook } from "../dist/server.js";

/** A tiny stand-in for api.hospify.cloud that records what the SDK sends. */
function fakeApi() {
  const calls = [];
  const state = { status: "open", responder: null, expiredOnce: true };
  const json = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const sos = () => ({ id: "inc_7", status: state.status, escalation_step: 0, livemode: false, acknowledged_at: null,
                       responder: state.responder, closed_at: null, outcome: state.status === "resolved" ? "resolved" : null, created_at: "2026-11-14T09:00:00Z" });
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method ?? "GET", path: u.pathname, query: Object.fromEntries(u.searchParams), body, headers: init.headers });
    const auth = init.headers.Authorization;
    if (u.pathname === "/v1/org/sos" && auth === "Bearer hst_old" && state.expiredOnce) {
      state.expiredOnce = false;
      return json(401, { error: { code: "session_expired", message: "This session has expired." } });
    }
    if (u.pathname === "/v1/org/sos") return json(201, sos());
    if (u.pathname === "/v1/org/sos/inc_7") return json(200, sos());
    if (u.pathname === "/v1/org/sos/inc_7/location") return json(204);
    if (u.pathname === "/v1/org/sos/inc_7/safe") { state.status = "resolved"; return json(200, sos()); }
    if (u.pathname.startsWith("/v1/org/agents/")) return json(200, { external_id: decodeURIComponent(u.pathname.split("/")[4]), display_name: body?.display_name });
    if (u.pathname === "/v1/org/account") return json(403, { error: { code: "kyb_required", message: "Live keys need your business verification (KYB) approved." } });
    return json(404, { error: { code: "not_found", message: "No route" } });
  };
  return { fetch, calls, state };
}

const here = { current: async () => ({ latitude: 6.6018, longitude: 3.3515, accuracy_m: 12, battery: 41 }) };

test("the app refuses a secret key", () => {
  assert.throws(() => Hospify.start({ publishableKey: "hsk_live_x", getToken: async () => "hst_x" }), (e) => e.code === "invalid_key");
});

test("an SOS sends the location and the publishable key, and refreshes an expired token once", async () => {
  const api = fakeApi();
  let tokens = ["hst_old", "hst_new"];
  const hospify = Hospify.start({ publishableKey: "hpk_test_abc", getToken: async () => tokens.shift(), fetch: api.fetch, location: here,
                                  locationEveryMs: 20, pollEveryMs: 20 });
  assert.equal(hospify.testMode, true);
  const updates = [];
  hospify.sos.onUpdate((s) => updates.push(s.responder));
  const s = await hospify.sos.start({ note: "Need help" });
  assert.equal(s.id, "inc_7");
  const sent = api.calls.filter((c) => c.path === "/v1/org/sos");
  assert.equal(sent.length, 2); // 401 session_expired, then again with a fresh token
  assert.equal(sent[1].headers.Authorization, "Bearer hst_new");
  assert.equal(sent[1].headers["Hospify-Publishable-Key"], "hpk_test_abc");
  assert.deepEqual([sent[1].body.latitude, sent[1].body.battery, sent[1].body.note], [6.6018, 41, "Need help"]);

  api.state.responder = "Kunle Ade"; // a supervisor picks it up
  await new Promise((r) => setTimeout(r, 80));
  assert.ok(updates.includes("Kunle Ade"));
  assert.ok(api.calls.some((c) => c.path === "/v1/org/sos/inc_7/location"));

  const closed = await hospify.sos.safe();
  assert.equal(closed.status, "resolved");
  const n = api.calls.length;
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(api.calls.length, n); // tracking stopped
  hospify.stop();
});

test("the server client sends the secret key and your ids, and errors carry the API's code", async () => {
  const api = fakeApi();
  assert.throws(() => new HospifyServer({ secretKey: "hpk_test_x" }), (e) => e instanceof HospifyError);
  const hospify = new HospifyServer({ secretKey: "hsk_test_s", fetch: api.fetch });
  const a = await hospify.agents.upsert("AGT/20 931", { display_name: "Field agent" });
  assert.equal(a.external_id, "AGT/20 931");
  assert.equal(api.calls[0].path, "/v1/org/agents/AGT%2F20%20931");
  assert.equal(api.calls[0].headers.Authorization, "Bearer hsk_test_s");
  await assert.rejects(hospify.account(), (e) => e.code === "kyb_required" && e.status === 403);
});

test("webhook signatures: the real one passes, anything else fails", async () => {
  const secret = "whsec_test";
  const body = JSON.stringify({ id: "evt_1", type: "incident.created", livemode: false, created_at: "2026-11-14T09:00:00Z", data: { id: "inc_7" } });
  const t = Math.floor(Date.now() / 1000);
  const header = `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
  const ev = await verifyWebhook(body, header, secret);
  assert.equal(ev.type, "incident.created");
  await assert.rejects(verifyWebhook(body + " ", header, secret), (e) => e.code === "invalid_signature");
  await assert.rejects(verifyWebhook(body, header, "whsec_other"), (e) => e.code === "invalid_signature");
  const old = t - 3600;
  const stale = `t=${old},v1=${createHmac("sha256", secret).update(`${old}.${body}`).digest("hex")}`;
  await assert.rejects(verifyWebhook(body, stale, secret), (e) => /too old/.test(e.message));
});
