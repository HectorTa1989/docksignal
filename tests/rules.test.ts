import { describe, expect, it } from "vitest";
import { buildRecoveryCard, type IncidentFacts, type TaskOutcome } from "@/lib/rules";
import { sampleResult } from "./helpers";

const incident: IncidentFacts = {
  id: "DS-1042",
  promisedDockAt: "2026-09-08T06:00:00.000Z", // 14:00 SGT
  receivingCutoffAt: "2026-09-08T08:00:00.000Z", // 16:00 SGT
  timezone: "Asia/Singapore",
};

function outcome(partial: Partial<TaskOutcome> & { role: TaskOutcome["role"] }): TaskOutcome {
  return {
    taskId: `DS-1042:DS-1042:${partial.role}:fact_finding`,
    kind: "fact_finding",
    contactName: partial.role,
    status: "completed",
    providerCallId: `call_${partial.role}`,
    result: null,
    evidence: ["evidence"],
    summary: "summary",
    completionLabel: "high",
    completionScore: 0.9,
    lastError: null,
    ...partial,
  };
}

describe("rules engine", () => {
  it("branches to window_missed when the driver ETA is after the dock-stated cutoff", () => {
    const card = buildRecoveryCard(incident, [
      outcome({ role: "driver", result: sampleResult({ revised_eta: "16:40" }) }),
      outcome({ role: "receiving_dock", result: sampleResult({ contact_role: "receiving_dock", revised_eta: "16:00", can_accept: "conditional", blocker: "Dock closes at 16:00", current_status: "" }) }),
    ]);
    expect(card.branch).toBe("window_missed");
    expect(card.eta.minutesLate).toBe(40);
    expect(card.eta.cutoffSource).toBe("dock_call");
    const action = card.actions.find((a) => a.code === "request_dock_exception");
    expect(action).toBeDefined();
    expect(action!.requiresCall).toBe(true);
    expect(action!.requiresApproval).toBe(true);
    expect(action!.basedOn).toContain("DS-1042:DS-1042:driver:fact_finding");
  });

  it("changes the recommendation when the structured ETA changes", () => {
    const dock = outcome({ role: "receiving_dock", result: sampleResult({ contact_role: "receiving_dock", revised_eta: "16:00", can_accept: "yes", current_status: "" }) });
    const early = buildRecoveryCard(incident, [outcome({ role: "driver", result: sampleResult({ revised_eta: "15:30" }) }), dock]);
    const late = buildRecoveryCard(incident, [outcome({ role: "driver", result: sampleResult({ revised_eta: "16:45" }) }), dock]);
    expect(early.branch).toBe("within_window");
    expect(early.actions.map((a) => a.code)).toContain("confirm_arrival_with_dock");
    expect(late.branch).toBe("window_missed");
    expect(late.actions.map((a) => a.code)).toContain("request_dock_exception");
  });

  it("labels the ETA conflicted when driver and dispatcher disagree and picks neither", () => {
    const card = buildRecoveryCard(incident, [
      outcome({ role: "driver", result: sampleResult({ revised_eta: "16:40" }) }),
      outcome({ role: "dispatcher", result: sampleResult({ contact_role: "dispatcher", revised_eta: "5:30 pm" }) }),
      outcome({ role: "receiving_dock", result: sampleResult({ contact_role: "receiving_dock", revised_eta: "16:00", can_accept: "conditional", current_status: "" }) }),
    ]);
    expect(card.branch).toBe("eta_conflicted");
    const eta = card.facts.find((f) => f.key === "revised_eta")!;
    expect(eta.status).toBe("conflicted");
    expect(eta.sources).toHaveLength(2);
    expect(card.eta.etaIso).toBeNull();
    expect(card.actions.map((a) => a.code)).toEqual(["resolve_eta_conflict"]);
    expect(card.confidence.label).toBe("low");
  });

  it("never turns failed, validation-failed, or unknown results into facts", () => {
    const card = buildRecoveryCard(incident, [
      outcome({ role: "driver", status: "failed", result: null, lastError: "no answer" }),
      outcome({ role: "receiving_dock", status: "result_validation_failed", result: null }),
      outcome({ role: "dispatcher", status: "completed", result: sampleResult({ contact_role: "dispatcher", reached: "unknown", revised_eta: "16:40" }) }),
    ]);
    expect(card.branch).toBe("awaiting_results");
    for (const fact of card.facts) {
      expect(fact.status).toBe("unresolved");
      expect(fact.sources).toHaveLength(0);
    }
    expect(card.unresolvedTasks).toHaveLength(3);
    expect(card.unresolvedTasks.map((u) => u.reason)).toEqual([
      "CALL-E reported the call failed: no answer",
      "CALL-E could not produce a schema-valid result from the call",
      "Contact not reached (reached = unknown)",
    ]);
    expect(card.confidence.label).toBe("none");
  });

  it("does not infer an exact ETA from vague speech", () => {
    const card = buildRecoveryCard(incident, [
      outcome({ role: "driver", result: sampleResult({ revised_eta: "later this afternoon, maybe an hour" }) }),
      outcome({ role: "receiving_dock", result: sampleResult({ contact_role: "receiving_dock", revised_eta: "16:00", can_accept: "conditional", current_status: "" }) }),
    ]);
    expect(card.branch).toBe("eta_unresolved");
    expect(card.eta.etaIso).toBeNull();
    expect(card.eta.vagueEtaValues).toHaveLength(1);
    expect(card.actions[0]!.code).toBe("obtain_exact_eta");
    expect(card.facts.find((f) => f.key === "revised_eta")!.note).toMatch(/not an exact clock time/);
  });

  it("treats empty strings and unknown as unresolved and falls back to the intake cutoff", () => {
    const card = buildRecoveryCard(incident, [
      outcome({ role: "driver", result: sampleResult({ revised_eta: "16:10", blocker: "" }) }),
      outcome({ role: "receiving_dock", result: sampleResult({ contact_role: "receiving_dock", revised_eta: "", can_accept: "yes", blocker: "unknown", current_status: "" }) }),
    ]);
    expect(card.eta.cutoffSource).toBe("intake");
    expect(card.branch).toBe("window_missed");
    expect(card.facts.find((f) => f.key === "blocker")!.status).toBe("unresolved");
    expect(card.confidence.label).toBe("medium");
    expect(card.confidence.reasons).toContain("Cutoff comes from intake, not from the dock call");
  });

  it("suggests a rebooking call when the dock declines outright", () => {
    const card = buildRecoveryCard(incident, [
      outcome({ role: "driver", result: sampleResult({ revised_eta: "15:00" }) }),
      outcome({ role: "receiving_dock", result: sampleResult({ contact_role: "receiving_dock", revised_eta: "", can_accept: "no", blocker: "No staff after 15:00", current_status: "" }) }),
    ]);
    expect(card.branch).toBe("dock_declined");
    expect(card.actions[0]).toMatchObject({ code: "request_new_slot", requiresCall: true, requiresApproval: true, targetRole: "receiving_dock" });
  });

  it("uses a reached follow-up result to close the loop and ignores an unresolved one", () => {
    const base = [
      outcome({ role: "driver", result: sampleResult({ revised_eta: "16:40" }) }),
      outcome({ role: "receiving_dock", result: sampleResult({ contact_role: "receiving_dock", revised_eta: "16:00", can_accept: "conditional", current_status: "" }) }),
    ];
    const granted = buildRecoveryCard(incident, [
      ...base,
      outcome({ role: "receiving_dock", kind: "follow_up", taskId: "fu", result: sampleResult({ contact_role: "receiving_dock", can_accept: "yes", revised_eta: "16:45", current_status: "" }) }),
    ]);
    expect(granted.branch).toBe("exception_granted");
    expect(granted.actions[0]!.code).toBe("record_exception");
    const unresolved = buildRecoveryCard(incident, [...base, outcome({ role: "receiving_dock", kind: "follow_up", taskId: "fu", status: "result_validation_failed", result: null })]);
    expect(unresolved.branch).toBe("follow_up_unresolved");
    expect(unresolved.actions[0]!.code).toBe("retry_follow_up_manually");
  });
});
