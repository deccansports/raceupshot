import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  values: new Map<string, string>(),
  operations: [] as string[],
  messages: [] as Record<string, unknown>[],
}));

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: async () => ({
    env: {
      RACEUPSHOT: {
        async get(key: string, type?: string) {
          const value = state.values.get(key) ?? null;
          return type === "json" && value ? JSON.parse(value) : value;
        },
        async put(key: string, value: string) { state.operations.push(`put:${key}`); state.values.set(key, value); },
        async delete(key: string) { state.operations.push(`delete:${key}`); state.values.delete(key); },
        async list({ prefix = "" }: { prefix?: string }) {
          return { keys: [...state.values.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
        },
      },
      CANONICAL_CHANGE_HUB: {
        getByName() {
          return { async fetch(_url: string, init: { body?: string }) {
            state.operations.push("publish");
            state.messages.push(JSON.parse(String(init.body)));
            return new Response(JSON.stringify({ ok: true }), { status: 200 });
          } };
        },
      },
    },
  }),
}));

import {
  buildAndPublishCanonicalEventVersion,
  getCanonicalLiveEvent,
  getCanonicalLiveParticipant,
  publishIncrementalCanonicalParticipants,
} from "@/lib/canonical-live-tracking";

const base = {
  participantUid: "participant-1", participantUuid: "participant-1", providerParticipantUuid: "provider-1",
  providerEventUuid: "feibot-1", contestUuid: "contest-1", contestName: "Test 1", bib: "1001",
  displayName: "Test Athlete", status: "NOT_STARTED", trackingVisibility: "PUBLIC", splits: [],
};

