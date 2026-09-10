# DockSignal

**Logistics exception commander.** When a delivery misses its dock window, DockSignal calls the people who actually hold the missing facts (driver, receiving dock, optionally carrier dispatch) through the [CALL-E Developer API](https://docs.heycall-e.com), reconciles every terminal result against `GET /v1/calls/{call_id}`, and turns only the supported facts into one auditable recovery card. A follow-up call that could change the dock appointment is suggested, never placed, until a human approves it.

Built for **CALL-E: Your Code Is Calling**, targeting the *Most Practical Use Case* prize.

- Three screens: **intake + inspectable call plan**, **live incident room**, **recovery card with approval**.
- Real calls only. There is no mock mode, no fake transcript, no timer that pretends a call finished. Missing or rejected credentials block calling and show a setup state.
- Idempotent by construction: stable `Idempotency-Key` per incident and contact, unique provider call id, unique webhook event id, single-row dispatch claim. Refreshing, double-clicking, or restarting the app never creates a second call.
- Explainable rules engine: empty strings and `unknown` stay unresolved, disagreeing sources are labelled **conflicted**, vague ETAs are never turned into clock times, and every displayed fact links to its CALL-E call id and evidence.

## Contents

- [Quick start](#quick-start)
- [Environment variables](#environment-variables)
- [Real-call safety](#real-call-safety)
- [How a call flows](#how-a-call-flows)
- [Architecture](#architecture)
- [Decision rules](#decision-rules)
- [Testing](#testing) (details in [TESTING.md](TESTING.md))
- [Deployment](#deployment)
- [What is real, what is manual, what we learned](#what-is-real-what-is-manual-what-we-learned)
- Demo: [DEMO_SCRIPT.md](DEMO_SCRIPT.md) · Devpost: [DEVPOST.md](DEVPOST.md) · CALL-E feedback: [CALLE_FEEDBACK.md](CALLE_FEEDBACK.md) · Community contribution: [community/](community/), submitted as [CALLE-AI/awesome-phone-call-agents#436](https://github.com/CALLE-AI/awesome-phone-call-agents/pull/436)

## Quick start

Requirements: Node 20.18+ (22 recommended), a PostgreSQL database, a CALL-E API key, and a public HTTPS URL for webhooks.

```bash
npm install
cp .env.example .env.local        # fill in DATABASE_URL, CALLE_API_KEY, PUBLIC_BASE_URL
npm run db:migrate                # applies drizzle/*.sql
npm run db:seed                   # optional: incident DS-1042 metadata only, never calls
npm run dev                       # http://localhost:3000
```

No PostgreSQL installed? `npm run dev:db` starts an in-process PGlite server on port 5499 (development only) and you can point `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5499/postgres` at it with `DATABASE_POOL_MAX=1`.

Local development still needs CALL-E to reach your webhook. Either expose the dev server over HTTPS (for example `cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000`) and set `PUBLIC_BASE_URL` to that origin, or rely on the reconciliation job: `npm run reconcile -- --watch` polls `GET /v1/calls/{call_id}` for every open call every five seconds. The incident page also reconciles stale open calls on every poll, so results appear even when the webhook cannot reach you.

Open `/api/health` to see whether the CALL-E key was **accepted** (verified with a side-effect-free `GET /v1/calls/<impossible id>` that must return `not_found`), the webhook URL CALL-E will be given, and whether the database is reachable.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string (Neon, Supabase, RDS, local). Server-only. |
| `CALLE_API_KEY` | yes | CALL-E Developer API key (`iams_live_…`). Server-only, never sent to the browser. Without it calling is blocked. |
| `PUBLIC_BASE_URL` | yes, except on Vercel | Public HTTPS origin of this deployment. Webhook URL is `${PUBLIC_BASE_URL}/api/webhooks/calle`. On Vercel it defaults to `https://$VERCEL_PROJECT_PRODUCTION_URL`. |
| `DATABASE_POOL_MAX` | no | Connection pool size, default 5. Set to 1 for the PGlite dev server. |
| `CRON_SECRET` | production | Any long random string. Bearer secret for `/api/jobs/reconcile`; Vercel Cron sends it automatically. |
| `CALLE_BASE_URL` | no | Override the API base (default `https://api.heycall-e.com`). Only an `https://*.heycall-e.com` origin is accepted; anything else blocks calling so the key can never be sent to another host. |
| `DOCKSIGNAL_ORG_NAME` | no | Organisation the AI assistant identifies itself as calling for. |
| `DEMO_DRIVER_PHONE`, `DEMO_DOCK_PHONE`, `DEMO_DISPATCHER_PHONE` | no | Pre-fill the intake form with numbers you own or are authorized to call, so no number is typed on camera or committed to git. |
| `DEMO_TIMEZONE` | no | Default incident timezone (IANA), default `Asia/Singapore`. |

There is no variable that enables a mock, fixture, or demo-data mode. Test fixtures live only under `tests/` and are never importable by application code. The walkthrough video tooling in [`demo/`](demo/) simulates the CALL-E boundary from outside the app, for recording only; see [demo/README.md](demo/README.md).

## Real-call safety

- **Authorization checkbox.** Launching requires the operator to confirm, per incident, that every recipient is a number they own or are authorized to call. The confirmation text is stored in `incidents.authorization_text` and the audit log.
- **Exact recipient and goal before dispatch.** The call plan shows the E.164 number, the goal, the questions, the boundaries, the exact `task` text, the `recipient_result_schema`, the `Idempotency-Key`, and the webhook URL. The confirm dialog repeats recipients and goals.
- **AI identification.** Every task text starts with an instruction to say, in the first sentence, that the caller is an AI assistant calling on behalf of the named organisation.
- **Never emergency services.** E.164 validation plus an explicit emergency-number rejection (`lib/phone.ts`).
- **Never fabricated agreement.** Task texts forbid claiming agreement that was not explicitly stated; the rules engine only uses provider-backed results where `reached = yes`.
- **Consequential follow-ups need a human.** The dock exception / new slot call exists only as a suggestion until an operator ticks the approval box in a dialog and the server receives `humanApproved: true`. The approver and time are stored on the call task and the recovery action.
- **Fact-finding calls change nothing.** They may not book, confirm, move, or cancel appointments or discuss fees. The follow-up call may record a fee or condition but may not agree to it.
- **Numbers are masked** in the incident room, recovery card, decision log, and Markdown summary. The full number appears only in the intake form and the pre-dispatch confirmation dialog.

## How a call flows

```mermaid
sequenceDiagram
  autonumber
  participant Op as Operator (browser)
  participant DS as DockSignal server (Next.js route handlers)
  participant DB as PostgreSQL
  participant CE as CALL-E API
  participant Ph as Driver / Dock phone

  Op->>DS: POST /api/incidents/DS-1042/launch {authorizationConfirmed: true}
  DS->>DB: INSERT call_tasks (id, idempotency_key) ON CONFLICT DO NOTHING
  DS->>DB: UPDATE call_tasks SET status='dispatching' WHERE provider_call_id IS NULL (claim)
  DS->>CE: POST /v1/calls  Idempotency-Key: docksignal:DS-1042:<contact>:fact_finding:v1
  CE-->>DS: 201 call_task {id: call_…, status: queued}
  DS->>DB: UPDATE call_tasks SET provider_call_id=call_… (unique)
  DS-->>Op: tasks with provider call ids
  CE->>Ph: real phone call, AI identifies itself
  Ph-->>CE: answers
  CE-->>DS: POST /api/webhooks/calle  CALL-E-Event-Id: evt_… {type: call.completed, data: call_task}
  DS->>DB: INSERT call_events (id=evt_…) ON CONFLICT DO NOTHING  (duplicate → 200, no side effect)
  DS->>CE: GET /v1/calls/call_…  (authoritative snapshot)
  CE-->>DS: 200 call_task {summary, task_completed, completion_confidence, evidence, recipients[].structured_result, attempts[].transcript_turns}
  DS->>DB: UPDATE call_tasks; REPLACE observations; INSERT audit_entries; UPDATE call_events.processed_at
  DS-->>CE: 200
  loop daily (Vercel Cron, every minute on Pro) and on every incident poll for stale open calls
    DS->>CE: GET /v1/calls/call_… for open tasks
    DS->>DB: apply snapshot (never regresses a terminal task)
  end
  Op->>DS: GET /api/incidents/DS-1042 (rules engine → recovery card, actions upserted)
  Op->>DS: POST /api/incidents/DS-1042/follow-up {actionCode, humanApproved: true}
  DS->>DB: recovery_actions.status=approved, approved_by
  DS->>CE: POST /v1/calls (follow-up, Idempotency-Key …:follow_up:<action>:v1)
```

## Architecture

```
app/                      Next.js 15 App Router
  page.tsx                intake + call plan preview (screen 1)
  incidents/[id]/page.tsx incident console: call plan / incident room / recovery card
  api/incidents           create, view (with opportunistic reconcile), edit recipients (draft only)
  api/incidents/[id]/launch     fact-finding wave (authorization gate)
  api/incidents/[id]/follow-up  approved follow-up call (human gate)
  api/incidents/[id]/close, summary, reconcile
  api/webhooks/calle      terminal webhook receiver
  api/jobs/reconcile      reconciliation job (Vercel Cron, CRON_SECRET)
  api/health              setup state (key accepted / rejected / missing, DB, webhook URL)
lib/
  calle.ts        typed CALL-E client (create, get, credential probe), zod-validated snapshots
  plan.ts         call plan: goals, questions, boundaries, exact task text, idempotency keys
  result-schema.ts strict recipient_result_schema + validation + unresolved rule
  dispatch.ts     claim → create → persist provider id; launch wave; approved follow-up
  webhook.ts      dedupe by CALL-E-Event-Id, reconcile via GET, apply snapshot
  reconcile.ts    poll open tasks
  rules.ts        deterministic rules engine → recovery card, branch, actions, confidence
  repository.ts   all SQL (Drizzle) incl. observations, recovery actions, audit
  incident-view.ts read model used by the UI and the Markdown summary
  markdown.ts     downloadable summary
  time.ts, phone.ts, env.ts, status.ts, intake.ts, server.ts
db/schema.ts      incidents, contacts, call_tasks, call_events, observations, recovery_actions, audit_entries
drizzle/          SQL migrations (drizzle-kit generate)
tests/            vitest; PGlite runs the real migrations in-process
community/        contribution for CALLE-AI/awesome-phone-call-agents
```

Core invariants enforced in the schema: `call_tasks.idempotency_key` unique, `call_tasks.provider_call_id` unique, `call_events.id` (the provider event id) primary key, `observations (call_task_id, field)` unique, `recovery_actions (incident_id, code)` unique, `contacts (incident_id, role)` unique.

Task status vocabulary: `queued`, `dispatching`, `dispatch_failed`, `in_progress`, `completed`, `failed`, `result_validation_failed`, `canceled`. A completed call whose recipient `structured_result` is `null` or does not match the contract is `result_validation_failed`, never `completed`. The webhook event type is only a hint; the fetched snapshot decides.

## Decision rules

Implemented in `lib/rules.ts`, exercised by `tests/rules.test.ts`.

1. Only fact-finding calls with status `completed`, a schema-valid result, `reached = yes`, and `shipment_recognized ≠ no` contribute facts. Everything else is listed under *unresolved sources* with the reason.
2. Empty strings and `unknown` are unresolved. A fact with no resolved source is **unresolved**.
3. `revised_eta` from driver and dispatcher is parsed only if it is an exact clock time (`16:40`, `4:40 pm`, ISO). Vague speech stays text and is never compared to the cutoff.
4. If driver and dispatcher give different ETAs the fact is **conflicted**; the branch becomes *eta_conflicted* and the only action is to resolve it manually. DockSignal never picks one.
5. The receiving cutoff comes from the dock call (`revised_eta` on the dock result) and falls back to the intake cutoff, which lowers confidence and is labelled as such.
6. Branches: `awaiting_results`, `eta_unresolved`, `eta_conflicted`, `dock_unresolved`, `cutoff_unknown`, `window_missed` (ETA after cutoff → suggest **request_dock_exception**, a follow-up call that needs approval), `dock_declined` (→ **request_new_slot**, needs approval), `within_window` (→ driver calls dock 30 minutes out, manual). After a follow-up: `exception_granted`, `follow_up_declined`, `follow_up_unresolved`.
7. Confidence is the minimum of the contacts' stated certainty and CALL-E's `completion_confidence` for the sources actually used, lowered when the cutoff is unverified or a key fact is unresolved. Reasons are shown.

## Testing

```bash
npm test          # vitest: rules, contract, phone/time helpers, dispatch idempotency, webhook dedupe, reconciliation
npm run lint      # tsc --noEmit
npm run build     # next build
```

See [TESTING.md](TESTING.md) for the manual real-call checklist, the duplicate-webhook replay, and the restart test.

## Deployment

DockSignal is a standard Next.js app with PostgreSQL. The reference target is **Vercel + Neon**, and the Vercel Hobby plan is enough.

1. In Vercel, import this repository as a new project and deploy it once.
2. In the project's **Storage** tab, create a **Neon** database and connect it to the project. This sets `DATABASE_URL`.
3. In **Settings → Environment Variables** (Production), add `CALLE_API_KEY` and `CRON_SECRET` (any long random string). `PUBLIC_BASE_URL` is optional on Vercel; the webhook URL defaults to the production domain. Optionally add the `DEMO_*` variables.
4. Redeploy. The `vercel-build` script applies the SQL migrations before `next build`.
5. Open `/api/health`; `calle.state` must be `accepted` and `webhookUrl` must point at your domain.

From the CLI instead: `vercel login`, `vercel link`, `vercel env add CALLE_API_KEY production`, `vercel env add CRON_SECRET production`, connect Neon in the dashboard, then `vercel --prod`.

`vercel.json` schedules the reconciliation cron daily, because the Hobby plan rejects more frequent crons. Webhooks and the incident page's own polling keep open calls current; on Pro you can set the schedule to `* * * * *`.

Deploying requires accounts and secrets that only the operator holds; the repository does not contain a deployed URL until you add it here: **Deployed app: _add URL_**.

## What is real, what is manual, what we learned

**Real.** Every call is created with `POST https://api.heycall-e.com/v1/calls` using the server-side key. Provider call ids, summaries, `task_completed`, `completion_confidence`, `evidence`, recipient `structured_result`, attempt `transcript_turns`, and failure codes come from CALL-E's terminal snapshot fetched with `GET /v1/calls/{call_id}`. Webhook deliveries are stored with their `CALL-E-Event-Id`. The rules engine runs on those results only.

**Manual.** Deployment and secrets. The demo phones must be answered by people who agreed to act as driver and dock. Recovery actions marked *manual* (notify dispatcher, resolve an ETA conflict, brief the driver) are for the operator; DockSignal does not automate them. Closing the incident and downloading the summary are operator actions.

**CALL-E observations** (details in [CALLE_FEEDBACK.md](CALLE_FEEDBACK.md)): webhooks carry no signature, so we authenticate content by re-fetching; there is no cancel endpoint, so a launched wave runs to completion; `failure_code` has no published enum, so failed calls are shown as failed without inferring "no answer" or "declined"; recipient results are `null` on validation failure with no detail, so the incident room shows *validation failed* rather than guessing what went wrong.
