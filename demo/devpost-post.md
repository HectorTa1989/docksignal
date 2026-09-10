# DockSignal: Devpost submission post

Copy each section into the matching Devpost field. Items marked **TODO** need your input.

---

## Project name

DockSignal

## Tagline

When a delivery misses its dock window, DockSignal calls the driver and the receiving dock through CALL-E and turns what they say into a verified recovery plan, with a human-approved follow-up call.

## Inspiration

Every logistics desk knows the exception loop. The truck is late, the tracking portal says nothing, and someone spends half an hour phoning the driver, the carrier, and the receiving dock, then retyping what they heard into a chat thread nobody can audit. The facts that decide what happens next live in phone calls: where the truck is, the real arrival time, and whether the dock will still take the load. CALL-E makes those calls programmable, so we built the whole workflow around them.

## What it does

1. **Intake.** An operator opens a delayed-shipment incident: shipment, promised dock time, receiving cutoff, and the driver's and dock's numbers, which they must own or be authorized to call.
2. **Inspectable call plan.** Before anything rings, DockSignal shows each call's goal, questions, boundaries, exact CALL-E task text, strict result schema, and idempotency key. The operator ticks an authorization box and confirms the recipients in a dialog.
3. **Concurrent CALL-E calls.** The driver and the receiving dock are called at the same time. The assistant says it is an AI calling for the named organisation.
4. **Provider-backed results.** Terminal webhooks are deduplicated by `CALL-E-Event-Id`, and DockSignal re-fetches `GET /v1/calls/{call_id}` with its server key before changing anything. A late webhook can be replaced by a one-click re-check, and a duplicate delivery changes nothing.
5. **Recovery card.** A deterministic rules engine combines only facts from contacts who were actually reached: location, revised ETA, blocker, receiving window, next steps, and confidence. Every fact links to its call ID and evidence. Unknowns stay unknown, disagreements are marked conflicted, and vague times like "later this afternoon" are never turned into clock times.
6. **Human approval gate.** If the revised ETA is after the dock's cutoff, DockSignal suggests a follow-up call asking the dock for an exception, but never places it on its own. The operator approves it in a dialog, and their name and time are stored on the call.
7. **Close-out.** The dock's answer, including any window, fee, or condition, is recorded as a result, never as an agreement. The incident closes with a timestamped decision log and a downloadable Markdown summary with masked phone numbers.

## How we built it

- Next.js 15 (App Router and route handlers), React 19, TypeScript, and Tailwind v4.
- PostgreSQL through Drizzle ORM, with SQL migrations. Unique constraints on the idempotency key, the provider call ID, and the webhook event ID make every retry safe.
- The CALL-E Developer API is called directly from server code with Bearer auth, a stable `Idempotency-Key` per incident and contact, a strict `recipient_result_schema` with `unknown` enum values, correlation `metadata`, and a per-call `webhook_url`. The API key can only be sent to CALL-E's own HTTPS origin.
- A reconciliation job (Vercel Cron, plus on-demand polling from the incident page) covers lost or late webhooks.
- 39 automated tests run real PostgreSQL SQL in-process through PGlite. They prove idempotent dispatch across refreshes, restarts, and concurrent launches; duplicate-webhook safety; a fetched snapshot overriding a conflicting webhook body; the approval gate; and every branch of the rules engine.

## Challenges we ran into

Keeping the synthesis honest. Speech is vague, so DockSignal parses only exact clock times. Two contacts can disagree, so the fact becomes conflicted instead of silently picking one. CALL-E returns `structured_result: null` when validation fails, so the app shows a validation failure rather than a fact. Webhooks are not signed yet, so the trust boundary is a fresh `GET /v1/calls/{call_id}` with the server key, never the webhook body.

## Accomplishments that we're proud of

- No mock mode ships in the app: without a valid CALL-E key, calling is blocked and no result can appear.
- Refreshing, double-clicking, or restarting never creates a second call.
- The call that could change a dock appointment always waits for a person.

