import {
  CANONICAL_SCHEMA_VERSION,
  type CanonicalAthleteSnapshot,
  type CanonicalAthleteStatus,
  type CanonicalCalculatedMetrics,
  type CanonicalContestCourse,
  type CanonicalLegType,
  type CanonicalRaceSection,
  type CanonicalResolvedAthleteState,
  type CanonicalResolvedSplitState,
  type CanonicalSplit,
  type CanonicalSplitRow,
  type CanonicalTimingRead,
} from './contracts';
import { formatEventLocalTime, normalizeTimestampUtc } from './time';
import { normalizeStartConfiguration, resolveOfficialAthleteStart } from './start-timing';
import { resolveCurrentRaceSection } from './section-state';
import {
  shadowCalculateDurations,
  shadowSelectTimingRead,
} from './shadow-timing-calculations';

const TERMINAL_STATUSES = new Set<CanonicalAthleteStatus>(['dns', 'dnf', 'dnq', 'disqualified']);
const RANKABLE_READ_STATUSES = new Set(['valid', 'confirmed', 'corrected', 'official', 'manual_corrected']);

function configuredRaceSections(contest: CanonicalContestCourse): CanonicalRaceSection[] {
  if (Array.isArray(contest.sections) && contest.sections.length > 0) return contest.sections;
  // Older canonical course versions may have valid leg/transition boundaries
  // without the denormalized sections array. Reconstruct the exact ordered
  // flow so an accepted Run Start still closes T2 immediately.
  return [
    ...(contest.legs || []).map((leg) => ({
      key: leg.type,
      sectionType: 'leg' as const,
      order: leg.order,
      displayName: leg.type.startsWith('run') ? 'Run' : `${leg.type.charAt(0).toUpperCase()}${leg.type.slice(1)}`,
      legType: leg.type,
      startSplitKey: leg.startSplitKey,
      finishSplitKey: leg.finishSplitKey,
    })),
    ...(contest.transitions || []).map((transition) => ({
      key: transition.key,
      sectionType: 'transition' as const,
      order: transition.order,
      displayName: transition.key.toUpperCase() as 'T1' | 'T2',
      transitionType: transition.type,
      startSplitKey: transition.startSplitKey,
      finishSplitKey: transition.finishSplitKey,
    })),
  ].sort((left, right) => left.order - right.order) as CanonicalRaceSection[];
}

