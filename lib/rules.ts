import { isUnresolved, type ContactRole, type RecipientResult } from "./result-schema";
import { formatClockInTz, parseClockTime, resolveClockOnDay } from "./time";
import type { TaskKind, TaskStatus } from "./status";

/**
 * Deterministic, explainable rules engine.
 *
 * Inputs are provider-backed task outcomes. Only completed fact-finding calls whose
 * structured result says the contact was reached contribute facts. Empty strings and
 * `unknown` are unresolved. Disagreeing sources produce a `conflicted` fact and the
 * engine never picks a winner. Every fact keeps its source call id and evidence.
 */

export interface TaskOutcome {
  taskId: string;
  kind: TaskKind;
  role: ContactRole;
  contactName: string;
  status: TaskStatus;
  providerCallId: string | null;
  result: RecipientResult | null;
  evidence: string[];
  summary: string | null;
  completionLabel: string | null;
  completionScore: number | null;
  lastError: string | null;
}

export interface IncidentFacts {
  id: string;
  promisedDockAt: string;
  receivingCutoffAt: string | null;
  timezone: string;
}

export type FactStatus = "verified" | "unresolved" | "conflicted";
export type FactKey = "current_location" | "revised_eta" | "blocker" | "receiving_window" | "next_action";

export interface FactSource {
  taskId: string;
  providerCallId: string | null;
  role: ContactRole;
  contactName: string;
  field: keyof RecipientResult;
  value: string;
  certainty: string;
  evidence: string[];
  summary: string | null;
}

export interface Fact {
  key: FactKey;
  label: string;
  status: FactStatus;
  value: string | null;
  sources: FactSource[];
  note: string | null;
}

export type Branch =
  | "awaiting_results"
  | "eta_unresolved"
  | "eta_conflicted"
  | "dock_unresolved"
  | "cutoff_unknown"
  | "window_missed"
  | "dock_declined"
  | "within_window"
  | "follow_up_calling"
  | "exception_granted"
  | "follow_up_declined"
  | "follow_up_unresolved";

export interface SuggestedAction {
  code: string;
  title: string;
  rationale: string;
  owner: "operator" | "driver" | "dispatcher" | "receiving_dock";
  requiresCall: boolean;
  requiresApproval: boolean;
  targetRole: ContactRole | null;
  basedOn: string[];
}

export interface EtaAnalysis {
  etaIso: string | null;
  etaDisplay: string | null;
  etaSourceTaskId: string | null;
  cutoffIso: string | null;
  cutoffDisplay: string | null;
  cutoffSource: "dock_call" | "intake" | null;
  minutesLate: number | null;
  vagueEtaValues: string[];
}

export interface Confidence {
  label: "high" | "medium" | "low" | "none";
  reasons: string[];
}

export interface RecoveryCard {
  branch: Branch;
  branchLabel: string;
  facts: Fact[];
  actions: SuggestedAction[];
  confidence: Confidence;
  eta: EtaAnalysis;
  unresolvedTasks: Array<{ taskId: string; role: ContactRole; contactName: string; reason: string; status: TaskStatus }>;
  followUp: { taskId: string; result: RecipientResult | null; status: TaskStatus; summary: string | null } | null;
}

const BRANCH_LABELS: Record<Branch, string> = {
  awaiting_results: "Waiting for provider-backed results",
  eta_unresolved: "Revised ETA not established",
  eta_conflicted: "Sources disagree on the revised ETA",
  dock_unresolved: "Receiving dock position not established",
  cutoff_unknown: "Receiving cutoff unknown",
  window_missed: "Revised ETA is after the receiving cutoff",
  dock_declined: "Dock will not accept the load today",
  within_window: "Revised ETA is inside the receiving window",
  follow_up_calling: "Follow-up call to the dock in progress",
  exception_granted: "Dock accepted the revised arrival",
  follow_up_declined: "Dock declined the revised arrival",
  follow_up_unresolved: "Follow-up call did not produce a usable answer",
};

function eligible(outcome: TaskOutcome): outcome is TaskOutcome & { result: RecipientResult } {
  return (
    outcome.kind === "fact_finding" &&
    outcome.status === "completed" &&
    outcome.result !== null &&
    outcome.result.reached === "yes" &&
    outcome.result.shipment_recognized !== "no"
  );
}

function source(outcome: TaskOutcome & { result: RecipientResult }, field: keyof RecipientResult): FactSource {
  return {
    taskId: outcome.taskId,
    providerCallId: outcome.providerCallId,
    role: outcome.role,
    contactName: outcome.contactName,
    field,
    value: outcome.result[field],
    certainty: outcome.result.certainty,
    evidence: outcome.evidence,
    summary: outcome.summary,
  };
}

