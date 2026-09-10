import { describe, expect, it } from "vitest";
import { buildRecipientResultSchema, isUnresolved, validateRecipientResult } from "@/lib/result-schema";
import { isEmergencyNumber, maskPhone, validateE164 } from "@/lib/phone";
import { parseClockTime, resolveClockOnDay, zonedToUtc } from "@/lib/time";
import { mapProviderStatus } from "@/lib/status";
import { calleConfig, pinnedCalleOrigin } from "@/lib/env";
import { providerCall, sampleResult } from "./helpers";

describe("recipient result contract", () => {
  it("sends the exact required field list and enums to CALL-E", () => {
    const schema = buildRecipientResultSchema("fact_finding", "driver");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["contact_role", "reached", "shipment_recognized", "current_status", "revised_eta", "can_accept", "blocker", "next_action", "certainty"]);
    expect(schema.properties.can_accept.enum).toEqual(["yes", "no", "conditional", "unknown"]);
    expect(schema.properties.certainty.enum).toEqual(["high", "medium", "low", "unknown"]);
    // no unsupported JSON Schema features
    expect(JSON.stringify(schema)).not.toMatch(/\$ref|oneOf|anyOf|allOf/);
  });

  it("rejects extra or missing fields instead of accepting a loose payload", () => {
    expect(() => validateRecipientResult({ ...sampleResult(), invented: "x" })).toThrow(/contract/);
    const { certainty: _omit, ...missing } = sampleResult();
    expect(() => validateRecipientResult(missing)).toThrow(/certainty/);
    expect(() => validateRecipientResult({ ...sampleResult(), reached: "maybe" })).toThrow(/reached/);
  });

  it("treats empty strings and unknown as unresolved", () => {
    expect(isUnresolved("")).toBe(true);
    expect(isUnresolved("  ")).toBe(true);
    expect(isUnresolved("unknown")).toBe(true);
    expect(isUnresolved("Unknown")).toBe(true);
    expect(isUnresolved("16:40")).toBe(false);
  });

  it("maps a completed call without a schema-valid result to result_validation_failed", () => {
    expect(mapProviderStatus(providerCall({ status: "completed", result: null }))).toBe("result_validation_failed");
    expect(mapProviderStatus(providerCall({ status: "completed", result: sampleResult() }), "call.result_validation_failed")).toBe("result_validation_failed");
    expect(mapProviderStatus(providerCall({ status: "completed", result: sampleResult() }))).toBe("completed");
    expect(mapProviderStatus(providerCall({ status: "failed" }))).toBe("failed");
    expect(mapProviderStatus(providerCall({ status: "canceled" }))).toBe("canceled");
    expect(mapProviderStatus(providerCall({ status: "in_progress" }))).toBe("in_progress");
  });
});

describe("phone policy", () => {
  it("accepts E.164 and normalises common formatting", () => {
    expect(validateE164(" +1 202 555 0123 ")).toBe("+12025550123");
    expect(validateE164("0012025550123")).toBe("+12025550123");
    expect(() => validateE164("2025550123")).toThrow(/E\.164/);
    expect(() => validateE164("+0123456789")).toThrow(/E\.164/);
  });
  it("never calls emergency services", () => {
    expect(isEmergencyNumber("911")).toBe(true);
    expect(isEmergencyNumber("+1911")).toBe(true);
    expect(isEmergencyNumber("+65999")).toBe(true);
    expect(isEmergencyNumber("+12025550123")).toBe(false);
    expect(() => validateE164("+65999")).toThrow();
  });
  it("masks numbers for logs and summaries", () => {
    expect(maskPhone("+12025550123")).toBe("+12*******23");
  });
});

describe("time helpers", () => {
  it("parses explicit clock times only", () => {
    expect(parseClockTime("16:40")).toEqual({ hour: 16, minute: 40 });
    expect(parseClockTime("4:40 pm")).toEqual({ hour: 16, minute: 40 });
    expect(parseClockTime("4pm")).toEqual({ hour: 16, minute: 0 });
    expect(parseClockTime("12:05 am")).toEqual({ hour: 0, minute: 5 });
    expect(parseClockTime("around 5:30 PM")).toEqual({ hour: 17, minute: 30 });
    expect(parseClockTime("later this afternoon")).toBeNull();
    expect(parseClockTime("about an hour")).toBeNull();
    expect(parseClockTime("3")).toBeNull();
    expect(parseClockTime("")).toBeNull();
    expect(parseClockTime("2026-09-08T09:15:00Z")).toEqual({ iso: "2026-09-08T09:15:00.000Z" });
  });
  it("converts local wall-clock time to UTC in a timezone", () => {
    expect(zonedToUtc("2026-09-08T14:00", "Asia/Singapore")?.toISOString()).toBe("2026-09-08T06:00:00.000Z");
    expect(zonedToUtc("2026-09-08T14:00", "America/Los_Angeles")?.toISOString()).toBe("2026-09-08T21:00:00.000Z");
    expect(zonedToUtc("garbage", "Asia/Singapore")).toBeNull();
  });
  it("resolves a clock time on the promised day and rolls past midnight forward", () => {
    const eta = resolveClockOnDay({ hour: 16, minute: 40 }, "2026-09-08T06:00:00.000Z", "Asia/Singapore");
    expect(eta?.toISOString()).toBe("2026-09-08T08:40:00.000Z");
    const nextDay = resolveClockOnDay({ hour: 1, minute: 0 }, "2026-09-08T14:00:00.000Z", "Asia/Singapore"); // reference 22:00 SGT
    expect(nextDay?.toISOString()).toBe("2026-09-08T17:00:00.000Z");
  });
});

describe("CALL-E credential origin", () => {
  it("only sends the bearer key to an https heycall-e.com origin", () => {
    expect(pinnedCalleOrigin(undefined)).toBe("https://api.heycall-e.com");
    expect(pinnedCalleOrigin("https://api.heycall-e.com/")).toBe("https://api.heycall-e.com");
    expect(pinnedCalleOrigin("http://api.heycall-e.com")).toBeNull();
    expect(pinnedCalleOrigin("https://api.heycall-e.com.evil.example")).toBeNull();
    expect(pinnedCalleOrigin("https://evilheycall-e.com")).toBeNull();
    expect(pinnedCalleOrigin("https://user:pw@api.heycall-e.com")).toBeNull();
    expect(pinnedCalleOrigin("https://api.heycall-e.com:8443")).toBeNull();
    expect(pinnedCalleOrigin("https://api.heycall-e.com/v1")).toBeNull();
  });
  it("blocks calling when the override points anywhere else", () => {
    const saved = { ...process.env };
    try {
      process.env.CALLE_API_KEY = "iams_live_test";
      process.env.PUBLIC_BASE_URL = "https://docksignal.example.com";
      process.env.CALLE_BASE_URL = "https://attacker.example.com";
      const config = calleConfig();
      expect(config.ok).toBe(false);
      if (!config.ok) expect(config.missing.join(" ")).toMatch(/CALLE_BASE_URL/);
      process.env.CALLE_BASE_URL = "";
      expect(calleConfig()).toMatchObject({ ok: true, baseUrl: "https://api.heycall-e.com" });
    } finally {
      process.env = saved;
    }
  });
});
