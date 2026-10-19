import { z } from 'zod';
import {
  validateCanonicalCourseContract,
  type CanonicalCourseBundle as SharedCanonicalCourseBundle,
} from '@raceupshot/live-tracking-contracts';

import { isDevelopment } from '@/core/constants/env';
import { getAccessToken } from '@/core/auth/secureStore';
import { authorizationForAccessToken } from '@/core/auth/accessToken';
import { backendUrl, fetchWithLogging } from '@/core/services/api';

const nonEmpty = z.string().trim().min(1);
const nullableNumber = z.number().finite().nullable().optional();

const canonicalEnvelopeBase = z.object({
  success: z.literal(true),
  eventId: nonEmpty,
  activeVersion: nonEmpty,
  data: z.unknown(),
}).passthrough();

export const canonicalCourseBundleSchema = z.any().superRefine((value, ctx) => {
  const result = validateCanonicalCourseContract(value);
  if (result.success) return;
  result.issues.forEach((contractIssue) => {
    ctx.addIssue({
      code: 'custom',
      path: contractIssue.path,
      message: `${contractIssue.message} Expected ${contractIssue.expected ?? 'valid value'}.`,
    });
  });
}).transform((value) => value as SharedCanonicalCourseBundle);

export const canonicalParticipantRowSchema = z.object({
  participantUuid: nonEmpty.optional(),
  providerUuid: nonEmpty.optional(),
  providerParticipantUuid: nonEmpty.optional(),
  bib: z.union([z.string(), z.number()]).optional(),
  name: z.string().optional(),
  displayName: z.string().optional(),
  contestUuid: z.string().optional(),
  contestName: z.string().optional(),
  gender: z.string().nullable().optional(),
  ageGroup: z.string().nullable().optional(),
  club: z.string().nullable().optional(),
  photoUrl: z.string().nullable().optional(),
  status: z.string().optional(),
  currentLeg: z.string().nullable().optional(),
  lastSplit: z.record(z.string(), z.unknown()).nullable().optional(),
  overallSeconds: nullableNumber,
  overallRank: nullableNumber,
}).passthrough().refine((row) => Boolean(row.participantUuid || row.providerParticipantUuid || row.providerUuid || row.bib != null), 'participant identity is required');

export const canonicalParticipantIndexSchema = z.object({
  eventId: nonEmpty,
  buildVersion: nonEmpty,
  participants: z.array(canonicalParticipantRowSchema).optional(),
  rows: z.array(canonicalParticipantRowSchema).optional(),
  count: z.number().int().nonnegative().optional(),
}).passthrough().refine((value) => Array.isArray(value.participants) || Array.isArray(value.rows), 'participant rows are required');

const canonicalSectionSchema = z.object({
  key: nonEmpty.optional(),
  sectionKey: nonEmpty.optional(),
  type: z.string().optional(),
  label: z.string().optional(),
  durationSeconds: nullableNumber,
  status: z.string().optional(),
  splits: z.array(z.record(z.string(), z.unknown())).optional(),
}).passthrough();

