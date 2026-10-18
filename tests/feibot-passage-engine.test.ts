import { describe, expect, it } from "vitest";
import {
  formatDurationMs,
  processFeibotAthleteTiming,
  type FeibotRawRead,
  type TimingEngineConfiguration,
} from "../packages/timing-core/src";

const configuration: TimingEngineConfiguration = {
  eventUuid: "event-1",
  contestUuid: "contest-1",
  timingResultSource: "RACE_UPSHOT_ENGINE",
  resultTimeMode: "CHIP",
  gunStartTimestamp: "2026-08-07T12:30:00.000+05:30",
  startWindowOpenTimestamp: "2026-08-07T12:30:00.000+05:30",
  startWindowCloseTimestamp: "2026-08-07T13:30:00.000+05:30",
  eventEndTimestamp: "2026-08-07T18:00:00.000+05:30",
  passageGapMs: 5_000,
  readerDetectionTimeoutMs: {},
  sequence: [
    { timingPointKey: "start", timingPointUuid: "U750", name: "START", type: "START", order: 1, readerUuids: ["U750"] },
    { timingPointKey: "km-1", timingPointUuid: "U755", name: "1 KM", type: "SPLIT", order: 2, readerUuids: ["U755"] },
    { timingPointKey: "finish", timingPointUuid: "U750", name: "FINISH", type: "FINISH", order: 3, readerUuids: ["U750"] },
  ],
};

function read(id: string, timingPointUuid: string, readerTimestamp: string): FeibotRawRead {
  return {
    readId: id,
    eventUuid: "event-1",
    contestUuid: "contest-1",
    participantUuid: "athlete-1",
    bib: "1001",
    chipCode: "MC69897",
    timingPointUuid,
    readerUuid: timingPointUuid,
    antennaId: "1",
    rssi: -42,
    readerTimestamp,
    receivedAt: "2026-08-07T12:50:00.000+05:30",
    source: "CLOUD",
  };
}

const reads = [
  read("s1", "U750", "2026-08-07T12:30:14.843+05:30"),
  read("s2", "U750", "2026-08-07T12:30:15.917+05:30"),
  read("s3", "U750", "2026-08-07T12:30:17.232+05:30"),
  read("s4", "U750", "2026-08-07T12:30:18.344+05:30"),
  read("s5", "U750", "2026-08-07T12:30:19.804+05:30"),
  read("k1", "U755", "2026-08-07T12:43:25.793+05:30"),
  read("k2", "U755", "2026-08-07T12:43:27.165+05:30"),
  read("f1", "U750", "2026-08-07T12:43:42.887+05:30"),
  read("f2", "U750", "2026-08-07T12:43:44.181+05:30"),
  read("f3", "U750", "2026-08-07T12:43:45.472+05:30"),
];

