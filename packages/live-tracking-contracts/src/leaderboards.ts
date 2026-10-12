import {
  CANONICAL_SCHEMA_VERSION,
  type CanonicalAthleteSnapshot,
  type CanonicalContestCourse,
  type CanonicalCourseBundle,
  type CanonicalLeaderboard,
  type CanonicalLeaderboardBuildArtifacts,
  type CanonicalLeaderboardEntry,
  type CanonicalLeaderboardManifest,
  type CanonicalRankingMode,
  type CanonicalSplitLeaderboard,
  type CanonicalSplitLeaderboardEntry,
  type CanonicalSplitRanking,
  type CanonicalSplitSummary,
} from './contracts';
import {
  versionedAthleteSnapshotKey,
  versionedLeaderboardKey,
  versionedLeaderboardManifestKey,
  versionedSplitLeaderboardKey,
  versionedSplitSummaryKey,
} from './storage-keys';
import type { CanonicalKvStore } from './versioning';
import { writeJsonIfChanged } from './versioning';
import { formatEventLocalTime } from './time';
import { withCanonicalFinalSummary } from './snapshot';

const OVERALL_EXCLUDED = new Set(['not_started', 'dns', 'dnf', 'dnq', 'disqualified', 'missing_data', 'timing_under_review']);
const SPLIT_EXCLUDED = new Set(['dns', 'dnf', 'dnq', 'disqualified', 'missing_data', 'timing_under_review']);
const VALID_READS = new Set(['valid', 'confirmed', 'corrected', 'official', 'manual_corrected']);

export interface BuildCanonicalLeaderboardsInput {
  eventId: string;
  buildVersion: string;
  course: CanonicalCourseBundle;
  snapshots: CanonicalAthleteSnapshot[];
  leaderboardVersion?: number;
  updatedAt?: string;
}

export interface CanonicalLeaderboardWriteResult {
  leaderboardCount: number;
  splitLeaderboardCount: number;
  splitSummaryCount: number;
  manifestCount: number;
  snapshotCount: number;
  writes: number;
  skipped: number;
}

function bibTieValue(bib: string): [number, string] {
  const numeric = Number(bib);
  return [Number.isFinite(numeric) ? numeric : Number.MAX_SAFE_INTEGER, bib];
}

function deterministicTie(a: CanonicalAthleteSnapshot, b: CanonicalAthleteSnapshot): number {
  const [aNumber, aBib] = bibTieValue(a.identity.bib);
  const [bNumber, bBib] = bibTieValue(b.identity.bib);
  return aNumber - bNumber || aBib.localeCompare(bBib) || a.identity.providerParticipantUuid.localeCompare(b.identity.providerParticipantUuid);
}

function lastCompleted(snapshot: CanonicalAthleteSnapshot, contest: CanonicalContestCourse) {
  const completed = contest.splits.filter((split) => {
    const read = snapshot.reads[split.key];
    return !!read && VALID_READS.has(read.status) && typeof read.elapsedSeconds === 'number' && Number.isFinite(read.elapsedSeconds) && read.elapsedSeconds >= 0;
  });
  const split = completed.at(-1) ?? null;
  return { split, read: split ? snapshot.reads[split.key] : null };
}

function hasLeaderboardTimingEvidence(snapshot: CanonicalAthleteSnapshot, contest: CanonicalContestCourse) {
  const last = lastCompleted(snapshot, contest);
  return Boolean(last.read)
    || (typeof snapshot.raceState.elapsedSeconds === 'number' && Number.isFinite(snapshot.raceState.elapsedSeconds))
    || snapshot.raceState.distanceCompletedKm > 0
    || snapshot.splits.some((split) => split.readAt !== null && split.elapsedSeconds !== null);
}

