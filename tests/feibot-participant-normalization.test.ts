import { describe, expect, it } from "vitest";
import { AUTOMATIC_FEIBOT_RESULT_FEEDS, buildFeibotCanonicalParticipantRows, isAuthoritativeParticipantPayload, isFeibotResultFeedDue, normalizedParticipantRows, shouldReconcileFeibotRoster } from "@/lib/feibot-integration";
import { normalizeFeibotParticipant } from "@/packages/timing-core/src";

describe("Feibot participant canonicalization", () => {
  it("does not accept a roster-level FINISHED flag without the configured final split", () => {
    expect(normalizeFeibotParticipant({
      participantUuid: "provider-athlete-1",
      bib: "1001",
      status: "FINISHED",
    }, { eventId: "event" }).raceStatus).toBe("STARTED");
  });

  it("normalizes Workbench participant fields and their Feibot chip", () => {
    const [row] = normalizedParticipantRows([{
      ParticipantUUID: "provider-athlete-1",
      Unsafe_ParticipantBib: "1001",
      Unsafe_ParticipantName: "Asha Rao",
      Unsafe_ContestName: "TRIATHLON",
      ChipCode: "FB-10001",
    }], "provider-event");
    expect(row).toMatchObject({
      participantUid: "provider-athlete-1",
      providerParticipantUuid: "provider-athlete-1",
      providerEventUuid: "provider-event",
      bib: "1001",
      fullName: "Asha Rao",
      contestName: "TRIATHLON",
      chipCode: "FB-10001",
      providerParticipantSource: "FEIBOT",
    });
  });

  it("uses the Feibot roster as the identity set and preserves its chip over result feeds", () => {
    const rows = buildFeibotCanonicalParticipantRows(
      [{ ParticipantUUID: "provider-1", Unsafe_ParticipantBib: "1001", ChipCode: "FEIBOT-1", Unsafe_ParticipantName: "One" }],
      [
        { participantUid: "result-1", bib: "1001", chipCode: "RESULT-CHIP", status: "FINISHED", elapsedTime: "01:00:00" },
        { participantUid: "result-2", bib: "1002", chipCode: "EXTRA", status: "FINISHED" },
      ],
      "provider-event",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ participantUid: "provider-1", bib: "1001", chipCode: "FEIBOT-1", status: "FINISHED", elapsedTime: "01:00:00" });
  });

  it("treats an explicitly empty Feibot roster as an authoritative deletion", () => {
    expect(isAuthoritativeParticipantPayload({ data: { participants: [] } })).toBe(true);
    expect(isAuthoritativeParticipantPayload({ message: "temporary upstream response" })).toBe(false);
  });

  it("periodically reconciles the complete roster without polling the forbidden process feed", () => {
    expect(AUTOMATIC_FEIBOT_RESULT_FEEDS.map((feed) => feed.endpoint)).toEqual([
      "/temporary/temporary_ResultDataGetAll",
      "/finishResultGetAll",
    ]);
    expect(shouldReconcileFeibotRoster(null, Date.parse("2026-10-19T08:00:00Z"))).toBe(true);
    expect(shouldReconcileFeibotRoster("2026-10-19T07:58:00Z", Date.parse("2026-10-19T08:00:00Z"))).toBe(false);
    expect(shouldReconcileFeibotRoster("2026-10-19T07:54:00Z", Date.parse("2026-10-19T08:00:00Z"))).toBe(true);
  });

  it("paces live and final result feeds independently", () => {
    const now = Date.parse("2026-10-19T08:00:00Z");
    expect(isFeibotResultFeedDue("/temporary/temporary_ResultDataGetAll", null, now)).toBe(true);
    expect(isFeibotResultFeedDue("/temporary/temporary_ResultDataGetAll", "2026-10-19T07:59:30Z", now)).toBe(false);
    expect(isFeibotResultFeedDue("/temporary/temporary_ResultDataGetAll", "2026-10-19T07:59:00Z", now)).toBe(true);
    expect(isFeibotResultFeedDue("/finishResultGetAll", "2026-10-19T07:56:00Z", now)).toBe(false);
    expect(isFeibotResultFeedDue("/finishResultGetAll", "2026-10-19T07:55:00Z", now)).toBe(true);
  });
});
