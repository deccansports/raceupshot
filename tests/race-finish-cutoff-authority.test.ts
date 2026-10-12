import { describe, expect, it } from "vitest";
import { hasValidatedConfiguredFinish, processFeibotAthleteTiming, type FeibotRawRead, type TimingEngineConfiguration } from "../packages/timing-core/src";
import { recalculateAthleteSnapshot } from "../packages/live-tracking-contracts/src/snapshot";
import { normalizeCanonicalCourse } from "../packages/live-tracking-contracts/src/course-normalizer";
import { mergeCanonicalParticipantState } from "../lib/canonical-live-tracking";
import { enforceConfiguredCutoffs } from "../lib/feibot-timing-processing";

const baseTime = Date.parse("2026-10-10T18:00:00.000Z");
const at = (seconds: number) => new Date(baseTime + seconds * 1_000).toISOString();

function read(id: string, point: string, seconds: number): FeibotRawRead {
  return {
    readId: id,
    eventUuid: "event",
    contestUuid: "contest",
    participantUuid: "athlete",
    bib: "34",
    chipCode: "chip-34",
    timingPointUuid: point,
    readerUuid: point,
    antennaId: null,
    rssi: null,
    readerTimestamp: at(seconds),
    receivedAt: at(seconds + 1),
    source: "CLOUD",
  };
}

const sharedMatConfiguration: TimingEngineConfiguration = {
  eventUuid: "event",
  contestUuid: "contest",
  timingResultSource: "RACE_UPSHOT_ENGINE",
  resultTimeMode: "GUN",
  gunStartTimestamp: at(0),
  startWindowOpenTimestamp: at(0),
  startWindowCloseTimestamp: at(600),
  eventEndTimestamp: at(10_000),
  passageGapMs: 3_000,
  readerDetectionTimeoutMs: {},
  sequence: [
    { timingPointKey: "start", timingPointUuid: "START", name: "Start", type: "START", order: 1, readerUuids: ["START"] },
    { timingPointKey: "run_1", timingPointUuid: "RUN_MAT", name: "Run 1", type: "SPLIT", order: 2, readerUuids: ["RUN_MAT"] },
    { timingPointKey: "run_2", timingPointUuid: "RUN_MAT", name: "Run 2", type: "SPLIT", order: 3, readerUuids: ["RUN_MAT"] },
    { timingPointKey: "race_finish", timingPointUuid: "RUN_MAT", name: "Race Finish", type: "FINISH", order: 4, readerUuids: ["RUN_MAT"] },
  ],
};

