import { useQuery } from "@tanstack/react-query";

import { repositories } from "@/core/repositories";
import { queryKeys } from "@/core/services/query/queryKeys";

const STALE_MS = 60_000;

function hasValidEventId(value: unknown): value is string {
  const eventId = String(value ?? "").trim();
  return Boolean(eventId && eventId !== "undefined" && eventId !== "null");
}

function shouldRetryLiveRequest(failureCount: number, error: unknown): boolean {
  const status = (error as { status?: number } | undefined)?.status;
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

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function participantKey(participant: Record<string, unknown>): string {
  const bib = text(participant.bib) || text(participant.bibNumber);
  const contest =
    text(participant.contestName) ||
    text(participant.providerContestName) ||
    text(participant.contestUuid) ||
    text(participant.providerContestUuid);
  const name =
    text(participant.name) ||
    text(participant.displayName) ||
    text(participant.fullName);
  return (
    (bib && contest ? `bib:${bib}:contest:${contest}` : "") ||
    (bib && name ? `bib:${bib}:name:${name.toLowerCase()}` : "") ||
    text(participant.participantUuid) ||
    text(participant.providerUuid) ||
    text(participant.providerAthleteUuid) ||
    text(participant.providerTimingUuid) ||
    text(participant.providerRecordId) ||
    text(participant.bookingId) ||
    text(participant.bib) ||
    JSON.stringify(participant)
  );
}

function isLikelyParticipant(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Boolean(
    text(record.participantUuid) ||
    text(record.providerUuid) ||
    text(record.providerAthleteUuid) ||
    text(record.providerTimingUuid) ||
    text(record.providerRecordId) ||
    text(record.bookingId) ||
    text(record.athleteUid) ||
    text(record.bib) ||
    text(record.bibNumber) ||
    text(record.name) ||
    text(record.displayName) ||
    text(record.fullName) ||
    text(record.email),
  );
}

function extractParticipants(payload: unknown): unknown[] {
  const visited = new Set<unknown>();
  const collect = (value: unknown, depth = 0): unknown[] => {
    if (!value || depth > 5 || visited.has(value)) return [];
    if (typeof value === "object") visited.add(value);
    if (Array.isArray(value))
      return value.flatMap((item) => collect(item, depth + 1));
    if (isLikelyParticipant(value)) return [value];
    if (typeof value !== "object") return [];
    const record = value as Record<string, unknown>;
    const rows = [
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
    ].flatMap((item) => collect(item, depth + 1));
    return rows.length > 0
      ? rows
      : Object.values(record).flatMap((item) => collect(item, depth + 1));
  };
  return collect(payload);
}

function dedupeParticipants(participants: unknown[]): unknown[] {
  const seen = new Set<string>();
  const unique: unknown[] = [];
  for (const participant of participants) {
    if (!participant || typeof participant !== "object") continue;
    const key = participantKey(participant as Record<string, unknown>);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(participant);
  }
  return unique;
}

export type PublicLiveTrackingState =
  "visibility-disabled" | "data-pending" | "ready";

function boolFromPayload(
  payload: Record<string, unknown> | undefined,
  key: string,
): boolean | undefined {
  const direct = payload?.[key];
  if (typeof direct === "boolean") return direct;
  const data =
    payload?.data && typeof payload.data === "object"
      ? (payload.data as Record<string, unknown>)
      : undefined;
  const nested = data?.[key];
  return typeof nested === "boolean" ? nested : undefined;
}

function numberFromPayload(
  payload: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const direct = payload?.[key];
  if (typeof direct === "number" && Number.isFinite(direct)) return direct;
  const data =
    payload?.data && typeof payload.data === "object"
      ? (payload.data as Record<string, unknown>)
      : undefined;
  const nested = data?.[key];
  return typeof nested === "number" && Number.isFinite(nested)
    ? nested
    : undefined;
}

function sourceFromPayload(
  payload: Record<string, unknown> | undefined,
): string {
  const data =
    payload?.data && typeof payload.data === "object"
      ? (payload.data as Record<string, unknown>)
      : undefined;
  return text(payload?.source) || text(data?.source);
}

function normalizeTrackingContract(
  res: Record<string, unknown>,
  participants: unknown[],
) {
  const source = sourceFromPayload(res);
  const publicAthleteVisibility = boolFromPayload(
    res,
    "publicAthleteVisibility",
  );
  const visibilityEnabled = boolFromPayload(res, "visibilityEnabled");
  const visibilityVersion = numberFromPayload(res, "visibilityVersion");
  const visibilityDisabled =
    source === "visibility_lock" ||
    publicAthleteVisibility === false ||
    visibilityEnabled === false;
  const effectivePublicAthleteVisibility = publicAthleteVisibility !== false;
  const effectiveVisibilityEnabled = visibilityEnabled !== false;

  if (visibilityDisabled) {
    return {
      state: "visibility-disabled" as const,
      participants: [],
      count: 0,
      rows: [],
      source: source || "visibility_lock",
      publicAthleteVisibility: false,
      visibilityEnabled: false,
      visibilityVersion,
    };
  }

  if (source === "no_data" && participants.length === 0) {
    return {
      state: "data-pending" as const,
      participants: [],
      count: 0,
      rows: [],
      source,
      publicAthleteVisibility: effectivePublicAthleteVisibility,
      visibilityEnabled: effectiveVisibilityEnabled,
      visibilityVersion,
    };
  }

  return {
    state: "ready" as const,
    participants,
    count: participants.length,
    rows: participants,
    source,
    publicAthleteVisibility: effectivePublicAthleteVisibility,
    visibilityEnabled: effectiveVisibilityEnabled,
    visibilityVersion,
  };
}

export function useEventTracking(
  eventId: string,
  enabled = true,
  pollEnabled = true,
) {
  const validEventId = hasValidEventId(eventId);
  const resolvedEventId = validEventId ? eventId.trim() : "disabled";
  return useQuery({
    queryKey: queryKeys.events.tracking(resolvedEventId),
    queryFn: async ({ signal }) => {
      if (!validEventId) throw new Error("EVENT_ID_REQUIRED");
      const res = await repositories.tracking.getOverview(
        resolvedEventId,
        signal,
      );
      const response = res as Record<string, unknown>;
      const contractSource = sourceFromPayload(response);
      const publicAthleteVisibility = boolFromPayload(
        response,
        "publicAthleteVisibility",
      );
      const visibilityEnabled = boolFromPayload(response, "visibilityEnabled");
      const visibilityLocked =
        publicAthleteVisibility === false ||
        visibilityEnabled === false ||
        contractSource === "visibility_lock";
      const noData = contractSource === "no_data";
      const uniqueParticipants: unknown[] = [];
      const baseContract = normalizeTrackingContract(response, uniqueParticipants);
      const data = response.data && typeof response.data === "object" ? response.data as Record<string, unknown> : {};
      const availability = data.availability && typeof data.availability === "object" ? data.availability as Record<string, unknown> : {};
      const contract = String(availability.state ?? "").toUpperCase() === "DATA_PENDING"
        ? { ...baseContract, state: "data-pending" as const }
        : baseContract;
      if (process.env.NODE_ENV !== "production") {
        const count = uniqueParticipants.length;
        console.log("[tracking]", {
          eventId,
          kvKeys: [`live:event:${resolvedEventId}:participant:index`],
          liveAthletes: count,
          hit: count > 0,
          state: contract.state,
          source: contract.source,
        });
      }
      return { ...res, ...contract, participants: contract.participants };
    },
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: pollEnabled && validEventId ? STALE_MS : false,
    retry: shouldRetryLiveRequest,
    enabled: enabled && validEventId,
  });
}

export function useEventCourseConfig(eventId: string, enabled = true) {
  const validEventId = hasValidEventId(eventId);
  const resolvedEventId = validEventId ? eventId.trim() : "disabled";
  return useQuery<Record<string, unknown>>({
    queryKey: ["events", "course-config", resolvedEventId],
    queryFn: ({ signal }) => {
      if (!validEventId) throw new Error("EVENT_ID_REQUIRED");
      return repositories.course.getCourseConfig(resolvedEventId, signal);
    },
    staleTime: 5 * 60_000,
    retry: shouldRetryLiveRequest,
    enabled: enabled && validEventId,
  });
}

export function useEventTickets(eventId: string, enabled = true) {
  const validEventId = hasValidEventId(eventId);
  const resolvedEventId = validEventId ? eventId.trim() : "disabled";
  return useQuery({
    queryKey: queryKeys.events.tickets(resolvedEventId),
    queryFn: async ({ signal }) => {
      if (!validEventId) throw new Error("EVENT_ID_REQUIRED");
      return repositories.events.getEventTickets(resolvedEventId, signal);
    },
    staleTime: 5 * 60_000,
    retry: shouldRetryLiveRequest,
    enabled: enabled && validEventId,
  });
}