function overallComparator(contest: CanonicalContestCourse) {
  return (a: CanonicalAthleteSnapshot, b: CanonicalAthleteSnapshot): number => {
    const aFinished = a.raceState.status === 'finished';
    const bFinished = b.raceState.status === 'finished';
    if (aFinished !== bFinished) return aFinished ? -1 : 1;
    if (aFinished && bFinished) {
      const time = (a.calculated.overallSeconds ?? Number.MAX_SAFE_INTEGER) - (b.calculated.overallSeconds ?? Number.MAX_SAFE_INTEGER);
      return time || deterministicTie(a, b);
    }
    const aLast = lastCompleted(a, contest);
    const bLast = lastCompleted(b, contest);
    const splitOrder = (bLast.split?.order ?? -1) - (aLast.split?.order ?? -1);
    if (splitOrder) return splitOrder;
    const distance = (bLast.split?.cumulativeDistanceKm ?? 0) - (aLast.split?.cumulativeDistanceKm ?? 0);
    if (distance) return distance;
    const time = (aLast.read?.elapsedSeconds ?? Number.MAX_SAFE_INTEGER) - (bLast.read?.elapsedSeconds ?? Number.MAX_SAFE_INTEGER);
    if (time) return time;
    const timestamp = Date.parse(aLast.read?.timestamp ?? aLast.read?.occurredAt ?? '') - Date.parse(bLast.read?.timestamp ?? bLast.read?.occurredAt ?? '');
    return (Number.isFinite(timestamp) ? timestamp : 0) || deterministicTie(a, b);
  };
}

function entry(snapshot: CanonicalAthleteSnapshot, rank: number, contest: CanonicalContestCourse): CanonicalLeaderboardEntry {
  const last = lastCompleted(snapshot, contest);
  const lastSplitKey = last.split?.key ?? null;
  const lastSplitOrder = last.split?.order ?? -1;
  const readTimestamp = last.read?.timestamp ?? last.read?.occurredAt ?? null;
  const resultElapsedMs = snapshot.raceState.resolved?.officialResultElapsedMs;
  const officialElapsedSeconds = snapshot.raceState.status === 'finished'
    && typeof resultElapsedMs === 'number'
    && Number.isFinite(resultElapsedMs)
      ? resultElapsedMs / 1000
      : snapshot.calculated.overallSeconds ?? last.read?.elapsedSeconds ?? null;
  const stateFingerprint = [
    snapshot.identity.participantUuid,
    snapshot.raceState.status,
    snapshot.raceState.currentLegType ?? '',
    lastSplitKey ?? '',
    lastSplitOrder,
    snapshot.raceState.distanceCompletedKm,
    snapshot.raceState.resolved?.finishAt ?? '',
  ].join('|');
  return {
    participantUuid: snapshot.identity.participantUuid,
    providerParticipantUuid: snapshot.identity.providerParticipantUuid,
    bib: snapshot.identity.bib,
    displayName: snapshot.identity.displayName,
    rank,
    elapsedSeconds: officialElapsedSeconds,
    officialTimingMode: snapshot.raceState.resolved?.officialTimingMode
      ?? snapshot.raceState.resolved?.timingMode
      ?? contest.startConfiguration?.mode
      ?? 'GUN',
    officialElapsedSeconds,
    gunElapsedSeconds: last.read?.gunElapsedSeconds ?? null,
    chipElapsedSeconds: last.read?.chipElapsedSeconds ?? null,
    waveElapsedSeconds: last.read?.waveElapsedSeconds ?? null,
    status: snapshot.raceState.status,
    statusReason: snapshot.raceState.statusReason ?? null,
    statusSource: snapshot.raceState.statusSource ?? null,
    statusResolvedAt: snapshot.raceState.statusResolvedAt ?? null,
    failedCheckpoint: snapshot.raceState.failedCheckpoint ?? null,
    cutoffSeconds: snapshot.raceState.cutoffSeconds ?? null,
    cutoffDeadline: snapshot.raceState.cutoffDeadline ?? null,
    elapsedAtResolution: snapshot.raceState.elapsedAtResolution ?? null,
    genderKey: snapshot.identity.genderKey,
    ageGroupKey: snapshot.identity.ageGroupKey,
    clubName: snapshot.identity.clubName,
    countryCode: snapshot.identity.countryCode,
    photoUrl: snapshot.identity.photoUrl,
    trackingVisibility: snapshot.identity.trackingVisibility ?? 'PUBLIC',
    lastSplitKey,
    lastSplitOrder,
    distanceCompletedKm: snapshot.raceState.distanceCompletedKm,
    readTimestamp,
    timeOfDay: readTimestamp ? formatEventLocalTime(readTimestamp, contest.timezone) : null,
    // A race-wide pace is not meaningful for mixed-sport events. Sport metrics
    // belong only to the selected split leaderboard and are added by
    // splitEntry below.
    paceSecondsPerKm: null,
    paceSecondsPer100m: null,
    speedKmh: null,
    stateFingerprint,
    athleteRaceStatus: snapshot.raceState.status,
    currentLeg: snapshot.raceState.currentLegType,
    currentLastSplitKey: lastSplitKey,
    currentLastSplitOrder: lastSplitOrder,
    currentDistanceCompletedKm: snapshot.raceState.distanceCompletedKm,
  };
}