## What we learned

Strict recipient schemas with good `description` text and an explicit `unknown` value make extraction dependable. With no cancel endpoint, call waves should be small and deliberate. `failure_code` is not an enum, so "no answer" and "declined" have to stay unresolved rather than be guessed.

## What's next for DockSignal

The carrier dispatcher as a routine third call, using the conflict handling already in place. A job queue for reconciliation at volume. A TMS webhook that opens an incident automatically when a dock appointment is missed.

## Built with

`call-e` · `nextjs` · `react` · `typescript` · `postgresql` · `drizzle-orm` · `tailwindcss` · `vitest` · `vercel`

## Links

- Code: https://github.com/HectorTa1989/docksignal
- Community contribution (required PR): https://github.com/CALLE-AI/awesome-phone-call-agents/pull/436
- Demo video: **TODO** (upload `demo/docksignal-demo.mp4` to YouTube or Vimeo as public or unlisted, then paste the link)
- Live app: **TODO** (optional; add once it is deployed)

## About the demo video

The video is a walkthrough of the real DockSignal app. Every screen is a production build of this repository, driven through its real UI and API routes against a throwaway database.

The phone calls are simulated. The voices are synthetic (Kokoro-82M), and the CALL-E responses come from a local stand-in for `api.heycall-e.com`. It feeds DockSignal's unchanged code the same request and response shapes the real API uses, including webhooks and the re-fetch. The video labels every call "SIMULATED CALL · synthetic voices" and says so on the end card.

To show real calls instead, run the two-phone test in `TESTING.md` with your CALL-E key and add the resulting call IDs here.

---

## Devpost form fields

- **Testing instructions for application:**

  ```text
  1. git clone https://github.com/HectorTa1989/docksignal && cd docksignal && npm install
  2. Run the automated suite (no credentials needed): npm test  -> 39 tests pass.
  3. For real calls: copy .env.example to .env.local and set DATABASE_URL, CALLE_API_KEY,
     and PUBLIC_BASE_URL (HTTPS). No PostgreSQL? Run npm run dev:db and use
     DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5499/postgres with DATABASE_POOL_MAX=1.
  4. npm run db:migrate && npm run dev, then open http://localhost:3000.
     /api/health must show "calle.state": "accepted".
  5. Create an incident with two numbers you control, tick the authorization box, and launch.
     Answer as the driver (give a time after the cutoff) and as the dock (state the cutoff).
  6. Watch the incident room reach "Completed", open the recovery card, approve the follow-up
     call, then download the Markdown summary. Without a public URL, results still arrive
     through polling: npm run reconcile -- --watch.
  ```

- **Functional demo URL:** **TODO** (optional)
- **Project submission pull request URL:** https://github.com/CALLE-AI/awesome-phone-call-agents/pull/436
- **Email associated with CALL-E account:** **TODO** (use the email you actually signed up to CALL-E with)
- **Primary use case:** Logistics / operations exception handling
- **One-sentence real-world task:** When a delivery misses its dock window, call the driver and the receiving dock, verify the revised ETA and cutoff, and get a human-approved dock exception.

---

## YouTube or Vimeo description

```text
DockSignal: logistics exception commander built on the CALL-E Developer API.

When a delivery misses its dock window, DockSignal calls the driver and the receiving dock
concurrently, reconciles every result against the CALL-E API, and turns only the supported facts
into a recovery card. The follow-up call that could change the dock appointment waits for a human.

0:00 Intake
0:11 Call plan and authorization
0:24 Driver call and result
1:03 Dock call
1:37 Re-check and recovery card
1:51 Human approval
2:02 Follow-up call
2:36 Outcome and summary
2:54 Close-out

Walkthrough of the real app. The phone calls in this video use synthetic voices and simulated
CALL-E responses.

Code: https://github.com/HectorTa1989/docksignal
```
