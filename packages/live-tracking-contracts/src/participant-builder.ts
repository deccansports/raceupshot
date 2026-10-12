import {
  CANONICAL_SCHEMA_VERSION,
  type CanonicalAliasArtifact,
  type CanonicalAthleteSnapshot,
  type CanonicalCourseBundle,
  type CanonicalParticipantBuildArtifacts,
  type CanonicalParticipantIndexRow,
  type CanonicalParticipantSource,
  type CanonicalSplitRanking,
} from './contracts';
import { hashNormalizedEmail, normalizeAgeGroupKey, normalizeBib, normalizeDisplayName, normalizeGenderKey } from './identity';
import {
  versionedAthleteBibAliasKey,
  versionedAthleteBookingAliasKey,
  versionedAthleteEmailAliasKey,
  versionedAthleteProviderAliasKey,
  versionedAthleteSnapshotKey,
  versionedAthleteUidAliasKey,
  versionedParticipantIndexKey,
  versionedUserAthletesReverseIndexKey,
} from './storage-keys';
import { recalculateAthleteSnapshot } from './snapshot';
import { emptyStartTimingState, normalizeStartConfiguration } from './start-timing';
import type { CanonicalKvStore } from './versioning';
import { writeJsonIfChanged } from './versioning';

export interface BuildCanonicalParticipantsInput {
  eventId: string;
  buildVersion: string;
  course: CanonicalCourseBundle;
  participants: CanonicalParticipantSource[];
  existingSnapshots?: Record<string, CanonicalAthleteSnapshot | undefined>;
  participantVersion?: number;
  timingVersion?: number;
  updatedAt?: string;
}

export function resolveCanonicalSnapshotTimingVersion(
  existing: Pick<CanonicalAthleteSnapshot, 'timingVersion' | 'versions'> | null | undefined,
  buildTimingVersion: number | null | undefined,
): number {
  return Math.max(
    0,
    Number(existing?.timingVersion) || 0,
    Number(existing?.versions?.timing) || 0,
    Number(buildTimingVersion) || 0,
  );
}

export interface CanonicalParticipantWriteResult {
  indexKey: string;
  snapshotCount: number;
  aliasCount: number;
  reverseIndexCount: number;
  writes: number;
  skipped: number;
  verifiedSnapshotCount: number;
  missingSnapshotCount: number;
  verifiedAliasCount: number;
  missingAliasCount: number;
}

export function hasOrphanedEffectiveStart(
  reads: Record<string, CanonicalAthleteSnapshot['reads'][string]>,
  acceptedReadId: string | null | undefined,
): boolean {
  const retainedReads = Object.values(reads).filter((read): read is NonNullable<typeof read> => Boolean(read));
  const effectiveStart = retainedReads.find((read) => read.readId.endsWith(':effective-start'));
  if (!effectiveStart || !acceptedReadId) return false;
  return !retainedReads.some((read) => read.readId === acceptedReadId);
}

// Cloudflare KV writes made through the REST API can take a few seconds to
// become visible to a following read. Keep the manifest unpublished until the
// immutable snapshots and aliases survive a longer bounded read-back window.
const READ_BACK_ATTEMPTS = 7;
const READ_BACK_INITIAL_DELAY_MS = 200;
const SNAPSHOT_VERIFICATION_BATCH_SIZE = 25;
const ALIAS_VERIFICATION_BATCH_SIZE = 50;
const DEFAULT_CANONICAL_WRITE_CONCURRENCY = Math.max(1, parseInt(process.env.CANONICAL_PARTICIPANT_WRITE_CONCURRENCY || '20', 10));

function resolveWriteConcurrency(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(4, Math.min(48, parsed));
}

const PARTICIPANT_WRITE_CONCURRENCY = resolveWriteConcurrency(process.env.CANONICAL_PARTICIPANT_WRITE_CONCURRENCY, DEFAULT_CANONICAL_WRITE_CONCURRENCY);

