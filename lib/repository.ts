import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import {
  auditEntries,
  callEvents,
  callTasks,
  contacts,
  incidents,
  observations,
  recoveryActions,
  type CallTaskRow,
  type ContactRow,
  type IncidentRow,
} from "@/db/schema";
import { isTerminal, recipientOf, transcriptOf, type CallTask, type WebhookEventType } from "./calle";
import type { CallPlanEntry } from "./plan";
import { isUnresolved, RESULT_FIELDS, validateRecipientResult, type RecipientResult } from "./result-schema";
import type { SuggestedAction } from "./rules";
import { isTerminalTaskStatus, mapProviderStatus, OPEN_TASK_STATUSES, type IncidentStatus, type TaskStatus } from "./status";
import { nowIso } from "./time";

export interface NewContact {
  role: "driver" | "dispatcher" | "receiving_dock";
  name: string;
  phoneE164: string;
  region: string;
  locale: string;
  authorizationNote: string;
  includeInFactFinding: boolean;
}

export interface NewIncident {
  id: string;
  shipmentRef: string;
  orgName: string;
  promisedDockAt: string;
  receivingCutoffAt: string | null;
  timezone: string;
  lastKnownLocation: string;
  cargoDescription: string;
  operatorName: string;
  contacts: NewContact[];
}

export type EventReservation = "new" | "retry" | "duplicate";

const newId = () => crypto.randomUUID();