function ineligibilityReason(outcome: TaskOutcome): string {
  switch (outcome.status) {
    case "queued":
    case "dispatching":
      return "Call not yet dispatched";
    case "in_progress":
      return "Call still in progress";
    case "dispatch_failed":
      return `Could not create the call: ${outcome.lastError ?? "unknown error"}`;
    case "failed":
      return `CALL-E reported the call failed${outcome.lastError ? `: ${outcome.lastError}` : ""}`;
    case "canceled":
      return "CALL-E reported the call canceled";
    case "result_validation_failed":
      return "CALL-E could not produce a schema-valid result from the call";
    case "completed":
      if (!outcome.result) return "No structured result";
      if (outcome.result.reached !== "yes") return `Contact not reached (reached = ${outcome.result.reached})`;
      if (outcome.result.shipment_recognized === "no") return "Contact did not recognize the shipment";
      return "Not usable";
  }
}

const RANK = { high: 3, medium: 2, low: 1, unknown: 0, none: 0 } as const;
function rankOf(label: string | null | undefined): number {
  return RANK[(label ?? "unknown") as keyof typeof RANK] ?? 0;
}

function resolveEta(value: string, incident: IncidentFacts): { iso: string; display: string } | null {
  const clock = parseClockTime(value);
  if (!clock) return null;
  const date = resolveClockOnDay(clock, incident.promisedDockAt, incident.timezone);
  if (!date) return null;
  return { iso: date.toISOString(), display: formatClockInTz(date, incident.timezone) };
}

