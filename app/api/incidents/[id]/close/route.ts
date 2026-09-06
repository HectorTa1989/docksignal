import { z } from "zod";
import { jsonError, loadIncidentView, serverDeps } from "@/lib/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodyZ = z.object({ operatorName: z.string().trim().min(1), note: z.string().trim().default("") });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const body = bodyZ.parse(await request.json());
    const { repo } = serverDeps();
    const incident = await repo.getIncident(id);
    if (!incident) return jsonError(new Error("Incident not found"), 404);
    if (incident.status === "closed") return jsonError(new Error("Incident already closed"), 409);
    await repo.closeIncident(id, body.operatorName, body.note);
    return Response.json(await loadIncidentView(id, { reconcile: false }));
  } catch (error) {
    return jsonError(error, 400);
  }
}