export const canonicalAthleteSnapshotSchema = z.object({
  eventId: nonEmpty,
  buildVersion: nonEmpty,
  participantUuid: nonEmpty.optional(),
  providerUuid: nonEmpty.optional(),
  bib: z.union([z.string(), z.number()]).optional(),
  identity: z.record(z.string(), z.unknown()).optional(),
  bergmanIdentity: z.record(z.string(), z.unknown()).optional(),
  raceState: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
  calculated: z.record(z.string(), z.unknown()).optional(),
  sections: z.array(canonicalSectionSchema),
  splitRows: z.array(z.record(z.string(), z.unknown())).optional(),
  overallRanking: z.record(z.string(), z.unknown()).nullable().optional(),
  splitRankings: z.array(z.record(z.string(), z.unknown())).optional(),
  location: z.record(z.string(), z.unknown()).nullable().optional(),
  versions: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

const leaderboardEntrySchema = z.record(z.string(), z.unknown());
export const canonicalLeaderboardSchema = z.object({
  eventId: nonEmpty, buildVersion: nonEmpty, contestUuid: nonEmpty,
  mode: nonEmpty, qualifier: z.string().nullable().optional(), entries: z.array(leaderboardEntrySchema),
}).passthrough();
export const canonicalSplitLeaderboardSchema = canonicalLeaderboardSchema.extend({ splitKey: nonEmpty });
export const canonicalSplitSummarySchema = z.object({
  eventId: nonEmpty, buildVersion: nonEmpty, contestUuid: nonEmpty,
  splits: z.array(z.record(z.string(), z.unknown())),
}).passthrough();
export const canonicalLeaderboardManifestSchema = z.object({
  eventId: nonEmpty, buildVersion: nonEmpty, contestUuid: nonEmpty,
  raceModes: z.array(z.string()).optional(), splitModes: z.array(z.string()).optional(),
  genderKeys: z.array(z.string()).optional(), ageGroups: z.array(z.string()).optional(),
  clubAvailable: z.boolean().optional(), splitKeys: z.array(z.string()).optional(),
}).passthrough();

export type CanonicalCourseBundle = SharedCanonicalCourseBundle;
export type CanonicalParticipantIndex = z.infer<typeof canonicalParticipantIndexSchema>;
export type CanonicalParticipantRow = z.infer<typeof canonicalParticipantRowSchema>;
export type CanonicalAthleteSnapshot = z.infer<typeof canonicalAthleteSnapshotSchema>;
export type CanonicalLeaderboard = z.infer<typeof canonicalLeaderboardSchema>;
export type CanonicalSplitLeaderboard = z.infer<typeof canonicalSplitLeaderboardSchema>;
export type CanonicalSplitSummary = z.infer<typeof canonicalSplitSummarySchema>;
export type CanonicalLeaderboardManifest = z.infer<typeof canonicalLeaderboardManifestSchema>;

export type CanonicalEnvelope<T> = { success: true; eventId: string; activeVersion: string; data: T };
export type CanonicalAvailability =
  | { ready: true; activeVersion: string; course: CanonicalCourseBundle }
  | { ready: false; reason: 'visibility_disabled' | 'build_missing' | 'build_incomplete' | 'network' | 'invalid_payload' };
export type CanonicalAthleteLookup =
  | { participantUuid: string } | { providerUuid: string } | { bib: string }
  | { athleteUid: string } | { bookingId: string };
export type CanonicalFilter = { mode: 'overall' } | { mode: 'gender'; qualifier: string } | { mode: 'age'; qualifier: string } | { mode: 'club' };
export type CanonicalLeaderboardQuery = {
  contestId?: string;
  mode?: 'overall' | 'gender' | 'age' | 'club';
  ageGroup?: string;
  gender?: string;
  split?: string;
  limit?: number;
  offset?: number;
};

export class CanonicalApiError extends Error {
  constructor(
    public status: number | null,
    public state: string | undefined,
    message: string,
    public code = 'CANONICAL_API_ERROR',
  ) { super(message); this.name = 'CanonicalApiError'; }
}

const lastKnownGoodCourses = new Map<string, CanonicalEnvelope<CanonicalCourseBundle>>();

function valueAtPath(value: unknown, path: PropertyKey[]): unknown {
  return path.reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<PropertyKey, unknown>)[key];
  }, value);
}

const enc = (value: string) => encodeURIComponent(value);
function internalVersion(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  return typeof row.buildVersion === 'string' ? row.buildVersion : undefined;
}
function internalEventId(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  return typeof row.eventId === 'string' ? row.eventId : undefined;
}

