import { parseIntake } from "@/lib/intake";
import { jsonError, serverDeps, suggestNextIncidentId } from "@/lib/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const { repo } = serverDeps();
    const rows = await repo.listIncidents();
    return Response.json({
      incidents: rows.map((r) => ({
        id: r.id,
        shipmentRef: r.shipmentRef,
        status: r.status,
        promisedDockAt: r.promisedDockAt,
        timezone: r.timezone,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
      suggestedId: suggestNextIncidentId(rows.map((r) => r.id)),
    });
  } catch (error) {
    return jsonError(error, 503);
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(new Error("Invalid JSON body"), 400);
  }
  try {
    const { repo } = serverDeps();
    const input = parseIntake(body);
    if (await repo.getIncident(input.id)) {
      const existing = await repo.listIncidents();
      return Response.json({ error: `Incident ${input.id} already exists`, suggestedId: suggestNextIncidentId(existing.map((r) => r.id)) }, { status: 409 });
    }
    const incident = await repo.createIncident(input);
    return Response.json({ id: incident.id }, { status: 201 });
  } catch (error) {
    return jsonError(error, 400);
  }
}
