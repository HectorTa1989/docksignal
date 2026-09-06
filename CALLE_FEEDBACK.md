# CALL-E integration feedback

Observations from building DockSignal against the CALL-E Developer API (OpenAPI 0.7.0, docs as of September 2026). Everything below is disclosed in the README as a limitation or a design choice.

## What worked well

- **Idempotency-Key on `POST /v1/calls`.** Reusing a stable key returns the original call, which let us make launch, refresh, restart, and concurrent dispatch all converge on one call per contact without a distributed lock.
- **`recipient_result_schema` with strict objects.** `additionalProperties: false`, string enums with `unknown`, and `description` fields carrying the extraction rules gave us a contract we can validate on our side too (zod) and treat as the only source of facts.
- **Terminal webhooks with the full snapshot.** `data` being the same `call_task` object as `GET /v1/calls/{id}` made the reconcile step a straight comparison.
- **Attempt transcripts (`recipients[].attempts[].transcript_turns`) and `evidence`.** They let every fact on the recovery card link to something a judge can read.

## Limitations we designed around

1. **No webhook signature.** Delivery carries only `CALL-E-Event-Id`; there is no secret, timestamp, or signature header. We treat the receiver as an untrusted boundary: shape validation, header/body id match, and a mandatory `GET /v1/calls/{call_id}` with our server key before any side effect. A signed webhook (HMAC over body with a timestamp) would remove one round trip per event.
2. **No cancel endpoint.** Once a wave is launched it runs to completion even if the operator no longer needs it. We keep waves small (two or three contacts) and never auto-launch a second wave. A `POST /v1/calls/{id}/cancel` would make "stop calling, the truck just arrived" possible.
3. **`failure_code` is not a published enum.** The docs say not to branch on it, so a failed call is shown as *failed* with the raw code and message, and the business fact stays unresolved. A stable `no_answer` / `declined` / `voicemail` disposition at the recipient or attempt level would let us suggest "retry later" safely.
4. **`call.result_validation_failed` carries no detail.** The recipient result is simply `null`. We surface *validation failed* and store the snapshot, but cannot tell the operator which field failed. Returning the validation issues (even redacted) would help schema authors.
5. **No per-recipient context field.** `CallTaskRecipientRequest` accepts only `phones`, `locale`, `region`. All per-contact context (name, role, what we already know) has to go into the task text, so we build a separate call task per contact. A `context` or `variables` object per recipient would let one batch call carry per-recipient facts.
6. **Region routing.** Outbound support is per region/line type and some regions are international/test-only. We derive a `region` hint from the E.164 country code and document that `unsupported_region` can still be returned for a valid number.
7. **In-progress state is coarse.** `status` stays `in_progress` through post-call finalization, so the incident room cannot distinguish "ringing" from "summarizing". The `/events` endpoint could feed a finer timeline; we left that as a stretch goal.

## Reproducible checks we ran in tests (see `tests/`)

- Same `CALL-E-Event-Id` delivered twice → second delivery is `duplicate`, zero new observations or audit rows.
- Webhook body claims a result but `GET /v1/calls` returns `structured_result: null` → task is `result_validation_failed`, no facts.
- Same launch request twice, concurrently, and after a "restart" → exactly one call per contact, same idempotency keys.
- Failed `POST /v1/calls` (for example `insufficient_balance`) → `dispatch_failed`, and the retry reuses the same `Idempotency-Key`.
