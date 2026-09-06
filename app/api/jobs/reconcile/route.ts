import { isProduction } from "@/lib/env";
import { reconcileOpenTasks } from "@/lib/reconcile";
import { serverDeps } from "@/lib/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return !isProduction();
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

/**
 * Reconciliation job: polls GET /v1/calls/{call_id} for every open task. Vercel Cron hits
 * this every minute (see vercel.json). Run it manually with `npm run reconcile` when developing.
 */
async function handle(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const deps = serverDeps();
  if (!deps.config.ok) return Response.json({ error: deps.config.reason, checked: 0 }, { status: 503 });
  const report = await reconcileOpenTasks(deps, { staleAfterMs: 5_000 });
  return Response.json({ ok: true, ...report, at: new Date().toISOString() });
}

export const GET = handle;
export const POST = handle;
