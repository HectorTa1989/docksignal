"use client";

import { useState } from "react";
import type { IncidentView } from "@/lib/incident-view";
import type { SetupState } from "@/lib/server";
import { Kv, Modal, StatusChip } from "./ui";

export function CallPlanView({
  view,
  setup,
  operatorName,
  onUpdated,
  onLaunched,
}: {
  view: IncidentView;
  setup: SetupState;
  operatorName: string;
  onUpdated: (v: IncidentView) => void;
  onLaunched: (v: IncidentView) => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<Record<string, { phone: string; include: boolean; name: string }>>({});

  const alreadyLaunched = view.tasks.some((t) => t.kind === "fact_finding" && t.providerCallId);
  const frozen = alreadyLaunched || view.incident.status === "closed";
  const authorizationText = `I confirm that ${view.contacts
    .filter((c) => c.includeInFactFinding)
    .map((c) => `${c.name} (${c.phoneMasked})`)
    .join(", ")} are numbers I own or am authorized to call, that no number is an emergency service, and that the AI assistant may identify itself as calling for ${view.incident.orgName}.`;

  async function launch() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/incidents/${encodeURIComponent(view.incident.id)}/launch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatorName, authorizationConfirmed: authorized, authorizationText }),
      });
      const data = (await res.json()) as { view?: IncidentView; error?: string };
      if (!res.ok || !data.view) throw new Error(data.error ?? "Launch failed");
      setConfirmOpen(false);
      onLaunched(data.view);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Launch failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveEdits() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/incidents/${encodeURIComponent(view.incident.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operatorName,
          contacts: Object.entries(edits).map(([role, e]) => ({ role, phone: e.phone, include: e.include, name: e.name })),
        }),
      });
      const data = (await res.json()) as IncidentView & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not update recipients");
      onUpdated(data);
      setEditing(false);
      setEdits({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update recipients");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <div className="panel p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Fact-finding wave · {view.plan.length} concurrent CALL-E calls</h2>
            {!frozen ? (
              <button className="btn-ghost !py-1 text-xs" onClick={() => { setEditing((e) => !e); setEdits({}); }}>
                {editing ? "Cancel edit" : "Edit recipients"}
              </button>
            ) : null}
          </div>
          <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
            {view.contacts.map((c) => (
              <span key={c.id} className={`chip ${c.includeInFactFinding ? "border-signal/60 text-signal" : "border-line text-muted"}`}>
                {c.role.replace("_", " ")} · {c.phoneMasked || "no number"}
                {c.includeInFactFinding ? "" : " (not called)"}
              </span>
            ))}
          </div>
          {editing ? (
            <div className="mb-4 grid gap-3 rounded-lg border border-line bg-panel-2 p-3 md:grid-cols-3">
              {view.contacts.map((c) => {
                const e = edits[c.role] ?? { phone: c.phoneE164, include: c.includeInFactFinding, name: c.name };
                const setE = (patch: Partial<typeof e>) => setEdits((all) => ({ ...all, [c.role]: { ...e, ...patch } }));
                return (
                  <div key={c.id} className="space-y-2">
                    <label className="flex items-center gap-2 text-xs font-semibold">
                      <input type="checkbox" checked={e.include} onChange={(ev) => setE({ include: ev.target.checked })} disabled={c.role !== "dispatcher"} />
                      {c.role.replace("_", " ")}
                    </label>
                    <input className="input" value={e.name} onChange={(ev) => setE({ name: ev.target.value })} />
                    <input className="input mono" value={e.phone} onChange={(ev) => setE({ phone: ev.target.value })} placeholder="+6591234567" />
                  </div>
                );
              })}
              <div className="md:col-span-3 flex justify-end">
                <button className="btn-primary !py-1 text-xs" onClick={saveEdits} disabled={busy || !Object.keys(edits).length}>
                  Save recipients
                </button>
              </div>
            </div>
          ) : null}
          <ol className="space-y-3">
            {view.plan.map((p, i) => (
              <li key={p.taskId} className="rounded-lg border border-line bg-panel-2 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-signal text-[11px] font-bold text-ink">{i + 1}</span>
                    <span className="text-sm font-semibold">{p.roleLabel}</span>
                    <span className="text-xs text-muted">
                      {p.contactName} · <span className="mono">{p.phoneMasked}</span>
                    </span>
                  </div>
                  {p.existingTaskStatus ? <StatusChip status={p.existingTaskStatus} /> : <span className="chip border-line text-muted">not created</span>}
                </div>
                <p className="mt-2 text-sm">{p.goalSummary}</p>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <div>
                    <div className="label mb-1">Questions the assistant will ask</div>
                    <ul className="list-disc space-y-0.5 pl-4 text-xs text-white/90">
                      {p.questions.map((q) => (
                        <li key={q}>{q}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="label mb-1">Boundaries</div>
                    <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted">
                      {p.boundaries.slice(0, 4).map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  </div>
                </div>
                <button className="mt-2 text-[11px] text-info hover:underline" onClick={() => setExpanded(expanded === p.taskId ? null : p.taskId)}>
                  {expanded === p.taskId ? "Hide" : "Inspect"} exact CALL-E task text, result schema, and idempotency key
                </button>
                {expanded === p.taskId ? (
                  <div className="mt-2 space-y-2">
                    <pre className="whitespace-pre-wrap rounded-md border border-line bg-ink p-2 text-[11px] text-white/90">{p.taskText}</pre>
                    <Kv k="Idempotency-Key" v={p.idempotencyKey} mono />
                    <Kv k="Webhook" v={setup.webhookUrl ?? "not configured"} mono />
                    <pre className="max-h-64 overflow-auto rounded-md border border-line bg-ink p-2 text-[11px] text-white/80">{JSON.stringify(p.resultSchema, null, 2)}</pre>
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      </div>

      <aside className="space-y-4">
        <div className="panel p-4">
          <h3 className="mb-2 text-sm font-semibold">Real-call safety</h3>
          <ul className="space-y-1 text-xs text-muted">
            <li>· Only numbers the operator owns or is authorized to call</li>
            <li>· Emergency numbers are rejected</li>
            <li>· The assistant says it is an AI calling for {view.incident.orgName}</li>
            <li>· Nothing is booked, priced, or confirmed on fact-finding calls</li>
            <li>· A stable idempotency key per incident and contact prevents duplicates on refresh or restart</li>
          </ul>
          <label className="mt-3 flex items-start gap-2 text-xs">
            <input type="checkbox" className="mt-0.5" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} disabled={frozen} />
            <span>{authorizationText}</span>
          </label>
          <button className="btn-primary mt-4 w-full justify-center" disabled={frozen || !authorized || !setup.canCall} onClick={() => setConfirmOpen(true)}>
            {alreadyLaunched ? "Calls already launched" : "Launch fact-finding calls"}
          </button>
          {!setup.canCall ? <p className="mt-2 text-[11px] text-bad">Calling is blocked until setup is complete.</p> : null}
          {error ? <p className="mt-2 text-[11px] text-bad">{error}</p> : null}
        </div>
        <div className="panel p-4 text-xs">
          <div className="label mb-2">What happens on launch</div>
          <ol className="list-decimal space-y-1 pl-4 text-muted">
            <li>Server creates one call task row per recipient (idempotent).</li>
            <li>POST /v1/calls with Idempotency-Key, E.164 recipient, metadata, recipient_result_schema, webhook_url.</li>
            <li>The returned call id is persisted before the UI shows the call as started.</li>
            <li>Terminal webhooks are deduplicated and reconciled against GET /v1/calls/{"{id}"}.</li>
          </ol>
        </div>
      </aside>

      <Modal open={confirmOpen} title="Confirm real CALL-E calls" onClose={() => setConfirmOpen(false)}>
        <p className="mb-3 text-sm text-muted">These phones will ring now. The assistant will introduce itself as an AI calling for {view.incident.orgName}.</p>
        <ul className="mb-4 space-y-2">
          {view.plan.map((p) => (
            <li key={p.taskId} className="rounded-md border border-line bg-panel-2 p-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold">{p.roleLabel} · {p.contactName}</span>
                <span className="mono">{p.phoneE164}</span>
              </div>
              <div className="mt-1 text-muted">{p.goalSummary}</div>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-end gap-2">
          <button className="btn-ghost" onClick={() => setConfirmOpen(false)} disabled={busy}>
            Cancel
          </button>
          <button className="btn-primary" onClick={launch} disabled={busy || !authorized}>
            {busy ? "Creating calls…" : `Yes, place ${view.plan.length} real calls`}
          </button>
        </div>
        {error ? <p className="mt-2 text-[11px] text-bad">{error}</p> : null}
      </Modal>
    </div>
  );
}
