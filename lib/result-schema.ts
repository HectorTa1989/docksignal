import { z } from "zod";

export const CONTACT_ROLES = ["driver", "dispatcher", "receiving_dock"] as const;
export type ContactRole = (typeof CONTACT_ROLES)[number];

export const ROLE_LABELS: Record<ContactRole, string> = {
  driver: "Driver",
  dispatcher: "Carrier dispatcher",
  receiving_dock: "Receiving dock",
};

/**
 * Strict per-recipient result schema sent to CALL-E as `recipient_result_schema`.
 * Field names, enums and `required` match the DockSignal contract exactly; the
 * `description` values guide CALL-E's extraction model and vary per call kind.
 */
export function buildRecipientResultSchema(kind: "fact_finding" | "follow_up", role: ContactRole) {
  const isDock = role === "receiving_dock";
  const revisedEtaDescription =
    kind === "follow_up"
      ? "The new dock window or arrival time the receiving dock agreed to or offered, as an exact clock time such as '17:30' or '5:30 PM'. Leave empty if no exact time was offered."
      : isDock
        ? "The latest arrival clock time the dock can still accept this load today (its receiving cutoff), or the alternative slot it offered, as an exact clock time such as '16:00' or '4 PM'. Leave empty if the dock gave no exact time."
        : "The revised arrival time the contact stated, as an exact clock time such as '15:40' or '3:40 PM'. Leave empty if they gave only a vague estimate like 'later this afternoon'. Never invent a time.";
  const canAcceptDescription =
    kind === "follow_up"
      ? "Whether the receiving dock agreed to accept the load at the requested later time. Use conditional when acceptance depends on a stated condition (for example a fee, a specific gate, or a hard time limit). Use unknown when no clear answer was given."
      : isDock
        ? "Whether the dock will still accept this shipment today after the promised window. Use conditional if acceptance is limited to a cutoff time or other stated condition. Use unknown if the contact could not say."
        : "Not applicable to this contact; use unknown.";
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "contact_role",
      "reached",
      "shipment_recognized",
      "current_status",
      "revised_eta",
      "can_accept",
      "blocker",
      "next_action",
      "certainty",
    ],
    properties: {
      contact_role: {
        type: "string",
        enum: ["driver", "dispatcher", "receiving_dock", "unknown"],
        description: `The role of the person actually reached. Expected: ${role}. Use unknown if the person did not confirm their role or was the wrong person.`,
      },
      reached: {
        type: "string",
        enum: ["yes", "no", "unknown"],
        description:
          "yes only if a live human answered and engaged about this shipment. no for voicemail, no answer, hang-up, or wrong number. unknown if unclear.",
      },
      shipment_recognized: {
        type: "string",
        enum: ["yes", "no", "unknown"],
        description: "Whether the contact recognized the shipment reference or load being discussed.",
      },
      current_status: {
        type: "string",
        description: isDock
          ? "Short statement of the dock's current situation for this load, e.g. 'slot released, dock open until 16:00'. Empty if not discussed."
          : "The contact's stated current location and situation of the truck in their own words, e.g. 'stuck at weigh station on I-5 near Tracy'. Empty if not stated.",
      },
      revised_eta: { type: "string", description: revisedEtaDescription },
      can_accept: {
        type: "string",
        enum: ["yes", "no", "conditional", "unknown"],
        description: canAcceptDescription,
      },
      blocker: {
        type: "string",
        description:
          "The concrete reason for the delay or the constraint preventing acceptance, in the contact's words. Empty if none was given.",
      },
      next_action: {
        type: "string",
        description:
          "What the contact said they will do next or what they asked us to do, e.g. 'call dock when 30 minutes out'. Empty if nothing was agreed.",
      },
      certainty: {
        type: "string",
        enum: ["high", "medium", "low", "unknown"],
        description:
          "How certain the contact sounded about the facts they gave. high for firm statements, medium for hedged estimates, low for guesses, unknown if not reached.",
      },
    },
  } as const;
}

export const recipientResultZ = z
  .object({
    contact_role: z.enum(["driver", "dispatcher", "receiving_dock", "unknown"]),
    reached: z.enum(["yes", "no", "unknown"]),
    shipment_recognized: z.enum(["yes", "no", "unknown"]),
    current_status: z.string(),
    revised_eta: z.string(),
    can_accept: z.enum(["yes", "no", "conditional", "unknown"]),
    blocker: z.string(),
    next_action: z.string(),
    certainty: z.enum(["high", "medium", "low", "unknown"]),
  })
  .strict();

export type RecipientResult = z.infer<typeof recipientResultZ>;
export const RESULT_FIELDS = Object.keys(recipientResultZ.shape) as (keyof RecipientResult)[];

/** Validate a provider result; throws with a readable message on any deviation from the contract. */
export function validateRecipientResult(value: unknown): RecipientResult {
  const parsed = recipientResultZ.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join(".") || "(root)";
    throw new Error(`Structured result violates the DockSignal contract at ${path}: ${issue?.message ?? "invalid"}`);
  }
  return parsed.data;
}

/** Empty strings and `unknown` are unresolved facts and can never become verified. */
export function isUnresolved(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  const trimmed = value.trim().toLowerCase();
  return trimmed === "" || trimmed === "unknown";
}
