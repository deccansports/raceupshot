import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { useSession } from "@/core/auth/session";
import {
  repositories,
  type AthleteSearchMode,
  type LeaderboardFilters,
} from "@/core/repositories";
import { inferAthleteSearchMode } from "@/core/repositories/athlete.repository";
import { httpText } from "@/core/services/api/http";
import { queryKeys } from "@/core/services/query/queryKeys";
import type { ApiError, AthleteSearchMatch } from "@/core/types";
import type { AthleteSummary } from "@/features/tracking/mappers";

import { resolveCourseGeometry } from "../course-map/courseConfig";
import type { CourseMapSelection } from "../course-map/courseConfig";
import { mapAthleteMatches, mapLeaderboardRows } from "../mappers";
import { TRACKING_INTERVALS } from "./trackingKeys";
import {
  useCanonicalAvailability,
  useCanonicalParticipants,
} from "./useCanonicalTracking";

type ParticipantRecord = Record<string, unknown> & {
  participantUuid?: string;
  athleteUid?: string;
  providerUuid?: string;
  providerAthleteUuid?: string;
  providerTimingUuid?: string;
  providerRecordId?: string;
  bookingId?: string;
  bib?: string;
  bibNumber?: string;
  name?: string;
  nameLower?: string;
  fullName?: string;
  displayName?: string;
  contestName?: string;
  providerContestName?: string;
  contestUuid?: string;
  providerContestUuid?: string;
  ageGroup?: string;
  ageGroupName?: string;
  gender?: string;
  city?: string;
  state?: string;
  country?: string;
  club?: string;
  clubName?: string;
  photoUrl?: string | null;
  photoURL?: string | null;
  profilePhotoUrl?: string | null;
  avatarUrl?: string | null;
  displayPhoto?: string | null;
  email?: string;
};

type OfficialResultRecord = Record<string, unknown> & {
  athleteUid?: string;
  bibNumber?: string;
  bib?: string;
  displayName?: string;
  name?: string;
  fullName?: string;
  profilePhotoUrl?: string | null;
  photoUrl?: string | null;
  photoURL?: string | null;
  contest?: string | null;
  contestName?: string | null;
  category?: string | null;
  ageGroup?: string | null;
  gender?: string | null;
  chipTime?: string | null;
  overallTime?: string | null;
  overallRank?: number | string | null;
  genderRank?: number | string | null;
  categoryRank?: number | string | null;
  cRank?: number | string | null;
  gRank?: number | string | null;
  oRank?: number | string | null;
  pointsAwarded?: number | string | null;
  status?: string | null;
  raceDate?: string | null;
  splits?: { label?: string; time?: string }[] | null;
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const candidate = text(value);
    if (candidate) return candidate;
  }
  return "";
}

function hasValidEventId(value: unknown): value is string {
  const eventId = String(value ?? "").trim();
  return Boolean(eventId && eventId !== "undefined" && eventId !== "null");
}

function shouldRetryLiveRequest(failureCount: number, error: unknown): boolean {
  const status = (error as ApiError | undefined)?.status;
  if (
    status === 400 ||
    status === 401 ||
    status === 403 ||
    status === 404 ||
    status === 422
  )
    return false;
  if (status != null && status !== 408 && status !== 429 && ![500, 502, 503, 504].includes(status)) return false;
  if (error instanceof Error && error.message === "EVENT_ID_REQUIRED")
    return false;
  return failureCount < 2;
}

function cleanContestLabel(value: unknown): string {
  const textValue = text(value);
  if (!textValue) return "";
  if (/^sub-\d+$/i.test(textValue)) return "";
  return textValue;
}

function uniqueKey(
  value: Record<string, unknown> & {
    participantUuid?: string;
    providerUuid?: string;
    providerAthleteUuid?: string;
    providerTimingUuid?: string;
    providerRecordId?: string;
    bookingId?: string;
    athleteUid?: string;
    bib?: string;
    contestUuid?: string;
    contestName?: string;
    category?: string;
    providerContestUuid?: string;
    providerContestName?: string;
    name?: string;
    displayName?: string;
    fullName?: string;
  },
): string {
  const bib = firstText(value.bib, value.bibNumber);
  const contest = firstText(
    value.contestName,
    value.providerContestName,
    value.category,
    value.contestUuid,
    value.providerContestUuid,
  );
  const name = firstText(value.name, value.displayName, value.fullName);
  return (
    (bib && contest ? `bib:${bib}:contest:${contest}` : "") ||
    (bib && name ? `bib:${bib}:name:${name.toLowerCase()}` : "") ||
    firstText(
      value.participantUuid,
      value.providerUuid,
      value.providerRecordId,
      value.bookingId,
      value.athleteUid,
    ) ||
    firstText(value.bib) ||
    JSON.stringify(value)
  );
}

