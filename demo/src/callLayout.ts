import type { CallKey, Line } from "./dialogue";

/** Written by scripts/voices.ts; one entry per spoken line, in script order. */
export interface VoiceManifest {
  calls: Record<CallKey, Array<{ file: string; duration: number; who: Line["who"] }>>;
  sfx: Record<"ring" | "pickup" | "hangup" | "click" | "key", { file: string; duration: number }>;
}

export interface CallTimeline {
  ringAt: number;
  pickupAt: number;
  lines: Array<{ who: Line["who"]; file: string; start: number; duration: number }>;
  hangupAt: number;
  total: number;
}

const RING_SECONDS = 1.35;
const FIRST_LINE_DELAY = 0.35;
const DEFAULT_GAP = 0.32;
const AFTER_LAST_LINE = 0.4;
const ENDED_HOLD = 0.55;

/** Seconds, relative to the start of the call segment. Shared by the capture (transcript offsets) and the video. */
export function layoutCall(manifest: VoiceManifest, key: CallKey, lines: Line[]): CallTimeline {
  const voiced = manifest.calls[key];
  if (!voiced || voiced.length !== lines.length) throw new Error(`Voice manifest for ${key} does not match the script; run npm run voices`);
  const ringAt = 0.2;
  const pickupAt = ringAt + RING_SECONDS + 0.25;
  let cursor = pickupAt + FIRST_LINE_DELAY;
  const out: CallTimeline["lines"] = [];
  lines.forEach((line, i) => {
    if (i > 0) cursor += line.gap ?? DEFAULT_GAP;
    const v = voiced[i]!;
    out.push({ who: line.who, file: v.file, start: cursor, duration: v.duration });
    cursor += v.duration;
  });
  const hangupAt = cursor + AFTER_LAST_LINE;
  return { ringAt, pickupAt, lines: out, hangupAt, total: hangupAt + ENDED_HOLD };
}

/** Transcript turns in CALL-E's shape, offsets measured from the moment the contact picked up. */
export function transcriptTurns(timeline: CallTimeline, lines: Line[]) {
  return timeline.lines.map((l, i) => ({
    offset_seconds: Math.round((l.start - timeline.pickupAt) * 10) / 10,
    speaker: lines[i]!.who,
    text: lines[i]!.text,
  }));
}