function buildRaceBoard(
  input: BuildCanonicalLeaderboardsInput,
  contest: CanonicalContestCourse,
  snapshots: CanonicalAthleteSnapshot[],
  mode: CanonicalRankingMode,
  qualifier: string | null,
): CanonicalLeaderboard {
  const filtered = snapshots.filter((snapshot) => {
    if (OVERALL_EXCLUDED.has(snapshot.raceState.status)) return false;
    if (!hasLeaderboardTimingEvidence(snapshot, contest)) return false;
    if (mode === 'gender') return snapshot.identity.genderKey === qualifier;
    if (mode === 'age') return snapshot.identity.ageGroupKey === qualifier;
    if (mode === 'club') return !!snapshot.identity.clubName;
    return true;
  }).sort(overallComparator(contest));
  return {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    eventId: input.eventId,
    buildVersion: input.buildVersion,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    leaderboardType: 'race',
    contestUuid: contest.providerContestUuid,
    mode,
    qualifier,
    entries: filtered.map((snapshot, index) => entry(snapshot, index + 1, contest)),
  };
}

function splitEntry(snapshot: CanonicalAthleteSnapshot, rank: number, contest: CanonicalContestCourse, splitKey: string): CanonicalSplitLeaderboardEntry {
  const base = entry(snapshot, rank, contest);
  const read = snapshot.reads[splitKey];
  const readTimestamp = read?.timestamp ?? read?.occurredAt ?? null;
  const row = snapshot.splits.find((candidate) => candidate.splitKey === splitKey);
  return {
    ...base,
    elapsedSeconds: read?.elapsedSeconds ?? null,
    officialTimingMode: base.officialTimingMode,
    officialElapsedSeconds: read?.officialElapsedSeconds ?? read?.elapsedSeconds ?? null,
    gunElapsedSeconds: read?.gunElapsedSeconds ?? null,
    chipElapsedSeconds: read?.chipElapsedSeconds ?? null,
    waveElapsedSeconds: read?.waveElapsedSeconds ?? null,
    readTimestamp,
    timeOfDay: readTimestamp ? formatEventLocalTime(readTimestamp, contest.timezone) : null,
    paceSecondsPerKm: row?.paceSecondsPerKm ?? null,
    paceSecondsPer100m: row?.paceSecondsPer100m ?? null,
    speedKmh: row?.speedKmh ?? null,
    splitKey,
    splitStatus: 'COMPLETED',
    splitElapsedSeconds: read?.elapsedSeconds ?? null,
    sectionSeconds: row?.sectionSeconds ?? read?.segmentElapsedSeconds ?? null,
  };
}

function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const remainder = whole % 60;
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function formatSportMetric(entry: CanonicalSplitLeaderboardEntry): string | null {
  if (entry.speedKmh !== null && Number.isFinite(entry.speedKmh) && entry.speedKmh > 0) {
    return `${entry.speedKmh.toFixed(1)} km/h`;
  }
  if (entry.paceSecondsPer100m !== null && Number.isFinite(entry.paceSecondsPer100m) && entry.paceSecondsPer100m > 0) {
    return `${formatDuration(entry.paceSecondsPer100m)} /100m`;
  }
  if (entry.paceSecondsPerKm !== null && Number.isFinite(entry.paceSecondsPerKm) && entry.paceSecondsPerKm > 0) {
    return `${formatDuration(entry.paceSecondsPerKm)} /km`;
  }
  return null;
}

