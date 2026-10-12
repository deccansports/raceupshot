import { describe, expect, it } from "vitest";
import { normalizeVolunteerModules, rankVolunteerManualTiming, volunteerProfileInput, type VolunteerOperationLog } from "@/lib/volunteer-management";
import type { LiveParticipant } from "@/packages/contracts/src";

const base = {
  name: "Race Volunteer",
  email: "volunteer@raceupshot.com",
  mobile: "+919876543210",
  status: "ACTIVE" as const,
};

describe("volunteer management contracts", () => {
  const operation = (id: string, participantUid: string, bib: string, capturedAt: string, extra: Partial<VolunteerOperationLog> = {}) => ({
    id, eventId: "event-1", eventName: "Race", participantUid, bib, athleteName: `Athlete ${bib}`,
    volunteerId: "volunteer-1", volunteerName: "Volunteer", action: "MANUAL_TIMING_CAPTURED",
    timingPointName: "Manual Gun Finish", capturedAt, status: "RECORDED", ...extra,
  }) satisfies VolunteerOperationLog;
  const participant = (participantUid: string, bib: string, gender: string, ageGroup: string, startAt?: string) => ({
    eventId: "event-1", participantUid, bib, displayName: `Athlete ${bib}`, initials: "AT", contestId: "contest-102",
    contestName: "BERGMAN 102 TRIATHLON", gender, ageGroup, visibility: "PUBLIC", raceStatus: "FINISHED",
    splits: startAt ? [{ splitId: "start", name: "Start", splitTime: "00:00:00", chipStartTimestamp: startAt }] : [],
  }) satisfies LiveParticipant;

  it("ranks manual finishes by end time minus canonical athlete start instead of canonical rank fields", () => {
    const rows = [
      operation("operation-1", "participant-1", "1001", "2026-10-08T06:00:00.000Z"),
      operation("operation-2", "participant-2", "1002", "2026-10-08T06:15:00.000Z"),
    ];
    const participants = [
      { ...participant("participant-1", "1001", "M", "16-30", "2026-10-08T05:00:00.000Z"), overallRank: 1 },
      { ...participant("participant-2", "1002", "M", "16-30", "2026-10-08T05:30:00.000Z"), overallRank: 99 },
    ];
    const ranked = rankVolunteerManualTiming(rows, new Map([["event-1", participants]]));

    expect(ranked.map((row) => [row.bib, row.rankingElapsedMilliseconds, row.overallRank, row.genderRank, row.ageGroupRank, row.rankingStartSource])).toEqual([
      ["1001", 3_600_000, 2, 2, 2, "CANONICAL"],
      ["1002", 2_700_000, 1, 1, 1, "CANONICAL"],
    ]);
  });

  it("uses the saved gun start when canonical start is unavailable", () => {
    const row = operation("operation-1", "participant-1", "1001", "2026-10-08T06:00:00.000Z", { gunStartAt: "2026-10-08T05:15:00.000Z" });
    const ranked = rankVolunteerManualTiming([row], new Map([["event-1", [participant("participant-1", "1001", "F", "31-40")]]]));
    expect(ranked[0]).toMatchObject({ rankingElapsedMilliseconds: 2_700_000, rankingStartSource: "SAVED_GUN", overallRank: 1, genderRank: 1, ageGroupRank: 1 });
  });

  it("excludes reset captures from all rankings", () => {
    const captured = operation("operation-1", "participant-1", "1001", "2026-10-08T06:00:00.000Z", { gunStartAt: "2026-10-08T05:00:00.000Z" });
    const reset = operation("reset-1", "participant-1", "1001", "2026-10-08T06:10:00.000Z", { action: "MANUAL_TIMING_RESET", reversesOperationId: captured.id });
    const ranked = rankVolunteerManualTiming([reset, captured], new Map([["event-1", [participant("participant-1", "1001", "M", "16-30")]]]));
    expect(ranked.map((row) => [row.action, row.overallRank])).toEqual([["MANUAL_TIMING_RESET", null], ["MANUAL_TIMING_CAPTURED", null]]);
  });

  it("does not use canonical start or demographics from another participant with the same BIB", () => {
    const row = operation("operation-1", "participant-1", "1001", "2026-10-08T06:00:00.000Z", { gunStartAt: "2026-10-08T05:30:00.000Z" });
    const other = participant("participant-2", "1001", "M", "16-30", "2026-10-08T05:00:00.000Z");
    const ranked = rankVolunteerManualTiming([row], new Map([["event-1", [other]]]));
    expect(ranked[0]).toMatchObject({ rankingElapsedMilliseconds: 1_800_000, rankingStartSource: "SAVED_GUN", overallRank: 1, genderRank: null, ageGroupRank: null });
  });

  it("merges legacy waiver check-in into athlete check-in", () => {
    expect(normalizeVolunteerModules(["WAIVER_CHECK_IN", "ATHLETE_CHECK_IN", "BIKE_CHECK_IN"])).toEqual(["ATHLETE_CHECK_IN", "BIKE_CHECK_IN"]);
  });

  it("accepts an event-scoped check-in assignment", () => {
    const result = volunteerProfileInput.safeParse({
      ...base,
      assignments: [{
        eventId: "event-1",
        modules: ["ATHLETE_LOOKUP", "ATHLETE_CHECK_IN"],
        timingPointIds: [],
        active: true,
      }],
    });
    expect(result.success).toBe(true);
  });

  it("allows manual timing before timing points are configured", () => {
    const result = volunteerProfileInput.safeParse({
      ...base,
      assignments: [{
        eventId: "event-1",
        modules: ["MANUAL_TIMING"],
        timingPointIds: [],
        active: true,
      }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts multiple timing points when the function is assigned", () => {
    const result = volunteerProfileInput.safeParse({
      ...base,
      assignments: [{
        eventId: "event-1",
        modules: ["ATHLETE_LOOKUP", "MANUAL_TIMING"],
        timingPointIds: ["swim-exit", "finish"],
        active: true,
      }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts the race-operations volunteer roles", () => {
    const result = volunteerProfileInput.safeParse({
      ...base,
      assignments: [{
        eventId: "event-1",
        modules: [
          "COUNTER", "BIKE_CHECK_IN", "BIKE_CHECK_OUT", "FINISH_LINE_VOLUNTEER", "CUTOFF_TIME_VOLUNTEER",
          "TIMING_CHIP_ASSIGNMENT_COUNTER", "ATHLETE_BAND_ASSIGNMENT_COUNTER", "VOLUNTEER_BAND_ASSIGNMENT_COUNTER",
        ],
        timingPointIds: [],
        active: true,
      }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts an optional volunteer login password and rejects a short one", () => {
    expect(volunteerProfileInput.safeParse({ ...base, password: "RaceDay#2026", assignments: [] }).success).toBe(true);
    expect(volunteerProfileInput.safeParse({ ...base, password: "123456", assignments: [] }).success).toBe(true);
    expect(volunteerProfileInput.safeParse({ ...base, password: "short", assignments: [] }).success).toBe(false);
  });
});
