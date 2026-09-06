/**
 * Small timezone helpers built on Intl so the app has no date library dependency.
 * All persisted timestamps are ISO-8601 UTC strings.
 */

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string) {
  let formatter = partsFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    partsFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock components of an instant in a timezone. */
export function wallClock(date: Date, timeZone: string) {
  const parts = partsFormatter(timeZone).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") === 24 ? 0 : get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** Offset (ms) of a timezone at a given instant: local wall clock minus UTC. */
function offsetMs(date: Date, timeZone: string): number {
  const wc = wallClock(date, timeZone);
  const asUtc = Date.UTC(wc.year, wc.month - 1, wc.day, wc.hour, wc.minute, wc.second);
  return asUtc - date.getTime();
}

/**
 * Convert a local wall-clock time (e.g. "2026-09-08T14:00" from a datetime-local input)
 * in the given IANA timezone to a UTC Date. Handles DST by iterating the offset once.
 */
export function zonedToUtc(localIso: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(localIso.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const naive = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? "0"));
  let guess = naive - offsetMs(new Date(naive), timeZone);
  guess = naive - offsetMs(new Date(guess), timeZone);
  const result = new Date(guess);
  return Number.isNaN(result.getTime()) ? null : result;
}

export function formatInTz(iso: string | Date | null | undefined, timeZone: string): string {
  if (!iso) return "";
  const date = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).format(date);
}

export function formatClockInTz(iso: string | Date | null | undefined, timeZone: string): string {
  if (!iso) return "";
  const date = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export interface ClockTime {
  hour: number;
  minute: number;
}

/**
 * Parse an explicit clock time such as "15:40", "3:40 pm", "3pm", "15h40", or an ISO timestamp.
 * Returns null for vague phrases ("later this afternoon", "about an hour") on purpose:
 * DockSignal never infers an exact ETA from vague speech.
 */
export function parseClockTime(text: string): ClockTime | { iso: string } | null {
  const raw = text.trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) {
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) return { iso: date.toISOString() };
    return null;
  }
  const m = /^(?:(?:at|around|by|approximately|approx\.?)\s+)?(\d{1,2})(?:[:h.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\s*(?:[a-z]{2,5}t)?\.?$/i.exec(
    raw,
  );
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2] ?? "0");
  const meridiem = m[3]?.toLowerCase().replace(/\./g, "");
  if (Number.isNaN(hour) || Number.isNaN(minute) || minute > 59) return null;
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (!meridiem && m[2] === undefined) return null; // bare "3" is too ambiguous
  if (hour > 23) return null;
  return { hour, minute };
}

/**
 * Resolve a clock time to an instant on the same local day as `referenceIso` in `timeZone`.
 * If the clock time is earlier than the reference by more than 12h, assume it refers to the next day.
 */
export function resolveClockOnDay(
  clock: ClockTime | { iso: string },
  referenceIso: string,
  timeZone: string,
): Date | null {
  if ("iso" in clock) return new Date(clock.iso);
  const reference = new Date(referenceIso);
  if (Number.isNaN(reference.getTime())) return null;
  const wc = wallClock(reference, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  const local = `${wc.year}-${pad(wc.month)}-${pad(wc.day)}T${pad(clock.hour)}:${pad(clock.minute)}`;
  const candidate = zonedToUtc(local, timeZone);
  if (!candidate) return null;
  if (candidate.getTime() < reference.getTime() - 12 * 3600 * 1000) {
    return new Date(candidate.getTime() + 24 * 3600 * 1000);
  }
  return candidate;
}

export function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60000);
}

export const nowIso = () => new Date().toISOString();
