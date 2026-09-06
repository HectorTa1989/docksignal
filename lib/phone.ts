/** E.164: leading +, country code 1-9, 7 to 15 digits total. Matches the CALL-E API pattern. */
export const E164_PATTERN = /^\+[1-9]\d{6,14}$/;

/**
 * Short emergency numbers (911, 112, 999, 000, 110, 119, ...) can never be valid E.164
 * because E.164 requires at least seven digits, but we reject them explicitly as well so
 * the policy is visible and testable: DockSignal never calls emergency services.
 */
const EMERGENCY_SUFFIXES = ["911", "112", "999", "000", "110", "119", "113", "115", "117", "118", "100", "101", "102", "108", "122", "123", "190", "192", "193", "194", "911911"];

export function isEmergencyNumber(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 6) return EMERGENCY_SUFFIXES.some((s) => digits.endsWith(s));
  // country code (1-3 digits) directly followed by a 3-digit emergency number
  return EMERGENCY_SUFFIXES.some((s) => s.length === 3 && new RegExp(`^\\d{1,3}${s}$`).test(digits));
}

export function normalizePhone(raw: string): string {
  const trimmed = raw.trim().replace(/[\s().-]/g, "");
  if (/^00\d+$/.test(trimmed)) return `+${trimmed.slice(2)}`;
  return trimmed;
}

export function validateE164(raw: string, label = "Phone"): string {
  const phone = normalizePhone(raw);
  if (!E164_PATTERN.test(phone)) throw new Error(`${label} must be in E.164 format, for example +6591234567`);
  if (isEmergencyNumber(phone)) throw new Error(`${label} looks like an emergency number. DockSignal never calls emergency services.`);
  return phone;
}

/** Mask everything but the country code hint and the last two digits for logs and summaries. */
export function maskPhone(phone: string): string {
  if (phone.length < 6) return "***";
  return `${phone.slice(0, 3)}${"*".repeat(Math.max(2, phone.length - 5))}${phone.slice(-2)}`;
}

/** Best-effort ISO 3166 region hint from the country calling code, used for CALL-E routing. */
export function regionFromPhone(phone: string): string {
  const table: Array<[string, string]> = [
    ["+1", "US"],
    ["+65", "SG"],
    ["+60", "MY"],
    ["+91", "IN"],
    ["+971", "AE"],
    ["+61", "AU"],
    ["+44", "GB"],
    ["+84", "VN"],
    ["+49", "DE"],
    ["+81", "JP"],
    ["+33", "FR"],
    ["+52", "MX"],
    ["+55", "BR"],
    ["+62", "ID"],
    ["+63", "PH"],
    ["+254", "KE"],
    ["+31", "NL"],
    ["+48", "PL"],
    ["+880", "BD"],
    ["+234", "NG"],
    ["+66", "TH"],
    ["+966", "SA"],
    ["+358", "FI"],
    ["+380", "UA"],
    ["+94", "LK"],
    ["+92", "PK"],
    ["+90", "TR"],
    ["+34", "ES"],
    ["+886", "TW"],
    ["+27", "ZA"],
    ["+20", "EG"],
    ["+233", "GH"],
    ["+972", "IL"],
    ["+353", "IE"],
  ];
  const sorted = table.sort((a, b) => b[0].length - a[0].length);
  return sorted.find(([prefix]) => phone.startsWith(prefix))?.[1] ?? "US";
}
