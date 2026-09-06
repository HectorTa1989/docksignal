import { z } from "zod";
import { calleConfig } from "./env";

/**
 * Thin, typed client for the CALL-E Developer API (https://docs.heycall-e.com).
 * Only server code imports this module. It never runs in the browser.
 */

export const CALL_STATUSES = ["queued", "in_progress", "completed", "failed", "canceled"] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];
export type WebhookEventType = "call.completed" | "call.failed" | "call.result_validation_failed";

const transcriptTurnZ = z.object({
  offset_seconds: z.number().nullable().optional(),
  speaker: z.string(),
  text: z.string(),
});
const attemptZ = z
  .object({
    id: z.string(),
    phone: z.string().nullable().optional(),
    status: z.string(),
    started_at: z.string().nullable().optional(),
    completed_at: z.string().nullable().optional(),
    summary: z.string().nullable().optional(),
    transcript_turns: z.array(transcriptTurnZ).optional().default([]),
    provider_call_id: z.string().nullable().optional(),
    failure_code: z.string().nullable().optional(),
    failure_message: z.string().nullable().optional(),
  })
  .loose();
const recipientZ = z
  .object({
    id: z.string(),
    phones: z.array(z.string()).optional().default([]),
    locale: z.string().nullable().optional(),
    region: z.string().nullable().optional(),
    status: z.string(),
    structured_result: z.record(z.string(), z.unknown()).nullable().optional(),
    summary: z.string().nullable().optional(),
    attempts: z.array(attemptZ).optional().default([]),
  })
  .loose();
export const callTaskZ = z
  .object({
    id: z.string().regex(/^call_[A-Za-z0-9_-]+$/),
    object: z.literal("call_task").optional(),
    status: z.enum(CALL_STATUSES),
    task: z.string().optional().default(""),
    recipients: z.array(recipientZ).optional().default([]),
    structured_result: z.record(z.string(), z.unknown()).nullable().optional(),
    summary: z.string().nullable().optional(),
    task_completed: z.boolean().nullable().optional(),
    completion_confidence: z.object({ score: z.number(), label: z.string() }).nullable().optional(),
    evidence: z.array(z.string()).optional().default([]),
    metadata: z.record(z.string(), z.unknown()).optional().default({}),
    failure_code: z.string().nullable().optional(),
    failure_message: z.string().nullable().optional(),
    created_at: z.string().optional(),
    completed_at: z.string().nullable().optional(),
  })
  .loose();
export const webhookEventZ = z
  .object({
    id: z.string().min(1),
    type: z.enum(["call.completed", "call.failed", "call.result_validation_failed"]),
    created_at: z.string().optional(),
    data: callTaskZ,
  })
  .loose();

export type CallTask = z.infer<typeof callTaskZ>;
export type CallTaskRecipient = z.infer<typeof recipientZ>;
export type CallTaskAttempt = z.infer<typeof attemptZ>;
export type TranscriptTurn = z.infer<typeof transcriptTurnZ>;
export type WebhookEvent = z.infer<typeof webhookEventZ>;

export interface CreateCallRequest {
  task: string;
  recipients: Array<{ phones: string[]; locale?: string | null; region?: string | null }>;
  recipient_result_schema: Record<string, unknown>;
  metadata: Record<string, unknown>;
  webhook_url: string;
}

export class CalleApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly details: unknown = {},
  ) {
    super(message);
    this.name = "CalleApiError";
  }
  get isAuthFailure() {
    return this.status === 401 || this.status === 403 || this.code === "unauthorized" || this.code === "forbidden";
  }
}

export function isTerminal(status: string): boolean {
  return status === "completed" || status === "failed" || status === "canceled";
}

export function parseCallTask(value: unknown): CallTask {
  const parsed = callTaskZ.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`CALL-E call task payload is malformed at ${issue?.path.join(".") || "(root)"}: ${issue?.message}`);
  }
  return parsed.data;
}

