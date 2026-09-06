# Testing instructions

## 1. Automated tests (no CALL-E account, no network, no phone)

```bash
npm install
npm test
```

`tests/` runs under vitest with an in-process PostgreSQL (PGlite) that applies the real migrations in `drizzle/`, so unique constraints and `ON CONFLICT` behaviour are exercised exactly as in production. The CALL-E HTTP boundary is replaced by a recording fake **inside the test files only**; application code cannot import it and there is no runtime flag that enables it.

| Suite | What it proves |
| --- | --- |
| `rules.test.ts` | Missed-window branch; a changed structured ETA flips the recommendation; driver/dispatcher disagreement becomes `conflicted` with no winner; failed, validation-failed and `reached = unknown` results never become facts; vague ETAs are not converted; dock decline suggests rebooking; follow-up results close the loop. |
| `contract.test.ts` | The exact `recipient_result_schema` (fields, enums, `additionalProperties: false`, no unsupported JSON Schema features); strict validation rejects extra/missing fields; `""` and `unknown` are unresolved; provider status mapping; E.164 and emergency-number policy; masking; timezone and clock parsing. |
| `dispatch.test.ts` | One `POST /v1/calls` per included contact with idempotency key, E.164 recipient, metadata, schema and webhook URL; no launch without authorization; second launch, refresh and restart create no duplicate; two concurrent launches create exactly one call each; dispatch failure is `dispatch_failed` and the retry reuses the same key; auth failure invents nothing; follow-up call requires `humanApproved: true`, records the approver, and cannot be created twice. |
| `webhook.test.ts` | Header/body event id must match; the fetched `GET /v1/calls` snapshot overrides the webhook body; duplicate delivery produces no second observation or audit entry; summary, completion, confidence, evidence, result and transcript are stored; unresolved fields are `verified = false`; unknown call → 404 (provider retries); failed reconciliation leaves the event retryable and the retry is processed once; a later structured result changes the recommendation and the Markdown summary masks numbers. Plus the reconciliation job. |

Type-check and production build:

```bash
npm run lint
npm run build
```

## 2. Manual real-call test (needs a CALL-E key and two phones you control)

1. Deploy (or tunnel) so `PUBLIC_BASE_URL` is reachable over HTTPS. Set `CALLE_API_KEY`. Open `/api/health` and confirm `"calle": {"state": "accepted"}`.
2. Remove the key (or set a wrong one) once and reload `/`: the banner says **Calling blocked**, the launch button is disabled, and `POST /api/incidents/<id>/launch` returns 503 without creating a call. Restore the key.
3. Create incident `DS-1042` with your two numbers as driver and receiving dock. Nothing is called yet.
4. On the call plan, inspect the task text and schema, tick the authorization box, click **Launch fact-finding calls**, confirm the dialog. Both phones ring within seconds. The incident room shows two cards with `call_…` ids and status *in progress*.
5. Answer as the driver: say where you are, why you are late, and an exact time later than the dock cutoff (for example "16:40"). Answer as the dock: say the dock can accept only until an exact time (for example "16:00") and that later arrivals need approval.
6. Watch the cards flip to *completed* through the webhook (Webhook deliveries table) or the reconciliation job. Open the transcript and raw provider fields.
7. Open the recovery card: **Revised ETA is after the receiving cutoff**, facts link to the call ids, confidence and reasons are shown. **Approve follow-up call** opens the human-approval dialog; approve it and the dock phone rings again with the exception request. Answer with a window; the card moves to *exception_granted* or *follow_up_declined*.
8. Close the incident and download the Markdown summary.

## 3. Idempotency and duplicate checks

- **Refresh / double-click.** Click the launch button twice or refresh during dispatch: the response reports `already_dispatched`; the CALL-E dashboard shows exactly two calls.
- **Restart.** Stop the server after launching, start it again, call `POST /api/incidents/DS-1042/launch` once more: no new call (`already_dispatched`).
- **Duplicate webhook.** Replay a stored delivery:

  ```bash
  curl -X POST "$PUBLIC_BASE_URL/api/webhooks/calle" \
    -H "Content-Type: application/json" -H "CALL-E-Event-Id: evt_<id from the incident room>" \
    --data @event.json
  ```

  The response is `{"ok":true,"duplicate":true}` and the decision log gains no entry.
- **Unknown call.** Post a payload whose `data.id` is not a DockSignal call: 404, nothing stored.
- **Header mismatch.** Post with a `CALL-E-Event-Id` that differs from the body `id`: 400.
- **Reconcile manually.** `POST /api/incidents/DS-1042/reconcile` or `npm run reconcile`.
