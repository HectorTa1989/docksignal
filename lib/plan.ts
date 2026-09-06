import type { ContactRow, IncidentRow } from "@/db/schema";
import { buildRecipientResultSchema, ROLE_LABELS, type ContactRole } from "./result-schema";
import { formatInTz } from "./time";

export interface CallPlanEntry {
  contactId: string;
  role: ContactRole;
  roleLabel: string;
  contactName: string;
  phoneE164: string;
  kind: "fact_finding" | "follow_up";
  goalSummary: string;
  questions: string[];
  boundaries: string[];
  taskText: string;
  resultSchema: Record<string, unknown>;
  idempotencyKey: string;
  taskId: string;
}

export const IDEMPOTENCY_VERSION = "v1";

export function factFindingTaskId(incidentId: string, contactId: string) {
  return `${incidentId}:${contactId}:fact_finding`;
}
export function followUpTaskId(incidentId: string, contactId: string, actionCode: string) {
  return `${incidentId}:${contactId}:follow_up:${actionCode}`;
}
export function idempotencyKeyFor(taskId: string) {
  return `docksignal:${taskId}:${IDEMPOTENCY_VERSION}`;
}

const COMMON_BOUNDARIES = [
  "Open by stating that you are an AI assistant calling on behalf of the named organisation.",
  "Never claim the contact agreed to anything they did not explicitly say.",
  "Do not negotiate prices, fees, penalties, or contract terms.",
  "Do not ask for or record payment details, ID numbers, or personal data beyond the shipment facts.",
  "If you reach voicemail, a wrong number, or someone who cannot help, say a human operator will follow up and end the call.",
  "Keep the call under three minutes and stay polite.",
];

function identity(incident: IncidentRow) {
  return `You are an AI assistant calling on behalf of ${incident.orgName}. Say this in your first sentence. You are calling about shipment ${incident.shipmentRef} (${incident.cargoDescription}), which was due at the receiving dock at ${formatInTz(incident.promisedDockAt, incident.timezone)} and has missed that window.`;
}

export function buildFactFindingPlan(incident: IncidentRow, contact: ContactRow): CallPlanEntry {
  const role = contact.role as ContactRole;
  const taskId = factFindingTaskId(incident.id, contact.id);
  const base = {
    contactId: contact.id,
    role,
    roleLabel: ROLE_LABELS[role],
    contactName: contact.name,
    phoneE164: contact.phoneE164,
    kind: "fact_finding" as const,
    resultSchema: buildRecipientResultSchema("fact_finding", role) as unknown as Record<string, unknown>,
    idempotencyKey: idempotencyKeyFor(taskId),
    taskId,
  };
  if (role === "driver") {
    const questions = [
      "Where is the truck right now?",
      "What caused the delay?",
      "What exact clock time do you expect to arrive at the dock? Ask for a specific time, not a range; if a range is given, ask for the latest time.",
      "What do you plan to do next, and is there anything the dock or dispatcher should know?",
    ];
    return {
      ...base,
      goalSummary: `Confirm the truck's current location, the reason for the delay, and an exact revised arrival time from the driver.`,
      questions,
      boundaries: [...COMMON_BOUNDARIES, "Do not give routing instructions or promise a new dock appointment.", "Last known location on our side was: " + incident.lastKnownLocation + ". Ask, do not assume."],
      taskText: `${identity(incident)} You are calling ${contact.name}, the driver. Confirm you are speaking with the driver for this load. Goal: learn where the truck is now, why it is late, and the exact clock time they expect to arrive at the dock. ${questions.map((q, i) => `${i + 1}) ${q}`).join(" ")} Record the arrival time exactly as the driver states it; if they only give a vague estimate, leave the time empty rather than guessing. Do not give routing instructions, do not promise a new dock appointment, and do not discuss fees. Our last known position for the truck was "${incident.lastKnownLocation}", but ask rather than assume. If voicemail or a wrong number, say a human operator from ${incident.orgName} will follow up and end the call. Be brief and polite.`,
    };
  }
  if (role === "receiving_dock") {
    const questions = [
      "Is the dock slot for this shipment still being held?",
      "What is the latest arrival clock time today at which the dock can still accept this load?",
      "If the truck arrives after that time, what are the options (exception, next available slot, next day)?",
      "Who can approve an exception or a new slot, and what do they need from us?",
    ];
    return {
      ...base,
      goalSummary: `Learn whether the receiving dock will still accept the late load today, its latest acceptable arrival time, and the options if the truck is later than that.`,
      questions,
      boundaries: [...COMMON_BOUNDARIES, "Do not book, confirm, move, or cancel any appointment on this call. Say the operator will call back to confirm."],
      taskText: `${identity(incident)} You are calling ${contact.name} at the receiving dock. Confirm you are speaking with someone who handles receiving. Goal: find out whether the dock can still accept this load today and until what exact clock time. ${questions.map((q, i) => `${i + 1}) ${q}`).join(" ")} Record the latest acceptable arrival time exactly as stated; if no exact time is given, leave it empty. Do not book, confirm, move, or cancel any appointment on this call, and do not agree to any fees; say that a human operator from ${incident.orgName} will call back to confirm anything that changes the appointment. If voicemail or a wrong number, say a human operator will follow up and end the call. Be brief and polite.`,
    };
  }
  const questions = [
    "What is the carrier's current information on the truck's location and status?",
    "What caused the delay, from the carrier's side?",
    "What exact clock time does dispatch expect the truck to arrive at the dock?",
    "Is there anything dispatch is already doing about it, such as a relief driver or a reroute?",
  ];
  return {
    ...base,
    goalSummary: `Get the carrier dispatcher's independent view of the truck's status, the delay reason, and their expected arrival time.`,
    questions,
    boundaries: [...COMMON_BOUNDARIES, "Do not accept or propose changes to the carrier agreement."],
    taskText: `${identity(incident)} You are calling ${contact.name}, the carrier dispatcher. Confirm you are speaking with dispatch for this load. Goal: get the carrier's independent view of where the truck is, why it is late, and the exact clock time they expect it at the dock. ${questions.map((q, i) => `${i + 1}) ${q}`).join(" ")} Record the arrival time exactly as stated; if only a vague estimate is given, leave it empty. Do not accept or propose changes to the carrier agreement or discuss fees. If voicemail or a wrong number, say a human operator from ${incident.orgName} will follow up and end the call. Be brief and polite.`,
  };
}

