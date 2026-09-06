import { notFound } from "next/navigation";
import { IncidentConsole } from "@/components/IncidentConsole";
import { loadIncidentView, setupState } from "@/lib/server";

export const dynamic = "force-dynamic";

export default async function IncidentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { id } = await params;
  const { view: initialTab } = await searchParams;
  const [view, setup] = await Promise.all([loadIncidentView(id, { reconcile: true }), setupState()]);
  if (!view) notFound();
  return <IncidentConsole initial={view} setup={setup} initialTab={initialTab === "room" || initialTab === "recovery" || initialTab === "plan" ? initialTab : undefined} />;
}