function annotateSplitBoardMovement(
  board: CanonicalSplitLeaderboard,
  previousBoard: CanonicalSplitLeaderboard | null,
): CanonicalSplitLeaderboard {
  const previousRanks = new Map((previousBoard?.entries || []).map((row) => [row.providerParticipantUuid, row.rank]));
  const leaderSeconds = board.entries[0]?.elapsedSeconds ?? null;
  return {
    ...board,
    entries: board.entries.map((row) => {
      const previousRank = previousRanks.get(row.providerParticipantUuid) ?? null;
      const positionDelta = previousRank === null ? null : previousRank - row.rank;
      const positionDirection = previousRank === null
        ? 'NEW'
        : positionDelta === 0
          ? 'SAME'
          : positionDelta !== null && positionDelta > 0 ? 'UP' : 'DOWN';
      const positionDisplay = positionDirection === 'UP'
        ? `↑ ${Math.abs(positionDelta ?? 0)}`
        : positionDirection === 'DOWN'
          ? `↓ ${Math.abs(positionDelta ?? 0)}`
          : '—';
      const positionDescription = positionDirection === 'UP'
        ? `Gained ${Math.abs(positionDelta ?? 0)} position${Math.abs(positionDelta ?? 0) === 1 ? '' : 's'}`
        : positionDirection === 'DOWN'
          ? `Lost ${Math.abs(positionDelta ?? 0)} position${Math.abs(positionDelta ?? 0) === 1 ? '' : 's'}`
          : positionDirection === 'SAME' ? 'Position unchanged' : 'First ranked checkpoint';
      const elapsed = row.elapsedSeconds;
      const gapToLeaderSeconds = leaderSeconds !== null && elapsed !== null
        ? Math.max(0, elapsed - leaderSeconds)
        : null;
      return {
        ...row,
        gapToLeaderSeconds,
        gapDisplay: gapToLeaderSeconds === null ? null : gapToLeaderSeconds === 0 ? 'LEADER' : `+${formatDuration(gapToLeaderSeconds)}`,
        previousRank,
        positionDelta,
        positionDirection,
        positionDisplay,
        positionDescription,
        paceDisplay: formatSportMetric(row),
      };
    }),
  };
}

function splitCandidates(snapshots: CanonicalAthleteSnapshot[], splitKey: string): CanonicalAthleteSnapshot[] {
  return snapshots.filter((snapshot) => {
    if (SPLIT_EXCLUDED.has(snapshot.raceState.status)) return false;
    const read = snapshot.reads[splitKey];
    return !!read && VALID_READS.has(read.status) && typeof read.elapsedSeconds === 'number' && Number.isFinite(read.elapsedSeconds) && read.elapsedSeconds >= 0;
  });
}

function splitComparator(splitKey: string) {
  return (a: CanonicalAthleteSnapshot, b: CanonicalAthleteSnapshot): number => {
    const aRead = a.reads[splitKey];
    const bRead = b.reads[splitKey];
    const elapsed = (aRead?.elapsedSeconds ?? Number.MAX_SAFE_INTEGER) - (bRead?.elapsedSeconds ?? Number.MAX_SAFE_INTEGER);
    if (elapsed) return elapsed;
    const timestamp = Date.parse(aRead?.timestamp ?? aRead?.occurredAt ?? '') - Date.parse(bRead?.timestamp ?? bRead?.occurredAt ?? '');
    return (Number.isFinite(timestamp) ? timestamp : 0) || deterministicTie(a, b);
  };
}

function buildSplitBoard(
  input: BuildCanonicalLeaderboardsInput,
  contest: CanonicalContestCourse,
  snapshots: CanonicalAthleteSnapshot[],
  splitKey: string,
  mode: CanonicalRankingMode,
  qualifier: string | null,
): CanonicalSplitLeaderboard {
  const filtered = splitCandidates(snapshots, splitKey).filter((snapshot) => {
    if (mode === 'gender') return snapshot.identity.genderKey === qualifier;
    if (mode === 'age') return snapshot.identity.ageGroupKey === qualifier;
    if (mode === 'club') return !!snapshot.identity.clubName;
    return true;
  }).sort(splitComparator(splitKey));
  return {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    eventId: input.eventId,
    buildVersion: input.buildVersion,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    leaderboardType: 'split',
    contestUuid: contest.providerContestUuid,
    splitKey,
    mode,
    qualifier,
    entries: filtered.map((snapshot, index) => splitEntry(snapshot, index + 1, contest, splitKey)),
  };
}

function rankMap(board: CanonicalSplitLeaderboard): Map<string, number> {
  return new Map(board.entries.map((row) => [row.providerParticipantUuid, row.rank]));
}