function isLikelyParticipantRecord(value: unknown): value is ParticipantRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as ParticipantRecord;
  return Boolean(
    firstText(
      record.participantUuid,
      record.providerUuid,
      record.providerAthleteUuid,
      record.providerTimingUuid,
      record.providerRecordId,
      record.bookingId,
      record.athleteUid,
      record.bib,
      record.bibNumber,
      record.name,
      record.displayName,
      record.fullName,
      record.email,
    ),
  );
}

function normalizeParticipantResponse(res: unknown): ParticipantRecord[] {
  const visited = new Set<unknown>();
  const collect = (value: unknown, depth = 0): ParticipantRecord[] => {
    if (!value || depth > 5 || visited.has(value)) return [];
    if (typeof value === "object") visited.add(value);
    if (Array.isArray(value))
      return value.flatMap((item) => collect(item, depth + 1));
    if (isLikelyParticipantRecord(value)) return [value];
    if (typeof value !== "object") return [];
    const record = value as Record<string, unknown>;
    const preferred = [
      record.participants,
      record.matches,
      record.data,
      record.rows,
      record.items,
      record.list,
      record.athletes,
      record.byUuid,
      record.byBib,
      record.byContest,
      record.byParticipantUuid,
      record.byAthleteUid,
    ];
    const preferredRows = preferred.flatMap((item) => collect(item, depth + 1));
    if (preferredRows.length > 0) return preferredRows;
    return Object.values(record).flatMap((item) => collect(item, depth + 1));
  };
  return collect(res);
}

function payloadRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nestedData(value: unknown): Record<string, unknown> {
  const root = payloadRecord(value);
  return root.data && typeof root.data === "object" && !Array.isArray(root.data)
    ? (root.data as Record<string, unknown>)
    : {};
}

function booleanField(value: unknown, key: string): boolean | undefined {
  const root = payloadRecord(value);
  const data = nestedData(value);
  if (typeof root[key] === "boolean") return root[key] as boolean;
  if (typeof data[key] === "boolean") return data[key] as boolean;
  return undefined;
}

function stringField(value: unknown, key: string): string {
  const root = payloadRecord(value);
  const data = nestedData(value);
  return firstText(root[key], data[key]);
}

function isVisibilityDisabledPayload(value: unknown): boolean {
  return (
    stringField(value, "source") === "visibility_lock" ||
    booleanField(value, "publicAthleteVisibility") === false ||
    booleanField(value, "visibilityEnabled") === false
  );
}

function isDataPendingPayload(value: unknown): boolean {
  return (
    booleanField(value, "publicAthleteVisibility") === true &&
    stringField(value, "source") === "no_data"
  );
}

function searchRowsFromContract(
  res: unknown,
  mode: AthleteSearchMode = "name",
  query = "",
): AthleteSearchMatch[] {
  const data = nestedData(res);
  if (
    stringField(res, "source") === "visibility_lock" ||
    booleanField(res, "publicAthleteVisibility") === false ||
    booleanField(res, "visibilityEnabled") === false
  )
    return [];
  const rows = Array.isArray(data.rows)
    ? (data.rows as AthleteSearchMatch[])
    : [];
  if (mode !== "bib") return rows;

  const normalizedQuery = String(query).trim().toLowerCase();
  return rows.filter((athlete) => {
    return (
      String(athlete.bib ?? athlete.bibNumber ?? "")
        .trim()
        .toLowerCase() === normalizedQuery
    );
  });
}

type AthleteSearchQueryResult = {
  rows: AthleteSummary[];
  state: "found" | "not-found" | "visibility-disabled";
  visibilityVersion?: number;
};

