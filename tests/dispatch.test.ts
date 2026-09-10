import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CalleApiError } from "@/lib/calle";
import { launchFactFinding, launchFollowUp } from "@/lib/dispatch";
import { buildIncidentView } from "@/lib/incident-view";
import { createRepository } from "@/lib/repository";
import { createTestRepo, fakeCalle, providerCall, sampleIncident, sampleResult } from "./helpers";

let ctx: Awaited<ReturnType<typeof createTestRepo>>;
const WEBHOOK = "https://docksignal.example.com/api/webhooks/calle";

beforeEach(async () => {
  ctx = await createTestRepo();
  await ctx.repo.createIncident(sampleIncident());
});
afterEach(() => ctx.close());

const launch = (client: ReturnType<typeof fakeCalle>["client"], repo = ctx.repo) =>
  launchFactFinding({ repo, calle: client, webhookUrl: WEBHOOK }, { incidentId: "DS-1042", operatorName: "Ops", authorizationConfirmed: true, authorizationText: "authorized" });

describe("fact-finding dispatch", () => {
  it("creates one CALL-E call per included contact with the full request contract", async () => {
    const calle = fakeCalle();
    const results = await launch(calle.client);
    expect(results.map((r) => r.outcome)).toEqual(["created", "created"]);
    expect(calle.created).toHaveLength(2);
    const driver = calle.created.find((c) => c.req.metadata.contact_role === "driver")!;
    expect(driver.key).toBe("docksignal:DS-1042:DS-1042:driver:fact_finding:v1");
    expect(driver.req.recipients).toEqual([{ phones: ["+12025550100"], locale: "en-US", region: "US" }]);
    expect(driver.req.webhook_url).toBe(WEBHOOK);
    expect(driver.req.recipient_result_schema).toMatchObject({ additionalProperties: false });
    expect(driver.req.metadata).toMatchObject({ incident_id: "DS-1042", kind: "fact_finding", app: "docksignal" });
    expect(driver.req.task).toMatch(/AI assistant calling on behalf of Northwind Freight Operations/);
    expect(driver.req.task).toMatch(/SHP-88214/);
    const tasks = await ctx.repo.getTasks("DS-1042");
    expect(tasks.every((t) => t.providerCallId && t.status === "in_progress")).toBe(true);
    expect((await ctx.repo.getIncident("DS-1042"))!.status).toBe("calling");
    expect((await ctx.repo.getAudit("DS-1042")).map((a) => a.action)).toEqual(["incident_created", "authorization_confirmed", "call_created", "call_created"]);
  });

  it("refuses without authorization and never touches CALL-E", async () => {
    const calle = fakeCalle();
    await expect(
      launchFactFinding({ repo: ctx.repo, calle: calle.client, webhookUrl: WEBHOOK }, { incidentId: "DS-1042", operatorName: "Ops", authorizationConfirmed: false, authorizationText: "" }),
    ).rejects.toThrow(/Authorization confirmation/);
    expect(calle.created).toHaveLength(0);
    expect(await ctx.repo.getTasks("DS-1042")).toHaveLength(0);
  });

  it("does not create a duplicate call on a second launch, a refresh, or after a restart", async () => {
    const calle = fakeCalle();
    await launch(calle.client);
    const second = await launch(calle.client);
    expect(second.map((r) => r.outcome)).toEqual(["already_dispatched", "already_dispatched"]);
    // "restart": a brand-new repository instance over the same database
    const restarted = createRepository(ctx.db);
    const third = await launch(calle.client, restarted);
    expect(third.map((r) => r.outcome)).toEqual(["already_dispatched", "already_dispatched"]);
    expect(calle.created).toHaveLength(2);
    expect(await ctx.repo.countCallsCreated()).toBe(2);
  });

  it("lets exactly one of two concurrent launches create each call", async () => {
    const calle = fakeCalle();
    const [a, b] = await Promise.all([launch(calle.client), launch(calle.client)]);
    const outcomes = [...a, ...b].map((r) => r.outcome).sort();
    expect(outcomes.filter((o) => o === "created")).toHaveLength(2);
    expect(calle.created).toHaveLength(2);
  });

  it("records a dispatch failure as dispatch_failed and retries with the same idempotency key", async () => {
    let attempts = 0;
    const failing = fakeCalle({
      createBehaviour: (req) => {
        attempts += 1;
        return attempts <= 2 ? new CalleApiError("CALL-E insufficient_balance: top up", 402, "insufficient_balance") : providerCall({ status: "queued", phone: req.recipients[0]?.phones[0] });
      },
    });
    const first = await launch(failing.client);
    expect(first.every((r) => r.outcome === "failed" && r.code === "insufficient_balance")).toBe(true);
    const tasks = await ctx.repo.getTasks("DS-1042");
    expect(tasks.every((t) => t.status === "dispatch_failed" && t.providerCallId === null)).toBe(true);
    const keys = tasks.map((t) => t.idempotencyKey);
    const second = await launch(failing.client);
    expect(second.every((r) => r.outcome === "created")).toBe(true);
    expect(failing.created.map((c) => c.key).sort()).toEqual(keys.sort());
  });

  it("rejects an auth failure without inventing a call", async () => {
    const calle = fakeCalle({ createBehaviour: () => new CalleApiError("CALL-E unauthorized: bad key", 401, "unauthorized") });
    const results = await launch(calle.client);
    expect(results.every((r) => r.outcome === "failed" && r.code === "unauthorized")).toBe(true);
    const view = await buildIncidentView(ctx.repo, (await ctx.repo.getIncident("DS-1042"))!);
    expect(view.tasks.every((t) => t.status === "dispatch_failed" && t.providerCallId === null)).toBe(true);
    expect(view.card.branch).toBe("awaiting_results");
  });
});

