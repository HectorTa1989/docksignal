import type { CallKey } from "./dialogue";

export type Tone = "ok" | "bad" | "info" | "signal";

/** A rect reference is "rectName" (in the step's own shot) or "shotId:rectName". */
export type Hl = [rect: string, tone: Tone];

export interface CamSpec {
  /** Frame these rects; zoom in up to `zmax` if they fit. */
  fit?: string[];
  zmax?: number;
  /** Show the top of the page at 1x. */
  top?: boolean;
}

export type Step =
  | { t: "title"; sec: number }
  | { t: "show"; shot: string; cam?: CamSpec; hl?: Hl[]; hold: number }
  | { t: "type"; shot: string; to: string; target: string; text: string; cam?: CamSpec; hold: number }
  | { t: "click"; shot: string; target: string; to?: string; nav?: boolean; camBefore?: CamSpec; cam?: CamSpec; hl?: Hl[]; hold: number }
  | { t: "event"; to: string; cam?: CamSpec; hl?: Hl[]; hold: number }
  | { t: "call"; key: CallKey; bg: string; cam?: CamSpec; hl?: Hl[] }
  | { t: "doc"; hold: number }
  | { t: "end"; sec: number };

/**
 * The walkthrough, in order. Every click happens on the recorded screen named in `shot`; `to`
 * is the screen the real app produced after that click. Highlights mark what changed.
 */
