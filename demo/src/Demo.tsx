import React from "react";
import { AbsoluteFill, Html5Audio, Img, Sequence, staticFile, useCurrentFrame } from "remotion";
import { DocOverlay } from "./DocOverlay";
import { PhonePanel } from "./PhonePanel";
import { C, FONT, MONO, TONE, hexA } from "./theme";
import { buildTimeline, easeInOut, layoutAt, lerpCam, lerpNum, lerpPt, MANIFEST, s2f, shot, toScreen, valueAt, VIEW, type Cam, type Layout } from "./timeline";

const T = buildTimeline();
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOutBack = (t: number) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;

function shotsAt(frame: number): Array<{ id: string; opacity: number }> {
  let idx = 0;
  for (let i = 0; i < T.shots.length; i += 1) if (T.shots[i]!.frame <= frame) idx = i;
  const cur = T.shots[idx]!;
  const t = cur.fade > 0 ? clamp01((frame - cur.frame) / cur.fade) : 1;
  if (idx === 0 || t >= 1) return [{ id: cur.shot, opacity: 1 }];
  return [
    { id: T.shots[idx - 1]!.shot, opacity: 1 },
    { id: cur.shot, opacity: easeInOut(t) },
  ];
}

const Backdrop: React.FC = () => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(1200px 700px at 12% -10%, ${hexA(C.signal, 0.13)}, transparent 60%), radial-gradient(1100px 800px at 110% 120%, ${hexA(C.info, 0.16)}, transparent 60%), linear-gradient(180deg, #0a1120 0%, #0c1426 100%)`,
    }}
  />
);

const AppWindow: React.FC<{ frame: number; lay: Layout; cam: Cam }> = ({ frame, lay, cam }) => {
  const shots = shotsAt(frame);
  const top = shot(shots[shots.length - 1]!.id);
  return (
    <div style={{ position: "absolute", left: lay.x, top: lay.y, width: lay.w, height: lay.h + lay.bar, borderRadius: 14, overflow: "hidden", background: C.ink, boxShadow: `0 34px 90px rgba(0,0,0,0.6), 0 0 0 1px ${C.line}` }}>
      <div style={{ position: "absolute", inset: 0, height: lay.bar, background: "#0e1729", borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center", paddingLeft: 18, gap: 9 }}>
        {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
          <span key={c} style={{ width: 13, height: 13, borderRadius: 7, background: c, opacity: 0.85 }} />
        ))}
        <div style={{ position: "absolute", left: 0, right: 0, textAlign: "center", color: C.muted, fontSize: 15, fontFamily: FONT, letterSpacing: 0.2 }}>
          <span style={{ color: C.text, fontWeight: 600 }}>DockSignal</span>
          <span style={{ margin: "0 10px", opacity: 0.5 }}>|</span>
          <span style={{ fontFamily: MONO, fontSize: 14 }}>{top.path}</span>
        </div>
      </div>
      <div style={{ position: "absolute", left: 0, top: lay.bar, width: lay.w, height: lay.h, overflow: "hidden" }}>
        <div style={{ position: "absolute", left: 0, top: 0, width: VIEW.w, transformOrigin: "0 0", transform: `scale(${lay.s * cam.z}) translate(${-cam.x}px, ${-cam.y}px)` }}>
          {shots.map((s) => {
            const d = shot(s.id);
            return <Img key={s.id} src={staticFile(d.file)} style={{ position: "absolute", left: 0, top: d.originY, width: VIEW.w, height: d.height, opacity: s.opacity }} />;
          })}
          {T.typing
            .filter((t) => frame >= t.start && frame < t.end)
            .map((t) => {
              const d = shot(t.shot);
              const p = (frame - t.start) / (t.end - t.start);
              const pad = 3;
              const reveal = Math.min(t.rect.w, 13 + t.chars * 8.7) * p;
              return (
                <React.Fragment key={t.start}>
                  <div style={{ position: "absolute", left: t.rect.x - pad, top: t.rect.y - pad, width: reveal + pad, height: t.rect.h + 2 * pad, overflow: "hidden" }}>
                    <Img src={staticFile(d.file)} style={{ position: "absolute", left: -(t.rect.x - pad), top: d.originY - (t.rect.y - pad), width: VIEW.w, height: d.height }} />
                  </div>
                  <div style={{ position: "absolute", left: t.rect.x + reveal + 1, top: t.rect.y + t.rect.h * 0.22, width: 2, height: t.rect.h * 0.56, background: "#fff", opacity: Math.floor(frame / 8) % 2 ? 0.3 : 0.95 }} />
                </React.Fragment>
              );
            })}
        </div>
      </div>
    </div>
  );
};

