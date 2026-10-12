export type CanonicalChangeReason =
  | 'split_updated'
  | 'participant_updated'
  | 'leaderboard_updated'
  | 'race_status_updated'
  | 'canonical_rebuilt';

export interface CanonicalChangeEvent {
  type: 'canonical_change';
  eventId: string;
  participantUuid?: string;
  contestUuid?: string;
  canonicalVersion: string;
  manifestVersion: string;
  timingVersion: number;
  revision: number;
  reason: CanonicalChangeReason;
  updatedAt: string;
  canonicalWriteCompletedAt: string;
  manifestPersistedAt: string;
  publishedAt: string;
  feibotReadAcceptedAt?: string;
}

export interface CanonicalStreamReadyEvent {
  type: 'canonical_stream_ready';
  eventId: string;
  connectedAt: string;
}

export type CanonicalStreamEvent = CanonicalChangeEvent | CanonicalStreamReadyEvent;

export function canonicalManifestVersion(activeVersion: string, timingVersion: number): string {
  return `${activeVersion}:${Math.max(0, Math.trunc(timingVersion))}`;
}

export function isCanonicalChangeEvent(value: unknown): value is CanonicalChangeEvent {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return row.type === 'canonical_change'
    && typeof row.eventId === 'string'
    && typeof row.canonicalVersion === 'string'
    && typeof row.manifestVersion === 'string'
    && typeof row.timingVersion === 'number'
    && typeof row.revision === 'number'
    && typeof row.reason === 'string'
    && typeof row.updatedAt === 'string';
}

export function compareManifestVersions(left: string | null | undefined, right: string | null | undefined): number {
  const a = String(left || '').trim();
  const b = String(right || '').trim();
  if (a === b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  const parse = (value: string) => {
    const separator = value.lastIndexOf(':');
    const sequence = separator >= 0 ? Number(value.slice(separator + 1)) : Number.NaN;
    return { version: separator >= 0 && Number.isFinite(sequence) ? value.slice(0, separator) : value, sequence };
  };
  const parsedA = parse(a);
  const parsedB = parse(b);
  if (parsedA.version === parsedB.version && Number.isFinite(parsedA.sequence) && Number.isFinite(parsedB.sequence)) {
    return parsedA.sequence - parsedB.sequence;
  }
  return parsedA.version.localeCompare(parsedB.version);
}
