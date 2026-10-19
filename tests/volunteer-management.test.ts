import { describe, expect, it } from "vitest";
import { normalizeVolunteerModules, rankVolunteerManualTiming, volunteerAssignmentMatchesEvent, volunteerProfileInput, type VolunteerOperationLog } from "@/lib/volunteer-management";
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
  const participant = (participantUid: string, bib: string, gender: string, ageGroup: string, startAt?: string, gunStartAt?: string) => ({
    eventId: "event-1", participantUid, bib, displayName: `Athlete ${bib}`, initials: "AT", contestId: "contest-102",
    contestName: "BERGMAN 102 TRIATHLON", gender, ageGroup, visibility: "PUBLIC", raceStatus: "FINISHED",
    splits: startAt || gunStartAt ? [{ splitId: "start", name: "Start", splitTime: "00:00:00", chipStartTimestamp: startAt, gunStartTimestamp: gunStartAt }] : [],
  }) satisfies LiveParticipant;

  it("matches current and legacy volunteer event assignments", () => {
    const event = { id: "event-current", name: "Udupi Triathlon", providerEventUuid: "provider-udupi" };
    expect(volunteerAssignmentMatchesEvent({ eventId: "event-current", eventName: "Old label", providerEventUuid: null }, event)).toBe(true);
    expect(volunteerAssignmentMatchesEvent({ eventId: "event-old", eventName: "Old label", providerEventUuid: "provider-udupi" }, event)).toBe(true);
    expect(volunteerAssignmentMatchesEvent({ eventId: "event-old", eventName: " Udupi-Triathlon ", providerEventUuid: null }, event)).toBe(true);
    expect(volunteerAssignmentMatchesEvent({ eventId: "event-old", eventName: "Other race", providerEventUuid: null }, event)).toBe(false);
  });

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

  it("does not guess a canonical athlete when the same BIB is ambiguous", () => {
    const row = operation("operation-1", "participant-1", "1001", "2026-10-08T06:00:00.000Z", { gunStartAt: "2026-10-08T05:30:00.000Z" });
    const others = [
      participant("participant-2", "1001", "M", "16-30", "2026-10-08T05:00:00.000Z"),
      participant("participant-3", "1001", "F", "31-40", "2026-10-08T05:05:00.000Z"),
    ];
    const ranked = rankVolunteerManualTiming([row], new Map([["event-1", others]]));
    expect(ranked[0]).toMatchObject({ rankingElapsedMilliseconds: 1_800_000, rankingStartSource: "SAVED_GUN", overallRank: 1, genderRank: null, ageGroupRank: null });
  });

  it("uses the persisted canonical identity when the roster identity differs", () => {
    const row = operation("operation-1", "source-athlete-1", "1007", "2026-10-19T14:52:48.000Z", {
      canonicalParticipantUid: "feibot-athlete-1",
      gunStartAt: "2026-10-19T11:45:00.000Z",
    });
    const canonical = participant("feibot-athlete-1", "1007", "M", "18-35", "2026-10-19T11:45:30.000Z", "2026-10-19T11:45:00.000Z");
    const ranked = rankVolunteerManualTiming([row], new Map([["event-1", [canonical]]]));
    expect(ranked[0]).toMatchObject({
      rankingStartAt: "2026-10-19T11:45:30.000Z",
      rankingElapsedMilliseconds: 11_238_000,
      rankingChipElapsedMilliseconds: null,
      rankingGunElapsedMilliseconds: null,
      manualChipElapsedMilliseconds: 11_238_000,
      manualGunElapsedMilliseconds: 11_268_000,
      rankingStartSource: "CANONICAL",
    });
  });

  it("recovers legacy roster identities by a unique BIB and matching contest", () => {
    const row = operation("operation-1", "source-athlete-1", "1007", "2026-10-19T14:52:48.000Z", {
      category: "BERGMAN 102 TRIATHLON",
      gunStartAt: "2026-10-19T11:45:00.000Z",
    });
    const canonical = participant("feibot-athlete-1", "1007", "M", "18-35", "2026-10-19T11:45:30.000Z");
    const ranked = rankVolunteerManualTiming([row], new Map([["event-1", [canonical]]]));
    expect(ranked[0]).toMatchObject({
      rankingStartAt: "2026-10-19T11:45:30.000Z",
      rankingElapsedMilliseconds: 11_238_000,
      rankingStartSource: "CANONICAL",
    });
  });

  it("uses the canonical finish result while preserving the later manual stamp", () => {
    const row = operation("operation-1", "source-athlete-1", "1001", "2026-10-19T14:42:40.397Z", {
      timingPointName: "Start/Finish",
      gunStartAt: "2026-10-19T11:45:00.000Z",
    });
    const canonical = {
      ...participant("feibot-athlete-1", "1001", "M", "18-35"),
      overallRank: 1,
      genderRank: 1,
      ageGroupRank: 1,
      splits: [
        { splitId: "swim-start", name: "Swim Start", splitTime: "00:00:00.000", chipStartTimestamp: "2026-10-19T11:45:30.000Z", gunStartTimestamp: "2026-10-19T11:45:00.000Z" },
        { splitId: "race-finish", name: "Race Finish", splitTime: "02:34:53.000", chipTimeMs: 9_293_000, gunTimeMs: 9_323_000, readerTimestamp: "2026-10-19T14:20:23.000Z" },
      ],
    } satisfies LiveParticipant;
    const ranked = rankVolunteerManualTiming([row], new Map([["event-1", [canonical]]]));
    expect(ranked[0]).toMatchObject({
      rankingEndAt: "2026-10-19T14:20:23.000Z",
      rankingElapsedMilliseconds: 9_293_000,
      rankingChipElapsedMilliseconds: 9_293_000,
      rankingGunElapsedMilliseconds: 9_323_000,
      rankingResultSource: "CANONICAL",
      overallRank: 1,
      genderRank: 1,
      ageGroupRank: 1,
    });
  });

  it("shows BIB 1002 canonical Race Finish chip time instead of its manual stamp elapsed", () => {
    const row = operation("operation-1002", "roster-1002", "1002", "2026-10-19T14:43:15.000Z", {
      timingPointName: "Start/Finish",
      gunStartAt: "2026-10-19T11:45:00.000Z",
    });
    const canonical = {
      ...participant("1aqMW9ry", "1002", "M", "18-35"),
      raceStatus: "FINISHED" as const,
      splits: [
        { splitId: "swim-start", name: "Swim Start", splitTime: "00:00:00.000", chipStartTimestamp: "2026-10-19T11:45:33.000Z", gunStartTimestamp: "2026-10-19T11:45:00.000Z" },
        { splitId: "race-finish", name: "Race Finish", splitTime: "02:57:24.000", chipTimeMs: 10_644_000, readerTimestamp: "2026-10-19T14:42:57.000Z" },
      ],
    } satisfies LiveParticipant;
    const ranked = rankVolunteerManualTiming([row], new Map([["event-1", [canonical]]]));
    expect(ranked[0]).toMatchObject({
      rankingChipElapsedMilliseconds: 10_644_000,
      rankingResultSource: "CANONICAL",
    });
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
