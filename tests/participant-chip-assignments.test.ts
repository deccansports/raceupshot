import type { KVNamespace } from "@cloudflare/workers-types";
import { describe, expect, it } from "vitest";
import { applyParticipantChipAssignments, participantManagementRows, publishedResultParticipantRows } from "@/lib/participant-chip-assignments";

function fakeKv(values: Record<string, unknown>): KVNamespace {
  return {
    get: async (key: string) => values[key] ?? null,
  } as unknown as KVNamespace;
}

describe("participant chip assignment overrides", () => {
  it("applies only the exact event participant override and exposes its audit metadata", async () => {
    const eventId = "event-a";
    const assignment = {
      id: "audit-1",
      eventId,
      providerEventUuid: "feibot-a",
      participantId: "participant-1",
      bib: "42",
      participantName: "Asha Rao",
      previousChipCode: "OLD-1",
      chipCode: "NEW-9",
      reason: "Lost chip",
      changedBy: "admin@raceupshot.com",
      changedAt: "2026-08-26T10:00:00.000Z",
    };
    const kv = fakeKv({
      "raceupshot:live:event:event-a:chip-assignment:index": ["participant-1"],
      "raceupshot:live:event:event-a:chip-assignment:participant-1": assignment,
    });
    const result = await applyParticipantChipAssignments(kv, eventId, [
      { participantUid: "participant-1", bib: "42", chipCode: "OLD-1" },
      { participantUid: "participant-2", bib: "43", chipCode: "KEEP-2" },
    ]);

    expect(result[0]).toMatchObject({ chipCode: "NEW-9", chip_code: "NEW-9", chipAssignment: assignment });
    expect(result[1]).toMatchObject({ chipCode: "KEEP-2" });
  });

  it("leaves provider rows unchanged when the event has no overrides", async () => {
    const rows = [{ participantUid: "participant-1", chipCode: "ORIGINAL" }];
    expect(await applyParticipantChipAssignments(fakeKv({}), "event-b", rows)).toBe(rows);
  });

  it("applies an audited wristband removal overlay", async () => {
    const eventId = "event-relay";
    const removal = {
      id: "audit-remove", eventId, participantId: "relay-member-2", bib: "1501", participantName: "Athlete Two",
      previousAthleteBandCode: "BAND-1002", athleteBandCode: "", reason: "Damaged band", changedBy: "admin", changedAt: "2026-10-12T00:00:00.000Z",
    };
    const [result] = await applyParticipantChipAssignments(fakeKv({
      [`raceupshot:live:event:${eventId}:athlete-band-assignment:index`]: ["relay-member-2"],
      [`raceupshot:live:event:${eventId}:athlete-band-assignment:relay-member-2`]: removal,
    }), eventId, [{ participantUid: "relay-member-2", bib: "1501", athleteBandCode: "BAND-1002" }]);
    expect(result).toMatchObject({ athleteBandCode: "", athlete_band_code: "", athleteBandAssignment: removal });
  });

  it("seeds volunteer operations from the separate participant roster when no live-feed rows are supplied", async () => {
    const eventId = "event-participant-file";
    const imported = { participantUid: "participant-1001", bib: "1001", name: "Viraj Mahajan", rosterImportSource: "ADMIN_UPLOAD" };
    const result = await applyParticipantChipAssignments(fakeKv({
      [`raceupshot:live:event:${eventId}:participant-roster-import`]: {
        schemaVersion: 1,
        eventId,
        fileName: "participants.xlsx",
        rows: [imported],
        importedAt: "2026-10-07T10:00:00.000Z",
        importedBy: "admin@raceupshot.com",
      },
    }), eventId, []);

    expect(result).toEqual([imported]);
  });

  it("does not fetch stale assignments for athletes outside the selected roster", async () => {
    const requested: string[] = [];
    const kv = {
      get: async (key: string) => {
        requested.push(key);
        if (key === "raceupshot:live:event:event-a:chip-assignment:index") return ["missing-athlete"];
        return null;
      },
    } as unknown as KVNamespace;
    const rows = [{ participantUid: "present-athlete", bib: "42" }];

    expect(await applyParticipantChipAssignments(kv, "event-a", rows)).toEqual(rows);
    expect(requested).not.toContain("raceupshot:live:event:event-a:chip-assignment:missing-athlete");
  });

  it("applies a volunteer assignment saved against athleteUid to its published-results participant row", async () => {
    const eventId = "event-published";
    const assignment = {
      id: "audit-published",
      eventId,
      providerEventUuid: "",
      participantId: "athlete-viraj",
      bib: "1001",
      participantName: "Viraj Mahajan",
      previousChipCode: "",
      chipCode: "69894",
      reason: "Volunteer counter assignment",
      changedBy: "Timing Volunteer",
      changedAt: "2026-10-07T10:00:00.000Z",
    };
    const kv = fakeKv({
      "raceupshot:live:event:event-published:chip-assignment:index": ["athlete-viraj"],
      "raceupshot:live:event:event-published:chip-assignment:athlete-viraj": assignment,
    });

    const [result] = await applyParticipantChipAssignments(kv, eventId, [{
      participantUid: "published-result-1001",
      athleteUid: "athlete-viraj",
      bib: "1001",
      name: "Viraj Mahajan",
      publishedResultSource: "PUBLISHED_RESULTS",
    }]);

    expect(result).toMatchObject({
      participantUid: "published-result-1001",
      athleteUid: "athlete-viraj",
      chipCode: "69894",
      chip_code: "69894",
      chipAssignment: assignment,
    });
  });

  it("turns published results into editable participant identities without changing result timing", () => {
    const [row] = publishedResultParticipantRows([{
      id: "result-1025", athleteUid: "athlete-1", email: "shirish@example.com", name: "Shirish Yadav", bib: "1025",
      gender: "M", ageGroup: "16-30", club: "TEAM DOSE-T", city: "Pune", country: "India", category: "BERGMAN 102 TRIATHLON",
      rank: 1, genderRank: 1, ageRank: 1, finishTime: "06:00:00", pace: "", status: "FINISHED", lastSplit: "Run Finish",
      eventId: "event-a", eventSlug: "bergman-ozar", eventName: "Bergman Ozar", splits: [{ label: "Run Finish", time: "06:00:00" }],
    }]);
    expect(row).toMatchObject({
      participantUid: "result-1025", bib: "1025", name: "Shirish Yadav", email: "shirish@example.com",
      contestName: "BERGMAN 102 TRIATHLON", status: "FINISHED", publishedResultSource: "PUBLISHED_RESULTS",
    });
    expect(row).not.toHaveProperty("chipCode");
    expect(row).not.toHaveProperty("athleteBandCode");
  });

  it("keeps published-results-only rows out of Participant Management", () => {
    expect(participantManagementRows({ participants: [
      { participantUid: "result-1", bib: "1001", publishedResultSource: "PUBLISHED_RESULTS" },
      { participantUid: "registration-1", bib: "1002", registrationStatus: "CONFIRMED" },
      { participantUid: "import-1", bib: "1003", publishedResultSource: "PUBLISHED_RESULTS", rosterImportSource: "ADMIN_UPLOAD" },
    ] })).toEqual([
      { participantUid: "registration-1", bib: "1002", registrationStatus: "CONFIRMED" },
      { participantUid: "import-1", bib: "1003", publishedResultSource: "PUBLISHED_RESULTS", rosterImportSource: "ADMIN_UPLOAD" },
    ]);
  });
});
