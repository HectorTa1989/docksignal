import { z } from "zod";
import { probeCredentials } from "@/lib/calle";
import { launchFactFinding } from "@/lib/dispatch";
import { jsonError, loadIncidentView, serverDeps } from "@/lib/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodyZ = z.object({
  operatorName: z.string().trim().min(1, "Operator name is required"),
  authorizationConfirmed: z.literal(true, { error: "Authorization confirmation is required" }),
  authorizationText: z.string().trim().min(1),
});

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const deps = serverDeps();
  if (!deps.config.ok) return Response.json({ error: deps.config.reason, missing: deps.config.missing }, { status: 503 });
  const probe = await probeCredentials();
  if (probe.state === "rejected") return Response.json({ error: `CALL-E rejected the API key. No call was created. ${probe.reason}` }, { status: 503 });
  try {
    const body = bodyZ.parse(await request.json());
    const results = await launchFactFinding(deps, {
      incidentId: id,
      operatorName: body.operatorName,
      authorizationConfirmed: body.authorizationConfirmed,
      authorizationText: body.authorizationText,
    });
    const view = await loadIncidentView(id, { reconcile: false });
    return Response.json({ results, view }, { status: 200 });
  } catch (error) {
    return jsonError(error, 400);
  }
}