function dedupeByPriority<T extends Record<string, unknown>>(items: T[]): T[] {
  const unique = new Map<string, T>();
  for (const item of items) {
    const key = uniqueKey(
      item as Record<string, unknown> & {
        providerUuid?: string;
        providerTimingUuid?: string;
        providerRecordId?: string;
        participantUuid?: string;
        bookingId?: string;
        athleteUid?: string;
        bib?: string;
        contestUuid?: string;
      },
    );
    if (!unique.has(key)) {
      unique.set(key, item);
      continue;
    }
    unique.set(key, { ...unique.get(key), ...item });
  }
  return [...unique.values()];
}

function normalizeOfficialSummary(
  result: OfficialResultRecord,
): AthleteSummary {
  const bib = firstText(result.bib, result.bibNumber, result.athleteUid);
  return {
    id: firstText(result.athleteUid, result.bib, result.bibNumber, bib),
    bib,
    name:
      firstText(result.displayName, result.name, result.fullName) ||
      `Bib ${bib}`,
    category:
      cleanContestLabel(
        firstText(
          result.contestName,
          result.contest,
          result.ageGroup,
          result.category,
        ),
      ) || undefined,
    club: firstText(result.club, result.clubName),
    photoUrl:
      firstText(
        result.profilePhotoUrl,
        result.photoUrl,
        result.photoURL,
        result.avatarUrl,
        result.displayPhoto,
      ) ||
      undefined,
    athleteUid: firstText(result.athleteUid) || undefined,
    status: result.status
      ? String(result.status).toLowerCase().includes("finish")
        ? "finished"
        : String(result.status).toLowerCase().includes("live")
          ? "live"
          : "notStarted"
      : "finished",
  };
}

export function useParticipants(eventId: string, enabled = true) {
  const availability = useCanonicalAvailability(eventId, enabled);
  const canonicalReady = availability.data?.ready === true;
  const activeVersion = availability.data?.ready === true ? availability.data.activeVersion : undefined;
  const canonicalQuery = useCanonicalParticipants(eventId, activeVersion, enabled && canonicalReady, true);
  const fallbackAllowed = availability.data?.ready === false && ["build_missing", "build_incomplete", "network"].includes(availability.data.reason);
  const legacyQuery = useQuery({
    queryKey: queryKeys.participants(eventId),
    queryFn: async ({ signal }) => {
      const res = await repositories.tracking.getParticipants(eventId, signal);
      const data = (res as { data?: Record<string, unknown> }).data;
      const rawParticipants =
        isVisibilityDisabledPayload(res) || isDataPendingPayload(res)
          ? []
          : normalizeParticipantResponse(res);
      const participants = dedupeByPriority(rawParticipants);
      if (process.env.NODE_ENV !== "production") {
        console.log("[participants] raw response", res);
        console.log("[participants] response.data", data);
        console.log("[participants] kv index keys", [
          `live:event:${eventId}:participant:index`,
        ]);
        console.log(
          "[participants] raw participant count",
          rawParticipants.length,
        );
        console.log(
          "[participants] unique participant count",
          participants.length,
        );
        console.log(
          "[participants] provider uuid count",
          new Set(participants.map((p) => p.providerUuid).filter(Boolean)).size,
        );
      }
      return participants;
    },
    staleTime: 0,
    enabled: enabled && Boolean(eventId) && fallbackAllowed,
  });
  if (!canonicalReady) return legacyQuery;
  const rows = canonicalQuery.data?.participants ?? canonicalQuery.data?.rows ?? [];
  const participants = dedupeByPriority(rows.map((row) => ({
    ...row,
    bib: text(row.bib),
    bibNumber: text(row.bib),
    name: firstText(row.displayName, row.name),
    fullName: firstText(row.displayName, row.name),
    providerUuid: row.providerParticipantUuid ?? row.providerUuid,
    providerAthleteUuid: row.providerParticipantUuid ?? row.providerUuid,
    providerTimingUuid: row.providerParticipantUuid ?? row.providerUuid,
    participantUuid: row.participantUuid,
    photoUrl: row.photoUrl,
    photoURL: row.photoUrl,
    profilePhotoUrl: row.photoUrl,
    avatarUrl: row.photoUrl,
    displayPhoto: row.photoUrl,
  } as ParticipantRecord)));
  return { ...canonicalQuery, data: participants };
}

