import captureJson from "../public/capture.json";
import manifestJson from "../public/audio/manifest.json";
import { layoutCall, type CallTimeline, type VoiceManifest } from "./callLayout";
import { CALLS, type CallKey } from "./dialogue";
import { STORY, type CamSpec, type Hl, type Tone } from "./storyboard";

export const FPS = 30;
export const VIEW = { w: 1280, h: 720 };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface ShotData {
  file: string;
  originY: number;
  height: number;
  pageHeight: number;
  scrollY: number;
  path: string;
  rects: Record<string, Rect>;
}
export interface Capture {
  scenarioStart: string;
  calls: Record<CallKey, string>;
  shots: Record<string, ShotData>;
}
export const CAPTURE = captureJson as unknown as Capture;
export const MANIFEST = manifestJson as unknown as VoiceManifest;

export interface Cam {
  x: number;
  y: number;
  z: number;
}
export interface Pt {
  x: number;
  y: number;
}
export interface Move<T> {
  start: number;
  end: number;
  from: T;
  to: T;
}
export interface Highlight {
  start: number;
  end: number;
  rect: Rect;
  tone: Tone;
}
export interface CallSeg {
  start: number;
  callStart: number;
  end: number;
  key: CallKey;
  timeline: CallTimeline;
}
export interface Timeline {
  duration: number;
  cam: Move<Cam>[];
  cursor: Move<Pt>[];
  cursorVis: Move<number>[];
  layout: Move<number>[];
  shots: Array<{ frame: number; shot: string; fade: number }>;
  highlights: Highlight[];
  clicks: Array<{ frame: number; at: Pt }>;
  typing: Array<{ start: number; end: number; shot: string; rect: Rect; chars: number }>;
  sfx: Array<{ frame: number; kind: "click" | "key" }>;
  calls: CallSeg[];
  doc: { start: number; end: number } | null;
  title: { start: number; end: number };
  end: { start: number; end: number };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const s2f = (sec: number) => Math.round(sec * FPS);

export function shot(id: string): ShotData {
  const s = CAPTURE.shots[id];
  if (!s) throw new Error(`Unknown shot ${id}`);
  return s;
}
function rectRef(ref: string, defaultShot: string): Rect {
  const [sid, name] = ref.includes(":") ? (ref.split(":") as [string, string]) : [defaultShot, ref];
  const r = shot(sid).rects[name];
  if (!r) throw new Error(`No rect "${name}" in shot ${sid}`);
  return r;
}
function union(rects: Rect[]): Rect {
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
function clampCam(c: Cam, s: ShotData): Cam {
  const visW = VIEW.w / c.z;
  const visH = VIEW.h / c.z;
  const maxY = Math.max(s.originY, s.originY + s.height - visH);
  return { z: c.z, x: clamp(c.x, 0, VIEW.w - visW), y: clamp(c.y, s.originY, maxY) };
}
function fitRects(shotId: string, rects: Rect[], zmax: number): Cam {
  const s = shot(shotId);
  const u = union(rects);
  const m = 30;
  const z = clamp(Math.min(zmax, VIEW.w / (u.w + 2 * m), VIEW.h / (u.h + 2 * m)), 1, zmax);
  const visW = VIEW.w / z;
  const visH = VIEW.h / z;
  const cy = u.h + 2 * m > visH ? u.y - m + visH / 2 : u.y + u.h / 2;
  return clampCam({ x: u.x + u.w / 2 - visW / 2, y: cy - visH / 2, z }, s);
}
function fitSpec(shotId: string, spec: CamSpec | undefined, current: Cam): Cam {
  const s = shot(shotId);
  if (!spec) return clampCam(current, s);
  if (spec.top) return clampCam({ x: 0, y: s.originY, z: 1 }, s);
  return fitRects(shotId, (spec.fit ?? []).map((r) => rectRef(r, shotId)), spec.zmax ?? 1);
}
function ensureVisible(cam: Cam, rect: Rect, shotId: string): Cam {
  const visW = VIEW.w / cam.z;
  const visH = VIEW.h / cam.z;
  const m = 26;
  const inside = rect.x >= cam.x + m && rect.x + rect.w <= cam.x + visW - m && rect.y >= cam.y + m && rect.y + rect.h <= cam.y + visH - m;
  return inside ? clampCam(cam, shot(shotId)) : fitRects(shotId, [rect], cam.z);
}
const same = (a: Cam, b: Cam) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.z - b.z) < 0.005;

export function buildTimeline(): Timeline {
  const T: Timeline = { duration: 0, cam: [], cursor: [], cursorVis: [], layout: [], shots: [], highlights: [], clicks: [], typing: [], sfx: [], calls: [], doc: null, title: { start: 0, end: 0 }, end: { start: 0, end: 0 } };
  let f = 0;
  let cam: Cam = { x: 0, y: 0, z: 1 };
  let camFree = 0;
  let cur: Pt = { x: 1000, y: 560 };
  let curShot = "";
  let cursorShown = 0;
  let open: Highlight[] = [];

  const camTo = (to: Cam, start: number, dur: number) => {
    if (same(cam, to)) return;
    const s = Math.max(start, camFree);
    T.cam.push({ start: s, end: s + dur, from: cam, to });
    cam = to;
    camFree = s + dur;
  };
  const cursorTo = (to: Pt, start: number, dur: number) => {
    T.cursor.push({ start, end: start + dur, from: cur, to });
    cur = to;
  };
  const showCursor = (to: number, start: number, dur: number) => {
    if (cursorShown === to) return;
    T.cursorVis.push({ start, end: start + dur, from: cursorShown, to });
    cursorShown = to;
  };
  const switchShot = (id: string, frame: number, fade: number) => {
    if (id === curShot) return;
    T.shots.push({ frame, shot: id, fade });
    curShot = id;
  };
  const closeHighlights = (frame: number) => {
    for (const h of open) h.end = Math.max(h.start + 12, frame + 6);
    open = [];
  };
  const openHighlights = (list: Hl[] | undefined, shotId: string, start: number) => {
    (list ?? []).forEach(([ref, tone], i) => {
      const h: Highlight = { start: start + i * 5, end: Number.POSITIVE_INFINITY, rect: rectRef(ref, shotId), tone };
      T.highlights.push(h);
      open.push(h);
    });
  };
  const travel = (to: Pt) => {
    const d = Math.hypot(to.x - cur.x, to.y - cur.y) * 1.35;
    return Math.round(clamp(10 + d / 50, 12, 22));
  };

  for (const step of STORY) {
    switch (step.t) {
      case "title": {
        T.title = { start: f, end: f + s2f(step.sec) };
        f += s2f(step.sec) - 12;
        break;
      }
      case "show": {
        closeHighlights(f);
        switchShot(step.shot, f, 12);
        showCursor(1, f, 10);
        camTo(fitSpec(step.shot, step.cam, cam), f, 22);
        openHighlights(step.hl, step.shot, f + 14);
        f += s2f(step.hold) + 14;
        break;
      }
      case "type": {
        closeHighlights(f);
        switchShot(step.shot, f, 8);
        showCursor(1, f, 8);
        const target = rectRef(step.target, step.to);
        const at = { x: target.x + 22, y: target.y + target.h / 2 };
        const dur = travel(at);
        camTo(step.cam ? fitSpec(step.shot, step.cam, cam) : ensureVisible(cam, target, step.shot), f, Math.max(dur, 16));
        cursorTo(at, f, dur);
        f += Math.max(dur, 16);
        T.clicks.push({ frame: f, at });
        T.sfx.push({ frame: f, kind: "click" });
        f += 5;
        const typeFrames = Math.max(14, Math.round(step.text.length * 1.9));
        T.typing.push({ start: f, end: f + typeFrames, shot: step.to, rect: target, chars: step.text.length });
        for (let k = 0; k < step.text.length; k += 2) T.sfx.push({ frame: f + Math.round((k / step.text.length) * typeFrames), kind: "key" });
        f += typeFrames;
        switchShot(step.to, f, 0);
        openHighlights([[step.target, "ok"]], step.to, f);
        f += s2f(step.hold) + 8;
        break;
      }
      case "click": {
        closeHighlights(f);
        switchShot(step.shot, f, 8);
        showCursor(1, f, 8);
        const target = rectRef(step.target, step.shot);
        const at = { x: target.x + target.w / 2, y: target.y + target.h / 2 };
        const dur = travel(at);
        const before = step.camBefore ? fitSpec(step.shot, step.camBefore, cam) : ensureVisible(cam, target, step.shot);
        camTo(before, f, Math.max(dur, 16));
        cursorTo(at, f, dur);
        f += Math.max(dur, 16) + 2;
        T.clicks.push({ frame: f, at });
        T.sfx.push({ frame: f, kind: "click" });
        f += 5;
        const after = step.to ?? step.shot;
        if (step.to) switchShot(step.to, f, step.nav ? 12 : 8);
        camTo(fitSpec(after, step.cam, cam), f + 3, 22);
        openHighlights(step.hl, after, f + (step.nav ? 14 : 10));
        f += s2f(step.hold) + 12;
        break;
      }
      case "event": {
        closeHighlights(f);
        f += 6;
        switchShot(step.to, f, 12);
        camTo(fitSpec(step.to, step.cam, cam), f, 22);
        openHighlights(step.hl, step.to, f + 14);
        f += s2f(step.hold) + 14;
        break;
      }
      case "call": {
        closeHighlights(f);
        const timeline = layoutCall(MANIFEST, step.key, CALLS[step.key].lines);
        switchShot(step.bg, f, 12);
        camTo(fitSpec(step.bg, step.cam, cam), f, 22);
        showCursor(0, f, 10);
        T.layout.push({ start: f, end: f + 24, from: 0, to: 1 });
        const callStart = f + 24;
        const callEnd = callStart + s2f(timeline.total);
        openHighlights(step.hl, step.bg, f + 20);
        T.calls.push({ start: f, callStart, end: callEnd + 24, key: step.key, timeline });
        f = callEnd;
        closeHighlights(f - 6);
        T.layout.push({ start: f, end: f + 24, from: 1, to: 0 });
        f += 24;
        break;
      }
      case "doc": {
        closeHighlights(f);
        showCursor(0, f, 8);
        T.doc = { start: f, end: f + s2f(step.hold) };
        f += s2f(step.hold);
        break;
      }
      case "end": {
        closeHighlights(f);
        showCursor(0, f, 10);
        T.end = { start: f, end: f + s2f(step.sec) };
        f += s2f(step.sec);
        break;
      }
    }
  }
  closeHighlights(f);
  T.duration = f;
  return T;
}

// ---------------------------------------------------------------- interpolation
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export function valueAt<T>(moves: Move<T>[], frame: number, initial: T, lerp: (a: T, b: T, t: number) => T): T {
  let v = initial;
  for (const m of moves) {
    if (frame < m.start) break;
    if (frame >= m.end) {
      v = m.to;
      continue;
    }
    return lerp(m.from, m.to, easeInOut((frame - m.start) / (m.end - m.start)));
  }
  return v;
}
export const lerpNum = (a: number, b: number, t: number) => a + (b - a) * t;
export const lerpPt = (a: Pt, b: Pt, t: number): Pt => ({ x: lerpNum(a.x, b.x, t), y: lerpNum(a.y, b.y, t) });
export const lerpCam = (a: Cam, b: Cam, t: number): Cam => {
  // Interpolate zoom in log space and keep the visible centre moving smoothly.
  const z = Math.exp(lerpNum(Math.log(a.z), Math.log(b.z), t));
  const ca = { x: a.x + VIEW.w / a.z / 2, y: a.y + VIEW.h / a.z / 2 };
  const cb = { x: b.x + VIEW.w / b.z / 2, y: b.y + VIEW.h / b.z / 2 };
  const c = lerpPt(ca, cb, t);
  return { z, x: c.x - VIEW.w / z / 2, y: c.y - VIEW.h / z / 2 };
};

export interface Layout {
  s: number;
  x: number;
  y: number;
  w: number;
  h: number;
  bar: number;
}
export function layoutAt(L: number): Layout {
  const s = lerpNum(1.35, 1.0, L);
  const w = VIEW.w * s;
  const h = VIEW.h * s;
  const bar = 40;
  return { s, w, h, bar, x: lerpNum((1920 - w) / 2, 60, L), y: (1080 - (h + bar)) / 2 };
}
export function toScreen(p: Pt, cam: Cam, lay: Layout): Pt {
  return { x: lay.x + (p.x - cam.x) * cam.z * lay.s, y: lay.y + lay.bar + (p.y - cam.y) * cam.z * lay.s };
}
