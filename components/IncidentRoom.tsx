"use client";

import { useState } from "react";
import type { IncidentView, TaskView } from "@/lib/incident-view";
import type { SetupState } from "@/lib/server";
import { Kv, StatusChip } from "./ui";

function TaskCard({ task }: { task: TaskView }) {
  const [showTranscript, setShowTranscript] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const unresolved = ["failed", "dispatch_failed", "result_validation_failed", "canceled"].includes(task.status);
  return (
    <div className={`panel p-4 ${unresolved ? "border-bad/40" : task.status === "completed" ? "border-ok/40" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">
            {task.kind === "follow_up" ? "Follow-up · " : ""}
            {task.role.replace("_", " ")} · {task.contactName}
          </div>
          <div className="mono text-[11px] text-muted">{task.phoneMasked}</div>
        </div>
        <StatusChip status={task.status} />
      </div>
      <div className="mt-3">
        <Kv k="CALL-E call id" v={task.providerCallId ?? "not created"} mono />
        <Kv k="Provider status" v={`${task.providerStatus ?? "—"} / recipient ${task.recipientStatus ?? "—"}`} mono />
        <Kv k="Idempotency key" v={task.idempotencyKey} mono />
        {task.approvedBy ? <Kv k="Human approval" v={`${task.approvedBy} · ${task.approvedAt ? new Date(task.approvedAt).toLocaleTimeString() : ""}`} /> : null}
        <Kv k="Dispatched" v={task.dispatchedAt ? new Date(task.dispatchedAt).toLocaleTimeString() : "—"} />
        <Kv k="Last reconciled" v={task.lastReconciledAt ? new Date(task.lastReconciledAt).toLocaleTimeString() : "—"} />
      </div>
      {task.lastError ? <p className="mt-2 rounded-md border border-bad/40 bg-bad/10 p-2 text-xs text-bad">{task.lastError}</p> : null}
      {task.failureMessage && task.failureMessage !== task.lastError ? (
        <p className="mt-2 text-xs text-bad">
          {task.failureCode ? `${task.failureCode}: ` : ""}
          {task.failureMessage}
        </p>
      ) : null}
      {task.summary || task.recipientSummary ? (
        <div className="mt-3">
          <div className="label mb-1">CALL-E summary</div>
          <p className="text-xs text-white/90">{task.recipientSummary ?? task.summary}</p>
        </div>
      ) : null}
      {task.taskCompleted !== null || task.completionConfidence ? (
        <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
          <span className={`chip ${task.taskCompleted ? "border-ok/60 text-ok" : "border-warn/60 text-warn"}`}>task_completed: {String(task.taskCompleted)}</span>
          {task.completionConfidence ? (
            <span className="chip border-info/60 text-info">
              confidence {task.completionConfidence.label} · {task.completionConfidence.score.toFixed(2)}
            </span>
          ) : null}
        </div>
      ) : null}
      {task.evidence.length ? (
        <div className="mt-3">
          <div className="label mb-1">Evidence</div>
          <ul className="list-disc space-y-0.5 pl-4 text-xs text-white/80">
            {task.evidence.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {task.structuredResult ? (
        <div className="mt-3">
          <div className="label mb-1">Structured result (schema-valid)</div>
          <div className="grid grid-cols-2 gap-x-3 rounded-md border border-line bg-ink p-2 text-[11px]">
            {Object.entries(task.structuredResult).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2 border-b border-line/40 py-0.5">
                <span className="text-muted">{k}</span>
                <span className={`mono text-right ${v === "" || v === "unknown" ? "text-muted italic" : "text-white"}`}>{v === "" ? "(empty → unresolved)" : v}</span>
              </div>
            ))}
          </div>
        </div>
      ) : task.rawStructuredResult ? (
        <p className="mt-3 text-xs text-warn">CALL-E returned a structured result that does not match the DockSignal contract. It is stored but not used.</p>
      ) : null}
      <div className="mt-3 flex gap-3 text-[11px]">
        {task.transcript.length ? (
          <button className="text-info hover:underline" onClick={() => setShowTranscript((s) => !s)}>
            {showTranscript ? "Hide" : "Show"} transcript ({task.transcript.length} turns)
          </button>
        ) : null}
        {task.rawStructuredResult ? (
          <button className="text-info hover:underline" onClick={() => setShowRaw((s) => !s)}>
            {showRaw ? "Hide" : "Show"} raw provider fields
          </button>
        ) : null}
      </div>
      {showTranscript ? (
        <ol className="mt-2 max-h-64 space-y-1 overflow-auto rounded-md border border-line bg-ink p-2 text-[11px]">
          {task.transcript.map((t, i) => (
            <li key={i} className={t.speaker === "bot" ? "text-info" : "text-white"}>
              <span className="mono text-muted">[{t.offset_seconds ?? "?"}s] </span>
              <span className="font-semibold">{t.speaker}:</span> {t.text}
            </li>
          ))}
        </ol>
      ) : null}
      {showRaw ? <pre className="mt-2 max-h-64 overflow-auto rounded-md border border-line bg-ink p-2 text-[11px]">{JSON.stringify(task.rawStructuredResult, null, 2)}</pre> : null}
    </div>
  );
}

export function IncidentRoom({ view, setup, onUpdated, onGoRecovery }: { view: IncidentView; setup: SetupState; onUpdated: (v: IncidentView) => void; onGoRecovery: () => void }) {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const terminal = view.tasks.filter((t) => ["completed", "failed", "result_validation_failed", "canceled", "dispatch_failed"].includes(t.status)).length;

  async function recheck() {
    setBusy(true);
    try {
      const res = await fetch(`/api/incidents/${encodeURIComponent(view.incident.id)}/reconcile`, { method: "POST" });
      const data = (await res.json()) as { view?: IncidentView; report?: { checked: number; updated: string[]; errors: unknown[] }; error?: string };
      if (data.view) onUpdated(data.view);
      setReport(data.report ? `checked ${data.report.checked}, updated ${data.report.updated.length}, errors ${data.report.errors.length}` : data.error ?? "no report");
    } finally {
      setBusy(false);
    }
  }

  if (!view.tasks.length) {
    return (
      <div className="panel p-6 text-center text-sm text-muted">
        No calls yet. Launch the fact-finding wave from the call plan.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2 text-[11px]">
          <span className="chip border-line text-muted">calls created (all incidents): {view.counters.callsCreated}</span>
          <span className="chip border-line text-muted">webhooks processed: {view.counters.webhooksProcessed}</span>
          <span className="chip border-line text-muted">terminal: {terminal}/{view.tasks.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-ghost !py-1 text-xs" onClick={recheck} disabled={busy || !setup.canCall}>
            {busy ? "Checking…" : "Re-check with CALL-E"}
          </button>
          <button className="btn-primary !py-1 text-xs" onClick={onGoRecovery}>
            Open recovery card →
          </button>
        </div>
      </div>
      {report ? <p className="mb-3 text-[11px] text-muted">Reconciliation: {report}</p> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {view.tasks.map((t) => (
          <TaskCard key={t.id} task={t} />
        ))}
      </div>
      <div className="panel mt-4 p-4">
        <div className="label mb-2">Webhook deliveries</div>
        {view.events.length === 0 ? (
          <p className="text-xs text-muted">No terminal webhook received yet. Results also arrive through the reconciliation job, which polls GET /v1/calls/{"{id}"}.</p>
        ) : (
          <table className="w-full text-left text-[11px]">
            <thead className="text-muted">
              <tr>
                <th className="py-1">Event id</th>
                <th>Type</th>
                <th>Call</th>
                <th>Received</th>
                <th>Processed</th>
              </tr>
            </thead>
            <tbody>
              {view.events.map((e) => (
                <tr key={e.id} className="border-t border-line/60">
                  <td className="mono py-1">{e.id}</td>
                  <td>{e.eventType}</td>
                  <td className="mono">{e.providerCallId}</td>
                  <td>{new Date(e.receivedAt).toLocaleTimeString()}</td>
                  <td>{e.processedAt ? new Date(e.processedAt).toLocaleTimeString() : e.processingError ? <span className="text-bad">{e.processingError}</span> : "pending"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
