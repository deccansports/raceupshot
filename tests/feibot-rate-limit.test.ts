import { describe, expect, test } from "vitest";
import { feibotAccessDeniedRetryAt, feibotCooldownUntil, feibotRetryDelayMilliseconds, isFeibotCooldownActive, parseRetryAfterMilliseconds } from "@/lib/feibot-rate-limit";

describe("Feibot rate-limit handling", () => {
  test("honours numeric and date Retry-After values", () => {
    const now = Date.parse("2026-08-28T10:00:00.000Z");
    expect(parseRetryAfterMilliseconds("17", now)).toBe(17_000);
    expect(parseRetryAfterMilliseconds("Fri, 28 Aug 2026 10:00:20 GMT", now)).toBe(20_000);
  });

  test("uses BERGMAN-compatible exponential retries before a bounded cooldown", () => {
    expect(feibotRetryDelayMilliseconds(1, null)).toBe(5_000);
    expect(feibotRetryDelayMilliseconds(2, null)).toBe(10_000);
    const retryAt = feibotCooldownUntil(0, null);
    expect(retryAt).toBe("1970-01-01T00:02:00.000Z");
    expect(isFeibotCooldownActive(retryAt, 1)).toBe(true);
    expect(isFeibotCooldownActive(retryAt, 120_000)).toBe(false);
  });

  test("backs off a provider-disabled optional feed for fifteen minutes", () => {
    const now = Date.parse("2026-10-11T00:00:00.000Z");
    const retryAt = feibotAccessDeniedRetryAt(now);
    expect(retryAt).toBe("2026-10-11T00:15:00.000Z");
    expect(isFeibotCooldownActive(retryAt, now + 14 * 60_000)).toBe(true);
    expect(isFeibotCooldownActive(retryAt, now + 15 * 60_000)).toBe(false);
  });
});