export function createRepository(db: Db) {
  async function addAudit(incidentId: string, actor: string, action: string, detail: unknown) {
    await db.insert(auditEntries).values({ id: newId(), incidentId, actor, action, detailJson: detail ?? {} });
  }

  async function touchIncident(incidentId: string, status?: IncidentStatus) {
    await db
      .update(incidents)
      .set({ updatedAt: nowIso(), ...(status ? { status } : {}) })
      .where(eq(incidents.id, incidentId));
  }

  return {
    db,
    addAudit,

    async createIncident(input: NewIncident): Promise<IncidentRow> {
      const existing = await db.query.incidents.findFirst({ where: eq(incidents.id, input.id) });
      if (existing) throw new Error(`Incident ${input.id} already exists`);
      await db.transaction(async (tx) => {
        await tx.insert(incidents).values({
          id: input.id,
          shipmentRef: input.shipmentRef,
          orgName: input.orgName,
          promisedDockAt: input.promisedDockAt,
          receivingCutoffAt: input.receivingCutoffAt,
          timezone: input.timezone,
          lastKnownLocation: input.lastKnownLocation,
          cargoDescription: input.cargoDescription,
          operatorName: input.operatorName,
          status: "draft",
        });
        for (const c of input.contacts) {
          await tx.insert(contacts).values({
            id: `${input.id}:${c.role}`,
            incidentId: input.id,
            role: c.role,
            name: c.name,
            phoneE164: c.phoneE164,
            region: c.region,
            locale: c.locale,
            authorizationNote: c.authorizationNote,
            includeInFactFinding: c.includeInFactFinding,
          });
        }
        await tx.insert(auditEntries).values({
          id: newId(),
          incidentId: input.id,
          actor: input.operatorName,
          action: "incident_created",
          detailJson: { shipmentRef: input.shipmentRef, contacts: input.contacts.map((c) => c.role) },
        });
      });
      return (await db.query.incidents.findFirst({ where: eq(incidents.id, input.id) }))!;
    },

    getIncident: (id: string) => db.query.incidents.findFirst({ where: eq(incidents.id, id) }),
    listIncidents: () => db.select().from(incidents).orderBy(desc(incidents.createdAt)),
    getContacts: (incidentId: string) => db.select().from(contacts).where(eq(contacts.incidentId, incidentId)).orderBy(asc(contacts.role)),
    getContact: (id: string) => db.query.contacts.findFirst({ where: eq(contacts.id, id) }),
    getTask: (id: string) => db.query.callTasks.findFirst({ where: eq(callTasks.id, id) }),
    getTaskByProviderCallId: (providerCallId: string) => db.query.callTasks.findFirst({ where: eq(callTasks.providerCallId, providerCallId) }),
    getTasks: (incidentId: string) => db.select().from(callTasks).where(eq(callTasks.incidentId, incidentId)).orderBy(asc(callTasks.createdAt)),
    getObservations: (incidentId: string) => db.select().from(observations).where(eq(observations.incidentId, incidentId)),
    getRecoveryActions: (incidentId: string) => db.select().from(recoveryActions).where(eq(recoveryActions.incidentId, incidentId)).orderBy(asc(recoveryActions.createdAt)),
    getAudit: (incidentId: string) => db.select().from(auditEntries).where(eq(auditEntries.incidentId, incidentId)).orderBy(asc(auditEntries.createdAt)),
    getEvents: (incidentId: string) =>
      db
        .select({ event: callEvents })
        .from(callEvents)
        .innerJoin(callTasks, eq(callTasks.id, callEvents.callTaskId))
        .where(eq(callTasks.incidentId, incidentId))
        .orderBy(asc(callEvents.receivedAt))
        .then((rows) => rows.map((r) => r.event)),

    async recordAuthorization(incidentId: string, operatorName: string, text: string) {
      await db
        .update(incidents)
        .set({ authorizationConfirmedAt: nowIso(), authorizationText: text, operatorName, updatedAt: nowIso() })
        .where(eq(incidents.id, incidentId));
      await addAudit(incidentId, operatorName, "authorization_confirmed", { text });
    },

    /** Idempotent: inserting an existing task id is a no-op, so restarts never create a second row. */
    async ensureTask(incidentId: string, plan: CallPlanEntry): Promise<CallTaskRow> {
      await db
        .insert(callTasks)
        .values({
          id: plan.taskId,
          incidentId,
          contactId: plan.contactId,
          kind: plan.kind,
          idempotencyKey: plan.idempotencyKey,
          status: "queued",
          taskText: plan.taskText,
          goalSummary: plan.goalSummary,
          resultSchemaJson: plan.resultSchema,
        })
        .onConflictDoNothing({ target: callTasks.id });
      return (await db.query.callTasks.findFirst({ where: eq(callTasks.id, plan.taskId) }))!;
    },

    /**
     * Claim a task for dispatch. Only a task that has never received a provider call id and
     * is not already being dispatched can be claimed. Concurrent launches race on this row
     * update; exactly one wins.
     */
    async claimTaskForDispatch(taskId: string): Promise<CallTaskRow | null> {
      const rows = await db
        .update(callTasks)
        .set({ status: "dispatching", lastError: null, updatedAt: nowIso() })
        .where(and(eq(callTasks.id, taskId), isNull(callTasks.providerCallId), inArray(callTasks.status, ["queued", "dispatch_failed"])))
        .returning();
      return rows[0] ?? null;
    },

    /** Persist the provider call id immediately after CALL-E accepts the request. */
    async recordDispatch(taskId: string, call: CallTask, actor: string): Promise<CallTaskRow> {
      const status: TaskStatus = isTerminal(call.status) ? mapProviderStatus(call) : "in_progress";
      const rows = await db
        .update(callTasks)
        .set({
          providerCallId: call.id,
          status,
          providerStatus: call.status,
          providerSnapshotJson: call,
          dispatchedAt: nowIso(),
          updatedAt: nowIso(),
        })
        .where(and(eq(callTasks.id, taskId), isNull(callTasks.providerCallId)))
        .returning();
      const row = rows[0];
      if (!row) throw new Error(`Task ${taskId} already has a provider call id; refusing to overwrite`);
      await addAudit(row.incidentId, actor, "call_created", {
        taskId,
        kind: row.kind,
        providerCallId: call.id,
        idempotencyKey: row.idempotencyKey,
        providerStatus: call.status,
      });
      await touchIncident(row.incidentId, row.kind === "follow_up" ? "follow_up_calling" : "calling");
      return row;
    },

    async recordDispatchFailure(taskId: string, message: string, actor: string) {
      const rows = await db
        .update(callTasks)
        .set({ status: "dispatch_failed", lastError: message, updatedAt: nowIso() })
        .where(and(eq(callTasks.id, taskId), isNull(callTasks.providerCallId)))
        .returning();
      const row = rows[0];
      if (row) await addAudit(row.incidentId, actor, "call_create_failed", { taskId, error: message });
    },

    async listOpenTasks(staleBeforeIso?: string): Promise<CallTaskRow[]> {
      const openStatuses = inArray(callTasks.status, OPEN_TASK_STATUSES);
      const staleness = staleBeforeIso
        ? or(isNull(callTasks.lastReconciledAt), lt(callTasks.lastReconciledAt, staleBeforeIso))
        : undefined;
      return db
        .select()
        .from(callTasks)
        .where(and(isNotNull(callTasks.providerCallId), openStatuses, staleness))
        .orderBy(asc(callTasks.dispatchedAt));
    },

    /**
     * Reserve a webhook event id before any side effect. Returns "duplicate" when the event
     * was already fully processed, "retry" when a previous attempt failed midway, "new" otherwise.
     */
    async reserveEvent(eventId: string, taskId: string, providerCallId: string, eventType: string, payload: unknown): Promise<EventReservation> {
      const inserted = await db
        .insert(callEvents)
        .values({ id: eventId, callTaskId: taskId, providerCallId, eventType, payloadJson: payload as object })
        .onConflictDoNothing({ target: callEvents.id })
        .returning({ id: callEvents.id });
      if (inserted.length) return "new";
      const existing = await db.query.callEvents.findFirst({ where: eq(callEvents.id, eventId) });
      return existing?.processedAt ? "duplicate" : "retry";
    },
    async markEventProcessed(eventId: string) {
      await db.update(callEvents).set({ processedAt: nowIso(), processingError: null }).where(eq(callEvents.id, eventId));
    },
    async markEventFailed(eventId: string, error: string) {
      await db.update(callEvents).set({ processingError: error }).where(eq(callEvents.id, eventId));
    },

    /**
     * Apply an authoritative provider snapshot (from GET /v1/calls/{id}) to a task.
     * Terminal snapshots also write observations. Returns the new task status.
     */
    async applyProviderSnapshot(
      taskId: string,
      call: CallTask,
      opts: { eventType?: WebhookEventType; source: "webhook" | "reconcile" | "dispatch" },
    ): Promise<{ status: TaskStatus; changed: boolean; task: CallTaskRow }> {
      const task = await db.query.callTasks.findFirst({ where: eq(callTasks.id, taskId) });
      if (!task) throw new Error(`Unknown task ${taskId}`);
      if (task.providerCallId && task.providerCallId !== call.id) {
        throw new Error(`Snapshot call id ${call.id} does not match task ${taskId} (${task.providerCallId})`);
      }
      const recipient = recipientOf(call);
      const rawResult = recipient?.structured_result ?? null;
      let result: RecipientResult | null = null;
      let validationError: string | null = null;
      if (rawResult) {
        try {
          result = validateRecipientResult(rawResult);
        } catch (error) {
          validationError = error instanceof Error ? error.message : "invalid structured result";
        }
      }
      let status = mapProviderStatus(call, opts.eventType);
      if (status === "completed" && !result) status = "result_validation_failed";
      if (!isTerminal(call.status) && isTerminalTaskStatus(task.status)) {
        // Never regress a terminal task on a stale non-terminal snapshot.
        await db.update(callTasks).set({ lastReconciledAt: nowIso() }).where(eq(callTasks.id, taskId));
        return { status: task.status as TaskStatus, changed: false, task };
      }
      const changed = task.status !== status;
      const attempts = recipient?.attempts ?? [];
      const transcript = transcriptOf(call);
      const rows = await db
        .update(callTasks)
        .set({
          status,
          providerStatus: call.status,
          recipientStatus: recipient?.status ?? null,
          providerSummary: call.summary ?? null,
          recipientSummary: recipient?.summary ?? null,
          taskCompleted: call.task_completed ?? null,
          completionConfidenceScore: call.completion_confidence ? String(call.completion_confidence.score) : null,
          completionConfidenceLabel: call.completion_confidence?.label ?? null,
          evidenceJson: call.evidence ?? [],
          structuredResultJson: rawResult,
          transcriptJson: transcript,
          providerSnapshotJson: call,
          failureCode: call.failure_code ?? attempts.at(-1)?.failure_code ?? null,
          failureMessage: call.failure_message ?? attempts.at(-1)?.failure_message ?? null,
          attemptCount: attempts.length,
          lastError: validationError ?? (status === "result_validation_failed" ? "CALL-E returned no schema-valid recipient result" : null),
          providerCompletedAt: call.completed_at ?? null,
          lastReconciledAt: nowIso(),
          updatedAt: nowIso(),
        })
        .where(eq(callTasks.id, taskId))
        .returning();
      const updated = rows[0]!;

      if (isTerminal(call.status)) {
        await db.delete(observations).where(eq(observations.callTaskId, taskId));
        if (result) {
          const eligible = result.reached === "yes" && result.shipment_recognized !== "no";
          for (const field of RESULT_FIELDS) {
            const value = result[field];
            const resolved = !isUnresolved(value);
            await db.insert(observations).values({
              id: newId(),
              incidentId: task.incidentId,
              callTaskId: taskId,
              contactId: task.contactId,
              sourceRole: task.kind === "follow_up" ? `${task.contactId.split(":").pop()}_follow_up` : (task.contactId.split(":").pop() ?? "unknown"),
              field,
              value,
              resolved,
              verified: status === "completed" && eligible && resolved,
              certainty: result.certainty,
              evidenceJson: call.evidence ?? [],
            });
          }
        }
        if (changed || opts.source === "webhook") {
          await addAudit(task.incidentId, opts.source === "webhook" ? "CALL-E webhook" : "reconciliation job", `call_${status}`, {
            taskId,
            providerCallId: call.id,
            providerStatus: call.status,
            eventType: opts.eventType ?? null,
            taskCompleted: call.task_completed ?? null,
            completionConfidence: call.completion_confidence ?? null,
            validationError,
          });
        }
      } else if (changed) {
        await addAudit(task.incidentId, "reconciliation job", "call_in_progress", { taskId, providerCallId: call.id, providerStatus: call.status });
      }
      await touchIncident(task.incidentId);
      return { status, changed, task: updated };
    },

    /** Upsert the rules engine's suggestions; keep any approved/dispatched rows, supersede stale ones. */
    async syncRecoveryActions(incidentId: string, contactsById: Map<string, ContactRow>, suggestions: SuggestedAction[]) {
      const existing = await db.select().from(recoveryActions).where(eq(recoveryActions.incidentId, incidentId));
      const byCode = new Map(existing.map((r) => [r.code, r]));
      const keep = new Set(suggestions.map((s) => s.code));
      for (const s of suggestions) {
        const contact = s.targetRole ? [...contactsById.values()].find((c) => c.role === s.targetRole) : null;
        const row = byCode.get(s.code);
        if (!row) {
          await db.insert(recoveryActions).values({
            id: newId(),
            incidentId,
            code: s.code,
            title: s.title,
            rationale: s.rationale,
            owner: s.owner,
            requiresCall: s.requiresCall,
            contactId: contact?.id ?? null,
            status: "suggested",
          });
        } else if (row.status === "suggested" || row.status === "superseded") {
          await db
            .update(recoveryActions)
            .set({ title: s.title, rationale: s.rationale, owner: s.owner, requiresCall: s.requiresCall, contactId: contact?.id ?? null, status: "suggested", updatedAt: nowIso() })
            .where(eq(recoveryActions.id, row.id));
        }
      }
      for (const row of existing) {
        if (!keep.has(row.code) && row.status === "suggested") {
          await db.update(recoveryActions).set({ status: "superseded", updatedAt: nowIso() }).where(eq(recoveryActions.id, row.id));
        }
      }
      return db.select().from(recoveryActions).where(eq(recoveryActions.incidentId, incidentId)).orderBy(asc(recoveryActions.createdAt));
    },

    async approveRecoveryAction(incidentId: string, code: string, actor: string) {
      const rows = await db
        .update(recoveryActions)
        .set({ status: "approved", approvedBy: actor, approvedAt: nowIso(), updatedAt: nowIso() })
        .where(and(eq(recoveryActions.incidentId, incidentId), eq(recoveryActions.code, code), eq(recoveryActions.status, "suggested")))
        .returning();
      const row = rows[0] ?? null;
      if (row) await addAudit(incidentId, actor, "recovery_action_approved", { code, title: row.title });
      return row;
    },

    async linkActionToTask(actionId: string, taskId: string) {
      await db.update(recoveryActions).set({ callTaskId: taskId, status: "dispatched", updatedAt: nowIso() }).where(eq(recoveryActions.id, actionId));
    },

    async markTaskApproved(taskId: string, actor: string) {
      await db.update(callTasks).set({ approvedBy: actor, approvedAt: nowIso(), updatedAt: nowIso() }).where(eq(callTasks.id, taskId));
    },

    async setIncidentStatus(incidentId: string, status: IncidentStatus) {
      await touchIncident(incidentId, status);
    },

    async closeIncident(incidentId: string, actor: string, note: string) {
      await db.update(incidents).set({ status: "closed", closedAt: nowIso(), updatedAt: nowIso() }).where(eq(incidents.id, incidentId));
      await addAudit(incidentId, actor, "incident_closed", { note });
    },

    /** Derive incident status from task states (used after every reconciliation). */
    async refreshIncidentStatus(incidentId: string) {
      const incident = await db.query.incidents.findFirst({ where: eq(incidents.id, incidentId) });
      if (!incident || incident.status === "closed") return incident?.status ?? null;
      const tasks = await db.select().from(callTasks).where(eq(callTasks.incidentId, incidentId));
      let status: IncidentStatus = "draft";
      if (tasks.length) {
        const open = tasks.filter((t) => !isTerminalTaskStatus(t.status) && t.status !== "queued");
        const followUpOpen = open.some((t) => t.kind === "follow_up");
        status = followUpOpen ? "follow_up_calling" : open.length ? "calling" : "review";
      }
      if (status !== incident.status) await touchIncident(incidentId, status);
      return status;
    },

    async countCallsCreated(): Promise<number> {
      const rows = await db.select({ n: sql<number>`count(*)` }).from(callTasks).where(isNotNull(callTasks.providerCallId));
      return Number(rows[0]?.n ?? 0);
    },
  };
}

export type Repository = ReturnType<typeof createRepository>;
