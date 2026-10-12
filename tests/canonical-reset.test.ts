import { describe, expect, it } from "vitest";
import {
  buildCanonicalParticipantIndexRows,
  canonicalAdminFileSelection,
  canonicalRuntimeResetKeys,
  isResettableTimingDecisionKey,
} from "@/lib/canonical-live-tracking";

describe("event-scoped canonical reset", () => {
  it("selects the BERGMAN-style five active canonical artifacts", () => {
    const eventId = "event-a";
    const prefix = `raceupshot:canonical:event:${eventId}:version:v3`;
    const selection = canonicalAdminFileSelection(eventId, "v3", [
      `raceupshot:canonical:event:${eventId}:manifest`,
      `${prefix}:build:status`,
      `${prefix}:build:validation`,
      `${prefix}:course`,
      `${prefix}:participant:index`,
      `raceupshot:canonical:event:${eventId}:version:v2:participant:index`,
    ]);

    expect(selection.visibleKeys).toEqual([
      `raceupshot:canonical:event:${eventId}:manifest`,
      `${prefix}:build:status`,
      `${prefix}:build:validation`,
      `${prefix}:course`,
      `${prefix}:participant:index`,
    ]);
    expect(selection.historyVersions).toEqual(["v2"]);
  });

  it("builds a provider-aware canonical participant index row", () => {
    const participants = [{
      eventId: "event-a",
      participantUid: "participant-a",
      bib: "1013",
      displayName: "Aadhithyan Suresh",
      initials: "AS",
      contestId: "contest-a",
      contestName: "Test 1",
      gender: "Male",
      ageGroup: "16-30",
      country: "IN",
      club: "ARISE Performance India",
      visibility: "PUBLIC" as const,
      raceStatus: "NOT_STARTED" as const,
      splits: [],
    }];
    const rows = buildCanonicalParticipantIndexRows([{
      uuid: "participant-a",
      providerParticipantUuid: "provider-participant-a",
      chipCode: "CHIP-1013",
      contest_uuid: "contest-a",
    }], participants, "event-a", "provider-event-a");

    expect(rows).toEqual([expect.objectContaining({
      providerEventUuid: "provider-event-a",
      participantUuid: "participant-a",
      providerParticipantUuid: "provider-participant-a",
      chipCode: "CHIP-1013",
      bib: "1013",
      providerContestUuid: "contest-a",
      canonicalContestUuid: "contest-a",
      genderKey: "male",
      ageGroupKey: "16-30",
      trackingVisibility: "PUBLIC",
      status: "not_started",
    })]);
  });

  it("shows only the active canonical version and keeps older builds as history", () => {
    const eventId = "event-a";
    const selection = canonicalAdminFileSelection(eventId, "v3", [
      `raceupshot:canonical:event:${eventId}:manifest`,
      `raceupshot:canonical:event:${eventId}:version:v1:participants`,
      `raceupshot:canonical:event:${eventId}:version:v1:leaderboard`,
      `raceupshot:canonical:event:${eventId}:version:v2:participants`,
      `raceupshot:canonical:event:${eventId}:version:v2:leaderboard`,
      `raceupshot:canonical:event:${eventId}:version:v3:participants`,
      `raceupshot:canonical:event:${eventId}:version:v3:leaderboard`,
    ]);

    expect(selection.visibleKeys).toEqual([
      `raceupshot:canonical:event:${eventId}:manifest`,
      `raceupshot:canonical:event:${eventId}:version:v3:participants`,
      `raceupshot:canonical:event:${eventId}:version:v3:leaderboard`,
    ]);
    expect(selection.historyVersions).toEqual(["v2", "v1"]);
    expect(selection.historyFiles).toBe(4);
  });

  it("shows the optional race-day overlay only when it exists", () => {
    const eventId = "event-a";
    const incremental = `raceupshot:canonical:event:${eventId}:incremental:participants`;
    expect(canonicalAdminFileSelection(eventId, "v1", []).visibleKeys).not.toContain(incremental);
    expect(canonicalAdminFileSelection(eventId, "v1", [incremental]).visibleKeys).toContain(incremental);
  });

  it("targets only generated runtime projections for the selected event", () => {
    expect(canonicalRuntimeResetKeys("event-a")).toEqual([
      "raceupshot:live:event:event-a:participants",
      "raceupshot:live:event:event-a:updated",
      "raceupshot:live:event:event-a:leaderboard",
      "raceupshot:live:event:event-a:results",
    ]);
    expect(canonicalRuntimeResetKeys("event-a").every((key) => key.includes(":event-a:"))).toBe(true);
    expect(canonicalRuntimeResetKeys("event-a").some((key) => key.includes("event-b"))).toBe(false);
  });

  it.each([
    "raceupshot:timing-engine:provider:contest:participant:audit",
    "raceupshot:timing-engine:provider:contest:participant:official",
    "raceupshot:timing-engine:provider:contest:participant:passages",
    "raceupshot:timing-engine:provider:contest:participant:decisions",
  ])("removes generated timing decision key %s", (key) => {
    expect(isResettableTimingDecisionKey(key)).toBe(true);
  });

  it.each([
    "raceupshot:timing-engine:provider:contest:participant:raw:read-1",
    "raceupshot:timing-engine:provider:contest:participant:override:override-1",
    "raceupshot:feibot:provider-participants:provider",
    "raceupshot:participant-chip-assignment:event-a:participant-a",
    "raceupshot:live-tracking-hub:event-a",
    "raceupshot:course-map:event-a:category-a",
  ])("preserves setup, roster, raw evidence, override, or audit key %s", (key) => {
    expect(isResettableTimingDecisionKey(key)).toBe(false);
  });
});
