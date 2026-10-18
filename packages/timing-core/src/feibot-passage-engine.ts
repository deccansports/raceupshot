export const TIMING_RESULT_SOURCES = ["FEIBOT_PROCESSED", "RACE_UPSHOT_ENGINE"] as const;
export type TimingResultSource = (typeof TIMING_RESULT_SOURCES)[number];

export const RESULT_TIME_MODES = ["CHIP", "GUN"] as const;
export type ResultTimeMode = (typeof RESULT_TIME_MODES)[number];

export type RawReadSource = "UDP" | "CLOUD" | "FIXED" | "MANUAL";
export type OfficialResultSource = "AUTO" | "FIXED" | "MANUAL" | "FEIBOT_PROCESSED";
export type PassageDecision = "ACCEPTED" | "DUPLICATE" | "UNEXPECTED_PASSAGE" | "INELIGIBLE";

export interface FeibotRawRead {
  readId: string;
  eventUuid: string;
  contestUuid: string;
  participantUuid: string;
  bib: string;
  chipCode: string;
  timingPointUuid: string;
  /** Provider-supplied logical use/pass number when available. */
  passage?: number | null;
  readerUuid: string;
  antennaId: string | null;
  rssi: number | null;
  readerTimestamp: string;
  receivedAt: string | null;
  source: RawReadSource;
}

export interface CourseTimingPoint {
  timingPointKey: string;
  timingPointUuid: string;
  name: string;
  type: "START" | "SPLIT" | "FINISH";
  order: number;
  /** Feibot's logical use/pass number when one physical point is reused. */
  passage?: number;
  /** Missing optional checkpoints do not block a later configured checkpoint. */
  required?: boolean;
  /** Presentation metadata only; never used to discard physical evidence. */
  publicVisible?: boolean;
  readerUuids: string[];
}

export interface TimingEngineConfiguration {
  eventUuid: string;
  contestUuid: string;
  timingResultSource: TimingResultSource;
  resultTimeMode: ResultTimeMode;
  gunStartTimestamp: string;
  startWindowOpenTimestamp: string;
  startWindowCloseTimestamp: string | null;
  eventEndTimestamp: string | null;
  passageGapMs: number;
  readerDetectionTimeoutMs: Record<string, number>;
  sequence: CourseTimingPoint[];
  /** Reject a final passage that is implausibly close to the accepted start. */
  minimumFinishGapMs?: number;
}

export interface TimingPassage {
  passageId: string;
  eventUuid: string;
  contestUuid: string;
  participantUuid: string;
  bib: string;
  chipCode: string;
  timingPointUuid: string;
  passage?: number | null;
  readerUuid: string;
  firstTimestamp: string;
  lastTimestamp: string;
  readCount: number;
  rawReadIds: string[];
  source: "AUTO";
}

export interface TimingDecision {
  passageId: string;
  decision: PassageDecision;
  expectedTimingPointUuid: string | null;
  expectedTimingPointKey: string | null;
  resolvedTimingPointUuid: string | null;
  resolvedTimingPointKey: string | null;
  reason: string;
}

export interface ManualTimingOverride {
  overrideId: string;
  participantUuid: string;
  timingPointKey: string;
  readerTimestamp: string;
  source: "FIXED" | "MANUAL";
  authorized: boolean;
  authorizedBy: string;
  reason: string;
  appliedAt: string;
}

export interface FeibotProcessedTimingResult {
  timingPointKey?: string;
  timingPointUuid: string;
  timingPointName: string;
  readerTimestamp: string;
  gunTimeMs: number | null;
  chipTimeMs: number | null;
  sectionTimeMs: number | null;
}

