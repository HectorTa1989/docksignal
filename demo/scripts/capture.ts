/**
 * Drives the real DockSignal UI through the whole incident and records, for every state, a
 * screenshot plus the page-coordinate rectangles the video needs for the cursor and the
 * highlight boxes. Output: public/shots/*.png, public/capture.json, public/summary.md.
 *
 * Only the CALL-E boundary is simulated (scripts/calle-sim.cjs). The app is a production
 * build of this repository talking to a throwaway in-memory PostgreSQL.
 *
 *   npm run capture            # builds the app first
 *   npm run capture -- --skip-build
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright-core";
import { layoutCall, transcriptTurns, type VoiceManifest } from "../src/callLayout";
import { CALLS, RESULTS, SUMMARIES, type CallKey } from "../src/dialogue";

const demo = path.resolve(import.meta.dirname, "..");
const root = path.resolve(demo, "..");
const pub = path.join(demo, "public");
const shotsDir = path.join(pub, "shots");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "docksignal-capture-"));
const STATE = path.join(work, "calle-state.json");
const CLOCK = path.join(work, "clock.json");
const PORT = 3100;
const DB_PORT = 5510;
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORT = { width: 1280, height: 720 };
const DPR = 2;
const TZ = "Asia/Singapore";
const manifest = JSON.parse(fs.readFileSync(path.join(pub, "audio", "manifest.json"), "utf8")) as VoiceManifest;

type Rect = { x: number; y: number; w: number; h: number };
interface Shot {
  file: string;
  /** Page y of the image's top edge (0 for full-page shots, scrollY for viewport shots). */
  originY: number;
  height: number;
  pageHeight: number;
  scrollY: number;
  path: string;
  rects: Record<string, Rect>;
}
const shots: Record<string, Shot> = {};
const children: ChildProcess[] = [];

// ---------------------------------------------------------------- scenario clock
function sgtToday(h: number, m: number, s: number) {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const pad = (n: number) => String(n).padStart(2, "0");
  return new Date(`${ymd}T${pad(h)}:${pad(m)}:${pad(s)}+08:00`).getTime();
}
let offsetMs = sgtToday(15, 1, 30) - Date.now();
const simNow = () => Date.now() + offsetMs;
const iso = (ms: number) => new Date(ms).toISOString();
const writeClock = () => fs.writeFileSync(CLOCK, JSON.stringify({ offsetMs }));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- simulated CALL-E state
type SimCall = Record<string, any>;
interface SimState {
  calls: Record<string, SimCall>;
  byKey: Record<string, string>;
  requests: Array<Record<string, unknown>>;
}
const readState = () => JSON.parse(fs.readFileSync(STATE, "utf8")) as SimState;
const writeState = (s: SimState) => {
  fs.writeFileSync(`${STATE}.tmp`, JSON.stringify(s, null, 2));
  fs.renameSync(`${STATE}.tmp`, STATE);
};
function callFor(kind: "fact_finding" | "follow_up", role: string): SimCall {
  const call = Object.values(readState().calls).find((c) => c.metadata?.kind === kind && c.metadata?.contact_role === role);
  if (!call) throw new Error(`No simulated ${kind} call for ${role}`);
  return call;
}
function rid(prefix: string) {
  const a = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  return `${prefix}_${Array.from({ length: 22 }, () => a[Math.floor(Math.random() * a.length)]).join("")}`;
}
function setInProgress(callId: string) {
  const s = readState();
  const call = s.calls[callId]!;
  const r = call.recipients[0];
  call.status = "in_progress";
  r.status = "in_progress";
  r.attempts = [{ id: rid("att"), phone: r.phones[0], status: "in_progress", started_at: iso(simNow()), completed_at: null, summary: null, transcript_turns: [], provider_call_id: rid("pc"), failure_code: null, failure_message: null }];
  writeState(s);
}
function completeCall(callId: string, key: CallKey) {
  const s = readState();
  const call = s.calls[callId]!;
  const r = call.recipients[0];
  const timeline = layoutCall(manifest, key, CALLS[key].lines);
  const end = simNow();
  const info = SUMMARIES[key];
  const attempt = r.attempts[0] ?? { id: rid("att"), phone: r.phones[0], provider_call_id: rid("pc") };
  r.status = "completed";
  r.structured_result = { ...RESULTS[key] };
  r.summary = info.summary;
  r.attempts = [
    {
      ...attempt,
      status: "completed",
      started_at: iso(end - Math.round(timeline.total * 1000)),
      completed_at: iso(end),
      summary: info.summary,
      transcript_turns: transcriptTurns(timeline, CALLS[key].lines),
      failure_code: null,
      failure_message: null,
    },
  ];
  Object.assign(call, { status: "completed", summary: info.summary, task_completed: true, completion_confidence: info.confidence, evidence: info.evidence, completed_at: iso(end) });
  writeState(s);
}
async function deliverWebhook(callId: string, eventId = rid("evt")) {
  const data = readState().calls[callId];
  const res = await fetch(`${BASE}/api/webhooks/calle`, {
    method: "POST",
    headers: { "content-type": "application/json", "CALL-E-Event-Id": eventId },
    body: JSON.stringify({ id: eventId, type: "call.completed", created_at: iso(simNow()), data }),
  });
  const body = await res.json();
  console.log(`  webhook ${eventId} -> ${res.status} ${JSON.stringify(body)}`);
  if (!res.ok) throw new Error(`Webhook ${eventId} was rejected`);
  return eventId;
}

