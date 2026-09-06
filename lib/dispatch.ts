import type { CallTaskRow, ContactRow, IncidentRow } from "@/db/schema";
import { CalleApiError, type CalleClient, type CreateCallRequest } from "./calle";
import { buildFactFindingPlan, buildFollowUpPlan, type CallPlanEntry, type FollowUpContext } from "./plan";
import type { Repository } from "./repository";
import { validateE164 } from "./phone";

export interface DispatchDeps {
  repo: Repository;
  calle: CalleClient;
  webhookUrl: string;
}

export type DispatchResult =
  | { taskId: string; outcome: "created"; providerCallId: string }
  | { taskId: string; outcome: "already_dispatched"; providerCallId: string }
  | { taskId: string; outcome: "in_flight" }
  | { taskId: string; outcome: "failed"; error: string; code: string };

function buildRequest(plan: CallPlanEntry, incident: IncidentRow, contact: ContactRow, webhookUrl: string): CreateCallRequest {
  return {
    task: plan.taskText,
    recipients: [{ phones: [contact.phoneE164], locale: contact.locale || null, region: contact.region || null }],
    recipient_result_schema: plan.resultSchema,
    metadata: {
      app: "docksignal",
      incident_id: incident.id,
      shipment_ref: incident.shipmentRef,
      contact_id: contact.id,
      contact_role: contact.role,
      task_id: plan.taskId,
      kind: plan.kind,
    },
    webhook_url: webhookUrl,
  };
}

/**
 * Dispatch exactly one CALL-E call for a task. Safe to call repeatedly:
 * - a task that already has a provider call id is skipped,
 * - concurrent callers race on a single row claim,
 * - the stable Idempotency-Key makes a retried HTTP request return the original call.
 */
export async function dispatchTask(
  deps: DispatchDeps,
  incident: IncidentRow,
  contact: ContactRow,
  plan: CallPlanEntry,
  actor: string,
): Promise<DispatchResult> {
  validateE164(contact.phoneE164, `${contact.role} phone`);
  const task: CallTaskRow = await deps.repo.ensureTask(incident.id, plan);
  if (task.providerCallId) return { taskId: task.id, outcome: "already_dispatched", providerCallId: task.providerCallId };
  const claimed = await deps.repo.claimTaskForDispatch(task.id);
  if (!claimed) {
    const latest = await deps.repo.getTask(task.id);
    if (latest?.providerCallId) return { taskId: task.id, outcome: "already_dispatched", providerCallId: latest.providerCallId };
    return { taskId: task.id, outcome: "in_flight" };
  }
  try {
    const call = await deps.calle.createCall(buildRequest(plan, incident, contact, deps.webhookUrl), task.idempotencyKey);
    await deps.repo.recordDispatch(task.id, call, actor);
    return { taskId: task.id, outcome: "created", providerCallId: call.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown CALL-E error";
    const code = error instanceof CalleApiError ? error.code : "unexpected_error";
    await deps.repo.recordDispatchFailure(task.id, message, actor);
    return { taskId: task.id, outcome: "failed", error: message, code };
  }
}

export interface LaunchInput {
  incidentId: string;
  operatorName: string;
  authorizationConfirmed: boolean;
  authorizationText: string;
}

/** Launch the fact-finding wave: all included contacts, concurrently. */
export async function launchFactFinding(deps: DispatchDeps, input: LaunchInput) {
  if (!input.authorizationConfirmed) throw new Error("Authorization confirmation is required before any call is created.");
  const incident = await deps.repo.getIncident(input.incidentId);
  if (!incident) throw new Error("Incident not found");
  if (incident.status === "closed") throw new Error("Incident is closed");
  const contactRows = await deps.repo.getContacts(incident.id);
  const targets = contactRows.filter((c) => c.includeInFactFinding);
  if (!targets.length) throw new Error("No contacts are included in the fact-finding wave");
  for (const c of targets) validateE164(c.phoneE164, `${c.role} phone`);
  await deps.repo.recordAuthorization(incident.id, input.operatorName, input.authorizationText);
  const results = await Promise.all(
    targets.map((contact) => dispatchTask(deps, incident, contact, buildFactFindingPlan(incident, contact), input.operatorName)),
  );
  await deps.repo.refreshIncidentStatus(incident.id);
  return results;
}

/** Create the approved follow-up call to the receiving dock. Requires a prior approval row. */
export async function launchFollowUp(
  deps: DispatchDeps,
  input: { incidentId: string; actionCode: string; operatorName: string; humanApproved: boolean; context: Omit<FollowUpContext, "actionCode" | "approvedBy"> },
) {
  if (!input.humanApproved) throw new Error("Explicit human approval is required for a follow-up call.");
  const incident = await deps.repo.getIncident(input.incidentId);
  if (!incident) throw new Error("Incident not found");
  const dock = (await deps.repo.getContacts(incident.id)).find((c) => c.role === "receiving_dock");
  if (!dock) throw new Error("No receiving dock contact on this incident");
  const actions = await deps.repo.getRecoveryActions(incident.id);
  const action = actions.find((a) => a.code === input.actionCode);
  if (!action) throw new Error(`Recovery action ${input.actionCode} is not on this incident`);
  if (!action.requiresCall) throw new Error(`Recovery action ${input.actionCode} does not involve a call`);
  if (action.status === "suggested") {
    const approved = await deps.repo.approveRecoveryAction(incident.id, input.actionCode, input.operatorName);
    if (!approved) throw new Error("Could not record approval");
  } else if (action.status !== "approved" && action.status !== "dispatched") {
    throw new Error(`Recovery action ${input.actionCode} is ${action.status}`);
  }
  const plan = buildFollowUpPlan(incident, dock, { ...input.context, actionCode: input.actionCode, approvedBy: input.operatorName });
  const result = await dispatchTask(deps, incident, dock, plan, input.operatorName);
  await deps.repo.markTaskApproved(plan.taskId, input.operatorName);
  await deps.repo.linkActionToTask(action.id, plan.taskId);
  await deps.repo.refreshIncidentStatus(incident.id);
  return result;
}