async function request<T>(path: string, eventId: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<CanonicalEnvelope<T>> {
  let response: Response;
  try {
    const token = await getAccessToken();
    response = await fetchWithLogging(backendUrl(path), {
      signal,
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: authorizationForAccessToken(token) } : {}),
      },
    });
  }
  catch (error) { throw new CanonicalApiError(null, undefined, error instanceof Error ? error.message : 'Network error'); }
  const contentType = response.headers.get('content-type') ?? '';
  const responseText = await response.text();
  if (!contentType.toLowerCase().includes('application/json')) {
    const preview = responseText.slice(0, 300).replace(/\s+/g, ' ');
    if (isDevelopment) console.warn('[canonical-live] non-json response', { method: 'GET', path, status: response.status, contentType, preview });
    throw new CanonicalApiError(response.status, undefined, 'Canonical API returned a non-JSON response.', 'API_NON_JSON_RESPONSE');
  }
  let payload: unknown;
  try { payload = JSON.parse(responseText); } catch { throw new CanonicalApiError(response.status, undefined, 'Canonical response contains invalid JSON.', 'API_INVALID_JSON_RESPONSE'); }
  const state = payload && typeof payload === 'object' ? String((payload as Record<string, unknown>).state ?? '') || undefined : undefined;
  if (!response.ok) throw new CanonicalApiError(response.status, state, `Canonical request failed (${response.status})`);
  if (state === 'visibility_disabled') throw new CanonicalApiError(response.status, state, 'Public live tracking is disabled');
  const envelope = canonicalEnvelopeBase.safeParse(payload);
  if (!envelope.success) throw new CanonicalApiError(response.status, state, 'Invalid canonical envelope');
  if (envelope.data.eventId !== eventId) throw new CanonicalApiError(response.status, state, 'Canonical eventId mismatch');
  const parsed = schema.safeParse(envelope.data.data);
  if (!parsed.success) {
    const rawData = envelope.data.data as Record<string, unknown> | undefined;
    const issues = parsed.error.issues.slice(0, 10).map((issue) => ({
      path: issue.path.join('.'),
      code: issue.code,
      message: issue.message,
      expected: 'expected' in issue ? issue.expected : undefined,
      received: valueAtPath(envelope.data.data, issue.path),
      contestValue: issue.path[0] === 'contests' && typeof issue.path[1] === 'number'
        ? (rawData?.contests as unknown[] | undefined)?.[issue.path[1]]
        : undefined,
    }));
    console.warn('[canonical-live] schema validation failed', {
      eventId,
      endpoint: path,
      schemaVersion: rawData?.schemaVersion ?? null,
      buildVersion: rawData?.buildVersion ?? envelope.data.activeVersion,
      issues,
    });
    throw new CanonicalApiError(response.status, state, 'Invalid canonical data payload');
  }
  const dataEventId = internalEventId(parsed.data);
  const buildVersion = internalVersion(parsed.data);
  if (dataEventId && dataEventId !== eventId) throw new CanonicalApiError(response.status, state, 'Canonical data eventId mismatch');
  if (buildVersion && buildVersion !== envelope.data.activeVersion) throw new CanonicalApiError(response.status, state, 'Canonical buildVersion mismatch');
  return { success: true, eventId, activeVersion: envelope.data.activeVersion, data: parsed.data };
}

function filterPath(filter: CanonicalFilter): string {
  if (filter.mode === 'overall' || filter.mode === 'club') return filter.mode;
  return `${filter.mode}/${enc(filter.qualifier)}`;
}
function lookupQuery(lookup: CanonicalAthleteLookup): string {
  const [key, value] = Object.entries(lookup)[0];
  return `${enc(key)}=${enc(value)}`;
}

function leaderboardQuery(filters: CanonicalLeaderboardQuery): string {
  const params = new URLSearchParams();
  if (filters.contestId) params.set('contestId', filters.contestId);
  if (filters.mode) params.set('mode', filters.mode);
  if (filters.ageGroup) params.set('ageGroup', filters.ageGroup);
  if (filters.gender && filters.gender !== 'All') params.set('gender', filters.gender);
  if (filters.split) params.set('split', filters.split);
  params.set('limit', String(filters.limit ?? 100));
  params.set('offset', String(filters.offset ?? 0));
  return params.toString();
}