export function useEventResults(eventId: string, enabled = true) {
  const normalizedEventId = text(Array.isArray(eventId) ? eventId[0] : eventId);
  const validEventId = hasValidEventId(normalizedEventId);
  const resolvedEventId = validEventId ? normalizedEventId : "disabled";
  return useQuery({
    queryKey: queryKeys.eventResults(resolvedEventId),
    queryFn: async ({ signal }) => {
      if (!validEventId) throw new Error("EVENT_ID_REQUIRED");
      const rows = await repositories.results.getEventResults(
        resolvedEventId,
        signal,
      );
      if (process.env.NODE_ENV !== "production") {
        console.log("[FinishedEvent]", {
          eventId: resolvedEventId,
          source: `results:${resolvedEventId}`,
          loadedAthletes: rows.length,
        });
      }
      return rows as OfficialResultRecord[];
    },
    refetchOnMount: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    staleTime: 0,
    gcTime: 30 * 60 * 1000,
    retry: shouldRetryLiveRequest,
    enabled: enabled && validEventId,
  });
}

/**
 * React Query hooks for live tracking. Flow: Screen → these hooks → Repository →
 * production BERGMAN endpoints (or mock behind EXPO_PUBLIC_USE_LIVE_API).
 *
 * Polling pauses in the background (AppState → focusManager), when the screen is
 * unfocused (`focused=false`), and when the race is finished (`isLive=false`).
 */

export function useLiveEvents(enabled = true) {
  return useQuery({
    queryKey: queryKeys.events.list,
    queryFn: ({ signal }) => repositories.events.getLiveEvents(signal),
    staleTime: TRACKING_INTERVALS.eventsStaleMs,
    enabled,
  });
}

export type PollingOptions = {
  enabled?: boolean;
  /** Screen is focused. */
  focused?: boolean;
  /** Race is currently live (polling stops when finished). */
  isLive?: boolean;
  /** Replay mode active (live polling pauses). */
  replay?: boolean;
};

function shouldPoll({
  focused = true,
  isLive = true,
  replay = false,
}: PollingOptions): boolean {
  return focused && isLive && !replay;
}

export function useLeaderboard(
  eventId: string,
  filters?: LeaderboardFilters,
  options: PollingOptions = {},
  source: "auto" | "live" | "results" = "auto",
) {
  const { enabled = true } = options;
  const validEventId = hasValidEventId(eventId);
  const resolvedEventId = validEventId ? eventId.trim() : "disabled";
  const resolvedSource = source === "auto" ? "live" : source;
  const resultsQuery = useEventResults(
    resolvedEventId,
    enabled && validEventId && resolvedSource === "results",
  );

  const query = useQuery({
    queryKey: queryKeys.leaderboard(resolvedEventId, filters),
    queryFn: async ({ signal }) => {
      if (!validEventId) throw new Error("EVENT_ID_REQUIRED");
      if (
        resolvedSource === "results" ||
        (!shouldPoll(options) && resolvedSource !== "live")
      ) {
        const rows =
          resultsQuery.data ??
          (await repositories.results.getEventResults(resolvedEventId, signal));
        if (process.env.NODE_ENV !== "production") {
          console.log("[Finished Leaderboard]", {
            eventId: resolvedEventId,
            source: `results:${resolvedEventId}`,
            resultsLoaded: rows.length,
          });
        }
        return rows;
      }

      if (resolvedSource === "live") {
        const res = await repositories.leaderboard.getLeaderboard(
          resolvedEventId,
          filters,
          signal,
        );
        const rows = mapLeaderboardRows(res.athletes ?? []);
        if (process.env.NODE_ENV !== "production") {
          console.log("[tracking] merged live records", {
            eventId: resolvedEventId,
            kvKey: `live:event:${resolvedEventId}:leaderboard`,
            count: rows.length,
            hit: rows.length > 0,
          });
        }
        return rows;
      }

      return [];
    },
    refetchInterval: (query) => {
      if (!shouldPoll(options) || resolvedSource !== "live") return false;
      const rows = Array.isArray(query.state.data) ? query.state.data : [];
      return rows.length > 0 ? TRACKING_INTERVALS.leaderboardRefetchMs : false;
    },
    staleTime: TRACKING_INTERVALS.staleMs,
    retry: shouldPoll(options) ? shouldRetryLiveRequest : false,
    enabled: enabled && validEventId,
  });

  return query;
}

