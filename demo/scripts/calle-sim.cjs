/**
 * Capture-only preload for the DockSignal server process. It answers requests to the CALL-E
 * origin from a JSON state file instead of the network, the same way tests/helpers.ts fakes
 * the HTTP boundary. DockSignal's own code is unchanged: it still sends Bearer auth and an
 * Idempotency-Key, persists the returned call id, deduplicates webhooks, and re-fetches
 * GET /v1/calls/{id} before applying anything.
 *
 * The capture script (scripts/capture.ts) moves calls to in_progress / completed by editing
 * CALLE_SIM_STATE and then delivers webhooks to the app like CALL-E would.
 *
 * This file is never loaded by the deployed app. The walkthrough video labels every call it
 * produces as simulated.
 */
require("./time-shift.cjs");
const fs = require("node:fs");

const STATE = process.env.CALLE_SIM_STATE;
const ORIGIN = "https://api.heycall-e.com";
if (!STATE) throw new Error("calle-sim.cjs needs CALLE_SIM_STATE");

const realFetch = globalThis.fetch;
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function newId(prefix) {
  let s = "";
  for (let i = 0; i < 22; i += 1) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return `${prefix}_${s}`;
}
function load() {
  return JSON.parse(fs.readFileSync(STATE, "utf8"));
}
function save(state) {
  fs.writeFileSync(`${STATE}.tmp`, JSON.stringify(state, null, 2));
  fs.renameSync(`${STATE}.tmp`, STATE);
}
function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

globalThis.fetch = async function calleSimFetch(input, init = {}) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith(`${ORIGIN}/`)) return realFetch(input, init);

  const method = String(init.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
  const headers = new Headers(init.headers ?? {});
  const pathname = new URL(url).pathname;
  await new Promise((resolve) => setTimeout(resolve, 150)); // network round trip

  if (!(headers.get("authorization") ?? "").startsWith("Bearer ")) {
    return json(401, { error: { code: "unauthorized", message: "Missing bearer token" } });
  }

  if (method === "POST" && pathname === "/v1/calls") {
    const body = JSON.parse(String(init.body));
    const key = headers.get("idempotency-key");
    const state = load();
    state.requests.push({ at: new Date().toISOString(), method, pathname, idempotencyKey: key, metadata: body.metadata, webhook_url: body.webhook_url });
    if (key && state.byKey[key]) {
      save(state);
      return json(200, state.calls[state.byKey[key]]);
    }
    const now = new Date().toISOString();
    const call = {
      id: newId("call"),
      object: "call_task",
      status: "queued",
      task: body.task,
      recipients: body.recipients.map((r) => ({
        id: newId("rcp"),
        phones: r.phones,
        locale: r.locale ?? null,
        region: r.region ?? null,
        status: "queued",
        structured_result: null,
        summary: null,
        attempts: [],
      })),
      structured_result: null,
      summary: null,
      task_completed: null,
      completion_confidence: null,
      evidence: [],
      metadata: body.metadata ?? {},
      failure_code: null,
      failure_message: null,
      created_at: now,
      completed_at: null,
    };
    state.calls[call.id] = call;
    if (key) state.byKey[key] = call.id;
    save(state);
    return json(201, call);
  }

  const match = pathname.match(/^\/v1\/calls\/([^/]+)$/);
  if (method === "GET" && match) {
    const id = decodeURIComponent(match[1]);
    const call = load().calls[id];
    return call ? json(200, call) : json(404, { error: { code: "not_found", message: `No call task ${id}` } });
  }
  return json(404, { error: { code: "not_found", message: "Unknown route" } });
};
