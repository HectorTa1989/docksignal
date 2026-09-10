import React from "react";
import summary from "../public/summary.md";
import type { Tone } from "./storyboard";
import { C, FONT, MONO, TONE, hexA } from "./theme";

type Block =
  | { kind: "h1" | "h2" | "h3" | "p" | "li" | "li2"; text: string }
  | { kind: "table"; rows: string[][] };

function parse(md: string): Block[] {
  const blocks: Block[] = [];
  const lines = md.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (!line.trim()) continue;
    if (line.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.startsWith("|")) {
        const cells = lines[i]!.split("|").slice(1, -1).map((c) => c.trim());
        if (!cells.every((c) => /^-+$/.test(c))) rows.push(cells);
        i += 1;
      }
      i -= 1;
      blocks.push({ kind: "table", rows });
    } else if (line.startsWith("### ")) blocks.push({ kind: "h3", text: line.slice(4) });
    else if (line.startsWith("## ")) blocks.push({ kind: "h2", text: line.slice(3) });
    else if (line.startsWith("# ")) blocks.push({ kind: "h1", text: line.slice(2) });
    else if (line.startsWith("  - ")) blocks.push({ kind: "li2", text: line.slice(4) });
    else if (line.startsWith("- ")) blocks.push({ kind: "li", text: line.slice(2) });
    else blocks.push({ kind: "p", text: line });
  }
  return blocks;
}

const BLOCKS = parse(summary);
const indexOf = (pred: (b: Block) => boolean, from = 0) => {
  const i = BLOCKS.findIndex((b, k) => k >= from && pred(b));
  return i < 0 ? BLOCKS.length : i;
};
const textOf = (b: Block) => ("text" in b ? b.text : "");
// Page 1: header, recovery card and facts. Page 2: the approved follow-up call.
const P1 = BLOCKS.slice(0, indexOf((b) => b.kind === "h2" && b.text === "Recovery actions"));
const followStart = indexOf((b) => b.kind === "h3" && b.text.startsWith("Follow-up"));
const P2 = BLOCKS.slice(followStart, indexOf((b) => b.kind === "h2", followStart + 1));

const HIGHLIGHT: Array<[RegExp, Tone]> = [
  [/^\*\*Situation:\*\*/, "ok"],
  [/^Follow-up: .*\(\+\d+\*+\d+\)$/, "info"],
  [/^CALL-E call id:/, "signal"],
  [/^Human approval:/, "ok"],
  [/^revised_eta: 17:00/, "ok"],
  [/^blocker: Deliver through Dock 3/, "signal"],
];
const toneFor = (b: Block): Tone | null => HIGHLIGHT.find(([re]) => re.test(textOf(b)))?.[1] ?? null;

function inline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|_[^_]+_$)/g);
  return parts.map((p, i) =>
    p.startsWith("**") ? (
      <strong key={i} style={{ color: C.text }}>{p.slice(2, -2)}</strong>
    ) : p.startsWith("_") && p.endsWith("_") ? (
      <em key={i} style={{ color: C.muted }}>{p.slice(1, -1)}</em>
    ) : (
      <React.Fragment key={i}>{p}</React.Fragment>
    ),
  );
}

