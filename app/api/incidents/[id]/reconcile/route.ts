import { reconcileOpenTasks } from "@/lib/reconcile";
import { jsonError, loadIncidentView, serverDeps } from "@/lib/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Operator-triggered "re-check with CALL-E" for one incident. */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const deps = serverDeps();
  if (!deps.config.ok) return Response.json({ error: deps.config.reason }, { status: 503 });
  try {
    const report = await reconcileOpenTasks(deps, { incidentId: id });
    const view = await loadIncidentView(id, { reconcile: false });
    return Response.json({ report, view });
  } catch (error) {
    return jsonError(error, 500);
  }
}
