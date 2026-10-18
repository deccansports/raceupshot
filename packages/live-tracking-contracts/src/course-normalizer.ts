import {
  CANONICAL_SCHEMA_VERSION,
  type CanonicalContestCourse,
  type CanonicalContestMappingInput,
  type CanonicalCourseBundle,
  type CanonicalCourseNormalizerInput,
  type CanonicalLegType,
  type CanonicalRaceLeg,
  type CanonicalRaceSection,
  type CanonicalReadSelectionRule,
  type CanonicalSplit,
  type CanonicalSplitMappingInput,
  type CanonicalTransition,
  type CanonicalTimingPointType,
} from './contracts';
import { validateCanonicalCourse, expectedLegTypes } from './course-validation';
import { normalizeStartConfiguration } from './start-timing';

type UnknownRecord = Record<string, unknown>;

interface ProviderLeg {
  id: string;
  contestUuid: string;
  name: string;
  order: number;
  startSplitId: string;
  finishSplitId: string;
}

interface ProviderSplit {
  id: string;
  contestUuid: string;
  timingPointId: string;
  timingPointUuid: string;
  timingPointNumericId: string;
  legId: string;
  legName: string;
  name: string;
  canonicalCode: string;
  order: number;
  distanceInLegKm: number | null;
  cumulativeDistanceKm: number | null;
  passNumber: number | null;
  readSelectionRule: CanonicalReadSelectionRule | null;
  rankingEnabled: boolean;
  publicVisible: boolean;
  required: boolean;
  isStart: boolean;
  isFinish: boolean;
  timingPointType: CanonicalTimingPointType | null;
  startDetectionEnabled: boolean | null;
  passageGroupingEnabled: boolean | null;
  passageGapSeconds: number | null;
}

