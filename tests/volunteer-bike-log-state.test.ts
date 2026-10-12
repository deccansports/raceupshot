import { describe, expect, it } from "vitest";
import { bikeOperationResetIds, type BikeOperationAuditRow } from "../lib/volunteer-bike-log-state";

function row(id: string, action: string, capturedAt: string, participantUid = "athlete-1"): BikeOperationAuditRow {
  return { id, action, capturedAt, participantUid, eventId: "event-1" };
}

describe("bike operation log reset state", () => {
  it("marks bike-in and bike-out records covered by an admin reset", () => {
    const resetIds = bikeOperationResetIds([
      row("bike-in", "BIKE_IN", "2026-10-08T10:00:00.000Z"),
      row("bike-out", "BIKE_OUT", "2026-10-08T16:00:00.000Z"),
      row("reset", "ADMIN_BIKE_CHECK_IN_RESET", "2026-10-08T17:00:00.000Z"),
    ]);

    expect([...resetIds]).toEqual(["bike-in", "bike-out"]);
  });

  it("keeps a new bike lifecycle after the reset active", () => {
    const resetIds = bikeOperationResetIds([
      row("old-bike-in", "BIKE_IN", "2026-10-08T10:00:00.000Z"),
      row("reset", "ADMIN_BIKE_CHECK_IN_RESET", "2026-10-08T17:00:00.000Z"),
      row("new-bike-in", "BIKE_IN", "2026-10-09T10:00:00.000Z"),
      row("other-athlete", "BIKE_IN", "2026-10-08T10:00:00.000Z", "athlete-2"),
    ]);

    expect(resetIds.has("old-bike-in")).toBe(true);
    expect(resetIds.has("new-bike-in")).toBe(false);
    expect(resetIds.has("other-athlete")).toBe(false);
  });
});