export interface OfficialTimingPointResult {
  eventUuid: string;
  contestUuid: string;
  participantUuid: string;
  bib: string;
  chipCode: string;
  timingPointUuid: string;
  timingPointKey: string;
  timingPointName: string;
  timingPointType: CourseTimingPoint["type"];
  readerTimestamp: string;
  gunStartTimestamp: string;
  chipStartTimestamp: string;
  gunTimeMs: number;
  chipTimeMs: number;
  sectionTimeMs: number;
  officialTimeMs: number;
  resultTimeMode: ResultTimeMode;
  passageId: string | null;
  readCount: number;
  source: OfficialResultSource;
  status: "PROVISIONAL" | "OVERRIDDEN";
  overrideWarning: string | null;
}

export interface AthleteTimingAudit {
  eventUuid: string;
  contestUuid: string;
  participantUuid: string;
  bib: string;
  chipCode: string;
  timingResultSource: TimingResultSource;
  state: string;
  statusReason?: string | null;
  statusSource?: "AUTO_CUTOFF_RULE" | "MANUAL_OVERRIDE" | null;
  statusResolvedAt?: string | null;
  failedCheckpoint?: string | null;
  cutoffSeconds?: number | null;
  cutoffDeadline?: string | null;
  elapsedAtResolution?: number | null;
  /** Earliest time at which a missing checkpoint may become a final DNF. */
  cutoffReconcileAt?: string | null;
  rawReads: FeibotRawRead[];
  passages: TimingPassage[];
  decisions: TimingDecision[];
  officialResults: OfficialTimingPointResult[];
  manualOverrides: ManualTimingOverride[];
  rejectedRawReads: Array<{ readId: string; reason: string }>;
}

/**
 * Accept current and legacy audits only when their sequentially accepted
 * official results end at the single configured FINISH point. Provider labels
 * are never inspected, so an intermediate "Run 1 Finish" cannot qualify.
 */
export function hasValidatedConfiguredFinish(audit: AthleteTimingAudit | null | undefined): boolean {
  if (!audit?.officialResults?.length || ["CUTOFF_PENDING", "DNF", "DNS", "DNQ", "DSQ", "OTL"].includes(audit.state)) return false;
  const finishResults = audit.officialResults.filter((result) => result.timingPointType === "FINISH");
  const latest = audit.officialResults.at(-1);
  return finishResults.length === 1
    && latest?.timingPointType === "FINISH"
    && finishResults[0]?.timingPointKey === latest.timingPointKey;
}