export function useAthleteSearch(
  eventId: string,
  q: string,
  mode: AthleteSearchMode = "name",
  enabled = true,
  source: "auto" | "live" | "results" = "auto",
) {
  const validEventId = hasValidEventId(eventId);
  const resolvedEventId = validEventId ? eventId.trim() : "disabled";
  const queryText = q.trim();
  const resolvedSource = source === "auto" ? "live" : source;
  const resultsQuery = useEventResults(
    resolvedEventId,
    enabled && validEventId && resolvedSource === "results",
  );
  const inferredMode = inferAthleteSearchMode(queryText, mode);
  const liveSearchQuery = useQuery<AthleteSearchQueryResult>({
    queryKey: queryKeys.athleteSearch(resolvedEventId, queryText, inferredMode),
    queryFn: async ({ signal }) => {
      if (!validEventId) throw new Error("EVENT_ID_REQUIRED");
      if (process.env.NODE_ENV !== "production") {
        console.log("[athlete-search] live index request", {
          eventId: resolvedEventId,
          query: queryText,
          mode: inferredMode,
          endpoint: `/api/live/events/${resolvedEventId}/search`,
          kvOnly: 1,
        });
      }
      const res = await repositories.athlete.search(
        resolvedEventId,
        queryText,
        inferredMode,
        signal,
      );
      const visibilityDisabled =
        res.publicAthleteVisibility === false ||
        res.visibilityEnabled === false ||
        res.source === "visibility_lock";
      const rows = visibilityDisabled
        ? []
        : mapAthleteMatches(
            searchRowsFromContract(
              {
                data: {
                  rows: res.matches,
                  source: res.source,
                  publicAthleteVisibility: res.publicAthleteVisibility,
                  visibilityEnabled: res.visibilityEnabled,
                },
              },
              inferredMode,
              queryText,
            ),
          );
      const state = visibilityDisabled
        ? "visibility-disabled"
        : rows.length > 0
          ? "found"
          : "not-found";

      if (process.env.NODE_ENV !== "production") {
        console.log("[athlete-search] final UI state", {
          eventId: resolvedEventId,
          q: queryText,
          state,
          count: rows.length,
          rows,
          visibilityVersion: res.visibilityVersion,
        });
      }
      return { rows, state, visibilityVersion: res.visibilityVersion };
    },
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    retry: false,
    enabled:
      enabled &&
      validEventId &&
      Boolean(queryText) &&
      resolvedSource === "live",
  });
  const results = useMemo(() => {
    const query = queryText;
    if (!query) return [];
    if (resolvedSource === "live" && !enabled) return [];
    if (resolvedSource === "results") {
      return (resultsQuery.data ?? [])
        .filter((result) => {
          const haystack = [
            result.bib,
            result.bibNumber,
            result.displayName,
            result.name,
            result.fullName,
            result.contest,
            result.contestName,
            result.ageGroup,
            result.category,
          ]
            .map((value) => text(value).toLowerCase())
            .join(" ");
          return haystack.includes(query.toLowerCase());
        })
        .map(normalizeOfficialSummary);
    }
    return liveSearchQuery.data?.rows ?? [];
  }, [
    enabled,
    liveSearchQuery.data,
    queryText,
    resultsQuery.data,
    resolvedSource,
  ]);
  const state =
    resolvedSource === "live" && !enabled
      ? "idle"
      : resolvedSource === "live" &&
          liveSearchQuery.data?.state === "visibility-disabled"
        ? "visibility-disabled"
        : queryText && !liveSearchQuery.isFetching && results.length === 0
          ? "not-found"
          : results.length > 0
            ? "found"
            : "idle";

  return {
    data: results,
    rows: results,
    count: results.length,
    state,
    isFetching:
      resolvedSource === "results"
        ? resultsQuery.isFetching
        : liveSearchQuery.isFetching,
    isLoading:
      resolvedSource === "results"
        ? resultsQuery.isLoading
        : liveSearchQuery.isLoading,
    isError:
      resolvedSource === "results"
        ? resultsQuery.isError
        : liveSearchQuery.isError,
    refetch:
      resolvedSource === "results"
        ? resultsQuery.refetch
        : liveSearchQuery.refetch,
  };
}

