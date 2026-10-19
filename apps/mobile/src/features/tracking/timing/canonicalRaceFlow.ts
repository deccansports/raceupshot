import type { AthleteModalResponse } from '@/core/types';
import { contestDistanceDivisor } from '@/features/tracking/distanceScale';
import { formatEventLocalTime, normalizeTimestampUtc } from '@raceupshot/live-tracking-contracts/time';
import type { AthleteRaceSection, AthleteRaceTiming, RaceSectionRow, RaceTimingStatus } from './raceSections';

type Row = Record<string, unknown>;
const developmentWarnings = new Set<string>();
const text = (value: unknown) => String(value ?? '').trim();
const upper = (value: unknown) => text(value).toUpperCase();
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.filter((item): item is Row => Boolean(item) && typeof item === 'object' && !Array.isArray(item)) : [];
const numeric = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : text(value) && Number.isFinite(Number(value)) ? Number(value) : null;
const durationSeconds = (value: unknown): number | null => {
  const direct = numeric(value);
  if (direct != null) return direct;
  const parts = text(value).split(':').map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !Number.isFinite(part))) return null;
  const [hours, minutes, seconds] = parts.length === 3 ? parts : [0, parts[0], parts[1]];
  return hours * 3600 + minutes * 60 + seconds;
};
const rowOrder = (value: Row, fallback = 0) =>
  numeric(value.order) ??
  numeric(value.display_order) ??
  numeric(value.split_index) ??
  fallback;

function warnOnce(key: string, message: string, details: Record<string, unknown>) {
  if (process.env.NODE_ENV === 'production' || developmentWarnings.has(key)) return;
  developmentWarnings.add(key);
  console.warn(message, details);
}

function scopedValue(mapValue: unknown, contestUuid: string): Row {
  return record(
    Object.entries(record(mapValue)).find(
      ([key]) => key.trim().toLowerCase() === contestUuid.toLowerCase(),
    )?.[1],
  );
}

/**
 * Race-flow inputs are ordered by authority, not by row count. A provider or
 * map payload may legitimately contain more rows than the saved public Race
 * Flow (for example KM markers). Those extra rows must never become official
 * athlete-facing timing splits merely because that array is longer.
 */
function firstConfiguredRows(...values: unknown[]): Row[] {
  for (const value of values) {
    const candidate = rows(value);
    if (candidate.length > 0) return candidate;
  }
  return [];
}

function authoritativeSavedFlow(
  timingConfiguration: unknown,
  contestUuid: string,
): Row {
  const config = record(timingConfiguration);
  return [
    scopedValue(config.raceFlowTimelineByContest, contestUuid),
    scopedValue(config.raceFlowByContest, contestUuid),
    scopedValue(config.legSplitMappingsByContest, contestUuid),
    scopedValue(config.legSplitMappingByContest, contestUuid),
    record(config.raceFlow),
  ].reduce<Row>((best, candidate) =>
    rows(candidate.splits).length > rows(best.splits).length ? candidate : best,
  {});
}

function canonicalSplitKey(value: Row): string {
  return text(value.key ?? value.splitKey ?? value.split_key);
}

