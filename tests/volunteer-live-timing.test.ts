import { describe, expect, it } from "vitest";
import type { LiveParticipant } from "@/packages/contracts/src";
import { defaultLiveTrackingHubConfig } from "@/lib/live-tracking-hub-config";
import { buildVolunteerLiveTimingPayload } from "@/lib/volunteer-live-timing";
import { buildVolunteerCutoffTimingPayload } from "@/lib/volunteer-cutoff-timing";

function athlete(overrides: Partial<LiveParticipant>): LiveParticipant {
  return {
    eventId: "event-1",
    participantUid: "athlete-1",
    bib: "101",
    displayName: "Race Athlete",
    initials: "RA",
    contestName: "Olympic",
    visibility: "PUBLIC",
    raceStatus: "RUNNING",
    currentLeg: "RUN",
    elapsedTime: "01:20:00",
    splits: [{ splitId: "start", name: "Start", splitTime: "00:00:00", cumulativeTime: "00:00:00", timestamp: "2026-10-07T00:30:00.000Z" }],
    ...overrides,
  };
}

function hub() {
  const config = defaultLiveTrackingHubConfig("event-1");
  config.start.gunStartAt = "2026-10-07T00:30:00.000Z";
  config.start.overallCutoffSeconds = 4 * 60 * 60;
  config.legs = [
    { id: "swim", name: "Swim", type: "SWIM", order: 1, distanceKm: 1.5, cutoffSeconds: 60 * 60 },
    { id: "run", name: "Run", type: "RUN", order: 2, distanceKm: 10, cutoffSeconds: 4 * 60 * 60 },
  ];
  config.splits = [
    { id: "start", name: "Start", legId: "swim", order: 1, distanceKm: 0, timingPointId: "start", passage: 1, cutoffSeconds: null },
    { id: "finish", name: "Finish", legId: "run", order: 2, distanceKm: 11.5, timingPointId: "finish", passage: 1, cutoffSeconds: 4 * 60 * 60 },
  ];
  return config;
}

describe("volunteer live timing", () => {
  it("builds finish-line totals, approaching athletes and recent finishers", () => {
    const result = buildVolunteerLiveTimingPayload([
      athlete({ participantUid: "not-started", bib: "100", raceStatus: "NOT_STARTED", currentLeg: undefined, splits: [] }),
      athlete({ participantUid: "running", bib: "101" }),
      athlete({ participantUid: "finished", bib: "102", raceStatus: "FINISHED", currentLeg: "RUN", elapsedTime: "01:45:00", overallRank: 1, splits: [{ splitId: "finish", name: "Finish", splitTime: "00:25:00", cumulativeTime: "01:45:00", timestamp: "2026-10-07T02:15:00.000Z" }] }),
    ], hub(), new Date("2026-10-07T02:00:00.000Z"));

    expect(result.overview).toMatchObject({ total: 3, notStarted: 1, onCourse: 1, finished: 1, remaining: 2 });
    expect(result.approaching.map((row) => row.bib)).toEqual(["101"]);
    expect(result.recentFinishers.map((row) => row.bib)).toEqual(["102"]);
  });

  it("marks an athlete outside the next configured cutoff", () => {
    const result = buildVolunteerCutoffTimingPayload([
      athlete({ participantUid: "late", bib: "999" }),
    ], hub(), new Date("2026-10-07T05:00:01.000Z"));

    expect(result.athletes[0]?.cutoff.status).toBe("OUT OF CUTOFF");
    expect(result.overview.outOfCutoff).toBe(1);
  });
});
