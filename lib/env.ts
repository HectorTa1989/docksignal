export const CALLE_DEFAULT_BASE_URL = "https://api.heycall-e.com";

/**
 * The bearer key may only ever be sent to CALL-E's own HTTPS origin. An override is accepted
 * only for an https heycall-e.com host with no credentials, port, path, query, or fragment.
 */
export function pinnedCalleOrigin(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return CALLE_DEFAULT_BASE_URL;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const official = host === "heycall-e.com" || host.endsWith(".heycall-e.com");
  const bare = !url.username && !url.password && !url.port && (url.pathname === "/" || url.pathname === "") && !url.search && !url.hash;
  return url.protocol === "https:" && official && bare ? url.origin : null;
}

export type CalleConfig =
  | { ok: true; apiKey: string; baseUrl: string; webhookUrl: string; publicBaseUrl: string }
  | { ok: false; reason: string; missing: string[] };

/**
 * Server-only CALL-E configuration. The API key never leaves the server; the
 * browser only ever learns whether calling is possible, never why in secret terms.
 */
export function calleConfig(): CalleConfig {
  const apiKey = process.env.CALLE_API_KEY?.trim() ?? "";
  // On Vercel, default to the project's production domain so the first deploy needs no URL.
  const vercelDomain = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const publicBaseUrl = (process.env.PUBLIC_BASE_URL?.trim() || (vercelDomain ? `https://${vercelDomain}` : "")).replace(/\/+$/, "");
  const baseUrl = pinnedCalleOrigin(process.env.CALLE_BASE_URL);
  const missing: string[] = [];
  if (!apiKey) missing.push("CALLE_API_KEY");
  if (!baseUrl) missing.push("CALLE_BASE_URL (must be an https://*.heycall-e.com origin)");
  if (!publicBaseUrl) missing.push("PUBLIC_BASE_URL");
  else if (!/^https:\/\//.test(publicBaseUrl)) missing.push("PUBLIC_BASE_URL (must be https://)");
  if (missing.length || !baseUrl) {
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
