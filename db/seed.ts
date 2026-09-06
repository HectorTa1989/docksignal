import "dotenv/config";
import { getDb } from "./index";
import { createRepository } from "../lib/repository";
import { orgName } from "../lib/env";
import { regionFromPhone, validateE164 } from "../lib/phone";
import { zonedToUtc } from "../lib/time";

/**
 * Seeds ONLY incident metadata for the demo incident DS-1042. It never seeds call tasks,
 * webhook events, observations, or results: every call in DockSignal is a real CALL-E call.
 *
 * Phone numbers come from DEMO_DRIVER_PHONE / DEMO_DOCK_PHONE / DEMO_DISPATCHER_PHONE so
 * that no phone number is ever committed. Without them the contacts are created with an
 * empty number and the incident cannot be launched until you edit the recipients.
 */
async function main() {
  const repo = createRepository(getDb());
  const id = process.env.SEED_INCIDENT_ID || "DS-1042";
  if (await repo.getIncident(id)) {
    console.log(`Incident ${id} already exists; nothing seeded.`);
    process.exit(0);
  }
  const tz = process.env.DEMO_TIMEZONE || "Asia/Singapore";
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const phone = (value: string | undefined, label: string) => (value ? validateE164(value, label) : "");
  const driver = phone(process.env.DEMO_DRIVER_PHONE, "DEMO_DRIVER_PHONE");
  const dock = phone(process.env.DEMO_DOCK_PHONE, "DEMO_DOCK_PHONE");
  const dispatcher = phone(process.env.DEMO_DISPATCHER_PHONE, "DEMO_DISPATCHER_PHONE");
  await repo.createIncident({
    id,
    shipmentRef: "SHP-88214",
    orgName: orgName(),
    promisedDockAt: zonedToUtc(`${day}T14:00`, tz)!.toISOString(),
    receivingCutoffAt: zonedToUtc(`${day}T16:00`, tz)!.toISOString(),
    timezone: tz,
    lastKnownLocation: "Tracking shows last ping 09:52 near Tuas Checkpoint; no update since",
    cargoDescription: "18 pallets chilled produce, reefer set to 4C",
    operatorName: "Ops desk",
    contacts: [
      { role: "driver", name: "Driver on SHP-88214", phoneE164: driver, region: driver ? regionFromPhone(driver) : "SG", locale: "en-US", authorizationNote: "Carrier-provided driver number; test-controlled for the demo", includeInFactFinding: true },
      { role: "receiving_dock", name: "Receiving desk, Dock 7", phoneE164: dock, region: dock ? regionFromPhone(dock) : "SG", locale: "en-US", authorizationNote: "Consignee receiving line; test-controlled for the demo", includeInFactFinding: true },
      { role: "dispatcher", name: "Carrier dispatch", phoneE164: dispatcher, region: dispatcher ? regionFromPhone(dispatcher) : "SG", locale: "en-US", authorizationNote: "Carrier dispatch desk; optional third call", includeInFactFinding: !!dispatcher },
    ],
  });
  console.log(`Seeded incident ${id} metadata${driver && dock ? "" : " (some phone numbers empty; edit recipients before launch)"}.`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
