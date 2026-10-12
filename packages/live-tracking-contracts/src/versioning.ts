import {
  CANONICAL_SCHEMA_VERSION,
  type CanonicalBuildManifest,
  type CanonicalBuildSummary,
  type CanonicalEventManifest,
  type CanonicalValidationResult,
} from './contracts';
import { activeVersionKey, buildStatusKey, buildValidationKey, canonicalBuildCandidateKey, canonicalBuildSummaryKey, eventManifestKey } from './storage-keys';

export interface CanonicalKvStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

export interface PublishManifestInput {
  eventId: string;
  buildVersion: string;
  provider: CanonicalEventManifest['provider'];
  source: CanonicalBuildManifest['source'];
  courseVersion: number;
  participantVersion?: number;
  timingVersion?: number;
  leaderboardVersion?: number;
  validation: CanonicalValidationResult;
  publishedAt?: string;
  eventName?: string;
  timezone?: string;
  status?: CanonicalEventManifest['status'];
  participantCount?: number;
  contestMappings?: CanonicalEventManifest['contestMappings'];
  completeBuildValid?: boolean;
  startedAt?: string;
  expectedParticipants?: number;
  writtenParticipants?: number;
  expectedContests?: number;
  writtenContests?: number;
  unresolvedContests?: number;
}

export interface PublishManifestResult {
  published: boolean;
  manifest: CanonicalEventManifest | null;
}

function buildVersionTimestamp(date: Date): string {
  if (!Number.isFinite(date.getTime())) throw new TypeError('A valid build date is required.');
  return date.toISOString().replace(/:(?=\d{2}(?::|\.))/g, '');
}

