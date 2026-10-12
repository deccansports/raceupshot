import { describe, expect, it } from "vitest";

import { formatCutoffDuration, parseCutoffDuration } from "@/lib/cutoff-duration";

describe("cutoff duration fields", () => {
  it("accepts BERGMAN-style cumulative race times", () => {
    expect(parseCutoffDuration("01:30")).toBe(5_400);
    expect(parseCutoffDuration("06:15:30")).toBe(22_530);
    expect(formatCutoffDuration(22_530)).toBe("06:15:30");
  });

  it("rejects malformed or out-of-range cutoff times", () => {
    expect(parseCutoffDuration("1:75:00")).toBeNull();
    expect(parseCutoffDuration("cutoff")).toBeNull();
    expect(parseCutoffDuration("168:00:01")).toBeNull();
  });
});