export interface FollowUpContext {
  actionCode: string;
  revisedEtaDisplay: string;
  driverStatement: string;
  dockConstraint: string;
  approvedBy: string;
}

/** Follow-up call to the receiving dock. Only created after explicit operator approval. */
export function buildFollowUpPlan(incident: IncidentRow, dock: ContactRow, ctx: FollowUpContext): CallPlanEntry {
  const role = dock.role as ContactRole;
  const taskId = followUpTaskId(incident.id, dock.id, ctx.actionCode);
  const questions = [
    `Can the dock accept shipment ${incident.shipmentRef} at ${ctx.revisedEtaDisplay} as an exception?`,
    "If not, what is the earliest alternative dock window the dock can offer?",
    "Are there any conditions attached (specific door, paperwork, cutoff for the exception)?",
    "Who at the dock will be expecting the truck?",
  ];
  const taskText = `${identity(incident)} You are calling ${dock.name} at the receiving dock again. A human operator, ${ctx.approvedBy} at ${incident.orgName}, has approved this request. Situation: the driver reports "${ctx.driverStatement}" and now expects to arrive at ${ctx.revisedEtaDisplay}. Earlier the dock told us: "${ctx.dockConstraint}". Goal: ask whether the dock can accept the load at ${ctx.revisedEtaDisplay} as an exception, and if not, the earliest alternative window. ${questions.map((q, i) => `${i + 1}) ${q}`).join(" ")} Record any offered or agreed window as an exact clock time. If the dock mentions fees, penalties, or conditions, record them exactly and say the operator will confirm; do not agree to any charge. Never state that anything is confirmed unless the dock explicitly says so. Thank them and end the call.`;
  return {
    contactId: dock.id,
    role,
    roleLabel: ROLE_LABELS[role],
    contactName: dock.name,
    phoneE164: dock.phoneE164,
    kind: "follow_up",
    goalSummary: `Ask the receiving dock for an exception or a new dock window for the revised arrival at ${ctx.revisedEtaDisplay}.`,
    questions,
    boundaries: [...COMMON_BOUNDARIES, "Record, do not accept, any fee or penalty.", "A window counts as agreed only if the dock says so explicitly."],
    taskText,
    resultSchema: buildRecipientResultSchema("follow_up", role) as unknown as Record<string, unknown>,
    idempotencyKey: idempotencyKeyFor(taskId),
    taskId,
  };
}