function elapsed(read: CanonicalTimingRead | null | undefined): number | null {
  const value = read?.overallElapsedSeconds ?? read?.elapsedSeconds;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function elapsedFromOfficialStart(
  read: CanonicalTimingRead | null | undefined,
  officialStartAt: string | null | undefined,
): number | null {
  const readMillis = Date.parse(read?.timestamp ?? read?.occurredAt ?? '');
  const startMillis = Date.parse(officialStartAt ?? '');
  if (Number.isFinite(readMillis) && Number.isFinite(startMillis) && readMillis >= startMillis) {
    return (readMillis - startMillis) / 1000;
  }
  return elapsed(read);
}

function normalizeOverallReadClocks(
  reads: Record<string, CanonicalTimingRead | null>,
  officialStartAt: string | null | undefined,
): Record<string, CanonicalTimingRead | null> {
  return Object.fromEntries(Object.entries(reads).map(([key, read]) => {
    if (!read) return [key, null];
    const overallElapsedSeconds = elapsedFromOfficialStart(read, officialStartAt);
    return [key, overallElapsedSeconds === null ? read : {
      ...read,
      // `elapsedSeconds` remains the compatibility field consumed by older
      // clients, but now has one permanent meaning: overall race elapsed.
      elapsedSeconds: overallElapsedSeconds,
      overallElapsedSeconds,
      officialElapsedSeconds: overallElapsedSeconds,
    }];
  }));
}

interface DerivedSplitTiming {
  overallElapsedSeconds: number | null;
  legElapsedSeconds: number | null;
  sectionElapsedSeconds: number | null;
}

function deriveSplitTimings(
  reads: Record<string, CanonicalTimingRead | null>,
  contest: CanonicalContestCourse,
): Map<string, DerivedSplitTiming> {
  const result = new Map<string, DerivedSplitTiming>();
  const legStarts = new Map<CanonicalLegType, number>();
  let previousOverall: number | null = null;
  for (const split of [...contest.splits].sort((left, right) => left.order - right.order)) {
    const read = reads[split.key] ?? null;
    const overall = validElapsed(read);
    if (overall === null) {
      result.set(split.key, { overallElapsedSeconds: null, legElapsedSeconds: null, sectionElapsedSeconds: null });
      continue;
    }
    if (!legStarts.has(split.legType)) legStarts.set(split.legType, overall);
    const legStart = legStarts.get(split.legType) ?? overall;
    const providerSection = typeof read?.segmentElapsedSeconds === 'number'
      && Number.isFinite(read.segmentElapsedSeconds)
      && read.segmentElapsedSeconds >= 0
      ? read.segmentElapsedSeconds
      : null;
    result.set(split.key, {
      overallElapsedSeconds: overall,
      legElapsedSeconds: Math.max(0, overall - legStart),
      sectionElapsedSeconds: providerSection ?? (previousOverall === null ? overall : Math.max(0, overall - previousOverall)),
    });
    previousOverall = overall;
  }
  return result;
}

function validElapsed(read: CanonicalTimingRead | null | undefined): number | null {
  return read && RANKABLE_READ_STATUSES.has(read.status) ? elapsed(read) : null;
}

function difference(finish: number | null, start: number | null): number | null {
  if (finish === null || start === null) return null;
  const value = finish - start;
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function divide(value: number | null, divisor: number): number | null {
  if (value === null || !Number.isFinite(divisor) || divisor <= 0) return null;
  const result = value / divisor;
  return Number.isFinite(result) && result >= 0 ? result : null;
}

/**
 * Resolve only the configured race-level finish. `isFinish` is accepted for
 * legacy bundles only when it is attached to the final configured split.
 * There is intentionally no "last split wins" fallback: an incomplete course
 * must stay on course instead of turning an intermediate checkpoint into a
 * result.
 */
function configuredRaceFinishSplit(contest: CanonicalContestCourse): CanonicalSplit | null {
  const ordered = [...contest.splits].sort((left, right) => left.order - right.order);
  const explicit = ordered.filter((split) => split.isRaceFinish);
  if (explicit.length === 1 && explicit[0]?.key === ordered.at(-1)?.key) return explicit[0];
  if (explicit.length > 0) return null;
  const legacyLast = ordered.at(-1) ?? null;
  return legacyLast?.isFinish ? legacyLast : null;
}

function calculateCanonicalDurationsAuthoritative(
  reads: Record<string, CanonicalTimingRead | null>,
  contest: CanonicalContestCourse,
): CanonicalCalculatedMetrics {
  const durationBetween = (startSplitKey: string | null | undefined, finishSplitKey: string | null | undefined) => (
    startSplitKey && finishSplitKey
      ? difference(validElapsed(reads[finishSplitKey]), validElapsed(reads[startSplitKey]))
      : null
  );
  const legDurations = [...(contest.legs || [])]
    .sort((left, right) => left.order - right.order)
    .map((leg) => ({ leg, duration: durationBetween(leg.startSplitKey, leg.finishSplitKey) }));
  const durationForLeg = (types: CanonicalLegType[]) => {
    const matches = legDurations.filter(({ leg }) => types.includes(leg.type));
    if (matches.length === 0 || matches.some(({ duration }) => duration === null)) return null;
    return matches.reduce((total, { duration }) => total + (duration ?? 0), 0);
  };
  const transitionDuration = (key: 't1' | 't2') => {
    const transition = (contest.transitions || []).find((row) => row.key === key || row.type === key);
    return transition ? durationBetween(transition.startSplitKey, transition.finishSplitKey) : null;
  };
  // Configured boundaries are authoritative. The conventional key lookups are
  // retained only for older course bundles that predate explicit leg/section
  // boundaries.
  const swimSeconds = durationForLeg(['swim'])
    ?? difference(validElapsed(reads.swim_finish), validElapsed(reads.swim_start));
  const t1Seconds = transitionDuration('t1')
    ?? difference(validElapsed(reads.bike_start), validElapsed(reads.swim_finish));
  const bikeSeconds = durationForLeg(['bike'])
    ?? difference(validElapsed(reads.bike_finish), validElapsed(reads.bike_start));
  const t2Seconds = transitionDuration('t2')
    ?? difference(validElapsed(reads.run_start ?? reads.run_2_start), validElapsed(reads.bike_finish));
  const runSeconds = durationForLeg(['run', 'run_1', 'run_2'])
    ?? difference(validElapsed(reads.run_finish ?? reads.run_2_finish), validElapsed(reads.run_start ?? reads.run_1_start));
  const configuredFinish = configuredRaceFinishSplit(contest);
  // A processed GUN result may cross START after the gun. The finish read is
  // already cumulative from the official athlete start, so subtracting the
  // START passage would incorrectly shorten the race.
  const overallSeconds = configuredFinish ? validElapsed(reads[configuredFinish.key]) : null;
  const swimDistance = contest.legs.find((leg) => leg.type === 'swim')?.distanceKm ?? 0;
  const bikeDistance = contest.legs.find((leg) => leg.type === 'bike')?.distanceKm ?? 0;
  const runDistance = contest.legs.filter((leg) => leg.type === 'run' || leg.type === 'run_1' || leg.type === 'run_2').reduce((sum, leg) => sum + leg.distanceKm, 0);
  const totalDistance = Math.max(
    Number(contest.configuredRaceDistanceKm || 0),
    Number(contest.totalDistanceKm || 0),
    contest.legs.reduce((sum, leg) => sum + Number(leg.distanceKm || 0), 0),
    ...contest.splits.map((split) => Number(split.cumulativeDistanceKm || 0)),
  );
  return {
    swimSeconds,
    t1Seconds,
    bikeSeconds,
    t2Seconds,
    runSeconds,
    overallSeconds,
    averageSwimPaceSecondsPer100m: divide(swimSeconds, swimDistance * 10),
    averageBikeSpeedKmh: bikeSeconds && bikeDistance > 0 ? bikeDistance / (bikeSeconds / 3600) : null,
    averageRunPaceSecondsPerKm: divide(runSeconds, runDistance),
    averageRacePaceSecondsPerKm: divide(overallSeconds, totalDistance),
  };
}

export function calculateCanonicalDurations(
  reads: Record<string, CanonicalTimingRead | null>,
  contest: CanonicalContestCourse,
): CanonicalCalculatedMetrics {
  return shadowCalculateDurations(
    { reads, contest },
    calculateCanonicalDurationsAuthoritative(reads, contest),
  );
}

function statusForReads(
  reads: Record<string, CanonicalTimingRead | null>,
  contest: CanonicalContestCourse,
): CanonicalAthleteStatus {
  if (validElapsed(reads.run_start ?? reads.run_2_start) !== null) return 'running';
  if (validElapsed(reads.bike_finish) !== null) return 'in_t2';
  if (validElapsed(reads.bike_start) !== null) return 'cycling';
  if (validElapsed(reads.run_1_finish) !== null) return 'in_t1';
  if (validElapsed(reads.run_1_start) !== null) return 'running';
  if (validElapsed(reads.swim_finish) !== null) return 'in_t1';
  if (validElapsed(reads.swim_start) !== null) return 'swimming';
  // Rebuilds calculate raceState before presentation rows are regenerated, so
  // the configured course sequence is authoritative here. Reading the empty
  // snapshot.splits draft incorrectly reset athletes with valid custom splits.
  const latestConfiguredRead = contest.splits
    .map((row) => ({ row, read: reads[row.key] }))
    .filter((entry) => validRead(entry.read ?? null))
    .at(-1);
  if (latestConfiguredRead) {
    const legType = latestConfiguredRead.row.legType;
    if (legType === 'swim') return 'swimming';
    if (legType === 'bike') return 'cycling';
    if (legType === 'run' || legType === 'run_1' || legType === 'run_2') return 'running';
  }
  return 'not_started';
}

function currentLeg(status: CanonicalAthleteStatus, contest: CanonicalContestCourse, reads: Record<string, CanonicalTimingRead | null>): CanonicalLegType | null {
  if (status === 'swimming') return contest.raceType === 'duathlon' ? 'run_1' : 'swim';
  if (status === 'cycling') return 'bike';
  if (status === 'running') return contest.raceType === 'duathlon' && validElapsed(reads.run_2_start) === null ? 'run_1' : contest.raceType === 'duathlon' ? 'run_2' : 'run';
  return null;
}

function validRead(read: CanonicalTimingRead | null): boolean {
  return !!read && RANKABLE_READ_STATUSES.has(read.status) && elapsed(read) !== null;
}

function eligibleTimingReads(
  reads: Record<string, CanonicalTimingRead | null>,
  contest: CanonicalContestCourse,
  now: string,
): Record<string, CanonicalTimingRead | null> {
  const nowMillis = Date.parse(now);
  const reorderBufferMs = normalizeStartConfiguration(contest.startConfiguration).timingReorderBufferMs;
  const futureBoundaryMillis = Number.isFinite(nowMillis)
    ? nowMillis + Math.max(0, reorderBufferMs)
    : Number.POSITIVE_INFINITY;
  const eligible = Object.fromEntries(Object.entries(reads).map(([key, read]) => {
    if (!read) return [key, null];
    const readMillis = Date.parse(read.timestamp ?? read.occurredAt);
    return [key, Number.isFinite(readMillis) && readMillis <= futureBoundaryMillis ? read : null];
  }));

  // Canonical state is course-sequential. A reader hit/result for a later
  // checkpoint cannot skip a missing required checkpoint or move backwards in
  // elapsed race time. This is the final persistence invariant, independent of
  // whether the input came from raw RFID, Feibot calculated results, replay, or
  // a legacy rebuild.
  let prerequisiteMissing = false;
  let previousElapsed: number | null = null;
  const timingMode = contest.startConfiguration?.mode ?? 'GUN';
  for (const split of [...contest.splits].sort((left, right) => left.order - right.order)) {
    const candidate = eligible[split.key] ?? null;
    const missingStartAllowed = split.isStart && timingMode !== 'CHIP';
    if (prerequisiteMissing) {
      eligible[split.key] = null;
      continue;
    }
    if (!candidate) {
      eligible[split.key] = null;
      if (split.required !== false && !missingStartAllowed) prerequisiteMissing = true;
      continue;
    }
    if (!validRead(candidate)) {
      // Retain rejected/invalid evidence for the audit and split UI, but it
      // does not satisfy the prerequisite and cannot advance race state.
      eligible[split.key] = candidate;
      if (split.required !== false && !missingStartAllowed) prerequisiteMissing = true;
      continue;
    }
    const candidateTimestamp = Date.parse(candidate.timestamp ?? candidate.occurredAt ?? '');
    const candidateElapsed = Number.isFinite(candidateTimestamp) ? candidateTimestamp / 1000 : elapsed(candidate);
    if (candidateElapsed === null || (previousElapsed !== null && candidateElapsed < previousElapsed)) {
      eligible[split.key] = { ...candidate, status: 'invalid' };
      if (split.required !== false) prerequisiteMissing = true;
      continue;
    }
    previousElapsed = candidateElapsed;
  }
  return eligible;
}

function terminalResolvedStatus(status: CanonicalAthleteStatus): CanonicalResolvedAthleteState['status'] | null {
  if (status === 'dnf') return 'DNF';
  if (status === 'dns') return 'DNS';
  if (status === 'disqualified' || status === 'dnq') return 'DSQ';
  return null;
}

function splitState(
  split: CanonicalSplit,
  read: CanonicalTimingRead | null,
  timing: DerivedSplitTiming | undefined,
  status: CanonicalResolvedSplitState['status'],
  ranking: CanonicalSplitRow['ranking'],
  eventTimezone: string,
): CanonicalResolvedSplitState {
  const readAt = normalizeTimestampUtc(read?.timestamp ?? read?.occurredAt, eventTimezone);
  return {
    splitKey: split.key,
    providerSplitId: split.providerSplitId,
    timingPointUuid: split.providerTimingPointId,
    name: split.displayName,
    legType: split.legType,
    order: split.order,
    legDistanceKm: split.distanceInLegKm,
    cumulativeRaceDistanceKm: split.cumulativeDistanceKm,
    distanceKm: split.cumulativeDistanceKm,
    status,
    readAt,
    // The absolute reader/result timestamp is authoritative. Some legacy
    // snapshots stored the UTC clock portion in `timeOfDay` (for example
    // 17:47 for a 23:17 India read), so derive the display clock from readAt
    // whenever an instant is available and use the provider clock only as a
    // fallback for old records that genuinely have no timestamp.
    timeOfDay: readAt
      ? formatEventLocalTime(readAt, eventTimezone)
      : String(read?.timeOfDay ?? '').trim() || null,
    elapsedSeconds: timing?.overallElapsedSeconds ?? elapsed(read),
    overallElapsedSeconds: timing?.overallElapsedSeconds ?? elapsed(read),
    legElapsedSeconds: timing?.legElapsedSeconds ?? null,
    sectionElapsedSeconds: timing?.sectionElapsedSeconds ?? null,
    segmentElapsedSeconds: timing?.sectionElapsedSeconds ?? read?.segmentElapsedSeconds ?? null,
    overallRank: ranking?.overallRank ?? null,
    categoryRank: ranking?.ageGroupRank ?? null,
    genderRank: ranking?.genderRank ?? null,
    passageNumber: read?.passNumber ?? null,
  };
}

/** Single backend authority consumed by web and mobile athlete views. */
export function resolveCanonicalAthleteState(
  snapshot: CanonicalAthleteSnapshot,
  contest: CanonicalContestCourse,
  now = new Date().toISOString(),
): CanonicalResolvedAthleteState {
  const ordered = [...contest.splits].sort((left, right) => left.order - right.order);
  const eventTimezone = contest.timezone || 'UTC';
  const eligibleReads = eligibleTimingReads(snapshot.reads, contest, now);
  const candidateCompleted = ordered.filter((split) => validRead(eligibleReads[split.key] ?? null));
  const startSplit = ordered.find((split) => split.isRaceStart)
    ?? ordered.find((split) => split.isStart)
    ?? ordered[0]
    ?? null;
  const finishSplit = configuredRaceFinishSplit(contest);
  const startRead = startSplit ? eligibleReads[startSplit.key] ?? null : null;
  const timingMode = contest.startConfiguration?.mode ?? 'GUN';
  const gunStartTime = normalizeTimestampUtc(contest.startConfiguration?.gunStartTime, eventTimezone);
  const canonicalNowMillis = Date.parse(now);
  const startEvidenceBoundaryMillis = canonicalNowMillis
    + Math.max(0, normalizeStartConfiguration(contest.startConfiguration).timingReorderBufferMs);
  const chipDetectionTime = normalizeTimestampUtc(snapshot.startTiming?.chipStartDetectionTime, eventTimezone);
  const manualStartMillis = Date.parse(snapshot.startTiming?.officialStartTime ?? '');
  const acceptedManualStart = Boolean(
    snapshot.startTiming?.startTimeSource === 'MANUAL'
    && snapshot.startTiming?.startTimeLocked
    && Number.isFinite(manualStartMillis)
    && manualStartMillis <= startEvidenceBoundaryMillis,
  );
  const acceptedStartState = Boolean(
    validRead(startRead)
    || acceptedManualStart,
  );
  const detectedStartTime = normalizeTimestampUtc(
    startRead?.timestamp ?? startRead?.occurredAt ?? chipDetectionTime,
    eventTimezone,
  );
  const officialStartResolution = resolveOfficialAthleteStart({
    configuration: normalizeStartConfiguration(contest.startConfiguration),
    waveStartTime: snapshot.identity?.waveStartTime,
    // The processed START read may have been applied in this same immutable
    // reconciliation pass, before startTiming has been regenerated. Resolve
    // CHIP zero from that accepted canonical read immediately; otherwise the
    // first incremental import incorrectly retains Feibot's GUN elapsed until
    // a later rebuild happens to populate chipStartDetectionTime.
    acceptedChipStartTime: detectedStartTime,
    manualOverrideTime: snapshot.startTiming?.startTimeSource === 'MANUAL'
      ? snapshot.startTiming.officialStartTime
      : null,
  });
  // A configured GUN/WAVE time is the elapsed-time base, not evidence that an
  // athlete crossed START. A later accepted checkpoint may prove participation
  // only for GUN/WAVE and only when that official baseline is resolvable. CHIP
  // mode always requires the accepted START read itself.
  const downstreamStartProven = timingMode !== 'CHIP'
    && candidateCompleted.length > 0
    && Boolean(officialStartResolution.resolvedAthleteStartTime);
  const hasStarted = acceptedStartState || downstreamStartProven;
  // Orphan downstream reads in CHIP mode remain auditable, but are not official
  // course progress until START has been accepted and the coordinator retries
  // them in sequence.
  const completed = hasStarted ? candidateCompleted : [];
  // START confirms participation but is not a meaningful race placing. Do not
  // show #1/#1/#1 merely because this is the first athlete whose START passage
  // reached the coordinator. Rankings become visible at the first non-START
  // checkpoint (or FINISH for a course with no intermediate split).
  const hasRankableCheckpoint = completed.some((split) => !split.isStart);
  const lastCompleted = completed.at(-1) ?? null;
  const lastIndex = lastCompleted ? ordered.findIndex((split) => split.key === lastCompleted.key) : -1;
  // GUN/WAVE define the clock baseline, but the athlete is not on course until
  // a valid passage proves participation. Keep the baseline available as
  // gunStartTime while withholding athleteStartTime until that happens.
  const athleteStartTime = hasStarted
    ? normalizeTimestampUtc(officialStartResolution.resolvedAthleteStartTime, eventTimezone)
    : null;
  const startConfiguration = normalizeStartConfiguration(contest.startConfiguration);
  const terminal = terminalResolvedStatus(snapshot.raceState.status);
  const persistedTerminalIsManual = Boolean(
    terminal
    && snapshot.raceState.statusSource === 'MANUAL_OVERRIDE'
    // DNS means the athlete did not start. An accepted canonical START read
    // is stronger contradictory evidence and must clear a stale DNS flag,
    // regardless of whether an older rebuild labelled it as manual.
    && !(terminal === 'DNS' && acceptedStartState),
  );
  // An official automatic cutoff decision is terminal too. A subsequently
  // imported late finish passage remains in the audit, but cannot silently
  // turn the athlete back into a finisher; an authorized override is required.
  const persistedCutoffDnf = terminal === 'DNF'
    && snapshot.raceState.statusSource === 'AUTO_CUTOFF_RULE';
  const persistedTerminalIsAuthoritative = persistedTerminalIsManual || persistedCutoffDnf;
  const mandatorySplitsSatisfied = !startConfiguration.requireMandatorySplitsBeforeFinish
    || ordered
      .slice(0, finishSplit ? ordered.findIndex((split) => split.key === finishSplit.key) + 1 : 0)
      .filter((split) => split.required !== false)
      .every((split) => validRead(eligibleReads[split.key] ?? null));
  const hasFinished = Boolean(
    hasStarted
    && finishSplit
    && validRead(eligibleReads[finishSplit.key] ?? null)
    && mandatorySplitsSatisfied
  );
  const raceClockStartTime = athleteStartTime
    ?? (timingMode !== 'CHIP'
      ? normalizeTimestampUtc(officialStartResolution.resolvedAthleteStartTime, eventTimezone)
      : null);
  const dnsBaseline = normalizeTimestampUtc(
    timingMode === 'CHIP'
      ? snapshot.identity?.waveStartTime
        ?? contest.startConfiguration?.gunStartTime
        ?? contest.startConfiguration?.startWindowOpenTime
      : officialStartResolution.resolvedAthleteStartTime,
    eventTimezone,
  );
  const dnsDeadlineMillis = dnsBaseline
    ? Date.parse(dnsBaseline) + startConfiguration.dnsGraceMinutes * 60_000
    : Number.NaN;
  const automaticDns = !hasStarted
    && Number.isFinite(canonicalNowMillis)
    && Number.isFinite(dnsDeadlineMillis)
    && canonicalNowMillis >= dnsDeadlineMillis;
  const finalSplitDefinition = finishSplit;
  const standardCutoffKeys = new Set(['swim', 'bike', 'run', 'finish', 'overall']);
  const rawCutoffDefinitions = [
    {
      key: 'swim', displayName: 'Swim Cutoff',
      boundarySplitKey: ordered.find((split) => split.key === 'swim_finish')?.key
        ?? ordered.filter((split) => split.legType === 'swim').at(-1)?.key,
      seconds: contest.cutoffs?.swim ?? contest.legs.find((leg) => leg.type === 'swim')?.cutoffSeconds,
    },
    {
      key: 'bike', displayName: 'Bike Cutoff',
      boundarySplitKey: ordered.find((split) => split.key === 'bike_finish')?.key
        ?? ordered.filter((split) => split.legType === 'bike').at(-1)?.key,
      seconds: contest.cutoffs?.bike ?? contest.legs.find((leg) => leg.type === 'bike')?.cutoffSeconds,
    },
    {
      key: 'finish', displayName: 'Finish Cutoff', boundarySplitKey: finalSplitDefinition?.key,
      seconds: contest.cutoffs?.overall
        ?? contest.cutoffs?.finish
        ?? contest.cutoffs?.run
        ?? contest.legs.at(-1)?.cutoffSeconds,
    },
    ...Object.entries(contest.cutoffs || {}).flatMap(([key, seconds]) => {
      if (standardCutoffKeys.has(key.toLowerCase())) return [];
      const boundary = ordered.find((split) => split.key === key)
        ?? ordered.find((split) => split.key === `${key}_finish`);
      return boundary ? [{
        key,
        displayName: `${boundary.displayName} Cutoff`,
        boundarySplitKey: boundary.key,
        seconds,
      }] : [];
    }),
  ].filter((entry): entry is { key: string; displayName: string; boundarySplitKey: string; seconds: number } => (
    Boolean(entry.boundarySplitKey)
    && typeof entry.seconds === 'number'
    && Number.isFinite(entry.seconds)
    && entry.seconds > 0
  ));
  const cutoffDefinitions = rawCutoffDefinitions.filter((entry, index, entries) => (
    entries.findIndex((candidate) => candidate.boundarySplitKey === entry.boundarySplitKey) === index
  ));
  const cutoffFailure = hasStarted && raceClockStartTime
    ? cutoffDefinitions.find((definition) => {
        const deadline = Date.parse(raceClockStartTime) + definition.seconds * 1_000;
        const checkpointRead = eligibleReads[definition.boundarySplitKey] ?? null;
        const checkpointMillis = Date.parse(checkpointRead?.timestamp ?? checkpointRead?.occurredAt ?? '');
        const isFinal = definition.boundarySplitKey === finalSplitDefinition?.key;
        if (validRead(checkpointRead) && Number.isFinite(checkpointMillis)) {
          if (isFinal && !startConfiguration.strictFinalCutoff) return false;
          return checkpointMillis > deadline;
        }
        return Number.isFinite(canonicalNowMillis) && canonicalNowMillis >= deadline;
      }) ?? null
    : null;
  const cutoffFailureDeadlineMillis = cutoffFailure && raceClockStartTime
    ? Date.parse(raceClockStartTime) + cutoffFailure.seconds * 1_000
    : Number.NaN;
  const status: CanonicalResolvedAthleteState['status'] = persistedTerminalIsAuthoritative
    ? terminal!
    : cutoffFailure
      ? 'DNF'
      : hasFinished
        ? 'FINISHED'
        : automaticDns
          ? 'DNS'
          : hasStarted ? 'ON_COURSE' : timingMode === 'CHIP' ? 'WAITING_CHIP_START' : 'NOT_STARTED';
  const statusReason = persistedTerminalIsAuthoritative
    ? snapshot.raceState.statusReason
      ?? (persistedCutoffDnf ? 'CUTOFF_EXCEEDED' : 'MANUAL_STATUS_OVERRIDE')
    : status === 'DNF'
      ? `${cutoffFailure?.key.toUpperCase() ?? 'CHECKPOINT'}_CUTOFF_EXCEEDED`
      : status === 'DNS'
        ? 'START_WINDOW_EXPIRED'
        : status === 'FINISHED' ? 'FINAL_SPLIT_ACCEPTED' : null;
  const statusSource = persistedTerminalIsAuthoritative
    ? snapshot.raceState.statusSource ?? 'MANUAL_OVERRIDE'
    : status === 'DNF'
      ? 'AUTO_CUTOFF_RULE'
      : status === 'DNS'
        ? 'AUTO_TIMING_RULE'
        : status === 'FINISHED' ? 'CANONICAL_TIMING' : null;
  const statusResolvedAt = persistedTerminalIsAuthoritative
    ? snapshot.raceState.statusResolvedAt ?? snapshot.updatedAt
    : status === 'DNF' && Number.isFinite(cutoffFailureDeadlineMillis)
      ? new Date(cutoffFailureDeadlineMillis).toISOString()
      : status === 'DNS' && Number.isFinite(dnsDeadlineMillis)
        ? new Date(dnsDeadlineMillis).toISOString()
        : status === 'FINISHED'
          ? normalizeTimestampUtc(eligibleReads[finishSplit?.key ?? '']?.timestamp ?? eligibleReads[finishSplit?.key ?? '']?.occurredAt, eventTimezone)
          : null;
  const failedCheckpoint = status === 'DNF'
    ? cutoffFailure?.boundarySplitKey ?? snapshot.raceState.failedCheckpoint ?? null
    : null;
  const terminalCutoffSeconds = status === 'DNF'
    ? cutoffFailure?.seconds ?? snapshot.raceState.cutoffSeconds ?? null
    : null;
  const terminalCutoffDeadline = status === 'DNF'
    ? Number.isFinite(cutoffFailureDeadlineMillis)
      ? new Date(cutoffFailureDeadlineMillis).toISOString()
      : snapshot.raceState.cutoffDeadline ?? null
    : null;
  const elapsedAtResolution = status === 'DNF'
    ? cutoffFailure?.seconds ?? snapshot.raceState.elapsedAtResolution ?? null
    : null;
  const isTerminalStatus = status === 'FINISHED' || status === 'DNF' || status === 'DNS' || status === 'DSQ';
  const nextDefinition = isTerminalStatus ? null : ordered[lastIndex + 1] ?? null;
  const sectionResolution = resolveCurrentRaceSection(
    configuredRaceSections(contest).map((section) => ({
      key: section.key,
      sectionType: section.sectionType,
      order: section.order,
      startSplitKey: section.startSplitKey,
      finishSplitKey: section.finishSplitKey,
    })),
    Object.fromEntries(ordered.map((split) => {
      const read = eligibleReads[split.key] ?? null;
      return [split.key, {
        accepted: hasStarted && validRead(read),
        timestamp: read?.timestamp ?? read?.occurredAt ?? null,
        elapsedSeconds: elapsed(read),
      }];
    })),
    now,
  );
  const configuredLegDistanceKm = (contest.legs || []).reduce(
    (sum, leg) => sum + Math.max(0, Number(leg.distanceKm || 0)),
    0,
  );
  const totalDistanceKm = Math.max(
    Number(contest.totalDistanceKm || 0),
    configuredLegDistanceKm,
    ...ordered.map((split) => Number(split.cumulativeDistanceKm || 0)),
  );
  const officialDistanceKm = status === 'FINISHED'
    ? totalDistanceKm
    : Math.max(0, Number(lastCompleted?.cumulativeDistanceKm || 0));
  const lastRead = lastCompleted ? eligibleReads[lastCompleted.key] ?? null : null;
  const activeLegType = lastCompleted?.legType ?? startSplit?.legType ?? null;
  const measuredSegments = completed.flatMap((split, index) => {
    if (index === 0 || split.legType !== activeLegType) return [];
    const previous = completed[index - 1];
    if (!previous || previous.legType !== split.legType) return [];
    const currentRead = eligibleReads[split.key] ?? null;
    const precedingRead = eligibleReads[previous.key] ?? null;
    const precedingElapsed = elapsed(precedingRead)
      ?? (previous.isStart && hasStarted ? 0 : null);
    const seconds = difference(elapsed(currentRead), precedingElapsed);
    const distanceKm = split.cumulativeDistanceKm - previous.cumulativeDistanceKm;
    if (seconds === null || seconds <= 0 || !Number.isFinite(distanceKm) || distanceKm <= 0) return [];
    const secondsPerKm = seconds / distanceKm;
    // Broad sport-specific safety bounds reject reversed/teleporting reads
    // without rejecting legitimate endurance-race performances.
    const withinSanityRange = split.legType === 'bike'
      ? secondsPerKm >= 45 && secondsPerKm <= 1_800
      : split.legType === 'swim'
        ? secondsPerKm >= 300 && secondsPerKm <= 7_200
        : secondsPerKm >= 120 && secondsPerKm <= 3_600;
    return withinSanityRange ? [{ seconds, distanceKm, secondsPerKm }] : [];
  });
  const latestSegmentPace = measuredSegments.at(-1)?.secondsPerKm ?? null;
  const recentSegments = measuredSegments.slice(-3);
  const recentAveragePace = recentSegments.length > 0
    ? recentSegments.reduce((sum, segment) => sum + segment.secondsPerKm, 0) / recentSegments.length
    : null;
  const overallMeasuredSeconds = measuredSegments.reduce((sum, segment) => sum + segment.seconds, 0);
  const overallMeasuredDistance = measuredSegments.reduce((sum, segment) => sum + segment.distanceKm, 0);
  const overallAveragePace = overallMeasuredDistance > 0 ? overallMeasuredSeconds / overallMeasuredDistance : null;
  const measuredPredictionSecondsPerKm = latestSegmentPace !== null
    ? measuredSegments.length === 1
      ? latestSegmentPace
      : (latestSegmentPace * 0.5)
        + ((recentAveragePace ?? latestSegmentPace) * 0.3)
        + ((overallAveragePace ?? latestSegmentPace) * 0.2)
    : null;
  // Until an athlete records a measured segment in the current sport, use a
  // conservative sport-specific category baseline. Never carry swim pace into
  // bike/run (or vice versa).
  const categoryDefaultSecondsPerKm = activeLegType === 'swim'
    ? 1_800 // 3:00 /100m
    : activeLegType === 'bike'
      ? 180 // 20 km/h
      : activeLegType?.startsWith('run')
        ? 420 // 7:00 /km
        : null;
  const predictionSecondsPerKm = measuredPredictionSecondsPerKm
    ?? (hasStarted && nextDefinition ? categoryDefaultSecondsPerKm : null);
  const predictionSource: CanonicalResolvedAthleteState['predictionSource'] = isTerminalStatus
    ? 'NO_ESTIMATE'
    : sectionResolution.currentSectionType === 'transition'
      ? 'NO_TRANSITION_ETA'
    : measuredPredictionSecondsPerKm
      ? 'LIVE_SPLIT_PACE'
      : predictionSecondsPerKm ? 'CONTEST_DEFAULT'
        : lastCompleted?.isStart ? 'OFFICIAL_START'
        : 'NO_ESTIMATE';
  const anchorAt = lastRead?.timestamp ?? lastRead?.occurredAt ?? athleteStartTime;
  const anchorMillis = anchorAt ? Date.parse(anchorAt) : Number.NaN;
  const nowMillis = Date.parse(now);
  const predictedTravelKm = predictionSecondsPerKm && Number.isFinite(anchorMillis) && Number.isFinite(nowMillis)
    ? Math.max(0, (nowMillis - anchorMillis) / 1000 / predictionSecondsPerKm)
    : 0;
  const nextDistanceKm = nextDefinition?.cumulativeDistanceKm ?? totalDistanceKm;
  // Prediction may reach the next checkpoint but can never cross it. Reaching
  // the cap means "waiting for confirmation", not an official split result.
  const predictionCap = nextDefinition ? Math.max(officialDistanceKm, nextDistanceKm) : totalDistanceKm;
  const estimatedDistanceKm = status === 'FINISHED'
    ? totalDistanceKm
    : isTerminalStatus
      ? officialDistanceKm
    : sectionResolution.currentSectionType === 'transition'
      ? officialDistanceKm
    : Math.min(predictionCap, Math.max(officialDistanceKm, officialDistanceKm + predictedTravelKm));
  const activeLegSplits = activeLegType
    ? ordered.filter((split) => split.legType === activeLegType)
    : [];
  const activeLegStartDistanceKm = activeLegSplits.length > 0
    ? Math.max(0, Number(activeLegSplits[0].cumulativeDistanceKm || 0) - Number(activeLegSplits[0].distanceInLegKm || 0))
    : 0;
  const activeLegDefinition = activeLegType
    ? (contest.legs || []).find((leg) => leg.type === activeLegType)
    : null;
  const currentLegDistanceKm = Math.max(
    0,
    Number(activeLegDefinition?.distanceKm || 0),
    ...activeLegSplits.map((split) => Number(split.distanceInLegKm || 0)),
  );
  const officialLegDistanceKm = activeLegType
    ? Math.max(0, Math.min(currentLegDistanceKm, Number(lastCompleted?.distanceInLegKm || 0)))
    : 0;
  const estimatedLegDistanceKm = activeLegType
    ? Math.max(officialLegDistanceKm, Math.min(currentLegDistanceKm, estimatedDistanceKm - activeLegStartDistanceKm))
    : 0;
  const currentLegProgressRatio = currentLegDistanceKm > 0
    ? Math.max(0, Math.min(1, estimatedLegDistanceKm / currentLegDistanceKm))
    : 0;
  const distanceToNextSplitKm = Math.max(0, nextDistanceKm - officialDistanceKm);
  const etaNextMillis = nextDefinition
    && sectionResolution.currentSectionType !== 'transition'
    && distanceToNextSplitKm > 0.000_001
    && predictionSecondsPerKm
    && Number.isFinite(anchorMillis)
    ? anchorMillis + distanceToNextSplitKm * predictionSecondsPerKm * 1000
    : Number.NaN;
  // Intermediate checkpoints may predict only the next checkpoint. They must
  // never synthesize a finish time; the finish clock is created exclusively
  // from the accepted configured Race Finish read.
  const estimatedFinishMillis = Number.NaN;
  const normalizedReads = normalizeOverallReadClocks(eligibleReads, athleteStartTime);
  const splitTimings = deriveSplitTimings(normalizedReads, contest);
  const preliminary = ordered.map((split) => {
    const read = normalizedReads[split.key] ?? null;
    const officialRead = hasStarted ? read : null;
    const readStatus = officialRead?.status;
    const startProvenByCourse = Boolean(split.isStart && hasStarted && (lastIndex >= ordered.findIndex((candidate) => candidate.key === split.key)));
    const progressStatus: CanonicalResolvedSplitState['status'] = validRead(officialRead) || startProvenByCourse
      ? 'COMPLETED'
      : readStatus === 'invalid' || readStatus === 'rejected' ? 'INVALID'
        : nextDefinition?.key === split.key || (!hasStarted && split.key === startSplit?.key) ? 'CURRENT'
          : 'PENDING';
    const state = splitState(split, officialRead, splitTimings.get(split.key), progressStatus, snapshot.splitRankings[split.key] ?? null, eventTimezone);
    return startProvenByCourse && !officialRead && athleteStartTime
      ? {
          ...state,
          readAt: athleteStartTime,
          timeOfDay: formatEventLocalTime(athleteStartTime, eventTimezone),
          elapsedSeconds: 0,
          overallElapsedSeconds: 0,
          legElapsedSeconds: 0,
          sectionElapsedSeconds: 0,
          segmentElapsedSeconds: 0,
        }
      : state;
  });
  const byKey = new Map(preliminary.map((split) => [split.splitKey, split]));
  const lastState = lastCompleted ? byKey.get(lastCompleted.key) ?? null : null;
  const nextState = nextDefinition ? byKey.get(nextDefinition.key) ?? null : null;
  const currentLeg = lastCompleted?.legType ?? (hasStarted ? startSplit?.legType ?? contest.legs[0]?.type ?? null : null);
  const awaitingCheckpointConfirmation = Boolean(
    status === 'ON_COURSE'
    && nextDefinition
    && estimatedDistanceKm >= nextDistanceKm - 0.000001,
  );
  const awaitingNextLegStart = sectionResolution.currentSectionType === 'transition'
    && sectionResolution.currentSectionStatus === 'in_progress';
  const legLabel = activeLegType
    ? activeLegType === 'run_1' || activeLegType === 'run_2'
      ? 'Run'
      : `${activeLegType.charAt(0).toUpperCase()}${activeLegType.slice(1)}`
    : 'Race';
  const courseState: CanonicalResolvedAthleteState['courseState'] = status === 'FINISHED'
    ? 'FINISHED'
    : status === 'DNF' || status === 'DNS' || status === 'DSQ'
      ? 'TERMINAL'
      : !hasStarted
        ? 'NOT_STARTED'
        : awaitingNextLegStart
          ? 'LEG_COMPLETE_AWAITING_NEXT_START'
          : awaitingCheckpointConfirmation
            ? 'WAITING_CHECKPOINT_CONFIRMATION'
            : 'ON_COURSE';
  const transitionLabel = sectionResolution.currentSectionKey?.toUpperCase() || 'Transition';
  const statusDetail = courseState === 'FINISHED'
    ? 'Finished'
    : courseState === 'TERMINAL'
      ? status
      : courseState === 'NOT_STARTED'
        ? 'Waiting for Start'
        : courseState === 'LEG_COMPLETE_AWAITING_NEXT_START'
          ? `${legLabel} Complete · ${transitionLabel} In Progress · Awaiting ${nextDefinition?.displayName || 'next leg start'}`
          : courseState === 'WAITING_CHECKPOINT_CONFIRMATION'
            ? `Waiting for ${nextDefinition?.displayName || 'next checkpoint'} confirmation`
            : `On Course · ${legLabel}`;
  const finishReadMillis = Date.parse(lastRead?.timestamp ?? lastRead?.occurredAt ?? '');
  const startReaderMillis = Date.parse(detectedStartTime ?? '');
  const gunStartMillis = Date.parse(gunStartTime ?? '');
  const waveStartTime = normalizeTimestampUtc(snapshot.identity?.waveStartTime, eventTimezone);
  const waveStartMillis = Date.parse(waveStartTime ?? '');
  const acceptedStartAt = acceptedStartState && detectedStartTime ? detectedStartTime : null;
  const gunElapsedAtStartMs = acceptedStartAt
    && Number.isFinite(startReaderMillis)
    && Number.isFinite(gunStartMillis)
      ? Math.max(0, startReaderMillis - gunStartMillis)
      : null;
  const terminalClockMillis = status === 'FINISHED'
    ? finishReadMillis
    : isTerminalStatus ? Date.parse(statusResolvedAt ?? '') : nowMillis;
  const officialRaceElapsedMs = raceClockStartTime && Number.isFinite(terminalClockMillis)
    ? Math.max(0, terminalClockMillis - Date.parse(raceClockStartTime))
    : null;
  const gunRaceElapsedMs = gunStartTime && Number.isFinite(terminalClockMillis)
    ? Math.max(0, terminalClockMillis - Date.parse(gunStartTime))
    : null;
  const chipRaceElapsedMs = acceptedStartAt && Number.isFinite(terminalClockMillis)
    ? Math.max(0, terminalClockMillis - Date.parse(acceptedStartAt))
    : null;
  const waveRaceElapsedMs = waveStartTime && Number.isFinite(terminalClockMillis) && Number.isFinite(waveStartMillis)
    ? Math.max(0, terminalClockMillis - waveStartMillis)
    : null;
  const startDelayMs = acceptedStartAt && Number.isFinite(startReaderMillis) && Number.isFinite(gunStartMillis)
    ? Math.max(0, startReaderMillis - gunStartMillis)
    : null;
  const finalAthleteElapsed = status === 'FINISHED'
    ? elapsedFromOfficialStart(lastRead, athleteStartTime)
    : null;
  const athleteElapsedMs = finalAthleteElapsed !== null
    ? finalAthleteElapsed * 1000
    : hasStarted && athleteStartTime && Number.isFinite(nowMillis)
      ? Math.max(0, nowMillis - Date.parse(athleteStartTime))
    : null;
  const finishCutoffSeconds = contest.cutoffs?.overall
    ?? contest.cutoffs?.finish
    ?? contest.legs.at(-1)?.cutoffSeconds
    ?? null;
  const cutoffElapsedMs = timingMode === 'GUN' ? officialRaceElapsedMs : athleteElapsedMs;
  const cutoffTimeRemainingSeconds = finishCutoffSeconds !== null && cutoffElapsedMs !== null
    ? Math.max(0, finishCutoffSeconds - (cutoffElapsedMs / 1000))
    : null;
  const cutoffStatus = finishCutoffSeconds !== null && cutoffElapsedMs !== null
    ? cutoffElapsedMs / 1000 > finishCutoffSeconds ? 'CUTOFF_EXCEEDED' as const : 'WITHIN_CUTOFF' as const
    : null;
  const acceptedSplitKeys = new Set(completed.map((split) => split.key));
  const activeCutoff = status === 'FINISHED'
    ? null
    : cutoffDefinitions.find((entry) => !acceptedSplitKeys.has(entry.boundarySplitKey)) ?? null;
  const cutoffDeadlineMillis = activeCutoff && raceClockStartTime
    ? Date.parse(raceClockStartTime) + activeCutoff.seconds * 1_000
    : Number.NaN;
  const projectedCutoffArrivalMillis = activeCutoff?.boundarySplitKey === finalSplitDefinition?.key
    ? estimatedFinishMillis
    : activeCutoff?.boundarySplitKey === nextDefinition?.key ? etaNextMillis : Number.NaN;
  const activeCutoffRemaining = Number.isFinite(cutoffDeadlineMillis) && Number.isFinite(nowMillis)
    ? Math.max(0, (cutoffDeadlineMillis - nowMillis) / 1_000)
    : null;
  const resolvedCutoff: CanonicalResolvedAthleteState['cutoff'] = activeCutoff
    && activeCutoffRemaining !== null
    && Number.isFinite(cutoffDeadlineMillis)
      ? {
          activeCutoffKey: activeCutoff.key,
          displayName: activeCutoff.displayName,
          boundarySplitKey: activeCutoff.boundarySplitKey,
          deadlineUtc: new Date(cutoffDeadlineMillis).toISOString(),
          deadlineLocal: formatEventLocalTime(new Date(cutoffDeadlineMillis).toISOString(), eventTimezone)
            ?? new Date(cutoffDeadlineMillis).toISOString(),
          remainingSeconds: activeCutoffRemaining,
          officialStatus: nowMillis > cutoffDeadlineMillis ? 'OUT_OF_CUTOFF' : 'ON_COURSE',
          projectionStatus: Number.isFinite(projectedCutoffArrivalMillis)
            ? projectedCutoffArrivalMillis > cutoffDeadlineMillis
              ? 'PROJECTED_OUT'
              : cutoffDeadlineMillis - projectedCutoffArrivalMillis <= 15 * 60 * 1_000 ? 'DANGER' : 'SAFE'
            : 'NO_ESTIMATE',
          projectedArrivalUtc: Number.isFinite(projectedCutoffArrivalMillis)
            ? new Date(projectedCutoffArrivalMillis).toISOString()
            : null,
        }
      : null;
  const positionSource: CanonicalResolvedAthleteState['positionSource'] = status === 'FINISHED'
    ? 'OFFICIAL_TIMING_POINT'
    : isTerminalStatus
      ? lastCompleted ? 'OFFICIAL_TIMING_POINT' : 'NO_POSITION'
    : hasStarted && nextDefinition && predictionSecondsPerKm
      ? 'OFFICIAL_TIMING_PREDICTION'
      : lastCompleted ? 'OFFICIAL_TIMING_POINT' : 'NO_POSITION';
  const activeLegCompleted = completed.filter((split) => split.legType === currentLeg).at(-1) ?? null;
  const activeLegTiming = activeLegCompleted ? splitTimings.get(activeLegCompleted.key) : null;
  const lastCompletedTiming = lastCompleted ? splitTimings.get(lastCompleted.key) : null;
  const currentLegElapsedMs = status === 'ON_COURSE' && officialRaceElapsedMs !== null && activeLegTiming?.overallElapsedSeconds !== null
    ? Math.max(0, officialRaceElapsedMs - ((activeLegTiming?.overallElapsedSeconds ?? 0) - (activeLegTiming?.legElapsedSeconds ?? 0)) * 1000)
    : activeLegTiming?.legElapsedSeconds != null ? activeLegTiming.legElapsedSeconds * 1000 : null;
  const currentSectionElapsedMs = sectionResolution.currentSectionStatus === 'in_progress'
    && sectionResolution.elapsedSeconds !== null
      ? sectionResolution.elapsedSeconds * 1000
      : status === 'ON_COURSE' && officialRaceElapsedMs !== null && lastCompletedTiming?.overallElapsedSeconds != null
        ? Math.max(0, officialRaceElapsedMs - lastCompletedTiming.overallElapsedSeconds * 1000)
        : 0;
  const finalMetrics = calculateCanonicalDurations(normalizedReads, contest);
  const officialResultElapsedMs = status === 'FINISHED' ? officialRaceElapsedMs : null;
  const averageRacePaceSecondsPerKm = status === 'FINISHED'
    ? divide(
        officialResultElapsedMs === null ? finalMetrics.overallSeconds : officialResultElapsedMs / 1000,
        totalDistanceKm,
      )
    : null;
  return {
    eventTimezone,
    hasStarted,
    status,
    statusReason,
    statusSource,
    statusResolvedAt,
    failedCheckpoint,
    cutoffSeconds: terminalCutoffSeconds,
    cutoffDeadline: terminalCutoffDeadline,
    elapsedAtResolution,
    timingMode,
    officialTimingMode: timingMode,
    gunStartTime,
    athleteStartTime,
    gunStartTimeUtc: gunStartTime,
    athleteStartTimeUtc: athleteStartTime,
    officialGunStartAt: gunStartTime,
    startReaderAt: acceptedStartAt,
    acceptedStartAt,
    officialStartAt: raceClockStartTime,
    gunStartAt: gunStartTime,
    chipStartAt: acceptedStartAt,
    waveStartAt: waveStartTime,
    startDelayMs,
    gunElapsedAtStartMs,
    officialElapsedMs: officialRaceElapsedMs,
    officialRaceElapsedMs,
    liveOverallElapsedMs: officialRaceElapsedMs,
    currentLegElapsedMs,
    currentSectionElapsedMs,
    athleteElapsedMs,
    finishTimeUtc: status === 'FINISHED' && Number.isFinite(finishReadMillis) ? new Date(finishReadMillis).toISOString() : null,
    // The timestamp is the authority. Legacy/provider result rows can contain
    // a UTC clock in timeOfDay even when the event is Asia/Kolkata, which made
    // mobile show 17:58 while the official split correctly showed 23:28.
    finishTimeOfDay: status === 'FINISHED'
      ? (Number.isFinite(finishReadMillis)
          ? formatEventLocalTime(new Date(finishReadMillis).toISOString(), eventTimezone)
          : String(lastRead?.timeOfDay ?? '').trim() || null)
      : null,
    finalSplitAccepted: status === 'FINISHED',
    finishAt: status === 'FINISHED' && Number.isFinite(finishReadMillis) ? new Date(finishReadMillis).toISOString() : null,
    officialFinishAt: status === 'FINISHED' && Number.isFinite(finishReadMillis) ? new Date(finishReadMillis).toISOString() : null,
    finalElapsedMs: status === 'FINISHED' ? athleteElapsedMs : null,
    gunElapsedMs: gunRaceElapsedMs,
    chipElapsedMs: chipRaceElapsedMs,
    waveElapsedMs: waveRaceElapsedMs,
    officialResultElapsedMs,
    officialResultBasis: timingMode,
    overallRank: hasRankableCheckpoint ? snapshot.overallRanking?.overallRank ?? null : null,
    categoryRank: hasRankableCheckpoint ? snapshot.overallRanking?.ageGroupRank ?? null : null,
    genderRank: hasRankableCheckpoint ? snapshot.overallRanking?.genderRank ?? null : null,
    clubRank: hasRankableCheckpoint ? snapshot.overallRanking?.clubRank ?? null : null,
    finalRank: status === 'FINISHED' ? snapshot.overallRanking?.overallRank ?? null : null,
    averageRacePaceSecondsPerKm,
    finishCutoffSeconds,
    cutoffTimeRemainingSeconds,
    cutoffStatus,
    cutoff: resolvedCutoff,
    startSource: officialStartResolution.startSource,
    currentLeg,
    currentSectionKey: sectionResolution.currentSectionKey,
    currentSectionType: sectionResolution.currentSectionType,
    currentSectionStatus: status === 'FINISHED' ? 'finished' : sectionResolution.currentSectionStatus,
    previousSectionKey: sectionResolution.previousSectionKey,
    nextSectionKey: sectionResolution.nextSectionKey,
    currentSectionActiveSince: sectionResolution.activeSince,
    lastCompletedSplit: lastState,
    currentSplit: lastState ?? (!hasStarted ? byKey.get(startSplit?.key ?? '') ?? null : null),
    nextExpectedSplit: nextState,
    lastTimingPoint: lastState,
    officialDistanceKm,
    estimatedDistanceKm,
    officialLegDistanceKm,
    estimatedLegDistanceKm,
    currentLegDistanceKm,
    currentLegProgressRatio,
    totalDistanceKm,
    distanceRemainingKm: Math.max(0, totalDistanceKm - officialDistanceKm),
    estimatedDistanceRemainingKm: Math.max(0, totalDistanceKm - estimatedDistanceKm),
    distanceToNextSplitKm,
    officialProgressRatio: totalDistanceKm > 0 ? officialDistanceKm / totalDistanceKm : 0,
    // The prediction marker may wait at the finish arch, but the official
    // progress bar must not visually complete until the final split is
    // accepted. Reserve the final half-percent for official FINISH evidence.
    estimatedProgressRatio: totalDistanceKm > 0
      ? status === 'FINISHED'
        ? 1
        : Math.min(0.995, estimatedDistanceKm / totalDistanceKm)
      : 0,
    etaNextSplit: isTerminalStatus ? null : Number.isFinite(etaNextMillis) ? new Date(etaNextMillis).toISOString() : null,
    estimatedElapsedAtNextSplitSeconds: !isTerminalStatus
      && Number.isFinite(etaNextMillis)
      && raceClockStartTime
      && Number.isFinite(Date.parse(raceClockStartTime))
        ? Math.max(0, (etaNextMillis - Date.parse(raceClockStartTime)) / 1000)
        : null,
    estimatedFinishElapsedSeconds: !isTerminalStatus
      && Number.isFinite(estimatedFinishMillis)
      && raceClockStartTime
      && Number.isFinite(Date.parse(raceClockStartTime))
        ? Math.max(0, (estimatedFinishMillis - Date.parse(raceClockStartTime)) / 1000)
        : null,
    estimatedSecondsToNextSplit: !isTerminalStatus && Number.isFinite(etaNextMillis) && Number.isFinite(nowMillis)
      ? Math.max(0, (etaNextMillis - nowMillis) / 1000)
      : null,
    estimatedFinishTime: isTerminalStatus ? null : Number.isFinite(estimatedFinishMillis) ? new Date(estimatedFinishMillis).toISOString() : null,
    predictionAnchorTimeUtc: Number.isFinite(anchorMillis) ? new Date(anchorMillis).toISOString() : null,
    predictionAnchorDistanceKm: officialDistanceKm,
    nextSplitDistanceKm: nextDefinition?.cumulativeDistanceKm ?? null,
    awaitingCheckpointConfirmation,
    courseState,
    statusDetail,
    // Compatibility: released clients read this field for the compact AVG
    // PACE tile. At FINISH it becomes the frozen official whole-race average;
    // predictionSource remains NO_ESTIMATE and no movement uses this value.
    predictedPaceSecondsPerKm: status === 'FINISHED' ? averageRacePaceSecondsPerKm : predictionSecondsPerKm,
    predictedSpeedKmh: status === 'FINISHED' ? null : predictionSecondsPerKm ? 3600 / predictionSecondsPerKm : null,
    predictionSource,
    predictionConfidence: measuredSegments.length >= 3
      ? 'HIGH'
      : measuredSegments.length >= 2
        ? 'MEDIUM'
        : 'LOW',
    positionSource,
    lastOfficialReadAt: lastRead?.timestamp ?? lastRead?.occurredAt ?? (hasStarted ? athleteStartTime : null),
    splits: preliminary,
  };
}

function buildSplitRows(snapshot: CanonicalAthleteSnapshot, contest: CanonicalContestCourse): CanonicalSplitRow[] {
  const rows: CanonicalSplitRow[] = [];
  const timings = deriveSplitTimings(snapshot.reads, contest);
  const previousByLeg = new Map<CanonicalLegType, { split: CanonicalSplit; elapsedSeconds: number }>();
  const startByLeg = new Map<CanonicalLegType, { split: CanonicalSplit; elapsedSeconds: number }>();
  const hasCourseEvidence = contest.splits.some((split) => validRead(snapshot.reads[split.key] ?? null));
  for (const split of contest.splits) {
    const read = snapshot.reads[split.key] ?? null;
    const timing = timings.get(split.key);
    const readAt = normalizeTimestampUtc(read?.timestamp ?? read?.occurredAt, contest.timezone || 'UTC');
    const previous = previousByLeg.get(split.legType);
    const currentElapsed = validRead(read)
      ? elapsed(read)
      : split.isStart && hasCourseEvidence ? 0 : null;
    const providerSegmentSeconds = validRead(read)
      && typeof read?.segmentElapsedSeconds === 'number'
      && Number.isFinite(read.segmentElapsedSeconds)
      && read.segmentElapsedSeconds >= 0
      ? read.segmentElapsedSeconds
      : null;
    // Feibot's segment time is authoritative when supplied. In GUN mode the
    // cumulative elapsed clock includes the delay before the athlete crossed
    // START, so subtracting cumulative values would incorrectly add that
    // delay to START -> first split pace.
    const segmentSeconds = providerSegmentSeconds ?? (currentElapsed !== null && previous
      ? difference(currentElapsed, previous.elapsedSeconds)
      : null);
    const segmentDistance = previous ? split.distanceInLegKm - previous.split.distanceInLegKm : split.distanceInLegKm;
    if (currentElapsed !== null && !startByLeg.has(split.legType)) {
      startByLeg.set(split.legType, { split, elapsedSeconds: currentElapsed });
    }
    const legStart = startByLeg.get(split.legType);
    const providerLegSeconds = validRead(read)
      && typeof read?.legElapsedSeconds === 'number'
      && Number.isFinite(read.legElapsedSeconds)
      && read.legElapsedSeconds >= 0
      ? read.legElapsedSeconds
      : null;
    // Leaderboard pace is cumulative within the active sport, never merely the
    // last antenna-to-antenna segment and never the whole triathlon clock.
    // START rows therefore have zero leg distance/time and intentionally emit
    // no pace. Intermediate rows use the configured distance within the leg.
    const legSeconds = providerLegSeconds ?? (currentElapsed !== null && legStart
      ? difference(currentElapsed, legStart.elapsedSeconds)
      : null);
    const legDistance = legStart ? split.distanceInLegKm - legStart.split.distanceInLegKm : split.distanceInLegKm;
    const positiveLegDistance = legDistance > 0 ? legDistance : null;
    const paceSecondsPerKm = split.legType.startsWith('run') && positiveLegDistance ? divide(legSeconds, positiveLegDistance) : null;
    const paceSecondsPer100m = split.legType === 'swim' && positiveLegDistance ? divide(legSeconds, positiveLegDistance * 10) : null;
    const speedKmh = split.legType === 'bike' && positiveLegDistance && legSeconds && legSeconds > 0
      ? positiveLegDistance / (legSeconds / 3600)
      : null;
    rows.push({
      splitKey: split.key,
      displayName: split.displayName,
      legType: split.legType,
      status: read?.status ?? 'missing',
      readAt,
      timeOfDay: readAt
        ? formatEventLocalTime(readAt, contest.timezone || 'UTC')
        : String(read?.timeOfDay ?? '').trim() || null,
      elapsedSeconds: elapsed(read),
      overallElapsedSeconds: timing?.overallElapsedSeconds ?? elapsed(read),
      legElapsedSeconds: timing?.legElapsedSeconds ?? legSeconds,
      sectionElapsedSeconds: timing?.sectionElapsedSeconds ?? segmentSeconds,
      sectionSeconds: timing?.sectionElapsedSeconds ?? segmentSeconds,
      paceSecondsPerKm,
      paceSecondsPer100m,
      speedKmh,
      ranking: snapshot.splitRankings[split.key] ?? null,
    });
    if (currentElapsed !== null) previousByLeg.set(split.legType, { split, elapsedSeconds: currentElapsed });
  }
  return rows;
}

function sectionDuration(section: CanonicalRaceSection, rows: CanonicalSplitRow[]): number | null {
  const start = rows.find((row) => row.splitKey === section.startSplitKey);
  const finish = rows.find((row) => row.splitKey === section.finishSplitKey);
  const startElapsed = start?.overallElapsedSeconds ?? start?.elapsedSeconds ?? null;
  const finishElapsed = finish?.overallElapsedSeconds ?? finish?.elapsedSeconds ?? null;
  return difference(finishElapsed, startElapsed);
}

function buildSections(
  snapshot: CanonicalAthleteSnapshot,
  contest: CanonicalContestCourse,
  rows: CanonicalSplitRow[],
  metrics: CanonicalCalculatedMetrics,
): CanonicalRaceSection[] {
  const resolved = snapshot.raceState.resolved;
  const definitions = configuredRaceSections(contest);
  const currentOrder = definitions.find((section) => section.key === resolved?.currentSectionKey)?.order ?? null;
  return definitions.map((section) => {
    const officialDurationSeconds = sectionDuration(section, rows);
    const isCurrent = resolved?.currentSectionKey === section.key && resolved.currentSectionStatus === 'in_progress';
    // Section completion is boundary-driven. A stale/manual race-level
    // FINISHED status must not paint Swim, T1, Bike, T2 and Run as completed
    // when their configured finish boundaries do not exist.
    const status = officialDurationSeconds !== null
      ? 'completed' as const
      : isCurrent
        ? 'in_progress' as const
        : currentOrder !== null && section.order < currentOrder
          ? 'completed' as const
          : 'not_started' as const;
    // A transition is complete only when both configured boundaries exist.
    // Never manufacture 00:00:00 (or an in-progress clock) from one boundary.
    const durationSeconds = officialDurationSeconds ?? (isCurrent && section.sectionType !== 'transition'
      ? (resolved?.currentLegElapsedMs ?? 0) / 1000
      : null);
    const sectionRows = section.sectionType === 'leg' ? rows.filter((row) => row.legType === section.legType) : [];
    if (section.sectionType === 'transition') {
      return {
        ...section,
        status,
        durationSeconds,
        transitionSource: officialDurationSeconds !== null ? 'calculated' : 'pending',
        activeSince: isCurrent ? resolved?.currentSectionActiveSince ?? null : null,
        rows: sectionRows,
      };
    }
    const averageMetric = section.legType === 'swim'
      ? metrics.averageSwimPaceSecondsPer100m
      : section.legType === 'bike'
        ? metrics.averageBikeSpeedKmh
        : metrics.averageRunPaceSecondsPerKm;
    return {
      ...section,
      status,
      durationSeconds,
      activeSince: isCurrent ? resolved?.currentSectionActiveSince ?? null : null,
      averageMetric,
      rankings: snapshot.overallRanking,
      rows: sectionRows,
    };
  });
}

export function recalculateAthleteSnapshot(
  snapshot: CanonicalAthleteSnapshot,
  contest: CanonicalContestCourse,
  updatedAt = new Date().toISOString(),
): CanonicalAthleteSnapshot {
  const eligibleReads = eligibleTimingReads(snapshot.reads, contest, updatedAt);
  const preflightResolved = resolveCanonicalAthleteState({ ...snapshot, reads: eligibleReads }, contest, updatedAt);
  const officialReads = preflightResolved.hasStarted
    ? normalizeOverallReadClocks(eligibleReads, preflightResolved.athleteStartTime)
    : Object.fromEntries(Object.keys(eligibleReads).map((key) => [key, null]));
  const calculated = calculateCanonicalDurations(officialReads, contest);
  const validSplits = contest.splits.filter((split) => validRead(officialReads[split.key] ?? null));
  const lastSplit = validSplits.at(-1) ?? null;
  const configuredStartSplit = contest.splits.find((split) => split.isRaceStart || split.isStart)
    ?? contest.splits[0]
    ?? null;
  const acceptedStartRead = configuredStartSplit ? officialReads[configuredStartSplit.key] ?? null : null;
  const orderedSplits = [...contest.splits].sort((left, right) => left.order - right.order);
  const finishSplit = configuredRaceFinishSplit(contest);
  const persistedTerminal = terminalResolvedStatus(snapshot.raceState.status);
  const persistedManualTerminal = persistedTerminal
    && snapshot.raceState.statusSource === 'MANUAL_OVERRIDE'
    && !(persistedTerminal === 'DNS' && validRead(acceptedStartRead));
  const status = persistedManualTerminal
    ? snapshot.raceState.status
    : finishSplit && validRead(officialReads[finishSplit.key] ?? null)
      ? 'finished'
      : statusForReads(officialReads, contest);
  const leg = currentLeg(status, contest, officialReads);
  const distanceCompletedKm = lastSplit?.cumulativeDistanceKm ?? 0;
  const progressRatio = contest.totalDistanceKm > 0 ? Math.min(1, Math.max(0, distanceCompletedKm / contest.totalDistanceKm)) : 0;
  const lastRead = lastSplit ? officialReads[lastSplit.key] : null;
  const next: CanonicalAthleteSnapshot = {
    ...snapshot,
    updatedAt,
    reads: officialReads,
    calculated,
    startTiming: preflightResolved.hasStarted
      ? {
          ...snapshot.startTiming,
          officialStartTime: preflightResolved.timingMode === 'CHIP'
            ? preflightResolved.athleteStartTime
            : preflightResolved.officialGunStartAt
              ?? preflightResolved.athleteStartTime
              ?? snapshot.startTiming?.officialStartTime
              ?? null,
          chipStartDetectionTime: preflightResolved.startReaderAt
            ?? snapshot.startTiming?.chipStartDetectionTime
            ?? null,
          startTimeSource: preflightResolved.timingMode,
          startTimeLocked: true,
          acceptedReadId: acceptedStartRead?.readId ?? snapshot.startTiming?.acceptedReadId ?? null,
          startPassageId: acceptedStartRead?.readId ?? snapshot.startTiming?.startPassageId ?? null,
          startStatus: preflightResolved.status === 'FINISHED' ? 'FINISHED' : 'ON_COURSE',
          startInferenceSource: acceptedStartRead ? 'reader' : snapshot.startTiming?.startInferenceSource ?? null,
          updatedAt,
        }
      : snapshot.startTiming,
    raceState: {
      ...snapshot.raceState,
      status,
      currentSectionKey: status === 'in_t1' ? 't1' : status === 'in_t2' ? 't2' : leg,
      currentLegType: leg,
      progressRatio,
      distanceCompletedKm,
      elapsedSeconds: preflightResolved.hasStarted && preflightResolved.liveOverallElapsedMs !== null
        ? preflightResolved.liveOverallElapsedMs / 1000
        : calculated.overallSeconds ?? elapsed(lastRead),
      lastReadAt: lastRead?.timestamp ?? lastRead?.occurredAt ?? null,
    },
    location: {
      segment: status === 'not_started' ? 'not_started' : status === 'finished' ? 'finished' : status === 'in_t1' ? 't1' : status === 'in_t2' ? 't2' : leg ?? 'not_started',
      latitude: snapshot.location?.latitude ?? null,
      longitude: snapshot.location?.longitude ?? null,
      courseDistanceKm: distanceCompletedKm,
      legDistanceKm: lastSplit?.distanceInLegKm ?? 0,
      accuracyMetres: snapshot.location?.accuracyMetres ?? null,
      recordedAt: lastRead?.timestamp ?? lastRead?.occurredAt ?? null,
      source: lastSplit ? 'timing_read' : 'not_started',
      estimated: false,
    },
    splits: [],
    sections: [],
  };
  next.splits = buildSplitRows(next, contest);
  const resolved = resolveCanonicalAthleteState(next, contest, updatedAt);
  const readStatus = statusForReads(next.reads, contest);
  const onCourseStatus: CanonicalAthleteStatus = readStatus !== 'not_started'
    ? readStatus
    : resolved.currentLeg === 'swim' ? 'swimming'
      : resolved.currentLeg === 'bike' ? 'cycling'
        : resolved.currentLeg === 'run' || resolved.currentLeg === 'run_1' || resolved.currentLeg === 'run_2' ? 'running'
          : 'running';
  next.raceState = {
    ...next.raceState,
    status: resolved.status === 'FINISHED' ? 'finished'
      : resolved.status === 'DNF' ? 'dnf'
          : resolved.status === 'DNS' ? 'dns'
          : resolved.status === 'DSQ' ? 'disqualified'
            : resolved.hasStarted ? onCourseStatus : 'not_started',
    statusReason: resolved.statusReason,
    statusSource: resolved.statusSource,
    statusResolvedAt: resolved.statusResolvedAt,
    failedCheckpoint: resolved.failedCheckpoint,
    cutoffSeconds: resolved.cutoffSeconds,
    cutoffDeadline: resolved.cutoffDeadline,
    elapsedAtResolution: resolved.elapsedAtResolution,
    currentLegType: resolved.currentLeg,
    currentSectionKey: resolved.currentSectionKey,
    progressRatio: resolved.officialProgressRatio,
    distanceCompletedKm: resolved.officialDistanceKm,
    lastReadAt: resolved.lastOfficialReadAt,
    elapsedSeconds: resolved.hasStarted && resolved.liveOverallElapsedMs !== null ? resolved.liveOverallElapsedMs / 1000 : null,
    resolved,
  };
  // A result time exists only for an accepted Race Finish. Keep leg/split
  // durations for review, but never leak an intermediate or late DNF clock as
  // an official finish through indexes, leaderboards, web, or mobile clients.
  if (resolved.status !== 'FINISHED') {
    next.calculated = {
      ...next.calculated,
      overallSeconds: null,
      averageRacePaceSecondsPerKm: null,
    };
  }
  next.location = {
    ...next.location,
    latitude: next.location?.latitude ?? null,
    longitude: next.location?.longitude ?? null,
    accuracyMetres: next.location?.accuracyMetres ?? null,
    segment: resolved.status === 'FINISHED'
      ? 'finished'
      : resolved.status === 'DNS'
        ? 'not_started'
      : resolved.currentSectionType === 'transition'
        ? (resolved.currentSectionKey === 't1' ? 't1' : 't2')
        : resolved.currentLeg ?? next.location?.segment ?? 'not_started',
    // Overall map/timeline progress uses cumulative distance, while the active
    // leg GPX always receives distance measured inside that leg.
    courseDistanceKm: resolved.estimatedDistanceKm,
    legDistanceKm: resolved.estimatedLegDistanceKm,
    recordedAt: resolved.lastOfficialReadAt,
    source: resolved.positionSource === 'OFFICIAL_TIMING_PREDICTION'
      ? 'estimated'
      : resolved.status === 'NOT_STARTED' || resolved.status === 'WAITING_CHIP_START'
        ? 'not_started'
        : resolved.status === 'FINISHED'
          ? 'finished'
          : 'timing_read',
    estimated: resolved.positionSource === 'OFFICIAL_TIMING_PREDICTION'
      && !['DNS', 'DNF', 'DSQ'].includes(resolved.status),
  };
  const completedSplitCount = resolved.splits.filter((split) => split.status === 'COMPLETED').length;
  const consistencyErrors = [
    resolved.status === 'ON_COURSE' && !resolved.athleteStartTime ? 'on_course_without_resolved_start' : null,
    resolved.status === 'ON_COURSE' && !resolved.currentSplit ? 'on_course_without_current_split' : null,
    resolved.status === 'ON_COURSE' && completedSplitCount === 0 ? 'on_course_without_completed_split' : null,
  ].filter(Boolean);
  if (consistencyErrors.length > 0) {
    console.error('[LIVE STATE CONSISTENCY ERROR]', {
      bib: next.identity?.bib,
      status: resolved.status,
      resolvedStartTime: resolved.athleteStartTime,
      currentSplit: resolved.currentSplit?.name ?? null,
      completedSplits: resolved.splits.filter((split) => split.status === 'COMPLETED').map((split) => split.name),
      errors: consistencyErrors,
    });
  }
  next.splits = next.splits.map((row) => ({
    ...row,
    progressStatus: resolved.splits.find((split) => split.splitKey === row.splitKey)?.status ?? 'PENDING',
  }));
  next.sections = buildSections(next, contest, next.splits, calculated);
  return next;
}

function formatDurationLabel(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null;
  const whole = Math.floor(seconds);
  return [Math.floor(whole / 3600), Math.floor((whole % 3600) / 60), whole % 60]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
}

function formatPaceLabel(secondsPerKm: number | null): string | null {
  if (secondsPerKm === null || !Number.isFinite(secondsPerKm) || secondsPerKm <= 0) return null;
  const rounded = Math.round(secondsPerKm);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')} /km`;
}

function ordinal(rank: number | null): string | null {
  if (rank === null || !Number.isInteger(rank) || rank <= 0) return null;
  const mod100 = rank % 100;
  const suffix = mod100 >= 11 && mod100 <= 13
    ? 'th'
    : rank % 10 === 1 ? 'st' : rank % 10 === 2 ? 'nd' : rank % 10 === 3 ? 'rd' : 'th';
  return `${rank}${suffix}`;
}

/**
 * Adds the stable finish/result fields after leaderboard ranks are known.
 * It is also safe to call at read time, allowing a Worker-only deployment to
 * enrich an already-published immutable snapshot without rewriting KV.
 */
export function withCanonicalFinalSummary(
  snapshot: CanonicalAthleteSnapshot,
  contest: CanonicalContestCourse,
  now = snapshot.updatedAt || new Date().toISOString(),
): CanonicalAthleteSnapshot {
  const resolved = resolveCanonicalAthleteState(snapshot, contest, now);
  const calculated = calculateCanonicalDurations(snapshot.reads, contest);
  const finished = resolved.status === 'FINISHED' && resolved.finalSplitAccepted;
  const totalDistanceKm = Math.max(
    Number(contest.configuredRaceDistanceKm || 0),
    Number(contest.totalDistanceKm || 0),
    contest.legs.reduce((sum, leg) => sum + Number(leg.distanceKm || 0), 0),
    ...contest.splits.map((split) => Number(split.cumulativeDistanceKm || 0)),
  );
  const officialSeconds = finished
    ? resolved.officialResultElapsedMs !== null
      ? resolved.officialResultElapsedMs / 1000
      : calculated.overallSeconds
    : null;
  const averageRacePaceSecondsPerKm = finished
    ? divide(officialSeconds, totalDistanceKm)
    : null;
  const overallRank = finished ? snapshot.overallRanking.overallRank : null;
  const genderRank = finished ? snapshot.overallRanking.genderRank : null;
  const ageGroupRank = finished ? snapshot.overallRanking.ageGroupRank : null;
  const clubRank = finished ? snapshot.overallRanking.clubRank : null;
  const rankDisplay = ordinal(overallRank);
  const paceDisplay = formatPaceLabel(averageRacePaceSecondsPerKm);
  const timingSummary = {
    swimSeconds: calculated.swimSeconds,
    t1Seconds: calculated.t1Seconds,
    bikeSeconds: calculated.bikeSeconds,
    t2Seconds: calculated.t2Seconds,
    runSeconds: calculated.runSeconds,
    overallSeconds: officialSeconds,
  };
  const finalSummary = {
    ...timingSummary,
    finished,
    finishTimeUtc: finished ? resolved.finishTimeUtc : null,
    finishTimeOfDay: finished ? resolved.finishTimeOfDay : null,
    overallRank,
    genderRank,
    ageGroupRank,
    clubRank,
    averageRacePaceSecondsPerKm,
    averageRunPaceSecondsPerKm: finished ? calculated.averageRunPaceSecondsPerKm : null,
    averageBikeSpeedKmh: finished ? calculated.averageBikeSpeedKmh : null,
    averageSwimPaceSecondsPer100m: finished ? calculated.averageSwimPaceSecondsPer100m : null,
    totalDistanceKm,
    rankDisplay,
    paceDisplay,
  };
  return {
    ...snapshot,
    calculated: { ...calculated, overallSeconds: officialSeconds, averageRacePaceSecondsPerKm },
    raceState: {
      ...snapshot.raceState,
      elapsedSeconds: finished ? officialSeconds : snapshot.raceState.elapsedSeconds,
      resolved: {
        ...resolved,
        finalRank: overallRank,
        clubRank,
        averageRacePaceSecondsPerKm,
        predictedPaceSecondsPerKm: finished
          ? averageRacePaceSecondsPerKm
          : resolved.predictedPaceSecondsPerKm,
      },
    },
    finalSummary,
    summary: timingSummary,
    display: {
      statusLabel: finished
        ? 'Finished'
        : resolved.status === 'DNF' && resolved.statusReason?.includes('CUTOFF_EXCEEDED')
          ? 'DNF – Cutoff Exceeded'
          : resolved.status.replace(/_/g, ' '),
      overallTimeLabel: formatDurationLabel(officialSeconds),
      overallRankLabel: rankDisplay,
      overallRankOrdinal: rankDisplay,
      averageRacePaceLabel: paceDisplay,
      swimTimeLabel: formatDurationLabel(calculated.swimSeconds),
      t1TimeLabel: formatDurationLabel(calculated.t1Seconds),
      bikeTimeLabel: formatDurationLabel(calculated.bikeSeconds),
      t2TimeLabel: formatDurationLabel(calculated.t2Seconds),
      runTimeLabel: formatDurationLabel(calculated.runSeconds),
      finishTimeLabel: formatDurationLabel(officialSeconds),
    },
    status: finished ? 'finished' : resolved.status.toLowerCase(),
    currentLeg: finished ? 'FINISHED' : resolved.currentLeg,
    currentSplit: resolved.currentSplit?.name ?? null,
    rank: overallRank,
    overallRank,
    finalRank: overallRank,
    genderRank,
    ageGroupRank,
    clubRank,
    averageRacePaceSecondsPerKm,
    averagePaceSecondsPerKm: averageRacePaceSecondsPerKm,
    averagePace: averageRacePaceSecondsPerKm,
    avgPace: averageRacePaceSecondsPerKm,
    pace: averageRacePaceSecondsPerKm,
    averagePaceLabel: paceDisplay,
    finishTime: officialSeconds,
    overallTime: officialSeconds,
  };
}

function readPriority(read: CanonicalTimingRead): number {
  if (read.source === 'final' || read.status === 'official') return 4;
  if (read.source === 'correction' || read.status === 'manual_corrected') return 3;
  if (read.status === 'valid' || read.status === 'confirmed' || read.status === 'corrected') return 2;
  if (read.status === 'estimated') return 1;
  return 0;
}

function selectCanonicalTimingReadAuthoritative(
  existing: CanonicalTimingRead | null,
  candidate: CanonicalTimingRead,
  split: CanonicalSplit,
): CanonicalTimingRead | null {
  if (elapsed(candidate) === null || candidate.status === 'invalid' || candidate.status === 'rejected') return existing;
  if (!existing) {
    if (split.readSelectionRule === 'pass_number' && split.passNumber !== candidate.passNumber) return null;
    if (split.readSelectionRule === 'manual' && readPriority(candidate) < 3) return null;
    return candidate;
  }
  const existingPriority = readPriority(existing);
  const candidatePriority = readPriority(candidate);
  if (candidatePriority !== existingPriority) return candidatePriority > existingPriority ? candidate : existing;
  if (split.readSelectionRule === 'first') {
    const candidateElapsed = elapsed(candidate) ?? Infinity;
    const existingElapsed = elapsed(existing) ?? Infinity;
    if (candidateElapsed !== existingElapsed) return candidateElapsed < existingElapsed ? candidate : existing;
    const candidateTime = Date.parse(candidate.timestamp ?? candidate.occurredAt);
    const existingTime = Date.parse(existing.timestamp ?? existing.occurredAt);
    return Number.isFinite(candidateTime) && (!Number.isFinite(existingTime) || candidateTime < existingTime) ? candidate : existing;
  }
  if (split.readSelectionRule === 'fastest') return (candidate.segmentElapsedSeconds ?? candidate.elapsedSeconds ?? Infinity) < (existing.segmentElapsedSeconds ?? existing.elapsedSeconds ?? Infinity) ? candidate : existing;
  if (split.readSelectionRule === 'pass_number') return candidate.passNumber === split.passNumber ? candidate : existing;
  if (split.readSelectionRule === 'manual') return candidatePriority >= 3 ? candidate : existing;
  const candidateTime = Date.parse(candidate.timestamp ?? candidate.occurredAt);
  const existingTime = Date.parse(existing.timestamp ?? existing.occurredAt);
  return Number.isFinite(candidateTime) && (!Number.isFinite(existingTime) || candidateTime >= existingTime) ? candidate : existing;
}

export function selectCanonicalTimingRead(
  existing: CanonicalTimingRead | null,
  candidate: CanonicalTimingRead,
  split: CanonicalSplit,
): CanonicalTimingRead | null {
  return shadowSelectTimingRead(
    { existing, candidate, split },
    selectCanonicalTimingReadAuthoritative(existing, candidate, split),
  );
}

export function applyCanonicalTimingRead(
  snapshot: CanonicalAthleteSnapshot,
  contest: CanonicalContestCourse,
  candidate: CanonicalTimingRead,
): CanonicalAthleteSnapshot {
  const split = contest.splits.find((entry) => entry.key === candidate.splitKey || entry.providerSplitId === candidate.providerSplitId);
  if (!split) return snapshot;
  const selected = selectCanonicalTimingRead(snapshot.reads[split.key] ?? null, { ...candidate, splitKey: split.key }, split);
  const reads = { ...snapshot.reads, [split.key]: selected };
  return recalculateAthleteSnapshot({
    ...snapshot,
    reads,
    timingVersion: snapshot.timingVersion + 1,
    versions: { ...snapshot.versions, timing: snapshot.versions.timing + 1 },
  }, contest, candidate.receivedAt || new Date().toISOString());
}

function processedTimingNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric >= 0) return numeric;
  }
  return null;
}

