import { describe, expect, it } from "vitest";

import { isLiveTimingAwaitingCutoffUpdate } from "../apps/mobile/src/features/tracking/timing/cutoffTiming";

const raceStartedAt = Date.parse("2026-10-11T06:00:00.000Z");

describe("mobile cutoff timing gate", () => {
  it("hides timing after the overall cutoff until official state updates", () => {
    expect(
      isLiveTimingAwaitingCutoffUpdate({
        detail: {
          header: { status: "live" },
          raceStartedAt,
          raceProgress: { legLabel: "Run" },
        },
        cutoffs: { overall: "01:00:00" },
        nowMs: raceStartedAt + 3_601_000,
      }),
    ).toBe(true);
  });

  it("hides timing after a cumulative active-leg cutoff", () => {
    expect(
      isLiveTimingAwaitingCutoffUpdate({
        detail: {
          header: { status: "live" },
          raceStartedAt,
          raceProgress: { legLabel: "Bike" },
        },
        cutoffs: { mode: "cumulative", bike: "00:45:00" },
        nowMs: raceStartedAt + 2_701_000,
      }),
    ).toBe(true);
  });

  it("accepts the human-readable cutoff format used by event settings", () => {
    expect(
      isLiveTimingAwaitingCutoffUpdate({
        detail: {
          header: { status: "live" },
          raceStartedAt,
          raceProgress: { legLabel: "Swim" },
        },
        cutoffs: { swim: "30m cutoff" },
        nowMs: raceStartedAt + 1_801_000,
      }),
    ).toBe(true);
  });

  it("uses the official leg-start split for a leg-relative cutoff", () => {
    const detail = {
      header: { status: "live" },
      raceStartedAt,
      raceProgress: { legLabel: "Bike" },
      timeline: [
        {
          name: "Bike Start",
          elapsedTimeLabel: "00:20:00",
        },
      ],
    };

    expect(
      isLiveTimingAwaitingCutoffUpdate({
        detail,
        cutoffs: { mode: "leg", bike: "00:30:00" },
        nowMs: raceStartedAt + 3_001_000,
      }),
    ).toBe(true);
    expect(
      isLiveTimingAwaitingCutoffUpdate({
        detail,
        cutoffs: { mode: "leg", bike: "00:30:00" },
        nowMs: raceStartedAt + 2_999_000,
      }),
    ).toBe(false);
  });

  it("restores timing when an official update changes the active leg", () => {
    expect(
      isLiveTimingAwaitingCutoffUpdate({
        detail: {
          header: { status: "live" },
          raceStartedAt,
          raceProgress: { legLabel: "Run" },
        },
        cutoffs: { mode: "cumulative", bike: "00:45:00", run: "02:00:00" },
        nowMs: raceStartedAt + 2_701_000,
      }),
    ).toBe(false);
  });

  it("never suppresses a published finished result", () => {
    expect(
      isLiveTimingAwaitingCutoffUpdate({
        detail: {
          header: { status: "finished" },
          raceStartedAt,
          raceProgress: { legLabel: "Run" },
        },
        cutoffs: { overall: "01:00:00" },
        nowMs: raceStartedAt + 7_200_000,
      }),
    ).toBe(false);
  });
});