function timestampMs(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be a valid timestamp.`);
  return parsed;
}

function passageId(read: FeibotRawRead, firstTimestamp: string): string {
  const safe = `${read.eventUuid}:${read.contestUuid}:${read.participantUuid}:${read.chipCode}:${read.timingPointUuid}:${read.readerUuid}:${firstTimestamp}`;
  let hash = 2166136261;
  for (let index = 0; index < safe.length; index += 1) {
    hash ^= safe.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `passage-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function expectedState(sequence: CourseTimingPoint[], index: number): string {
  if (index >= sequence.length) {
    const configuredFinishIsFinal = sequence.length > 1
      && sequence[0]?.type === "START"
      && sequence.at(-1)?.type === "FINISH"
      && sequence.slice(0, -1).every((point) => point.type !== "FINISH");
    return configuredFinishIsFinal ? "FINISHED" : "CONFIGURATION_INCOMPLETE";
  }
  const point = sequence[index];
  if (point.type === "START") return "WAITING_FOR_START";
  if (point.type === "FINISH") return "WAITING_FOR_FINISH";
  return `WAITING_FOR_SPLIT_${index}`;
}

function canSkipOptionalPoints(sequence: CourseTimingPoint[], fromIndex: number, toIndex: number): boolean {
  return toIndex >= fromIndex
    && sequence.slice(fromIndex, toIndex).every((point) => point.required === false && point.type !== "START" && point.type !== "FINISH");
}

function completedConfiguredSequence(sequence: CourseTimingPoint[], results: OfficialTimingPointResult[]): boolean {
  const acceptedKeys = new Set(results.map((result) => result.timingPointKey));
  const finish = sequence.at(-1);
  return Boolean(
    sequence.length > 1
    && sequence[0]?.type === "START"
    && finish?.type === "FINISH"
    && sequence.slice(0, -1).every((point) => point.type !== "FINISH")
    && acceptedKeys.has(finish.timingPointKey)
    && sequence.filter((point) => point.required !== false).every((point) => acceptedKeys.has(point.timingPointKey)),
  );
}

function stateAfterResults(sequence: CourseTimingPoint[], results: OfficialTimingPointResult[]): string {
  if (completedConfiguredSequence(sequence, results)) return "FINISHED";
  const acceptedKeys = new Set(results.map((result) => result.timingPointKey));
  const lastAcceptedIndex = sequence.reduce(
    (latest, point, index) => acceptedKeys.has(point.timingPointKey) ? Math.max(latest, index) : latest,
    -1,
  );
  let nextIndex = lastAcceptedIndex + 1;
  while (nextIndex < sequence.length && sequence[nextIndex]?.required === false) nextIndex += 1;
  return expectedState(sequence, nextIndex);
}

function eligibleRead(
  read: FeibotRawRead,
  configuration: TimingEngineConfiguration,
): string | null {
  if (read.eventUuid !== configuration.eventUuid) return "event_mismatch";
  if (read.contestUuid !== configuration.contestUuid) return "contest_mismatch";
  if (read.source === "FIXED" || read.source === "MANUAL") return "manual_read_requires_override_workflow";
  const point = configuration.sequence.find((candidate) => candidate.timingPointUuid === read.timingPointUuid);
  if (!point) return "timing_point_not_configured";
  if (!point.readerUuids.includes(read.readerUuid)) return "reader_not_assigned_to_timing_point";
  const occurredAt = timestampMs(read.readerTimestamp, "readerTimestamp");
  const startWindow = timestampMs(configuration.startWindowOpenTimestamp, "startWindowOpenTimestamp");
  if (occurredAt < startWindow) return "before_start_window";
  if (configuration.eventEndTimestamp && occurredAt > timestampMs(configuration.eventEndTimestamp, "eventEndTimestamp")) {
    return "after_event_window";
  }
  return null;
}

export function groupFeibotPassages(
  reads: FeibotRawRead[],
  configuration: TimingEngineConfiguration,
): { passages: TimingPassage[]; rejectedRawReads: Array<{ readId: string; reason: string }> } {
  const rejectedRawReads: Array<{ readId: string; reason: string }> = [];
  const windowEligible = reads
    .filter((read) => {
      const reason = eligibleRead(read, configuration);
      if (reason) rejectedRawReads.push({ readId: read.readId, reason });
      return !reason;
    })
    .sort((left, right) => timestampMs(left.readerTimestamp, "readerTimestamp") - timestampMs(right.readerTimestamp, "readerTimestamp"));
  const identity = windowEligible[0];
  const eligible = windowEligible.filter((read) => {
    const reason = identity && read.participantUuid !== identity.participantUuid
      ? "participant_mismatch"
      : identity && read.chipCode !== identity.chipCode
        ? "chip_mismatch"
        : null;
    if (reason) rejectedRawReads.push({ readId: read.readId, reason });
    return !reason;
  });
  const passages: TimingPassage[] = [];
  const latestByDetection = new Map<string, TimingPassage>();
  for (const read of eligible) {
    const detectionKey = `${read.chipCode}:${read.timingPointUuid}:${read.readerUuid}:${read.passage ?? ""}`;
    const previous = latestByDetection.get(detectionKey);
    const timeout = Math.max(
      configuration.passageGapMs,
      configuration.readerDetectionTimeoutMs[read.readerUuid] ?? 0,
    );
    const sameDetection = previous
      && previous.chipCode === read.chipCode
      && previous.timingPointUuid === read.timingPointUuid
      && previous.readerUuid === read.readerUuid
      && timestampMs(read.readerTimestamp, "readerTimestamp") - timestampMs(previous.lastTimestamp, "lastTimestamp") <= timeout;
    if (sameDetection) {
      previous.lastTimestamp = read.readerTimestamp;
      previous.readCount += 1;
      previous.rawReadIds.push(read.readId);
      continue;
    }
    passages.push({
      passageId: passageId(read, read.readerTimestamp),
      eventUuid: read.eventUuid,
      contestUuid: read.contestUuid,
      participantUuid: read.participantUuid,
      bib: read.bib,
      chipCode: read.chipCode,
      timingPointUuid: read.timingPointUuid,
      passage: read.passage ?? null,
      readerUuid: read.readerUuid,
      firstTimestamp: read.readerTimestamp,
      lastTimestamp: read.readerTimestamp,
      readCount: 1,
      rawReadIds: [read.readId],
      source: "AUTO",
    });
    latestByDetection.set(detectionKey, passages.at(-1)!);
  }
  return {
    passages: passages.sort((left, right) => timestampMs(left.firstTimestamp, "firstTimestamp") - timestampMs(right.firstTimestamp, "firstTimestamp")),
    rejectedRawReads,
  };
}

function calculateResult(
  passage: TimingPassage,
  point: CourseTimingPoint,
  configuration: TimingEngineConfiguration,
  chipStartTimestamp: string,
  previousTimestamp: string | null,
): OfficialTimingPointResult {
  const readerTimestampMs = timestampMs(passage.firstTimestamp, "readerTimestamp");
  const gunTimeMs = Math.max(0, readerTimestampMs - timestampMs(configuration.gunStartTimestamp, "gunStartTimestamp"));
  const chipTimeMs = Math.max(0, readerTimestampMs - timestampMs(chipStartTimestamp, "chipStartTimestamp"));
  const sectionTimeMs = previousTimestamp
    ? Math.max(0, readerTimestampMs - timestampMs(previousTimestamp, "previousTimestamp"))
    : 0;
  return {
    eventUuid: passage.eventUuid,
    contestUuid: passage.contestUuid,
    participantUuid: passage.participantUuid,
    bib: passage.bib,
    chipCode: passage.chipCode,
    timingPointUuid: point.timingPointUuid,
    timingPointKey: point.timingPointKey,
    timingPointName: point.name,
    timingPointType: point.type,
    readerTimestamp: passage.firstTimestamp,
    gunStartTimestamp: configuration.gunStartTimestamp,
    chipStartTimestamp,
    gunTimeMs,
    chipTimeMs,
    sectionTimeMs,
    officialTimeMs: configuration.resultTimeMode === "GUN" ? gunTimeMs : chipTimeMs,
    resultTimeMode: configuration.resultTimeMode,
    passageId: passage.passageId,
    readCount: passage.readCount,
    source: "AUTO",
    status: "PROVISIONAL",
    overrideWarning: null,
  };
}

function applyOverrides(
  results: OfficialTimingPointResult[],
  overrides: ManualTimingOverride[],
  configuration: TimingEngineConfiguration,
  identity?: Pick<FeibotRawRead, "participantUuid" | "bib" | "chipCode">,
): OfficialTimingPointResult[] {
  const authorized = overrides.filter((override) => override.authorized);
  if (!authorized.length) return results;
  const selected = new Map<string, ManualTimingOverride>();
  for (const override of authorized.sort((a, b) => timestampMs(a.appliedAt, "appliedAt") - timestampMs(b.appliedAt, "appliedAt"))) {
    selected.set(override.timingPointKey, override);
  }
  const timestamps = new Map(results.map((result) => [result.timingPointKey, result.readerTimestamp]));
  for (const [timingPointKey, override] of selected) timestamps.set(timingPointKey, override.readerTimestamp);
  const startPoint = configuration.sequence[0];
  const chipStartTimestamp = timestamps.get(startPoint.timingPointKey);
  if (!chipStartTimestamp) return results;
  let previousTimestamp: string | null = null;
  const recalculated: OfficialTimingPointResult[] = [];
  for (const point of configuration.sequence) {
    const readerTimestamp = timestamps.get(point.timingPointKey);
    if (!readerTimestamp) {
      if (point.required === false) continue;
      break;
    }
    if (previousTimestamp && timestampMs(readerTimestamp, "readerTimestamp") < timestampMs(previousTimestamp, "previousTimestamp")) {
      throw new Error(`Manual override for ${point.timingPointKey} violates the configured course sequence.`);
    }
    const automatic = results.find((result) => result.timingPointKey === point.timingPointKey);
    const override = selected.get(point.timingPointKey);
    const syntheticPassage: TimingPassage = {
      passageId: automatic?.passageId ?? `override-${override?.overrideId ?? point.timingPointKey}`,
      eventUuid: configuration.eventUuid,
      contestUuid: configuration.contestUuid,
      participantUuid: automatic?.participantUuid ?? results[0]?.participantUuid ?? identity?.participantUuid ?? "",
      bib: automatic?.bib ?? results[0]?.bib ?? identity?.bib ?? "",
      chipCode: automatic?.chipCode ?? results[0]?.chipCode ?? identity?.chipCode ?? "",
      timingPointUuid: point.timingPointUuid,
      readerUuid: automatic?.passageId ?? "MANUAL",
      firstTimestamp: readerTimestamp,
      lastTimestamp: readerTimestamp,
      readCount: automatic?.readCount ?? 0,
      rawReadIds: [],
      source: "AUTO",
    };
    const calculated = calculateResult(syntheticPassage, point, configuration, chipStartTimestamp, previousTimestamp);
    previousTimestamp = readerTimestamp;
    recalculated.push({
      ...calculated,
      passageId: automatic?.passageId ?? null,
      readCount: automatic?.readCount ?? 0,
      source: override?.source ?? automatic?.source ?? "AUTO",
      status: override ? "OVERRIDDEN" as const : automatic?.status ?? "PROVISIONAL",
      overrideWarning: override ? "Manual result currently overrides automatic timing." : null,
    });
  }
  return recalculated;
}

export function processFeibotAthleteTiming(input: {
  configuration: TimingEngineConfiguration;
  rawReads: FeibotRawRead[];
  manualOverrides?: ManualTimingOverride[];
  feibotProcessedResults?: FeibotProcessedTimingResult[];
  participantIdentity?: Pick<FeibotRawRead, "participantUuid" | "bib" | "chipCode">;
}): AthleteTimingAudit {
  const { configuration } = input;
  const firstRead = input.rawReads[0];
  const identity = input.participantIdentity ?? firstRead;
  if (configuration.timingResultSource === "FEIBOT_PROCESSED") {
    const processed = [...(input.feibotProcessedResults ?? [])]
      .map((result, sourceIndex) => ({ result, sourceIndex }))
      .sort((left, right) => timestampMs(left.result.readerTimestamp, "readerTimestamp") - timestampMs(right.result.readerTimestamp, "readerTimestamp") || left.sourceIndex - right.sourceIndex);
    const decisions: TimingDecision[] = [];
    const accepted: Array<{ result: FeibotProcessedTimingResult; point: CourseTimingPoint; sourceIndex: number }> = [];
    let expectedIndex = 0;
    for (const row of processed) {
      const expected = configuration.sequence[expectedIndex] ?? null;
      const keyedIndex = row.result.timingPointKey
        ? configuration.sequence.findIndex((point) => point.timingPointKey === row.result.timingPointKey)
        : -1;
      const matchingIndexes = configuration.sequence
        .map((point, index) => point.timingPointUuid === row.result.timingPointUuid ? index : -1)
        .filter((index) => index >= 0);
      // A shared physical point is resolved by athlete progression. Explicit
      // logical keys remain authoritative when Feibot supplies them.
      const physicalResolvedIndex = matchingIndexes.includes(expectedIndex)
        ? expectedIndex
        : matchingIndexes.find((index) => index >= expectedIndex && canSkipOptionalPoints(configuration.sequence, expectedIndex, index)) ?? -1;
      const resolvedIndex = keyedIndex >= 0
        ? keyedIndex
        : physicalResolvedIndex;
      const resolved = resolvedIndex >= 0 ? configuration.sequence[resolvedIndex] : null;
      const passageId = `feibot-processed-${row.sourceIndex + 1}`;
      const skippedOnlyOptional = Boolean(expected && resolved && canSkipOptionalPoints(configuration.sequence, expectedIndex, resolvedIndex));
      if (!expected || !resolved || !skippedOnlyOptional) {
        const alreadyAccepted = resolvedIndex >= 0 && resolvedIndex < expectedIndex;
        decisions.push({
          passageId,
          decision: alreadyAccepted ? "DUPLICATE" : "UNEXPECTED_PASSAGE",
          expectedTimingPointUuid: expected?.timingPointUuid ?? null,
          expectedTimingPointKey: expected?.timingPointKey ?? null,
          resolvedTimingPointUuid: null,
          resolvedTimingPointKey: null,
          reason: !resolved
            ? "timing_point_not_configured"
            : alreadyAccepted
              ? "timing_point_already_accepted"
              : "required_preceding_timing_point_missing",
        });
        continue;
      }
      const processedAt = timestampMs(row.result.readerTimestamp, "readerTimestamp");
      if (processedAt < timestampMs(configuration.startWindowOpenTimestamp, "startWindowOpenTimestamp")
        || (configuration.eventEndTimestamp && processedAt > timestampMs(configuration.eventEndTimestamp, "eventEndTimestamp"))) {
        decisions.push({ passageId, decision: "INELIGIBLE", expectedTimingPointUuid: expected.timingPointUuid, expectedTimingPointKey: expected.timingPointKey, resolvedTimingPointUuid: null, resolvedTimingPointKey: null, reason: processedAt < timestampMs(configuration.startWindowOpenTimestamp, "startWindowOpenTimestamp") ? "before_start_window" : "after_event_window" });
        continue;
      }
      if (resolved.type === "START" && configuration.startWindowCloseTimestamp
        && timestampMs(row.result.readerTimestamp, "readerTimestamp") > timestampMs(configuration.startWindowCloseTimestamp, "startWindowCloseTimestamp")) {
        decisions.push({ passageId, decision: "INELIGIBLE", expectedTimingPointUuid: expected.timingPointUuid, expectedTimingPointKey: expected.timingPointKey, resolvedTimingPointUuid: null, resolvedTimingPointKey: null, reason: "after_start_window" });
        continue;
      }
      const startTimestamp = accepted[0]?.result.readerTimestamp;
      if (resolved.type === "FINISH" && startTimestamp
        && timestampMs(row.result.readerTimestamp, "readerTimestamp") - timestampMs(startTimestamp, "startTimestamp") < Math.max(0, configuration.minimumFinishGapMs ?? 0)) {
        decisions.push({ passageId, decision: "INELIGIBLE", expectedTimingPointUuid: expected.timingPointUuid, expectedTimingPointKey: expected.timingPointKey, resolvedTimingPointUuid: null, resolvedTimingPointKey: null, reason: "before_minimum_finish_gap" });
        continue;
      }
      accepted.push({ ...row, point: resolved });
      decisions.push({ passageId, decision: "ACCEPTED", expectedTimingPointUuid: expected.timingPointUuid, expectedTimingPointKey: expected.timingPointKey, resolvedTimingPointUuid: resolved.timingPointUuid, resolvedTimingPointKey: resolved.timingPointKey, reason: resolvedIndex === expectedIndex ? `accepted_as_${resolved.type.toLowerCase()}` : "accepted_after_optional_checkpoint_skip" });
      expectedIndex = resolvedIndex + 1;
    }
    const chipStartTimestamp = accepted[0]?.point.type === "START" ? accepted[0].result.readerTimestamp : null;
    const mappedResults: OfficialTimingPointResult[] = chipStartTimestamp ? accepted.map(({ result, point, sourceIndex }, index) => {
      const gunTimeMs = result.gunTimeMs ?? Math.max(0, timestampMs(result.readerTimestamp, "readerTimestamp") - timestampMs(configuration.gunStartTimestamp, "gunStartTimestamp"));
      const chipTimeMs = result.chipTimeMs ?? Math.max(0, timestampMs(result.readerTimestamp, "readerTimestamp") - timestampMs(chipStartTimestamp, "chipStartTimestamp"));
      const previousTimestamp = accepted[index - 1]?.result.readerTimestamp;
      return {
        eventUuid: configuration.eventUuid,
        contestUuid: configuration.contestUuid,
        participantUuid: identity?.participantUuid ?? "",
        bib: identity?.bib ?? "",
        chipCode: identity?.chipCode ?? "",
        timingPointUuid: point.timingPointUuid,
        timingPointKey: point.timingPointKey,
        timingPointName: point.name || result.timingPointName,
        timingPointType: point.type,
        readerTimestamp: result.readerTimestamp,
        gunStartTimestamp: configuration.gunStartTimestamp,
        chipStartTimestamp,
        gunTimeMs,
        chipTimeMs,
        sectionTimeMs: result.sectionTimeMs ?? (previousTimestamp ? Math.max(0, timestampMs(result.readerTimestamp, "readerTimestamp") - timestampMs(previousTimestamp, "previousTimestamp")) : 0),
        officialTimeMs: configuration.resultTimeMode === "GUN" ? gunTimeMs : chipTimeMs,
        resultTimeMode: configuration.resultTimeMode,
        passageId: `feibot-processed-${sourceIndex + 1}`,
        readCount: 0,
        source: "FEIBOT_PROCESSED",
        status: "PROVISIONAL",
        overrideWarning: null,
      };
    }) : [];
    const officialResults = applyOverrides(mappedResults, input.manualOverrides ?? [], configuration, identity);
    return {
      eventUuid: configuration.eventUuid,
      contestUuid: configuration.contestUuid,
      participantUuid: identity?.participantUuid ?? "",
      bib: identity?.bib ?? "",
      chipCode: identity?.chipCode ?? "",
      timingResultSource: configuration.timingResultSource,
      state: stateAfterResults(configuration.sequence, officialResults),
      rawReads: input.rawReads,
      passages: [],
      decisions,
      officialResults,
      manualOverrides: input.manualOverrides ?? [],
      rejectedRawReads: [],
    };
  }

  const { passages, rejectedRawReads } = groupFeibotPassages(input.rawReads, configuration);
  const decisions: TimingDecision[] = [];
  const accepted: Array<{ passage: TimingPassage; point: CourseTimingPoint }> = [];
  let expectedIndex = 0;
  for (const passage of passages) {
    const expected = configuration.sequence[expectedIndex] ?? null;
    const matchingIndexes = configuration.sequence
      .map((point, index) => point.timingPointUuid === passage.timingPointUuid
        && (passage.passage == null || point.passage == null || point.passage === passage.passage)
        ? index
        : -1)
      .filter((index) => index >= 0);
    const matchedIndex = matchingIndexes.includes(expectedIndex)
      ? expectedIndex
      : matchingIndexes.find((index) => index >= expectedIndex && canSkipOptionalPoints(configuration.sequence, expectedIndex, index)) ?? matchingIndexes[0] ?? -1;
    if (!expected) {
      decisions.push({ passageId: passage.passageId, decision: "UNEXPECTED_PASSAGE", expectedTimingPointUuid: null, expectedTimingPointKey: null, resolvedTimingPointUuid: null, resolvedTimingPointKey: null, reason: "athlete_already_finished" });
      continue;
    }
    if (matchedIndex < expectedIndex || !canSkipOptionalPoints(configuration.sequence, expectedIndex, matchedIndex)) {
      const alreadyAccepted = matchedIndex >= 0 && matchedIndex < expectedIndex;
      decisions.push({
        passageId: passage.passageId,
        decision: alreadyAccepted ? "DUPLICATE" : "UNEXPECTED_PASSAGE",
        expectedTimingPointUuid: expected.timingPointUuid,
        expectedTimingPointKey: expected.timingPointKey,
        resolvedTimingPointUuid: null,
        resolvedTimingPointKey: null,
        reason: alreadyAccepted ? "timing_point_already_accepted" : "required_preceding_timing_point_missing",
      });
      continue;
    }
    const resolved = configuration.sequence[matchedIndex];
    if (resolved.type === "START" && configuration.startWindowCloseTimestamp
      && timestampMs(passage.firstTimestamp, "firstTimestamp") > timestampMs(configuration.startWindowCloseTimestamp, "startWindowCloseTimestamp")) {
      decisions.push({ passageId: passage.passageId, decision: "INELIGIBLE", expectedTimingPointUuid: expected.timingPointUuid, expectedTimingPointKey: expected.timingPointKey, resolvedTimingPointUuid: null, resolvedTimingPointKey: null, reason: "after_start_window" });
      continue;
    }
    const acceptedStartTimestamp = accepted[0]?.passage.firstTimestamp;
    if (resolved.type === "FINISH" && acceptedStartTimestamp
      && timestampMs(passage.firstTimestamp, "firstTimestamp") - timestampMs(acceptedStartTimestamp, "startTimestamp") < Math.max(0, configuration.minimumFinishGapMs ?? 0)) {
      decisions.push({ passageId: passage.passageId, decision: "INELIGIBLE", expectedTimingPointUuid: expected.timingPointUuid, expectedTimingPointKey: expected.timingPointKey, resolvedTimingPointUuid: null, resolvedTimingPointKey: null, reason: "before_minimum_finish_gap" });
      continue;
    }
    accepted.push({ passage, point: resolved });
    decisions.push({ passageId: passage.passageId, decision: "ACCEPTED", expectedTimingPointUuid: expected.timingPointUuid, expectedTimingPointKey: expected.timingPointKey, resolvedTimingPointUuid: resolved.timingPointUuid, resolvedTimingPointKey: resolved.timingPointKey, reason: matchedIndex === expectedIndex ? `accepted_as_${resolved.type.toLowerCase()}` : "accepted_after_optional_checkpoint_skip" });
    expectedIndex = matchedIndex + 1;
  }

  const chipStartTimestamp = accepted[0]?.point.type === "START" ? accepted[0].passage.firstTimestamp : null;
  const automaticResults: OfficialTimingPointResult[] = [];
  if (chipStartTimestamp) {
    let previousTimestamp: string | null = null;
    for (const { passage, point } of accepted) {
      automaticResults.push(calculateResult(passage, point, configuration, chipStartTimestamp, previousTimestamp));
      previousTimestamp = passage.firstTimestamp;
    }
  }
  const manualOverrides = input.manualOverrides ?? [];
  const officialResults = applyOverrides(automaticResults, manualOverrides, configuration, firstRead);
  return {
    eventUuid: configuration.eventUuid,
    contestUuid: configuration.contestUuid,
    participantUuid: firstRead?.participantUuid ?? "",
    bib: firstRead?.bib ?? "",
    chipCode: firstRead?.chipCode ?? "",
    timingResultSource: configuration.timingResultSource,
    state: stateAfterResults(configuration.sequence, officialResults),
    rawReads: input.rawReads,
    passages,
    decisions,
    officialResults,
    manualOverrides,
    rejectedRawReads,
  };
}

export function formatDurationMs(durationMs: number | null): string {
  if (durationMs === null || !Number.isFinite(durationMs)) return "—";
  const safe = Math.max(0, Math.floor(durationMs));
  const hours = Math.floor(safe / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1_000);
  const milliseconds = safe % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}
