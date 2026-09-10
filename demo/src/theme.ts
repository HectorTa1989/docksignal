import type { Tone } from "./storyboard";

export const C = {
  ink: "#0b1220",
  panel: "#111a2c",
  panel2: "#16223a",
  line: "#24324d",
  muted: "#8ea0bf",
  text: "#e6ecf7",
  signal: "#f5b83d",
  ok: "#3ddc97",
  bad: "#ff6b6b",
  info: "#6ea8ff",
};

export const TONE: Record<Tone, string> = { ok: C.ok, bad: C.bad, info: C.info, signal: C.signal };

export const FONT = '"Segoe UI", "Segoe UI Variable", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif';
export const MONO = 'Consolas, "Cascadia Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

export const hexA = (hex: string, alpha: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};
