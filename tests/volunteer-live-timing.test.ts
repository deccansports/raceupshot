import { describe, expect, it } from "vitest";
import type { LiveParticipant } from "@/packages/contracts/src";
import { defaultLiveTrackingHubConfig } from "@/lib/live-tracking-hub-config";
import { buildVolunteerLiveTimingPayload } from "@/lib/volunteer-live-timing";
import { buildVolunteerCutoffTimingPayload } from "@/lib/volunteer-cutoff-timing";
import { matchesCutoffFilter } from "@/apps/volunteer-mobile/src/cutoffView";

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
  it("keeps all seven available while monitoring only the two unfinished athletes", () => {
    const participants = Array.from({ length: 7 }, (_, index) => athlete({ participantUid: String(index),
      raceStatus: "STARTED", splits: index < 5 ? [{ splitId: "finish", name: "Finish", splitTime: "00:30:00", cumulativeTime: "03:06:54" }] : athlete({}).splits,
    }));
    const result = buildVolunteerCutoffTimingPayload(participants, hub(), new Date("2026-10-07T03:40:00Z"));
    expect(result.overview).toMatchObject({ total: 7, racing: 2 });
    expect(result.athletes.filter((row) => matchesCutoffFilter(row, "ALL"))).toHaveLength(7);
    expect(result.athletes.filter((row) => matchesCutoffFilter(row, "FINISHED"))).toHaveLength(5);
    expect(result.athletes.filter((row) => matchesCutoffFilter(row, "MONITOR"))).toHaveLength(2);
    for (const row of result.athletes.filter((row) => row.finished)) {
      expect(row.cutoff).toMatchObject({ status: "NO CUTOFF", deadline: null, remainingSeconds: null });
      expect(row.currentLeg).toBe("FINISHED");
    }
  });

  it("keeps all finishers out of cutoff monitoring even long after the cutoff", () => {
    const result = buildVolunteerCutoffTimingPayload([athlete({ raceStatus: "STARTED", splits: [{ splitId: "finish", name: "Finish", splitTime: "00:30:00", cumulativeTime: "03:06:54" }] })], hub(), new Date("2026-10-08T00:00:00Z"));
    expect(result.overview).toMatchObject({ racing: 0, outOfCutoff: 0, approachingCutoff: 0, withinCutoff: 0 });
    expect(matchesCutoffFilter(result.athletes[0], "MONITOR")).toBe(false);
  });

  it("shows not-started and unconfigured athletes in All, and retains DNF without a cutoff", () => {
    const config = hub();
    config.legs = [];
    config.splits = [];
    config.start.overallCutoffSeconds = null;
    const result = buildVolunteerCutoffTimingPayload([
      athlete({ participantUid: "waiting", raceStatus: "NOT_STARTED", splits: [] }),
      athlete({ participantUid: "active" }),
      athlete({ participantUid: "dnf", raceStatus: "DNF" }),
    ], config);
    expect(result.athletes.filter((row) => matchesCutoffFilter(row, "ALL"))).toHaveLength(3);
    expect(result.athletes.filter((row) => matchesCutoffFilter(row, "MONITOR")).map((row) => row.id)).toEqual(["dnf"]);
    expect(result.athletes.filter((row) => matchesCutoffFilter(row, "DNF")).map((row) => row.id)).toEqual(["dnf"]);
  });
  it("moves a stale STARTED athlete with an accepted logical finish out of on-course and approaching counts", () => {
    const result = buildVolunteerLiveTimingPayload([athlete({ raceStatus: "STARTED", currentLeg: undefined,
      splits: [{ splitId: "finish", name: "Finish", cumulativeTime: "03:06:54", splitTime: "00:30:00", timestamp: "2026-10-07T03:36:54Z" }],
    })], hub());
    expect(result.overview).toMatchObject({ finished: 1, onCourse: 0, remaining: 0 });
    expect(result.approaching).toEqual([]);
    expect(result.recentFinishers[0]).toMatchObject({ status: "FINISHED", currentLeg: "FINISHED", nextSplit: "Finished", overallSeconds: 11214 });
  });

  it.each(["PENDING", "MISSING", "INVALID", "REJECTED"])("does not accept a %s finish read", (status) => {
    const result = buildVolunteerLiveTimingPayload([athlete({ splits: [{ splitId: "finish", name: "Finish", status, cumulativeTime: "03:06:54", splitTime: "00:30:00" }] })], hub());
    expect(result.overview.finished).toBe(0);
    expect(result.overview.onCourse).toBe(1);
  });

  it.each(["DNF", "DSQ", "CUTOFF_PENDING"] as const)("preserves %s despite a finish read", (raceStatus) => {
    const result = buildVolunteerLiveTimingPayload([athlete({ raceStatus, splits: [{ splitId: "finish", name: "Finish", cumulativeTime: "03:06:54", splitTime: "00:30:00" }] })], hub());
    expect(result.overview.finished).toBe(0);
    expect(result.athletes[0].status).toBe(raceStatus);
  });

  it("does not use another contest's finish or send next split backwards to a missed checkpoint", () => {
    const config = hub();
    config.splits.splice(1, 0, { ...config.splits[0], id: "missed", name: "Bike 20k", order: 1.5 });
    config.splits.push({ ...config.splits[1], id: "other-finish", name: "Other Finish", order: 4, providerContestUuid: "other" });
    const result = buildVolunteerLiveTimingPayload([athlete({ contestId: "olympic", splits: [{ splitId: "finish", name: "Finish", cumulativeTime: "03:06:54", splitTime: "00:30:00" }] })], config);
    expect(result.overview.finished).toBe(1);
    expect(result.athletes[0].nextSplit).toBe("Finished");
    const unfinished = buildVolunteerLiveTimingPayload([athlete({ splits: [{ splitId: "missed", name: "Bike 20k", cumulativeTime: "01:00:00", splitTime: "00:30:00" }] })], hubWithMissedStart(config));
    expect(unfinished.athletes[0].nextSplit).toBe("Finish");
  });
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

function hubWithMissedStart(config: ReturnType<typeof hub>) {
  return { ...config, splits: config.splits.filter((split) => !split.providerContestUuid) };
}