const Highlights: React.FC<{ frame: number; lay: Layout; cam: Cam }> = ({ frame, lay, cam }) => (
  <div style={{ position: "absolute", left: lay.x, top: lay.y + lay.bar, width: lay.w, height: lay.h, overflow: "hidden", pointerEvents: "none" }}>
    {T.highlights
      .filter((h) => frame >= h.start && frame < h.end + 8)
      .map((h, i) => {
        const color = TONE[h.tone];
        const pad = Math.max(4, Math.min(8, Math.round(h.rect.h * 0.18)));
        const a = toScreen({ x: h.rect.x - pad, y: h.rect.y - pad }, cam, lay);
        const b = toScreen({ x: h.rect.x + h.rect.w + pad, y: h.rect.y + h.rect.h + pad }, cam, lay);
        const t = clamp01((frame - h.start) / 11);
        const out = Number.isFinite(h.end) ? clamp01((h.end + 8 - frame) / 8) : 1;
        const glow = 0.42 + 0.18 * Math.sin((frame - h.start) / 5.5);
        return (
          <div
            key={`${h.start}-${i}`}
            style={{
              position: "absolute",
              left: a.x - lay.x,
              top: a.y - lay.y - lay.bar,
              width: b.x - a.x,
              height: b.y - a.y,
              borderRadius: 12,
              border: `3px solid ${color}`,
              background: hexA(color, 0.07),
              boxShadow: `0 0 0 4px ${hexA(color, 0.16)}, 0 0 30px ${hexA(color, glow)}`,
              opacity: Math.min(1, t * 1.6) * out,
              transform: `scale(${1.1 - 0.1 * easeOutBack(t)})`,
            }}
          />
        );
      })}
  </div>
);

const Cursor: React.FC<{ frame: number; lay: Layout; cam: Cam }> = ({ frame, lay, cam }) => {
  const vis = valueAt(T.cursorVis, frame, 0, lerpNum);
  if (vis <= 0.01) return null;
  const pos = toScreen(valueAt(T.cursor, frame, T.cursor[0]?.from ?? { x: 1000, y: 560 }, lerpPt), cam, lay);
  const click = T.clicks.filter((c) => c.frame <= frame && frame - c.frame < 18).at(-1);
  const dt = click ? frame - click.frame : 99;
  const press = dt < 7 ? Math.sin((dt / 7) * Math.PI) : 0;
  const ripple = click ? toScreen(click.at, cam, lay) : null;
  const size = 36;
  return (
    <>
      {ripple && dt < 18 ? (
        <div style={{ position: "absolute", left: ripple.x - (10 + dt * 2.6), top: ripple.y - (10 + dt * 2.6), width: 2 * (10 + dt * 2.6), height: 2 * (10 + dt * 2.6), borderRadius: "50%", border: `3px solid ${C.signal}`, background: hexA(C.signal, 0.18), opacity: 0.85 * (1 - dt / 18) * vis }} />
      ) : null}
      <svg width={size} height={size} viewBox="0 0 24 24" style={{ position: "absolute", left: pos.x - 7.5, top: pos.y - 4.5, opacity: vis, transform: `scale(${1 - 0.16 * press})`, transformOrigin: "7.5px 4.5px", filter: "drop-shadow(0 4px 7px rgba(0,0,0,0.55))" }}>
        <path d="M5 3 L5 20.5 L9.4 16.2 L12.3 22.4 L15 21.2 L12.2 15.1 L18.4 15.1 Z" fill="#ffffff" stroke="#0b1220" strokeWidth={1.4} strokeLinejoin="round" />
      </svg>
    </>
  );
};

const Logo: React.FC<{ size: number }> = ({ size }) => (
  <div style={{ width: size, height: size, borderRadius: size * 0.22, background: C.signal, color: C.ink, display: "grid", placeItems: "center", fontWeight: 900, fontSize: size * 0.42, fontFamily: FONT, boxShadow: `0 18px 50px ${hexA(C.signal, 0.35)}` }}>DS</div>
);