describe("Feibot passage and sequence engine", () => {
  it("groups repeated reads and calculates the example to millisecond precision", () => {
    const result = processFeibotAthleteTiming({ configuration, rawReads: reads });
    expect(result.passages.map((passage) => [passage.firstTimestamp, passage.lastTimestamp, passage.readCount])).toEqual([
      ["2026-08-07T12:30:14.843+05:30", "2026-08-07T12:30:19.804+05:30", 5],
      ["2026-08-07T12:43:25.793+05:30", "2026-08-07T12:43:27.165+05:30", 2],
      ["2026-08-07T12:43:42.887+05:30", "2026-08-07T12:43:45.472+05:30", 3],
    ]);
    expect(result.decisions.map((decision) => decision.decision)).toEqual(["ACCEPTED", "ACCEPTED", "ACCEPTED"]);
    expect(result.state).toBe("FINISHED");
    expect(result.officialResults[1].chipTimeMs).toBe(790_950);
    expect(result.officialResults[2].chipTimeMs).toBe(808_044);
    expect(formatDurationMs(result.officialResults[1].chipTimeMs)).toBe("00:13:10.950");
    expect(formatDurationMs(result.officialResults[2].chipTimeMs)).toBe("00:13:28.044");
  });

  it("does not turn a second START/FINISH reader passage into FINISH before the split", () => {
    const extraStartReaderPassage = [
      ...reads.slice(0, 5),
      read("unexpected", "U750", "2026-08-07T12:35:00.000+05:30"),
      ...reads.slice(5),
    ];
    const result = processFeibotAthleteTiming({ configuration, rawReads: extraStartReaderPassage });
    expect(result.decisions[1]).toMatchObject({ decision: "DUPLICATE", reason: "timing_point_already_accepted" });
    expect(result.officialResults).toHaveLength(3);
    expect(result.officialResults[2].readerTimestamp).toBe("2026-08-07T12:43:42.887+05:30");
  });

  it("filters historical reads before passage creation", () => {
    const old = read("old", "U750", "2026-08-06T20:01:00.000+05:30");
    const result = processFeibotAthleteTiming({ configuration, rawReads: [old, ...reads] });
    expect(result.rawReads).toHaveLength(11);
    expect(result.rejectedRawReads).toContainEqual({ readId: "old", reason: "before_start_window" });
    expect(result.passages).toHaveLength(3);
  });

  it("applies only authorized manual overrides and labels their provenance", () => {
    const result = processFeibotAthleteTiming({
      configuration,
      rawReads: reads,
      manualOverrides: [{
        overrideId: "override-1",
        participantUuid: "athlete-1",
        timingPointKey: "km-1",
        readerTimestamp: "2026-08-07T12:42:00.000+05:30",
        source: "FIXED",
        authorized: true,
        authorizedBy: "admin-1",
        reason: "Photo verified correction",
        appliedAt: "2026-08-07T13:00:00.000+05:30",
      }],
    });
    expect(result.officialResults[1]).toMatchObject({
      source: "FIXED",
      status: "OVERRIDDEN",
      overrideWarning: "Manual result currently overrides automatic timing.",
    });
    expect(result.officialResults[1].chipTimeMs).toBe(705_157);
    expect(result.officialResults[2].sectionTimeMs).toBe(102_887);
  });

  it("keeps Feibot processed results isolated from raw passage calculations", () => {
    const result = processFeibotAthleteTiming({
      configuration: { ...configuration, timingResultSource: "FEIBOT_PROCESSED" },
      rawReads: reads,
      feibotProcessedResults: [{
        timingPointUuid: "U750",
        timingPointName: "START",
        readerTimestamp: "2026-08-07T12:35:45.000+05:30",
        gunTimeMs: 345_000,
        chipTimeMs: 0,
        sectionTimeMs: 0,
      }],
    });
    expect(result.passages).toEqual([]);
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0]).toMatchObject({ decision: "ACCEPTED", resolvedTimingPointKey: "start" });
    expect(result.officialResults[0].source).toBe("FEIBOT_PROCESSED");
    expect(result.state).not.toBe("FINISHED");
  });

  it("stores processed identity without inventing a diagnostic raw read", () => {
    const result = processFeibotAthleteTiming({
      configuration: { ...configuration, timingResultSource: "FEIBOT_PROCESSED" },
      rawReads: [],
      participantIdentity: { participantUuid: "processed-athlete", bib: "34", chipCode: "chip-34" },
      feibotProcessedResults: [{
        timingPointKey: "start",
        timingPointUuid: "U750",
        timingPointName: "START",
        readerTimestamp: "2026-08-07T12:35:45.000+05:30",
        gunTimeMs: 345_000,
        chipTimeMs: 0,
        sectionTimeMs: 0,
      }],
    });
    expect(result).toMatchObject({ participantUuid: "processed-athlete", bib: "34", chipCode: "chip-34" });
    expect(result.rawReads).toEqual([]);
    expect(result.officialResults[0]).toMatchObject({ participantUuid: "processed-athlete", bib: "34", chipCode: "chip-34", passageId: "feibot-processed-1" });
    expect(result.decisions.find((decision) => decision.passageId === result.officialResults[0].passageId)).toMatchObject({ decision: "ACCEPTED" });
  });

  it("never promotes an unmapped last processed row to FINISH", () => {
    const result = processFeibotAthleteTiming({
      configuration: { ...configuration, timingResultSource: "FEIBOT_PROCESSED" },
      rawReads: reads,
      feibotProcessedResults: [
        { timingPointKey: "start", timingPointUuid: "U750", timingPointName: "START", readerTimestamp: "2026-08-07T12:30:14.843+05:30", gunTimeMs: null, chipTimeMs: 0, sectionTimeMs: 0 },
        { timingPointUuid: "UNKNOWN", timingPointName: "SWIM FINISH", readerTimestamp: "2026-08-07T12:40:00.000+05:30", gunTimeMs: null, chipTimeMs: null, sectionTimeMs: null },
      ],
    });
    expect(result.state).toBe("WAITING_FOR_SPLIT_1");
    expect(result.officialResults.map((row) => row.timingPointKey)).toEqual(["start"]);
    expect(result.decisions.at(-1)).toMatchObject({ decision: "UNEXPECTED_PASSAGE", reason: "timing_point_not_configured" });
  });

  it("requires every configured point before a processed final finish", () => {
    const base = { ...configuration, timingResultSource: "FEIBOT_PROCESSED" as const };
    const start = { timingPointKey: "start", timingPointUuid: "U750", timingPointName: "START", readerTimestamp: "2026-08-07T12:30:14.843+05:30", gunTimeMs: null, chipTimeMs: 0, sectionTimeMs: 0 };
    const finish = { timingPointKey: "finish", timingPointUuid: "U750", timingPointName: "FINISH", readerTimestamp: "2026-08-07T12:43:42.887+05:30", gunTimeMs: null, chipTimeMs: null, sectionTimeMs: null };
    const incomplete = processFeibotAthleteTiming({ configuration: base, rawReads: reads, feibotProcessedResults: [start, finish] });
    expect(incomplete.state).toBe("WAITING_FOR_SPLIT_1");
    expect(incomplete.officialResults).toHaveLength(1);
    expect(incomplete.decisions.at(-1)).toMatchObject({ reason: "required_preceding_timing_point_missing" });

    const complete = processFeibotAthleteTiming({
      configuration: base,
      rawReads: reads,
      feibotProcessedResults: [finish, start, { timingPointKey: "km-1", timingPointUuid: "U755", timingPointName: "1 KM", readerTimestamp: "2026-08-07T12:43:25.793+05:30", gunTimeMs: null, chipTimeMs: null, sectionTimeMs: null }],
    });
    expect(complete.state).toBe("FINISHED");
    expect(complete.officialResults.map((row) => row.timingPointKey)).toEqual(["start", "km-1", "finish"]);
  });

  it("reconstructs deterministically when a missing intermediate read arrives later", () => {
    const firstPass = processFeibotAthleteTiming({ configuration, rawReads: [reads[0], ...reads.slice(7)] });
    expect(firstPass.state).toBe("WAITING_FOR_SPLIT_1");
    expect(firstPass.officialResults).toHaveLength(1);
    const corrected = processFeibotAthleteTiming({ configuration, rawReads: [...reads].reverse() });
    expect(corrected.state).toBe("FINISHED");
    expect(corrected.officialResults.map((row) => row.timingPointKey)).toEqual(["start", "km-1", "finish"]);
  });

  it("rejects wrong-contest and outside-window reads without losing raw evidence", () => {
    const wrongContest = { ...read("wrong-contest", "U755", "2026-08-07T12:40:00.000+05:30"), contestUuid: "contest-2" };
    const afterWindow = read("late", "U755", "2026-08-07T18:01:00.000+05:30");
    const result = processFeibotAthleteTiming({ configuration, rawReads: [wrongContest, afterWindow, ...reads] });
    expect(result.rawReads).toHaveLength(reads.length + 2);
    expect(result.rejectedRawReads).toEqual(expect.arrayContaining([
      { readId: "wrong-contest", reason: "contest_mismatch" },
      { readId: "late", reason: "after_event_window" },
    ]));
    expect(result.state).toBe("FINISHED");
  });

  it("enforces the configured minimum finish gap", () => {
    const tooFast = [
      read("start", "U750", "2026-08-07T12:30:00.000+05:30"),
      read("split", "U755", "2026-08-07T12:30:20.000+05:30"),
      read("finish", "U750", "2026-08-07T12:30:40.000+05:30"),
    ];
    const result = processFeibotAthleteTiming({ configuration: { ...configuration, minimumFinishGapMs: 60_000 }, rawReads: tooFast });
    expect(result.state).toBe("WAITING_FOR_FINISH");
    expect(result.decisions.at(-1)).toMatchObject({ decision: "INELIGIBLE", reason: "before_minimum_finish_gap" });
  });

  it("assigns repeated shared-mat crossings by triathlon progression", () => {
    const sharedConfiguration: TimingEngineConfiguration = {
      ...configuration,
      sequence: [
        { timingPointKey: "swim_start", timingPointUuid: "START", name: "Swim Start", type: "START", order: 1, readerUuids: ["START"] },
        { timingPointKey: "swim_finish", timingPointUuid: "SHARED", name: "Swim Finish", type: "SPLIT", order: 2, readerUuids: ["SHARED"] },
        { timingPointKey: "bike_start", timingPointUuid: "SHARED", name: "Bike Start", type: "SPLIT", order: 3, readerUuids: ["SHARED"] },
        { timingPointKey: "bike_finish", timingPointUuid: "SHARED", name: "Bike Finish", type: "SPLIT", order: 4, readerUuids: ["SHARED"] },
        { timingPointKey: "run_start", timingPointUuid: "SHARED", name: "Run Start", type: "SPLIT", order: 5, readerUuids: ["SHARED"] },
        { timingPointKey: "run_finish", timingPointUuid: "FINISH", name: "Run Finish", type: "FINISH", order: 6, readerUuids: ["FINISH"] },
      ],
    };
    const triReads = [
      read("tri-start", "START", "2026-08-07T12:30:00.000+05:30"),
      read("tri-swim-finish", "SHARED", "2026-08-07T13:00:00.000+05:30"),
      read("tri-bike-start", "SHARED", "2026-08-07T13:02:00.000+05:30"),
      read("tri-bike-finish", "SHARED", "2026-08-07T14:02:00.000+05:30"),
      read("tri-run-start", "SHARED", "2026-08-07T14:04:00.000+05:30"),
      read("tri-run-finish", "FINISH", "2026-08-07T14:44:00.000+05:30"),
    ];
    const result = processFeibotAthleteTiming({ configuration: sharedConfiguration, rawReads: triReads });

    expect(result.state).toBe("FINISHED");
    expect(result.officialResults.map((row) => row.timingPointKey)).toEqual([
      "swim_start", "swim_finish", "bike_start", "bike_finish", "run_start", "run_finish",
    ]);
    expect(result.officialResults.map((row) => row.sectionTimeMs)).toEqual([
      0, 1_800_000, 120_000, 3_600_000, 120_000, 2_400_000,
    ]);
  });

  it("keeps every shared-mat swim, bike and run passage on its imported logical split", () => {
    const sequence: TimingEngineConfiguration["sequence"] = [
      { timingPointKey: "swim_start", timingPointUuid: "START", name: "Swim Start", type: "START", order: 1, passage: 1, readerUuids: ["START"] },
      { timingPointKey: "swim_700", timingPointUuid: "SWIM", name: "Swim 700 m", type: "SPLIT", order: 2, passage: 1, readerUuids: ["SWIM"] },
      { timingPointKey: "swim_finish", timingPointUuid: "SWIM", name: "Swim Finish", type: "SPLIT", order: 3, passage: 2, readerUuids: ["SWIM"] },
      { timingPointKey: "bike_1", timingPointUuid: "BIKE", name: "Bike Loop 1", type: "SPLIT", order: 4, passage: 1, readerUuids: ["BIKE"] },
      { timingPointKey: "bike_2", timingPointUuid: "BIKE", name: "Bike Loop 2", type: "SPLIT", order: 5, passage: 2, readerUuids: ["BIKE"] },
      { timingPointKey: "bike_3", timingPointUuid: "BIKE", name: "Bike Loop 3", type: "SPLIT", order: 6, passage: 3, readerUuids: ["BIKE"] },
      { timingPointKey: "bike_finish", timingPointUuid: "BIKE", name: "Bike Finish", type: "SPLIT", order: 7, passage: 4, readerUuids: ["BIKE"] },
      { timingPointKey: "run_1", timingPointUuid: "RUN", name: "Run Split 1", type: "SPLIT", order: 8, passage: 1, readerUuids: ["RUN"] },
      { timingPointKey: "run_finish", timingPointUuid: "RUN", name: "Run Finish", type: "FINISH", order: 9, passage: 2, readerUuids: ["RUN"] },
    ];
    const at = (id: string, point: string, minutes: number) => read(id, point, new Date(Date.parse("2026-08-07T07:00:00.000Z") + minutes * 60_000).toISOString());
    const allReads = [
      at("start", "START", 1), at("swim-700", "SWIM", 15), at("swim-finish", "SWIM", 31),
      at("bike-1", "BIKE", 60), at("bike-2", "BIKE", 90), at("bike-3", "BIKE", 120), at("bike-finish", "BIKE", 150),
      at("run-1", "RUN", 175), at("run-finish", "RUN", 200),
    ];
    const config = {
      ...configuration,
      gunStartTimestamp: "2026-08-07T07:00:00.000Z",
      startWindowOpenTimestamp: "2026-08-07T07:00:00.000Z",
      startWindowCloseTimestamp: "2026-08-07T08:00:00.000Z",
      eventEndTimestamp: "2026-08-07T13:00:00.000Z",
      sequence,
    };

    expect(processFeibotAthleteTiming({ configuration: config, rawReads: allReads.slice(0, 3) })).toMatchObject({
      state: "WAITING_FOR_SPLIT_3",
      officialResults: [{ timingPointKey: "swim_start" }, { timingPointKey: "swim_700" }, { timingPointKey: "swim_finish" }],
    });
    expect(processFeibotAthleteTiming({ configuration: config, rawReads: allReads.slice(0, 7) }).state).toBe("WAITING_FOR_SPLIT_7");
    expect(processFeibotAthleteTiming({ configuration: config, rawReads: allReads.slice(0, 8) }).state).toBe("WAITING_FOR_FINISH");
    const finished = processFeibotAthleteTiming({ configuration: config, rawReads: allReads });
    expect(finished.state).toBe("FINISHED");
    expect(finished.officialResults.map((row) => row.timingPointKey)).toEqual(sequence.map((point) => point.timingPointKey));
  });
});