export function buildCanonicalLeaderboards(input: BuildCanonicalLeaderboardsInput): CanonicalLeaderboardBuildArtifacts {
  const leaderboardVersion = input.leaderboardVersion ?? 1;
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  const leaderboards: CanonicalLeaderboard[] = [];
  const splitLeaderboards: CanonicalSplitLeaderboard[] = [];
  const splitSummaries: CanonicalSplitSummary[] = [];
  const manifests: CanonicalLeaderboardManifest[] = [];
  const snapshots = input.snapshots.map((snapshot) => ({
    ...snapshot,
    overallRanking: { ...snapshot.overallRanking },
    splitRankings: Object.fromEntries(Object.entries(snapshot.splitRankings).map(([key, value]) => [key, { ...value }])),
    versions: { ...snapshot.versions, leaderboard: leaderboardVersion },
    leaderboardVersion,
    updatedAt,
  }));

  for (const contest of input.course.contests) {
    const contestSnapshots = snapshots.filter((snapshot) => snapshot.contestUuid === contest.providerContestUuid);
    const genders = [...new Set(contestSnapshots.map((snapshot) => snapshot.identity.genderKey).filter((value): value is string => !!value))].sort();
    const ageGroups = [...new Set(contestSnapshots.map((snapshot) => snapshot.identity.ageGroupKey).filter((value): value is string => !!value))].sort();
    const overall = buildRaceBoard({ ...input, updatedAt }, contest, contestSnapshots, 'overall', null);
    leaderboards.push(overall);
    for (const gender of genders) leaderboards.push(buildRaceBoard({ ...input, updatedAt }, contest, contestSnapshots, 'gender', gender));
    for (const ageGroup of ageGroups) leaderboards.push(buildRaceBoard({ ...input, updatedAt }, contest, contestSnapshots, 'age', ageGroup));
    const clubBoard = buildRaceBoard({ ...input, updatedAt }, contest, contestSnapshots, 'club', null);
    leaderboards.push(clubBoard);

    const overallRank = new Map(overall.entries.map((row) => [row.providerParticipantUuid, row.rank]));
    const genderBoards = new Map(genders.map((gender) => [gender, buildRaceBoard({ ...input, updatedAt }, contest, contestSnapshots, 'gender', gender)]));
    const ageBoards = new Map(ageGroups.map((ageGroup) => [ageGroup, buildRaceBoard({ ...input, updatedAt }, contest, contestSnapshots, 'age', ageGroup)]));
    const clubRanks = new Map(clubBoard.entries.map((row) => [row.providerParticipantUuid, row.rank]));
    for (const snapshot of contestSnapshots) {
      snapshot.overallRanking.overallRank = overallRank.get(snapshot.identity.providerParticipantUuid) ?? null;
      snapshot.overallRanking.genderRank = snapshot.identity.genderKey ? genderBoards.get(snapshot.identity.genderKey)?.entries.find((row) => row.providerParticipantUuid === snapshot.identity.providerParticipantUuid)?.rank ?? null : null;
      snapshot.overallRanking.ageGroupRank = snapshot.identity.ageGroupKey ? ageBoards.get(snapshot.identity.ageGroupKey)?.entries.find((row) => row.providerParticipantUuid === snapshot.identity.providerParticipantUuid)?.rank ?? null : null;
      snapshot.overallRanking.clubRank = snapshot.identity.clubName ? clubRanks.get(snapshot.identity.providerParticipantUuid) ?? null : null;
    }

    const summaryRows: CanonicalSplitSummary['splits'] = [];
    const rankingSplits = [...contest.splits]
      .filter((split) => split.rankingEnabled)
      .sort((left, right) => left.order - right.order);
    let previousOverallSplit: CanonicalSplitLeaderboard | null = null;
    let previousClubSplit: CanonicalSplitLeaderboard | null = null;
    const previousGenderSplits = new Map<string, CanonicalSplitLeaderboard>();
    const previousAgeSplits = new Map<string, CanonicalSplitLeaderboard>();
    for (const split of rankingSplits) {
      const overallSplit = annotateSplitBoardMovement(
        buildSplitBoard({ ...input, updatedAt }, contest, contestSnapshots, split.key, 'overall', null),
        previousOverallSplit,
      );
      splitLeaderboards.push(overallSplit);
      const genderSplitBoards = new Map(genders.map((gender) => {
        const board = annotateSplitBoardMovement(
          buildSplitBoard({ ...input, updatedAt }, contest, contestSnapshots, split.key, 'gender', gender),
          previousGenderSplits.get(gender) ?? null,
        );
        splitLeaderboards.push(board);
        return [gender, board] as const;
      }));
      const ageSplitBoards = new Map(ageGroups.map((ageGroup) => {
        const board = annotateSplitBoardMovement(
          buildSplitBoard({ ...input, updatedAt }, contest, contestSnapshots, split.key, 'age', ageGroup),
          previousAgeSplits.get(ageGroup) ?? null,
        );
        splitLeaderboards.push(board);
        return [ageGroup, board] as const;
      }));
      const clubSplit = annotateSplitBoardMovement(
        buildSplitBoard({ ...input, updatedAt }, contest, contestSnapshots, split.key, 'club', null),
        previousClubSplit,
      );
      splitLeaderboards.push(clubSplit);
      const overallRanks = rankMap(overallSplit);
      for (const snapshot of contestSnapshots) {
        const genderBoard = snapshot.identity.genderKey ? genderSplitBoards.get(snapshot.identity.genderKey) : null;
        const ageBoard = snapshot.identity.ageGroupKey ? ageSplitBoards.get(snapshot.identity.ageGroupKey) : null;
        const ranking: CanonicalSplitRanking = {
          splitKey: split.key,
          overallRank: overallRanks.get(snapshot.identity.providerParticipantUuid) ?? null,
          overallTotal: overallSplit.entries.length,
          genderRank: genderBoard?.entries.find((row) => row.providerParticipantUuid === snapshot.identity.providerParticipantUuid)?.rank ?? null,
          genderTotal: genderBoard?.entries.length ?? null,
          ageGroupRank: ageBoard?.entries.find((row) => row.providerParticipantUuid === snapshot.identity.providerParticipantUuid)?.rank ?? null,
          ageGroupTotal: ageBoard?.entries.length ?? null,
        };
        snapshot.splitRankings[split.key] = ranking;
        const splitRow = snapshot.splits.find((row) => row.splitKey === split.key);
        if (splitRow) splitRow.ranking = ranking;
      }
      const latest = [...overallSplit.entries].sort((a, b) => Date.parse(b.readTimestamp ?? '') - Date.parse(a.readTimestamp ?? ''))[0] ?? null;
      const activeRaceCount = contestSnapshots.filter((snapshot) => (
        !OVERALL_EXCLUDED.has(snapshot.raceState.status)
        && snapshot.raceState.status !== 'finished'
      )).length;
      const pendingAtSplitCount = Math.max(0, contestSnapshots.filter((snapshot) => !SPLIT_EXCLUDED.has(snapshot.raceState.status)).length - overallSplit.entries.length);
      summaryRows.push({
        splitKey: split.key,
        displayName: split.displayName,
        order: split.order,
        legType: split.legType,
        completedCount: overallSplit.entries.length,
        pendingAtSplitCount,
        activeRaceCount,
        stillRacingCount: pendingAtSplitCount,
        leader: overallSplit.entries[0] ?? null,
        latestFinisher: latest,
      });
      previousOverallSplit = overallSplit;
      previousClubSplit = clubSplit;
      for (const [gender, board] of genderSplitBoards) previousGenderSplits.set(gender, board);
      for (const [ageGroup, board] of ageSplitBoards) previousAgeSplits.set(ageGroup, board);
    }

    // The live race board exposes movement and sport pace from each athlete's
    // latest accepted ranking checkpoint. This is a projection of the same
    // immutable split boards, never a second ranking calculation.
    for (const raceBoard of leaderboards.filter((board) => board.contestUuid === contest.providerContestUuid)) {
      raceBoard.entries = raceBoard.entries.map((row) => {
        const splitBoard = splitLeaderboards.find((candidate) => (
          candidate.contestUuid === contest.providerContestUuid
          && candidate.splitKey === row.currentLastSplitKey
          && candidate.mode === raceBoard.mode
          && candidate.qualifier === raceBoard.qualifier
        ));
        const splitRow = splitBoard?.entries.find((candidate) => candidate.providerParticipantUuid === row.providerParticipantUuid);
        return splitRow ? {
          ...row,
          gapToLeaderSeconds: splitRow.gapToLeaderSeconds,
          gapDisplay: splitRow.gapDisplay,
          previousRank: splitRow.previousRank,
          positionDelta: splitRow.positionDelta,
          positionDirection: splitRow.positionDirection,
          positionDisplay: splitRow.positionDisplay,
          positionDescription: splitRow.positionDescription,
          paceSecondsPerKm: splitRow.paceSecondsPerKm,
          paceSecondsPer100m: splitRow.paceSecondsPer100m,
          speedKmh: splitRow.speedKmh,
          paceDisplay: splitRow.paceDisplay,
        } : row;
      });
    }

    // Ranking is the final missing input for the finish projection. Persist it
    // on the same snapshot collection used by every derived canonical object.
    for (const snapshot of contestSnapshots) {
      Object.assign(snapshot, withCanonicalFinalSummary(snapshot, contest, updatedAt));
    }

    splitSummaries.push({
      schemaVersion: CANONICAL_SCHEMA_VERSION,
      eventId: input.eventId,
      buildVersion: input.buildVersion,
      updatedAt,
      contestUuid: contest.providerContestUuid,
      splits: summaryRows,
    });
    manifests.push({
      schemaVersion: CANONICAL_SCHEMA_VERSION,
      eventId: input.eventId,
      buildVersion: input.buildVersion,
      updatedAt,
      contestUuid: contest.providerContestUuid,
      leaderboardVersion,
      availableRaceModes: ['overall', 'gender', 'age', 'club'],
      availableSplitModes: ['overall', 'gender', 'age', 'club'],
      splitKeys: rankingSplits.map((split) => split.key),
      available: { overall: true, gender: genders, ageGroups, club: true, splits: rankingSplits.map((split) => split.key) },
    });
  }
  return { leaderboards, splitLeaderboards, splitSummaries, manifests, snapshots };
}

