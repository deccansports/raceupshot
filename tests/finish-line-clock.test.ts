import { describe, expect, it } from "vitest";
import { finishLineClockWindow, maximumFinishCutoffSeconds } from "@/lib/finish-line-clock";

describe("finishLineClockWindow", () => {
  it("stops one hour after the last official result duration", () => {
    expect(finishLineClockWindow({
      startsAt: "2026-10-04T01:15:00.000Z",
      maxFinishSeconds: 28_698,
      eventStatus: "official",
    })).toEqual({
      endsAt: "2026-10-04T09:13:18.000Z",
      stopsAt: "2026-10-04T10:13:18.000Z",
    });
  });

  it("prefers an explicitly configured event end", () => {
    expect(finishLineClockWindow({
      startsAt: "2026-10-04T01:15:00.000Z",
      eventEndAt: "2026-10-04T10:00:00.000Z",
      maxFinishSeconds: 20_000,
      eventStatus: "official",
    }).stopsAt).toBe("2026-10-04T11:00:00.000Z");
  });

  it("does not invent an end for a live event without end evidence", () => {
    expect(finishLineClockWindow({ startsAt: "2026-10-04T01:15:00.000Z", eventStatus: "live" })).toEqual({});
  });

  it("can stop exactly at a two-hour event end", () => {
    expect(finishLineClockWindow({
      startsAt: "2026-10-10T17:55:30.000Z",
      eventEndAt: "2026-10-10T19:55:30.000Z",
      eventStatus: "live",
      stopDelaySeconds: 0,
    })).toEqual({
      endsAt: "2026-10-10T19:55:30.000Z",
      stopsAt: "2026-10-10T19:55:30.000Z",
    });
  });

  it("uses the longest category cutoff rather than an earlier event end", () => {
    const maxCutoffSeconds = maximumFinishCutoffSeconds([
      { overallCutoffSeconds: 2 * 3600 },
      { overallCutoffSeconds: 6 * 3600 },
      { overallCutoffSeconds: 4 * 3600 },
    ]);
    expect(maxCutoffSeconds).toBe(6 * 3600);
    expect(finishLineClockWindow({
      startsAt: "2026-10-10T01:00:00.000Z",
      eventEndAt: "2026-10-10T03:00:00.000Z",
      maxCutoffSeconds,
      stopDelaySeconds: 0,
    })).toEqual({
      endsAt: "2026-10-10T07:00:00.000Z",
      stopsAt: "2026-10-10T07:00:00.000Z",
    });
  });

  it("uses a category's longest cumulative split cutoff when no overall value exists", () => {
    expect(maximumFinishCutoffSeconds([
      { legs: [{ cutoffSeconds: 1800 }], splits: [{ cutoffSeconds: 7200 }, { cutoffSeconds: 10800 }] },
      { overallCutoffSeconds: null },
    ])).toBe(10800);
    expect(maximumFinishCutoffSeconds([{ overallCutoffSeconds: 0 }, { overallCutoffSeconds: null }])).toBeNull();
  });
});
