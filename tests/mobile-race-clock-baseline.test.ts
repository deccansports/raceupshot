import { describe, expect, it } from "vitest";

import { deriveRaceClockStartAt } from "../apps/mobile/src/features/tracking/timing/raceClockBaseline";

describe("mobile race-clock baseline recovery", () => {
  it("reconstructs START from an official split when START is absent", () => {
    const readAt = "2026-10-11T07:30:00.000Z";
    expect(
      deriveRaceClockStartAt([
        { readAt, elapsedSeconds: 5_400 },
      ]),
    ).toBe(Date.parse(readAt) - 5_400_000);
  });

  it("prefers the latest official split evidence", () => {
    const startAt = Date.parse("2026-10-11T06:00:00.000Z");
    expect(
      deriveRaceClockStartAt([
        { readAt: startAt + 600_000, elapsedSeconds: 600 },
        { readAt: startAt + 5_400_000, elapsedSeconds: 5_400 },
      ]),
    ).toBe(startAt);
  });
});
