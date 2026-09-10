import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import type { CalleClient, CallTask, CreateCallRequest } from "@/lib/calle";
import { createRepository, type NewIncident } from "@/lib/repository";
import type { RecipientResult } from "@/lib/result-schema";

/**
 * Test-only helpers. PGlite runs real PostgreSQL SQL in-process so the unique constraints,
 * ON CONFLICT clauses, and transactions are exercised exactly as in production. Nothing in
 * this file is importable by application code.
 */
export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../drizzle") });
  return { db: db as unknown as Db, close: () => client.close() };
}

export async function createTestRepo() {
  const { db, close } = await createTestDb();
  return { repo: createRepository(db), db, close };
}

export const sampleIncident = (overrides: Partial<NewIncident> = {}): NewIncident => ({
  id: "DS-1042",
  shipmentRef: "SHP-88214",
  orgName: "Northwind Freight Operations",
  promisedDockAt: "2026-09-08T06:00:00.000Z", // 14:00 Asia/Singapore
  receivingCutoffAt: "2026-09-08T08:00:00.000Z", // 16:00 Asia/Singapore
  timezone: "Asia/Singapore",
  lastKnownLocation: "Last ping near Tuas Checkpoint",
  cargoDescription: "18 pallets chilled produce",
  operatorName: "Ops desk",
  contacts: [
    { role: "driver", name: "Driver", phoneE164: "+12025550100", region: "US", locale: "en-US", authorizationNote: "test-controlled", includeInFactFinding: true },
    { role: "receiving_dock", name: "Dock 7", phoneE164: "+12025550101", region: "US", locale: "en-US", authorizationNote: "test-controlled", includeInFactFinding: true },
    { role: "dispatcher", name: "Dispatch", phoneE164: "+12025550102", region: "US", locale: "en-US", authorizationNote: "test-controlled", includeInFactFinding: false },
  ],
  ...overrides,
});

export const sampleResult = (overrides: Partial<RecipientResult> = {}): RecipientResult => ({
  contact_role: "driver",
  reached: "yes",
  shipment_recognized: "yes",
  current_status: "Stuck at Tuas Checkpoint, customs queue",
  revised_eta: "16:40",
  can_accept: "unknown",
  blocker: "Customs inspection queue",
  next_action: "Will call when 30 minutes out",
  certainty: "high",
  ...overrides,
});

let callCounter = 0;

/** Build a provider CallTask snapshot the way GET /v1/calls/{id} returns it. Test fixture only. */
export function providerCall(opts: {
  id?: string;
  status?: CallTask["status"];
  result?: Record<string, unknown> | null;
  phone?: string;
  summary?: string | null;
  evidence?: string[];
  taskCompleted?: boolean | null;
  confidence?: { score: number; label: string } | null;
  failureCode?: string | null;
  failureMessage?: string | null;
  transcript?: Array<{ offset_seconds: number | null; speaker: string; text: string }>;
  metadata?: Record<string, unknown>;
}): CallTask {
  callCounter += 1;
  const status = opts.status ?? "completed";
  const terminal = status === "completed" || status === "failed" || status === "canceled";
  return {
    id: opts.id ?? `call_test_${callCounter}`,
    object: "call_task",
    status,
    task: "test task",
    recipients: [
      {
        id: `rcp_${callCounter}`,
        phones: [opts.phone ?? "+12025550100"],
        locale: "en-US",
        region: "US",
        status: status === "completed" ? "completed" : status === "failed" ? "failed" : "in_progress",
        structured_result: opts.result === undefined ? null : opts.result,
        summary: opts.summary ?? null,
        attempts: [
          {
            id: `att_${callCounter}`,
            phone: opts.phone ?? "+12025550100",
            status: status === "completed" ? "completed" : status === "failed" ? "failed" : "in_progress",
            started_at: "2026-09-08T06:30:00Z",
            completed_at: terminal ? "2026-09-08T06:33:00Z" : null,
            summary: null,
            transcript_turns: opts.transcript ?? [],
            provider_call_id: `prov_${callCounter}`,
            failure_code: opts.failureCode ?? null,
            failure_message: opts.failureMessage ?? null,
          },
        ],
      },
    ],
    structured_result: null,
    summary: opts.summary ?? null,
    task_completed: opts.taskCompleted ?? (terminal ? status === "completed" : null),
    completion_confidence: opts.confidence === undefined ? (terminal ? { score: 0.9, label: "high" } : null) : opts.confidence,
    evidence: opts.evidence ?? (terminal ? ["The recipient stated the facts clearly."] : []),
    metadata: opts.metadata ?? {},
    failure_code: opts.failureCode ?? null,
    failure_message: opts.failureMessage ?? null,
    created_at: "2026-09-08T06:29:00Z",
    completed_at: terminal ? "2026-09-08T06:33:00Z" : null,
  };
}

/** A recording fake of the CALL-E HTTP boundary. Application code never imports it. */
export function fakeCalle(options: { createBehaviour?: (req: CreateCallRequest, key: string) => CallTask | Error; snapshots?: Map<string, CallTask> } = {}) {
  const created: Array<{ req: CreateCallRequest; key: string; call: CallTask }> = [];
  const snapshots = options.snapshots ?? new Map<string, CallTask>();
  const byKey = new Map<string, CallTask>();
  const client: CalleClient = {
    async createCall(req, key) {
      const existing = byKey.get(key);
      if (existing) return existing; // provider-side idempotency
      const outcome = options.createBehaviour ? options.createBehaviour(req, key) : providerCall({ status: "queued", phone: req.recipients[0]?.phones[0] });
      if (outcome instanceof Error) throw outcome;
      byKey.set(key, outcome);
      snapshots.set(outcome.id, outcome);
      created.push({ req, key, call: outcome });
      return outcome;
    },
    async getCall(callId) {
      const snap = snapshots.get(callId);
      if (!snap) throw new Error(`not_found: ${callId}`);
      return snap;
    },
  };
  return { client, created, snapshots, byKey };
}