export const STORY: Step[] = [
  { t: "title", sec: 2.3 },

  // 1. Intake
  { t: "show", shot: "home", cam: { top: true }, hold: 1.1 },
  { t: "type", shot: "home", to: "home_operator", target: "operator", text: "Dana Lim", cam: { fit: ["home:operator", "home:driverPhone", "home:dockPhone"], zmax: 1.3 }, hold: 0.3 },
  { t: "type", shot: "home_operator", to: "home_driver", target: "driverPhone", text: "+1 202 555 0147", hold: 0.25 },
  { t: "type", shot: "home_driver", to: "home_dock", target: "dockPhone", text: "+1 202 555 0183", hold: 0.45 },

  // 2. Call plan
  { t: "click", shot: "home_dock", target: "create", to: "plan", nav: true, cam: { top: true }, hl: [["headerChip", "info"], ["planPanel", "signal"]], hold: 1.9 },
  { t: "click", shot: "plan", target: "inspect", to: "plan_inspect", cam: { fit: ["taskText", "idempotency"], zmax: 1.45 }, hl: [["taskText", "info"], ["idempotency", "signal"], ["webhook", "info"]], hold: 2.6 },
  { t: "click", shot: "plan_inspect", target: "plan_auth:checkbox", camBefore: { fit: ["plan:authLabel", "plan:launch"], zmax: 1.35 }, to: "plan_auth", hl: [["authLabel", "ok"], ["launch", "signal"]], hold: 1.1 },
  { t: "click", shot: "plan_auth", target: "launch", to: "plan_confirm", cam: { fit: ["dialog"], zmax: 1.25 }, hl: [["recipientDriver", "info"], ["recipientDock", "info"]], hold: 1.9 },
  { t: "click", shot: "plan_confirm", target: "confirm", to: "room_calling", nav: true, cam: { top: true }, hl: [["headerChip", "info"], ["driverChip", "info"], ["dockChip", "info"], ["driverCallId", "signal"], ["dockCallId", "signal"]], hold: 2.1 },

  // 3. Driver call, provider webhook, transcript
  { t: "call", key: "driver", bg: "room_calling", cam: { top: true }, hl: [["driverCard", "info"]] },
  { t: "event", to: "room_driver_done", cam: { fit: ["driverChip", "driverSummary", "etaRow"], zmax: 1.3 }, hl: [["driverChip", "ok"], ["driverSummary", "info"], ["etaRow", "signal"]], hold: 2.4 },
  { t: "click", shot: "room_driver_done", target: "transcriptButton", to: "room_transcript", cam: { fit: ["transcript"], zmax: 1.35 }, hl: [["transcript", "info"]], hold: 2.0 },

  // 4. Dock call, reconciliation on demand, late and duplicate webhook
  { t: "call", key: "dock", bg: "room_before_recheck", cam: { top: true }, hl: [["dockCard", "info"]] },
  { t: "click", shot: "room_before_recheck", target: "recheck", to: "room_recheck", cam: { fit: ["report", "dockChip", "cutoffRow"], zmax: 1.25 }, hl: [["report", "signal"], ["dockChip", "ok"], ["cutoffRow", "signal"], ["headerChip", "info"]], hold: 2.5 },
  { t: "event", to: "room_webhooks", cam: { fit: ["webhookPanel"], zmax: 1.2 }, hl: [["row1", "info"], ["row2", "info"]], hold: 1.5 },

  // 5. Recovery card and the human approval gate
  { t: "click", shot: "room_webhooks", target: "openRecovery", to: "rec_missed", cam: { top: true }, hl: [["branch", "bad"], ["gapBox", "bad"], ["cutoffBox", "ok"], ["exceptionAction", "signal"]], hold: 3.0 },
  { t: "click", shot: "rec_missed", target: "rec_sources:sourceButton", to: "rec_sources", cam: { fit: ["factEta", "sources"], zmax: 1.4 }, hl: [["sources", "info"]], hold: 2.1 },
  { t: "click", shot: "rec_sources", target: "rec_missed:approve", camBefore: { top: true }, to: "rec_approve", cam: { fit: ["dialog"], zmax: 1.25 }, hl: [["request", "signal"]], hold: 1.9 },
  { t: "click", shot: "rec_approve", target: "approveCheck", to: "rec_approve_checked", hl: [["approveCheck", "ok"]], hold: 0.8 },
  { t: "click", shot: "rec_approve_checked", target: "confirm", to: "rec_followup", cam: { top: true }, hl: [["headerChip", "info"], ["branch", "info"], ["outcomeChip", "info"]], hold: 1.8 },
  { t: "click", shot: "rec_followup", target: "roomTab", to: "room_followup", cam: { fit: ["followCard"], zmax: 1.15 }, hl: [["followChip", "info"], ["approval", "signal"]], hold: 1.9 },

  // 6. Approved follow-up call and the outcome
  { t: "call", key: "followup", bg: "room_followup", cam: { fit: ["followCard"], zmax: 1.0 }, hl: [["followCard", "info"]] },
  { t: "event", to: "room_followup_done", cam: { fit: ["followChip", "followResult"], zmax: 1.3 }, hl: [["followChip", "ok"], ["windowRow", "ok"], ["conditionRow", "signal"]], hold: 2.2 },
  { t: "click", shot: "room_followup_done", target: "recoveryTab", to: "rec_granted", cam: { top: true }, hl: [["branch", "ok"], ["outcome", "ok"], ["recordAction", "signal"]], hold: 2.6 },
  { t: "show", shot: "rec_granted", cam: { fit: ["decisionLog"], zmax: 1.15 }, hl: [["logApproved", "signal"]], hold: 1.8 },

  // 7. Summary and close-out
  { t: "click", shot: "rec_granted", target: "download", camBefore: { fit: ["download", "close"], zmax: 1.25 }, hold: 0.25 },
  { t: "doc", hold: 5.0 },
  { t: "click", shot: "rec_granted", target: "close", to: "rec_close", cam: { fit: ["dialog"], zmax: 1.2 }, hl: [["note", "info"]], hold: 1.2 },
  { t: "click", shot: "rec_close", target: "confirm", to: "rec_closed", cam: { fit: ["headerChip", "closed"] }, hl: [["headerChip", "ok"], ["closed", "ok"]], hold: 2.0 },

  { t: "end", sec: 4.2 },
];