export function useAthleteDetail(
  eventId: string,
  params: {
    bib?: string;
    bookingId?: string;
    providerUuid?: string;
    providerAthleteUuid?: string;
    providerTimingUuid?: string;
    providerRecordId?: string;
    participantUuid?: string;
    athleteUid?: string;
    email?: string;
    providerContestUuid?: string;
    courseVersion?: string;
    activeVersion?: string;
  },
  options: PollingOptions = {},
  source: "auto" | "live" | "results" = "auto",
) {
  const { enabled = true } = options;
  const normalizedParams = useMemo(() => ({
    bib: firstText(params.bib) || undefined,
    athleteUid: firstText(params.athleteUid) || undefined,
    bookingId: firstText(params.bookingId) || undefined,
    providerUuid: firstText(params.providerUuid) || undefined,
    providerAthleteUuid: firstText(params.providerAthleteUuid) || undefined,
    providerTimingUuid: firstText(params.providerTimingUuid) || undefined,
    providerRecordId: firstText(params.providerRecordId) || undefined,
    participantUuid: firstText(params.participantUuid) || undefined,
    email: firstText(params.email) || undefined,
    providerContestUuid: firstText(params.providerContestUuid) || undefined,
    courseVersion: firstText(params.courseVersion) || undefined,
    activeVersion: firstText(params.activeVersion) || undefined,
  }), [
    params.activeVersion,
    params.athleteUid,
    params.bib,
    params.bookingId,
    params.courseVersion,
    params.email,
    params.participantUuid,
    params.providerAthleteUuid,
    params.providerContestUuid,
    params.providerRecordId,
    params.providerTimingUuid,
    params.providerUuid,
  ]);
  const resolvedSource = source === "auto" ? "live" : source;
  const key =
    normalizedParams.bib ??
    normalizedParams.athleteUid ??
    normalizedParams.bookingId ??
    normalizedParams.providerUuid ??
    normalizedParams.email ??
    normalizedParams.participantUuid ??
    normalizedParams.providerAthleteUuid ??
    normalizedParams.providerTimingUuid ??
    normalizedParams.providerRecordId ??
    "";
  const detailQueryKey = useMemo(
    () => queryKeys.athleteDetail(eventId, normalizedParams),
    [eventId, normalizedParams],
  );
  const query = useQuery({
    queryKey: detailQueryKey,
    queryFn: async ({ signal }) => {
      const mode = resolvedSource === "results" ? "results" : "live";
      return repositories.athlete.getDetail(
        eventId,
        normalizedParams,
        signal,
        mode,
        resolvedSource === "live" ? "athleteOnly" : "full",
      );
    },
    staleTime: resolvedSource === "live" ? 0 : 30_000,
    gcTime: 30_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    retry: (failureCount, error) => {
      const status = (error as unknown as ApiError | undefined)?.status ?? null;
      if (status === 401 || status === 403 || status === 404) return false;
      return failureCount < 1;
    },
    retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 8_000),
    refetchInterval:
      resolvedSource === "live" && shouldPoll(options)
        ? TRACKING_INTERVALS.athleteDetailRefetchMs
        : false,
    enabled: enabled && Boolean(eventId) && Boolean(key),
  });

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    if (!eventId && !key) return;
    console.log("[athlete-detail] query status", {
      eventId,
      status: query.status,
      isLoading: query.isLoading,
      isError: query.isError,
      hasData: Boolean(query.data),
      error: query.error,
    });
  }, [
    eventId,
    key,
    query.data,
    query.error,
    query.isError,
    query.isLoading,
    query.status,
  ]);

  return query;
}

