import type { CanonicalRankingMode } from './contracts';
import { normalizeBib, normalizeContestUuid, normalizeParticipantUuid } from './identity';

const ACTIVE_PREFIX = 'live:event';

function safeSegment(value: string, field: string, lowercase = false): string {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) throw new TypeError(`${field} must not be empty.`);
  const normalized = lowercase ? trimmed.toLocaleLowerCase('en-US') : trimmed;
  return encodeURIComponent(normalized).replace(/%2F/gi, '%252F');
}

function eventPrefix(eventId: string): string {
  return `${ACTIVE_PREFIX}:${safeSegment(eventId, 'eventId')}`;
}

function versionPrefix(eventId: string, version: string): string {
  return `${eventPrefix(eventId)}:v:${safeSegment(version, 'version')}`;
}

export function eventManifestKey(eventId: string): string {
  return `${eventPrefix(eventId)}:manifest`;
}

export function activeVersionKey(eventId: string): string {
  return `${eventPrefix(eventId)}:activeVersion`;
}

/**
 * Mutable, entity-level canonical records used by the race-day fast path.
 *
 * These deliberately do not live below a version prefix: a timing read must
 * be able to replace one athlete or leaderboard shard without republishing a
 * complete event version. Immutable `v:*` artifacts remain the recovery and
 * bootstrap snapshot format.
 */
export function canonicalIncrementalEventKey(eventId: string): string {
  return `canonical:event:${safeSegment(eventId, 'eventId')}`;
}

export function canonicalIncrementalContestKey(eventId: string, contestUuid: string): string {
  return `${canonicalIncrementalEventKey(eventId)}:contest:${safeSegment(normalizeContestUuid(contestUuid), 'contestUuid')}`;
}

export function canonicalIncrementalScopedContestKey(eventId: string, providerEventUuid: string, contestUuid: string): string {
  return `${canonicalIncrementalEventKey(eventId)}:contest:${safeSegment(providerEventUuid, 'providerEventUuid')}:${safeSegment(normalizeContestUuid(contestUuid), 'contestUuid')}`;
}

export function canonicalIncrementalContestStatusKey(eventId: string, providerEventUuid: string, contestUuid: string): string {
  return `${canonicalIncrementalEventKey(eventId)}:contest-status:${safeSegment(providerEventUuid, 'providerEventUuid')}:${safeSegment(normalizeContestUuid(contestUuid), 'contestUuid')}`;
}

export function canonicalIncrementalParticipantKey(
  eventId: string,
  providerEventUuid: string,
  contestUuid: string,
  participantId: string,
): string {
  return `${canonicalIncrementalEventKey(eventId)}:participant:${safeSegment(providerEventUuid, 'providerEventUuid')}:${safeSegment(normalizeContestUuid(contestUuid), 'contestUuid')}:${safeSegment(participantId, 'participantId')}`;
}

/** Stable provider identity -> current contest routing. Kept separately so a
 * category/contest change can invalidate the old participant record without a
 * prefix scan or a whole-event rebuild. */
export function canonicalIncrementalParticipantRoutingKey(
  eventId: string,
  providerEventUuid: string,
  providerParticipantUuid: string,
): string {
  return `${canonicalIncrementalEventKey(eventId)}:participant-routing:${safeSegment(providerEventUuid, 'providerEventUuid')}:${safeSegment(providerParticipantUuid, 'providerParticipantUuid')}`;
}

export function canonicalIncrementalLeaderboardKey(eventId: string, contestUuid: string): string {
  return `${canonicalIncrementalEventKey(eventId)}:leaderboard:${safeSegment(normalizeContestUuid(contestUuid), 'contestUuid')}`;
}

export function versionedCourseKey(eventId: string, version: string): string {
  return `${versionPrefix(eventId, version)}:course`;
}

export function versionedParticipantIndexKey(eventId: string, version: string): string {
  return `${versionPrefix(eventId, version)}:participant:index`;
}

export function versionedAthleteSnapshotKey(eventId: string, version: string, participantUuid: string): string {
  return `${versionPrefix(eventId, version)}:athlete:${safeSegment(normalizeParticipantUuid(participantUuid), 'participantUuid')}`;
}

export function athleteSnapshotKey(eventId: string, participantUuid: string): string {
  return `${eventPrefix(eventId)}:athlete:${safeSegment(normalizeParticipantUuid(participantUuid), 'participantUuid')}`;
}

export function versionedLeaderboardKey(
  eventId: string,
  version: string,
  contestUuid: string,
  mode: CanonicalRankingMode,
  qualifier?: string,
): string {
  const base = `${versionPrefix(eventId, version)}:leaderboard:${safeSegment(normalizeContestUuid(contestUuid), 'contestUuid')}:${safeSegment(mode, 'mode', true)}`;
  return qualifier ? `${base}:${safeSegment(qualifier, 'qualifier', true)}` : base;
}

