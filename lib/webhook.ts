import { isTerminal, webhookEventZ, type CalleClient } from "./calle";
import type { Repository } from "./repository";

export interface WebhookDeps {
  repo: Repository;
  calle: CalleClient;
}

export interface WebhookOutcome {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Process one CALL-E terminal webhook delivery.
 *
 * 1. Require `CALL-E-Event-Id` and make it match the body `id` (the only delivery header CALL-E sends).
 * 2. Validate the payload shape.
 * 3. Reserve the event id before any side effect so duplicates are no-ops.
 * 4. Reconcile against GET /v1/calls/{call_id} with our server key; the fetched snapshot is authoritative.
 * 5. Apply the snapshot, then mark the event processed.
 *
 * A failure after reservation leaves the event unprocessed so the provider's retry re-runs it.
 */
export async function processWebhook(deps: WebhookDeps, headerEventId: string | null, rawBody: unknown): Promise<WebhookOutcome> {
  if (!headerEventId) return { status: 400, body: { error: "CALL-E-Event-Id header is required" } };
  const parsed = webhookEventZ.safeParse(rawBody);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { status: 400, body: { error: `Invalid webhook payload at ${issue?.path.join(".") || "(root)"}: ${issue?.message}` } };
  }
  const event = parsed.data;
  if (event.id !== headerEventId) return { status: 400, body: { error: "CALL-E-Event-Id header does not match body id" } };
  const providerCallId = event.data.id;
  const task = await deps.repo.getTaskByProviderCallId(providerCallId);
  // Unknown call: respond non-2xx so CALL-E retries. This covers the tiny window between
  // CALL-E accepting a call and DockSignal persisting the returned id.
  if (!task) return { status: 404, body: { error: `No DockSignal task for call ${providerCallId}` } };

  const reservation = await deps.repo.reserveEvent(event.id, task.id, providerCallId, event.type, rawBody);
  if (reservation === "duplicate") return { status: 200, body: { ok: true, duplicate: true, eventId: event.id } };

  try {
    const fetched = await deps.calle.getCall(providerCallId);
    if (!isTerminal(fetched.status)) {
      // The event says terminal but the API does not agree yet; let the provider retry later.
      await deps.repo.markEventFailed(event.id, `Fetched status ${fetched.status} is not terminal`);
      return { status: 409, body: { error: "Call is not terminal according to GET /v1/calls; retry later" } };
    }
    const mismatch = fetched.status !== event.data.status;
    const applied = await deps.repo.applyProviderSnapshot(task.id, fetched, { eventType: event.type, source: "webhook" });
    await deps.repo.refreshIncidentStatus(task.incidentId);
    await deps.repo.markEventProcessed(event.id);
    return {
      status: 200,
      body: { ok: true, eventId: event.id, taskId: task.id, status: applied.status, reconciledMismatch: mismatch, retry: reservation === "retry" },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "processing failed";
    await deps.repo.markEventFailed(event.id, message);
    return { status: 500, body: { error: "Webhook processing failed; retry is safe", detail: message } };
  }
}
