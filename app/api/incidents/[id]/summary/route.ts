import { renderIncidentMarkdown } from "@/lib/markdown";
import { jsonError, loadIncidentView } from "@/lib/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const view = await loadIncidentView(id, { reconcile: false });
    if (!view) return jsonError(new Error("Incident not found"), 404);
    const download = new URL(request.url).searchParams.get("download") === "1";
    return new Response(renderIncidentMarkdown(view), {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        ...(download ? { "Content-Disposition": `attachment; filename="${id}-recovery-summary.md"` } : {}),
      },
    });
  } catch (error) {
    return jsonError(error, 503);
  }
}
