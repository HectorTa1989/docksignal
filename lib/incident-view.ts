import type { AuditEntryRow, CallEventRow, CallTaskRow, ContactRow, IncidentRow, ObservationRow, RecoveryActionRow } from "@/db/schema";
import type { TranscriptTurn } from "./calle";
import { buildFactFindingPlan, type CallPlanEntry } from "./plan";
import { maskPhone } from "./phone";
import type { Repository } from "./repository";
import { validateRecipientResult, type ContactRole, type RecipientResult } from "./result-schema";
import { buildRecoveryCard, type RecoveryCard, type TaskOutcome } from "./rules";
import type { TaskKind, TaskStatus } from "./status";
import { formatInTz } from "./time";

export interface TaskView {
  id: string;
  kind: TaskKind;
  contactId: string;
  role: ContactRole;
  contactName: string;
  phoneMasked: string;
  status: TaskStatus;
  providerCallId: string | null;
  providerStatus: string | null;
  recipientStatus: string | null;
  goalSummary: string;
  taskText: string;
  idempotencyKey: string;
  lastError: string | null;
  summary: string | null;
  recipientSummary: string | null;
  taskCompleted: boolean | null;
  completionConfidence: { score: number; label: string } | null;
  evidence: string[];
  structuredResult: RecipientResult | null;
  rawStructuredResult: unknown;
  transcript: TranscriptTurn[];
  failureCode: string | null;
  failureMessage: string | null;
  attemptCount: number;
  approvedBy: string | null;
  approvedAt: string | null;
  dispatchedAt: string | null;
  providerCompletedAt: string | null;
  lastReconciledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IncidentView {
  incident: {
    id: string;
    shipmentRef: string;
    orgName: string;
    promisedDockAt: string;
    promisedDockDisplay: string;
    receivingCutoffAt: string | null;
    receivingCutoffDisplay: string | null;
    timezone: string;
    lastKnownLocation: string;
    cargoDescription: string;
    status: string;
    operatorName: string;
    authorizationConfirmedAt: string | null;
    authorizationText: string | null;
    closedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  contacts: Array<{
    id: string;
    role: ContactRole;
    name: string;
    phoneMasked: string;
    phoneE164: string;
    region: string;
    locale: string;
    authorizationNote: string;
    includeInFactFinding: boolean;
  }>;
  plan: Array<Omit<CallPlanEntry, "resultSchema"> & { resultSchema: Record<string, unknown>; phoneMasked: string; existingTaskStatus: TaskStatus | null; providerCallId: string | null }>;
  tasks: TaskView[];
  observations: ObservationRow[];
  card: RecoveryCard;
  recoveryActions: RecoveryActionRow[];
  events: Array<Pick<CallEventRow, "id" | "callTaskId" | "providerCallId" | "eventType" | "receivedAt" | "processedAt" | "processingError">>;
  audit: AuditEntryRow[];
  counters: { callsCreated: number; webhooksProcessed: number; duplicateWebhooksIgnored: number };
}

const ROLE_ORDER: ContactRole[] = ["driver", "receiving_dock", "dispatcher"];

function safeResult(value: unknown): RecipientResult | null {
  if (!value) return null;
  try {
    return validateRecipientResult(value);
  } catch {
    return null;
  }
}

export function toTaskView(task: CallTaskRow, contact: ContactRow | undefined): TaskView {
  const evidence = Array.isArray(task.evidenceJson) ? (task.evidenceJson as string[]) : [];
  return {
    id: task.id,
    kind: task.kind as TaskKind,
    contactId: task.contactId,
    role: (contact?.role ?? "driver") as ContactRole,
    contactName: contact?.name ?? task.contactId,
    phoneMasked: contact ? maskPhone(contact.phoneE164) : "",
    status: task.status as TaskStatus,
    providerCallId: task.providerCallId,
    providerStatus: task.providerStatus,
    recipientStatus: task.recipientStatus,
    goalSummary: task.goalSummary,
    taskText: task.taskText,
    idempotencyKey: task.idempotencyKey,
    lastError: task.lastError,
    summary: task.providerSummary,
    recipientSummary: task.recipientSummary,
    taskCompleted: task.taskCompleted,
    completionConfidence:
      task.completionConfidenceScore !== null && task.completionConfidenceLabel
        ? { score: Number(task.completionConfidenceScore), label: task.completionConfidenceLabel }
        : null,
    evidence,
    structuredResult: safeResult(task.structuredResultJson),
    rawStructuredResult: task.structuredResultJson,
    transcript: Array.isArray(task.transcriptJson) ? (task.transcriptJson as TranscriptTurn[]) : [],
    failureCode: task.failureCode,
    failureMessage: task.failureMessage,
    attemptCount: task.attemptCount,
    approvedBy: task.approvedBy,
    approvedAt: task.approvedAt,
    dispatchedAt: task.dispatchedAt,
    providerCompletedAt: task.providerCompletedAt,
    lastReconciledAt: task.lastReconciledAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

export function outcomesFromTasks(tasks: TaskView[]): TaskOutcome[] {
  return tasks.map((t) => ({
    taskId: t.id,
    kind: t.kind,
    role: t.role,
    contactName: t.contactName,
    status: t.status,
    providerCallId: t.providerCallId,
    result: t.status === "completed" ? t.structuredResult : null,
    evidence: t.evidence,
    summary: t.recipientSummary ?? t.summary,
    completionLabel: t.completionConfidence?.label ?? null,
    completionScore: t.completionConfidence?.score ?? null,
    lastError: t.lastError ?? t.failureMessage,
  }));
}

export async function buildIncidentView(repo: Repository, incident: IncidentRow): Promise<IncidentView> {
  const [contactRows, taskRows, observationRows, events, audit, callsCreated] = await Promise.all([
    repo.getContacts(incident.id),
    repo.getTasks(incident.id),
    repo.getObservations(incident.id),
    repo.getEvents(incident.id),
    repo.getAudit(incident.id),
    repo.countCallsCreated(),
  ]);
  const contactsById = new Map(contactRows.map((c) => [c.id, c]));
  const tasks = taskRows.map((t) => toTaskView(t, contactsById.get(t.contactId)));
  const card = buildRecoveryCard(
    { id: incident.id, promisedDockAt: incident.promisedDockAt, receivingCutoffAt: incident.receivingCutoffAt, timezone: incident.timezone },
    outcomesFromTasks(tasks),
  );
  const recoveryActions = await repo.syncRecoveryActions(incident.id, contactsById, card.actions);
  const plan = [...contactRows]
    .filter((c) => c.includeInFactFinding)
    .sort((a, b) => ROLE_ORDER.indexOf(a.role as ContactRole) - ROLE_ORDER.indexOf(b.role as ContactRole))
    .map((c) => {
      const entry = buildFactFindingPlan(incident, c);
      const task = taskRows.find((t) => t.id === entry.taskId);
      return { ...entry, phoneMasked: maskPhone(c.phoneE164), existingTaskStatus: (task?.status as TaskStatus | undefined) ?? null, providerCallId: task?.providerCallId ?? null };
    });
  const duplicateWebhooksIgnored = audit.filter((a) => a.action === "webhook_duplicate_ignored").length;
  return {
    incident: {
      id: incident.id,
      shipmentRef: incident.shipmentRef,
      orgName: incident.orgName,
      promisedDockAt: incident.promisedDockAt,
      promisedDockDisplay: formatInTz(incident.promisedDockAt, incident.timezone),
      receivingCutoffAt: incident.receivingCutoffAt,
      receivingCutoffDisplay: incident.receivingCutoffAt ? formatInTz(incident.receivingCutoffAt, incident.timezone) : null,
      timezone: incident.timezone,
      lastKnownLocation: incident.lastKnownLocation,
      cargoDescription: incident.cargoDescription,
      status: incident.status,
      operatorName: incident.operatorName,
      authorizationConfirmedAt: incident.authorizationConfirmedAt,
      authorizationText: incident.authorizationText,
      closedAt: incident.closedAt,
      createdAt: incident.createdAt,
      updatedAt: incident.updatedAt,
    },
    contacts: [...contactRows]
      .sort((a, b) => ROLE_ORDER.indexOf(a.role as ContactRole) - ROLE_ORDER.indexOf(b.role as ContactRole))
      .map((c) => ({
      id: c.id,
      role: c.role as ContactRole,
      name: c.name,
      phoneMasked: maskPhone(c.phoneE164),
      phoneE164: c.phoneE164,
      region: c.region,
      locale: c.locale,
      authorizationNote: c.authorizationNote,
      includeInFactFinding: c.includeInFactFinding,
    })),
    plan,
    tasks,
    observations: observationRows,
    card,
    recoveryActions,
    events: events.map((e) => ({
      id: e.id,
      callTaskId: e.callTaskId,
      providerCallId: e.providerCallId,
      eventType: e.eventType,
      receivedAt: e.receivedAt,
      processedAt: e.processedAt,
      processingError: e.processingError,
    })),
    audit,
    counters: { callsCreated, webhooksProcessed: events.filter((e) => e.processedAt).length, duplicateWebhooksIgnored },
  };
}
