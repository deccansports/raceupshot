import {
  CANONICAL_SCHEMA_VERSION,
  type CanonicalAthleteSnapshot,
  type CanonicalCourseBundle,
  type CanonicalParticipantSource,
} from './contracts';
import { buildCanonicalLeaderboards } from './leaderboards';
import { buildCanonicalParticipants } from './participant-builder';
import {
  canonicalIncrementalScopedContestKey,
  canonicalIncrementalEventKey,
  canonicalIncrementalLeaderboardKey,
  canonicalIncrementalParticipantKey,
  canonicalIncrementalParticipantRoutingKey,
} from './storage-keys';
import type { CanonicalKvStore } from './versioning';
import { writeJsonIfChanged } from './versioning';

export interface IncrementalCanonicalManifest {
  schemaVersion: typeof CANONICAL_SCHEMA_VERSION;
  eventId: string;
  provider: 'feibot' | 'manual';
  buildVersion: string;
  updatedAt: string;
  /** This records a granular live build, never a reconciliation guarantee. */
  completeBuildValid: false;
  contests: Array<{
    contestUuid: string;
    providerEventUuid: string | null;
    updatedAt: string;
    courseVersion: number;
    participantCount: number;
  }>;
}

export interface PublishIncrementalCanonicalInput {
  store: CanonicalKvStore;
  eventId: string;
  buildVersion: string;
  course: CanonicalCourseBundle;
  participants: CanonicalParticipantSource[];
  existingSnapshots?: Record<string, CanonicalAthleteSnapshot | undefined>;
  participantVersion?: number;
  timingVersion?: number;
  leaderboardVersion?: number;
  /** Leaderboards are an explicit derived projection, never an ingestion prerequisite. */
  publishLeaderboards?: boolean;
  onProgress?: (progress: {
    sourceCount: number;
    processed: number;
    canonicalAvailable: number;
    changed: number;
    unchanged: number;
    failed: number;
    lastCanonicalWriteAt: string | null;
  }) => Promise<void> | void;
  updatedAt?: string;
}

export interface PublishIncrementalCanonicalResult {
  manifest: IncrementalCanonicalManifest;
  changed: { event: boolean; contests: number; participants: number; leaderboards: number };
}

interface ParticipantRoutingRecord {
  contestUuid: string;
  providerContestUuid?: string;
  participantId: string;
  updatedAt: string;
}

function participantStableId(snapshot: CanonicalAthleteSnapshot): string {
  // Provider UUID is preferred. The fallback remains stable across repeated
  // Feibot reads for providers that omit it, while keeping identical bibs in
  // different contests or provider events isolated.
  return snapshot.identity.bib || snapshot.identity.providerParticipantUuid || snapshot.identity.participantUuid;
}

function parseManifest(value: string | null, eventId: string): IncrementalCanonicalManifest | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as IncrementalCanonicalManifest;
    return parsed.eventId === eventId && Array.isArray(parsed.contests) ? parsed : null;
  } catch {
    return null;
  }
}

function withoutVolatilePublicationFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutVolatilePublicationFields);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== 'updatedAt' && key !== 'buildVersion' && key !== 'leaderboardVersion')
      .map(([key, item]) => [key, withoutVolatilePublicationFields(item)]),
  );
}

async function writeIfMateriallyChanged(store: CanonicalKvStore, key: string, value: unknown): Promise<boolean> {
  const previous = await store.get(key);
  if (previous) {
    try {
      if (JSON.stringify(withoutVolatilePublicationFields(JSON.parse(previous))) === JSON.stringify(withoutVolatilePublicationFields(value))) {
        return false;
      }
    } catch {
      // A malformed old record is replaced by the newly normalized one.
    }
  }
  return writeJsonIfChanged(store, key, value);
}

/**
 * Publishes the Feibot fast path as independently mutable records. It never
 * touches the versioned canonical manifest, so an incomplete provider scope
 * cannot masquerade as a reconciled full event build.
 */