// ---------------------------------------------------------------- processes
function start(name: string, args: string[], env: NodeJS.ProcessEnv, cwd: string, readyText: RegExp): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    children.push(child);
    const onData = (chunk: Buffer) => {
      const text = chunk.toString();
      for (const line of text.split(/\r?\n/).filter(Boolean)) console.log(`  [${name}] ${line.slice(0, 200)}`);
      if (readyText.test(text)) resolve();
    };
    child.stdout!.on("data", onData);
    child.stderr!.on("data", onData);
    child.on("exit", (code) => reject(new Error(`${name} exited with ${code}`)));
  });
}
function stopAll() {
  for (const child of children) if (!child.killed) child.kill();
}

// ---------------------------------------------------------------- page helpers
let page: Page;
let context: BrowserContext;
let browser: Browser | null = null;

async function advance(seconds: number) {
  offsetMs += seconds * 1000;
  writeClock();
  await context.clock.setSystemTime(simNow());
  await sleep(350);
}

async function rectOf(loc: Locator): Promise<Rect> {
  await loc.first().waitFor({ state: "visible", timeout: 15_000 });
  return loc.first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) };
  });
}

async function snap(id: string, rects: Record<string, Locator>, opts: { viewport?: boolean } = {}) {
  await page.waitForTimeout(400);
  const measured: Record<string, Rect> = {};
  for (const [name, loc] of Object.entries(rects)) measured[name] = await rectOf(loc);
  const { scrollY, pageHeight } = await page.evaluate(() => ({ scrollY: Math.round(window.scrollY), pageHeight: document.documentElement.scrollHeight }));
  const file = `shots/${id}.png`;
  await page.screenshot({ path: path.join(pub, file), fullPage: !opts.viewport, animations: "disabled", caret: "hide" });
  shots[id] = {
    file,
    originY: opts.viewport ? scrollY : 0,
    height: opts.viewport ? VIEWPORT.height : pageHeight,
    pageHeight,
    scrollY,
    path: new URL(page.url()).pathname,
    rects: measured,
  };
  console.log(`  shot ${id.padEnd(22)} ${opts.viewport ? "viewport" : "full"} h=${shots[id].height} rects=${Object.keys(measured).join(",")}`);
}

const CAPTURE_CSS = `
  footer { display: none !important; }
  div:has(> code.mono) { display: none !important; }
  *, *::before, *::after { transition: none !important; caret-color: transparent !important; }
  .animate-pulse { animation: none !important; }
`;

