"use client";

import { useState } from "react";
import type { IncidentView } from "@/lib/incident-view";
import type { SetupState } from "@/lib/server";
import type { Fact } from "@/lib/rules";
import { Modal, StatusChip } from "./ui";

function FactRow({ fact, view }: { fact: Fact; view: IncidentView }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`rounded-lg border p-3 ${fact.status === "conflicted" ? "border-bad/60 bg-bad/5" : fact.status === "verified" ? "border-line bg-panel-2" : "border-line/60 bg-panel-2/40"}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold">{fact.label}</span>
        <StatusChip status={fact.status} />
      </div>
      <p className={`mt-1 text-sm ${fact.value ? "text-white" : "italic text-muted"}`}>{fact.value ?? "unresolved — no reached contact gave this"}</p>
      {fact.note ? <p className="mt-1 text-[11px] text-warn">{fact.note}</p> : null}
      {fact.sources.length ? (
        <button className="mt-1 text-[11px] text-info hover:underline" onClick={() => setOpen((o) => !o)}>
          {open ? "Hide" : "Show"} {fact.sources.length} source{fact.sources.length > 1 ? "s" : ""} and evidence
        </button>
      ) : null}
      {open ? (
        <ul className="mt-2 space-y-2">
          {fact.sources.map((s) => {
            const task = view.tasks.find((t) => t.id === s.taskId);
            return (
              <li key={`${s.taskId}:${s.field}`} className="rounded-md border border-line bg-ink p-2 text-[11px]">
                <div className="flex flex-wrap justify-between gap-2">
                  <span>
                    <span className="font-semibold">{s.contactName}</span> <span className="text-muted">({s.role.replace("_", " ")})</span> · field <span className="mono">{s.field}</span> = <span className="mono">{s.value}</span>
                  </span>
                  <span className="mono text-muted">{s.providerCallId ?? s.taskId}</span>
                </div>
                <div className="mt-1 text-muted">certainty {s.certainty}{task?.completionConfidence ? ` · CALL-E confidence ${task.completionConfidence.label}` : ""}</div>
                {s.summary ? <div className="mt-1 text-white/80">{s.summary}</div> : null}
                {s.evidence.length ? (
                  <ul className="mt-1 list-disc pl-4 text-white/70">
                    {s.evidence.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

export function RecoveryCardView({ view, setup, operatorName, onUpdated }: { view: IncidentView; setup: SetupState; operatorName: string; onUpdated: (v: IncidentView) => void }) {
  const [approveCode, setApproveCode] = useState<string | null>(null);
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeNote, setCloseNote] = useState("");
  const { card } = view;
  const dock = view.contacts.find((c) => c.role === "receiving_dock");
  const approving = card.actions.find((a) => a.code === approveCode) ?? null;
  const followUpTask = view.tasks.find((t) => t.kind === "follow_up") ?? null;

  async function approveAndCall() {
    if (!approveCode) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/incidents/${encodeURIComponent(view.incident.id)}/follow-up`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatorName, actionCode: approveCode, humanApproved: approved }),
      });
      const data = (await res.json()) as { view?: IncidentView; error?: string };
      if (!res.ok || !data.view) throw new Error(data.error ?? "Follow-up failed");
      onUpdated(data.view);
      setApproveCode(null);
      setApproved(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Follow-up failed");
    } finally {
      setBusy(false);
    }
  }

  async function closeIncident() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/incidents/${encodeURIComponent(view.incident.id)}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatorName, note: closeNote }),
      });
      const data = (await res.json()) as IncidentView & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Close failed");
      onUpdated(data);
      setCloseOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Close failed");
    } finally {
      setBusy(false);
    }
  }

  const confidenceTone = { high: "border-ok/60 text-ok", medium: "border-warn/60 text-warn", low: "border-bad/60 text-bad", none: "border-line text-muted" }[card.confidence.label];

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-4">
        <div className={`panel p-4 ${card.branch === "window_missed" || card.branch === "dock_declined" || card.branch === "eta_conflicted" ? "border-bad/50" : card.branch === "within_window" || card.branch === "exception_granted" ? "border-ok/50" : ""}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="label">Situation</div>
              <div className="text-base font-semibold">{card.branchLabel}</div>
            </div>
            <span className={`chip ${confidenceTone}`}>confidence {card.confidence.label}</span>
          </div>
          {card.eta.etaDisplay || card.eta.cutoffDisplay ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-3 text-xs">
              <div className="rounded-md border border-line bg-panel-2 p-2">
                <div className="label">Revised ETA</div>
                <div className="mono text-sm">{card.eta.etaDisplay ?? "unresolved"}</div>
              </div>
              <div className="rounded-md border border-line bg-panel-2 p-2">
                <div className="label">Receiving cutoff</div>
                <div className="mono text-sm">{card.eta.cutoffDisplay ?? "unknown"}</div>
                <div className="text-[10px] text-muted">{card.eta.cutoffSource === "dock_call" ? "stated by the dock on the call" : card.eta.cutoffSource === "intake" ? "from intake, not verified" : ""}</div>
              </div>
              <div className="rounded-md border border-line bg-panel-2 p-2">
                <div className="label">Gap</div>
                <div className={`mono text-sm ${card.eta.minutesLate !== null && card.eta.minutesLate > 0 ? "text-bad" : "text-ok"}`}>
                  {card.eta.minutesLate === null ? "not comparable" : card.eta.minutesLate > 0 ? `${card.eta.minutesLate} min after cutoff` : `${-card.eta.minutesLate} min before cutoff`}
                </div>
              </div>
            </div>
          ) : null}
          {card.eta.vagueEtaValues.length ? <p className="mt-2 text-[11px] text-warn">Vague timing was not converted to an ETA: {card.eta.vagueEtaValues.join("; ")}</p> : null}
          <ul className="mt-3 space-y-0.5 text-[11px] text-muted">
            {card.confidence.reasons.map((r) => (
              <li key={r}>· {r}</li>
            ))}
          </ul>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {card.facts.map((f) => (
            <FactRow key={f.key} fact={f} view={view} />
          ))}
        </div>

        {card.unresolvedTasks.length ? (
          <div className="panel border-warn/40 p-4">
            <div className="label mb-2">Unresolved sources (never treated as facts)</div>
            <ul className="space-y-1 text-xs">
              {card.unresolvedTasks.map((u) => (
                <li key={u.taskId} className="flex items-center justify-between gap-2">
                  <span>
                    <span className="font-semibold">{u.contactName}</span> <span className="text-muted">({u.role.replace("_", " ")})</span> — {u.reason}
                  </span>
                  <StatusChip status={u.status} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="panel p-4">
          <div className="label mb-2">Decision log</div>
          <ol className="max-h-72 space-y-1 overflow-auto text-[11px]">
            {view.audit.map((a) => (
              <li key={a.id} className="flex gap-2 border-b border-line/40 py-1">
                <span className="mono shrink-0 text-muted">{new Date(a.createdAt).toLocaleTimeString()}</span>
                <span className="shrink-0 font-semibold">{a.actor}</span>
                <span className="text-info">{a.action}</span>
                <span className="mono min-w-0 truncate text-muted">{JSON.stringify(a.detailJson)}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <aside className="space-y-4">
        <div className="panel p-4">
          <h3 className="mb-2 text-sm font-semibold">Recovery actions</h3>
          {card.actions.length === 0 ? <p className="text-xs text-muted">No action suggested yet. Actions appear once provider-backed results are reconciled.</p> : null}
          <ul className="space-y-2">
            {card.actions.map((a) => {
              const persisted = view.recoveryActions.find((r) => r.code === a.code);
              const status = persisted?.status ?? "suggested";
              return (
                <li key={a.code} className={`rounded-lg border p-3 ${a.requiresCall ? "border-signal/60" : "border-line"} bg-panel-2`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-xs font-semibold">{a.title}</div>
                    <StatusChip status={status} />
                  </div>
                  <p className="mt-1 text-[11px] text-muted">{a.rationale}</p>
                  <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-muted">
                    <span className="chip border-line">owner: {a.owner}</span>
                    <span className="chip border-line">{a.requiresCall ? "CALL-E follow-up call" : "manual"}</span>
                    {a.basedOn.length ? <span className="chip border-line">based on {a.basedOn.length} call{a.basedOn.length > 1 ? "s" : ""}</span> : null}
                  </div>
                  {a.requiresCall && a.requiresApproval && status === "suggested" && !followUpTask ? (
                    <button className="btn-primary mt-2 w-full justify-center !py-1 text-xs" disabled={!setup.canCall || view.incident.status === "closed"} onClick={() => { setApproveCode(a.code); setApproved(false); }}>
                      Approve follow-up call
                    </button>
                  ) : null}
                  {followUpTask && persisted?.callTaskId === followUpTask.id ? (
                    <p className="mt-2 text-[11px] text-muted">
                      Follow-up call <span className="mono">{followUpTask.providerCallId ?? "(creating)"}</span> · <StatusChip status={followUpTask.status} />
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {error ? <p className="mt-2 text-[11px] text-bad">{error}</p> : null}
        </div>

        {card.followUp ? (
          <div className="panel p-4">
            <div className="label mb-2">Follow-up outcome</div>
            <StatusChip status={card.followUp.status} />
            {card.followUp.result ? (
              <div className="mt-2 text-xs">
                <div>can_accept: <span className="mono">{card.followUp.result.can_accept}</span></div>
                <div>offered window: <span className="mono">{card.followUp.result.revised_eta || "(none)"}</span></div>
                <div>condition: {card.followUp.result.blocker || "(none)"}</div>
                <div>next: {card.followUp.result.next_action || "(none)"}</div>
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted">{card.followUp.summary ?? "No usable result yet."}</p>
            )}
          </div>
        ) : null}

        <div className="panel p-4">
          <div className="label mb-2">Close out</div>
          <a className="btn-ghost mb-2 w-full justify-center text-xs" href={`/api/incidents/${encodeURIComponent(view.incident.id)}/summary?download=1`}>
            Download Markdown summary
          </a>
          <button className="btn-danger w-full justify-center text-xs" disabled={view.incident.status === "closed"} onClick={() => setCloseOpen(true)}>
            {view.incident.status === "closed" ? "Incident closed" : "Close incident"}
          </button>
        </div>
      </aside>

      <Modal open={!!approving} title="Approve a consequential follow-up call" onClose={() => setApproveCode(null)}>
        {approving ? (
          <div className="space-y-3 text-sm">
            <p className="text-muted">This call may change the dock appointment. DockSignal never places it automatically.</p>
            <div className="rounded-md border border-line bg-panel-2 p-3 text-xs">
              <div className="font-semibold">{approving.title}</div>
              <div className="mt-1 text-muted">{approving.rationale}</div>
              <div className="mt-2">
                Recipient: <span className="font-semibold">{dock?.name}</span> <span className="mono">{dock?.phoneE164}</span>
              </div>
              <div className="mt-1">Goal: ask whether the dock can accept at {card.eta.etaDisplay ?? "the revised time"}, or the earliest alternative window. Record fees or conditions, never agree to them.</div>
            </div>
            <label className="flex items-start gap-2 text-xs">
              <input type="checkbox" className="mt-0.5" checked={approved} onChange={(e) => setApproved(e.target.checked)} />
              <span>I, {operatorName}, approve this follow-up call. Any window the dock offers is tentative until I confirm it.</span>
            </label>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setApproveCode(null)} disabled={busy}>
                Cancel
              </button>
              <button className="btn-primary" onClick={approveAndCall} disabled={!approved || busy}>
                {busy ? "Creating call…" : "Approve and place the call"}
              </button>
            </div>
            {error ? <p className="text-[11px] text-bad">{error}</p> : null}
          </div>
        ) : null}
      </Modal>

      <Modal open={closeOpen} title="Close incident" onClose={() => setCloseOpen(false)}>
        <p className="mb-2 text-xs text-muted">Closing freezes the incident. The decision log and Markdown summary remain downloadable.</p>
        <textarea className="input mb-3" rows={3} value={closeNote} onChange={(e) => setCloseNote(e.target.value)} placeholder="Closing note (optional)" />
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setCloseOpen(false)} disabled={busy}>
            Cancel
          </button>
          <button className="btn-danger" onClick={closeIncident} disabled={busy}>
            Close incident
          </button>
        </div>
      </Modal>
    </div>
  );
}
