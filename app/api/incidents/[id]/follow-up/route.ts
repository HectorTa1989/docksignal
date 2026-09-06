import { z } from "zod";
import { probeCredentials } from "@/lib/calle";
import { launchFollowUp } from "@/lib/dispatch";
import { jsonError, loadIncidentView, serverDeps } from "@/lib/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodyZ = z.object({
  operatorName: z.string().trim().min(1),
  actionCode: z.string().trim().min(1),
  humanApproved: z.literal(true, { error: "Explicit human approval is required" }),
});

/**
 * Approve and dispatch exactly one follow-up call. The rules engine only ever suggests it;
 * this route is the only path that turns a suggestion into a CALL-E call, and it requires
 * `humanApproved: true` from the operator's confirmation dialog.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const deps = serverDeps();
  if (!deps.config.ok) return Response.json({ error: deps.config.reason, missing: deps.config.missing }, { status: 503 });
  const probe = await probeCredentials();
  if (probe.state === "rejected") return Response.json({ error: `CALL-E rejected the API key. No call was created. ${probe.reason}` }, { status: 503 });
  try {
    const body = bodyZ.parse(await request.json());
    const view = await loadIncidentView(id, { reconcile: true, staleAfterMs: 0 });
    if (!view) return jsonError(new Error("Incident not found"), 404);
    const action = view.card.actions.find((a) => a.code === body.actionCode);
    if (!action || !action.requiresCall) return jsonError(new Error("That action is not a call the rules engine currently suggests"), 409);
    const driverFact = view.card.facts.find((f) => f.key === "current_location");
    const blockerFact = view.card.facts.find((f) => f.key === "blocker");
    const dockFact = view.card.facts.find((f) => f.key === "receiving_window");
    const result = await launchFollowUp(deps, {
      incidentId: id,
      actionCode: body.actionCode,
      operatorName: body.operatorName,
      humanApproved: body.humanApproved,
      context: {
        revisedEtaDisplay: view.card.eta.etaDisplay ?? "the revised time",
        driverStatement: [driverFact?.value, blockerFact?.value].filter(Boolean).join("; ") || "delayed, details in the incident record",
        dockConstraint: dockFact?.value ?? "no constraint recorded",
      },
    });
    const fresh = await loadIncidentView(id, { reconcile: false });
    return Response.json({ result, view: fresh });
  } catch (error) {
    return jsonError(error, 400);
  }
}
