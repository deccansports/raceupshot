import {
  CANONICAL_SCHEMA_VERSION,
  type CanonicalAthleteSnapshot,
  type CanonicalBuildManifest,
  type CanonicalCourseBundle,
  type CanonicalEventManifest,
  type CanonicalLeaderboardBuildArtifacts,
  type CanonicalParticipantSource,
  type CanonicalValidationIssue,
  type CanonicalValidationResult,
} from './contracts';
import { buildCanonicalLeaderboards, writeCanonicalLeaderboardArtifacts } from './leaderboards';
import { buildCanonicalParticipants, updateCanonicalParticipantIndex, writeCanonicalParticipantArtifacts } from './participant-builder';
import { versionedCourseKey } from './storage-keys';
import {
  type CanonicalKvStore,
  publishManifest,
  writeBuildSummary,
  watchdogStaleCanonicalBuild,
  writeCanonicalBuildCandidate,
  writeBuildStatus,
  writeBuildValidation,
  writeJsonIfChanged,
} from './versioning';

export interface CanonicalCompleteBuildInput {
  store: CanonicalKvStore;
  eventId: string;
  buildVersion: string;
  course: CanonicalCourseBundle;
  participants: CanonicalParticipantSource[];
  existingSnapshots?: Record<string, CanonicalAthleteSnapshot | undefined>;
  source: CanonicalBuildManifest['source'];
  provider?: CanonicalEventManifest['provider'];
  eventName?: string;
  status?: CanonicalEventManifest['status'];
  participantVersion?: number;
  timingVersion?: number;
  leaderboardVersion?: number;
  updatedAt?: string;
}

export interface CanonicalCompleteBuildResult {
  published: boolean;
  manifest: CanonicalEventManifest | null;
  validation: CanonicalValidationResult;
  counts: {
    participants: number;
    snapshots: number;
    participantIndexCount: number;
    athleteSnapshotCount: number;
    missingSnapshotCount: number;
    aliases: number;
    aliasCounts: { provider: number; bib: number; uid: number; booking: number; emailHash: number };
    leaderboards: number;
    splitLeaderboards: number;
    splitSummaries: number;
  };
}

function validationIssue(eventId: string, code: string, message: string, path?: string): CanonicalValidationIssue {
  return { severity: 'error', eventId, code, message, path };
}

function sourceContestKey(providerEventUuid: string | null | undefined, contestUuid: string | null | undefined): string {
  return `${String(providerEventUuid || '').trim()}:${String(contestUuid || '').trim()}`;
}

function findSourceContest(course: CanonicalCourseBundle, providerEventUuid: string | null | undefined, contestUuid: string) {
  return course.contests.find((contest) => (
    contest.providerContestUuid === contestUuid
    && (!contest.providerEventUuid || contest.providerEventUuid === providerEventUuid)
  ));
}

