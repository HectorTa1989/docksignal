import React from "react";
import { Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { useAudioData, visualizeAudio } from "@remotion/media-utils";
import { CALLS } from "./dialogue";
import { C, FONT, MONO, hexA } from "./theme";
import { CAPTURE, FPS, type CallSeg } from "./timeline";

const CONTACT = {
  driver: { name: "Driver on SHP-88214", role: "Driver", phone: "+12*******47", initials: "DR", kind: "Fact-finding call" },
  dock: { name: "Receiving desk, Dock 7", role: "Receiving dock", phone: "+12*******83", initials: "D7", kind: "Fact-finding call" },
  followup: { name: "Receiving desk, Dock 7", role: "Receiving dock", phone: "+12*******83", initials: "D7", kind: "Follow-up · approved by Dana Lim" },
} as const;

const IDEMPOTENCY = {
  driver: "docksignal:DS-1042:DS-1042:driver:fact_finding:v1",
  dock: "docksignal:DS-1042:DS-1042:receiving_dock:fact_finding:v1",
  followup: "docksignal:DS-1042:DS-1042:receiving_dock:follow_up:request_dock_exception:v1",
} as const;

const Bars: React.FC<{ values: number[]; color: string }> = ({ values, color }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 3, height: 44 }}>
    {values.map((v, i) => (
      <div key={i} style={{ width: 4, height: 4 + Math.min(1, v) * 38, borderRadius: 2, background: color }} />
    ))}
  </div>
);

/** Waveform driven by the line's real audio. Rendered inside a Sequence, so frame 0 is the line start. */
const LineWave: React.FC<{ file: string; color: string }> = ({ file, color }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const audioData = useAudioData(staticFile(file));
  if (!audioData) return <Bars values={Array(22).fill(0.04)} color={color} />;
  const bins = visualizeAudio({ fps, frame, audioData, numberOfSamples: 32, smoothing: true }).slice(0, 11);
  const values = [...bins.slice().reverse(), ...bins].map((v) => Math.min(1, Math.sqrt(v) * 1.9));
  return <Bars values={values} color={color} />;
};

const SpeakerRow: React.FC<{ active: boolean; label: string; sub: string; badge: React.ReactNode; color: string; wave: React.ReactNode }> = ({ active, label, sub, badge, color, wave }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "16px 18px", borderRadius: 14, background: active ? hexA(color, 0.1) : "transparent", border: `1px solid ${active ? hexA(color, 0.55) : C.line}` }}>
    {badge}
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ color: C.text, fontSize: 19, fontWeight: 600 }}>{label}</div>
      <div style={{ color: C.muted, fontSize: 15, marginTop: 2 }}>{sub}</div>
    </div>
    <div style={{ width: 150, display: "flex", justifyContent: "flex-end" }}>{wave}</div>
  </div>
);

const Circle: React.FC<{ text: string; color: string; size?: number }> = ({ text, color, size = 46 }) => (
  <div style={{ width: size, height: size, borderRadius: "50%", display: "grid", placeItems: "center", background: hexA(color, 0.16), border: `1.5px solid ${hexA(color, 0.7)}`, color, fontWeight: 700, fontSize: size * 0.34 }}>{text}</div>
);

