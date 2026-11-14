// End to end: the TypeScript SDK against a local copy of the real Org API
// (hospify_api: .venv/bin/python -m tests.sdk_contract_server). Usage: node e2e/flow.mjs '<keys json>'
import assert from "node:assert/strict";
import { Hospify } from "../dist/index.js";
import { HospifyServer } from "../dist/server.js";

const { secret, publishable, base_url: baseUrl } = JSON.parse(process.argv[2]);
const server = new HospifyServer({ secretKey: secret, baseUrl });

const account = await server.account();
assert.equal(account.live_allowed, false); // KYB pending: test only
await server.agents.upsert("AGT-20931", { display_name: "Field agent, Ikeja", team: "Ikeja" });
const batch = await server.agents.batch([{ external_id: "AGT-2", display_name: "Agent Yaba" }]);
assert.equal(batch.created, 1);
const agents = [];
for await (const a of server.allAgents()) agents.push(a.external_id);
assert.deepEqual(agents.sort(), ["AGT-20931", "AGT-2"].sort());

const app = Hospify.start({
  publishableKey: publishable, baseUrl, locationEveryMs: 200, pollEveryMs: 200,
  getToken: async () => (await server.sessions.create("AGT-20931")).token,
  location: { current: async () => ({ latitude: 6.6018, longitude: 3.3515, accuracy_m: 12, battery: 41 }) },
});
const seen = [];
app.sos.onUpdate((s) => seen.push(s.status));
const sos = await app.sos.start({ note: "Followed after a visit" });
assert.equal(sos.status, "open");

// The partner's back office sees it and acknowledges.
const open = await server.incidents.list({ status: "open" });
assert.equal(open.data[0].agent.external_id, "AGT-20931");
await server.incidents.acknowledge(sos.id, { by: "Control room" });
await new Promise((r) => setTimeout(r, 700));
assert.ok(seen.includes("acknowledged"), `the app heard the acknowledgement (saw ${seen})`);

const closed = await app.sos.safe("Home now");
assert.equal(closed.outcome, "resolved");
const detail = await server.incidents.get(sos.id, { trail: true });
assert.ok(detail.trail.length >= 2, "location kept flowing while it was open");
const types = (await server.events.list()).data.map((e) => e.type);
for (const t of ["incident.created", "incident.acknowledged", "incident.safe"]) assert.ok(types.includes(t), `${t} in the feed`);
await server.agents.remove("AGT-20931");
await assert.rejects(server.agents.get("AGT-20931"), (e) => e.code === "agent_not_found");
app.stop();
console.log("E2E OK:", types.join(" -> "));