const TitleCard: React.FC<{ frame: number }> = ({ frame }) => {
  const { start, end } = T.title;
  if (frame >= end) return null;
  const out = clamp01((end - frame) / 14);
  const rise = (1 - easeInOut(clamp01((frame - start) / 18))) * 18;
  return (
    <AbsoluteFill style={{ opacity: out }}>
      <Backdrop />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", transform: `translateY(${rise}px)` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 34 }}>
          <Logo size={128} />
          <div>
            <div style={{ color: C.text, fontSize: 92, fontWeight: 700, letterSpacing: -1.5, lineHeight: 1 }}>DockSignal</div>
            <div style={{ color: C.muted, fontSize: 32, marginTop: 16 }}>Logistics exception commander · built on CALL-E</div>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const EndCard: React.FC<{ frame: number }> = ({ frame }) => {
  const { start } = T.end;
  if (frame < start) return null;
  const t = easeInOut(clamp01((frame - start) / 16));
  return (
    <AbsoluteFill style={{ opacity: t }}>
      <Backdrop />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", transform: `translateY(${(1 - t) * 14}px)` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 30 }}>
          <Logo size={112} />
          <div>
            <div style={{ color: C.text, fontSize: 80, fontWeight: 700, letterSpacing: -1.2, lineHeight: 1 }}>DockSignal</div>
            <div style={{ color: C.muted, fontSize: 30, marginTop: 14 }}>Logistics exception commander · built on the CALL-E Developer API</div>
          </div>
        </div>
        <div style={{ marginTop: 56, fontFamily: MONO, fontSize: 30, color: C.signal }}>github.com/HectorTa1989/docksignal</div>
        <div style={{ position: "absolute", bottom: 64, color: hexA(C.text, 0.62), fontSize: 21, textAlign: "center", lineHeight: 1.5 }}>
          Walkthrough of the real DockSignal app. The phone calls in this video use synthetic voices and simulated CALL-E responses.
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const SoundTrack: React.FC = () => (
  <>
    {T.sfx.map((s, i) => (
      <Sequence key={`sfx-${i}`} from={s.frame} durationInFrames={s.kind === "click" ? 6 : 3} layout="none">
        <Html5Audio src={staticFile(MANIFEST.sfx[s.kind].file)} volume={s.kind === "click" ? 0.5 : 0.2} />
      </Sequence>
    ))}
    {T.calls.map((seg) => {
      const tl = seg.timeline;
      const at = (sec: number) => seg.callStart + s2f(sec);
      return (
        <React.Fragment key={seg.key}>
          <Sequence from={at(tl.ringAt)} durationInFrames={s2f(1.4)} layout="none">
            <Html5Audio src={staticFile(MANIFEST.sfx.ring.file)} volume={0.32} />
          </Sequence>
          <Sequence from={at(tl.pickupAt)} durationInFrames={4} layout="none">
            <Html5Audio src={staticFile(MANIFEST.sfx.pickup.file)} volume={0.55} />
          </Sequence>
          {tl.lines.map((l, i) => (
            <Sequence key={i} from={at(l.start)} durationInFrames={Math.ceil(l.duration * 30) + 3} layout="none">
              <Html5Audio src={staticFile(l.file)} volume={1} />
            </Sequence>
          ))}
          <Sequence from={at(tl.hangupAt)} durationInFrames={s2f(0.6)} layout="none">
            <Html5Audio src={staticFile(MANIFEST.sfx.hangup.file)} volume={0.35} />
          </Sequence>
        </React.Fragment>
      );
    })}
  </>
);

export const Demo: React.FC = () => {
  const frame = useCurrentFrame();
  const L = valueAt(T.layout, frame, 0, lerpNum);
  const lay = layoutAt(L);
  const cam = valueAt(T.cam, frame, { x: 0, y: 0, z: 1 }, lerpCam);
  const call = T.calls.find((c) => frame >= c.start && frame < c.end) ?? null;
  return (
    <AbsoluteFill style={{ fontFamily: FONT, background: C.ink }}>
      <Backdrop />
      <AppWindow frame={frame} lay={lay} cam={cam} />
      <Highlights frame={frame} lay={lay} cam={cam} />
      {call ? <PhonePanel seg={call} frame={frame} L={L} /> : null}
      {T.doc && frame >= T.doc.start && frame < T.doc.end ? <DocOverlay start={T.doc.start} end={T.doc.end} frame={frame} /> : null}
      <Cursor frame={frame} lay={lay} cam={cam} />
      <TitleCard frame={frame} />
      <EndCard frame={frame} />
      <SoundTrack />
    </AbsoluteFill>
  );
};
