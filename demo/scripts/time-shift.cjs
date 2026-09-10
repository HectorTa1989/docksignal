/**
 * Capture-only preload. Shifts this process's wall clock so every timestamp DockSignal and
 * PGlite write reads like the scenario's afternoon in Singapore. The offset lives in
 * SIM_CLOCK_FILE ({"offsetMs": n}) and is re-read every 200 ms, so the capture can move the
 * scenario clock forward between steps. Without SIM_CLOCK_FILE this file does nothing.
 */
const fs = require("node:fs");

const file = process.env.SIM_CLOCK_FILE;
if (file && !globalThis.__docksignalTimeShift) {
  globalThis.__docksignalTimeShift = true;
  const RealDate = Date;
  let offset = 0;
  const read = () => {
    try {
      offset = Number(JSON.parse(fs.readFileSync(file, "utf8")).offsetMs) || 0;
    } catch {
      /* keep the last known offset */
    }
  };
  read();
  setInterval(read, 200).unref();

  function ShiftedDate(...args) {
    if (!new.target) return new RealDate(RealDate.now() + offset).toString();
    return args.length === 0 ? new RealDate(RealDate.now() + offset) : new RealDate(...args);
  }
  ShiftedDate.prototype = RealDate.prototype;
  Object.setPrototypeOf(ShiftedDate, RealDate);
  ShiftedDate.now = () => RealDate.now() + offset;
  ShiftedDate.parse = RealDate.parse;
  ShiftedDate.UTC = RealDate.UTC;
  globalThis.Date = ShiftedDate;
}