export function createBuildVersion(now = new Date()): string {
  const random = new Uint8Array(3);
  crypto.getRandomValues(random);
  const suffix = Array.from(random, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${buildVersionTimestamp(now)}-${suffix}`;
}

export function compareBuildVersions(left: string | null | undefined, right: string | null | undefined): number {
  const normalizedLeft = String(left || '').trim();
  const normalizedRight = String(right || '').trim();
  if (normalizedLeft === normalizedRight) return 0;
  if (!normalizedLeft) return -1;
  if (!normalizedRight) return 1;
  return normalizedLeft.localeCompare(normalizedRight);
}

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export async function writeJsonIfChanged(store: CanonicalKvStore, key: string, value: unknown): Promise<boolean> {
  const serialized = JSON.stringify(value);
  const current = await store.get(key);
  if (current === serialized) return false;
  await store.put(key, serialized);
  return true;
}

export async function writeJson(store: CanonicalKvStore, key: string, value: unknown): Promise<boolean> {
  await store.put(key, JSON.stringify(value));
  return true;
}

async function readManifestRecord(store: CanonicalKvStore, eventId: string): Promise<CanonicalEventManifest | null> {
  const value = parseJson<CanonicalEventManifest>(await store.get(eventManifestKey(eventId)));
  if (!value || value.schemaVersion !== CANONICAL_SCHEMA_VERSION || value.eventId !== eventId) return null;
  return value;
}

export async function readManifest(store: CanonicalKvStore, eventId: string): Promise<CanonicalEventManifest | null> {
  const value = await readManifestRecord(store, eventId);
  return value?.activeVersion ? value : null;
}

export async function writeBuildStatus(store: CanonicalKvStore, status: CanonicalBuildManifest): Promise<boolean> {
  return writeJsonIfChanged(store, buildStatusKey(status.eventId, status.buildVersion), status);
}

export async function writeBuildValidation(store: CanonicalKvStore, validation: CanonicalValidationResult): Promise<boolean> {
  return writeJsonIfChanged(store, buildValidationKey(validation.eventId, validation.buildVersion), validation);
}

export async function writeBuildSummary(store: CanonicalKvStore, summary: CanonicalBuildSummary): Promise<boolean> {
  return writeJsonIfChanged(store, canonicalBuildSummaryKey(summary.eventId, summary.buildVersion), summary);
}

export async function watchdogStaleCanonicalBuild(
  store: CanonicalKvStore,
  eventId: string,
  now = new Date(),
  timeoutMs = 60_000,
): Promise<string | null> {
  const candidate = parseJson<{ buildVersion?: string }>(await store.get(canonicalBuildCandidateKey(eventId)));
  const buildVersion = String(candidate?.buildVersion || '').trim();
  if (!buildVersion) return null;
  const status = parseJson<CanonicalBuildManifest>(await store.get(buildStatusKey(eventId, buildVersion)));
  if (!status || !['building', 'validating'].includes(status.status)) return null;
  const lastActivity = Date.parse(status.updatedAt);
  if (!Number.isFinite(lastActivity) || now.getTime() - lastActivity <= timeoutMs) return null;
  const failedAt = now.toISOString();
  await writeBuildStatus(store, {
    ...status,
    status: 'failed_stale_build',
    updatedAt: failedAt,
    completedAt: failedAt,
    error: 'FAILED_STALE_BUILD',
  });
  return buildVersion;
}

export async function writeCanonicalBuildCandidate(store: CanonicalKvStore, eventId: string, buildVersion: string, updatedAt: string) {
  return writeJsonIfChanged(store, canonicalBuildCandidateKey(eventId), { eventId, buildVersion, updatedAt });
}

/** Finalizes a fully-written immutable build. The event manifest is the
 * authoritative single-key publication pointer; Workers KV cannot transact
 * across multiple keys, so the activeVersion sidecar is maintained only as a
 * compatibility mirror. */
export async function finalizeCanonicalBuild(store: CanonicalKvStore, input: PublishManifestInput): Promise<PublishManifestResult> {
  const now = input.publishedAt ?? new Date().toISOString();
  const startedAt = input.startedAt ?? now;
  let manifestRecord = await readManifestRecord(store, input.eventId);
  let current = manifestRecord?.activeVersion ? manifestRecord : null;
  await writeBuildValidation(store, input.validation);

  const buildBase: Omit<CanonicalBuildManifest, 'status' | 'completedAt'> = {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    eventId: input.eventId,
    buildVersion: input.buildVersion,
    updatedAt: now,
    provider: input.provider,
    source: input.source,
    startedAt,
    artifactKeys: [],
  };
  const summaryBase: Omit<CanonicalBuildSummary, 'status' | 'completedAt' | 'valid' | 'publishable' | 'active'> = {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    eventId: input.eventId,
    buildVersion: input.buildVersion,
    version: input.buildVersion,
    updatedAt: now,
    startedAt,
    expectedParticipants: input.expectedParticipants ?? input.participantCount ?? 0,
    writtenParticipants: input.writtenParticipants ?? input.participantCount ?? 0,
    expectedContests: input.expectedContests ?? Object.keys(input.contestMappings ?? {}).length,
    writtenContests: input.writtenContests ?? Object.keys(input.contestMappings ?? {}).length,
    unresolvedContests: input.unresolvedContests ?? 0,
    fatalErrors: input.validation.errors.length,
    warnings: input.validation.warnings.length,
  };

  if (!input.validation.valid || input.validation.errors.length > 0) {
    await writeBuildStatus(store, {
      ...buildBase,
      status: 'failed',
      completedAt: now,
      error: input.validation.errors.map((issue) => issue.code).join(', ') || 'validation_failed',
    });
    await writeBuildSummary(store, {
      ...summaryBase, status: 'failed', completedAt: now,
      valid: false, publishable: false, active: false,
    });
    return { published: false, manifest: current };
  }

  const candidateTimingVersion = input.timingVersion ?? current?.timingVersion ?? 0;
  const timingAdvancedSinceBuildStarted = (manifest: CanonicalEventManifest | null) =>
    Number(manifest?.timingVersion ?? 0) > candidateTimingVersion;
  const newerBuildAlreadyPublished = (manifest: CanonicalEventManifest | null) =>
    compareBuildVersions(manifest?.activeVersion, input.buildVersion) > 0;
  const canonicalResetSinceBuildStarted = (manifest: CanonicalEventManifest | null) => {
    if (manifest?.status !== 'archived' || manifest.activeVersion) return false;
    const resetAt = Date.parse(manifest.updatedAt);
    const buildStartedAt = Date.parse(startedAt);
    return Number.isFinite(resetAt) && Number.isFinite(buildStartedAt) && resetAt > buildStartedAt;
  };
  if (newerBuildAlreadyPublished(current)) {
    await writeBuildStatus(store, {
      ...buildBase,
      status: 'failed',
      completedAt: now,
      error: 'build_version_stale',
    });
    await writeBuildSummary(store, { ...summaryBase, status: 'failed', completedAt: now, valid: true, publishable: false, active: false });
    return { published: false, manifest: current };
  }
  if (timingAdvancedSinceBuildStarted(current)) {
    await writeBuildStatus(store, {
      ...buildBase,
      status: 'failed',
      completedAt: now,
      error: 'timing_version_stale',
    });
    await writeBuildSummary(store, { ...summaryBase, status: 'failed', completedAt: now, valid: true, publishable: false, active: false });
    return { published: false, manifest: current };
  }
  if (canonicalResetSinceBuildStarted(manifestRecord)) {
    await writeBuildStatus(store, {
      ...buildBase,
      status: 'failed',
      completedAt: now,
      error: 'canonical_reset_during_build',
    });
    await writeBuildSummary(store, { ...summaryBase, status: 'failed', completedAt: now, valid: true, publishable: false, active: false });
    return { published: false, manifest: current };
  }

  const manifest: CanonicalEventManifest = {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    eventId: input.eventId,
    activeVersion: input.buildVersion,
    previousVersion: current?.activeVersion ?? null,
    provider: input.provider,
    courseVersion: input.courseVersion,
    participantVersion: input.participantVersion ?? current?.participantVersion ?? 0,
    timingVersion: candidateTimingVersion,
    leaderboardVersion: input.leaderboardVersion ?? current?.leaderboardVersion ?? 0,
    eventName: input.eventName ?? current?.eventName,
    timezone: input.timezone ?? current?.timezone,
    status: input.status ?? current?.status,
    participantCount: input.participantCount ?? current?.participantCount,
    contestMappings: input.contestMappings ?? current?.contestMappings,
    completeBuildValid: input.completeBuildValid ?? false,
    publishedAt: now,
    updatedAt: now,
  };

  await writeBuildStatus(store, {
    ...buildBase,
    status: 'ready',
    completedAt: null,
  });
  await writeBuildSummary(store, {
    ...summaryBase, status: 'ready', completedAt: null,
    valid: true, publishable: true, active: false,
  });

  // A raw START/split/FINISH mutation may land while a configuration build is
  // writing its immutable artifacts. Re-read at the publication boundary and
  // never let that older build move the active pointer backwards over newer
  // timing. The next sync will rebuild from the current finished snapshot.
  manifestRecord = await readManifestRecord(store, input.eventId);
  current = manifestRecord?.activeVersion ? manifestRecord : null;
  if (newerBuildAlreadyPublished(current)) {
    await writeBuildStatus(store, {
      ...buildBase,
      status: 'failed',
      completedAt: now,
      error: 'build_version_stale',
    });
    await writeBuildSummary(store, { ...summaryBase, status: 'failed', completedAt: now, valid: true, publishable: false, active: false });
    return { published: false, manifest: current };
  }
  if (timingAdvancedSinceBuildStarted(current)) {
    await writeBuildStatus(store, {
      ...buildBase,
      status: 'failed',
      completedAt: now,
      error: 'timing_version_stale',
    });
    await writeBuildSummary(store, { ...summaryBase, status: 'failed', completedAt: now, valid: true, publishable: false, active: false });
    return { published: false, manifest: current };
  }
  if (canonicalResetSinceBuildStarted(manifestRecord)) {
    await writeBuildStatus(store, {
      ...buildBase,
      status: 'failed',
      completedAt: now,
      error: 'canonical_reset_during_build',
    });
    await writeBuildSummary(store, { ...summaryBase, status: 'failed', completedAt: now, valid: true, publishable: false, active: false });
    return { published: false, manifest: current };
  }

  // Prepare compatibility/diagnostic mirrors first. The event manifest is the
  // sole publication pointer and must be the final KV write.
  await writeJsonIfChanged(store, activeVersionKey(input.eventId), input.buildVersion);
  await writeBuildStatus(store, { ...buildBase, status: 'active', completedAt: now });
  await writeBuildSummary(store, {
    ...summaryBase, status: 'active', completedAt: now,
    valid: true, publishable: true, active: true,
  });
  await writeJsonIfChanged(store, eventManifestKey(input.eventId), manifest);
  console.info('[CANONICAL BUILD FINALIZED]', {
    eventId: input.eventId,
    version: input.buildVersion,
    status: 'active',
    durationMs: Math.max(0, Date.parse(now) - Date.parse(startedAt)),
    participants: summaryBase.writtenParticipants,
    contests: summaryBase.writtenContests,
    warnings: summaryBase.warnings,
    fatalErrors: summaryBase.fatalErrors,
    publishable: true,
    activeVersion: input.buildVersion,
  });
  return { published: true, manifest };
}

/** Backward-compatible name for callers outside this package. */
export const publishManifest = finalizeCanonicalBuild;

export async function resolveActiveVersion(store: CanonicalKvStore, eventId: string): Promise<string | null> {
  const manifestVersion = (await readManifest(store, eventId))?.activeVersion;
  if (manifestVersion) return manifestVersion;
  const raw = await store.get(activeVersionKey(eventId));
  return parseJson<string>(raw) || String(raw || '').trim() || null;
}