export const PhonePanel: React.FC<{ seg: CallSeg; frame: number; L: number }> = ({ seg, frame, L }) => {
  const contact = CONTACT[seg.key];
  const tl = seg.timeline;
  const t = (frame - seg.callStart) / FPS;
  const phase = t < tl.pickupAt ? "ringing" : t < tl.hangupAt ? "connected" : "ended";
  const secs = Math.max(0, Math.min(t, tl.hangupAt) - tl.pickupAt);
  const clock = `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(Math.floor(secs % 60)).padStart(2, "0")}`;
  const active = tl.lines.find((l) => t >= l.start && t < l.start + l.duration) ?? null;
  const ring = phase === "ringing" ? (frame % 30) / 30 : 0;
  const x = 1380 + (1 - L) * 540;

  const waveFor = (who: "bot" | "user", color: string) => (
    <>
      {!active || active.who !== who ? <Bars values={Array(22).fill(phase === "connected" ? 0.05 : 0.02)} color={hexA(color, 0.35)} /> : null}
      {tl.lines.map((l, i) =>
        l.who === who ? (
          <Sequence key={i} from={seg.callStart + Math.round(l.start * FPS)} durationInFrames={Math.round(l.duration * FPS)} layout="none">
            <LineWave file={l.file} color={color} />
          </Sequence>
        ) : null,
      )}
    </>
  );

  return (
    <div style={{ position: "absolute", left: x, top: 161, width: 480, height: 758, opacity: L, borderRadius: 18, background: "linear-gradient(180deg, #121c30 0%, #0e1628 100%)", border: `1px solid ${C.line}`, boxShadow: "0 34px 90px rgba(0,0,0,0.55)", fontFamily: FONT, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "22px 24px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ background: C.signal, color: C.ink, fontWeight: 800, fontSize: 15, padding: "4px 10px", borderRadius: 7, letterSpacing: 0.5 }}>CALL-E</span>
          <span style={{ color: C.muted, fontSize: 16 }}>Outbound call</span>
        </div>
        <div style={{ textAlign: "right", border: `1.5px solid ${hexA(C.signal, 0.75)}`, borderRadius: 8, padding: "4px 10px", color: C.signal, lineHeight: 1.15 }}>
          <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: 1.2 }}>SIMULATED CALL</div>
          <div style={{ fontSize: 12, opacity: 0.85 }}>synthetic voices</div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 34 }}>
        <div style={{ position: "relative", width: 118, height: 118 }}>
          {phase === "ringing"
            ? [0, 0.5].map((o) => {
                const p = (ring + o) % 1;
                return <div key={o} style={{ position: "absolute", inset: -p * 34, borderRadius: "50%", border: `2px solid ${hexA(C.ok, 0.6 * (1 - p))}` }} />;
              })
            : null}
          <div style={{ position: "absolute", inset: 0, borderRadius: "50%", display: "grid", placeItems: "center", background: C.panel2, border: `2px solid ${phase === "connected" ? C.ok : C.line}`, color: C.text, fontSize: 40, fontWeight: 700 }}>{contact.initials}</div>
        </div>
        <div style={{ color: C.text, fontSize: 30, fontWeight: 700, marginTop: 20 }}>{contact.name}</div>
        <div style={{ color: C.muted, fontSize: 18, marginTop: 6 }}>
          {contact.role} · <span style={{ fontFamily: MONO }}>{contact.phone}</span>
        </div>
        <div style={{ marginTop: 14, fontSize: 20, fontWeight: 600, color: phase === "connected" ? C.ok : C.muted, display: "flex", alignItems: "center", gap: 10 }}>
          {phase === "connected" ? <span style={{ width: 10, height: 10, borderRadius: 5, background: C.ok, boxShadow: `0 0 12px ${C.ok}` }} /> : null}
          {phase === "ringing" ? "Ringing…" : phase === "connected" ? `Connected · ${clock}` : `Call ended · ${clock}`}
        </div>
        <div style={{ marginTop: 12, fontSize: 14, color: C.info, border: `1px solid ${hexA(C.info, 0.5)}`, borderRadius: 999, padding: "3px 12px" }}>{contact.kind}</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "30px 22px 0" }}>
        <SpeakerRow active={active?.who === "bot"} label="AI assistant" sub="Calling for Northwind Freight Operations" badge={<Circle text="AI" color={C.info} />} color={C.info} wave={waveFor("bot", C.info)} />
        <SpeakerRow active={active?.who === "user"} label={contact.name} sub={contact.role} badge={<Circle text={contact.initials} color={C.ok} />} color={C.ok} wave={waveFor("user", C.ok)} />
      </div>

      <div style={{ position: "absolute", left: 24, right: 24, bottom: 22, fontSize: 13, color: C.muted, lineHeight: 1.7 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>CALL-E call id</span>
          <span style={{ fontFamily: MONO, color: C.text }}>{CAPTURE.calls[seg.key]}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <span>Idempotency-Key</span>
          <span style={{ fontFamily: MONO, color: C.text, fontSize: 11.5, textAlign: "right", wordBreak: "break-all" }}>{IDEMPOTENCY[seg.key]}</span>
        </div>
      </div>
      {CALLS[seg.key] ? null : null}
    </div>
  );
};
