import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { launchFactFinding } from "@/lib/dispatch";
import { buildIncidentView } from "@/lib/incident-view";
import { reconcileOpenTasks } from "@/lib/reconcile";
import { processWebhook } from "@/lib/webhook";
import { renderIncidentMarkdown } from "@/lib/markdown";
import { createTestRepo, fakeCalle, providerCall, sampleIncident, sampleResult } from "./helpers";

let ctx: Awaited<ReturnType<typeof createTestRepo>>;
let calle: ReturnType<typeof fakeCalle>;
let driverCallId: string;
let dockCallId: string;

beforeEach(async () => {
  ctx = await createTestRepo();
  await ctx.repo.createIncident(sampleIncident());
  calle = fakeCalle();
  await launchFactFinding({ repo: ctx.repo, calle: calle.client, webhookUrl: "https://x.example/api/webhooks/calle" }, { incidentId: "DS-1042", operatorName: "Ops", authorizationConfirmed: true, authorizationText: "ok" });
  driverCallId = calle.created.find((c) => c.req.metadata.contact_role === "driver")!.call.id;
  dockCallId = calle.created.find((c) => c.req.metadata.contact_role === "receiving_dock")!.call.id;
});
afterEach(() => ctx.close());

const deps = () => ({ repo: ctx.repo, calle: calle.client });
const event = (id: string, type: "call.completed" | "call.failed" | "call.result_validation_failed", data: unknown) => ({ id, type, created_at: "2026-09-08T06:35:00Z", data });