const BlockView: React.FC<{ b: Block; glow: number }> = ({ b, glow }) => {
  const tone = toneFor(b);
  const color = tone ? TONE[tone] : null;
  const hl: React.CSSProperties = color ? { outline: `2.5px solid ${hexA(color, glow)}`, outlineOffset: 3, borderRadius: 6, background: hexA(color, 0.08 * glow), boxShadow: `0 0 22px ${hexA(color, 0.35 * glow)}` } : {};
  if (b.kind === "table")
    return (
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, margin: "8px 0 12px" }}>
        <tbody>
          {b.rows.map((r, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${C.line}`, color: i === 0 ? C.muted : C.text, fontWeight: i === 0 ? 600 : 400 }}>
              {r.map((c, k) => (
                <td key={k} style={{ padding: "5px 8px", verticalAlign: "top", fontFamily: k === 3 ? MONO : FONT, fontSize: k === 3 ? 11.5 : 13, width: ["22%", "9%", "40%", "29%"][k] }}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  const style: Record<string, React.CSSProperties> = {
    h1: { fontSize: 30, fontWeight: 700, color: C.text, margin: "0 0 12px" },
    h2: { fontSize: 22, fontWeight: 700, color: C.text, margin: "18px 0 8px", paddingBottom: 6, borderBottom: `1px solid ${C.line}` },
    h3: { fontSize: 19, fontWeight: 700, color: C.text, margin: "4px 0 10px" },
    p: { fontSize: 15.5, color: hexA(C.text, 0.9), margin: "6px 0" },
    li: { fontSize: 15.5, color: hexA(C.text, 0.9), margin: "3px 0 3px 18px" },
    li2: { fontSize: 14.5, color: hexA(C.text, 0.8), margin: "2px 0 2px 42px", fontFamily: /^\[\d/.test(b.text) || /^[a-z_]+:/.test(b.text) ? MONO : FONT },
  };
  const bullet = b.kind === "li" || b.kind === "li2" ? <span style={{ color: C.muted, marginRight: 8 }}>•</span> : null;
  return (
    <div style={{ ...style[b.kind], ...hl }}>
      {bullet}
      {inline(b.text)}
    </div>
  );
};

export const DocOverlay: React.FC<{ start: number; end: number; frame: number }> = ({ start, end, frame }) => {
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  const inT = clamp01((frame - start) / 14);
  const outT = clamp01((end - frame) / 12);
  const vis = Math.min(inT, outT);
  const swap = start + Math.round((end - start) * 0.42);
  const s = clamp01((frame - swap) / 14);
  const glow1 = clamp01((frame - start - 18) / 10);
  const glow2 = clamp01((frame - swap - 16) / 10);
  return (
    <div style={{ position: "absolute", inset: 0, background: `rgba(4,8,16,${0.55 * vis})` }}>
      <div style={{ position: "absolute", left: 400, top: 96 + (1 - inT) * 40, width: 1120, height: 890, opacity: vis, borderRadius: 16, background: "#0f1829", border: `1px solid ${C.line}`, boxShadow: "0 40px 110px rgba(0,0,0,0.65)", overflow: "hidden", fontFamily: FONT }}>
        <div style={{ height: 52, display: "flex", alignItems: "center", gap: 14, padding: "0 22px", background: "#0c1424", borderBottom: `1px solid ${C.line}` }}>
          <svg width="22" height="26" viewBox="0 0 22 26">
            <path d="M3 1h11l6 6v17a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z" fill="none" stroke={C.muted} strokeWidth="1.6" />
            <path d="M14 1v6h6" fill="none" stroke={C.muted} strokeWidth="1.6" />
          </svg>
          <span style={{ color: C.text, fontSize: 18, fontWeight: 600, fontFamily: MONO }}>DS-1042-recovery-summary.md</span>
          <span style={{ marginLeft: "auto", color: C.muted, fontSize: 15 }}>Markdown · downloaded from DockSignal</span>
        </div>
        <div style={{ position: "absolute", top: 52, left: 0, right: 0, bottom: 0, padding: "22px 36px" }}>
          <div style={{ position: "absolute", inset: "22px 36px", opacity: 1 - s, transform: `translateY(${-s * 60}px)` }}>
            {P1.map((b, i) => (
              <BlockView key={i} b={b} glow={glow1} />
            ))}
          </div>
          <div style={{ position: "absolute", inset: "22px 36px", opacity: s, transform: `translateY(${(1 - s) * 60}px)` }}>
            {P2.map((b, i) => (
              <BlockView key={i} b={b} glow={glow2} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