export const CanonicalTrackingRepository = {
  getCanonicalCourse: async (eventId: string, signal?: AbortSignal) => {
    try {
      const result = await request(`/api/live/events/${enc(eventId)}/canonical/course`, eventId, canonicalCourseBundleSchema, signal);
      lastKnownGoodCourses.set(eventId, result);
      return result;
    } catch (error) {
      const cached = lastKnownGoodCourses.get(eventId);
      if (cached && !(error instanceof CanonicalApiError && error.status === 403)) return cached;
      throw error;
    }
  },
  getCanonicalParticipants: (eventId: string, signal?: AbortSignal) => request(`/api/live/events/${enc(eventId)}/canonical/participants`, eventId, canonicalParticipantIndexSchema, signal),
  getCanonicalAthlete: (eventId: string, lookup: CanonicalAthleteLookup, signal?: AbortSignal) => request(`/api/live/events/${enc(eventId)}/canonical/athlete?${lookupQuery(lookup)}`, eventId, canonicalAthleteSnapshotSchema, signal),
  getCanonicalLeaderboard: (eventId: string, filters: CanonicalLeaderboardQuery = {}, signal?: AbortSignal) => request(`/api/live/events/${enc(eventId)}/canonical/leaderboard?${leaderboardQuery(filters)}`, eventId, canonicalLeaderboardSchema, signal),
  getCanonicalLeaderboardManifest: (eventId: string, contestUuid: string, signal?: AbortSignal) => request(`/api/live/events/${enc(eventId)}/leaderboard-manifest/${enc(contestUuid)}`, eventId, canonicalLeaderboardManifestSchema, signal),
  getCanonicalOverallLeaderboard: (eventId: string, contestUuid: string, filter: CanonicalFilter, signal?: AbortSignal) => request(`/api/live/events/${enc(eventId)}/leaderboard/${enc(contestUuid)}/${filterPath(filter)}`, eventId, canonicalLeaderboardSchema, signal),
  getCanonicalSplitSummary: (eventId: string, contestUuid: string, signal?: AbortSignal) => request(`/api/live/events/${enc(eventId)}/split-summary/${enc(contestUuid)}`, eventId, canonicalSplitSummarySchema, signal),
  getCanonicalSplitLeaderboard: (eventId: string, contestUuid: string, splitKey: string, filter: Exclude<CanonicalFilter, { mode: 'club' }>, signal?: AbortSignal) => request(`/api/live/events/${enc(eventId)}/split-leaderboard/${enc(contestUuid)}/${enc(splitKey)}/${filterPath(filter)}`, eventId, canonicalSplitLeaderboardSchema, signal),
};

export async function resolveCanonicalAvailability(eventId: string, signal?: AbortSignal): Promise<CanonicalAvailability> {
  try {
    const result = await CanonicalTrackingRepository.getCanonicalCourse(eventId, signal);
    return { ready: true, activeVersion: result.activeVersion, course: result.data };
  } catch (error) {
    if (!(error instanceof CanonicalApiError)) return { ready: false, reason: 'network' };
    if (error.status === 409 && error.state === 'canonical_build_incomplete') return { ready: false, reason: 'build_incomplete' };
    // Some legacy / partially-published events do not expose the canonical
    // course endpoint at all yet. Treat a 404 as an unavailable canonical
    // build so callers can use the already-published participant index rather
    // than rendering an empty athlete list.
    if (error.status === 404) return { ready: false, reason: 'build_missing' };
    if (error.state === 'visibility_disabled' || error.status === 403) return { ready: false, reason: 'visibility_disabled' };
    if (error.status === null) return { ready: false, reason: 'network' };
    return { ready: false, reason: 'invalid_payload' };
  }
}
