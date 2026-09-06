import { setupState } from "@/lib/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const force = new URL(request.url).searchParams.get("force") === "1";
  const state = await setupState(force);
  return Response.json(state, { status: state.database.ok ? 200 : 503 });
}
