import { describe, expect, test } from "vitest";

import type { AthleteRaceTiming } from "./raceSections";
import {
  liveTransitionElapsedSeconds,
  transitionDurationForStage,
  transitionTimeLabelForStage,
} from "./compactRaceProgressTiming";

describe("transitionDurationForStage", () => {
  const raceTiming: AthleteRaceTiming = {
    overallTimeSeconds: 9_000,
    warnings: [],
    sections: [
      {
        type: "transition",
        id: "provider-transition-1",
        title: "Transition 1",
        shortLabel: "T1",
        status: "completed",
        durationSeconds: 125,
        averageMetric: null,
        rows: [],
      },
      {
        type: "transition",
        id: "T2",
        title: "T2",
        shortLabel: "T2",
        status: "completed",
        durationSeconds: 180,
        averageMetric: null,
        rows: [],
      },
    ],
  };

  test("returns canonical T1 and T2 durations for the compact tracker", () => {
    expect(transitionDurationForStage(raceTiming, "T1")).toBe(125);
    expect(transitionDurationForStage(raceTiming, "T2")).toBe(180);
  });

  test("does not treat sport legs as transitions", () => {
    expect(transitionDurationForStage(raceTiming, "BIKE")).toBeNull();
  });

  test("returns a running elapsed time only for an active transition", () => {
    const active: AthleteRaceTiming = {
      overallTimeSeconds: 1_000,
      warnings: [],
      sections: [
        {
          type: "transition",
          id: "T1",
          title: "Transition 1",
          shortLabel: "T1",
          status: "in_progress",
          startedAt: "2026-10-19T12:00:00.000Z",
          durationSeconds: null,
          averageMetric: null,
          rows: [],
        },
      ],
    };
    expect(
      liveTransitionElapsedSeconds(
        active,
        "T1",
        Date.parse("2026-10-19T12:02:05.000Z"),
      ),
    ).toBe(125);
    active.sections[0].status = "completed";
    expect(
      liveTransitionElapsedSeconds(
        active,
        "T1",
        Date.parse("2026-10-19T12:02:05.000Z"),
      ),
    ).toBeNull();
  });

  test("falls back to transition order and row timing for generic provider labels", () => {
    const generic: AthleteRaceTiming = {
      overallTimeSeconds: null,
      warnings: [],
      sections: [
        {
          type: "transition",
          id: "changeover-a",
          title: "Changeover",
          status: "completed",
          durationSeconds: null,
          averageMetric: null,
          rows: [{
            key: "bike-start",
            name: "Bike Start",
            splitDurationSeconds: 91,
            legElapsedSeconds: 91,
            overallElapsedSeconds: 1_000,
            timeOfDay: null,
            metric: null,
            status: "valid",
          }],
        },
        {
          type: "transition",
          id: "changeover-b",
          title: "Changeover",
          status: "completed",
          durationSeconds: 73,
          averageMetric: null,
          rows: [],
        },
      ],
    };
    expect(transitionDurationForStage(generic, "T1")).toBe(91);
    expect(transitionDurationForStage(generic, "T2")).toBe(73);
  });

  test("reads Feibot transition segment time from the next sport boundary", () => {
    const timeline = [
      {
        segment: "BIKE",
        name: "BIKE START",
        splitLabel: "Bike Start",
        splitTimeLabel: "00:25:59",
        state: "completed",
      },
      {
        segment: "RUN",
        name: "RUN START",
        splitLabel: "Run Start",
        splitTimeLabel: "00:03:12",
        state: "completed",
      },
    ];
    expect(transitionTimeLabelForStage(timeline, "T1")).toBe("00:25:59");
    expect(transitionTimeLabelForStage(timeline, "T2")).toBe("00:03:12");
  });
});
