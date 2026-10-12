import { describe, expect, it } from "vitest";
import { canReserveResultNotificationClaim } from "../lib/result-notification-claim";

describe("result notification claim decisions", () => {
  it("reserves the first send", () => {
    expect(canReserveResultNotificationClaim(undefined)).toBe(true);
  });

  it("never duplicates an in-flight send", () => {
    expect(canReserveResultNotificationClaim("SENDING", true, true)).toBe(false);
  });

  it("keeps accepted sends protected from normal and failed-only retries", () => {
    expect(canReserveResultNotificationClaim("ACCEPTED")).toBe(false);
    expect(canReserveResultNotificationClaim("ACCEPTED", true)).toBe(false);
  });

  it("allows only explicit force resend for an accepted send", () => {
    expect(canReserveResultNotificationClaim("ACCEPTED", true, true)).toBe(true);
  });

  it("allows failed-only retry without enabling accepted resend", () => {
    expect(canReserveResultNotificationClaim("FAILED", true)).toBe(true);
    expect(canReserveResultNotificationClaim("FAILED")).toBe(false);
  });
});
