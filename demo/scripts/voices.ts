/**
 * Synthesizes every call line with Kokoro-82M (local, open-weight neural TTS) and the UI and
 * phone sound effects with ffmpeg. Output: public/audio/*.wav and public/audio/manifest.json.
 *
 *   npm run voices
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { KokoroTTS } from "kokoro-js";
import { BOT_VOICE, CALLS, type CallKey } from "../src/dialogue";
import type { VoiceManifest } from "../src/callLayout";

const root = path.resolve(import.meta.dirname, "..");
const outDir = path.join(root, "public", "audio");
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docksignal-voices-"));
fs.mkdirSync(outDir, { recursive: true });

const TRIM = "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.04,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.06,areverse";
// The assistant sounds like the platform side of the call; the contact sounds like a phone line.
const BOT_CHAIN = `${TRIM},atempo=1.07,highpass=f=80,lowpass=f=11000,acompressor=threshold=-18dB:ratio=2.2:attack=5:release=120:makeup=1.5,loudnorm=I=-17:TP=-1.5:LRA=9,aresample=48000`;
const CONTACT_CHAIN = `${TRIM},atempo=1.07,highpass=f=200,lowpass=f=4200,equalizer=f=1900:t=q:w=1.2:g=2.5,acompressor=threshold=-20dB:ratio=2.8:attack=5:release=120:makeup=1.5,loudnorm=I=-18:TP=-1.5:LRA=9,aresample=48000`;

function ffmpeg(args: string[]) {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
}

function duration(file: string): number {
  const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]).toString().trim();
  return Math.round(Number(out) * 1000) / 1000;
}

async function main() {
  console.log("Loading Kokoro-82M (first run downloads the model)...");
  const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "fp32", device: "cpu" });

  const manifest: VoiceManifest = { calls: { driver: [], dock: [], followup: [] }, sfx: {} as VoiceManifest["sfx"] };
  for (const key of Object.keys(CALLS) as CallKey[]) {
    const script = CALLS[key];
    for (const [i, line] of script.lines.entries()) {
      const voice = line.who === "bot" ? BOT_VOICE : script.contactVoice;
      const raw = path.join(tmpDir, `${key}-${i}.raw.wav`);
      const audio = await tts.generate(line.say, { voice: voice as never, speed: line.who === "bot" ? 1.06 : 1.0 });
      await audio.save(raw);
      const file = `${key}-${String(i).padStart(2, "0")}.wav`;
      ffmpeg(["-i", raw, "-af", line.who === "bot" ? BOT_CHAIN : CONTACT_CHAIN, "-ac", "1", "-c:a", "pcm_s16le", path.join(outDir, file)]);
      const d = duration(path.join(outDir, file));
      manifest.calls[key].push({ file: `audio/${file}`, duration: d, who: line.who });
      console.log(`${key} #${i} ${line.who.padEnd(4)} ${voice.padEnd(10)} ${d.toFixed(2)}s  ${line.text.slice(0, 70)}`);
    }
  }

  const sfx: Record<keyof VoiceManifest["sfx"], string[]> = {
    // North American ringback (440 + 480 Hz), band-limited like a phone line.
    ring: ["-f", "lavfi", "-i", "aevalsrc='0.22*(sin(2*PI*440*t)+sin(2*PI*480*t))':s=48000:d=1.35", "-af", "afade=t=in:d=0.03,afade=t=out:st=1.27:d=0.08,highpass=f=300,lowpass=f=3400"],
    pickup: ["-f", "lavfi", "-i", "anoisesrc=d=0.07:c=brown:a=0.5:r=48000", "-af", "highpass=f=500,lowpass=f=4000,afade=t=in:d=0.004,afade=t=out:st=0.012:d=0.058,volume=0.8"],
    hangup: ["-f", "lavfi", "-i", "aevalsrc='0.16*sin(2*PI*620*t)*lt(mod(t\\,0.22)\\,0.11)':s=48000:d=0.55", "-af", "highpass=f=300,lowpass=f=3400,afade=t=out:st=0.5:d=0.05"],
    click: ["-f", "lavfi", "-i", "aevalsrc='0.55*sin(2*PI*1650*t)*exp(-t*190)+0.25*sin(2*PI*3300*t)*exp(-t*320)':s=48000:d=0.07", "-af", "highpass=f=400"],
    key: ["-f", "lavfi", "-i", "aevalsrc='0.22*sin(2*PI*2600*t)*exp(-t*420)':s=48000:d=0.035", "-af", "highpass=f=600"],
  };
  for (const [name, args] of Object.entries(sfx) as Array<[keyof VoiceManifest["sfx"], string[]]>) {
    const file = path.join(outDir, `sfx-${name}.wav`);
    ffmpeg([...args, "-ac", "1", "-c:a", "pcm_s16le", file]);
    manifest.sfx[name] = { file: `audio/sfx-${name}.wav`, duration: duration(file) };
  }

  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  fs.rmSync(tmpDir, { recursive: true, force: true });
  const total = Object.values(manifest.calls).flat().reduce((s, l) => s + l.duration, 0);
  console.log(`Wrote ${Object.values(manifest.calls).flat().length} lines (${total.toFixed(1)}s of speech) and ${Object.keys(sfx).length} effects to ${outDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
