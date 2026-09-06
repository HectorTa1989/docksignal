import { getDb } from "@/db";
import { calleClient, probeCredentials, type CredentialProbe } from "./calle";
import { calleConfig } from "./env";
import { buildIncidentView, type IncidentView } from "./incident-view";
import { reconcileOpenTasks } from "./reconcile";
import { createRepository, type Repository } from "./repository";

/** Everything a route needs, assembled from the real database and the real CALL-E client. */
export function serverDeps() {
  const repo: Repository = createRepository(getDb());
  const config = calleConfig();
  return { repo, calle: calleClient, config, webhookUrl: config.ok ? config.webhookUrl : "" };
}

export interface SetupState {
  calle: CredentialProbe;
  webhookUrl: string | null;
  publicBaseUrl: string | null;
  database: { ok: boolean; error?: string };
  canCall: boolean;
}

export async function setupState(force = false): Promise<SetupState> {
  const config = calleConfig();
  const calle = await probeCredentials(force);
  let database: SetupState["database"] = { ok: true };
  try {
    await createRepository(getDb()).listIncidents();
  } catch (error) {
    database = { ok: false, error: error instanceof Error ? error.message : "database error" };
  }
  return {
    calle,
    webhookUrl: config.ok ? config.webhookUrl : null,
    publicBaseUrl: config.ok ? config.publicBaseUrl : null,
    database,
    canCall: config.ok && calle.state === "accepted" && database.ok,
  };
}

/**
 * Load the incident view. When CALL-E is configured, open tasks that have not been checked
 * for `staleAfterMs` are reconciled first, so the incident room stays live even if a
 * webhook is delayed or the app runs without a public URL.
 */
export async function loadIncidentView(id: string, opts: { reconcile?: boolean; staleAfterMs?: number } = {}): Promise<IncidentView | null> {
  const deps = serverDeps();
  const incident = await deps.repo.getIncident(id);
  if (!incident) return null;
  if (opts.reconcile && deps.config.ok) {
    try {
      await reconcileOpenTasks(deps, { staleAfterMs: opts.staleAfterMs ?? 15_000, incidentId: id });
    } catch (error) {
      console.error(JSON.stringify({ event: "reconcile_failed", incidentId: id, error: error instanceof Error ? error.message : "unknown" }));
    }
  }
  const fresh = (await deps.repo.getIncident(id)) ?? incident;
  return buildIncidentView(deps.repo, fresh);
}

export function jsonError(error: unknown, status = 400) {
  const message = error instanceof Error ? error.message : "Request failed";
  return Response.json({ error: message }, { status });
}

export function suggestNextIncidentId(existing: string[]): string {
  let n = 1042;
  const taken = new Set(existing);
  while (taken.has(`DS-${n}`)) n += 1;
  return `DS-${n}`;
}