function chunksOf<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function verifyPersistedKeys(
  store: CanonicalKvStore,
  keys: string[],
): Promise<{ verified: number; missing: string[] }> {
  const expected = [...new Set(keys)];
  let missing = expected;

  for (let attempt = 0; attempt < READ_BACK_ATTEMPTS && missing.length > 0; attempt += 1) {
    const readStates = await Promise.allSettled(
      missing.map(async (key) => ({ key, value: await store.get(key) })),
    );
    const stillMissing: string[] = [];

    for (const item of readStates) {
      if (item.status !== 'fulfilled') {
        continue;
      }
      const { key, value } = item.value;
      if (!value) stillMissing.push(key);
    }

    missing = stillMissing;
    if (missing.length > 0 && attempt < READ_BACK_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(
        resolve,
        READ_BACK_INITIAL_DELAY_MS * (2 ** attempt),
      ));
    }
  }

  return { verified: expected.length - missing.length, missing };
}

async function withLimitedConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
) {
  let next = 0;
  const limit = Math.max(1, Math.min(Math.max(1, concurrency), items.length || 1));
  await Promise.all(Array.from({ length: limit }).map(async () => {
    while (true) {
      const index = next;
      next += 1;
      const item = items[index];
      if (!item) return;
      await worker(item, index);
    }
  }));
}

function contestIdentity(providerEventUuid: string | null | undefined, contestUuid: string): string {
  return `${String(providerEventUuid || '').trim()}:${String(contestUuid || '').trim()}`;
}

function collectContestMap(contests: CanonicalCourseBundle['contests']) {
  return new Map(contests.flatMap((contest) => {
    const scoped = [contestIdentity(contest.providerEventUuid, contest.providerContestUuid), contest] as const;
    return contest.providerEventUuid ? [scoped] : [scoped, [contest.providerContestUuid, contest] as const];
  }));
}

function resolveContest(
  contests: ReturnType<typeof collectContestMap>,
  providerEventUuid: string | null | undefined,
  contestUuid: string,
) {
  return contests.get(contestIdentity(providerEventUuid, contestUuid)) ?? contests.get(contestUuid);
}

