/**
 * Renders chosen frames as PNGs for review without rendering the whole video.
 *
 *   npx tsx scripts/stills.ts 30 420 1100      # frames, written to the OS temp dir
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";

const demo = path.resolve(import.meta.dirname, "..");
const out = path.join(os.tmpdir(), "docksignal-stills");
fs.mkdirSync(out, { recursive: true });
const frames = process.argv.slice(2).map(Number).filter(Number.isFinite);

const serveUrl = await bundle({
  entryPoint: path.join(demo, "src", "index.ts"),
  publicDir: path.join(demo, "public"),
  webpackOverride: (config) => ({
    ...config,
    module: { ...config.module, rules: [...(config.module?.rules ?? []), { test: /\.md$/, type: "asset/source" }] },
  }),
});
const composition = await selectComposition({ serveUrl, id: "DockSignalDemo" });
console.log(`composition ${composition.durationInFrames} frames at ${composition.fps} fps`);
for (const frame of frames) {
  const file = path.join(out, `frame-${String(frame).padStart(5, "0")}.png`);
  await renderStill({ composition, serveUrl, output: file, frame, imageFormat: "png" });
  console.log(file);
}
