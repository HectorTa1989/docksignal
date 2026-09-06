import { z } from "zod";
import { contacts } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { regionFromPhone, validateE164 } from "@/lib/phone";
import { jsonError, loadIncidentView, serverDeps } from "@/lib/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const reconcile = new URL(request.url).searchParams.get("reconcile") !== "0";
  try {
    const view = await loadIncidentView(id, { reconcile });
    if (!view) return jsonError(new Error("Incident not found"), 404);
    return Response.json(view);
  } catch (error) {
    return jsonError(error, 503);
  }
}

const patchZ = z.object({
  contacts: z
    .array(
      z.object({
        role: z.enum(["driver", "dispatcher", "receiving_dock"]),
        name: z.string().trim().min(1).optional(),
        phone: z.string().trim().optional(),
        include: z.boolean().optional(),
        authorizationNote: z.string().trim().optional(),
      }),
    )
    .min(1),
  operatorName: z.string().trim().min(1),
});

/** Edit recipients while the incident is still a draft (no call created yet). */
export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const body = patchZ.parse(await request.json());
    const { repo } = serverDeps();
    const incident = await repo.getIncident(id);
    if (!incident) return jsonError(new Error("Incident not found"), 404);
    const tasks = await repo.getTasks(id);
    if (tasks.some((t) => t.providerCallId)) return jsonError(new Error("Recipients are frozen once a call has been created"), 409);
    for (const c of body.contacts) {
      const update: Record<string, unknown> = {};
      if (c.name !== undefined) update.name = c.name;
      if (c.phone !== undefined) {
        const phone = c.phone ? validateE164(c.phone, `${c.role} phone`) : "";
        update.phoneE164 = phone;
        if (phone) update.region = regionFromPhone(phone);
      }
      if (c.include !== undefined) update.includeInFactFinding = c.include;
      if (c.authorizationNote !== undefined) update.authorizationNote = c.authorizationNote;
      if (Object.keys(update).length) {
        await repo.db.update(contacts).set(update).where(and(eq(contacts.incidentId, id), eq(contacts.role, c.role)));
      }
    }
    await repo.addAudit(id, body.operatorName, "recipients_updated", { roles: body.contacts.map((c) => c.role) });
    const view = await loadIncidentView(id, { reconcile: false });
    return Response.json(view);
  } catch (error) {
    return jsonError(error, 400);
  }
}