function normalizedSplitKey(value: unknown): string {
  return text(value).trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function stableSplitIdentities(value: Row): string[] {
  const metadata = record(value.metadata);
  const mappingMetadata = record(record(value.legSplitMapping).metadata);
  return [
    // Race Upshot's canonical live API exposes the provider split UUID as
    // `splitId`. Keep it alongside Feibot's legacy aliases so a configured
    // Race Flow can join the accepted timing rows it published.
    value.splitId,
    value.split_id,
    value.providerSplitId,
    value.splitUuid,
    value.split_uuid,
    value.uuid,
    value.id,
    metadata.split_uuid,
    metadata.splitUuid,
    mappingMetadata.split_uuid,
    mappingMetadata.splitUuid,
  ]
    .map(text)
    .filter(Boolean);
}

function legIdentities(value: Row): string[] {
  return [
    value.id,
    value.key,
    value.uuid,
    value.legId,
    value.leg_id,
    value.legUuid,
    value.leg_uuid,
  ]
    .map((candidate) => upper(candidate))
    .filter(Boolean);
}

function splitBelongsToLeg(split: Row, leg: Row, legType: string): boolean {
  const splitLegIds = [
    split.legId,
    split.leg_id,
    split.legUuid,
    split.leg_uuid,
  ]
    .map((candidate) => upper(candidate))
    .filter(Boolean);
  const configuredLegIds = new Set(legIdentities(leg));
  if (splitLegIds.some((identity) => configuredLegIds.has(identity))) return true;

  return upper(
    split.legType ??
      split.leg_type ??
      split.assignedLeg ??
      split.assigned_leg ??
      split.sport ??
      split.segment,
  ) === legType;
}

function physicalTimingPointIdentities(value: Row): string[] {
  return [value.timing_point_id, value.timingPointId, value.providerTimingPointId]
    .map(text)
    .filter(Boolean);
}

function timingPassNumber(value: Row): number | null {
  return numeric(value.passNumber ?? value.pass_number ?? value.passage ?? value.pass ?? value.lap);
}

function splitIdentity(value: Row): string {
  const canonical = canonicalSplitKey(value);
  if (canonical) return canonical;
  const providerIdentity = stableSplitIdentities(value)[0];
  if (providerIdentity) return providerIdentity;
  return [
    text(
      value.custom_display_name ??
        value.displayName ??
        value.split_name ??
        value.name ??
        value.label,
    ).toLowerCase(),
    splitDistance(value) ?? '',
    rowOrder(value),
  ].join(':');
}

function visibleSplitName(value: Row, fallbackKey: string): string {
  const canonical = canonicalSplitKey(value).toLowerCase();
  const names: Record<string, string> = {
    swim_start: 'Start', swim_finish: 'Swim Finish',
    bike_start: 'Bike Start', bike_finish: 'Bike Finish',
    run_start: 'Run Start', run_finish: 'Run Finish',
    run_1_start: 'Run 1 Start', run_1_finish: 'Run 1 Finish',
    run_2_start: 'Run 2 Start', run_2_finish: 'Run 2 Finish',
  };
  const candidate = text(
    value.custom_display_name ?? value.displayName ?? value.split_name ?? value.name ?? value.label,
  );
  const internalIds = stableSplitIdentities(value);
  if (candidate && !internalIds.includes(candidate)) return candidate;
  return names[canonical] || names[fallbackKey.toLowerCase()] || 'Checkpoint';
}

type TriathlonFlowRepair = {
  splits: Row[];
  legs: Row[];
  transitions: Row[];
  sections: Row[];
};

function repairNamedTriathlonFlow(legs: Row[], splits: Row[]): TriathlonFlowRepair | null {
  if (!legs.length || !splits.length) return null;
  const generic = legs.every((leg) => {
    const type = upper(leg.legType ?? leg.type ?? leg.leg_name ?? leg.name ?? leg.key);
    return type === 'RUN' || type === 'OTHER' || type === 'START FINISH';
  });
  if (!generic) return null;
  const ordered = [...splits].sort((a, b) => rowOrder(a) - rowOrder(b));
  const sport = (split: Row) => {
    const name = upper(split.importedName ?? split.splitName ?? split.split_name ?? split.displayName ?? split.name);
    if (/\bSWIM\b/.test(name)) return 'SWIM';
    if (/\bBIKE\b|\bCYCLE\b/.test(name)) return 'BIKE';
    if (/\bRUN\b/.test(name)) return 'RUN';
    return '';
  };
  const kinds = ordered.map(sport);
  const swim = kinds.indexOf('SWIM');
  const bike = kinds.indexOf('BIKE');
  const run = kinds.indexOf('RUN');
  if (swim < 0 || bike <= swim || run <= bike) return null;
  if (kinds.some((kind, index) => kind === 'SWIM' && index >= bike || kind === 'BIKE' && index >= run || kind === 'RUN' && index < run)) return null;
  const ids = ['triathlon-swim', 'triathlon-bike', 'triathlon-run'];
  const repairedSplits = ordered.map((split, index) => ({
    ...split,
    legId: index < bike ? ids[0] : index < run ? ids[1] : ids[2],
    legType: index < bike ? 'SWIM' : index < run ? 'BIKE' : 'RUN',
  }));
  const keyAt = (index: number) => splitIdentity(repairedSplits[index]);
  return {
    splits: repairedSplits,
    legs: [
      { id: ids[0], key: 'SWIM', legType: 'SWIM', displayName: 'Swim', order: 0 },
      { id: ids[1], key: 'BIKE', legType: 'BIKE', displayName: 'Bike', order: 2 },
      { id: ids[2], key: 'RUN', legType: 'RUN', displayName: 'Run', order: 4 },
    ],
    transitions: [
      { key: 'T1', type: 'T1', displayName: 'T1', order: 1, startSplitKey: keyAt(bike - 1), finishSplitKey: keyAt(bike) },
      { key: 'T2', type: 'T2', displayName: 'T2', order: 3, startSplitKey: keyAt(run - 1), finishSplitKey: keyAt(run) },
    ],
    sections: ['SWIM', 'T1', 'BIKE', 'T2', 'RUN'].map((type, order) => ({ key: type, type, order })),
  };
}

const TRIATHLON_BOUNDARIES = [
  { key: 'swim_start', label: 'Start', legType: 'SWIM', order: 1, distanceKey: 'start' },
  { key: 'swim_finish', label: 'Swim Finish', legType: 'SWIM', order: 2, distanceKey: 'swim' },
  { key: 'bike_start', label: 'Bike Start', legType: 'BIKE', order: 3, distanceKey: 'swim' },
  { key: 'bike_finish', label: 'Bike Finish', legType: 'BIKE', order: 4, distanceKey: 'bike' },
  { key: 'run_start', label: 'Run Start', legType: 'RUN', order: 5, distanceKey: 'bike' },
  { key: 'run_finish', label: 'Run Finish', legType: 'RUN', order: 6, distanceKey: 'run' },
] as const;

function configuredTriathlonRepair(res: AthleteModalResponse, candidates: Row[]): TriathlonFlowRepair | null {
  const ticket = record(res.ticketDefinition);
  const maps = record(ticket.courseMaps);
  const context = record(res.contestContext);
  const contest = record(context.contest ?? res.contestDefinition);
  const raceType = upper(
    ticket.ticketCategory ?? ticket.category ?? ticket.raceType ??
    contest.raceType ?? contest.ticketCategory ?? contest.category,
  );
  const swimKm = numeric(maps.swimDistance ?? maps.swim_distance ?? ticket.swimDistance);
  const bikeKm = numeric(maps.bikeDistance ?? maps.bike_distance ?? ticket.bikeDistance);
  const runKm = numeric(maps.runDistance ?? maps.run_distance ?? ticket.runDistance);
  if (!raceType.includes('TRIATHLON') || !(swimKm && swimKm > 0) || !(bikeKm && bikeKm > 0) || !(runKm && runKm > 0)) {
    return null;
  }

  const providerRows = candidates.filter((row, index, all) => {
    const identity = stableSplitIdentities(row)[0] || splitIdentity(row);
    return Boolean(identity) && all.findIndex((candidate) =>
      (stableSplitIdentities(candidate)[0] || splitIdentity(candidate)) === identity,
    ) === index;
  });
  if (providerRows.length < TRIATHLON_BOUNDARIES.length) return null;

  const used = new Set<Row>();
  const matches = TRIATHLON_BOUNDARIES.map((boundary) => {
    const exact = providerRows.find((row) => {
      if (used.has(row)) return false;
      if (canonicalSplitKey(row).toLowerCase() === boundary.key) return true;
      const label = upper(row.custom_display_name ?? row.displayName ?? row.splitName ?? row.split_name ?? row.name ?? row.label);
      if (boundary.key === 'swim_start') return label === 'START' || label === 'SWIM START';
      return label === upper(boundary.label);
    });
    if (exact) used.add(exact);
    return exact;
  });

  // A six-boundary Feibot contest is deterministic even when its visible
  // labels are provider UUIDs. Use configured provider order only for the
  // boundaries that could not be named; never use provider distance/sport.
  const remaining = providerRows
    .filter((row) => !used.has(row))
    .sort((left, right) => rowOrder(left) - rowOrder(right));
  matches.forEach((match, index) => {
    if (match) return;
    const replacement = remaining.shift();
    if (replacement) {
      matches[index] = replacement;
      used.add(replacement);
    }
  });
  if (matches.some((match) => !match)) return null;

  const cumulative = {
    start: 0,
    swim: swimKm,
    bike: swimKm + bikeKm,
    run: swimKm + bikeKm + runKm,
  };
  const legStart = { SWIM: 0, BIKE: swimKm, RUN: swimKm + bikeKm };
  const splits = TRIATHLON_BOUNDARIES.map((boundary, index) => {
    const source = matches[index] as Row;
    const cumulativeDistanceKm = cumulative[boundary.distanceKey];
    return {
      ...source,
      key: boundary.key,
      splitKey: boundary.key,
      displayName: boundary.label,
      name: boundary.label,
      splitName: boundary.label,
      legType: boundary.legType,
      assignedLeg: boundary.legType,
      segment: boundary.legType,
      order: boundary.order,
      cumulativeDistanceKm,
      cumulativeRaceDistanceKm: cumulativeDistanceKm,
      distanceInLegKm: cumulativeDistanceKm - legStart[boundary.legType],
      legDistanceKm: cumulativeDistanceKm - legStart[boundary.legType],
      isStart: boundary.key.endsWith('_start'),
      isFinish: boundary.key.endsWith('_finish'),
    };
  });
  const legs: Row[] = [
    { key: 'swim', legType: 'SWIM', displayName: 'Swim', order: 1, distanceKm: swimKm, startSplitKey: 'swim_start', finishSplitKey: 'swim_finish' },
    { key: 'bike', legType: 'BIKE', displayName: 'Bike', order: 3, distanceKm: bikeKm, startSplitKey: 'bike_start', finishSplitKey: 'bike_finish' },
    { key: 'run', legType: 'RUN', displayName: 'Run', order: 5, distanceKm: runKm, startSplitKey: 'run_start', finishSplitKey: 'run_finish' },
  ];
  const transitions: Row[] = [
    { key: 'T1', type: 'T1', displayName: 'T1', order: 2, startSplitKey: 'swim_finish', finishSplitKey: 'bike_start' },
    { key: 'T2', type: 'T2', displayName: 'T2', order: 4, startSplitKey: 'bike_finish', finishSplitKey: 'run_start' },
  ];
  const sections: Row[] = [
    { key: 'SWIM', type: 'SWIM', order: 1 },
    { key: 'T1', type: 'T1', order: 2 },
    { key: 'BIKE', type: 'BIKE', order: 3 },
    { key: 'T2', type: 'T2', order: 4 },
    { key: 'RUN', type: 'RUN', order: 5 },
  ];
  return { splits, legs, transitions, sections };
}

function splitDistance(value: Row | null | undefined): number | null {
  const split = record(value);
  return numeric(
    split.cumulativeDistanceKm ??
      split.km_marking ??
      split.distanceKm ??
      split.distance,
  );
}

function splitDistanceIsExplicitKm(value: Row | null | undefined): boolean {
  const split = record(value);
  return [
    split.cumulativeDistanceKm,
    split.km_marking,
    split.distanceKm,
  ].some((candidate) => numeric(candidate) != null);
}

function metricFor(legType: string, timing: Row, legElapsed: number | null, legDistanceKm: number | null): string | null {
  const formatPace = (seconds: number, suffix: string) => {
    const rounded = Math.max(0, Math.round(seconds));
    return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')} ${suffix}`;
  };
  // A sport boundary has zero completed leg distance and zero leg elapsed.
  // Provider pace fields on that boundary can belong to the preceding
  // transition and must never be presented as sport pace/speed.
  if (legElapsed == null || legElapsed <= 0 || legDistanceKm == null || legDistanceKm <= 0) return null;
  if (legType === 'SWIM') {
    const pace = numeric(timing.paceSecondsPer100m) ?? (legElapsed != null && legElapsed > 0 && legDistanceKm != null && legDistanceKm > 0 ? legElapsed / (legDistanceKm * 10) : null);
    return pace == null ? null : formatPace(pace, '/100m');
  }
  if (legType === 'BIKE') {
    const speed = numeric(timing.speedKmh) ?? (legElapsed != null && legElapsed > 0 && legDistanceKm != null && legDistanceKm > 0 ? legDistanceKm / (legElapsed / 3600) : null);
    return speed == null ? null : `${speed.toFixed(1)} km/h`;
  }
  const pace = numeric(timing.paceSecondsPerKm) ?? (legElapsed != null && legElapsed > 0 && legDistanceKm != null && legDistanceKm > 0 ? legElapsed / legDistanceKm : null);
  return pace == null ? null : formatPace(pace, '/km');
}

// The public Race Upshot API preserves Feibot's calculated-result fields.
// These carry the same official values as the worker-only elapsed fields, but
// are deliberately timestamp-free when Feibot did not supply a mat clock.
function acceptedElapsedSeconds(timing?: Row): number | null {
  if (!timing) return null;
  return durationSeconds(
    timing.overallElapsedSeconds ?? timing.elapsedSeconds ?? timing.cumulativeTime ?? timing.time,
  ) ?? (() => {
    const milliseconds = numeric(timing.officialTimeMs ?? timing.chipTimeMs ?? timing.gunTimeMs);
    return milliseconds == null ? null : milliseconds / 1_000;
  })();
}

function officialSectionSeconds(timing?: Row): number | null {
  if (!timing) return null;
  return durationSeconds(
    timing.sectionElapsedSeconds ?? timing.sectionSeconds ?? timing.segmentElapsedSeconds ?? timing.splitTime,
  ) ?? (() => {
    const milliseconds = numeric(timing.sectionTimeMs);
    return milliseconds == null ? null : milliseconds / 1_000;
  })();
}

function timingStatus(timing?: Row): RaceSectionRow['status'] {
  if (!timing) return 'missing';
  const status = upper(timing.progressStatus ?? timing.status ?? timing.timingStatus);
  if (status.includes('INVALID')) return 'invalid';
  if (status.includes('ESTIMAT')) return 'estimated';
  const accepted = timing.accepted === true
    || timing.isAccepted === true
    || timing.source === 'FEIBOT_PROCESSED'
    || ['ACCEPTED', 'COMPLETED', 'CONFIRMED', 'VALID', 'OFFICIAL', 'PROVISIONAL', 'CORRECTED', 'MANUAL_CORRECTED'].includes(status);
  const hasTimestamp = Boolean(
    text(timing.readAt ?? timing.acceptedAt ?? timing.acceptedTimestamp ?? timing.absoluteTimestamp ?? timing.timestamp ?? timing.timeOfDay),
  );
  // A calculated Feibot result may not include a wall-clock timestamp, but
  // its official elapsed duration is still valid and must populate the flow.
  return accepted && (hasTimestamp || timing.source === 'FEIBOT_PROCESSED' || status === 'PROVISIONAL') && acceptedElapsedSeconds(timing) != null
    ? 'valid'
    : 'missing';
}

function sectionStatus(timings: (Row | undefined)[], athleteStatus: string): RaceTimingStatus {
  const status = upper(athleteStatus);
  if (status.includes('DNF')) return 'dnf';
  if (status.includes('DNS')) return 'dns';
  if (status.includes('DNQ')) return 'dnq';
  if (status.includes('DISQUAL')) return 'disqualified';
  const completed = timings.filter((timing) => timingStatus(timing) === 'valid').length;
  if (timings.length > 0 && completed === timings.length) return 'completed';
  return completed > 0 ? 'in_progress' : 'not_started';
}

function summarySeconds(summary: Row, type: string): number | null {
  return numeric(summary[`${type.toLowerCase()}Seconds`]);
}

function rank(value: unknown): string | null {
  const ranking = record(value);
  const nested = record(ranking.ranking);
  const result =
    ranking.rankAtSplit ??
    ranking.splitRank ??
    ranking.position ??
    ranking.overallRank ??
    ranking.rank ??
    ranking.overall ??
    nested.rankAtSplit ??
    nested.splitRank ??
    nested.position ??
    nested.overallRank ??
    nested.rank ??
    nested.overall;
  return result == null || !text(result) ? null : `#${text(result).replace(/^#/, '')}`;
}

function transitionSection(
  transition: Row,
  timingByKey: Map<string, Row>,
  canonicalSection?: Row,
): AthleteRaceSection {
  const transitionKey = upper(
    transition.key ??
      transition.type ??
      transition.shortLabel ??
      transition.id ??
      transition.displayName,
  );
  const startKey = normalizedSplitKey(
    transition.startSplitKey ??
      transition.start_split_key ??
      transition.fromSplitKey ??
      transition.from_split_key,
  );
  const finishKey = normalizedSplitKey(
    transition.finishSplitKey ??
      transition.finish_split_key ??
      transition.toSplitKey ??
      transition.to_split_key,
  );
  const startTiming = timingByKey.get(startKey);
  const finishTiming = timingByKey.get(finishKey);
  const startElapsed = acceptedElapsedSeconds(startTiming);
  const finishElapsed = acceptedElapsedSeconds(finishTiming);
  const calculatedDuration = startElapsed != null && finishElapsed != null ? finishElapsed - startElapsed : null;
  const canonicalDuration = durationSeconds(canonicalSection?.durationSeconds);
  // Canonical snapshot sections are authoritative. Boundary subtraction is a
  // compatibility path for older payloads that do not publish section results.
  // Never show a running/estimated transition from only one boundary.
  // A snapshot can contain a pending/null transition while the newer Feibot
  // reads already include both boundary mats. Those accepted reads complete it.
  const duration = canonicalDuration ?? calculatedDuration;
  const negative = duration != null && duration < 0;
  if (!startKey || !finishKey) warnOnce(`transition-boundaries:${transitionKey}:${startKey}:${finishKey}`, '[CanonicalRaceFlow] Missing transition boundaries', { transitionKey, startKey, finishKey });
  if (negative) warnOnce(`negative-transition:${transitionKey}:${startKey}:${finishKey}`, '[CanonicalRaceFlow] Negative transition duration', { transitionKey, startKey, finishKey });
  const canonicalStatus = upper(canonicalSection?.status);
  const status: RaceTimingStatus = negative
    ? 'invalid'
    : canonicalStatus === 'COMPLETED' && duration != null
      ? 'completed'
      : canonicalStatus === 'IN_PROGRESS' || (startElapsed != null && finishElapsed == null)
        ? 'in_progress'
        : startElapsed != null && finishElapsed != null && duration != null
          ? 'completed'
          : 'not_started';
  const startedAt = normalizeTimestampUtc(
    startTiming?.readAt
      ?? startTiming?.acceptedAt
      ?? startTiming?.acceptedTimestamp
      ?? startTiming?.absoluteTimestamp
      ?? startTiming?.timestamp,
  ) || undefined;
  return { type: 'transition', id: transitionKey, title: text(transition.displayName ?? transition.title) || transitionKey, shortLabel: transitionKey, status, durationSeconds: negative ? null : duration, startedAt, averageMetric: null, fromSplitKey: startKey || undefined, toSplitKey: finishKey || undefined, rows: [] };
}

export function buildCanonicalRaceFlow(res: AthleteModalResponse): AthleteRaceTiming | undefined {
  const athlete = record(res.athlete);
  const context = record(res.contestContext);
  const contest = record(context.contest ?? res.contestDefinition);
  const participantLive = record(res.participantLive);
  const resolvedState = record(participantLive.resolvedRaceState);
  const officialElapsedSeconds = (() => {
    const milliseconds = numeric(resolvedState.officialElapsedMs ?? resolvedState.officialRaceElapsedMs);
    if (milliseconds != null) return milliseconds / 1000;
    return durationSeconds(
      resolvedState.officialElapsedSeconds
        ?? resolvedState.officialRaceElapsedSeconds
        ?? athlete.officialRaceTime,
    );
  })();
  const eventTimezone = text(
    resolvedState.eventTimezone ?? participantLive.eventTimezone ?? context.timezone ?? contest.timezone ?? 'Asia/Kolkata',
  );
  const athleteContest = text(athlete.providerContestUuid);
  const contestUuid = text(contest.providerContestUuid ?? contest.contestUuid ?? contest.id);
  if (!contestUuid) return undefined;
  if (athleteContest && athleteContest !== contestUuid) {
    warnOnce(`contest-mismatch:${res.eventId}:${athleteContest}:${contestUuid}`, '[CanonicalRaceFlow] Contest mismatch', { athleteContest, contestUuid });
    return undefined;
  }
  const savedFlow = authoritativeSavedFlow(res.timingConfiguration, contestUuid);
  const configuredLegs = firstConfiguredRows(savedFlow.legs, contest.legs, context.legs)
    .sort((a, b) => rowOrder(a) - rowOrder(b));
  const configuredTransitions = firstConfiguredRows(
    savedFlow.transitions,
    contest.transitions,
    context.transitions,
  ).sort((a, b) => rowOrder(a) - rowOrder(b));
  const configuredSplits = firstConfiguredRows(
    savedFlow.splits,
    contest.splits,
    context.splits,
  ).sort((a, b) => rowOrder(a) - rowOrder(b));
  const hasSavedCanonicalFlow = rows(savedFlow.splits).length > 0 && rows(savedFlow.legs).length > 0;
  const hasCanonicalContestFlow = rows(contest.splits).length > 0
    && rows(contest.legs).length > 0
    && rows(contest.sections).length > 0;
  const configuredSplitLabels = configuredSplits.map((split) => upper(
    split.custom_display_name ?? split.displayName ?? split.splitName ?? split.name ?? split.label,
  ));
  const malformedCollapsedTriathlon = configuredLegs.length < 2
    && ['SWIM', 'BIKE', 'RUN'].every((sport) => configuredSplitLabels.some((label) => label.includes(sport)));
  // Repair is a compatibility path for malformed legacy/provider-only data.
  // It must never replace a configured canonical Race Flow or drop legitimate
  // configured intermediate timing splits.
  const namedRepair = repairNamedTriathlonFlow(configuredLegs, configuredSplits);
  const repair = namedRepair ?? ((hasSavedCanonicalFlow || hasCanonicalContestFlow) && !malformedCollapsedTriathlon
    ? null
    : configuredTriathlonRepair(res, configuredSplits));
  const legs = repair?.legs ?? configuredLegs;
  const transitions = repair?.transitions ?? configuredTransitions;
  const rawContestSplits = (repair?.splits ?? configuredSplits)
    .filter((split) => split.visible !== false && split.publicVisible !== false && split.hidden !== true && split.hideSplit !== true);
  const distanceDivisor = contestDistanceDivisor(
    rawContestSplits.map(splitDistance),
  );
  const normalizeSplitDistance = (split: Row): Row => {
    const distance = splitDistance(split);
    return distanceDivisor === 1 ||
      distance == null ||
      splitDistanceIsExplicitKm(split)
      ? split
      : { ...split, cumulativeDistanceKm: distance / distanceDivisor };
  };
  const contestSplits = distanceDivisor === 1
    ? rawContestSplits
    : rawContestSplits.map(normalizeSplitDistance);
  if (!legs.length || !contestSplits.length) return undefined;
  const canonicalSections = repair?.sections ?? firstConfiguredRows(
    savedFlow.sections,
    contest.sections,
    context.sections,
  ).sort((a, b) => rowOrder(a) - rowOrder(b));
  const canonicalSectionByKey = new Map(
    canonicalSections.map((section) => [
      upper(section.key ?? section.type ?? section.legType ?? section.shortLabel),
      section,
    ]),
  );
  const timingCandidates = [
    ...rows(resolvedState.splits),
    ...rows(participantLive.splits),
    ...rows(participantLive.completedSplits),
    ...rows(athlete.splits),
  ];
  const timingByIdentity = new Map<string, Row>();
  timingCandidates.forEach((timing, index) => {
    const identity = canonicalSplitKey(timing)
      || stableSplitIdentities(timing)[0]
      || `${upper(timing.displayName ?? timing.name ?? timing.label)}:${rowOrder(timing, index)}`;
    if (!identity) return;
    const existing = timingByIdentity.get(identity);
    if (!existing) {
      timingByIdentity.set(identity, timing);
      return;
    }
    const existingAccepted = timingStatus(existing) === 'valid';
    const incomingAccepted = timingStatus(timing) === 'valid';
    const existingUpdated = Date.parse(text(existing.updatedAt ?? existing.readAt ?? existing.acceptedAt ?? existing.timestamp));
    const incomingUpdated = Date.parse(text(timing.updatedAt ?? timing.readAt ?? timing.acceptedAt ?? timing.timestamp));
    const incomingWins =
      (incomingAccepted && !existingAccepted)
      || (incomingAccepted === existingAccepted && Number.isFinite(incomingUpdated) && (!Number.isFinite(existingUpdated) || incomingUpdated >= existingUpdated));
    // Canonical detail can expose the same split through resolvedRaceState,
    // participantLive and athlete.splits. Keep the authoritative timing copy,
    // but merge complementary fields such as rankAtSplit from every copy.
    timingByIdentity.set(
      identity,
      incomingWins ? { ...existing, ...timing } : { ...timing, ...existing },
    );
  });
  const athleteTimings = [...timingByIdentity.values()];
  const effectiveStartValue = normalizeTimestampUtc(
    resolvedState.startReaderAt ??
      resolvedState.acceptedStartAt ??
      resolvedState.acceptedChipStartAt ??
      resolvedState.athleteStartTimeUtc ??
      resolvedState.athleteStartTime ??
      resolvedState.chipStartAt ??
      athlete.firstTimingReadAt ??
      athlete.startTime ??
      athlete.startedAt ??
      athlete.chipStartTime ??
      participantLive.startTime ??
      participantLive.chipStartTime,
  ) || '';
  const effectiveStartMillis = Date.parse(effectiveStartValue);
  const timingByCanonicalKey = new Map<string, Row>();
  const timingByProviderId = new Map<string, Row>();
  athleteTimings.forEach((timing) => {
    const identity = canonicalSplitKey(timing);
    if (identity && !timingByCanonicalKey.has(identity)) timingByCanonicalKey.set(identity, timing);
    stableSplitIdentities(timing).forEach((providerId) => {
      if (!timingByProviderId.has(providerId)) timingByProviderId.set(providerId, timing);
    });
  });
  const physicalUseCounts = new Map<string, number>();
  contestSplits.forEach((definition) => {
    physicalTimingPointIdentities(definition).forEach((identity) => {
      physicalUseCounts.set(identity, (physicalUseCounts.get(identity) ?? 0) + 1);
    });
  });
  const timingForDefinition = (definition: Row): Row | undefined => {
    for (const providerId of stableSplitIdentities(definition)) {
      const exactProviderTiming = timingByProviderId.get(providerId);
      if (exactProviderTiming) return exactProviderTiming;
    }
    const canonical = canonicalSplitKey(definition);
    if (canonical) {
      const exact = timingByCanonicalKey.get(canonical);
      if (exact) return exact;
    }
    const fallbackIds = physicalTimingPointIdentities(definition);
    const fallback = fallbackIds.length === 0 ? undefined : athleteTimings.find((timing) => {
      if (canonicalSplitKey(timing)) return false;
      const timingIds = physicalTimingPointIdentities(timing);
      const sharedIdentity = fallbackIds.find((identity) => timingIds.includes(identity));
      if (!sharedIdentity) return false;
      if ((physicalUseCounts.get(sharedIdentity) ?? 0) <= 1) return true;
      const configuredPass = timingPassNumber(definition);
      const observedPass = timingPassNumber(timing);
      return configuredPass != null && observedPass != null && configuredPass === observedPass;
    });
    if (fallback) return fallback;
    const name = upper(definition.displayName ?? definition.split_name ?? definition.name ?? definition.label);
    const isStart = definition.isStart === true
      || upper(definition.timingPointType) === 'START'
      || (splitDistance(definition) === 0 && name.includes('START'));
    if (isStart && Number.isFinite(effectiveStartMillis)) {
      const timestamp = new Date(effectiveStartMillis).toISOString();
      return {
        splitKey: splitIdentity(definition),
        elapsedSeconds: 0,
        sectionSeconds: 0,
        readAt: timestamp,
        timeOfDay: formatEventLocalTime(timestamp, eventTimezone),
        status: 'valid',
        startSource: athlete.startSource ?? participantLive.startSource ?? 'official_start',
      };
    }
    return undefined;
  };
  const configuredKeys = new Set<string>();
  const duplicateKeys = new Set<string>();
  contestSplits.forEach((split) => {
    const splitKey = splitIdentity(split);
    if (!splitKey) return;
    if (configuredKeys.has(splitKey)) duplicateKeys.add(splitKey);
    configuredKeys.add(splitKey);
  });
  const timingByKey = new Map<string, Row>();
  contestSplits.forEach((split) => {
    const splitKey = normalizedSplitKey(splitIdentity(split));
    const timing = timingForDefinition(split);
    if (splitKey && timing) timingByKey.set(splitKey, timing);
  });
  if (duplicateKeys.size) warnOnce(`duplicate-splits:${res.eventId}:${contestUuid}:${[...duplicateKeys].join(',')}`, '[CanonicalRaceFlow] Duplicate split keys', { keys: [...duplicateKeys] });

  const sportSections = new Map<string, AthleteRaceSection>();
  legs.forEach((leg) => {
    const legType = upper(
      leg.legType ??
        leg.leg_type ??
        leg.legName ??
        leg.leg_name ??
        leg.type ??
        leg.sport ??
        leg.key,
    );
    const directSplits = rows(leg.splits).map(normalizeSplitDistance);
    const definitions = (directSplits.length
      ? directSplits
      : contestSplits.filter((split) => splitBelongsToLeg(split, leg, legType))
    ).sort((a, b) => rowOrder(a) - rowOrder(b));
    const timings = definitions.map((split) => timingForDefinition(split));
    const acceptedElapsed = timings
      .map((timing) => acceptedElapsedSeconds(timing))
      .filter((value): value is number => value != null);
    const legStartElapsed = acceptedElapsedSeconds(timings[0]);
    const legStartDistance = splitDistance(definitions[0]) ?? 0;
    const athleteElapsed = officialElapsedSeconds ?? durationSeconds(
      athlete.officialRaceTime ?? athlete.elapsedTime ?? resolvedState.athleteElapsedSeconds,
    );
    const sectionRows: RaceSectionRow[] = definitions.map((split) => {
      const splitKey = splitIdentity(split);
      const timing = timingForDefinition(split);
      const overallElapsed = acceptedElapsedSeconds(timing);
      const legElapsed = durationSeconds(timing?.legElapsedSeconds) ?? (overallElapsed != null && legStartElapsed != null ? Math.max(0, overallElapsed - legStartElapsed) : null);
      const cumulativeDistance = splitDistance(split);
      const distance = numeric(timing?.legDistanceKm ?? timing?.distanceInLegKm ?? split.distanceInLegKm ?? split.legDistanceKm)
        ?? (cumulativeDistance == null ? null : Math.max(0, cumulativeDistance - legStartDistance));
      const acceptedAt = normalizeTimestampUtc(
        timing?.readAt
          ?? timing?.acceptedAt
          ?? timing?.acceptedTimestamp
          ?? timing?.absoluteTimestamp
          ?? timing?.timestamp,
      ) || '';
      const isStart = split.isStart === true
        || upper(split.timingPointType) === 'START'
        || (splitDistance(split) === 0 && upper(split.displayName ?? split.name).includes('START'));
      return {
        key: splitKey,
        name: visibleSplitName(split, splitKey),
        splitDurationSeconds: officialSectionSeconds(timing),
        legElapsedSeconds: legElapsed,
        overallElapsedSeconds: overallElapsed,
        timeOfDay: (acceptedAt ? formatEventLocalTime(acceptedAt, eventTimezone) : null)
          || text(timing?.timeOfDay)
          // Processed elapsed results contain no wall clock. Show the START
          // time only when live timing supplied accepted START evidence—not
          // from the preconfigured/scheduled gun start.
          || (isStart && effectiveStartValue
            ? formatEventLocalTime(effectiveStartValue, eventTimezone)
            : null),
        metric: metricFor(legType, timing ?? {}, legElapsed, distance),
        rank: rank(timing),
        distanceInLegKm: distance,
        cumulativeDistanceKm: cumulativeDistance,
        isRaceFinish: split.isRaceFinish === true || split.is_final_race_split === true || split.isFinalRaceSplit === true,
        status: timingStatus(timing),
      };
    });
    const status = sectionStatus(timings, text(athlete.status));
    const lastElapsed = acceptedElapsed.at(-1) ?? null;
    const calculatedDuration = legStartElapsed == null ? null : status === 'completed' && lastElapsed != null
      ? Math.max(0, lastElapsed - legStartElapsed)
      : status === 'in_progress' && athleteElapsed != null
        ? Math.max(0, athleteElapsed - legStartElapsed)
        : null;
    const lastCumulativeDistance = sectionRows.at(-1)?.cumulativeDistanceKm ?? null;
    const configuredLegDistance = numeric(leg.distanceKm ?? leg.distance_km)
      ?? (lastCumulativeDistance == null ? null : Math.max(0, lastCumulativeDistance - legStartDistance));
    // A completed leg is the interval between its accepted start and finish
    // boundaries. Legacy summary fields frequently contain the cumulative
    // checkpoint elapsed (for example Bike Finish) and must never override
    // this boundary-to-boundary value.
    const sectionDuration = status === 'completed'
      ? calculatedDuration ?? summarySeconds(record(athlete.summary), legType)
      : calculatedDuration;
    const canonicalSection = canonicalSectionByKey.get(legType);
    const canonicalDuration = durationSeconds(canonicalSection?.durationSeconds);
    const configuredLegTitle = text(leg.displayName ?? leg.name);
    const normalizedLegTitle = upper(configuredLegTitle).replace(/[\s/_-]+/g, ' ');
    const legTitle = normalizedLegTitle === 'START FINISH'
      ? `${legType.charAt(0)}${legType.slice(1).toLowerCase()}`
      : configuredLegTitle || `${legType.charAt(0)}${legType.slice(1).toLowerCase()} Leg`;
    sportSections.set(legType, {
      type: 'leg',
      id: text(leg.key ?? leg.id ?? leg.leg_name) || legType,
      title: legTitle,
      shortLabel: legType === 'SWIM' ? 'SW' : legType === 'BIKE' ? 'BK' : 'RN',
      legType,
      status,
      durationSeconds: canonicalDuration ?? sectionDuration,
      averageMetric: status === 'completed'
        ? metricFor(legType, {}, canonicalDuration ?? sectionDuration, configuredLegDistance)
        : null,
      rows: sectionRows,
    });
  });

  // Older saved triathlon flows have three sport legs but no explicit
  // transitions. The adjacent finish/start mats are their T1/T2 boundaries.
  const isTriathlon = sportSections.has('SWIM') && sportSections.has('BIKE') && sportSections.has('RUN');
  const legFor = (type: string) => legs.find((leg) => upper(leg.legType ?? leg.type ?? leg.name ?? leg.key) === type);
  const effectiveTransitions: Row[] = isTriathlon
    ? ([['T1', 'SWIM', 'BIKE'], ['T2', 'BIKE', 'RUN']] as const).map(([key, from, to]) => {
      const configured = transitions.find((item) => [item.type, item.transitionType, item.key, item.shortLabel, item.displayName]
        .some((value) => upper(value) === key)) ?? {};
      const fromKey = text(configured.startSplitKey ?? configured.start_split_key ?? configured.fromSplitKey ?? configured.from_split_key)
        || text(legFor(from)?.finishSplitKey)
        || sportSections.get(from)?.rows.at(-1)?.key;
      const toKey = text(configured.finishSplitKey ?? configured.finish_split_key ?? configured.toSplitKey ?? configured.to_split_key)
        || text(legFor(to)?.startSplitKey)
        || sportSections.get(to)?.rows[0]?.key;
      return { ...configured, key, type: key, displayName: key, startSplitKey: fromKey, finishSplitKey: toKey };
    })
    : transitions;
  const transitionByKey = new Map(
    effectiveTransitions.map((transition) => {
      const section = transitionSection(
        transition,
        timingByKey,
        canonicalSectionByKey.get(upper(transition.key ?? transition.type ?? transition.shortLabel ?? transition.id)),
      );
      return [section.shortLabel, section];
    }),
  );
  const configuredSequence = canonicalSections.map((section) => upper(section.type ?? section.legType ?? section.key));
  const sequence = isTriathlon
    ? ['SWIM', 'T1', 'BIKE', 'T2', 'RUN']
    : configuredSequence.length ? configuredSequence : [...sportSections.keys()];
  const sections: AthleteRaceSection[] = [];
  sequence.forEach((sectionKey) => { const section = sportSections.get(sectionKey) ?? transitionByKey.get(sectionKey); if (section && !sections.includes(section)) sections.push(section); });
  sportSections.forEach((section) => { if (!sections.includes(section)) sections.push(section); });

  if (process.env.NODE_ENV !== 'production') {
    const unknown = athleteTimings
      .map(splitIdentity)
      .filter((splitKey) => splitKey && ![...timingByKey.values()].some((timing) => splitIdentity(timing) === splitKey));
    if (unknown.length) warnOnce(`unknown-timing:${res.eventId}:${contestUuid}:${unknown.join(',')}`, '[CanonicalRaceFlow] Athlete timing rows absent from course', { keys: unknown });
  }
  const finalSectionCompleted = sections.length > 0 && sections.at(-1)?.status === 'completed';
  return {
    overallTimeSeconds: finalSectionCompleted
      ? durationSeconds(record(athlete.summary).overallSeconds ?? athlete.officialRaceTime ?? athlete.elapsedTime)
      : officialElapsedSeconds,
    sections,
    warnings: [],
  };
}