describe("race finish authority", () => {
  const cutoffConfig: any = {
    start: { strictFinalCutoff: true, timingMode: "GUN", gunStartAt: at(0), overallCutoffSeconds: 3_600, cutoffReconciliationSeconds: 600 },
    legs: [{ id: "run", type: "RUN", order: 1, cutoffSeconds: null }],
    splits: [
      { id: "start", name: "Start", legId: "run", order: 1, cutoffSeconds: null },
      { id: "run_1", name: "Run 1", legId: "run", order: 2, cutoffSeconds: null },
      { id: "run_2", name: "Run 2", legId: "run", order: 3, cutoffSeconds: null },
      { id: "race_finish", name: "Race Finish", legId: "run", order: 4, cutoffSeconds: null, isFinalRaceSplit: true },
    ],
  };

  it("stops at the deadline, then finalizes DNF only after reconciliation", () => {
    const audit = processFeibotAthleteTiming({ configuration: sharedMatConfiguration, rawReads: [read("start", "START", 10), read("run-1", "RUN_MAT", 1_000)] });
    const evaluate = (now: number) => enforceConfiguredCutoffs({ audit, previousAudit: null, configuration: sharedMatConfiguration, hubConfig: cutoffConfig, now: at(now) });
    expect(evaluate(3_599).state).toBe("WAITING_FOR_SPLIT_2");
    const pending = evaluate(3_600);
    expect(pending.state).toBe("CUTOFF_PENDING");
    expect(pending.statusReason).toBe("OVERALL_CUTOFF_EXCEEDED");
    expect(pending.cutoffDeadline).toBe(at(3_600));
    expect(hasValidatedConfiguredFinish(pending)).toBe(false);
    const dnf = evaluate(4_200);
    expect(dnf.state).toBe("DNF");
    expect(dnf.officialResults).toHaveLength(2);
    expect(hasValidatedConfiguredFinish(dnf)).toBe(false);
  });

  it("uses each athlete's accepted chip start and a 30-minute reconciliation window", () => {
    const audit = processFeibotAthleteTiming({ configuration: sharedMatConfiguration, rawReads: [read("start", "START", 10)] });
    const config = { ...cutoffConfig, start: { ...cutoffConfig.start, timingMode: "CHIP", cutoffReconciliationSeconds: 1_800 } };
    const evaluate = (now: number) => enforceConfiguredCutoffs({ audit, previousAudit: null, configuration: sharedMatConfiguration, hubConfig: config, now: at(now) });
    expect(evaluate(3_600).state).toBe("WAITING_FOR_SPLIT_1");
    expect(evaluate(3_610)).toMatchObject({ state: "CUTOFF_PENDING", cutoffDeadline: at(3_610), cutoffReconcileAt: at(5_410) });
    expect(evaluate(5_409).state).toBe("CUTOFF_PENDING");
    expect(evaluate(5_410).state).toBe("DNF");
  });

  it("reinstates a valid physical finish received after the cutoff but read before it", () => {
    const previous = processFeibotAthleteTiming({ configuration: sharedMatConfiguration, rawReads: [read("start", "START", 10), read("run-1", "RUN_MAT", 1_000)] });
    const dnf = enforceConfiguredCutoffs({ audit: previous, previousAudit: null, configuration: sharedMatConfiguration, hubConfig: cutoffConfig, now: at(4_200) });
    const completed = processFeibotAthleteTiming({ configuration: sharedMatConfiguration, rawReads: [read("start", "START", 10), read("run-1", "RUN_MAT", 1_000), read("run-2", "RUN_MAT", 2_000), read("finish", "RUN_MAT", 3_500)] });
    const restored = enforceConfiguredCutoffs({ audit: completed, previousAudit: dnf, configuration: sharedMatConfiguration, hubConfig: cutoffConfig, now: at(4_300) });
    expect(restored.state).toBe("FINISHED");
    expect(hasValidatedConfiguredFinish(restored)).toBe(true);
    const tooLate = processFeibotAthleteTiming({ configuration: sharedMatConfiguration, rawReads: [read("start", "START", 10), read("run-1", "RUN_MAT", 1_000), read("run-2", "RUN_MAT", 2_000), read("finish", "RUN_MAT", 3_700)] });
    const rejected = enforceConfiguredCutoffs({ audit: tooLate, previousAudit: dnf, configuration: sharedMatConfiguration, hubConfig: cutoffConfig, now: at(4_300) });
    expect(rejected.state).toBe("DNF");
    expect(rejected.officialResults.at(-1)?.readerTimestamp).toBe(at(3_700));
    expect(hasValidatedConfiguredFinish(rejected)).toBe(false);
  });

  it("applies an earlier stage deadline independently of the overall cutoff", () => {
    const audit = processFeibotAthleteTiming({ configuration: sharedMatConfiguration, rawReads: [read("start", "START", 10)] });
    const config = { ...cutoffConfig, splits: cutoffConfig.splits.map((split: any) => split.id === "run_1" ? { ...split, cutoffSeconds: 900 } : split) };
    const stopped = enforceConfiguredCutoffs({ audit, previousAudit: null, configuration: sharedMatConfiguration, hubConfig: config, now: at(900) });
    expect(stopped.state).toBe("CUTOFF_PENDING");
    expect(stopped.failedCheckpoint).toBe("run_1");
    expect(stopped.cutoffDeadline).toBe(at(900));
  });

  it("does not create or preserve an automatic DNF when strict cutoff enforcement is disabled", () => {
    const finished = processFeibotAthleteTiming({
      configuration: sharedMatConfiguration,
      rawReads: [read("start", "START", 10), read("run-1", "RUN_MAT", 1_000), read("run-2", "RUN_MAT", 2_000), read("finish", "RUN_MAT", 3_000)],
    });
    const staleDnf = { ...finished, state: "DNF" as const, statusSource: "AUTO_CUTOFF_RULE" as const };
    const resolved = enforceConfiguredCutoffs({
      audit: staleDnf,
      previousAudit: staleDnf,
      configuration: sharedMatConfiguration,
      hubConfig: { start: { strictFinalCutoff: false } } as any,
      now: at(4_000),
    });
    expect(resolved.state).toBe("FINISHED");
    expect(resolved.statusSource).toBeNull();
  });

  it("normalizes a provider Run 1 Finish label as an intermediate checkpoint", () => {
    const course = normalizeCanonicalCourse({
      eventId: "event",
      buildVersion: "build",
      source: "feibot_cloud",
      timezone: "UTC",
      contestMappings: [{
        providerContestUuid: "contest",
        bergmanTicketId: "ticket",
        raceType: "running",
        configuredRaceDistanceKm: 10,
        legDistancesKm: { run: 10 },
      }],
      timingRules: {
        legs: [{ leg_uuid: "run-leg", contest_uuid: "contest", leg_name: "Run", order: 1 }],
        splits: [
          { split_uuid: "start", contest_uuid: "contest", leg_uuid: "run-leg", split_name: "Run Start", order: 1, distanceFromStartKm: 0, timing_point_uuid: "START" },
          { split_uuid: "run-1", contest_uuid: "contest", leg_uuid: "run-leg", split_name: "Run 1 Finish", order: 2, distanceFromStartKm: 3, timing_point_uuid: "RUN_MAT" },
          { split_uuid: "run-2", contest_uuid: "contest", leg_uuid: "run-leg", split_name: "Run 2", order: 3, distanceFromStartKm: 7, timing_point_uuid: "RUN_MAT" },
          { split_uuid: "finish", contest_uuid: "contest", leg_uuid: "run-leg", split_name: "Race Finish", order: 4, distanceFromStartKm: 10, timing_point_uuid: "RUN_MAT" },
        ],
      },
    });
    const splits = course.contests[0].splits;
    expect(splits.find((split) => split.providerSplitId === "run-1")?.isRaceFinish).toBe(false);
    expect(splits.find((split) => split.providerSplitId === "run-1")?.isFinish).toBe(false);
    expect(splits.at(-1)?.providerSplitId).toBe("finish");
    expect(splits.at(-1)?.isRaceFinish).toBe(true);
  });

  it("keeps Run 1 and Run 2 in progress on a shared physical mat", () => {
    const run1 = processFeibotAthleteTiming({
      configuration: sharedMatConfiguration,
      rawReads: [read("start", "START", 10), read("run-1", "RUN_MAT", 1_000)],
    });
    expect(run1.state).toBe("WAITING_FOR_SPLIT_2");
    expect(run1.officialResults.at(-1)?.timingPointKey).toBe("run_1");

    const run2 = processFeibotAthleteTiming({
      configuration: sharedMatConfiguration,
      rawReads: [read("start", "START", 10), read("run-1", "RUN_MAT", 1_000), read("run-2", "RUN_MAT", 2_000)],
    });
    expect(run2.state).toBe("WAITING_FOR_FINISH");
    expect(run2.officialResults.at(-1)?.timingPointKey).toBe("run_2");

    const finished = processFeibotAthleteTiming({
      configuration: sharedMatConfiguration,
      rawReads: [read("start", "START", 10), read("run-1", "RUN_MAT", 1_000), read("run-2", "RUN_MAT", 2_000), read("finish", "RUN_MAT", 3_000)],
    });
    expect(finished.state).toBe("FINISHED");
    expect(finished.officialResults.at(-1)?.timingPointKey).toBe("race_finish");
  });

  it("does not finish a completed sequence that has no designated final FINISH", () => {
    const invalid = {
      ...sharedMatConfiguration,
      sequence: sharedMatConfiguration.sequence.slice(0, 3),
    };
    const result = processFeibotAthleteTiming({
      configuration: invalid,
      rawReads: [read("start", "START", 10), read("run-1", "RUN_MAT", 1_000), read("run-2", "RUN_MAT", 2_000)],
    });
    expect(result.state).toBe("CONFIGURATION_INCOMPLETE");
  });

  it("recognizes legacy STARTED audits only when their accepted final point is the sole FINISH", () => {
    const completed = processFeibotAthleteTiming({
      configuration: sharedMatConfiguration,
      rawReads: [read("start", "START", 10), read("run-1", "RUN_MAT", 1_000), read("run-2", "RUN_MAT", 2_000), read("finish", "RUN_MAT", 3_000)],
    });
    expect(hasValidatedConfiguredFinish({ ...completed, state: "STARTED" })).toBe(true);
    expect(hasValidatedConfiguredFinish({ ...completed, state: "DNF", statusSource: "AUTO_CUTOFF_RULE" })).toBe(false);
    expect(hasValidatedConfiguredFinish({ ...completed, officialResults: completed.officialResults.slice(0, -1) })).toBe(false);
  });

  it("does not let a stale finished projection override an enforced DNF", () => {
    const base: any = {
      eventId: "event", participantUid: "athlete", bib: "34", displayName: "Athlete", initials: "A",
      contestName: "10K", raceStatus: "FINISHED", elapsedTime: "01:01:40.000", cumulativeTime: "01:01:40.000",
      overallRank: 1, splits: [{ splitId: "race_finish", name: "Race Finish", cumulativeTime: "01:01:40.000" }],
    };
    const cutoff: any = { ...base, raceStatus: "DNF", elapsedTime: undefined, cumulativeTime: undefined, overallRank: undefined };
    const merged = mergeCanonicalParticipantState(base, cutoff);
    expect(merged.raceStatus).toBe("DNF");
    expect(merged.elapsedTime).toBeUndefined();
    expect(merged.cumulativeTime).toBeUndefined();
    expect(merged.overallRank).toBeUndefined();
    expect(merged.splits).toHaveLength(1);
  });

  it("locks cutoff DNF, preserves splits, and suppresses late finish time", () => {
    const contest: any = {
      raceType: "running",
      totalDistanceKm: 10,
      configuredRaceDistanceKm: 10,
      timezone: "UTC",
      startConfiguration: {
        mode: "GUN",
        gunStartTime: at(0),
        strictFinalCutoff: true,
        requireMandatorySplitsBeforeFinish: true,
      },
      cutoffs: { overall: 3_600 },
      legs: [{ key: "run", type: "run", order: 1, startSplitKey: "start", finishSplitKey: "race_finish", distanceKm: 10 }],
      transitions: [],
      sections: [],
      splits: [
        { key: "start", displayName: "Start", legType: "run", order: 1, distanceInLegKm: 0, cumulativeDistanceKm: 0, isStart: true, isRaceStart: true, required: true },
        { key: "run_1", displayName: "Run 1", legType: "run", order: 2, distanceInLegKm: 3, cumulativeDistanceKm: 3, required: true },
        { key: "run_2", displayName: "Run 2", legType: "run", order: 3, distanceInLegKm: 7, cumulativeDistanceKm: 7, required: true },
        { key: "race_finish", displayName: "Race Finish", legType: "run", order: 4, distanceInLegKm: 10, cumulativeDistanceKm: 10, isFinish: true, isRaceFinish: true, required: true },
      ],
    };
    const valid = (id: string, seconds: number): any => ({ readId: id, status: "valid", elapsedSeconds: seconds, timestamp: at(seconds), occurredAt: at(seconds) });
    const snapshot: any = {
      identity: { participantUuid: "athlete", bib: "34" },
      updatedAt: at(1_000),
      raceState: { status: "running" },
      startTiming: { officialStartTime: at(0), chipStartDetectionTime: at(10), startTimeSource: "GUN", startTimeLocked: true },
      reads: { start: valid("start", 10), run_1: valid("run-1", 1_000), run_2: null, race_finish: null },
      splits: [],
      calculated: {},
      splitRankings: {},
      sections: [],
      overallRanking: { overallRank: null, genderRank: null, ageGroupRank: null, clubRank: null },
      location: null,
    };

    const inProgress = recalculateAthleteSnapshot(snapshot, contest, at(1_500));
    expect(inProgress.raceState.resolved?.status).toBe("ON_COURSE");
    expect(inProgress.raceState.resolved?.nextExpectedSplit?.splitKey).toBe("run_2");
    expect(inProgress.calculated.overallSeconds).toBeNull();
    expect(inProgress.raceState.resolved?.estimatedFinishTime).toBeNull();

    const dnf = recalculateAthleteSnapshot(inProgress, contest, at(3_600));
    expect(dnf.raceState.resolved?.status).toBe("DNF");
    expect(dnf.raceState.statusReason).toBe("FINISH_CUTOFF_EXCEEDED");
    expect(dnf.calculated.overallSeconds).toBeNull();

    const lateFinishInput: any = {
      ...dnf,
      reads: {
        ...dnf.reads,
        run_2: valid("run-2", 2_500),
        race_finish: valid("late-finish", 3_700),
      },
    };
    const afterLateFinish = recalculateAthleteSnapshot(lateFinishInput, contest, at(3_800));
    expect(afterLateFinish.raceState.resolved?.status).toBe("DNF");
    expect(afterLateFinish.raceState.resolved?.finalSplitAccepted).toBe(false);
    expect(afterLateFinish.calculated.overallSeconds).toBeNull();
    expect(afterLateFinish.reads.race_finish).not.toBeNull();
  });
});