export function buildCanonicalLeaderboardUpdate(
  input: BuildCanonicalLeaderboardsInput,
  contestUuid: string,
  splitKey: string,
): CanonicalLeaderboardBuildArtifacts {
  const contest = input.course.contests.find((entry) => entry.providerContestUuid === contestUuid);
  if (!contest) return { leaderboards: [], splitLeaderboards: [], splitSummaries: [], manifests: [], snapshots: input.snapshots };
  const focused = buildCanonicalLeaderboards({
    ...input,
    course: { ...input.course, contests: [contest] },
    snapshots: input.snapshots.filter((snapshot) => snapshot.contestUuid === contestUuid),
  });
  return {
    ...focused,
    splitLeaderboards: focused.splitLeaderboards.filter((board) => board.splitKey === splitKey),
  };
}

export async function writeCanonicalLeaderboardArtifacts(
  store: CanonicalKvStore,
  artifacts: CanonicalLeaderboardBuildArtifacts,
): Promise<CanonicalLeaderboardWriteResult> {
  let writes = 0;
  let skipped = 0;
  const track = async (key: string, value: unknown) => {
    if (await writeJsonIfChanged(store, key, value)) writes += 1;
    else skipped += 1;
  };
  for (const board of artifacts.leaderboards) {
    await track(versionedLeaderboardKey(board.eventId, board.buildVersion, board.contestUuid, board.mode, board.qualifier ?? undefined), board);
  }
  for (const board of artifacts.splitLeaderboards) {
    await track(versionedSplitLeaderboardKey(board.eventId, board.buildVersion, board.contestUuid, board.splitKey, board.mode, board.qualifier ?? undefined), board);
  }
  for (const summary of artifacts.splitSummaries) await track(versionedSplitSummaryKey(summary.eventId, summary.buildVersion, summary.contestUuid), summary);
  for (const manifest of artifacts.manifests) await track(versionedLeaderboardManifestKey(manifest.eventId, manifest.buildVersion, manifest.contestUuid), manifest);
  for (const snapshot of artifacts.snapshots) await track(versionedAthleteSnapshotKey(snapshot.eventId, snapshot.buildVersion, snapshot.identity.participantUuid), snapshot);
  return {
    leaderboardCount: artifacts.leaderboards.length,
    splitLeaderboardCount: artifacts.splitLeaderboards.length,
    splitSummaryCount: artifacts.splitSummaries.length,
    manifestCount: artifacts.manifests.length,
    snapshotCount: artifacts.snapshots.length,
    writes,
    skipped,
  };
}
