import { CalleApiError, type CalleClient } from "./calle";
import type { Repository } from "./repository";

export interface ReconcileDeps {
  repo: Repository;
  calle: CalleClient;
}

export interface ReconcileReport {
  checked: number;
  updated: string[];
  errors: Array<{ taskId: string; error: string }>;
}

/**
 * Poll CALL-E for every open task (has a provider call id, not terminal on our side)
 * and apply the authoritative snapshot. This is the safety net for lost webhooks and
 * for local development where no public webhook URL exists.
 */
export async function reconcileOpenTasks(deps: ReconcileDeps, opts: { staleAfterMs?: number; incidentId?: string } = {}): Promise<ReconcileReport> {
  const staleBefore = opts.staleAfterMs ? new Date(Date.now() - opts.staleAfterMs).toISOString() : undefined;
  let tasks = await deps.repo.listOpenTasks(staleBefore);
  if (opts.incidentId) tasks = tasks.filter((t) => t.incidentId === opts.incidentId);
  const report: ReconcileReport = { checked: tasks.length, updated: [], errors: [] };
  const touched = new Set<string>();
  for (const task of tasks) {
    try {
      const call = await deps.calle.getCall(task.providerCallId!);
      const applied = await deps.repo.applyProviderSnapshot(task.id, call, { source: "reconcile" });
      if (applied.changed) report.updated.push(task.id);
      touched.add(task.incidentId);
    } catch (error) {
      const message = error instanceof CalleApiError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : "unknown";
      report.errors.push({ taskId: task.id, error: message });
    }
  }
  for (const incidentId of touched) await deps.repo.refreshIncidentStatus(incidentId);
  return report;
}