export function versionedSplitLeaderboardKey(
  eventId: string,
  version: string,
  contestUuid: string,
  splitKey: string,
  mode: CanonicalRankingMode,
  qualifier?: string,
): string {
  const base = `${versionPrefix(eventId, version)}:split-leaderboard:${safeSegment(normalizeContestUuid(contestUuid), 'contestUuid')}:${safeSegment(splitKey, 'splitKey', true)}:${safeSegment(mode, 'mode', true)}`;
  return qualifier ? `${base}:${safeSegment(qualifier, 'qualifier', true)}` : base;
}

export function versionedSplitSummaryKey(eventId: string, version: string, contestUuid: string): string {
  return `${versionPrefix(eventId, version)}:split-summary:${safeSegment(normalizeContestUuid(contestUuid), 'contestUuid')}`;
}

export function versionedLeaderboardManifestKey(eventId: string, version: string, contestUuid: string): string {
  return `${versionPrefix(eventId, version)}:leaderboard-manifest:${safeSegment(normalizeContestUuid(contestUuid), 'contestUuid')}`;
}

export function athleteBibAliasKey(eventId: string, bib: string): string {
  return `${eventPrefix(eventId)}:athlete:bib:${safeSegment(normalizeBib(bib), 'bib')}`;
}

export function versionedAthleteBibAliasKey(eventId: string, version: string, bib: string): string {
  return `${versionPrefix(eventId, version)}:athlete:bib:${safeSegment(normalizeBib(bib), 'bib')}`;
}

export function athleteProviderAliasKey(eventId: string, providerUuid: string): string {
  return `${eventPrefix(eventId)}:athlete:provider:${safeSegment(providerUuid, 'providerUuid')}`;
}

export function versionedAthleteProviderAliasKey(eventId: string, version: string, providerUuid: string): string {
  return `${versionPrefix(eventId, version)}:athlete:provider:${safeSegment(providerUuid, 'providerUuid')}`;
}

export function athleteUidAliasKey(eventId: string, uid: string): string {
  return `${eventPrefix(eventId)}:athlete:uid:${safeSegment(uid, 'uid')}`;
}

export function versionedAthleteUidAliasKey(eventId: string, version: string, uid: string): string {
  return `${versionPrefix(eventId, version)}:athlete:uid:${safeSegment(uid, 'uid')}`;
}

export function athleteBookingAliasKey(eventId: string, bookingId: string): string {
  return `${eventPrefix(eventId)}:athlete:booking:${safeSegment(bookingId, 'bookingId')}`;
}

export function versionedAthleteBookingAliasKey(eventId: string, version: string, bookingId: string): string {
  return `${versionPrefix(eventId, version)}:athlete:booking:${safeSegment(bookingId, 'bookingId')}`;
}

export function athleteEmailAliasKey(eventId: string, emailHash: string): string {
  const normalizedHash = String(emailHash ?? '').trim().toLocaleLowerCase('en-US');
  if (!/^[a-f0-9]{64}$/.test(normalizedHash)) throw new TypeError('emailHash must be a SHA-256 hexadecimal digest.');
  return `${eventPrefix(eventId)}:athlete:email:${normalizedHash}`;
}

export function versionedAthleteEmailAliasKey(eventId: string, version: string, emailHash: string): string {
  const normalizedHash = String(emailHash ?? '').trim().toLocaleLowerCase('en-US');
  if (!/^[a-f0-9]{64}$/.test(normalizedHash)) throw new TypeError('emailHash must be a SHA-256 hexadecimal digest.');
  return `${versionPrefix(eventId, version)}:athlete:email:${normalizedHash}`;
}

export function userAthletesReverseIndexKey(uid: string): string {
  return `live:user:${safeSegment(uid, 'uid')}:athletes`;
}

export function versionedUserAthletesReverseIndexKey(uid: string, version: string): string {
  return `live:user:${safeSegment(uid, 'uid')}:v:${safeSegment(version, 'version')}:athletes`;
}

export function buildStatusKey(eventId: string, version: string): string {
  return `${versionPrefix(eventId, version)}:build:status`;
}

export function buildValidationKey(eventId: string, version: string): string {
  return `${versionPrefix(eventId, version)}:build:validation`;
}

export function canonicalBuildSummaryKey(eventId: string, version: string): string {
  return `${canonicalIncrementalEventKey(eventId)}:build:${safeSegment(version, 'version')}:summary`;
}

export function canonicalBuildCandidateKey(eventId: string): string {
  return `${canonicalIncrementalEventKey(eventId)}:build:candidate`;
}

export function rawProviderArchiveKey(eventId: string, timestamp: string, filename: string): string {
  return `${eventPrefix(eventId)}:provider:raw:${safeSegment(timestamp, 'timestamp')}:${safeSegment(filename, 'filename')}`;
}