export function validateCanonicalCompleteBuild(params: {
  eventId: string;
  buildVersion: string;
  updatedAt: string;
  course: CanonicalCourseBundle;
  sourceParticipants: CanonicalParticipantSource[];
  snapshots: CanonicalAthleteSnapshot[];
  indexCount: number;
  aliasCount: number;
  overallContestUuids: string[];
  splitSummaryContestUuids: string[];
  leaderboardManifestContestUuids: string[];
  leaderboardArtifacts?: CanonicalLeaderboardBuildArtifacts;
  timingVersion?: number;
}): CanonicalValidationResult {
  const errors = [...params.course.validation.errors];
  const warnings = [...params.course.validation.warnings];
  if (params.snapshots.length === 0 && params.sourceParticipants.length > 0) errors.push(validationIssue(params.eventId, 'no_athlete_snapshots', 'No canonical athlete snapshots were built.', 'snapshots'));
  if (params.snapshots.length !== params.sourceParticipants.length) errors.push(validationIssue(params.eventId, 'source_snapshot_count_mismatch', `Source participant count ${params.sourceParticipants.length} does not match snapshot count ${params.snapshots.length}. Unresolved or duplicate participants cannot be published.`, 'snapshots'));
  const publishedProviders = new Set(params.snapshots.map((snapshot) => (
    `${snapshot.providerEventUuid || ''}:${snapshot.identity.providerParticipantUuid}`
  )));
  for (const participant of params.sourceParticipants) {
    if (publishedProviders.has(`${participant.providerEventUuid || ''}:${participant.providerParticipantUuid}`)) continue;
    errors.push({
      severity: 'error',
      eventId: params.eventId,
      contestUuid: participant.contestUuid,
      providerId: participant.providerParticipantUuid,
      code: 'participant_contest_unresolved',
      message: `Participant ${participant.providerParticipantUuid} is timing_under_review because source-scoped contest ${sourceContestKey(participant.providerEventUuid, participant.contestUuid || '(missing)')} could not be resolved exactly.`,
      path: `participants.${participant.providerParticipantUuid}.contestUuid`,
    });
  }
  if (params.snapshots.length !== params.indexCount) errors.push(validationIssue(params.eventId, 'participant_index_count_mismatch', `Participant index count ${params.indexCount} does not match snapshot count ${params.snapshots.length}.`, 'participant:index'));
  if (params.aliasCount < params.snapshots.length * 2) errors.push(validationIssue(params.eventId, 'alias_count_too_low', 'Each snapshot requires at least provider and bib aliases.', 'aliases'));
  for (const snapshot of params.snapshots) {
    if (snapshot.eventId !== params.eventId) errors.push(validationIssue(params.eventId, 'snapshot_event_scope_mismatch', `Athlete snapshot ${snapshot.identity.participantUuid} belongs to ${snapshot.eventId}.`, `athlete:${snapshot.identity.participantUuid}.eventId`));
    if (!snapshot.identity.providerParticipantUuid) errors.push(validationIssue(params.eventId, 'snapshot_provider_uuid_missing', 'Athlete snapshot has no provider UUID.', `athlete:${snapshot.identity.participantUuid}`));
    if (!findSourceContest(params.course, snapshot.providerEventUuid, snapshot.contestUuid)) errors.push(validationIssue(params.eventId, 'snapshot_contest_unmapped', `Athlete ${snapshot.identity.providerParticipantUuid} has an unmapped source-scoped contest.`, `athlete:${snapshot.identity.providerParticipantUuid}.contestUuid`));
    if (snapshot.timingVersion !== snapshot.versions.timing) {
      errors.push(validationIssue(params.eventId, 'CANONICAL_TIMING_VERSION_MISMATCH', `Athlete ${snapshot.identity.participantUuid} exposes timingVersion ${snapshot.timingVersion} but versions.timing is ${snapshot.versions.timing}.`, `athlete:${snapshot.identity.participantUuid}.timingVersion`));
    }
    if (params.timingVersion !== undefined && snapshot.timingVersion < params.timingVersion) {
      errors.push(validationIssue(params.eventId, 'CANONICAL_TIMING_VERSION_REGRESSION', `Athlete ${snapshot.identity.participantUuid} has timingVersion ${snapshot.timingVersion}, older than build timingVersion ${params.timingVersion}.`, `athlete:${snapshot.identity.participantUuid}.timingVersion`));
    }
    const contest = findSourceContest(params.course, snapshot.providerEventUuid, snapshot.contestUuid);
    for (const split of contest?.splits ?? []) {
      const read = snapshot.reads?.[split.key] ?? null;
      const row = snapshot.splits?.find((entry) => entry.splitKey === split.key) ?? null;
      const readAccepted = Boolean(read && ['valid', 'confirmed', 'corrected', 'official', 'manual_corrected'].includes(String(read.status || '').trim().toLowerCase()));
      const rowCompleted = Boolean(row && ['valid', 'confirmed', 'corrected', 'official', 'manual_corrected', 'completed'].includes(String(row.status || '').trim().toLowerCase()));
      if (rowCompleted && !readAccepted) {
        errors.push(validationIssue(params.eventId, 'CANONICAL_ACCEPTED_READ_MISSING_FROM_SNAPSHOT', `Split ${split.key} is completed for ${snapshot.identity.participantUuid}, but its accepted canonical read is missing.`, `athlete:${snapshot.identity.participantUuid}.reads.${split.key}`));
      }
      if (readAccepted && !rowCompleted) {
        errors.push(validationIssue(params.eventId, 'CANONICAL_SPLIT_ATHLETE_STATE_MISMATCH', `Accepted read ${split.key} for ${snapshot.identity.participantUuid} is not reflected in the athlete split state.`, `athlete:${snapshot.identity.participantUuid}.splits.${split.key}`));
      }
    }
  }
  for (const contest of params.course.contests) {
    if (!params.overallContestUuids.includes(contest.providerContestUuid)) errors.push(validationIssue(params.eventId, 'overall_leaderboard_missing', `Overall leaderboard is missing for ${contest.providerContestUuid}.`, `leaderboard:${contest.providerContestUuid}:overall`));
    if (!params.splitSummaryContestUuids.includes(contest.providerContestUuid)) errors.push(validationIssue(params.eventId, 'split_summary_missing', `Split summary is missing for ${contest.providerContestUuid}.`, `split-summary:${contest.providerContestUuid}`));
    if (!params.leaderboardManifestContestUuids.includes(contest.providerContestUuid)) errors.push(validationIssue(params.eventId, 'leaderboard_manifest_missing', `Leaderboard manifest is missing for ${contest.providerContestUuid}.`, `leaderboard-manifest:${contest.providerContestUuid}`));
  }
  const snapshotsByParticipant = new Map(params.snapshots.map((snapshot) => [snapshot.identity.participantUuid, snapshot]));
  const derivedBoards = [
    ...(params.leaderboardArtifacts?.leaderboards ?? []),
    ...(params.leaderboardArtifacts?.splitLeaderboards ?? []),
  ];
  for (const board of derivedBoards) {
    if (board.buildVersion !== params.buildVersion) {
      errors.push(validationIssue(params.eventId, 'derived_build_version_mismatch', `Derived ${board.leaderboardType} leaderboard ${board.contestUuid} was built from ${board.buildVersion}, expected ${params.buildVersion}.`, `leaderboard:${board.contestUuid}`));
    }
    for (const row of board.entries) {
      const snapshot = snapshotsByParticipant.get(row.participantUuid);
      if (!snapshot) {
        errors.push(validationIssue(params.eventId, 'leaderboard_snapshot_missing', `Leaderboard row ${row.participantUuid} has no athlete snapshot in this build.`, `leaderboard:${board.contestUuid}.entries`));
        continue;
      }
      const resolved = snapshot.raceState.resolved;
      const expectedOrder = resolved?.lastCompletedSplit?.order
        ?? findSourceContest(params.course, snapshot.providerEventUuid, snapshot.contestUuid)?.splits.find((split) => split.key === row.lastSplitKey)?.order
        ?? -1;
      const expectedKey = resolved?.lastCompletedSplit?.splitKey ?? row.lastSplitKey;
      if (row.lastSplitOrder !== expectedOrder || row.lastSplitKey !== expectedKey) {
        errors.push(validationIssue(
          params.eventId,
          'canonical_current_state_mismatch',
          `Leaderboard current state for ${row.participantUuid} is ${row.lastSplitKey ?? 'none'}/${row.lastSplitOrder}, athlete snapshot is ${expectedKey ?? 'none'}/${expectedOrder}.`,
          `leaderboard:${board.contestUuid}.entries.${row.participantUuid}`,
        ));
      }
      if (row.stateFingerprint && row.stateFingerprint !== (params.leaderboardArtifacts?.snapshots.find((entry) => entry.identity.participantUuid === row.participantUuid)
        ? [snapshot.identity.participantUuid, snapshot.raceState.status, snapshot.raceState.currentLegType ?? '', expectedKey ?? '', expectedOrder, snapshot.raceState.distanceCompletedKm, snapshot.raceState.resolved?.finishAt ?? ''].join('|')
        : row.stateFingerprint)) {
        errors.push(validationIssue(params.eventId, 'canonical_state_fingerprint_mismatch', `Leaderboard fingerprint for ${row.participantUuid} does not match its athlete snapshot.`, `leaderboard:${board.contestUuid}.entries.${row.participantUuid}.stateFingerprint`));
      }
    }
  }
  return {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    eventId: params.eventId,
    buildVersion: params.buildVersion,
    updatedAt: params.updatedAt,
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export async function buildAndPublishCanonicalEventVersion(input: CanonicalCompleteBuildInput): Promise<CanonicalCompleteBuildResult> {
  if (input.course.eventId !== input.eventId) {
    throw new Error(`Canonical course event mismatch: expected=${input.eventId}, actual=${input.course.eventId}`);
  }
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  const participantVersion = input.participantVersion ?? 1;
  const leaderboardVersion = input.leaderboardVersion ?? 1;
  await watchdogStaleCanonicalBuild(input.store, input.eventId, new Date(updatedAt));
  await writeCanonicalBuildCandidate(input.store, input.eventId, input.buildVersion, updatedAt);
  await writeJsonIfChanged(input.store, versionedCourseKey(input.eventId, input.buildVersion), input.course);
  await writeBuildStatus(input.store, {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    eventId: input.eventId,
    buildVersion: input.buildVersion,
    updatedAt,
    status: 'building',
    provider: input.provider ?? 'feibot',
    source: input.source,
    startedAt: updatedAt,
    completedAt: null,
    artifactKeys: [versionedCourseKey(input.eventId, input.buildVersion)],
  });

  try {
  let participants = await buildCanonicalParticipants({
    eventId: input.eventId,
    buildVersion: input.buildVersion,
    course: input.course,
    participants: input.participants,
    existingSnapshots: input.existingSnapshots,
    participantVersion,
    timingVersion: input.timingVersion,
    updatedAt,
  });
  const leaderboardArtifacts = buildCanonicalLeaderboards({
    eventId: input.eventId,
    buildVersion: input.buildVersion,
    course: input.course,
    snapshots: participants.snapshots,
    leaderboardVersion,
    updatedAt,
  });
  participants = updateCanonicalParticipantIndex(participants, input.course, leaderboardArtifacts.snapshots, updatedAt);
  const participantWrite = await writeCanonicalParticipantArtifacts(input.store, participants);
  await writeCanonicalLeaderboardArtifacts(input.store, leaderboardArtifacts);

  await writeBuildStatus(input.store, {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    eventId: input.eventId,
    buildVersion: input.buildVersion,
    updatedAt,
    status: 'validating',
    provider: input.provider ?? 'feibot',
    source: input.source,
    startedAt: updatedAt,
    completedAt: null,
    artifactKeys: [versionedCourseKey(input.eventId, input.buildVersion), participantWrite.indexKey],
  });

  const validation = validateCanonicalCompleteBuild({
    eventId: input.eventId,
    buildVersion: input.buildVersion,
    updatedAt,
    course: input.course,
    sourceParticipants: input.participants,
    snapshots: participants.snapshots,
    indexCount: participants.index.participantCount,
    aliasCount: participants.aliases.length,
    overallContestUuids: leaderboardArtifacts.leaderboards.filter((board) => board.mode === 'overall').map((board) => board.contestUuid),
    splitSummaryContestUuids: leaderboardArtifacts.splitSummaries.map((summary) => summary.contestUuid),
    leaderboardManifestContestUuids: leaderboardArtifacts.manifests.map((manifest) => manifest.contestUuid),
    leaderboardArtifacts,
    timingVersion: input.timingVersion,
  });
  // Participant/profile synchronization is allowed to update identity but is
  // monotonic with respect to accepted timing. Refuse to publish a candidate
  // version if a read that still maps to the same provider split disappeared.
  for (const snapshot of participants.snapshots) {
    const existing = input.existingSnapshots?.[snapshot.identity.participantUuid]
      ?? input.existingSnapshots?.[snapshot.identity.providerParticipantUuid];
    if (!existing) continue;
    const contest = findSourceContest(input.course, snapshot.providerEventUuid, snapshot.contestUuid);
    if (!contest) continue;
    const compatibleReadKeys = Object.entries(existing.reads || {}).flatMap(([splitKey, read]) => {
      if (!read) return [];
      const configuredSplit = contest.splits.find((split) => split.key === splitKey);
      if (!configuredSplit) return [];
      if (read.providerSplitId && configuredSplit.providerSplitId !== read.providerSplitId) return [];
      return [splitKey];
    });
    const lostReadKeys = compatibleReadKeys.filter((splitKey) => !snapshot.reads?.[splitKey]);
    if (lostReadKeys.length > 0) {
      validation.errors.push(validationIssue(
        input.eventId,
        'participant_sync_timing_regression',
        `Participant sync would erase ${lostReadKeys.length} accepted timing read(s) for ${snapshot.identity.participantUuid}: ${lostReadKeys.join(', ')}.`,
        `athlete:${snapshot.identity.participantUuid}.reads`,
      ));
    }
    const priorAcceptedStartId = existing.startTiming?.acceptedReadId;
    if (priorAcceptedStartId && snapshot.startTiming?.acceptedReadId !== priorAcceptedStartId) {
      validation.errors.push(validationIssue(
        input.eventId,
        'participant_sync_start_regression',
        `Participant sync would replace the accepted START for ${snapshot.identity.participantUuid}.`,
        `athlete:${snapshot.identity.participantUuid}.startTiming`,
      ));
    }
  }
  if (participantWrite.missingSnapshotCount > 0) validation.errors.push(validationIssue(input.eventId, 'snapshot_readback_failed', `${participantWrite.missingSnapshotCount} athlete snapshot(s) failed read-back verification.`, 'snapshots'));
  if (participantWrite.missingAliasCount > 0) validation.errors.push(validationIssue(input.eventId, 'alias_readback_failed', `${participantWrite.missingAliasCount} alias(es) failed read-back verification.`, 'aliases'));
  validation.valid = validation.errors.length === 0;
  await writeBuildValidation(input.store, validation);
  const participantSourceByProviderUuid = new Map(input.participants.map((participant) => [
    participant.providerParticipantUuid,
    participant.providerEventUuid || '',
  ]));
  const published = await publishManifest(input.store, {
    eventId: input.eventId,
    buildVersion: input.buildVersion,
    provider: input.provider ?? 'feibot',
    source: input.source,
    courseVersion: input.course.courseVersion,
    participantVersion,
    timingVersion: input.timingVersion ?? 0,
    leaderboardVersion,
    validation,
    publishedAt: updatedAt,
    eventName: input.eventName,
    timezone: input.course.timezone,
    status: input.status,
    participantCount: participants.index.participantCount,
    contestMappings: Object.fromEntries(input.course.contests.map((contest) => [contest.providerContestUuid, { bergmanTicketId: contest.bergmanTicketId, name: contest.displayName }])),
    completeBuildValid: validation.valid,
    startedAt: updatedAt,
    expectedParticipants: input.participants.length,
    writtenParticipants: participantWrite.verifiedSnapshotCount,
    expectedContests: input.course.contests.length,
    writtenContests: input.course.contests.length,
    unresolvedContests: new Set(validation.errors
      .filter((issue) => issue.code === 'participant_contest_unresolved')
      .map((issue) => `${participantSourceByProviderUuid.get(issue.providerId || '') || ''}:${issue.contestUuid || ''}`)).size,
  });
  return {
    published: published.published,
    manifest: published.manifest,
    validation,
    counts: {
      participants: participants.index.participantCount,
      snapshots: participants.snapshots.length,
      participantIndexCount: participants.index.participantCount,
      athleteSnapshotCount: participantWrite.verifiedSnapshotCount,
      missingSnapshotCount: participantWrite.missingSnapshotCount,
      aliases: participants.aliases.length,
      aliasCounts: {
        provider: participants.aliases.filter((entry) => entry.value.aliasType === 'provider').length,
        bib: participants.aliases.filter((entry) => entry.value.aliasType === 'bib').length,
        uid: participants.aliases.filter((entry) => entry.value.aliasType === 'uid').length,
        booking: participants.aliases.filter((entry) => entry.value.aliasType === 'booking').length,
        emailHash: participants.aliases.filter((entry) => entry.value.aliasType === 'email_hash').length,
      },
      leaderboards: leaderboardArtifacts.leaderboards.length,
      splitLeaderboards: leaderboardArtifacts.splitLeaderboards.length,
      splitSummaries: leaderboardArtifacts.splitSummaries.length,
    },
  };
  } catch (error) {
    const failedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : String(error);
    await writeBuildStatus(input.store, {
      schemaVersion: CANONICAL_SCHEMA_VERSION,
      eventId: input.eventId,
      buildVersion: input.buildVersion,
      updatedAt: failedAt,
      status: 'failed',
      provider: input.provider ?? 'feibot',
      source: input.source,
      startedAt: updatedAt,
      completedAt: failedAt,
      artifactKeys: [versionedCourseKey(input.eventId, input.buildVersion)],
      error: message.slice(0, 500),
    });
    await writeBuildSummary(input.store, {
      schemaVersion: CANONICAL_SCHEMA_VERSION,
      eventId: input.eventId,
      buildVersion: input.buildVersion,
      version: input.buildVersion,
      updatedAt: failedAt,
      startedAt: updatedAt,
      completedAt: failedAt,
      status: 'failed',
      expectedParticipants: input.participants.length,
      writtenParticipants: 0,
      expectedContests: input.course.contests.length,
      writtenContests: input.course.contests.length,
      unresolvedContests: 0,
      fatalErrors: 1,
      warnings: 0,
      valid: false,
      publishable: false,
      active: false,
    });
    throw error;
  }
}