describe("follow-up approval gate", () => {
  async function reachWindowMissed(calle: ReturnType<typeof fakeCalle>) {
    await launch(calle.client);
    for (const created of calle.created) {
      const role = created.req.metadata.contact_role as string;
      const result =
        role === "driver"
          ? sampleResult({ revised_eta: "16:40" })
          : sampleResult({ contact_role: "receiving_dock", revised_eta: "16:00", can_accept: "conditional", current_status: "dock open until 16:00" });
      calle.snapshots.set(created.call.id, providerCall({ id: created.call.id, status: "completed", result, phone: created.req.recipients[0]?.phones[0] }));
      const task = await ctx.repo.getTaskByProviderCallId(created.call.id);
      await ctx.repo.applyProviderSnapshot(task!.id, calle.snapshots.get(created.call.id)!, { source: "reconcile" });
    }
    return buildIncidentView(ctx.repo, (await ctx.repo.getIncident("DS-1042"))!);
  }

  it("suggests the exception call but never dispatches it without an explicit approval", async () => {
    const calle = fakeCalle();
    const view = await reachWindowMissed(calle);
    expect(view.card.branch).toBe("window_missed");
    expect(view.recoveryActions.find((a) => a.code === "request_dock_exception")?.status).toBe("suggested");
    expect(calle.created).toHaveLength(2);
    await expect(
      launchFollowUp(
        { repo: ctx.repo, calle: calle.client, webhookUrl: WEBHOOK },
        { incidentId: "DS-1042", actionCode: "request_dock_exception", operatorName: "Ops", humanApproved: false, context: { revisedEtaDisplay: "16:40", driverStatement: "x", dockConstraint: "y" } },
      ),
    ).rejects.toThrow(/human approval/);
    expect(calle.created).toHaveLength(2);
  });

  it("creates exactly one approved follow-up call with the operator recorded, and blocks a second one", async () => {
    const calle = fakeCalle();
    await reachWindowMissed(calle);
    const deps = { repo: ctx.repo, calle: calle.client, webhookUrl: WEBHOOK };
    const input = { incidentId: "DS-1042", actionCode: "request_dock_exception", operatorName: "Dana", humanApproved: true as const, context: { revisedEtaDisplay: "16:40", driverStatement: "customs queue", dockConstraint: "open until 16:00" } };
    const first = await launchFollowUp(deps, input);
    expect(first.outcome).toBe("created");
    const again = await launchFollowUp(deps, input);
    expect(again.outcome).toBe("already_dispatched");
    expect(calle.created).toHaveLength(3);
    const followUp = calle.created[2]!;
    expect(followUp.req.metadata.kind).toBe("follow_up");
    expect(followUp.req.task).toMatch(/Dana/);
    expect(followUp.req.task).toMatch(/do not agree to any charge/);
    const task = await ctx.repo.getTask(first.taskId);
    expect(task?.approvedBy).toBe("Dana");
    const actions = await ctx.repo.getRecoveryActions("DS-1042");
    expect(actions.find((a) => a.code === "request_dock_exception")).toMatchObject({ status: "dispatched", approvedBy: "Dana", callTaskId: first.taskId });
    expect((await ctx.repo.getIncident("DS-1042"))!.status).toBe("follow_up_calling");
    const view = await buildIncidentView(ctx.repo, (await ctx.repo.getIncident("DS-1042"))!);
    expect(view.card.branch).toBe("follow_up_calling");
  });

  it("refuses to approve an action the rules engine does not currently suggest", async () => {
    const calle = fakeCalle();
    await reachWindowMissed(calle);
    await expect(
      launchFollowUp(
        { repo: ctx.repo, calle: calle.client, webhookUrl: WEBHOOK },
        { incidentId: "DS-1042", actionCode: "request_new_slot", operatorName: "Ops", humanApproved: true, context: { revisedEtaDisplay: "", driverStatement: "", dockConstraint: "" } },
      ),
    ).rejects.toThrow(/not on this incident/);
  });
});