function optionalText(value: string | null | undefined): string | null {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function raceIdentitySegment(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Race identity is provider-event + provider-contest + bib. Provider record
 * UUIDs remain aliases because Feibot can replace them during registration
 * corrections and because two connected events may reuse the same value. */
export function authoritativeRaceParticipantUuid(source: Pick<CanonicalParticipantSource, 'providerEventUuid' | 'providerContestUuid' | 'contestUuid' | 'bib' | 'participantUuid' | 'providerParticipantUuid'>): string {
  const providerEventUuid = raceIdentitySegment(source.providerEventUuid);
  const providerContestUuid = raceIdentitySegment(source.providerContestUuid || source.contestUuid);
  const bib = raceIdentitySegment(normalizeBib(source.bib || ''));
  if (providerEventUuid && providerContestUuid && bib) {
    return `race:${providerEventUuid}:${providerContestUuid}:${bib}`;
  }
  return String(source.participantUuid || source.providerParticipantUuid || '').trim();
}

function alias(
  key: string,
  eventId: string,
  buildVersion: string,
  updatedAt: string,
  aliasType: CanonicalAliasArtifact['value']['aliasType'],
  participantUuid: string,
): CanonicalAliasArtifact {
  return {
    key,
    value: {
      schemaVersion: CANONICAL_SCHEMA_VERSION,
      eventId,
      buildVersion,
      updatedAt,
      aliasType,
      participantUuid,
    },
  };
}

function emptySplitRankings(splitKeys: string[]): Record<string, CanonicalSplitRanking> {
  return Object.fromEntries(splitKeys.map((splitKey) => [splitKey, {
    splitKey,
    overallRank: null,
    genderRank: null,
    ageGroupRank: null,
    overallTotal: null,
    genderTotal: null,
    ageGroupTotal: null,
  }]));
}

function buildIndexRow(snapshot: CanonicalAthleteSnapshot, contestName: string): CanonicalParticipantIndexRow {
  const lastSplit = snapshot.splits.filter((split) => split.elapsedSeconds !== null).at(-1) ?? null;
  return {
    providerEventUuid: snapshot.providerEventUuid ?? null,
    participantUuid: snapshot.identity.participantUuid,
    providerParticipantUuid: snapshot.identity.providerParticipantUuid,
    chipCode: snapshot.identity.chipCode,
    waveStartTime: snapshot.identity.waveStartTime ?? null,
    bib: snapshot.identity.bib,
    displayName: snapshot.identity.displayName,
    contestUuid: snapshot.contestUuid,
    providerContestUuid: snapshot.providerContestUuid ?? snapshot.contestUuid,
    canonicalContestUuid: snapshot.canonicalContestUuid ?? snapshot.contestUuid,
    contestName,
    genderKey: snapshot.identity.genderKey,
    ageGroupKey: snapshot.identity.ageGroupKey,
    clubName: snapshot.identity.clubName,
    countryCode: snapshot.identity.countryCode,
    photoUrl: snapshot.identity.photoUrl,
    trackingVisibility: snapshot.identity.trackingVisibility ?? 'PUBLIC',
    status: snapshot.raceState.status,
    statusReason: snapshot.raceState.statusReason ?? null,
    statusSource: snapshot.raceState.statusSource ?? null,
    statusResolvedAt: snapshot.raceState.statusResolvedAt ?? null,
    failedCheckpoint: snapshot.raceState.failedCheckpoint ?? null,
    cutoffSeconds: snapshot.raceState.cutoffSeconds ?? null,
    cutoffDeadline: snapshot.raceState.cutoffDeadline ?? null,
    elapsedAtResolution: snapshot.raceState.elapsedAtResolution ?? null,
    currentLeg: snapshot.raceState.currentLegType,
    lastSplitKey: lastSplit?.splitKey ?? null,
    lastSplitLabel: lastSplit?.displayName ?? null,
    overallSeconds: snapshot.calculated.overallSeconds,
    overallRank: snapshot.overallRanking.overallRank,
  };
}

export function updateCanonicalParticipantIndex(
  artifacts: CanonicalParticipantBuildArtifacts,
  course: CanonicalCourseBundle,
  snapshots: CanonicalAthleteSnapshot[],
  updatedAt = new Date().toISOString(),
): CanonicalParticipantBuildArtifacts {
  const contestByUuid = collectContestMap(course.contests);
  const rows = snapshots.map((snapshot) => buildIndexRow(
    snapshot,
    resolveContest(contestByUuid, snapshot.providerEventUuid, snapshot.contestUuid)?.displayName ?? snapshot.contestUuid,
  )).sort((a, b) => a.displayName.localeCompare(b.displayName) || a.bib.localeCompare(b.bib));
  return {
    ...artifacts,
    snapshots,
    index: { ...artifacts.index, updatedAt, participantCount: rows.length, rows },
  };
}

export function rebuildCanonicalParticipantIndexRows(
  index: CanonicalParticipantBuildArtifacts['index'],
  course: CanonicalCourseBundle,
  snapshots: CanonicalAthleteSnapshot[],
  updatedAt = new Date().toISOString(),
): CanonicalParticipantBuildArtifacts['index'] {
  const contestByUuid = collectContestMap(course.contests);
  const rows = snapshots.map((snapshot) => buildIndexRow(
    snapshot,
    resolveContest(contestByUuid, snapshot.providerEventUuid, snapshot.contestUuid)?.displayName ?? snapshot.contestUuid,
  )).sort((a, b) => a.displayName.localeCompare(b.displayName) || a.bib.localeCompare(b.bib));
  return { ...index, updatedAt, participantCount: rows.length, rows };
}

export async function buildCanonicalParticipants(input: BuildCanonicalParticipantsInput): Promise<CanonicalParticipantBuildArtifacts> {
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  const participantVersion = input.participantVersion ?? 1;
  const snapshots: CanonicalAthleteSnapshot[] = [];
  const aliases: CanonicalAliasArtifact[] = [];
  const reverseIndexes: CanonicalParticipantBuildArtifacts['reverseIndexes'] = {};
  const seenParticipants = new Set<string>();
  const seenBibContest = new Set<string>();
  const bibCounts = new Map<string, number>();
  const contestByUuid = collectContestMap(input.course.contests);

  for (const source of input.participants) {
    const bib = normalizeBib(source.bib || source.participantUuid || source.providerParticipantUuid || '');
    if (bib) bibCounts.set(bib, (bibCounts.get(bib) || 0) + 1);
  }

  for (const source of input.participants) {
    const sourceParticipantUuid = String(source.participantUuid || '').trim();
    const providerParticipantUuid = String(source.providerParticipantUuid || sourceParticipantUuid).trim();
    const providerContestUuid = String(source.providerContestUuid || source.contestUuid || '').trim();
    const contestUuid = String(source.canonicalContestUuid || source.contestUuid || '').trim();
    const bib = normalizeBib(source.bib || sourceParticipantUuid || providerParticipantUuid);
    const participantUuid = authoritativeRaceParticipantUuid({ ...source, bib });
    if (!participantUuid || !providerParticipantUuid || !contestUuid || seenParticipants.has(participantUuid)) continue;
    const contest = resolveContest(contestByUuid, source.providerEventUuid, contestUuid);
    if (!contest) continue;
    const bibContestKey = `${String(source.providerEventUuid || '').trim()}:${providerContestUuid}:${bib}`;
    if (seenBibContest.has(bibContestKey)) continue;
    seenParticipants.add(participantUuid);
    seenBibContest.add(bibContestKey);

    const existing = input.existingSnapshots?.[participantUuid]
      ?? input.existingSnapshots?.[sourceParticipantUuid]
      ?? input.existingSnapshots?.[providerParticipantUuid];
    // A course rebuild is authoritative for both split keys and provider split
    // identities. Never carry a read into a newly repurposed checkpoint.
    const splitKeys = contest.splits.map((split) => split.key);
    const existingReadRows = Object.values(existing?.reads || {}).filter(
      (read): read is NonNullable<typeof read> => Boolean(read),
    );
    const reads = Object.fromEntries(contest.splits.map((split) => {
      // Canonical display keys can change during a mapping rebuild. Provider
      // split UUID is the stable identity and must be used before discarding a
      // previously accepted official result.
      const prior = existing?.reads?.[split.key]
        ?? existingReadRows.find((read) => read.providerSplitId === split.providerSplitId)
        ?? null;
      const compatible = !prior?.providerSplitId || prior.providerSplitId === split.providerSplitId;
      return [split.key, compatible ? prior : null];
    }));
    const genderKey = optionalText(source.gender) ? normalizeGenderKey(String(source.gender)) : null;
    const ageGroupKey = optionalText(source.ageGroup) ? normalizeAgeGroupKey(String(source.ageGroup)) : null;
    const splitRankings = Object.fromEntries(splitKeys.map((splitKey) => [
      splitKey,
      existing?.splitRankings?.[splitKey] ?? emptySplitRankings([splitKey])[splitKey],
    ]));
    const matchedBy = source.matchedBy ?? 'unmatched';
    const startConfiguration = normalizeStartConfiguration(contest.startConfiguration);
    const configuredOfficialStart = startConfiguration.mode === 'GUN'
      ? startConfiguration.gunStartTime
      : startConfiguration.mode === 'WAVE' ? optionalText(source.waveStartTime) : null;
    const initialStartTiming = configuredOfficialStart ? {
      ...emptyStartTimingState(),
      officialStartTime: configuredOfficialStart,
      startTimeSource: startConfiguration.mode,
      startTimeLocked: true,
      startStatus: Date.parse(updatedAt) >= Date.parse(configuredOfficialStart) ? 'START_WINDOW_OPEN' as const : 'NOT_STARTED' as const,
      updatedAt,
    } : emptyStartTimingState();
    const orphanedEffectiveStart = hasOrphanedEffectiveStart(reads, existing?.startTiming?.acceptedReadId);
    if (orphanedEffectiveStart) {
      for (const split of contest.splits) {
        if (split.isStart && reads[split.key]?.readId.endsWith(':effective-start')) reads[split.key] = null;
      }
    }
    const retainedStartTimingBase = orphanedEffectiveStart ? initialStartTiming : (existing?.startTiming ?? initialStartTiming);
    // Course configuration is the current official GUN/WAVE authority. Keep
    // accepted reader detection/audit fields, but never carry an obsolete
    // official start clock into a new canonical version.
    const retainedStartTiming = configuredOfficialStart
      ? {
          ...retainedStartTimingBase,
          officialStartTime: configuredOfficialStart,
          startTimeSource: startConfiguration.mode,
          startTimeLocked: true,
          updatedAt,
        }
      : retainedStartTimingBase;
    const timingVersion = resolveCanonicalSnapshotTimingVersion(existing, input.timingVersion);
    const snapshotBase: CanonicalAthleteSnapshot = {
      schemaVersion: CANONICAL_SCHEMA_VERSION,
      eventId: input.eventId,
      buildVersion: input.buildVersion,
      updatedAt,
      providerEventUuid: optionalText(source.providerEventUuid),
      contestUuid,
      providerContestUuid,
      canonicalContestUuid: contestUuid,
      courseVersion: contest.courseVersion,
      timingVersion,
      leaderboardVersion: existing?.leaderboardVersion ?? 0,
      identity: {
        participantUuid,
        providerParticipantUuid,
        chipCode: optionalText(source.chipCode),
        bib,
        displayName: normalizeDisplayName(source.displayName || bib),
        genderKey,
        ageGroupKey,
        dateOfBirth: optionalText(source.dateOfBirth),
        clubName: optionalText(source.clubName),
        countryCode: optionalText(source.countryCode)?.toUpperCase() ?? null,
        photoUrl: optionalText(source.photoUrl),
        trackingVisibility: ['ANONYMOUS', 'ANON', 'PRIVATE', 'OFFICIALS_ONLY', 'OFFICIALS ONLY'].includes(
          String(source.trackingVisibility || '').trim().toUpperCase(),
        ) ? 'ANONYMOUS' : 'PUBLIC',
        waveStartTime: optionalText(source.waveStartTime),
      },
      bergmanIdentity: {
        firebaseUid: optionalText(source.firebaseUid),
        bookingId: optionalText(source.bookingId),
        ticketId: optionalText(source.ticketId) ?? contest.bergmanTicketId,
        subCategoryId: optionalText(source.subCategoryId),
        registrationId: optionalText(source.registrationId),
        matched: matchedBy !== 'unmatched',
        matchedBy,
        profileUpdatedAt: optionalText(source.profileUpdatedAt),
      },
      raceState: existing?.raceState ?? {
        status: 'not_started',
        currentSectionKey: null,
        currentLegType: null,
        progressRatio: 0,
        distanceCompletedKm: 0,
        elapsedSeconds: null,
        lastReadAt: null,
      },
      reads,
      calculated: existing?.calculated ?? {
        swimSeconds: null,
        t1Seconds: null,
        bikeSeconds: null,
        t2Seconds: null,
        runSeconds: null,
        overallSeconds: null,
        averageSwimPaceSecondsPer100m: null,
        averageBikeSpeedKmh: null,
        averageRunPaceSecondsPerKm: null,
        averageRacePaceSecondsPerKm: null,
      },
      sections: [],
      splits: [],
      overallRanking: existing?.overallRanking ?? { overallRank: null, genderRank: null, ageGroupRank: null, clubRank: null },
      splitRankings,
      location: existing?.location ?? null,
      startTiming: retainedStartTiming,
      versions: {
        course: contest.courseVersion,
        participant: participantVersion,
        timing: timingVersion,
        profile: existing?.versions.profile ?? (source.firebaseUid ? 1 : 0),
        leaderboard: existing?.versions.leaderboard ?? 0,
      },
    };
    const snapshot = recalculateAthleteSnapshot(snapshotBase, contest, updatedAt);
    snapshots.push(snapshot);

    aliases.push(alias(versionedAthleteProviderAliasKey(input.eventId, input.buildVersion, providerParticipantUuid), input.eventId, input.buildVersion, updatedAt, 'provider', participantUuid));
    // A bib is only a safe public lookup key when it is unique across every
    // Feibot event merged into this Bergman event. Scoped participant/provider
    // aliases continue to route duplicate bibs to the correct contest.
    if ((bibCounts.get(bib) || 0) === 1) {
      aliases.push(alias(versionedAthleteBibAliasKey(input.eventId, input.buildVersion, bib), input.eventId, input.buildVersion, updatedAt, 'bib', participantUuid));
    }
    if (snapshot.bergmanIdentity.firebaseUid) {
      aliases.push(alias(versionedAthleteUidAliasKey(input.eventId, input.buildVersion, snapshot.bergmanIdentity.firebaseUid), input.eventId, input.buildVersion, updatedAt, 'uid', participantUuid));
      const refs = reverseIndexes[snapshot.bergmanIdentity.firebaseUid] ?? [];
      refs.push({ eventId: input.eventId, participantUuid, providerParticipantUuid, buildVersion: input.buildVersion });
      reverseIndexes[snapshot.bergmanIdentity.firebaseUid] = refs;
    }
    if (snapshot.bergmanIdentity.bookingId) {
      aliases.push(alias(versionedAthleteBookingAliasKey(input.eventId, input.buildVersion, snapshot.bergmanIdentity.bookingId), input.eventId, input.buildVersion, updatedAt, 'booking', participantUuid));
    }
    if (optionalText(source.email)) {
      const emailHash = await hashNormalizedEmail(String(source.email));
      aliases.push(alias(versionedAthleteEmailAliasKey(input.eventId, input.buildVersion, emailHash), input.eventId, input.buildVersion, updatedAt, 'email_hash', participantUuid));
    }
  }

  const rows = snapshots.map((snapshot) => {
    const contestName = contestByUuid.get(snapshot.contestUuid)?.displayName ?? snapshot.contestUuid;
    return buildIndexRow(snapshot, contestName);
  }).sort((a, b) => a.displayName.localeCompare(b.displayName) || a.bib.localeCompare(b.bib));

  return {
    index: {
      schemaVersion: CANONICAL_SCHEMA_VERSION,
      eventId: input.eventId,
      buildVersion: input.buildVersion,
      updatedAt,
      participantCount: rows.length,
      rows,
    },
    snapshots,
    aliases,
    reverseIndexes,
  };
}

export async function writeCanonicalParticipantArtifacts(
  store: CanonicalKvStore,
  artifacts: CanonicalParticipantBuildArtifacts,
): Promise<CanonicalParticipantWriteResult> {
  let writes = 0;
  let skipped = 0;
  const track = async (key: string, value: unknown) => {
    if (await writeJsonIfChanged(store, key, value)) writes += 1;
    else skipped += 1;
  };

  // The version-pinned snapshot is the canonical athlete. Keeping a second
  // mutable copy makes timing and identity drift independently.
  // Large REST-backed KV builds can outlive the adapter's read-your-write
  // window. Verify bounded batches while their successful PUTs are still
  // locally authoritative, and keep the participant index publish-last.
  let verifiedSnapshotCount = 0;
  let missingSnapshotCount = 0;
  for (const snapshots of chunksOf(artifacts.snapshots, SNAPSHOT_VERIFICATION_BATCH_SIZE)) {
    const snapshotWrites = snapshots.map((snapshot) => ({
      key: versionedAthleteSnapshotKey(snapshot.eventId, snapshot.buildVersion, snapshot.identity.participantUuid),
      value: snapshot,
    }));
    await withLimitedConcurrency(snapshotWrites, PARTICIPANT_WRITE_CONCURRENCY, async ({ key, value }) => {
      await track(key, value);
    });
    const verification = await verifyPersistedKeys(
      store,
      snapshots.map((snapshot) => versionedAthleteSnapshotKey(
        snapshot.eventId,
        snapshot.buildVersion,
        snapshot.identity.participantUuid,
      )),
    );
    verifiedSnapshotCount += verification.verified;
    missingSnapshotCount += verification.missing.length;
    if (verification.missing.length > 0) {
      throw new Error(`Canonical snapshot verification failed: ${missingSnapshotCount} snapshot(s) missing.`);
    }
  }

  let verifiedAliasCount = 0;
  let missingAliasCount = 0;
  for (const aliases of chunksOf(artifacts.aliases, ALIAS_VERIFICATION_BATCH_SIZE)) {
    await withLimitedConcurrency(aliases, PARTICIPANT_WRITE_CONCURRENCY, async (artifact) => {
      await track(artifact.key, artifact.value);
    });
    const verification = await verifyPersistedKeys(
      store,
      aliases.map((artifact) => artifact.key),
    );
    verifiedAliasCount += verification.verified;
    missingAliasCount += verification.missing.length;
    if (verification.missing.length > 0) {
      throw new Error(`Canonical alias verification failed: ${missingAliasCount} alias(es) missing.`);
    }
  }

  const reverseIndexWrites = Object.entries(artifacts.reverseIndexes).map(([uid, references]) => ({
    key: versionedUserAthletesReverseIndexKey(uid, artifacts.index.buildVersion),
    value: references,
  }));
  await withLimitedConcurrency(reverseIndexWrites, PARTICIPANT_WRITE_CONCURRENCY, async ({ key, value }) => {
    await track(key, value);
  });

  await track(versionedParticipantIndexKey(artifacts.index.eventId, artifacts.index.buildVersion), artifacts.index);
  return {
    indexKey: versionedParticipantIndexKey(artifacts.index.eventId, artifacts.index.buildVersion),
    snapshotCount: artifacts.snapshots.length,
    aliasCount: artifacts.aliases.length,
    reverseIndexCount: Object.keys(artifacts.reverseIndexes).length,
    writes,
    skipped,
    verifiedSnapshotCount,
    missingSnapshotCount,
    verifiedAliasCount,
    missingAliasCount,
  };
}