export function buildRecoveryCard(incident: IncidentFacts, outcomes: TaskOutcome[]): RecoveryCard {
  const factFinding = outcomes.filter((o) => o.kind === "fact_finding");
  const usable = factFinding.filter(eligible);
  const unresolvedTasks = factFinding
    .filter((o) => !eligible(o))
    .map((o) => ({ taskId: o.taskId, role: o.role, contactName: o.contactName, reason: ineligibilityReason(o), status: o.status }));

  const movers = usable.filter((o) => o.role === "driver" || o.role === "dispatcher");
  const dock = usable.find((o) => o.role === "receiving_dock") ?? null;
  const facts: Fact[] = [];
  const vagueEtaValues: string[] = [];

  // --- current location -----------------------------------------------------------------
  const locationSources = movers.filter((o) => !isUnresolved(o.result.current_status)).map((o) => source(o, "current_status"));
  facts.push({
    key: "current_location",
    label: "Current location / status",
    status: locationSources.length ? "verified" : "unresolved",
    value: locationSources.length ? locationSources.map((s) => `${s.contactName}: ${s.value}`).join(" | ") : null,
    sources: locationSources,
    note: locationSources.length > 1 ? "Reported by more than one source; both statements shown." : null,
  });

  // --- revised ETA ----------------------------------------------------------------------
  const etaSources = movers.filter((o) => !isUnresolved(o.result.revised_eta)).map((o) => source(o, "revised_eta"));
  const parsedEtas = etaSources.map((s) => ({ s, parsed: resolveEta(s.value, incident) }));
  for (const p of parsedEtas) if (!p.parsed) vagueEtaValues.push(`${p.s.contactName}: "${p.s.value}"`);
  const distinct = new Set(parsedEtas.map((p) => (p.parsed ? p.parsed.iso : p.s.value.trim().toLowerCase())));
  let etaStatus: FactStatus = etaSources.length ? "verified" : "unresolved";
  if (distinct.size > 1) etaStatus = "conflicted";
  const firstParsed = parsedEtas.find((p) => p.parsed) ?? null;
  const etaFact: Fact = {
    key: "revised_eta",
    label: "Revised ETA",
    status: etaStatus,
    value:
      etaStatus === "conflicted"
        ? etaSources.map((s) => `${s.contactName}: ${s.value}`).join(" vs ")
        : etaSources.length
          ? firstParsed?.parsed
            ? `${firstParsed.parsed.display} (stated: "${firstParsed.s.value}")`
            : etaSources[0]!.value
          : null,
    sources: etaSources,
    note:
      etaStatus === "conflicted"
        ? "Sources disagree. DockSignal does not choose between them."
        : etaSources.length && !firstParsed
          ? "Stated time is not an exact clock time, so it is not compared against the cutoff."
          : null,
  };
  facts.push(etaFact);

  // --- blocker ---------------------------------------------------------------------------
  const blockerSources = usable.filter((o) => !isUnresolved(o.result.blocker)).map((o) => source(o, "blocker"));
  facts.push({
    key: "blocker",
    label: "Blocker / delay reason",
    status: blockerSources.length ? "verified" : "unresolved",
    value: blockerSources.length ? blockerSources.map((s) => `${s.contactName}: ${s.value}`).join(" | ") : null,
    sources: blockerSources,
    note: null,
  });

  // --- receiving window -----------------------------------------------------------------
  let cutoffIso: string | null = null;
  let cutoffDisplay: string | null = null;
  let cutoffSource: EtaAnalysis["cutoffSource"] = null;
  const dockSources: FactSource[] = [];
  if (dock) {
    dockSources.push(source(dock, "can_accept"));
    if (!isUnresolved(dock.result.revised_eta)) {
      dockSources.push(source(dock, "revised_eta"));
      const parsed = resolveEta(dock.result.revised_eta, incident);
      if (parsed) {
        cutoffIso = parsed.iso;
        cutoffDisplay = parsed.display;
        cutoffSource = "dock_call";
      } else vagueEtaValues.push(`${dock.contactName} (cutoff): "${dock.result.revised_eta}"`);
    }
  }
  if (!cutoffIso && incident.receivingCutoffAt) {
    cutoffIso = incident.receivingCutoffAt;
    cutoffDisplay = formatClockInTz(incident.receivingCutoffAt, incident.timezone);
    cutoffSource = "intake";
  }
  const dockResolved = !!dock && !isUnresolved(dock.result.can_accept);
  facts.push({
    key: "receiving_window",
    label: "Receiving window",
    status: dockResolved ? "verified" : "unresolved",
    value: dockResolved
      ? `Dock says can_accept = ${dock!.result.can_accept}${cutoffDisplay ? `; latest acceptable arrival ${cutoffDisplay}` : ""}${dock!.result.current_status ? ` (${dock!.result.current_status})` : ""}`
      : cutoffDisplay
        ? `Not confirmed by the dock. Intake cutoff on file: ${cutoffDisplay}`
        : null,
    sources: dockSources,
    note: cutoffSource === "intake" ? "Cutoff comes from intake, not from a call." : null,
  });

  // --- next action from contacts --------------------------------------------------------
  const nextSources = usable.filter((o) => !isUnresolved(o.result.next_action)).map((o) => source(o, "next_action"));
  facts.push({
    key: "next_action",
    label: "What contacts said they will do",
    status: nextSources.length ? "verified" : "unresolved",
    value: nextSources.length ? nextSources.map((s) => `${s.contactName}: ${s.value}`).join(" | ") : null,
    sources: nextSources,
    note: null,
  });

  // --- ETA analysis ---------------------------------------------------------------------
  const eta: EtaAnalysis = {
    etaIso: etaStatus === "verified" && firstParsed?.parsed ? firstParsed.parsed.iso : null,
    etaDisplay: etaStatus === "verified" && firstParsed?.parsed ? firstParsed.parsed.display : null,
    etaSourceTaskId: etaStatus === "verified" && firstParsed ? firstParsed.s.taskId : null,
    cutoffIso,
    cutoffDisplay,
    cutoffSource,
    minutesLate: null,
    vagueEtaValues,
  };
  if (eta.etaIso && eta.cutoffIso) {
    eta.minutesLate = Math.round((new Date(eta.etaIso).getTime() - new Date(eta.cutoffIso).getTime()) / 60000);
  }

  // --- follow-up outcome ----------------------------------------------------------------
  const followUpTask = outcomes.find((o) => o.kind === "follow_up") ?? null;
  const followUp = followUpTask
    ? { taskId: followUpTask.taskId, result: followUpTask.result, status: followUpTask.status, summary: followUpTask.summary }
    : null;

  // --- branch ---------------------------------------------------------------------------
  let branch: Branch;
  const dockCanAccept = dock?.result.can_accept ?? "unknown";
  if (followUpTask) {
    if (!["completed", "failed", "result_validation_failed", "canceled"].includes(followUpTask.status)) branch = "follow_up_calling";
    else if (followUpTask.status === "completed" && followUpTask.result?.reached === "yes") {
      const answer = followUpTask.result.can_accept;
      branch = answer === "yes" || answer === "conditional" ? "exception_granted" : answer === "no" ? "follow_up_declined" : "follow_up_unresolved";
    } else branch = "follow_up_unresolved";
  } else if (!usable.length) branch = "awaiting_results";
  else if (etaStatus === "conflicted") branch = "eta_conflicted";
  else if (dockResolved && dockCanAccept === "no") branch = "dock_declined";
  else if (!eta.etaIso) branch = "eta_unresolved";
  else if (!dockResolved) branch = "dock_unresolved";
  else if (!eta.cutoffIso) branch = "cutoff_unknown";
  else if (eta.minutesLate !== null && eta.minutesLate > 0) branch = "window_missed";
  else branch = "within_window";

  // --- actions --------------------------------------------------------------------------
  const actions: SuggestedAction[] = [];
  const etaBasis = eta.etaSourceTaskId ? [eta.etaSourceTaskId] : [];
  const dockBasis = dock ? [dock.taskId] : [];
  switch (branch) {
    case "window_missed":
      actions.push({
        code: "request_dock_exception",
        title: `Ask the dock to accept arrival at ${eta.etaDisplay} (${eta.minutesLate} min after cutoff ${eta.cutoffDisplay})`,
        rationale: `Driver ETA ${eta.etaDisplay} is later than the ${cutoffSource === "dock_call" ? "dock-stated" : "intake"} cutoff ${eta.cutoffDisplay}. A follow-up call can request an exception or a new slot. Needs operator approval because it changes the dock appointment.`,
        owner: "operator",
        requiresCall: true,
        requiresApproval: true,
        targetRole: "receiving_dock",
        basedOn: [...etaBasis, ...dockBasis],
      });
      actions.push({
        code: "notify_dispatcher",
        title: "Tell the carrier dispatcher the load will miss the window",
        rationale: "Dispatcher owns driver hours and any relief plan. Manual step; DockSignal does not call the dispatcher without a plan entry.",
        owner: "dispatcher",
        requiresCall: false,
        requiresApproval: false,
        targetRole: "dispatcher",
        basedOn: etaBasis,
      });
      break;
    case "dock_declined":
      actions.push({
        code: "request_new_slot",
        title: "Ask the dock for the earliest alternative dock window",
        rationale: `The dock said it cannot accept the load today (${dock?.result.blocker || "no reason recorded"}). Rebooking changes the appointment, so it needs operator approval before the call.`,
        owner: "operator",
        requiresCall: true,
        requiresApproval: true,
        targetRole: "receiving_dock",
        basedOn: dockBasis,
      });
      break;
    case "within_window":
      actions.push({
        code: "confirm_arrival_with_dock",
        title: `Driver to call the dock 30 minutes before arriving at ${eta.etaDisplay}`,
        rationale: `ETA ${eta.etaDisplay} is inside the cutoff ${eta.cutoffDisplay} and the dock said can_accept = ${dockCanAccept}. No appointment change is needed.`,
        owner: "driver",
        requiresCall: false,
        requiresApproval: false,
        targetRole: null,
        basedOn: [...etaBasis, ...dockBasis],
      });
      if (dockCanAccept === "conditional")
        actions.push({
          code: "confirm_dock_condition",
          title: "Confirm the dock's stated condition before arrival",
          rationale: `The dock accepted conditionally: ${dock?.result.blocker || dock?.result.next_action || "condition recorded in the call summary"}.`,
          owner: "operator",
          requiresCall: false,
          requiresApproval: false,
          targetRole: "receiving_dock",
          basedOn: dockBasis,
        });
      break;
    case "eta_conflicted":
      actions.push({
        code: "resolve_eta_conflict",
        title: "Resolve the ETA disagreement before acting",
        rationale: `Sources gave different revised ETAs: ${etaFact.value}. DockSignal does not choose. Confirm with the driver or dispatcher manually, then re-run the plan.`,
        owner: "operator",
        requiresCall: false,
        requiresApproval: false,
        targetRole: null,
        basedOn: etaSources.map((s) => s.taskId),
      });
      break;
    case "eta_unresolved":
      actions.push({
        code: "obtain_exact_eta",
        title: "Get an exact revised ETA",
        rationale: vagueEtaValues.length
          ? `Only vague timing was given (${vagueEtaValues.join("; ")}). DockSignal does not infer an exact ETA from vague speech.`
          : "No reached driver or dispatcher gave a revised ETA. Call back manually or re-launch the driver call.",
        owner: "operator",
        requiresCall: false,
        requiresApproval: false,
        targetRole: "driver",
        basedOn: movers.map((m) => m.taskId),
      });
      break;
    case "dock_unresolved":
      actions.push({
        code: "reach_dock_manually",
        title: "Reach the receiving dock",
        rationale: "The dock call did not produce a usable answer, so the receiving window is unverified.",
        owner: "operator",
        requiresCall: false,
        requiresApproval: false,
        targetRole: "receiving_dock",
        basedOn: dockBasis,
      });
      break;
    case "cutoff_unknown":
      actions.push({
        code: "confirm_cutoff",
        title: "Confirm the dock's latest acceptable arrival time",
        rationale: "The dock was reached but gave no exact cutoff and none is on file, so the ETA cannot be compared.",
        owner: "operator",
        requiresCall: false,
        requiresApproval: false,
        targetRole: "receiving_dock",
        basedOn: dockBasis,
      });
      break;
    case "exception_granted":
      actions.push({
        code: "record_exception",
        title: `Record the dock's answer: ${followUp?.result?.revised_eta || "accepted"}${followUp?.result?.can_accept === "conditional" ? " (conditional)" : ""}`,
        rationale: `Follow-up call result: can_accept = ${followUp?.result?.can_accept}${followUp?.result?.blocker ? `; condition: ${followUp.result.blocker}` : ""}. Brief the driver and close the incident.`,
        owner: "operator",
        requiresCall: false,
        requiresApproval: false,
        targetRole: null,
        basedOn: followUp ? [followUp.taskId] : [],
      });
      break;
    case "follow_up_declined":
      actions.push({
        code: "escalate_rebooking",
        title: "Dock declined the exception; escalate rebooking",
        rationale: `Follow-up result: ${followUp?.result?.blocker || followUp?.result?.next_action || "declined"}. Rebooking now needs a human negotiation.`,
        owner: "operator",
        requiresCall: false,
        requiresApproval: false,
        targetRole: "receiving_dock",
        basedOn: followUp ? [followUp.taskId] : [],
      });
      break;
    case "follow_up_unresolved":
      actions.push({
        code: "retry_follow_up_manually",
        title: "Follow-up call did not produce an answer; call the dock manually",
        rationale: "Unknown, failed, or validation-failed follow-up results do not change the plan.",
        owner: "operator",
        requiresCall: false,
        requiresApproval: false,
        targetRole: "receiving_dock",
        basedOn: followUp ? [followUp.taskId] : [],
      });
      break;
    case "follow_up_calling":
    case "awaiting_results":
      break;
  }
  const failedTasks = unresolvedTasks.filter((t) => ["failed", "dispatch_failed", "result_validation_failed", "canceled", "completed"].includes(t.status));
  if (failedTasks.length && branch !== "awaiting_results") {
    actions.push({
      code: "retry_unresolved_calls",
      title: `Follow up manually with: ${failedTasks.map((t) => `${t.contactName} (${t.reason})`).join("; ")}`,
      rationale: "Failed, unknown, and validation-failed outcomes stay unresolved and never become facts.",
      owner: "operator",
      requiresCall: false,
      requiresApproval: false,
      targetRole: null,
      basedOn: failedTasks.map((t) => t.taskId),
    });
  }

  // --- confidence -----------------------------------------------------------------------
  const confidence = computeConfidence(branch, usable, eta, dock);

  return { branch, branchLabel: BRANCH_LABELS[branch], facts, actions, confidence, eta, unresolvedTasks, followUp };
}