/** The DockSignal recipient result lives on the single recipient of each call task. */
export function recipientOf(call: CallTask): CallTaskRecipient | null {
  return call.recipients[0] ?? null;
}

export function transcriptOf(call: CallTask): TranscriptTurn[] {
  const recipient = recipientOf(call);
  if (!recipient) return [];
  const attempts = [...recipient.attempts].sort((a, b) => (a.started_at ?? "").localeCompare(b.started_at ?? ""));
  const last = attempts.at(-1);
  return last?.transcript_turns ?? [];
}

async function request<T>(path: string, init: RequestInit & { idempotencyKey?: string } = {}): Promise<T> {
  const config = calleConfig();
  if (!config.ok) throw new CalleApiError(config.reason, 0, "not_configured", { missing: config.missing });
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${config.apiKey}`);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  if (init.idempotencyKey) headers.set("Idempotency-Key", init.idempotencyKey);
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${path}`, { ...init, headers, cache: "no-store" });
  } catch (error) {
    throw new CalleApiError(`CALL-E is unreachable: ${error instanceof Error ? error.message : "network error"}`, 0, "network_error");
  }
  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    const envelope = json as { error?: { code?: string; message?: string; details?: unknown } } | null;
    const code = envelope?.error?.code ?? (response.status === 401 ? "unauthorized" : `http_${response.status}`);
    const message = envelope?.error?.message ?? text.slice(0, 300) ?? response.statusText;
    throw new CalleApiError(`CALL-E ${code}: ${message}`, response.status, code, envelope?.error?.details ?? {});
  }
  return json as T;
}

export interface CalleClient {
  createCall(body: CreateCallRequest, idempotencyKey: string): Promise<CallTask>;
  getCall(callId: string): Promise<CallTask>;
}

export const calleClient: CalleClient = {
  async createCall(body, idempotencyKey) {
    const raw = await request<unknown>("/v1/calls", { method: "POST", body: JSON.stringify(body), idempotencyKey });
    return parseCallTask(raw);
  },
  async getCall(callId) {
    const raw = await request<unknown>(`/v1/calls/${encodeURIComponent(callId)}`, { method: "GET" });
    return parseCallTask(raw);
  },
};

export type CredentialProbe =
  | { state: "missing"; reason: string; missing: string[] }
  | { state: "accepted"; checkedAt: string }
  | { state: "rejected"; reason: string; checkedAt: string }
  | { state: "unknown"; reason: string; checkedAt: string };

let probeCache: { result: CredentialProbe; at: number } | null = null;
const PROBE_TTL_MS = 5 * 60 * 1000;

/**
 * Verifies the API key without side effects: GET on a call id that cannot exist must
 * return `not_found` with a valid key, and `unauthorized` with a rejected key.
 */
export async function probeCredentials(force = false): Promise<CredentialProbe> {
  const config = calleConfig();
  if (!config.ok) return { state: "missing", reason: config.reason, missing: config.missing };
  if (!force && probeCache && Date.now() - probeCache.at < PROBE_TTL_MS) return probeCache.result;
  const checkedAt = new Date().toISOString();
  let result: CredentialProbe;
  try {
    await request("/v1/calls/call_docksignal_credential_probe", { method: "GET" });
    result = { state: "accepted", checkedAt };
  } catch (error) {
    if (error instanceof CalleApiError) {
      if (error.isAuthFailure) result = { state: "rejected", reason: error.message, checkedAt };
      else if (error.status === 404 || error.code === "not_found" || error.code === "invalid_request")
        result = { state: "accepted", checkedAt };
      else result = { state: "unknown", reason: error.message, checkedAt };
    } else {
      result = { state: "unknown", reason: error instanceof Error ? error.message : "probe failed", checkedAt };
    }
  }
  probeCache = { result, at: Date.now() };
  return result;
}

export function resetProbeCache() {
  probeCache = null;
}
