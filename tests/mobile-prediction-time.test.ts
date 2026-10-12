import { describe, expect, it } from "vitest";

import {
  predictionElapsedBaseline,
  resolvePredictionTimeLabels,
} from "../apps/mobile/src/features/tracking/timing/predictionPresentation";

describe("mobile prediction time presentation", () => {
  it("treats a duration-shaped etaClock as projected race time", () => {
    expect(resolvePredictionTimeLabels({ etaClock: "00:14:17" })).toEqual({
      etaClock: undefined,
      etaElapsed: "00:14:17",
    });
  });

  it("keeps a genuine event-local time under Expected at", () => {
    expect(
      resolvePredictionTimeLabels({
        etaClock: "9:14:17 AM",
        etaElapsed: "00:14:17",
      }),
    ).toEqual({
      etaClock: "9:14:17 AM",
      etaElapsed: "00:14:17",
    });
  });

  it("does not expose an unformatted timestamp in the prediction card", () => {
    expect(
      resolvePredictionTimeLabels({ etaClock: "2026-10-11T09:14:17+05:30" }),
    ).toEqual({ etaClock: undefined, etaElapsed: undefined });
  });

  it("never derives a prediction from an elapsed time older than the live clock", () => {
    const raceStartedAt = Date.parse("2026-10-11T06:00:00.000Z");
    expect(
      predictionElapsedBaseline({
        officialElapsedSeconds: 600,
        raceStartedAt,
        nowMs: raceStartedAt + 900_000,
      }),
    ).toBe(900);
  });
});
