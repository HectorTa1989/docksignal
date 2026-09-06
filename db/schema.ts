import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "string" });

export const incidents = pgTable("incidents", {
  id: text("id").primaryKey(),
  shipmentRef: text("shipment_ref").notNull(),
  orgName: text("org_name").notNull(),
  promisedDockAt: ts("promised_dock_at").notNull(),
  receivingCutoffAt: ts("receiving_cutoff_at"),
  timezone: text("timezone").notNull(),
  lastKnownLocation: text("last_known_location").notNull(),
  cargoDescription: text("cargo_description").notNull(),
  status: text("status").notNull(),
  operatorName: text("operator_name").notNull(),
  authorizationConfirmedAt: ts("authorization_confirmed_at"),
  authorizationText: text("authorization_text"),
  closedAt: ts("closed_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const contacts = pgTable(
  "contacts",
  {
    id: text("id").primaryKey(),
    incidentId: text("incident_id")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    name: text("name").notNull(),
    phoneE164: text("phone_e164").notNull(),
    region: text("region").notNull(),
    locale: text("locale").notNull(),
    authorizationNote: text("authorization_note").notNull(),
    includeInFactFinding: boolean("include_in_fact_finding").notNull().default(true),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("contacts_incident_role_uq").on(t.incidentId, t.role)],
);

export const callTasks = pgTable(
  "call_tasks",
  {
    id: text("id").primaryKey(),
    incidentId: text("incident_id")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    providerCallId: text("provider_call_id"),
    status: text("status").notNull(),
    taskText: text("task_text").notNull(),
    goalSummary: text("goal_summary").notNull(),
    resultSchemaJson: jsonb("result_schema_json").notNull(),
    lastError: text("last_error"),
    providerStatus: text("provider_status"),
    recipientStatus: text("recipient_status"),
    providerSummary: text("provider_summary"),
    recipientSummary: text("recipient_summary"),
    taskCompleted: boolean("task_completed"),
    completionConfidenceScore: numeric("completion_confidence_score"),
    completionConfidenceLabel: text("completion_confidence_label"),
    evidenceJson: jsonb("evidence_json"),
    structuredResultJson: jsonb("structured_result_json"),
    transcriptJson: jsonb("transcript_json"),
    providerSnapshotJson: jsonb("provider_snapshot_json"),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    attemptCount: integer("attempt_count").notNull().default(0),
    approvedBy: text("approved_by"),
    approvedAt: ts("approved_at"),
    dispatchedAt: ts("dispatched_at"),
    providerCompletedAt: ts("provider_completed_at"),
    lastReconciledAt: ts("last_reconciled_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("call_tasks_idempotency_key_uq").on(t.idempotencyKey),
    uniqueIndex("call_tasks_provider_call_id_uq").on(t.providerCallId),
    index("call_tasks_incident_idx").on(t.incidentId),
    index("call_tasks_status_idx").on(t.status),
  ],
);

export const callEvents = pgTable(
  "call_events",
  {
    id: text("id").primaryKey(),
    callTaskId: text("call_task_id")
      .notNull()
      .references(() => callTasks.id, { onDelete: "cascade" }),
    providerCallId: text("provider_call_id").notNull(),
    eventType: text("event_type").notNull(),
    payloadJson: jsonb("payload_json").notNull(),
    receivedAt: ts("received_at").notNull().defaultNow(),
    processedAt: ts("processed_at"),
    processingError: text("processing_error"),
  },
  (t) => [index("call_events_task_idx").on(t.callTaskId)],
);

export const observations = pgTable(
  "observations",
  {
    id: text("id").primaryKey(),
    incidentId: text("incident_id")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),
    callTaskId: text("call_task_id")
      .notNull()
      .references(() => callTasks.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    sourceRole: text("source_role").notNull(),
    field: text("field").notNull(),
    value: text("value").notNull(),
    resolved: boolean("resolved").notNull(),
    verified: boolean("verified").notNull(),
    certainty: text("certainty").notNull(),
    evidenceJson: jsonb("evidence_json").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("observations_task_field_uq").on(t.callTaskId, t.field),
    index("observations_incident_idx").on(t.incidentId),
  ],
);

export const recoveryActions = pgTable(
  "recovery_actions",
  {
    id: text("id").primaryKey(),
    incidentId: text("incident_id")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    title: text("title").notNull(),
    rationale: text("rationale").notNull(),
    owner: text("owner").notNull(),
    requiresCall: boolean("requires_call").notNull(),
    contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    status: text("status").notNull(),
    approvedBy: text("approved_by"),
    approvedAt: ts("approved_at"),
    callTaskId: text("call_task_id").references(() => callTasks.id, { onDelete: "set null" }),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("recovery_actions_incident_code_uq").on(t.incidentId, t.code)],
);

export const auditEntries = pgTable(
  "audit_entries",
  {
    id: text("id").primaryKey(),
    incidentId: text("incident_id")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    detailJson: jsonb("detail_json").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("audit_entries_incident_idx").on(t.incidentId, t.createdAt)],
);

export type IncidentRow = typeof incidents.$inferSelect;
export type ContactRow = typeof contacts.$inferSelect;
export type CallTaskRow = typeof callTasks.$inferSelect;
export type CallEventRow = typeof callEvents.$inferSelect;
export type ObservationRow = typeof observations.$inferSelect;
export type RecoveryActionRow = typeof recoveryActions.$inferSelect;
export type AuditEntryRow = typeof auditEntries.$inferSelect;
