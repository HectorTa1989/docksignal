import { z } from "zod";
import { validateE164, regionFromPhone } from "./phone";
import type { NewIncident } from "./repository";
import { isValidTimeZone, zonedToUtc } from "./time";
import { orgName } from "./env";

const contactZ = z.object({
  role: z.enum(["driver", "dispatcher", "receiving_dock"]),
  name: z.string().trim().min(1, "Contact name is required"),
  phone: z.string().trim(),
  locale: z.string().trim().default("en-US"),
  authorizationNote: z.string().trim().min(1, "Authorization note is required"),
  include: z.boolean().default(true),
});

export const intakeZ = z.object({
  id: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9-]{1,31}$/, "Incident id must be like DS-1042"),
  shipmentRef: z.string().trim().min(1, "Shipment reference is required"),
  operatorName: z.string().trim().min(1, "Operator name is required"),
  orgName: z.string().trim().optional(),
  timezone: z.string().trim().min(1),
  promisedDockLocal: z.string().trim().min(1, "Promised dock time is required"),
  receivingCutoffLocal: z.string().trim().optional(),
  lastKnownLocation: z.string().trim().min(1, "Last known location is required"),
  cargoDescription: z.string().trim().min(1, "Cargo description is required"),
  contacts: z.array(contactZ).min(1),
});

export type IntakeInput = z.infer<typeof intakeZ>;

/** Validate and normalise an intake payload into a persistable incident. Throws readable errors. */
export function parseIntake(body: unknown): NewIncident {
  const parsed = intakeZ.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(issue ? `${issue.path.join(".") || "input"}: ${issue.message}` : "Invalid intake");
  }
  const input = parsed.data;
  if (!isValidTimeZone(input.timezone)) throw new Error(`Unknown timezone ${input.timezone}`);
  const promised = zonedToUtc(input.promisedDockLocal, input.timezone);
  if (!promised) throw new Error("Promised dock time must be a local date-time like 2026-09-08T14:00");
  let cutoff: Date | null = null;
  if (input.receivingCutoffLocal) {
    cutoff = zonedToUtc(input.receivingCutoffLocal, input.timezone);
    if (!cutoff) throw new Error("Receiving cutoff must be a local date-time like 2026-09-08T16:00");
  }
  const roles = new Set<string>();
  const contacts = input.contacts.map((c) => {
    if (roles.has(c.role)) throw new Error(`Duplicate contact role ${c.role}`);
    roles.add(c.role);
    const included = c.include;
    // Excluded contacts may be left without a number; included ones must be valid E.164.
    const phone = included || c.phone ? validateE164(c.phone, `${c.role} phone`) : "";
    return {
      role: c.role,
      name: c.name,
      phoneE164: phone,
      region: phone ? regionFromPhone(phone) : "US",
      locale: c.locale || "en-US",
      authorizationNote: c.authorizationNote,
      includeInFactFinding: included,
    };
  });
  if (!contacts.some((c) => c.role === "driver" && c.includeInFactFinding)) throw new Error("The driver must be included in the fact-finding wave");
  if (!contacts.some((c) => c.role === "receiving_dock" && c.includeInFactFinding)) throw new Error("The receiving dock must be included in the fact-finding wave");
  return {
    id: input.id,
    shipmentRef: input.shipmentRef,
    orgName: input.orgName?.trim() || orgName(),
    promisedDockAt: promised.toISOString(),
    receivingCutoffAt: cutoff ? cutoff.toISOString() : null,
    timezone: input.timezone,
    lastKnownLocation: input.lastKnownLocation,
    cargoDescription: input.cargoDescription,
    operatorName: input.operatorName,
    contacts,
  };
}
