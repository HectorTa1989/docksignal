"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IncidentView } from "@/lib/incident-view";
import type { SetupState } from "@/lib/server";
import { CallPlanView } from "./CallPlanView";
import { IncidentRoom } from "./IncidentRoom";
import { RecoveryCardView } from "./RecoveryCardView";
import { SetupBanner, StatusChip } from "./ui";

export type Tab = "plan" | "room" | "recovery";

export function IncidentConsole({ initial, setup, initialTab }: { initial: IncidentView; setup: SetupState; initialTab?: Tab }) {
  const [view, setView] = useState<IncidentView>(initial);
  const [tab, setTab] = useState<Tab>(initialTab ?? (initial.incident.status === "draft" ? "plan" : initial.incident.status === "calling" ? "room" : "recovery"));
  const [operatorName, setOperatorName] = useState(initial.incident.operatorName);
  const [lastPoll, setLastPoll] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const hasOpenCalls = useMemo(() => view.tasks.some((t) => t.status === "dispatching" || t.status === "in_progress"), [view.tasks]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/incidents/${encodeURIComponent(view.incident.id)}`, { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      setView((await res.json()) as IncidentView);
      setPollError(null);
      setLastPoll(new Date().toLocaleTimeString());
    } catch (error) {
      setPollError(error instanceof Error ? error.message : "poll failed");
    }
  }, [view.incident.id]);

  useEffect(() => {
    const interval = hasOpenCalls ? 3000 : 15000;
    pollRef.current = window.setInterval(refresh, interval);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [hasOpenCalls, refresh]);

  const tabs: Array<{ id: Tab; label: string; hint: string }> = [
    { id: "plan", label: "1 · Call plan", hint: "recipients, goals, authorization" },
    { id: "room", label: "2 · Incident room", hint: "live provider-backed call states" },
    { id: "recovery", label: "3 · Recovery card", hint: "facts, conflicts, approval" },
  ];

  return (
    <div>
      <SetupBanner setup={setup} />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="mono text-xl font-semibold">{view.incident.id}</h1>
            <StatusChip status={view.incident.status} />
          </div>
          <p className="mt-1 text-xs text-muted">
            {view.incident.shipmentRef} · {view.incident.cargoDescription} · promised {view.incident.promisedDockDisplay}
            {view.incident.receivingCutoffDisplay ? ` · cutoff on file ${view.incident.receivingCutoffDisplay}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted">
          <label className="flex items-center gap-2">
            Operator
            <input className="input !w-40 !py-1" value={operatorName} onChange={(e) => setOperatorName(e.target.value)} />
          </label>
          <span>{hasOpenCalls ? "polling every 3s" : "polling every 15s"}</span>
          {lastPoll ? <span>· {lastPoll}</span> : null}
          {pollError ? <span className="text-bad">· {pollError}</span> : null}
        </div>
      </div>

      <div className="mb-5 grid grid-cols-3 gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-lg border px-3 py-2 text-left transition ${tab === t.id ? "border-signal bg-signal/10" : "border-line bg-panel hover:border-muted"}`}
          >
            <div className="text-sm font-semibold">{t.label}</div>
            <div className="text-[11px] text-muted">{t.hint}</div>
          </button>
        ))}
      </div>

      {tab === "plan" ? <CallPlanView view={view} setup={setup} operatorName={operatorName} onUpdated={(v) => { setView(v); }} onLaunched={(v) => { setView(v); setTab("room"); }} /> : null}
      {tab === "room" ? <IncidentRoom view={view} setup={setup} onUpdated={setView} onGoRecovery={() => setTab("recovery")} /> : null}
      {tab === "recovery" ? <RecoveryCardView view={view} setup={setup} operatorName={operatorName} onUpdated={setView} /> : null}
    </div>
  );
}
