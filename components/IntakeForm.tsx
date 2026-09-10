"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Field } from "./ui";

export interface IntakeDefaults {
  suggestedId: string;
  timezone: string;
  orgName: string;
  phones: { driver: string; receiving_dock: string; dispatcher: string };
  canCall: boolean;
}

function localDayAt(hour: number, minute = 0) {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hour)}:${pad(minute)}`;
}

export function IntakeForm({ defaults }: { defaults: IntakeDefaults }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    id: defaults.suggestedId,
    shipmentRef: "SHP-88214",
    operatorName: "Ops desk",
    orgName: defaults.orgName,
    timezone: defaults.timezone,
    promisedDockLocal: localDayAt(14, 0),
    receivingCutoffLocal: localDayAt(16, 0),
    lastKnownLocation: "Tracking shows last ping 09:52 near Tuas Checkpoint; no update since",
    cargoDescription: "18 pallets chilled produce, reefer set to 4C",
    driverName: "Driver on SHP-88214",
    driverPhone: defaults.phones.driver,
    dockName: "Receiving desk, Dock 7",
    dockPhone: defaults.phones.receiving_dock,
    dispatcherName: "Carrier dispatch",
    dispatcherPhone: defaults.phones.dispatcher,
    includeDispatcher: false,
    authorizationNote: "Numbers are test-controlled by the operator for this demo",
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value }));

  const timezones = useMemo(() => {
    const list = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
    return list.includes(defaults.timezone) ? list : [defaults.timezone, ...list];
  }, [defaults.timezone]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: form.id,
          shipmentRef: form.shipmentRef,
          operatorName: form.operatorName,
          orgName: form.orgName,
          timezone: form.timezone,
          promisedDockLocal: form.promisedDockLocal,
          receivingCutoffLocal: form.receivingCutoffLocal || undefined,
          lastKnownLocation: form.lastKnownLocation,
          cargoDescription: form.cargoDescription,
          contacts: [
            { role: "driver", name: form.driverName, phone: form.driverPhone, authorizationNote: form.authorizationNote, include: true },
            { role: "receiving_dock", name: form.dockName, phone: form.dockPhone, authorizationNote: form.authorizationNote, include: true },
            { role: "dispatcher", name: form.dispatcherName, phone: form.dispatcherPhone, authorizationNote: form.authorizationNote, include: form.includeDispatcher },
          ],
        }),
      });
      const data = (await res.json()) as { id?: string; error?: string; suggestedId?: string };
      if (!res.ok) {
        if (data.suggestedId) setForm((f) => ({ ...f, id: data.suggestedId! }));
        throw new Error(data.error ?? "Could not create incident");
      }
      router.push(`/incidents/${encodeURIComponent(data.id!)}?view=plan`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create incident");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="panel p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold">New delayed-shipment incident</h2>
        <span className="text-[11px] text-muted">Step 1 of 3 · intake</span>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Incident id">
          <input className="input mono" value={form.id} onChange={set("id")} required />
        </Field>
        <Field label="Shipment reference">
          <input className="input mono" value={form.shipmentRef} onChange={set("shipmentRef")} required />
        </Field>
        <Field label="Promised dock time (local)">
          <input className="input" type="datetime-local" value={form.promisedDockLocal} onChange={set("promisedDockLocal")} required />
        </Field>
        <Field label="Receiving cutoff on file (local, optional)" hint="The dock call will verify this; a dock-stated cutoff overrides it.">
          <input className="input" type="datetime-local" value={form.receivingCutoffLocal} onChange={set("receivingCutoffLocal")} />
        </Field>
        <Field label="Timezone">
          <input className="input" list="tz-list" value={form.timezone} onChange={set("timezone")} required />
          <datalist id="tz-list">
            {timezones.slice(0, 600).map((tz) => (
              <option key={tz} value={tz} />
            ))}
          </datalist>
        </Field>
        <Field label="Organisation the AI assistant acts for">
          <input className="input" value={form.orgName} onChange={set("orgName")} required />
        </Field>
        <Field label="Last known location">
          <input className="input" value={form.lastKnownLocation} onChange={set("lastKnownLocation")} required />
        </Field>
        <Field label="Cargo">
          <input className="input" value={form.cargoDescription} onChange={set("cargoDescription")} required />
        </Field>
        <Field label="Operator name (appears in the decision log)">
          <input className="input" value={form.operatorName} onChange={set("operatorName")} required />
        </Field>
      </div>

      <h3 className="label mt-6 mb-2">Authorized contacts (E.164, numbers you own or are authorized to call)</h3>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-line bg-panel-2 p-3">
          <div className="mb-2 text-xs font-semibold">Driver · required</div>
          <input className="input mb-2" value={form.driverName} onChange={set("driverName")} placeholder="Name" required />
          <input className="input mono" value={form.driverPhone} onChange={set("driverPhone")} placeholder="+12025550123" required />
        </div>
        <div className="rounded-lg border border-line bg-panel-2 p-3">
          <div className="mb-2 text-xs font-semibold">Receiving dock · required</div>
          <input className="input mb-2" value={form.dockName} onChange={set("dockName")} placeholder="Name" required />
          <input className="input mono" value={form.dockPhone} onChange={set("dockPhone")} placeholder="+12025550123" required />
        </div>
        <div className="rounded-lg border border-line bg-panel-2 p-3">
          <label className="mb-2 flex items-center gap-2 text-xs font-semibold">
            <input type="checkbox" checked={form.includeDispatcher} onChange={set("includeDispatcher")} /> Carrier dispatcher · optional third call
          </label>
          <input className="input mb-2" value={form.dispatcherName} onChange={set("dispatcherName")} placeholder="Name" />
          <input className="input mono" value={form.dispatcherPhone} onChange={set("dispatcherPhone")} placeholder="+12025550123" />
        </div>
      </div>
      <Field label="Why these numbers may be called (recorded in the audit log)">
        <input className="input mt-2" value={form.authorizationNote} onChange={set("authorizationNote")} required />
      </Field>

      {error ? <p className="mt-4 rounded-md border border-bad/50 bg-bad/10 px-3 py-2 text-xs text-bad">{error}</p> : null}
      <div className="mt-5 flex items-center justify-between">
        <p className="text-[11px] text-muted">Creating an incident does not call anyone. Calls start only from the call plan after an explicit confirmation.</p>
        <button className="btn-primary" disabled={busy}>
          {busy ? "Creating…" : "Create incident → call plan"}
        </button>
      </div>
    </form>
  );
}
