export const CALLE_DEFAULT_BASE_URL = "https://api.heycall-e.com";

export type CalleConfig =
  | { ok: true; apiKey: string; baseUrl: string; webhookUrl: string; publicBaseUrl: string }
  | { ok: false; reason: string; missing: string[] };

/**
 * Server-only CALL-E configuration. The API key never leaves the server; the
 * browser only ever learns whether calling is possible, never why in secret terms.
 */
export function calleConfig(): CalleConfig {
  const apiKey = process.env.CALLE_API_KEY?.trim() ?? "";
  const publicBaseUrl = (process.env.PUBLIC_BASE_URL?.trim() ?? "").replace(/\/+$/, "");
  const baseUrl = (process.env.CALLE_BASE_URL?.trim() || CALLE_DEFAULT_BASE_URL).replace(/\/+$/, "");
  const missing: string[] = [];
  if (!apiKey) missing.push("CALLE_API_KEY");
  if (!publicBaseUrl) missing.push("PUBLIC_BASE_URL");
  else if (!/^https:\/\//.test(publicBaseUrl)) missing.push("PUBLIC_BASE_URL (must be https://)");
  if (missing.length) {
    return {
      ok: false,
      missing,
      reason: `CALL-E calling is blocked. Missing or invalid: ${missing.join(", ")}.`,
    };
  }
  return { ok: true, apiKey, baseUrl, publicBaseUrl, webhookUrl: `${publicBaseUrl}/api/webhooks/calle` };
}

export function orgName(): string {
  return process.env.DOCKSIGNAL_ORG_NAME?.trim() || "Northwind Freight Operations";
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}