function processedTimingText(value: unknown): string {
  return String(value ?? '').trim();
}

function processedTimingTimestamp(...values: unknown[]): string {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const raw = processedTimingText(value);
    const numeric = Number(raw);
    if (Number.isFinite(numeric) && numeric > 0) {
      const epochMillis = numeric < 10_000_000_000 ? numeric * 1_000 : numeric;
      const date = new Date(epochMillis);
      if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return '';
}

function hasExplicitProcessedAcceptance(value: Record<string, unknown>): boolean {
  const status = processedTimingText(
    value.progressStatus
      ?? value.timingStatus
      ?? value.resultStatus
      ?? value.validity
      ?? value.status,
  ).toUpperCase();
  return value.accepted === true
    || value.isAccepted === true
    || [
      'ACCEPTED',
      'COMPLETED',
      'VALID',
      'OFFICIAL',
      'CONFIRMED',
      'FIXED',
      'CORRECTED',
      'MANUAL_CORRECTED',
    ].includes(status);
}

/**
 * Reconciles the mutable Feibot-processed result with an active versioned
 * athlete snapshot. Only rows carrying explicit provider acceptance and an
 * absolute reader/result timestamp are eligible. This is the read/persistence
 * safety net when participantLive advances before the Durable Object snapshot.
 */
export function mergeProcessedParticipantLiveSnapshot(
  snapshot: CanonicalAthleteSnapshot,
  contest: CanonicalContestCourse,
  processed: unknown,
  updatedAt = new Date().toISOString(),
): CanonicalAthleteSnapshot {
  if (!processed || typeof processed !== 'object') return snapshot;
  const source = processed as Record<string, any>;
  const rows = Array.isArray(source.splits) ? source.splits : [];
  const matched = rows.flatMap((row: Record<string, any>) => {
    if (!row || typeof row !== 'object' || !hasExplicitProcessedAcceptance(row)) return [];
    const timestamp = processedTimingTimestamp(
      row.readAt,
      row.acceptedAt,
      row.absoluteTimestamp,
      row.timestamp,
      row.detectedAt,
    );
    if (!timestamp) return [];
    const splitKey = processedTimingText(row.splitKey ?? row.key);
    const providerSplitId = processedTimingText(row.providerSplitId ?? row.splitUuid ?? row.split_uuid);
    const providerTimingPointId = processedTimingText(
      row.providerTimingPointId ?? row.timingPointUuid ?? row.timing_point_uuid,
    );
    const passNumber = processedTimingNumber(row.passNumber, row.pass_number);
    const normalizedName = processedTimingText(row.splitName ?? row.name).toLowerCase();
    const timingPointCandidates = providerTimingPointId
      ? contest.splits.filter((entry) => entry.providerTimingPointId === providerTimingPointId)
      : [];
    const timingPointPassCandidates = passNumber === null
      ? []
      : timingPointCandidates.filter((entry) => entry.passNumber === passNumber);
    if (timingPointPassCandidates.length > 1) {
      console.error('[CANONICAL TIMING AMBIGUOUS SPLIT]', {
        providerEventUuid: contest.providerEventUuid || null,
        contestUuid: contest.providerContestUuid,
        timingPointUuid: providerTimingPointId,
        passNumber,
        candidateSplits: timingPointPassCandidates.map((entry) => ({
          splitKey: entry.key,
          providerSplitId: entry.providerSplitId,
          splitName: entry.displayName,
          order: entry.order,
        })),
      });
      return [];
    }
    const split = contest.splits.find((entry) => splitKey && entry.key === splitKey)
      ?? contest.splits.find((entry) => providerSplitId && entry.providerSplitId === providerSplitId)
      ?? timingPointPassCandidates[0]
      ?? timingPointCandidates.find((entry) => normalizedName && (
        entry.displayName.toLowerCase() === normalizedName
        || String(entry.providerName ?? '').toLowerCase() === normalizedName
      ))
      ?? (timingPointCandidates.length === 1 ? timingPointCandidates[0] : null)
      ?? null;
    if (!split) return [];
    const overallElapsedSeconds = processedTimingNumber(
      row.overallElapsedSeconds,
      row.cumulativeSeconds,
      row.elapsedSeconds,
      row.gunSeconds,
      row.time,
    );
    if (overallElapsedSeconds === null) return [];
    return [{ row, split, timestamp, overallElapsedSeconds }];
  }).sort((left, right) => left.split.order - right.split.order);
  if (matched.length === 0) return snapshot;

  let next = snapshot;
  for (const { row, split, timestamp, overallElapsedSeconds } of matched) {
    const receivedAt = processedTimingText(source.updatedAt ?? source.resultUpdatedAt) || updatedAt;
    const timestampMillis = Date.parse(timestamp);
    const receivedAtMillis = Date.parse(receivedAt);
    const reorderBufferMs = normalizeStartConfiguration(
      contest.startConfiguration,
    ).timingReorderBufferMs;
    // Feibot can retain calculated rows from a previous run of the same
    // provider event. A future timestamp is not current official evidence and
    // must not increment timingVersion merely because Feibot labels it Valid.
    if (
      !Number.isFinite(timestampMillis)
      || !Number.isFinite(receivedAtMillis)
      || timestampMillis > receivedAtMillis + Math.max(0, reorderBufferMs)
    ) continue;
    const sectionSeconds = processedTimingNumber(
      row.sectionSeconds,
      row.sectionElapsedSeconds,
      row.segmentElapsedSeconds,
      row.splitSeconds,
    );
    const candidate: CanonicalTimingRead = {
      schemaVersion: CANONICAL_SCHEMA_VERSION,
      eventId: snapshot.eventId,
      buildVersion: snapshot.buildVersion,
      updatedAt: receivedAt,
      readId: processedTimingText(row.readId)
        || `feibot-processed:${snapshot.identity.participantUuid}:${split.key}:${timestamp}:${overallElapsedSeconds}`,
      participantUuid: snapshot.identity.participantUuid,
      providerParticipantUuid: snapshot.identity.providerParticipantUuid,
      providerEventUuid: contest.providerEventUuid || snapshot.providerEventUuid || null,
      contestUuid: contest.providerContestUuid,
      providerSplitId: split.providerSplitId,
      providerTimingPointId: split.providerTimingPointId || processedTimingText(row.timingPointUuid ?? row.timing_point_uuid),
      splitKey: split.key,
      splitName: split.displayName,
      elapsedSeconds: overallElapsedSeconds,
      overallElapsedSeconds,
      gunElapsedSeconds: processedTimingNumber(row.gunElapsedSeconds, row.gunSeconds),
      chipElapsedSeconds: processedTimingNumber(row.chipElapsedSeconds, row.chipSeconds),
      waveElapsedSeconds: processedTimingNumber(row.waveElapsedSeconds, row.waveSeconds),
      officialElapsedSeconds: processedTimingNumber(row.officialElapsedSeconds) ?? overallElapsedSeconds,
      legElapsedSeconds: processedTimingNumber(row.legElapsedSeconds, row.legSeconds, row.legTime),
      segmentElapsedSeconds: sectionSeconds,
      sectionSeconds,
      timeOfDay: processedTimingText(row.timeOfDay) || null,
      timestamp,
      occurredAt: timestamp,
      receivedAt,
      passNumber: processedTimingNumber(row.passNumber, row.pass_number, split.passNumber),
      status: 'official',
      source: 'final',
      bib: snapshot.identity.bib,
      chipCode: snapshot.identity.chipCode,
    };
    const existing = next.reads[split.key] ?? null;
    if (
      existing
      && (existing.timestamp ?? existing.occurredAt) === timestamp
      && (existing.overallElapsedSeconds ?? existing.elapsedSeconds) === overallElapsedSeconds
      && (existing.source === 'final' || existing.status === 'official')
    ) continue;
    const candidateSnapshot = applyCanonicalTimingRead(next, contest, candidate);
    const acceptedCandidate = candidateSnapshot.reads[split.key] ?? null;
    // Course-order validation may reject a non-future row because a required
    // boundary is missing or timestamps move backwards. Keep the last valid
    // prefix unchanged and do not consume a timing version for rejected data.
    if (
      !acceptedCandidate
      || (acceptedCandidate.timestamp ?? acceptedCandidate.occurredAt) !== timestamp
      || !RANKABLE_READ_STATUSES.has(acceptedCandidate.status)
    ) continue;
    next = candidateSnapshot;
  }
  return next;
}
