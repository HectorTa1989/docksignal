# DockSignal — Devpost description draft

## Tagline

When a delivery misses its dock window, DockSignal calls the driver and the dock through CALL-E, reconciles what they actually said, and hands the operator a verified recovery plan with a human-approved follow-up.

## Inspiration

Every logistics desk knows the exception loop: the truck is late, the portal says nothing, and someone spends half an hour phoning the driver, the carrier, and the receiving dock, then retyping it into a chat thread nobody can audit. The facts that matter (where the truck is, the real ETA, whether the dock will still take the load) live in phone calls. CALL-E makes those calls programmable, so we built the workflow around them.

## What it does

An operator files a delayed-shipment incident with authorized contacts. DockSignal shows an inspectable call plan (goal, questions, boundaries, exact task text, result schema, idempotency key), then places concurrent CALL-E calls to the driver and the receiving dock. Terminal webhooks are deduplicated by `CALL-E-Event-Id` and reconciled against `GET /v1/calls/{call_id}` before anything changes. A deterministic rules engine combines only supported facts into a recovery card: current location, revised ETA, blocker, receiving-window status, required action, owner, confidence. If the ETA is later than the dock's cutoff, it proposes a follow-up call to request an exception, and a human must approve it before it is placed. The incident closes with a timestamped decision log and a Markdown summary.

## How we built it

Next.js 15 (App Router, route handlers), TypeScript, Tailwind v4, PostgreSQL with Drizzle migrations, and the CALL-E Developer API called directly from server code with Bearer auth, a strict `recipient_result_schema`, correlation `metadata`, and a per-request `webhook_url`. A small reconciliation job (Vercel Cron plus on-demand polling) covers lost webhooks. Tests run against real PostgreSQL SQL in-process (PGlite) to prove idempotency and duplicate-webhook safety.

## Safety

Real numbers only with an explicit authorization confirmation; the assistant identifies itself as an AI acting for the named organisation; emergency numbers are rejected; fact-finding calls may not book, price, or confirm anything; the follow-up that can change the appointment requires an explicit human approval that is stored with the call; numbers are masked everywhere except intake and the confirmation dialog; missing or rejected credentials block calling and cannot produce demo data.

## Challenges

Keeping synthesis honest. Speech is vague, so we parse only exact clock times and refuse to infer ETAs from "later this afternoon". Two contacts can disagree, so the field becomes *conflicted* rather than silently choosing. CALL-E's `structured_result` is `null` on validation failure, so the app must show *validation failed* instead of a fact.

## What we learned about CALL-E

Strict recipient schemas with `unknown` enum values and good `description` text make extraction reliable. Webhooks have no signature yet, so re-fetching the call with the server key is the right trust boundary. There is no cancel endpoint, so waves should be small and deliberate. `failure_code` is not an enum, so "no answer" versus "declined" must stay unresolved.

## What's next

Carrier dispatcher as a routine third call with conflict handling already in place, a proper job queue for reconciliation at volume, and a TMS webhook that opens incidents automatically when a dock appointment is missed.