function computeConfidence(
  branch: Branch,
  usable: Array<TaskOutcome & { result: RecipientResult }>,
  eta: EtaAnalysis,
  dock: (TaskOutcome & { result: RecipientResult }) | null,
): Confidence {
  if (!usable.length) return { label: "none", reasons: ["No provider-backed result has been reconciled yet."] };
  const reasons: string[] = [];
  let rank = 3;
  const consider = (label: string | null | undefined, why: string) => {
    const r = rankOf(label);
    if (r < rank) rank = r;
    reasons.push(`${why}: ${label ?? "unknown"}`);
  };
  const etaSource = usable.find((u) => u.taskId === eta.etaSourceTaskId);
  if (etaSource) {
    consider(etaSource.result.certainty, `${etaSource.contactName} certainty on ETA`);
    consider(etaSource.completionLabel, `CALL-E completion confidence for ${etaSource.contactName}`);
  }
  if (dock) {
    consider(dock.result.certainty, `${dock.contactName} certainty on receiving window`);
    consider(dock.completionLabel, `CALL-E completion confidence for ${dock.contactName}`);
  }
  if (eta.cutoffSource === "intake") {
    rank = Math.min(rank, 2);
    reasons.push("Cutoff comes from intake, not from the dock call");
  }
  if (branch === "eta_conflicted" || branch === "eta_unresolved" || branch === "dock_unresolved" || branch === "cutoff_unknown") {
    rank = Math.min(rank, 1);
    reasons.push("Key fact unresolved or conflicted");
  }
  const label = rank >= 3 ? "high" : rank === 2 ? "medium" : "low";
  return { label, reasons };
}
