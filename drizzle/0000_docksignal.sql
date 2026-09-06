CREATE TABLE "audit_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"incident_id" text NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"detail_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "call_events" (
	"id" text PRIMARY KEY NOT NULL,
	"call_task_id" text NOT NULL,
	"provider_call_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"processing_error" text
);
--> statement-breakpoint
CREATE TABLE "call_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"incident_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"kind" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"provider_call_id" text,
	"status" text NOT NULL,
	"task_text" text NOT NULL,
	"goal_summary" text NOT NULL,
	"result_schema_json" jsonb NOT NULL,
	"last_error" text,
	"provider_status" text,
	"recipient_status" text,
	"provider_summary" text,
	"recipient_summary" text,
	"task_completed" boolean,
	"completion_confidence_score" numeric,
	"completion_confidence_label" text,
	"evidence_json" jsonb,
	"structured_result_json" jsonb,
	"transcript_json" jsonb,
	"provider_snapshot_json" jsonb,
	"failure_code" text,
	"failure_message" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"dispatched_at" timestamp with time zone,
	"provider_completed_at" timestamp with time zone,
	"last_reconciled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"incident_id" text NOT NULL,
	"role" text NOT NULL,
	"name" text NOT NULL,
	"phone_e164" text NOT NULL,
	"region" text NOT NULL,
	"locale" text NOT NULL,
	"authorization_note" text NOT NULL,
	"include_in_fact_finding" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" text PRIMARY KEY NOT NULL,
	"shipment_ref" text NOT NULL,
	"org_name" text NOT NULL,
	"promised_dock_at" timestamp with time zone NOT NULL,
	"receiving_cutoff_at" timestamp with time zone,
	"timezone" text NOT NULL,
	"last_known_location" text NOT NULL,
	"cargo_description" text NOT NULL,
	"status" text NOT NULL,
	"operator_name" text NOT NULL,
	"authorization_confirmed_at" timestamp with time zone,
	"authorization_text" text,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "observations" (
	"id" text PRIMARY KEY NOT NULL,
	"incident_id" text NOT NULL,
	"call_task_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"source_role" text NOT NULL,
	"field" text NOT NULL,
	"value" text NOT NULL,
	"resolved" boolean NOT NULL,
	"verified" boolean NOT NULL,
	"certainty" text NOT NULL,
	"evidence_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recovery_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"incident_id" text NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"rationale" text NOT NULL,
	"owner" text NOT NULL,
	"requires_call" boolean NOT NULL,
	"contact_id" text,
	"status" text NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"call_task_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_entries" ADD CONSTRAINT "audit_entries_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_events" ADD CONSTRAINT "call_events_call_task_id_call_tasks_id_fk" FOREIGN KEY ("call_task_id") REFERENCES "public"."call_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_tasks" ADD CONSTRAINT "call_tasks_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_tasks" ADD CONSTRAINT "call_tasks_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_call_task_id_call_tasks_id_fk" FOREIGN KEY ("call_task_id") REFERENCES "public"."call_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_actions" ADD CONSTRAINT "recovery_actions_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_actions" ADD CONSTRAINT "recovery_actions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_actions" ADD CONSTRAINT "recovery_actions_call_task_id_call_tasks_id_fk" FOREIGN KEY ("call_task_id") REFERENCES "public"."call_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_entries_incident_idx" ON "audit_entries" USING btree ("incident_id","created_at");--> statement-breakpoint
CREATE INDEX "call_events_task_idx" ON "call_events" USING btree ("call_task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "call_tasks_idempotency_key_uq" ON "call_tasks" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "call_tasks_provider_call_id_uq" ON "call_tasks" USING btree ("provider_call_id");--> statement-breakpoint
CREATE INDEX "call_tasks_incident_idx" ON "call_tasks" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX "call_tasks_status_idx" ON "call_tasks" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_incident_role_uq" ON "contacts" USING btree ("incident_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "observations_task_field_uq" ON "observations" USING btree ("call_task_id","field");--> statement-breakpoint
CREATE INDEX "observations_incident_idx" ON "observations" USING btree ("incident_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recovery_actions_incident_code_uq" ON "recovery_actions" USING btree ("incident_id","code");