// ---------------------------------------------------------------- main
async function main() {
  fs.rmSync(shotsDir, { recursive: true, force: true });
  fs.mkdirSync(shotsDir, { recursive: true });
  writeClock();
  writeState({ calls: {}, byKey: {}, requests: [] });

  const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
  if (!process.argv.includes("--skip-build")) {
    console.log("Building DockSignal (production)...");
    execFileSync(process.execPath, [nextBin, "build"], { cwd: root, stdio: "inherit" });
  }

  const timeShift = path.join(demo, "scripts", "time-shift.cjs");
  const calleSim = path.join(demo, "scripts", "calle-sim.cjs");
  console.log("Starting capture database and DockSignal...");
  await start("db", ["--require", timeShift, path.join(demo, "scripts", "capture-db.mjs")], { ...process.env, SIM_CLOCK_FILE: CLOCK, CAPTURE_DB_PORT: String(DB_PORT) }, demo, /capture-db ready/);
  await start(
    "app",
    [nextBin, "start", "-p", String(PORT), "-H", "127.0.0.1"],
    {
      ...process.env,
      NODE_ENV: "production",
      NODE_OPTIONS: `--require ${calleSim}`,
      CALLE_SIM_STATE: STATE,
      SIM_CLOCK_FILE: CLOCK,
      TZ,
      DATABASE_URL: `postgres://postgres:postgres@127.0.0.1:${DB_PORT}/postgres`,
      DATABASE_POOL_MAX: "1",
      CALLE_API_KEY: "sim_capture_key_not_a_real_key",
      PUBLIC_BASE_URL: "https://docksignal.example.com",
      DOCKSIGNAL_ORG_NAME: "Northwind Freight Operations",
      DEMO_TIMEZONE: TZ,
      DEMO_DRIVER_PHONE: " ",
      DEMO_DOCK_PHONE: " ",
      DEMO_DISPATCHER_PHONE: "+1 202 555 0126",
    },
    root,
    /Ready in|started server|Local:/,
  );
  const health = await (await fetch(`${BASE}/api/health`)).json();
  console.log(`  health: ${JSON.stringify(health)}`);
  if (!health.canCall) throw new Error("App is not ready to call; check the simulated boundary");

  offsetMs = sgtToday(15, 1, 30) - Date.now();
  writeClock();
  await sleep(400);
  browser = await chromium.launch({ channel: "chrome", headless: true });
  context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: DPR, timezoneId: TZ, locale: "en-US", colorScheme: "dark", acceptDownloads: true });
  await context.clock.install({ time: simNow() });
  await context.addInitScript({
    content: `(() => {
      const css = ${JSON.stringify(CAPTURE_CSS)};
      const add = () => { const style = document.createElement("style"); style.textContent = css; document.documentElement.appendChild(style); };
      if (document.documentElement) add(); else document.addEventListener("DOMContentLoaded", add);
    })();`,
  });
  page = await context.newPage();
  page.on("pageerror", (e) => console.log(`  [browser error] ${e.message}`));

  // ---------------- 1. Intake
  console.log("1. Intake");
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  const form = page.locator("form");
  const operator = page.getByLabel("Operator name");
  const phones = page.locator('input[placeholder="+12025550123"]');
  const create = page.getByRole("button", { name: /Create incident/ });
  await snap("home", { hero: page.locator("section").first(), form, formTitle: form.locator("h2"), promised: page.getByLabel("Promised dock time"), cutoff: page.getByLabel("Receiving cutoff"), operator, driverPhone: phones.nth(0), dockPhone: phones.nth(1), contacts: phones.nth(0).locator("xpath=../.."), create });
  await operator.fill("Dana Lim");
  await snap("home_operator", { operator });
  await phones.nth(0).fill("+1 202 555 0147");
  await snap("home_driver", { driverPhone: phones.nth(0) });
  await phones.nth(1).fill("+1 202 555 0183");
  await snap("home_dock", { dockPhone: phones.nth(1), create });
  await advance(25);
  await create.click();
  await page.waitForURL(/\/incidents\/DS-1042/);
  await page.waitForLoadState("networkidle");

  // ---------------- 2. Call plan
  console.log("2. Call plan");
  const headerChip = page.locator("h1.mono + span.chip");
  const planItems = page.locator("ol.space-y-3 > li");
  const inspect = planItems.nth(0).getByRole("button", { name: /Inspect exact/ });
  const authLabel = page.locator("aside label").first();
  const launch = page.getByRole("button", { name: "Launch fact-finding calls" });
  await snap("plan", { headerChip, header: page.locator("h1.mono").locator("xpath=../.."), tabs: page.locator("div.grid.grid-cols-3").first(), planPanel: page.locator("div.panel", { hasText: "Fact-finding wave" }), planDriver: planItems.nth(0), planDock: planItems.nth(1), inspect, safety: page.locator("aside div.panel").first(), authLabel, launch });
  await inspect.click();
  await snap("plan_inspect", {
    inspect: planItems.nth(0).getByRole("button", { name: /exact CALL-E task text/ }),
    taskText: planItems.nth(0).locator("pre").nth(0),
    idempotency: planItems.nth(0).getByText("Idempotency-Key", { exact: true }).locator("xpath=.."),
    webhook: planItems.nth(0).getByText("Webhook", { exact: true }).locator("xpath=.."),
    schema: planItems.nth(0).locator("pre").nth(1),
    questions: planItems.nth(0).locator("ul").nth(0),
    boundaries: planItems.nth(0).locator("ul").nth(1),
  });
  await page.locator("aside input[type=checkbox]").check();
  await snap("plan_auth", { authLabel, launch, checkbox: page.locator("aside input[type=checkbox]") });
  await advance(35);
  await launch.click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  await snap("plan_confirm", { dialog: dialog.locator("div.panel"), recipientDriver: dialog.locator("li").nth(0), recipientDock: dialog.locator("li").nth(1), confirm: dialog.getByRole("button", { name: /Yes, place/ }) }, { viewport: true });
  await dialog.getByRole("button", { name: /Yes, place/ }).click();
  await page.getByText("CALL-E call id").first().waitFor();

  // ---------------- 3. Incident room
  console.log("3. Incident room");
  const cards = page.locator("div.panel.p-4").filter({ hasText: "CALL-E call id" });
  const driverCard = cards.filter({ hasText: "Driver on SHP-88214" });
  const dockCard = cards.filter({ hasText: "Receiving desk, Dock 7" }).filter({ hasNotText: "Follow-up" });
  const chipOf = (card: Locator) => card.locator("span.chip").first();
  const kv = (card: Locator, label: string) => card.getByText(label, { exact: true }).locator("xpath=..");
  const webhooksChip = page.locator("span.chip", { hasText: "webhooks processed" });
  const terminalChip = page.locator("span.chip", { hasText: "terminal:" });
  await snap("room_calling", { headerChip, driverCard, dockCard, driverChip: chipOf(driverCard), dockChip: chipOf(dockCard), driverCallId: kv(driverCard, "CALL-E call id"), dockCallId: kv(dockCard, "CALL-E call id"), driverKey: kv(driverCard, "Idempotency key"), counters: terminalChip.locator("xpath=.."), webhookPanel: page.locator("div.panel", { hasText: "Webhook deliveries" }) });

  const driverCall = callFor("fact_finding", "driver");
  const dockCall = callFor("fact_finding", "receiving_dock");
  setInProgress(driverCall.id);
  setInProgress(dockCall.id);
  const driverTimeline = layoutCall(manifest, "driver", CALLS.driver.lines);
  await advance(Math.round(driverTimeline.total) + 2);
  completeCall(driverCall.id, "driver");
  const driverEvent = await deliverWebhook(driverCall.id);
  await chipOf(driverCard).filter({ hasText: "Completed" }).waitFor({ timeout: 20_000 });
  const driverResult = driverCard.locator("div.grid.grid-cols-2");
  await snap("room_driver_done", { headerChip, driverCard, driverChip: chipOf(driverCard), driverSummary: driverCard.locator("div.mt-3", { hasText: "CALL-E summary" }), driverResult, etaRow: driverResult.locator(":scope > div", { hasText: "revised_eta" }), webhookRow: page.locator("tbody tr").nth(0), webhooksChip, terminalChip, transcriptButton: driverCard.getByRole("button", { name: /Show transcript/ }) });
  await driverCard.getByRole("button", { name: /Show transcript/ }).click();
  await snap("room_transcript", { transcript: driverCard.locator("ol"), transcriptButton: driverCard.getByRole("button", { name: /Hide transcript/ }), driverCard });

  // The dock call finishes a few seconds later; its webhook is slow, so the operator re-checks.
  // Let the page's own 3 s poll look at the dock call while it is still in progress, so the
  // operator's click (not the background poll) is what picks up the finished call.
  await advance(7);
  await page.waitForTimeout(3600);
  const recheck = page.getByRole("button", { name: /Re-check with CALL-E/ });
  await snap("room_before_recheck", { recheck, dockCard, dockChip: chipOf(dockCard) });
  completeCall(dockCall.id, "dock");
  await recheck.click();
  await page.getByText(/^Reconciliation:/).waitFor();
  const report = (await page.getByText(/^Reconciliation:/).textContent()) ?? "";
  console.log(`  ${report}`);
  if (!/updated 1/.test(report)) throw new Error("The re-check click did not reconcile the dock call; the background poll got there first");
  await chipOf(dockCard).filter({ hasText: "Completed" }).waitFor();
  const dockResult = dockCard.locator("div.grid.grid-cols-2");
  await snap("room_recheck", { recheck, report: page.getByText(/^Reconciliation:/), dockCard, dockChip: chipOf(dockCard), dockSummary: dockCard.locator("div.mt-3", { hasText: "CALL-E summary" }), dockResult, cutoffRow: dockResult.locator(":scope > div", { hasText: "revised_eta" }), terminalChip, headerChip });

  // CALL-E's webhook for the dock call arrives late, then CALL-E retries the same event id.
  await advance(5);
  const dockEvent = await deliverWebhook(dockCall.id);
  await advance(3);
  await deliverWebhook(dockCall.id, dockEvent);
  await page.locator("tbody tr").nth(1).waitFor({ timeout: 20_000 });
  await page.waitForTimeout(3500);
  await snap("room_webhooks", { webhookPanel: page.locator("div.panel", { hasText: "Webhook deliveries" }), row1: page.locator("tbody tr").nth(0), row2: page.locator("tbody tr").nth(1), webhooksChip, openRecovery: page.getByRole("button", { name: /Open recovery card/ }) });

  // ---------------- 4. Recovery card
  console.log("4. Recovery card");
  await advance(20);
  await page.getByRole("button", { name: /Open recovery card/ }).click();
  const situation = page.locator("div.panel", { has: page.getByText("Situation", { exact: true }) }).first();
  await situation.waitFor();
  const fact = (label: string) => page.locator("div.rounded-lg.p-3", { has: page.locator("span.font-semibold", { hasText: new RegExp(`^${label}$`) }) });
  const actions = page.locator("aside div.panel", { hasText: "Recovery actions" });
  const exceptionAction = actions.locator("li", { hasText: "Ask the dock to accept" });
  await snap("rec_missed", {
    headerChip,
    situation,
    branch: situation.locator("div.text-base"),
    etaGrid: situation.locator("div.grid").first(),
    etaBox: situation.locator("div.grid > div").nth(0),
    cutoffBox: situation.locator("div.grid > div").nth(1),
    gapBox: situation.locator("div.grid > div").nth(2),
    confidence: situation.locator("span.chip").first(),
    reasons: situation.locator("ul"),
    factLocation: fact("Current location / status"),
    factEta: fact("Revised ETA"),
    factBlocker: fact("Blocker / delay reason"),
    factWindow: fact("Receiving window"),
    factNext: fact("What contacts said they will do"),
    actions,
    exceptionAction,
    notifyAction: actions.locator("li", { hasText: "carrier dispatcher" }),
    approve: page.getByRole("button", { name: "Approve follow-up call" }),
  });
  await fact("Revised ETA").getByRole("button", { name: /Show 1 source/ }).click();
  await snap("rec_sources", { factEta: fact("Revised ETA"), sources: fact("Revised ETA").locator("ul").first(), sourceButton: fact("Revised ETA").getByRole("button", { name: /Hide 1 source/ }) });
  await advance(30);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole("button", { name: "Approve follow-up call" }).click();
  await dialog.waitFor();
  await snap("rec_approve", { dialog: dialog.locator("div.panel"), request: dialog.locator("div.rounded-md"), approveCheck: dialog.locator("label"), confirm: dialog.getByRole("button", { name: "Approve and place the call" }) }, { viewport: true });
  await dialog.locator("input[type=checkbox]").check();
  await snap("rec_approve_checked", { approveCheck: dialog.locator("label"), confirm: dialog.getByRole("button", { name: "Approve and place the call" }) }, { viewport: true });
  await dialog.getByRole("button", { name: "Approve and place the call" }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByText("Follow-up call to the dock in progress").waitFor();
  const outcome = page.locator("aside div.panel", { hasText: "Follow-up outcome" });
  const roomTab = page.getByRole("button", { name: /2 · Incident room/ });
  const recoveryTab = page.getByRole("button", { name: /3 · Recovery card/ });
  await snap("rec_followup", { headerChip, situation, branch: situation.locator("div.text-base"), outcome, outcomeChip: outcome.locator("span.chip").first(), roomTab });
  await roomTab.click();
  const followCard = cards.filter({ hasText: "Follow-up" });
  await followCard.waitFor();
  await snap("room_followup", { headerChip, followCard, followChip: chipOf(followCard), approval: kv(followCard, "Human approval"), followCallId: kv(followCard, "CALL-E call id") });

  const followCall = callFor("follow_up", "receiving_dock");
  setInProgress(followCall.id);
  const followTimeline = layoutCall(manifest, "followup", CALLS.followup.lines);
  await advance(Math.round(followTimeline.total) + 2);
  completeCall(followCall.id, "followup");
  const followEvent = await deliverWebhook(followCall.id);
  await chipOf(followCard).filter({ hasText: "Completed" }).waitFor({ timeout: 20_000 });
  const followResult = followCard.locator("div.grid.grid-cols-2");
  await snap("room_followup_done", { headerChip, followCard, followChip: chipOf(followCard), followSummary: followCard.locator("div.mt-3", { hasText: "CALL-E summary" }), followResult, windowRow: followResult.locator(":scope > div", { hasText: "revised_eta" }), conditionRow: followResult.locator(":scope > div", { hasText: "blocker" }), recoveryTab });
  await advance(12);
  await recoveryTab.click();
  await page.getByText("Dock accepted the revised arrival").waitFor({ timeout: 20_000 });
  const decisionLog = page.locator("div.panel", { hasText: "Decision log" });
  await snap("rec_granted", {
    headerChip,
    situation,
    branch: situation.locator("div.text-base"),
    outcome,
    outcomeChip: outcome.locator("span.chip").first(),
    outcomeWindow: outcome.getByText(/offered window/),
    outcomeCondition: outcome.getByText(/^condition:/),
    recordAction: actions.locator("li", { hasText: "Record the dock" }),
    decisionLog,
    logApproved: decisionLog.locator("li", { hasText: "recovery_action_approved" }).first(),
    download: page.getByRole("link", { name: "Download Markdown summary" }),
    close: page.getByRole("button", { name: "Close incident" }),
  });

  // ---------------- 5. Summary and close-out
  console.log("5. Summary and close");
  await advance(25);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download Markdown summary" }).click()]);
  await download.saveAs(path.join(pub, "summary.md"));
  await advance(15);
  await page.getByRole("button", { name: "Close incident" }).click();
  await dialog.waitFor();
  await dialog.locator("textarea").fill("Dock 3 exception accepted until 17:00. Driver briefed on the gate check-in.");
  await snap("rec_close", { dialog: dialog.locator("div.panel"), note: dialog.locator("textarea"), confirm: dialog.getByRole("button", { name: "Close incident" }) }, { viewport: true });
  await dialog.getByRole("button", { name: "Close incident" }).click();
  await page.getByRole("button", { name: "Incident closed" }).waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await snap("rec_closed", { headerChip, closed: page.getByRole("button", { name: "Incident closed" }), situation, decisionLog });

  // ---------------- sanity checks on the simulated boundary
  const state = readState();
  const creates = state.requests.filter((r) => r.method === "POST");
  const uniqueKeys = new Set(creates.map((r) => r.idempotencyKey));
  console.log(`CALL-E boundary: ${creates.length} create requests, ${uniqueKeys.size} idempotency keys, ${Object.keys(state.calls).length} calls`);
  if (Object.keys(state.calls).length !== 3) throw new Error("Expected exactly three calls");

  const capture = {
    capturedAt: new Date().toISOString(),
    scenarioStart: iso(sgtToday(15, 1, 30)),
    viewport: VIEWPORT,
    dpr: DPR,
    calls: { driver: driverCall.id, dock: dockCall.id, followup: followCall.id },
    events: { driver: driverEvent, dock: dockEvent, followup: followEvent },
    shots,
  };
  fs.writeFileSync(path.join(pub, "capture.json"), JSON.stringify(capture, null, 2));
  console.log(`Wrote ${Object.keys(shots).length} shots and public/capture.json`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await browser?.close().catch(() => undefined);
    stopAll();
    fs.rmSync(work, { recursive: true, force: true });
  });
