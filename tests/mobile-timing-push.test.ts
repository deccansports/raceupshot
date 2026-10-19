import { afterEach, describe, expect, it, vi } from "vitest";

import {
  dispatchMobileTimingNotifications,
  watchlistMatchesTimingAudit,
} from "../lib/mobile-timing-push";

const audit = {
  eventUuid: "provider-event",
  contestUuid: "contest-1",
  participantUuid: "participant-1",
  bib: "1001",
  chipCode: "chip-1",
  timingResultSource: "FEIBOT_PROCESSED",
  state: "ON_COURSE",
  rawReads: [],
  passages: [],
  decisions: [],
  manualOverrides: [],
  rejectedRawReads: [],
  officialResults: [
    {
      eventUuid: "provider-event",
      contestUuid: "contest-1",
      participantUuid: "participant-1",
      bib: "1001",
      chipCode: "chip-1",
      timingPointUuid: "mat-1",
      timingPointKey: "bike-20k",
      timingPointName: "Bike 20k",
      timingPointType: "SPLIT",
      readerTimestamp: "2026-10-19T12:00:00.000Z",
      gunStartTimestamp: "2026-10-19T10:00:00.000Z",
      chipStartTimestamp: "2026-10-19T10:00:00.000Z",
      gunTimeMs: 7_200_000,
      chipTimeMs: 7_200_000,
      sectionTimeMs: 7_200_000,
      officialTimeMs: 7_200_000,
      resultTimeMode: "CHIP",
      passageId: null,
      readCount: 1,
      source: "FEIBOT_PROCESSED",
      status: "PROVISIONAL",
      overrideWarning: null,
    },
  ],
} as any;

afterEach(() => vi.restoreAllMocks());

describe("mobile timing push delivery", () => {
  it("matches account watchlists by canonical participant or bib", () => {
    const record = {
      id: "event-1:participant-1",
      type: "live-athlete",
      eventId: "event-1",
      athleteId: "participant-1",
      label: "Runner",
      deviceId: "device-1",
      athlete: { participantUuid: "participant-1", bib: "1001" },
      updatedAt: "2026-10-19T10:00:00.000Z",
    } as const;
    expect(watchlistMatchesTimingAudit(record, "event-1", audit)).toBe(true);
    expect(watchlistMatchesTimingAudit(record, "event-2", audit)).toBe(false);
  });

  it("sends a deduplicated Expo push for a newly accepted split", async () => {
    const values = new Map<string, unknown>([
      [
        "raceupshot:mobile-watchlist:v1:account%3Au1:event-1%3Aparticipant-1",
        {
          id: "event-1:participant-1",
          type: "live-athlete",
          eventId: "event-1",
          athleteId: "participant-1",
          label: "Runner",
          deviceId: "device-1",
          athlete: { participantUuid: "participant-1", bib: "1001" },
          updatedAt: "2026-10-19T10:00:00.000Z",
        },
      ],
      [
        "raceupshot:mobile-push:v1:account%3Au1:device-1",
        {
          owner: "account:u1",
          deviceId: "device-1",
          expoPushToken: "ExpoPushToken[test-token]",
        },
      ],
    ]);
    const kv = {
      list: vi.fn(async ({ prefix }: { prefix: string }) => ({
        keys: [...values.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })),
        list_complete: true,
        cacheStatus: null,
      })),
      get: vi.fn(async (key: string) => values.get(key) ?? null),
      put: vi.fn(async (key: string, value: unknown) => {
        values.set(key, value);
      }),
    } as any;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ status: "ok", id: "ticket-1" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      dispatchMobileTimingNotifications({ kv, eventId: "event-1", audit }),
    ).resolves.toEqual({ attempted: 1, delivered: 1 });
    const messages = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(messages[0]).toMatchObject({
      to: "ExpoPushToken[test-token]",
      title: "1001 crossed Bike 20k",
      body: "Bike 20k · 02:00:00",
      data: { type: "split_crossed", eventId: "event-1" },
    });
    expect(kv.put).toHaveBeenCalledWith(
      expect.stringContaining("raceupshot:mobile-timing-push:v1"),
      expect.any(String),
      expect.objectContaining({ expirationTtl: expect.any(Number) }),
    );
  });

  it("notifies when Feibot corrects a split time without changing its reader timestamp", async () => {
    const previousAudit = structuredClone(audit);
    previousAudit.officialResults[0].officialTimeMs = 7_100_000;
    previousAudit.officialResults[0].sectionTimeMs = 7_100_000;
    const values = new Map<string, unknown>([
      [
        "raceupshot:mobile-watchlist:v1:account%3Au1:event-1%3Aparticipant-1",
        {
          id: "event-1:participant-1",
          type: "live-athlete",
          eventId: "event-1",
          athleteId: "participant-1",
          label: "Runner",
          deviceId: "device-1",
          athlete: { participantUuid: "participant-1", bib: "1001" },
          updatedAt: "2026-10-19T10:00:00.000Z",
        },
      ],
      [
        "raceupshot:mobile-push:v1:account%3Au1:device-1",
        {
          owner: "account:u1",
          deviceId: "device-1",
          expoPushToken: "ExpoPushToken[test-token]",
        },
      ],
    ]);
    const kv = {
      list: vi.fn(async ({ prefix }: { prefix: string }) => ({
        keys: [...values.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })),
        list_complete: true,
        cacheStatus: null,
      })),
      get: vi.fn(async (key: string) => values.get(key) ?? null),
      put: vi.fn(async (key: string, value: unknown) => values.set(key, value)),
    } as any;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ status: "ok", id: "ticket-2" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      dispatchMobileTimingNotifications({
        kv,
        eventId: "event-1",
        previousAudit,
        audit,
      }),
    ).resolves.toEqual({ attempted: 1, delivered: 1 });
  });
});
