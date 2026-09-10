"use client";

import { useEffect } from "react";
import type { SetupState } from "@/lib/server";
import type { TaskStatus } from "@/lib/status";
import { TASK_STATUS_LABELS } from "@/lib/status";

export function StatusChip({ status }: { status: TaskStatus | string }) {
  const tone: Record<string, string> = {
    queued: "border-muted/40 text-muted",
    dispatching: "border-info/60 text-info",
    in_progress: "border-info/60 text-info animate-pulse",
    completed: "border-ok/60 text-ok",
    failed: "border-bad/60 text-bad",
    dispatch_failed: "border-bad/60 text-bad",
    result_validation_failed: "border-warn/60 text-warn",
    canceled: "border-bad/60 text-bad",
    draft: "border-muted/40 text-muted",
    calling: "border-info/60 text-info",
    review: "border-signal/60 text-signal",
    follow_up_calling: "border-info/60 text-info",
    closed: "border-ok/60 text-ok",
    verified: "border-ok/60 text-ok",
    unresolved: "border-muted/40 text-muted",
    conflicted: "border-bad/60 text-bad",
    suggested: "border-signal/60 text-signal",
    approved: "border-ok/60 text-ok",
    dispatched: "border-info/60 text-info",
    superseded: "border-muted/40 text-muted",
  };
  const label = (TASK_STATUS_LABELS as Record<string, string>)[status] ?? status.replace(/_/g, " ");
  return <span className={`chip ${tone[status] ?? "border-muted/40 text-muted"}`}>{label}</span>;
}

export function Modal({ open, title, children, onClose }: { open: boolean; title: string; children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="panel w-full max-w-2xl p-5 shadow-2xl">
        <div className="mb-3 flex items-start justify-between gap-4">
          <h2 className="text-base font-semibold">{title}</h2>
          <button className="text-muted hover:text-white" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function SetupBanner({ setup }: { setup: SetupState }) {
  if (setup.canCall) {
    return (
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-ok/40 bg-ok/5 px-4 py-2 text-xs">
        <span className="chip border-ok/60 text-ok">CALL-E ready</span>
        <span className="text-muted">API key accepted by api.heycall-e.com · webhook</span>
        <code className="mono text-[11px] text-white">{setup.webhookUrl}</code>
      </div>
    );
  }
  const problems: string[] = [];
  if (setup.calle.state === "missing") problems.push(setup.calle.reason);
  if (setup.calle.state === "rejected") problems.push(`CALL-E rejected the API key: ${setup.calle.reason}`);
  if (setup.calle.state === "unknown") problems.push(`Could not verify the CALL-E key: ${setup.calle.reason}`);
  if (!setup.database.ok) problems.push(`Database unavailable: ${setup.database.error}`);
  return (
    <div className="mb-4 rounded-lg border border-bad/50 bg-bad/10 px-4 py-3 text-sm">
      <div className="mb-1 flex items-center gap-2 font-semibold text-bad">
        <span className="chip border-bad/60 text-bad">Calling blocked</span>
        Setup required
      </div>
      <ul className="list-disc pl-5 text-xs text-white/90">
        {problems.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-muted">
        DockSignal has no mock or demo mode. Until the server has a valid <code className="mono">CALLE_API_KEY</code>, an HTTPS{" "}
        <code className="mono">PUBLIC_BASE_URL</code>, and a reachable database, no call can be created and no result can appear.
      </p>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="label mb-1 block">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-muted">{hint}</span> : null}
    </label>
  );
}

export function Kv({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line/60 py-1.5 text-xs last:border-b-0">
      <span className="text-muted">{k}</span>
      <span className={`min-w-0 text-right text-white ${mono ? "mono break-all" : ""}`}>{v}</span>
    </div>
  );
}
