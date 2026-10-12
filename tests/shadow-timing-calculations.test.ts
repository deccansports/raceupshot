import { afterEach, describe, expect, it } from "vitest";
import * as sharedCore from "@race-technology/timing-calculations";
import { normalizeTimestampUtc } from "../packages/live-tracking-contracts/src/time";
import { emptyStartTimingState, normalizeStartConfiguration, processStartPassageRead, processStartTimingRead, resolveOfficialAthleteStart } from "../packages/live-tracking-contracts/src/start-timing";
import { calculateCanonicalDurations, selectCanonicalTimingRead } from "../packages/live-tracking-contracts/src/snapshot";
import {
  clearTimingParityTelemetry,
  configureTimingShadowForTests,
  flushTimingShadowWork,
  getTimingParityTelemetry,
  resetTimingShadowForTests,
  shadowNormalizeTimestampUtc,
} from "../packages/live-tracking-contracts/src/shadow-timing-calculations";

describe("timing shadow isolation", () => {
  afterEach(() => resetTimingShadowForTests());

  it("does not load shared-core or emit telemetry while off", async () => {
    let calls = 0;
    configureTimingShadowForTests({ mode: "off", loader: async () => { calls += 1; throw new Error("unavailable"); } });
    expect(shadowNormalizeTimestampUtc({ value: "ignored" }, "authoritative")).toBe("authoritative");
    await flushTimingShadowWork();
    expect(calls).toBe(0);
    expect(getTimingParityTelemetry()).toEqual([]);
  });

  it("records a match while returning the Race Upshot result", async () => {
    configureTimingShadowForTests({ mode: "shadow", loader: async () => sharedCore });
    expect(normalizeTimestampUtc("2026-10-04 06:00:00", "Asia/Kolkata")).toBe("2026-10-04T00:30:00.000Z");
    await flushTimingShadowWork();
    expect(getTimingParityTelemetry().at(-1)?.match).toBe(true);
  });

  it("matches shared-core across every wired operation group", async () => {
    configureTimingShadowForTests({ mode: "shadow", loader: async () => sharedCore });
    const configuration = normalizeStartConfiguration({ mode: "CHIP", gunStartTime: "2026-10-04T00:00:00.000Z", passageGapSeconds: 3 });
    resolveOfficialAthleteStart({ configuration, acceptedChipStartTime: "2026-10-04T00:00:10.000Z" });
    const startRead = { readId: "start-1", eventId: "event-1", contestUuid: "contest-1", participantUuid: "p1", providerParticipantUuid: "p1", bib: "101", chipCode: "chip-101", splitKey: "start", providerSplitId: "start", providerTimingPointId: "start", readerUuid: "reader-1", timestamp: "2026-10-04T00:00:10.000Z", occurredAt: "2026-10-04T00:00:10.000Z", receivedAt: "2026-10-04T00:00:10.100Z", timeOfDay: "00:00:10", elapsedSeconds: 0, overallElapsedSeconds: 0, segmentElapsedSeconds: null, chipElapsedSeconds: 0, gunElapsedSeconds: 10, waveElapsedSeconds: null, passNumber: 1, source: "feibot", status: "valid" } as any;
    processStartTimingRead({ configuration, currentState: emptyStartTimingState(), read: startRead });
    processStartPassageRead({ configuration, currentState: emptyStartTimingState(), activePassage: null, read: startRead });
    selectCanonicalTimingRead(null, startRead, { key: "start", readSelectionRule: "first", passNumber: null } as any);
    calculateCanonicalDurations({ start: startRead, finish: { ...startRead, readId: "finish-1", splitKey: "finish", timestamp: "2026-10-04T01:00:10.000Z", occurredAt: "2026-10-04T01:00:10.000Z", receivedAt: "2026-10-04T01:00:10.100Z", elapsedSeconds: 3600, overallElapsedSeconds: 3600, status: "official" } }, { splits: [{ key: "start", order: 0 }, { key: "finish", order: 1, isFinish: true, isRaceFinish: true }], legs: [{ type: "run", order: 0, startSplitKey: "start", finishSplitKey: "finish", distanceKm: 10 }], transitions: [], configuredRaceDistanceKm: 10, totalDistanceKm: 10 } as any);
    normalizeTimestampUtc("2026-10-04 06:00:00", "Asia/Kolkata");
    await flushTimingShadowWork();
    const expected = ["timestamp", "start_configuration", "start_resolution", "start_read", "start_passage", "read_selection", "durations"];
    const matching = new Set(getTimingParityTelemetry().filter((record) => record.match).map((record) => record.operation));
    expect(expected.filter((operation) => !matching.has(operation as any))).toEqual([]);
  });

  it("records an injected mismatch while returning the Race Upshot result", async () => {
    configureTimingShadowForTests({ mode: "shadow", loader: async () => ({ ...sharedCore, normalizeTimestampUtc: () => "different" }) as typeof sharedCore });
    expect(shadowNormalizeTimestampUtc({ value: "2026-10-04T00:00:00.000Z" }, "authoritative")).toBe("authoritative");
    await flushTimingShadowWork();
    expect(getTimingParityTelemetry().at(-1)?.differenceCategory).toBe("TIMESTAMP_NORMALIZATION_DIFFERENCE");
  });

  it("isolates a shared-core exception", async () => {
    configureTimingShadowForTests({ mode: "shadow", loader: async () => { throw new Error("shared unavailable"); } });
    expect(shadowNormalizeTimestampUtc({ value: "x" }, "authoritative")).toBe("authoritative");
    await flushTimingShadowWork();
    expect(getTimingParityTelemetry().at(-1)?.differenceCategory).toBe("SHARED_CORE_EXCEPTION");
  });

  it("isolates telemetry sink failure", async () => {
    clearTimingParityTelemetry();
    configureTimingShadowForTests({ mode: "shadow", loader: async () => sharedCore, sink: () => { throw new Error("sink unavailable"); } });
    expect(shadowNormalizeTimestampUtc({ value: "2026-10-04T00:00:00.000Z" }, "2026-10-04T00:00:00.000Z")).toBe("2026-10-04T00:00:00.000Z");
    await flushTimingShadowWork();
    expect(getTimingParityTelemetry().at(-1)?.match).toBe(true);
  });
});