describe("CALL-E webhook receiver", () => {
  it("requires a matching CALL-E-Event-Id header", async () => {
    const snap = providerCall({ id: driverCallId, result: sampleResult() });
    expect((await processWebhook(deps(), null, event("evt_1", "call.completed", snap))).status).toBe(400);
    expect((await processWebhook(deps(), "evt_other", event("evt_1", "call.completed", snap))).status).toBe(400);
    expect((await processWebhook(deps(), "evt_1", { id: "evt_1", type: "call.exploded", data: snap })).status).toBe(400);
    expect(await ctx.repo.getEvents("DS-1042")).toHaveLength(0);
  });

  it("reconciles against GET /v1/calls before changing the incident, and the fetched snapshot wins", async () => {
    // The webhook body claims a result, but the authoritative fetch says validation failed.
    const claimed = providerCall({ id: driverCallId, result: sampleResult() });
    calle.snapshots.set(driverCallId, providerCall({ id: driverCallId, status: "completed", result: null, summary: "Result could not be extracted." }));
    const outcome = await processWebhook(deps(), "evt_1", event("evt_1", "call.completed", claimed));
    expect(outcome.status).toBe(200);
    expect(outcome.body).toMatchObject({ taskId: expect.any(String), status: "result_validation_failed" });
    const task = await ctx.repo.getTaskByProviderCallId(driverCallId);
    expect(task?.status).toBe("result_validation_failed");
    expect(task?.structuredResultJson).toBeNull();
    expect(await ctx.repo.getObservations("DS-1042")).toHaveLength(0);
  });

  it("ignores a duplicate delivery without a second side effect", async () => {
    calle.snapshots.set(driverCallId, providerCall({ id: driverCallId, result: sampleResult(), transcript: [{ offset_seconds: 0, speaker: "bot", text: "Hello" }] }));
    const body = event("evt_dup", "call.completed", calle.snapshots.get(driverCallId));
    const first = await processWebhook(deps(), "evt_dup", body);
    expect(first.status).toBe(200);
    const auditAfterFirst = (await ctx.repo.getAudit("DS-1042")).length;
    const observationsAfterFirst = (await ctx.repo.getObservations("DS-1042")).length;
    expect(observationsAfterFirst).toBe(9);
    const second = await processWebhook(deps(), "evt_dup", body);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ duplicate: true });
    expect((await ctx.repo.getAudit("DS-1042")).length).toBe(auditAfterFirst);
    expect((await ctx.repo.getObservations("DS-1042")).length).toBe(observationsAfterFirst);
    expect(await ctx.repo.getEvents("DS-1042")).toHaveLength(1);
  });

  it("stores summary, completion, confidence, evidence, result, and transcript; verified only for resolved fields", async () => {
    calle.snapshots.set(
      driverCallId,
      providerCall({
        id: driverCallId,
        result: sampleResult({ next_action: "", blocker: "unknown" }),
        summary: "Driver is at customs and expects 16:40.",
        evidence: ["Driver said 16:40."],
        confidence: { score: 0.81, label: "high" },
        transcript: [
          { offset_seconds: 0, speaker: "bot", text: "Hi, I am an AI assistant calling for Northwind." },
          { offset_seconds: 6, speaker: "user", text: "I am at customs, 16:40 latest." },
        ],
      }),
    );
    const outcome = await processWebhook(deps(), "evt_2", event("evt_2", "call.completed", calle.snapshots.get(driverCallId)));
    expect(outcome.status).toBe(200);
    const task = (await ctx.repo.getTaskByProviderCallId(driverCallId))!;
    expect(task.status).toBe("completed");
    expect(task.providerSummary).toBe("Driver is at customs and expects 16:40.");
    expect(task.taskCompleted).toBe(true);
    expect(task.completionConfidenceLabel).toBe("high");
    expect(Number(task.completionConfidenceScore)).toBeCloseTo(0.81);
    expect(task.evidenceJson).toEqual(["Driver said 16:40."]);
    expect(Array.isArray(task.transcriptJson) && (task.transcriptJson as unknown[]).length).toBe(2);
    const obs = await ctx.repo.getObservations("DS-1042");
    const byField = Object.fromEntries(obs.map((o) => [o.field, o]));
    expect(byField.revised_eta).toMatchObject({ value: "16:40", resolved: true, verified: true });
    expect(byField.next_action).toMatchObject({ value: "", resolved: false, verified: false });
    expect(byField.blocker).toMatchObject({ value: "unknown", resolved: false, verified: false });
    const audit = await ctx.repo.getAudit("DS-1042");
    expect(audit.at(-1)).toMatchObject({ actor: "CALL-E webhook", action: "call_completed" });
  });

  it("marks failed calls failed and keeps every field unverified", async () => {
    calle.snapshots.set(dockCallId, providerCall({ id: dockCallId, status: "failed", failureCode: "no_answer_like", failureMessage: "The call was not answered.", phone: "+12025550101" }));
    const outcome = await processWebhook(deps(), "evt_3", event("evt_3", "call.failed", calle.snapshots.get(dockCallId)));
    expect(outcome.status).toBe(200);
    const task = (await ctx.repo.getTaskByProviderCallId(dockCallId))!;
    expect(task.status).toBe("failed");
    expect(task.failureMessage).toBe("The call was not answered.");
    const view = await buildIncidentView(ctx.repo, (await ctx.repo.getIncident("DS-1042"))!);
    expect(view.card.unresolvedTasks.map((u) => u.role)).toContain("receiving_dock");
    expect((await ctx.repo.getObservations("DS-1042")).filter((o) => o.callTaskId === task.id)).toHaveLength(0);
  });

  it("returns 404 for a call DockSignal does not know so the provider retries", async () => {
    const outcome = await processWebhook(deps(), "evt_4", event("evt_4", "call.completed", providerCall({ id: "call_unknown_1", result: sampleResult() })));
    expect(outcome.status).toBe(404);
  });

  it("leaves the event retryable when reconciliation fails, then processes the retry once", async () => {
    calle.snapshots.delete(driverCallId); // GET /v1/calls fails
    const body = event("evt_5", "call.completed", providerCall({ id: driverCallId, result: sampleResult() }));
    const failed = await processWebhook(deps(), "evt_5", body);
    expect(failed.status).toBe(500);
    expect((await ctx.repo.getTaskByProviderCallId(driverCallId))!.status).toBe("in_progress");
    calle.snapshots.set(driverCallId, providerCall({ id: driverCallId, result: sampleResult() }));
    const retried = await processWebhook(deps(), "evt_5", body);
    expect(retried.status).toBe(200);
    expect(retried.body).toMatchObject({ retry: true, status: "completed" });
    const dup = await processWebhook(deps(), "evt_5", body);
    expect(dup.body).toMatchObject({ duplicate: true });
    expect(await ctx.repo.getEvents("DS-1042")).toHaveLength(1);
  });

  it("one real structured result changes the recommendation end to end and lands in the Markdown summary", async () => {
    calle.snapshots.set(dockCallId, providerCall({ id: dockCallId, result: sampleResult({ contact_role: "receiving_dock", revised_eta: "16:00", can_accept: "conditional", current_status: "Dock open until 16:00", blocker: "No receiving after 16:00" }), phone: "+12025550101" }));
    await processWebhook(deps(), "evt_dock", event("evt_dock", "call.completed", calle.snapshots.get(dockCallId)));
    calle.snapshots.set(driverCallId, providerCall({ id: driverCallId, result: sampleResult({ revised_eta: "15:20" }) }));
    await processWebhook(deps(), "evt_drv1", event("evt_drv1", "call.completed", calle.snapshots.get(driverCallId)));
    let view = await buildIncidentView(ctx.repo, (await ctx.repo.getIncident("DS-1042"))!);
    expect(view.card.branch).toBe("within_window");
    expect(view.incident.status).toBe("review");

    // The reconciliation job later finds the provider snapshot changed (a later attempt) with a later ETA.
    calle.snapshots.set(driverCallId, providerCall({ id: driverCallId, result: sampleResult({ revised_eta: "16:40" }) }));
    const task = (await ctx.repo.getTaskByProviderCallId(driverCallId))!;
    await ctx.repo.applyProviderSnapshot(task.id, calle.snapshots.get(driverCallId)!, { source: "reconcile" });
    view = await buildIncidentView(ctx.repo, (await ctx.repo.getIncident("DS-1042"))!);
    expect(view.card.branch).toBe("window_missed");
    expect(view.recoveryActions.map((a) => [a.code, a.status])).toEqual(
      expect.arrayContaining([
        ["confirm_arrival_with_dock", "superseded"],
        ["request_dock_exception", "suggested"],
      ]),
    );
    const md = renderIncidentMarkdown(view);
    expect(md).toContain("Revised ETA is after the receiving cutoff");
    expect(md).toContain(driverCallId);
    expect(md).toContain("+12*******00");
    expect(md).not.toContain("+12025550100");
  });
});

