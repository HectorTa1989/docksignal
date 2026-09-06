import Link from "next/link";
import { IntakeForm } from "@/components/IntakeForm";
import { SetupBanner, StatusChip } from "@/components/ui";
import { orgName } from "@/lib/env";
import { serverDeps, setupState, suggestNextIncidentId } from "@/lib/server";
import { formatInTz } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const setup = await setupState();
  let incidents: Awaited<ReturnType<ReturnType<typeof serverDeps>["repo"]["listIncidents"]>> = [];
  if (setup.database.ok) {
    try {
      incidents = await serverDeps().repo.listIncidents();
    } catch {
      incidents = [];
    }
  }
  const defaults = {
    suggestedId: suggestNextIncidentId(incidents.map((i) => i.id)),
    timezone: process.env.DEMO_TIMEZONE?.trim() || "Asia/Singapore",
    orgName: orgName(),
    phones: {
      driver: process.env.DEMO_DRIVER_PHONE?.trim() ?? "",
      receiving_dock: process.env.DEMO_DOCK_PHONE?.trim() ?? "",
      dispatcher: process.env.DEMO_DISPATCHER_PHONE?.trim() ?? "",
    },
    canCall: setup.canCall,
  };
  return (
    <div>
      <SetupBanner setup={setup} />
      <section className="mb-6 grid gap-4 md:grid-cols-[1.4fr_1fr]">
        <div className="panel p-5">
          <h1 className="text-lg font-semibold">A delivery missed its dock window. Who actually knows why?</h1>
          <p className="mt-2 text-sm text-muted">
            Tracking portals and email threads do not hold the real reason, the revised ETA, or whether the dock will still take the load.
            Operations staff phone the driver, the dispatcher, and the receiving desk one by one, then retype what they heard.
          </p>
          <p className="mt-2 text-sm text-muted">
            DockSignal runs that phone chase as concurrent CALL-E calls with a strict result schema, reconciles every terminal result
            against the CALL-E API, and turns only the supported facts into one auditable recovery card. Consequential follow-up calls
            wait for a human.
          </p>
        </div>
        <div className="panel p-5 text-xs">
          <div className="label mb-2">Manual chase today</div>
          <ul className="space-y-1 text-muted">
            <li>· 3 to 6 calls, 20 to 40 minutes of operator time per exception</li>
            <li>· Answers land in chat, sticky notes, and memory</li>
            <li>· Nobody can prove later who said what, or when</li>
            <li>· A missed cutoff becomes a next-day redelivery</li>
          </ul>
          <div className="label mt-4 mb-2">With DockSignal</div>
          <ul className="space-y-1 text-muted">
            <li>· Two or three calls run at once, identified as an AI assistant</li>
            <li>· Every fact links to a CALL-E call id and its evidence</li>
            <li>· Conflicts stay conflicted, unknowns stay unknown</li>
            <li>· One approval sends the follow-up that saves the slot</li>
          </ul>
        </div>
      </section>

      <IntakeForm defaults={defaults} />

      <section className="mt-8">
        <h2 className="label mb-2">Incidents</h2>
        {incidents.length === 0 ? (
          <p className="text-xs text-muted">No incidents yet.</p>
        ) : (
          <div className="panel divide-y divide-line">
            {incidents.map((i) => (
              <Link key={i.id} href={`/incidents/${encodeURIComponent(i.id)}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-panel-2">
                <span className="flex items-center gap-3">
                  <span className="mono font-semibold">{i.id}</span>
                  <span className="text-muted">{i.shipmentRef}</span>
                </span>
                <span className="flex items-center gap-3 text-xs text-muted">
                  <span>due {formatInTz(i.promisedDockAt, i.timezone)}</span>
                  <StatusChip status={i.status} />
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
