import { describe, expect, it } from "vitest";

import { resolveStartTimingPresentation } from "../apps/mobile/src/features/tracking/timing/startTimingPresentation";

describe("mobile elapsed-time start selection", () => {
  it("uses the contest gun instead of a later athlete START read in GUN mode", () => {
    const gunStartAt = "2026-08-10T13:30:00+05:30";
    const timing = resolveStartTimingPresentation({
      officialTimingMode: "GUN",
      status: "ON_COURSE",
      gunStartAt,
      officialStartAt: "2026-08-10T13:37:24+05:30",
      hasAcceptedStart: true,
      eventTimezone: "Asia/Kolkata",
    });

    expect(timing.officialStartAt).toBe(Date.parse(gunStartAt));
    expect(timing.showRaceClock).toBe(true);
  });

  it("continues to use the athlete START read in CHIP mode", () => {
    const chipStartAt = "2026-08-10T13:37:24+05:30";
    const timing = resolveStartTimingPresentation({
      officialTimingMode: "CHIP",
      status: "ON_COURSE",
      gunStartAt: "2026-08-10T13:30:00+05:30",
      chipStartAt,
      hasAcceptedStart: true,
    });

    expect(timing.officialStartAt).toBe(Date.parse(chipStartAt));
  });
});