function record(value: unknown): UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function valueAt(source: UnknownRecord, names: string[]): unknown {
  for (const name of names) {
    const value = source[name];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function textAt(source: UnknownRecord, names: string[]): string {
  return String(valueAt(source, names) ?? '').trim();
}

function numberAt(source: UnknownRecord, names: string[]): number | null {
  const raw = valueAt(source, names);
  if (raw === undefined || raw === null || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function booleanAt(source: UnknownRecord, names: string[], fallback = false): boolean {
  const raw = valueAt(source, names);
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (typeof raw === 'boolean') return raw;
  return ['1', 'true', 'yes', 'y'].includes(String(raw).trim().toLocaleLowerCase('en-US'));
}

function optionalBooleanAt(source: UnknownRecord, names: string[]): boolean | null {
  const raw = valueAt(source, names);
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw === 'boolean') return raw;
  return ['1', 'true', 'yes', 'y', 'on'].includes(String(raw).trim().toLocaleLowerCase('en-US'));
}

function timingPointType(value: unknown): CanonicalTimingPointType | null {
  const token = String(value ?? '').trim().toUpperCase();
  return token === 'START' || token === 'SPLIT' || token === 'LAP' || token === 'FINISH' ? token : null;
}

function collection(source: UnknownRecord, names: string[]): unknown[] {
  for (const name of names) {
    const direct = source[name];
    if (Array.isArray(direct)) return direct;
  }
  const nested = record(source.timing_rules ?? source.timingRules ?? source.course);
  for (const name of names) {
    const value = nested[name];
    if (Array.isArray(value)) return value;
  }
  return [];
}

export function normalizeProviderName(value: string): string {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLocaleUpperCase('en-US')
    .replace(/FI+NISH/g, 'FINISH')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slug(value: string): string {
  return normalizeProviderName(value).toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function providerLegType(value: string): 'swim' | 'bike' | 'run' | null {
  const name = normalizeProviderName(value);
  if (!name || /^(T1|T2|TRANSITION|FINISH)/.test(name)) return null;
  if (name.includes('SWIM')) return 'swim';
  if (name.includes('BIKE') || name.includes('CYCLE') || name.includes('CYCLING')) return 'bike';
  if (name.includes('RUN')) return 'run';
  return null;
}

function toKm(value: number | null, configuredDistanceKm: number): number | null {
  if (value === null) return null;
  if (configuredDistanceKm > 0 && value > Math.max(100, configuredDistanceKm * 2)) return value / 1000;
  return value;
}

function readRule(value: unknown): CanonicalReadSelectionRule | null {
  const token = String(value ?? '').trim().toLocaleLowerCase('en-US').replace(/[^a-z]+/g, '_').replace(/^_|_$/g, '');
  return ['first', 'last', 'fastest', 'pass_number', 'manual'].includes(token) ? token as CanonicalReadSelectionRule : null;
}

function parseLegs(timingRules: UnknownRecord): ProviderLeg[] {
  return collection(timingRules, ['legs']).map((value, index) => {
    const row = record(value);
    return {
      id: textAt(row, ['leg_uuid', 'legUuid', 'uuid', 'UUID', 'id', 'ID']),
      contestUuid: textAt(row, ['contest_uuid', 'contestUuid', 'ContestUUID', 'contest_id', 'contestId']),
      name: textAt(row, ['leg_name', 'legName', 'displayName', 'name', 'Name', 'label', 'Label']),
      order: numberAt(row, ['leg_order', 'legOrder', 'order', 'Order', 'sequence']) ?? index + 1,
      startSplitId: textAt(row, ['start_split_uuid', 'startSplitUuid', 'firstSplitUuid', 'first_split_uuid', 'StartSplitUUID']),
      finishSplitId: textAt(row, ['end_split_uuid', 'endSplitUuid', 'lastSplitUuid', 'last_split_uuid', 'EndSplitUUID']),
    };
  });
}

function parseSplits(timingRules: UnknownRecord, configuredDistanceKm: number): ProviderSplit[] {
  return collection(timingRules, ['splits', 'timingSplits']).map((value, index) => {
    const row = record(value);
    const configuredVisible = optionalBooleanAt(row, ['public_visible', 'publicVisible', 'visible', 'isVisible']);
    const configuredHidden = optionalBooleanAt(row, ['hidden', 'isHidden', 'hideSplit']);
    const publicVisible = configuredVisible ?? (configuredHidden === null ? true : !configuredHidden);
    const configuredRequired = optionalBooleanAt(row, ['required', 'isRequired', 'Must']);
    return {
      id: textAt(row, ['split_uuid', 'splitUuid', 'uuid', 'UUID', 'id', 'ID']),
      contestUuid: textAt(row, ['contest_uuid', 'contestUuid', 'ContestUUID', 'contest_id', 'contestId']),
      timingPointUuid: textAt(row, ['timing_point_uuid', 'timingPointUuid', 'TimingPointUUID', 'endTimingPointUuid']),
      timingPointNumericId: textAt(row, ['timing_point_id', 'timingPointId', 'TimingPointId', 'TimingPointID']),
      timingPointId: textAt(row, ['timing_point_uuid', 'timingPointUuid', 'TimingPointUUID', 'endTimingPointUuid', 'timing_point_id', 'timingPointId', 'TimingPointId', 'TimingPointID']),
      legId: textAt(row, ['leg_uuid', 'legUuid', 'LegUUID', 'leg_id', 'legId']),
      legName: textAt(row, ['leg_name', 'legName', 'LegName', 'leg', 'course']),
      name: textAt(row, ['split_name', 'splitName', 'display_name', 'displayName', 'name', 'Name', 'label', 'Label']),
      canonicalCode: textAt(row, ['canonical_code', 'canonicalCode', 'split_code', 'splitCode']),
      order: numberAt(row, ['split_index', 'splitIndex', 'SplitIndex', 'split_order', 'splitOrder', 'order', 'Order', 'sequence']) ?? index + 1,
      distanceInLegKm: toKm(numberAt(row, ['distance_in_leg_km', 'distanceInLegKm', 'split_length_km', 'splitLengthKm', 'split_length', 'splitLength', 'SplitLength']), configuredDistanceKm),
      cumulativeDistanceKm: toKm(numberAt(row, ['cumulative_distance_km', 'cumulativeDistanceKm', 'distance_from_start_km', 'distanceFromStartKm', 'distance_from_start', 'distanceFromStart', 'DistanceFromStart', 'distance_km', 'distanceKm', 'distance']), configuredDistanceKm),
      passNumber: numberAt(row, ['pass_number', 'passNumber', 'CalculatedTimingPointUsePassNum', 'calculatedTimingPointUsePassNum']),
      readSelectionRule: readRule(valueAt(row, ['read_selection_rule', 'readSelectionRule'])),
      rankingEnabled: booleanAt(row, ['ranking_enabled', 'rankingEnabled', 'leaderboard', 'isLeaderboard'], true),
      publicVisible,
      // Visibility is presentation metadata. Legacy checkpoints were required
      // unless an operator explicitly marked them optional.
      required: configuredRequired ?? true,
      isStart: booleanAt(row, ['is_start', 'isStart', 'IsStart']),
      isFinish: booleanAt(row, ['is_finish', 'isFinish', 'IsFinish']),
      timingPointType: timingPointType(valueAt(row, ['timing_point_type', 'timingPointType', 'type'])),
      startDetectionEnabled: optionalBooleanAt(row, ['start_detection_enabled', 'startDetectionEnabled']),
      passageGroupingEnabled: optionalBooleanAt(row, ['passage_grouping_enabled', 'passageGroupingEnabled']),
      passageGapSeconds: numberAt(row, ['passage_gap_seconds', 'passageGapSeconds']),
    };
  });
}

const APPROVED_BOUNDARY_ALIASES: Record<string, string> = {
  'SWIM START': 'swim_start',
  'SWIM FINISH': 'swim_finish',
  'SWIM EXIT': 'swim_finish',
  'BIKE START': 'bike_start',
  'BIKE FINISH': 'bike_finish',
  'BIKE END': 'bike_finish',
  'RUN START': 'run_start',
  'RUN FINISH': 'run_finish',
  'RUN END': 'run_finish',
};

function baseLegType(type: CanonicalLegType): 'swim' | 'bike' | 'run' {
  return type === 'run_1' || type === 'run_2' ? 'run' : type;
}

function codeForLeg(type: CanonicalLegType): string {
  return type;
}

function resolveExplicitMapping(split: ProviderSplit, mappings: CanonicalSplitMappingInput[]): CanonicalSplitMappingInput | null {
  const bySplit = mappings.find((mapping) => mapping.providerSplitId && mapping.providerSplitId === split.id);
  if (bySplit) return bySplit;
  const providerCode = slug(split.canonicalCode);
  const byProviderCode = providerCode
    ? mappings.find((mapping) => slug(mapping.canonicalCode) === providerCode) ?? null
    : null;
  if (byProviderCode) return byProviderCode;

  // A physical point is commonly reused for Swim Finish/Bike Start or for
  // START/FINISH. Never let the first timing-point match claim every split.
  // Use pass/order/name only when they unambiguously identify one mapping.
  const timingPointMatches = mappings.filter((mapping) =>
    mapping.providerTimingPointId &&
    mapping.providerTimingPointId === split.timingPointId,
  );
  if (timingPointMatches.length === 1) return timingPointMatches[0];
  if (timingPointMatches.length > 1) {
    const byPass = split.passNumber == null
      ? []
      : timingPointMatches.filter((mapping) => Number(mapping.passNumber) === split.passNumber);
    if (byPass.length === 1) return byPass[0];
    const candidates = byPass.length > 0 ? byPass : timingPointMatches;
    const byOrder = candidates.filter((mapping) => Number(mapping.order) === split.order);
    if (byOrder.length === 1) return byOrder[0];
    const normalizedName = normalizeProviderName(split.name);
    const byName = candidates.filter((mapping) =>
      normalizeProviderName(mapping.displayName || '') === normalizedName,
    );
    if (byName.length === 1) return byName[0];
  }
  return null;
}

function mappedSplitOrder(split: ProviderSplit, mappings: CanonicalSplitMappingInput[]): number {
  const mappedOrder = Number(resolveExplicitMapping(split, mappings)?.order);
  return Number.isFinite(mappedOrder) ? mappedOrder : split.order;
}

function inferCanonicalCode(
  split: ProviderSplit,
  type: CanonicalLegType,
  isFirst: boolean,
  isLast: boolean,
  isFinalCourseSplit: boolean,
): string {
  const explicit = slug(split.canonicalCode);
  if (explicit) return explicit;
  const normalizedName = normalizeProviderName(split.name);
  const alias = APPROVED_BOUNDARY_ALIASES[normalizedName];
  if (alias) {
    const resolvedAlias = (type === 'run_1' || type === 'run_2') && alias.startsWith('run_')
      ? alias.replace(/^run/, type)
      : alias;
    // Provider labels can describe lap boundaries such as "Run 1 Finish".
    // A label alone cannot make an intermediate checkpoint the leg/race
    // finish when later configured splits remain.
    if (resolvedAlias.endsWith('_finish') && !isLast) {
      return `${codeForLeg(type)}_${slug(split.name || split.id || String(split.order)) || split.order}_checkpoint`;
    }
    if (resolvedAlias.startsWith(`${codeForLeg(type)}_`)) return resolvedAlias;
  }
  if (normalizedName === 'FINISH' && isFinalCourseSplit) return `${codeForLeg(type)}_finish`;
  if (split.isStart || isFirst || normalizedName.endsWith(' START')) return `${codeForLeg(type)}_start`;
  if (!isLast && (split.isFinish || normalizedName.endsWith(' FINISH') || normalizedName.endsWith(' EXIT'))) {
    return `${codeForLeg(type)}_${slug(split.name || split.id || String(split.order)) || split.order}_checkpoint`;
  }
  if (isLast) return `${codeForLeg(type)}_finish`;
  return `${codeForLeg(type)}_${slug(split.name || split.id || String(split.order)) || split.order}`;
}

function selectSplitsForLeg(
  allSplits: ProviderSplit[],
  providerLeg: ProviderLeg | null,
  type: CanonicalLegType,
  providerLegTypes: Map<string, 'swim' | 'bike' | 'run'>,
  explicitMappings: CanonicalSplitMappingInput[],
): ProviderSplit[] {
  const baseType = baseLegType(type);
  const prefix = `${codeForLeg(type)}_`;
  const explicitlyAssigned = allSplits.filter((split) => {
    const mapping = resolveExplicitMapping(split, explicitMappings);
    return mapping ? slug(mapping.canonicalCode).startsWith(prefix) : false;
  });
  const explicitlyMappedIds = new Set(allSplits.filter((split) => resolveExplicitMapping(split, explicitMappings)).map((split) => split.id));
  const direct = allSplits.filter((split) => providerLeg?.id && split.legId === providerLeg.id && !explicitlyMappedIds.has(split.id));
  if (explicitlyAssigned.length > 0 || direct.length > 0) {
    return [...explicitlyAssigned, ...direct]
      .filter((split, index, rows) => rows.findIndex((candidate) => candidate.id === split.id) === index)
      .sort((a, b) => mappedSplitOrder(a, explicitMappings) - mappedSplitOrder(b, explicitMappings));
  }

  const byType = allSplits.filter((split) => {
    if (explicitlyMappedIds.has(split.id)) return false;
    const splitLegType = providerLegTypes.get(split.legId) ?? providerLegType(split.legName) ?? providerLegType(split.name);
    return splitLegType === baseType;
  });
  return byType.sort((a, b) => mappedSplitOrder(a, explicitMappings) - mappedSplitOrder(b, explicitMappings));
}

/**
 * Feibot installations may report distance from the beginning of each leg,
 * while the canonical contract requires distance from the beginning of the
 * race. Rebase every leg onto the prior leg finish and assign canonical course
 * order after applying the saved admin split order.
 */
function normalizeCourseProgress(
  legs: CanonicalRaceLeg[],
  configuredRaceDistanceKm: number,
  legDistancesKm: CanonicalContestMappingInput['legDistancesKm'] = {},
): CanonicalRaceLeg[] {
  let courseDistanceKm = 0;
  let courseOrder = 0;

  return legs.map((leg, legIndex) => {
    const legStartKm = courseDistanceKm;
    const configuredLegDistanceKm = Number(legDistancesKm?.[leg.type]);
    const hasConfiguredLegDistance = Number.isFinite(configuredLegDistanceKm) && configuredLegDistanceKm > 0;
    // Provider IDs/order are not course order. In particular Feibot commonly
    // gives FINISH ID/order 1 while START is ID/order 2. Boundaries are
    // semantic: START is always first and FINISH is always last.
    const ordered = [...leg.splits].sort((a, b) => {
      if (a.isStart !== b.isStart) return a.isStart ? -1 : 1;
      if (a.isFinish !== b.isFinish) return a.isFinish ? 1 : -1;
      return a.order - b.order;
    });
    const start = ordered.find((split) => split.isStart) ?? ordered[0];
    const providerStartKm = start?.cumulativeDistanceKm ?? 0;
    const firstCheckpointKm = ordered
      .filter((split) => !split.isStart && !split.isFinish)
      .map((split) => split.cumulativeDistanceKm)
      .filter(Number.isFinite)
      .sort((left, right) => left - right)[0];
    const providerLegStartKm = firstCheckpointKm !== undefined && providerStartKm > firstCheckpointKm
      ? 0
      : providerStartKm;
    let previousRelativeKm = 0;

    const splits = ordered.map((split, index) => {
      const providerRelativeKm = split.isStart
        ? 0
        : split.cumulativeDistanceKm - providerLegStartKm;
      let relativeKm = Number.isFinite(providerRelativeKm) && providerRelativeKm >= previousRelativeKm
        ? providerRelativeKm
        : index === 0
          ? 0
          : Math.max(previousRelativeKm, split.distanceInLegKm, 0);

      // The configured race distance is authoritative for the final course
      // boundary. A shared START/FINISH mat may have a map position of 0 km,
      // but that physical position must never turn the official finish into
      // a zero-distance split.
      const isLegFinish = split.key === leg.finishSplitKey || split.key.endsWith('_finish');
      if (isLegFinish && hasConfiguredLegDistance) {
        relativeKm = configuredLegDistanceKm;
      } else if (hasConfiguredLegDistance) {
        relativeKm = Math.min(configuredLegDistanceKm, Math.max(previousRelativeKm, relativeKm));
      } else if (split.isFinish && legIndex === legs.length - 1 && configuredRaceDistanceKm > 0) {
        relativeKm = Math.max(previousRelativeKm, configuredRaceDistanceKm - legStartKm);
      }
      previousRelativeKm = relativeKm;
      courseOrder += 1;
      return {
        ...split,
        order: courseOrder,
        distanceInLegKm: relativeKm,
        cumulativeDistanceKm: legStartKm + relativeKm,
      };
    });

    courseDistanceKm = hasConfiguredLegDistance
      ? legStartKm + configuredLegDistanceKm
      : splits.at(-1)?.cumulativeDistanceKm ?? legStartKm;
    return {
      ...leg,
      distanceKm: hasConfiguredLegDistance
        ? configuredLegDistanceKm
        : Math.max(0, courseDistanceKm - legStartKm),
      splits,
    };
  });
}

function buildLegs(
  bergmanEventId: string,
  mapping: CanonicalContestMappingInput,
  providerLegs: ProviderLeg[],
  providerSplits: ProviderSplit[],
): CanonicalRaceLeg[] {
  const expected = expectedLegTypes(mapping.raceType);
  const providerSourceLegs = providerLegs
    .map((leg) => ({ leg, type: providerLegType(leg.name) }))
    .filter((entry): entry is { leg: ProviderLeg; type: 'swim' | 'bike' | 'run' } => entry.type !== null)
    .sort((a, b) => a.leg.order - b.leg.order);
  const providerLegTypes = new Map(providerSourceLegs.map((entry) => [entry.leg.id, entry.type]));
  const runLegs = providerSourceLegs.filter((entry) => entry.type === 'run');
  const explicitMappings = mapping.splitMappings ?? [];

  return expected.map((type, legIndex) => {
    const baseType = baseLegType(type);
    const providerLeg = type === 'run_1'
      ? runLegs[0]?.leg ?? null
      : type === 'run_2'
        ? runLegs[1]?.leg ?? null
        : providerSourceLegs.find((entry) => entry.type === baseType)?.leg ?? null;
    const selected = selectSplitsForLeg(providerSplits, providerLeg, type, providerLegTypes, explicitMappings);
    const sorted = selected.length > 0
      ? selected
      : expected.length === 1
        ? [...providerSplits].sort((a, b) => a.order - b.order)
        : providerSplits.filter((split) => {
            const explicit = resolveExplicitMapping(split, explicitMappings);
            return explicit ? slug(explicit.canonicalCode).startsWith(`${codeForLeg(type)}_`) : false;
          }).sort((a, b) => a.order - b.order);

    const legStartCumulative = sorted[0]?.cumulativeDistanceKm ?? 0;
    const canonicalSplits = sorted.map((split, splitIndex): CanonicalSplit => {
      const explicitMapping = resolveExplicitMapping(split, explicitMappings);
      const code = explicitMapping?.canonicalCode
        ? slug(explicitMapping.canonicalCode)
        : inferCanonicalCode(split, type, splitIndex === 0, splitIndex === sorted.length - 1, split === providerSplits.at(-1));
      const previousCumulative = splitIndex > 0 ? sorted[splitIndex - 1]?.cumulativeDistanceKm ?? legStartCumulative : legStartCumulative;
      const mappedCumulative = Number(explicitMapping?.cumulativeDistanceKm);
      const mappedDistanceInLeg = Number(explicitMapping?.distanceInLegKm);
      const cumulative = Number.isFinite(mappedCumulative)
        ? mappedCumulative
        : Number.isFinite(mappedDistanceInLeg)
          ? legStartCumulative + mappedDistanceInLeg
        : split.cumulativeDistanceKm ?? previousCumulative + Math.max(0, split.distanceInLegKm ?? 0);
      const distanceInLeg = Number.isFinite(mappedDistanceInLeg)
        ? mappedDistanceInLeg
        : Math.max(0, cumulative - legStartCumulative);
      const isBoundary = code.endsWith('_start') || code.endsWith('_finish');
      const isLegStart = code.endsWith('_start');
      const isLegFinish = code.endsWith('_finish');
      // A triathlon has a finish boundary for every sport, but only the final
      // split of the final leg is the race FINISH. Treating Swim Finish or Bike
      // Finish as `isFinish` prematurely freezes the athlete as FINISHED and
      // prevents later legs from progressing.
      const isRaceStart = isLegStart && legIndex === 0;
      const isRaceFinish = isLegFinish && legIndex === expected.length - 1;
      const legDisplayName = baseLegType(type) === 'run' ? 'Run' : baseLegType(type) === 'swim' ? 'Swim' : 'Bike';
      const displayName = String(explicitMapping?.displayName || '').trim() || (isBoundary
        ? (split.name || code.replace(/_/g, ' '))
        : `${legDisplayName} ${Number(distanceInLeg.toFixed(2))} km`);
      return {
        bergmanEventId,
        providerEventUuid: mapping.providerEventUuid,
        contestUuid: mapping.providerContestUuid,
        splitUuid: split.id,
        canonicalIdentityKey: [bergmanEventId, mapping.providerEventUuid, mapping.providerContestUuid, split.id]
          .filter(Boolean)
          .map((value) => String(value).trim().toLowerCase())
          .join(':'),
        key: code,
        canonicalCode: code,
        providerSplitId: split.id,
        providerTimingPointId: (explicitMapping?.providerTimingPointId ?? split.timingPointId) || null,
        providerTimingPointUuid: split.timingPointUuid || null,
        providerTimingPointNumericId: split.timingPointNumericId || null,
        timingPointResolutionStatus: (explicitMapping?.providerTimingPointId || split.timingPointId) ? 'resolved' : 'unresolved_nonfatal',
        displayName,
        providerName: split.name || code.replace(/_/g, ' '),
        order: split.order,
        legType: type,
        distanceInLegKm: distanceInLeg,
        cumulativeDistanceKm: cumulative,
        readSelectionRule: explicitMapping?.readSelectionRule ?? split.readSelectionRule,
        passNumber: explicitMapping?.passNumber ?? split.passNumber,
        rankingEnabled: explicitMapping?.rankingEnabled ?? split.rankingEnabled,
        publicVisible: explicitMapping?.publicVisible ?? split.publicVisible,
        required: explicitMapping?.required ?? split.required,
        isRaceStart,
        isLegStart,
        isRaceFinish,
        isLegFinish,
        // Keep legacy flags race-level. Several state writers use these flags
        // to decide whether an athlete has started/finished; a Bike Start must
        // never be interpreted as a second race START.
        isStart: isRaceStart,
        isFinish: isRaceFinish,
        timingPointType: explicitMapping?.timingPointType ?? split.timingPointType ?? (isRaceStart ? 'START' : isRaceFinish ? 'FINISH' : 'SPLIT'),
        startDetectionEnabled: explicitMapping?.startDetectionEnabled ?? split.startDetectionEnabled ?? isRaceStart,
        passageGroupingEnabled: explicitMapping?.passageGroupingEnabled ?? split.passageGroupingEnabled ?? isRaceStart,
        passageGapSeconds: explicitMapping?.passageGapSeconds ?? split.passageGapSeconds ?? (isRaceStart ? normalizeStartConfiguration(mapping.startConfiguration).passageGapSeconds : null),
      };
    });

    const start = canonicalSplits.find((split) => split.key === `${codeForLeg(type)}_start`) ?? canonicalSplits[0];
    const finish = canonicalSplits.find((split) => split.key === `${codeForLeg(type)}_finish`) ?? canonicalSplits.at(-1);
    const distance = start && finish ? Math.max(0, finish.cumulativeDistanceKm - start.cumulativeDistanceKm) : Math.max(0, ...canonicalSplits.map((split) => split.distanceInLegKm));
    const legToken = baseType === 'run' ? /run/i : baseType === 'bike' ? /bike|cycle/i : /swim/i;
    const legGpxUrls = (mapping.gpxUrls ?? []).filter((url) => legToken.test(url));
    const geometryStatus = legGpxUrls.length > 0 ? 'available' : canonicalSplits.length > 1 ? 'estimated' : 'missing';
    const geometrySource = legGpxUrls.length > 0 ? 'gpx' : canonicalSplits.some((split) => !!split.providerTimingPointId) ? 'timing_points' : canonicalSplits.length > 1 ? 'fallback' : 'none';

    return {
      key: codeForLeg(type),
      type,
      displayName: type === 'run_1' ? 'Run 1' : type === 'run_2' ? 'Run 2' : `${type[0].toUpperCase()}${type.slice(1)}`,
      order: legIndex + 1,
      providerLegId: providerLeg?.id || null,
      startSplitKey: start?.key ?? `${codeForLeg(type)}_start`,
      finishSplitKey: finish?.key ?? `${codeForLeg(type)}_finish`,
      distanceKm: distance,
      gpxUrls: legGpxUrls,
      geometryStatus,
      geometrySource,
      estimated: geometryStatus !== 'available',
      cutoffSeconds: mapping.cutoffs?.[type] ?? null,
      splits: canonicalSplits,
    };
  });
}

function buildSections(legs: CanonicalRaceLeg[]): { transitions: CanonicalTransition[]; sections: CanonicalRaceSection[] } {
  const transitions: CanonicalTransition[] = [];
  const sections: CanonicalRaceSection[] = [];
  legs.forEach((leg, index) => {
    sections.push({
      key: leg.key,
      sectionType: 'leg',
      order: sections.length + 1,
      displayName: leg.displayName,
      legType: leg.type,
      startSplitKey: leg.startSplitKey,
      finishSplitKey: leg.finishSplitKey,
    });
    const nextLeg = legs[index + 1];
    if (!nextLeg) return;
    const transitionType = index === 0 ? 't1' : 't2';
    const transition: CanonicalTransition = {
      key: transitionType,
      type: transitionType,
      displayName: transitionType === 't1' ? 'T1' : 'T2',
      order: index + 1,
      fromLegType: leg.type,
      toLegType: nextLeg.type,
      startSplitKey: leg.finishSplitKey,
      finishSplitKey: nextLeg.startSplitKey,
    };
    transitions.push(transition);
    sections.push({
      key: transition.key,
      sectionType: 'transition',
      order: sections.length + 1,
      displayName: transition.displayName,
      transitionType: transition.type,
      startSplitKey: transition.startSplitKey,
      finishSplitKey: transition.finishSplitKey,
    });
  });
  return { transitions, sections };
}

export function normalizeCanonicalCourse(input: CanonicalCourseNormalizerInput): CanonicalCourseBundle {
  const timingRules = record(input.timingRules);
  const providerLegs = parseLegs(timingRules);
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  const contests: CanonicalContestCourse[] = input.contestMappings.map((mapping) => {
    const acceptedContestUuids = new Set(
      [mapping.providerContestUuid, ...(mapping.legacyContestIds ?? [])]
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    );
    const splits = parseSplits(timingRules, mapping.configuredRaceDistanceKm)
      .filter(
        (split) => acceptedContestUuids.has(split.contestUuid.trim().toLowerCase()),
      )
      .sort((a, b) => a.order - b.order);
    const legs = normalizeCourseProgress(buildLegs(
      input.eventId,
      mapping,
      providerLegs.filter(
        (leg) => acceptedContestUuids.has(leg.contestUuid.trim().toLowerCase()),
      ),
      splits,
    ), mapping.configuredRaceDistanceKm, mapping.legDistancesKm);
    const { transitions, sections } = buildSections(legs);
    const canonicalSplits = legs.flatMap((leg) => leg.splits).sort((a, b) => a.order - b.order);
    return {
      providerEventUuid: mapping.providerEventUuid || null,
      providerContestUuid: mapping.providerContestUuid,
      bergmanTicketId: mapping.bergmanTicketId,
      legacyContestIds: mapping.legacyContestIds ?? [],
      displayName: mapping.displayName || mapping.providerContestUuid,
      raceType: mapping.raceType,
      timezone: mapping.timezone || input.timezone || 'UTC',
      courseVersion: mapping.courseVersion ?? input.courseVersion ?? 1,
      configuredRaceDistanceKm: mapping.configuredRaceDistanceKm,
      totalDistanceKm: canonicalSplits.at(-1)?.cumulativeDistanceKm ?? 0,
      gpxUrls: mapping.gpxUrls ?? [],
      cutoffs: mapping.cutoffs ?? {},
      startConfiguration: normalizeStartConfiguration(mapping.startConfiguration),
      legs,
      transitions,
      sections,
      splits: canonicalSplits,
    };
  });

  const provisional: CanonicalCourseBundle = {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    eventId: input.eventId,
    buildVersion: input.buildVersion,
    updatedAt,
    source: input.source,
    provider: input.source === 'manual' ? 'manual' : 'feibot',
    timezone: input.timezone || contests[0]?.timezone || 'UTC',
    courseVersion: input.courseVersion ?? Math.max(1, ...contests.map((contest) => contest.courseVersion)),
    contests,
    validation: {
      schemaVersion: CANONICAL_SCHEMA_VERSION,
      eventId: input.eventId,
      buildVersion: input.buildVersion,
      updatedAt,
      valid: false,
      errors: [],
      warnings: [],
    },
  };
  provisional.validation = validateCanonicalCourse(provisional);
  return provisional;
}