describe("reconciliation job", () => {
  it("applies terminal snapshots for open tasks and leaves terminal tasks alone", async () => {
    calle.snapshots.set(driverCallId, providerCall({ id: driverCallId, result: sampleResult() }));
    // dock still in progress
    const first = await reconcileOpenTasks(deps(), {});
    expect(first.checked).toBe(2);
    expect(first.updated).toHaveLength(1);
    expect((await ctx.repo.getTaskByProviderCallId(driverCallId))!.status).toBe("completed");
    expect((await ctx.repo.getTaskByProviderCallId(dockCallId))!.status).toBe("in_progress");
    const second = await reconcileOpenTasks(deps(), {});
    expect(second.checked).toBe(1);
    expect(second.updated).toHaveLength(0);
    // a stale non-terminal snapshot never regresses a terminal task
    const task = (await ctx.repo.getTaskByProviderCallId(driverCallId))!;
    const regress = await ctx.repo.applyProviderSnapshot(task.id, providerCall({ id: driverCallId, status: "in_progress" }), { source: "reconcile" });
    expect(regress.status).toBe("completed");
  });

  it("reports provider errors without failing the whole pass", async () => {
    calle.snapshots.delete(dockCallId);
    calle.snapshots.set(driverCallId, providerCall({ id: driverCallId, result: sampleResult() }));
    const report = await reconcileOpenTasks(deps(), {});
    expect(report.updated).toHaveLength(1);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]!.error).toMatch(/not_found/);
  });
});
