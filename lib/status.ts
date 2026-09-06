import type { CallTask, WebhookEventType } from "./calle";

export const TASK_STATUSES = [
  "queued",
  "dispatching",
  "dispatch_failed",
  "in_progress",
  "completed",
  "failed",
  "result_validation_failed",
  "canceled",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskKind = "fact_finding" | "follow_up";

export const INCIDENT_STATUSES = ["draft", "calling", "review", "follow_up_calling", "closed"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const TERMINAL_TASK_STATUSES: TaskStatus[] = ["completed", "failed", "result_validation_failed", "canceled"];
export const OPEN_TASK_STATUSES: TaskStatus[] = ["dispatching", "in_progress"];

export function isTerminalTaskStatus(status: string): boolean {
  return (TERMINAL_TASK_STATUSES as string[]).includes(status);
}

/**
 * Map a provider call task (from GET /v1/calls/{id}) to DockSignal's task status.
 * A completed call without a schema-valid recipient result is a validation failure,
 * never a success. The webhook event type is only a hint; the fetched snapshot wins.
 */
export function mapProviderStatus(call: CallTask, eventType?: WebhookEventType): TaskStatus {
  switch (call.status) {
    case "queued":
    case "in_progress":
      return "in_progress";
    case "failed":
      return "failed";
    case "canceled":
      return "canceled";
    case "completed": {
      const result = call.recipients[0]?.structured_result ?? null;
      if (eventType === "call.result_validation_failed" || !result) return "result_validation_failed";
      return "completed";
    }
  }
}

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  queued: "Queued",
  dispatching: "Dispatching",
  dispatch_failed: "Dispatch failed",
  in_progress: "In progress",
  completed: "Completed",
  failed: "Failed",
  result_validation_failed: "Validation failed",
  canceled: "Canceled",
};