describe("canonical change publication ordering", () => {
  beforeEach(() => { state.values.clear(); state.operations.length = 0; state.messages.length = 0; });

  it("persists split ranks for active athletes and republishes competitors after a faster read", async () => {
    const athlete = (id: string, bib: string, time: string) => ({
      ...base, participantUid: id, participantUuid: id, providerParticipantUuid: id, bib,
      status: "STARTED", raceStatus: "STARTED",
      splits: [{ splitId: "bike-20k", name: "Bike 20k", cumulativeTime: time, status: "PROVISIONAL" }],
    });
    await buildAndPublishCanonicalEventVersion({
      eventId: "event-1", provider: "FEIBOT", providerEventUuid: "feibot-1",
      rows: [athlete("participant-1", "1001", "00:50:00"), athlete("participant-2", "1002", "00:55:00")],
    });
    expect((await getCanonicalLiveParticipant("event-1", "participant-1"))?.participant.splits[0].rankAtSplit).toBe(1);
    expect((await getCanonicalLiveParticipant("event-1", "participant-2"))?.participant.splits[0].rankAtSplit).toBe(2);
    await publishIncrementalCanonicalParticipants({
      eventId: "event-1", providerEventUuid: "feibot-1", reason: "split_updated",
      rows: [athlete("participant-2", "1002", "00:45:00")],
    });
    expect((await getCanonicalLiveParticipant("event-1", "participant-1"))?.participant.splits[0].rankAtSplit).toBe(2);
    expect((await getCanonicalLiveParticipant("event-1", "participant-2"))?.participant.splits[0].rankAtSplit).toBe(1);
  });

  it("publishes registered Feibot athletes in the canonical index without placing them on the live leaderboard", async () => {
    const manifest = await buildAndPublishCanonicalEventVersion({
      eventId: "event-1",
      provider: "FEIBOT",
      providerEventUuid: "feibot-1",
      rows: [
        { ...base, participantUid: "participant-1", bib: "1001", chipCode: "FEIBOT-10001", status: "REGISTERED" },
        { ...base, participantUid: "participant-2", participantUuid: "participant-2", bib: "1002", chipCode: "FEIBOT-10002", status: "REGISTERED" },
      ],
    });

    const index = JSON.parse(state.values.get(`raceupshot:canonical:event:event-1:version:${manifest.activeVersion}:participant:index`)!);
    const status = JSON.parse(state.values.get(`raceupshot:canonical:event:event-1:version:${manifest.activeVersion}:build:status`)!);
    expect(manifest.participantCount).toBe(2);
    expect(index).toMatchObject({ participantCount: 2, rows: [
      expect.objectContaining({ participantUuid: "participant-1", bib: "1001", chipCode: "FEIBOT-10001" }),
      expect.objectContaining({ participantUuid: "participant-2", bib: "1002", chipCode: "FEIBOT-10002" }),
    ] });
    expect(status.message).toBe("Published 2 participants and 0 ranked athletes.");
    const canonical = await getCanonicalLiveEvent("event-1");
    expect(canonical?.participants).toHaveLength(2);
    expect(canonical?.participants.map((participant) => participant.bib)).toEqual(["1001", "1002"]);
    expect(canonical?.leaderboard).toEqual([]);
  });

  it("replaces a canonical split when Feibot corrects its time", async () => {
    await buildAndPublishCanonicalEventVersion({
      eventId: "event-1", provider: "FEIBOT", providerEventUuid: "feibot-1", rows: [base],
    });
    const result = (chipTime: string, sectionTime: string, timestamp: string) => ({
      participant_uuid: "participant-1",
      Unsafe_ParticipantBib: "1001",
      Unsafe_ParticipantName: "Test Athlete",
      ContestUUID: "contest-1",
      ContestName: "Test 1",
      SplitResults: [{
        GunTimeFromStartFormated: chipTime,
        SplitUUID: "bike-1",
        ChipTimeFromStartFormated: chipTime,
        Unsafe_SplitName: "Bike 1",
        TimeSpanFormated: sectionTime,
        Validity: "Valid",
        timestamp,
      }],
    });
    expect(await publishIncrementalCanonicalParticipants({
      eventId: "event-1", providerEventUuid: "feibot-1", reason: "split_updated",
      rows: [result("00:10:00", "00:10:00", "2026-10-10T06:10:00.000Z")],
    })).toBe(true);
    expect(await publishIncrementalCanonicalParticipants({
      eventId: "event-1", providerEventUuid: "feibot-1", reason: "split_updated",
      rows: [result("00:09:30", "00:09:30", "2026-10-10T06:09:30.000Z")],
    })).toBe(true);

    const canonical = await getCanonicalLiveEvent("event-1");
    expect(canonical?.manifest).toMatchObject({ timingVersion: 2, raceDayRevision: 2 });
    expect(canonical?.participants[0]).toMatchObject({
      latestTimingPoint: "Bike 1",
      latestSplitTime: "00:09:30.000",
      elapsedTime: "00:09:30.000",
      splits: [expect.objectContaining({
        splitId: "bike-1",
        splitTime: "00:09:30.000",
        cumulativeTime: "00:09:30.000",
        timestamp: "2026-10-10T06:09:30.000Z",
      })],
    });
  });

  it("persists incremental canonical and manifest before broadcasting only invalidation metadata", async () => {
    await buildAndPublishCanonicalEventVersion({
      eventId: "event-1", provider: "FEIBOT", providerEventUuid: "feibot-1", rows: [base],
    });
    state.operations.length = 0;
    state.messages.length = 0;
    const acceptedAt = new Date(Date.now() - 20).toISOString();
    await publishIncrementalCanonicalParticipants({
      eventId: "event-1", providerEventUuid: "feibot-1", participantUuid: "participant-1",
      contestUuid: "contest-1", reason: "split_updated", feibotReadAcceptedAt: acceptedAt,
      rows: [{ ...base, status: "STARTED", splits: [{ splitId: "start", name: "Start", timestamp: new Date().toISOString() }] }],
    });

    const manifestKey = "raceupshot:canonical:event:event-1:manifest";
    expect(state.operations.indexOf(`put:${manifestKey}`)).toBeGreaterThan(-1);
    expect(state.operations.indexOf(`put:${manifestKey}`)).toBeLessThan(state.operations.indexOf("publish"));
    const manifest = JSON.parse(state.values.get(manifestKey)!);
    expect(manifest.timingVersion).toBe(1);
    expect(state.values.has("raceupshot:canonical:event:event-1:incremental:participant:participant-1")).toBe(true);
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({
      type: "canonical_change", eventId: "event-1", participantUuid: "participant-1",
      contestUuid: "contest-1", timingVersion: 1, revision: 1, reason: "split_updated",
    });
    expect(state.messages[0]).not.toHaveProperty("chipCode");
    expect(state.messages[0]).not.toHaveProperty("timingPointId");
    expect(state.messages[0]).not.toHaveProperty("providerReadTimestamp");
  });

  it("merges calculated Feibot results without regressing or republishing a richer accepted participant update", async () => {
    await buildAndPublishCanonicalEventVersion({
      eventId: "event-1", provider: "FEIBOT", providerEventUuid: "feibot-1", rows: [base],
    });
    await publishIncrementalCanonicalParticipants({
      eventId: "event-1", providerEventUuid: "feibot-1", participantUuid: "participant-1",
      contestUuid: "contest-1", reason: "split_updated",
      rows: [{
        ...base,
        status: "STARTED",
        splits: [{
          splitId: "start-id", name: "Start", splitTime: "00:00:00.000",
          cumulativeTime: "00:00:00.000", timestamp: "2026-08-28T09:06:24.852Z",
          readerTimestamp: "2026-08-28T09:06:24.852Z", officialTimeMs: 0,
          source: "FEIBOT_PROCESSED",
        }],
        latestTimingPoint: "Start",
        lastUpdatedAt: "2026-08-28T09:06:24.852Z",
      }],
    });
    const republished = await publishIncrementalCanonicalParticipants({
      eventId: "event-1", providerEventUuid: "feibot-1", reason: "participant_updated",
      rows: [{
        participant_uuid: "participant-1",
        Unsafe_ParticipantBib: "1001",
        Unsafe_ParticipantName: "Test Athlete",
        ContestUUID: "contest-1",
        ContestName: "Test 1",
        SplitResults: [{
          GunTimeFromStartFormated: "00:01:36",
          SplitUUID: "start-id",
          ChipTimeFromStartFormated: "00:00:00",
          Unsafe_SplitName: "Start ",
          TimeSpanFormated: "00:01:36",
          Validity: "Valid",
        }],
      }],
    });

    const [event, detail] = await Promise.all([
      getCanonicalLiveEvent("event-1"),
      getCanonicalLiveParticipant("event-1", "participant-1"),
    ]);
    const eventParticipant = event?.participants.find((participant) => participant.participantUid === "participant-1");
    expect(eventParticipant).toMatchObject({
      bib: "1001", raceStatus: "STARTED", latestTimingPoint: "Start",
      splits: [{ splitId: "start-id", name: "Start", timestamp: "2026-08-28T09:06:24.852Z", source: "FEIBOT_PROCESSED" }],
    });
    expect(detail?.participant).toEqual(eventParticipant);
    expect(republished).toBe(false);
    expect(event?.manifest).toMatchObject({ timingVersion: 1, raceDayRevision: 1 });
    expect(eventParticipant?.splits[0]).not.toHaveProperty("Unsafe_SplitName");
  });

  it("promotes a terminal timing audit stored under the provider contest UUID", async () => {
    await buildAndPublishCanonicalEventVersion({
      eventId: "event-1",
      provider: "FEIBOT",
      providerEventUuid: "feibot-1",
      rows: [{
        ...base,
        contestUuid: "canonical-contest",
        providerContestUuid: "provider-contest",
      }],
    });
    state.values.set(
      "raceupshot:timing-engine:feibot-1:provider-contest:participant-1:audit",
      JSON.stringify({
        eventUuid: "feibot-1",
        contestUuid: "provider-contest",
        participantUuid: "participant-1",
        bib: "1001",
        chipCode: "10001",
        timingResultSource: "FEIBOT_PROCESSED",
        state: "FINISHED",
        rawReads: [], passages: [], decisions: [], manualOverrides: [], rejectedRawReads: [],
        officialResults: [
          {
            timingPointUuid: "start-point", timingPointKey: "start", timingPointName: "Start", timingPointType: "START",
            readerTimestamp: "2026-10-10T17:55:30.000Z", gunStartTimestamp: "2026-10-10T17:55:30.000Z", chipStartTimestamp: "2026-10-10T17:55:30.000Z",
            gunTimeMs: 0, chipTimeMs: 0, sectionTimeMs: 0, officialTimeMs: 0, source: "FEIBOT_PROCESSED", status: "PROVISIONAL",
          },
          {
            timingPointUuid: "finish-point", timingPointKey: "finish", timingPointName: "Finish", timingPointType: "FINISH",
            readerTimestamp: "2026-10-10T19:25:30.000Z", gunStartTimestamp: "2026-10-10T17:55:30.000Z", chipStartTimestamp: "2026-10-10T17:55:30.000Z",
            gunTimeMs: 5_400_000, chipTimeMs: 5_400_000, sectionTimeMs: 5_400_000, officialTimeMs: 5_400_000, source: "FEIBOT_PROCESSED", status: "PROVISIONAL",
          },
        ],
      }),
    );

    expect(await publishIncrementalCanonicalParticipants({
      eventId: "event-1",
      providerEventUuid: "feibot-1",
      rows: [{
        ...base,
        contestUuid: "canonical-contest",
        providerContestUuid: "provider-contest",
        status: "STARTED",
      }],
    })).toBe(true);

    const canonical = await getCanonicalLiveEvent("event-1");
    expect(canonical?.participants[0]).toMatchObject({
      raceStatus: "FINISHED",
      latestTimingPoint: "Finish",
      elapsedTime: "01:30:00.000",
    });
  });

  it("lets an authoritative finished timing audit repair a stale canonical DNF", async () => {
    await buildAndPublishCanonicalEventVersion({
      eventId: "event-1", provider: "FEIBOT", providerEventUuid: "feibot-1",
      rows: [{ ...base, contestUuid: "canonical-contest", providerContestUuid: "provider-contest", status: "STARTED" }],
    });
    await publishIncrementalCanonicalParticipants({
      eventId: "event-1", providerEventUuid: "feibot-1",
      rows: [{ ...base, contestUuid: "canonical-contest", providerContestUuid: "provider-contest", status: "DNF" }],
    });
    state.values.set(
      "raceupshot:timing-engine:feibot-1:provider-contest:participant-1:audit",
      JSON.stringify({
        eventUuid: "feibot-1", contestUuid: "provider-contest", participantUuid: "participant-1", bib: "1001", chipCode: "10001",
        timingResultSource: "FEIBOT_PROCESSED", state: "FINISHED", rawReads: [], passages: [], decisions: [], manualOverrides: [], rejectedRawReads: [],
        officialResults: [
          { timingPointUuid: "start-point", timingPointKey: "start", timingPointName: "Start", timingPointType: "START", readerTimestamp: "2026-10-10T17:55:30.000Z", gunStartTimestamp: "2026-10-10T17:55:30.000Z", chipStartTimestamp: "2026-10-10T17:55:30.000Z", gunTimeMs: 0, chipTimeMs: 0, sectionTimeMs: 0, officialTimeMs: 0, source: "FEIBOT_PROCESSED", status: "PROVISIONAL" },
          { timingPointUuid: "finish-point", timingPointKey: "finish", timingPointName: "Finish", timingPointType: "FINISH", readerTimestamp: "2026-10-10T20:31:26.000Z", gunStartTimestamp: "2026-10-10T17:55:30.000Z", chipStartTimestamp: "2026-10-10T17:55:30.000Z", gunTimeMs: 9_356_000, chipTimeMs: 9_356_000, sectionTimeMs: 9_356_000, officialTimeMs: 9_356_000, source: "FEIBOT_PROCESSED", status: "PROVISIONAL" },
        ],
      }),
    );

    expect(await publishIncrementalCanonicalParticipants({
      eventId: "event-1", providerEventUuid: "feibot-1",
      rows: [{ ...base, contestUuid: "canonical-contest", providerContestUuid: "provider-contest", status: "DNF" }],
    })).toBe(true);
    const canonical = await getCanonicalLiveEvent("event-1");
    expect(canonical?.participants[0]).toMatchObject({ raceStatus: "FINISHED", elapsedTime: "02:35:56.000" });
  });
});
