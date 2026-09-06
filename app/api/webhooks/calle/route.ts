import { serverDeps } from "@/lib/server";
import { processWebhook } from "@/lib/webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * CALL-E terminal webhook receiver. See lib/webhook.ts for the processing contract.
 * CALL-E currently sends no signature; we authenticate the *content* by re-fetching the
 * call with our server key before changing the incident.
 */
export async function POST(request: Request) {
  const eventId = request.headers.get("CALL-E-Event-Id");
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const deps = serverDeps();
  if (!deps.config.ok) {
    // Without a server key we cannot reconcile, so we must not apply anything. Non-2xx keeps the retry alive.
    return Response.json({ error: "CALL-E is not configured on this server; cannot reconcile" }, { status: 503 });
  }
  const outcome = await processWebhook(deps, eventId, body);
  if (outcome.status >= 400) {
    console.error(JSON.stringify({ event: "calle_webhook_rejected", eventId, status: outcome.status, body: outcome.body }));
  } else {
    console.log(JSON.stringify({ event: "calle_webhook_processed", eventId, body: outcome.body }));
  }
  return Response.json(outcome.body, { status: outcome.status });
}

export function GET() {
  return Response.json({ ok: true, receiver: "docksignal", accepts: ["call.completed", "call.failed", "call.result_validation_failed"] });
}
