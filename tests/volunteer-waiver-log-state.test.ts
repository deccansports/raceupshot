import { describe, expect, it } from "vitest";
import { waiverOperationResetIds } from "../lib/volunteer-waiver-log-state";

describe("waiver operation reset state", () => {
  it("marks verifications before an admin reset or legacy recall", () => {
    const base = { eventId: "event-1", participantUid: "athlete-1" };
    expect([...waiverOperationResetIds([
      { ...base, id: "verify-1", action: "WAIVER_VERIFY", capturedAt: "2026-10-09T10:00:00Z" },
      { ...base, id: "recall", action: "CHECK_IN_REVERSE", capturedAt: "2026-10-09T10:05:00Z" },
      { ...base, id: "verify-2", action: "WAIVER_VERIFY", capturedAt: "2026-10-09T10:10:00Z" },
    ])]).toEqual(["verify-1"]);
  });
});