export function useCourseMap(eventId: string, enabled = true) {
  const validEventId = hasValidEventId(eventId);
  const resolvedEventId = validEventId ? eventId.trim() : "disabled";
  const sessionStatus = useSession((state) => state.status);
  const sessionUid = useSession((state) => state.user?.uid);
  // Admin-only APIs intentionally return 404 to unauthenticated callers. On a
  // cold launch Firebase can still be restoring the user when this screen
  // mounts; querying during that window cached a false "no course" result for
  // an hour. Wait for auth resolution and keep public/account course caches
  // isolated so a guest response can never hide an admin-visible GPX.
  const accessScope = sessionStatus === "authenticated"
    ? `account:${sessionUid || "authenticated"}`
    : sessionStatus;
  return useQuery({
    queryKey: [...queryKeys.courseMap(resolvedEventId), accessScope],
    queryFn: async ({ signal }) => {
      if (!validEventId) throw new Error("EVENT_ID_REQUIRED");
      try {
        return await repositories.course.getCourseMapResources(
          resolvedEventId,
          signal,
        );
      } catch (error) {
        if ((error as ApiError | undefined)?.status === 404) {
          if (process.env.NODE_ENV !== "production") {
            console.log("[event-course-index] using ticket course fallback", {
              eventId: resolvedEventId,
            });
          }
          return null;
        }
        throw error;
      }
    },
    staleTime: TRACKING_INTERVALS.courseStaleMs,
    refetchOnMount: false,
    refetchOnReconnect: true,
    retry: shouldRetryLiveRequest,
    enabled: enabled && validEventId && sessionStatus !== "loading",
  });
}

/**
 * Real course geometry for the live map: reads the event's course config from
 * the backend (Firestore-backed course maps) and resolves the per-leg GPX into
 * polylines + markers. Static per event → cached aggressively. Returns null
 * when the event has no GPX configured (falls back to the text/summary view).
 */
export function useCourseGeometry(
  eventId: string,
  fallbackConfig?: Record<string, unknown> | null,
  enabled = true,
  selection?: CourseMapSelection,
) {
  const validEventId = hasValidEventId(eventId);
  const resolvedEventId = validEventId ? eventId.trim() : "disabled";
  const resourcesQuery = useCourseMap(resolvedEventId, enabled);
  const courseMapVersion = JSON.stringify(
    ((resourcesQuery.data?.courseMap?.ticketDefinitions as Record<string, unknown>[] | undefined) ?? []).map(
      (ticket) => ({ id: ticket.id, courseMaps: ticket.courseMaps }),
    ),
  );
  const canonicalCourseVersion = JSON.stringify(
    ((resourcesQuery.data?.courseIndex?.contests as Record<string, unknown>[] | undefined) ?? []).map(
      (contest) => ({
        id: contest.id ?? contest.contestId ?? contest.providerContestUuid,
        legs: contest.legs,
      }),
    ),
  );
  const selectionKey = [
    firstText(selection?.ticketId),
    firstText(selection?.contestId),
    firstText(selection?.contestName),
  ].join(":");
  return useQuery({
    queryKey: [
      ...queryKeys.courseMap(resolvedEventId),
      "geometry-v3-map-timing-points",
      selectionKey,
      courseMapVersion,
      canonicalCourseVersion,
    ],
    queryFn: async ({ signal }) => {
      if (!validEventId) throw new Error("EVENT_ID_REQUIRED");
      const config = resourcesQuery.data?.courseMap;
      const geometry = config
        ? await resolveCourseGeometry(
            config,
            (url) => httpText(url, signal),
            selection,
          )
        : undefined;
      if (geometry) return geometry;
      const canonicalGeometry = resourcesQuery.data?.courseIndex
        ? await resolveCourseGeometry(
            resourcesQuery.data.courseIndex as unknown as Record<string, unknown>,
            (url) => httpText(url, signal),
            selection,
          )
        : undefined;
      if (canonicalGeometry) return canonicalGeometry;
      const fallbackGeometry = fallbackConfig
        ? await resolveCourseGeometry(
            fallbackConfig,
            (url) => httpText(url, signal),
            selection,
          )
        : undefined;
      if (process.env.NODE_ENV !== "production") {
        console.log("[course-geometry] fallback", {
          eventId: resolvedEventId,
          apiGeometry: Boolean(geometry),
          canonicalGeometry: Boolean(canonicalGeometry),
          fallbackProvided: Boolean(fallbackConfig),
          fallbackGeometry: Boolean(fallbackGeometry),
        });
      }
      return fallbackGeometry ?? null;
    },
    staleTime: TRACKING_INTERVALS.courseStaleMs,
    gcTime: TRACKING_INTERVALS.courseStaleMs,
    retry: shouldRetryLiveRequest,
    enabled:
      enabled &&
      validEventId &&
      !resourcesQuery.isLoading &&
      (Boolean(resourcesQuery.data?.courseMap) ||
        Boolean(resourcesQuery.data?.courseIndex) ||
        Boolean(fallbackConfig)),
  });
}