export async function publishIncrementalCanonical(input: PublishIncrementalCanonicalInput): Promise<PublishIncrementalCanonicalResult> {
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  const sourceByIdentity = new Map<string, CanonicalParticipantSource>();
  for (const source of input.participants) {
    const providerContestUuid = source.providerContestUuid || source.contestUuid;
    const identity = `${source.providerEventUuid || 'unknown'}:${providerContestUuid}:${source.bib}`;
    if (source.providerEventUuid && providerContestUuid && source.bib) sourceByIdentity.set(identity, source);
  }
  const deduplicatedParticipants = sourceByIdentity.size > 0
    ? [...sourceByIdentity.values()]
    : input.participants;
  const participants = await buildCanonicalParticipants({
    eventId: input.eventId,
    buildVersion: input.buildVersion,
    course: input.course,
    participants: deduplicatedParticipants,
    existingSnapshots: input.existingSnapshots,
    participantVersion: input.participantVersion,
    timingVersion: input.timingVersion,
    updatedAt,
  });
  const manifestKey = canonicalIncrementalEventKey(input.eventId);
  const previous = parseManifest(await input.store.get(manifestKey), input.eventId);
  const contestStates = new Map(previous?.contests.map((contest) => [contest.contestUuid, contest]) ?? []);
  let contestsChanged = 0;
  let participantsChanged = 0;
  let leaderboardsChanged = 0;
  const startedAt = Date.now();
  console.info('[CANONICAL INCREMENTAL][SYNC START]', {
    eventId: input.eventId,
    sourceCount: input.participants.length,
    canonicalAvailableCount: 0,
  });

  for (const contest of input.course.contests) {
    const contestSnapshots = participants.snapshots.filter((snapshot) => snapshot.contestUuid === contest.providerContestUuid);
    const providerEventUuid = contest.providerEventUuid
      ?? contestSnapshots.find((snapshot) => snapshot.providerEventUuid)?.providerEventUuid
      ?? null;
    if (!providerEventUuid) continue;
    if (await writeIfMateriallyChanged(input.store, canonicalIncrementalScopedContestKey(input.eventId, providerEventUuid, contest.providerContestUuid), {
      schemaVersion: CANONICAL_SCHEMA_VERSION,
      eventId: input.eventId,
      buildVersion: input.buildVersion,
      updatedAt,
      providerEventUuid,
      contest,
    })) contestsChanged += 1;
    contestStates.set(contest.providerContestUuid, {
      contestUuid: contest.providerContestUuid,
      providerEventUuid,
      updatedAt,
      courseVersion: contest.courseVersion,
      participantCount: contestSnapshots.length,
    });
  }

  for (const [snapshotIndex, snapshot] of participants.snapshots.entries()) {
    const providerEventUuid = snapshot.providerEventUuid || 'unknown';
    const participantId = participantStableId(snapshot);
    const participantKey = canonicalIncrementalParticipantKey(
      input.eventId,
      providerEventUuid,
      snapshot.contestUuid,
      participantId,
    );
    const routingKey = canonicalIncrementalParticipantRoutingKey(
      input.eventId,
      providerEventUuid,
      snapshot.identity.providerParticipantUuid,
    );
    const previousRouting = await input.store.get(routingKey).then((value) => {
      try { return value ? JSON.parse(value) as ParticipantRoutingRecord : null; } catch { return null; }
    });
    if (previousRouting && (previousRouting.contestUuid !== snapshot.contestUuid || previousRouting.participantId !== participantId)) {
      await writeJsonIfChanged(input.store, canonicalIncrementalParticipantKey(
        input.eventId,
        providerEventUuid,
        previousRouting.contestUuid,
        previousRouting.participantId,
      ), {
        schemaVersion: CANONICAL_SCHEMA_VERSION,
        eventId: input.eventId,
        invalidatedAt: updatedAt,
        invalidatedReason: 'participant_contest_changed',
        replacedBy: participantKey,
      });
    }
    if (await writeIfMateriallyChanged(input.store, participantKey, {
      ...snapshot,
      providerIdentityKey: `${providerEventUuid}:${snapshot.providerContestUuid || snapshot.contestUuid}:${snapshot.identity.bib}`,
      canonicalIdentityKey: `${providerEventUuid}:${snapshot.contestUuid}:${participantId}`,
    })) participantsChanged += 1;
    await writeJsonIfChanged(input.store, routingKey, {
      contestUuid: snapshot.contestUuid,
      providerContestUuid: snapshot.providerContestUuid || snapshot.contestUuid,
      participantId,
      updatedAt,
    } satisfies ParticipantRoutingRecord);
    const canonicalAvailableCount = snapshotIndex + 1;
    if (canonicalAvailableCount === 1 || canonicalAvailableCount % 25 === 0 || canonicalAvailableCount === participants.snapshots.length) {
      await input.onProgress?.({
        sourceCount: input.participants.length,
        processed: canonicalAvailableCount,
        canonicalAvailable: canonicalAvailableCount,
        changed: participantsChanged,
        unchanged: canonicalAvailableCount - participantsChanged,
        failed: 0,
        lastCanonicalWriteAt: participantsChanged > 0 ? updatedAt : null,
      });
      console.info('[CANONICAL INCREMENTAL][PROGRESS]', {
        eventId: input.eventId,
        elapsedMs: Date.now() - startedAt,
        canonicalAvailableCount,
        sourceCount: input.participants.length,
      });
    }
  }

  if (input.publishLeaderboards === true && participantsChanged > 0) {
    const leaderboards = buildCanonicalLeaderboards({
      eventId: input.eventId, buildVersion: input.buildVersion, course: input.course,
      snapshots: participants.snapshots, leaderboardVersion: input.leaderboardVersion, updatedAt,
    });
    for (const board of leaderboards.leaderboards.filter((entry) => entry.mode === 'overall')) {
      if (await writeIfMateriallyChanged(input.store, canonicalIncrementalLeaderboardKey(input.eventId, board.contestUuid), board)) leaderboardsChanged += 1;
    }
  }

  const manifest: IncrementalCanonicalManifest = {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    eventId: input.eventId,
    provider: input.course.provider,
    buildVersion: input.buildVersion,
    updatedAt,
    completeBuildValid: false,
    contests: [...contestStates.values()].sort((left, right) => left.contestUuid.localeCompare(right.contestUuid)),
  };
  const hasMaterialChange = contestsChanged > 0 || participantsChanged > 0 || leaderboardsChanged > 0 || !previous;
  const eventChanged = hasMaterialChange && await writeJsonIfChanged(input.store, manifestKey, manifest);
  console.info('[CANONICAL INCREMENTAL][SYNC COMPLETE]', {
    eventId: input.eventId,
    sourceCount: input.participants.length,
    canonicalAvailableCount: participants.snapshots.length,
    changedAthletes: participantsChanged,
    unchangedSkipped: participants.snapshots.length - participantsChanged,
    elapsedMs: Date.now() - startedAt,
  });
  return {
    manifest: eventChanged ? manifest : previous!,
    changed: { event: Boolean(eventChanged), contests: contestsChanged, participants: participantsChanged, leaderboards: leaderboardsChanged },
  };
}
