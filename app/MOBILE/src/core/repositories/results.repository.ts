import { authenticatedJson } from "@/core/auth/authenticatedFetch";
import { getCountryDisplayName } from "@/core/utils";
import { api } from "@/core/services/api";
import type { AthleteModalResponse } from "@/core/types";

type RawLeaderboardResultRow = {
  id?: string;
  docId?: string;
  bib?: string;
  bibNumber?: string;
  athleteUid?: string;
  athleteId?: string;
  email?: string | null;
  displayName?: string;
  name?: string;
  fullName?: string;
  profilePhotoUrl?: string | null;
  photoUrl?: string | null;
  photoURL?: string | null;
  avatarUrl?: string | null;
  displayPhoto?: string | null;
  club?: string | null;
  clubName?: string | null;
  clubNameAtRace?: string | null;
  countryAtRace?: string | null;
  country?: string | null;
  countryName?: string | null;
  nationality?: string | null;
  countryCode?: string | null;
  contest?: string | null;
  contestName?: string | null;
  raceCategory?: string | null;
  ticketName?: string | null;
  ageGroup?: string | null;
  category?: string | null;
  gender?: string | null;
  currentLeg?: string | null;
  gap?: string | null;
  status?: string | null;
  statusNormalized?: string | null;
  overallTime?: string | null;
  chipTime?: string | null;
  finishTime?: string | null;
  overallPosition?: number | string | null;
  overallRank?: number | string | null;
  swim?: string | null;
  bike?: string | null;
  run?: string | null;
  t1?: string | null;
  t2?: string | null;
  team?: string | null;
  teamName?: string | null;
  raceYear?: string | number | null;
  pointsAwarded?: number | string | null;
  rank?: number | string | null;
  oRank?: number | string | null;
  gRank?: number | string | null;
  cRank?: number | string | null;
  liveTrackingVisibility?: string | null;
  visibility?: string | null;
};

export type ResultModel = {
  id: string;
  eventTitle: string;
  dateLabel: string;
  finishTime: string;
  position: string;
  pace?: string;
};

type RawResultRow = {
  id?: string;
  docId?: string;
  eventTitle?: string;
  eventName?: string;
  dateLabel?: string;
  raceDate?: string;
  finishTime?: string;
  chipTime?: string;
  position?: string | number | null;
  overallPosition?: string | number | null;
  overallRank?: string | number | null;
  oRank?: string | number | null;
  gRank?: string | number | null;
  cRank?: string | number | null;
  pace?: string;
  raceCategory?: string;
  eventCategory?: string;
  status?: string;
  statusNormalized?: string;
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function resolveCountryName(...values: unknown[]): string | null {
  for (const value of values) {
    const candidate = getCountryDisplayName(text(value));
    if (candidate) return candidate;
  }
  return null;
}

function toNumberOrString(value: unknown): string | number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function normalizeOfficialSplits(
  value: unknown,
): { label: string; time: string }[] {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    const record =
      item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    return {
      label:
        text(record.label || record.segment || record.name) || `S${index + 1}`,
      time: text(record.time) || String(Number(record.time ?? 0) || 0),
    };
  });
}

function buildOfficialSplitsFromPayload(
  payload: Record<string, unknown>,
): { label: string; time: string }[] {
  const direct = normalizeOfficialSplits(payload.splits);
  if (direct.length > 0) return direct;

  const run1 = text(payload.run1 ?? payload.run_1);
  const run2 = text(payload.run2 ?? payload.run_2);
  if (run1 || run2) {
    return [
      { label: "Run 1", time: run1 },
      { label: "T1", time: text(payload.t1) },
      { label: "Bike", time: text(payload.bike) },
      { label: "T2", time: text(payload.t2) },
      { label: "Run 2", time: run2 },
    ].filter((item): item is { label: string; time: string } =>
      Boolean(item.time),
    );
  }

  return [
    { label: "Swim", time: text(payload.swim) },
    { label: "T1", time: text(payload.t1) },
    { label: "Bike", time: text(payload.bike) },
    { label: "T2", time: text(payload.t2) },
    { label: "Run", time: text(payload.run) },
  ].filter((item): item is { label: string; time: string } =>
    Boolean(item.time),
  );
}

function normalizeContestSplits(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    const record =
      item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    return {
      segment: text(record.segment || record.label) || `S${index + 1}`,
      name: text(record.name || record.label) || undefined,
      distance:
        typeof record.distance === "number" && Number.isFinite(record.distance)
          ? record.distance
          : Number(record.distance ?? 0) || 0,
      time:
        typeof record.time === "number" && Number.isFinite(record.time)
          ? record.time
          : Number(record.time ?? 0) || 0,
    };
  });
}

function normalizeResultRow(row: RawResultRow): ResultModel {
  const position =
    text(
      row.overallPosition ??
        row.overallRank ??
        row.position ??
        row.oRank ??
        row.gRank ??
        row.cRank,
    ) || "—";
  return {
    id:
      text(row.id ?? row.docId ?? row.eventName ?? row.eventTitle) ||
      `${text(row.eventName ?? row.eventTitle)}:${position}`,
    eventTitle: text(row.eventTitle ?? row.eventName) || "Race Result",
    dateLabel: text(row.dateLabel ?? row.raceDate) || "—",
    finishTime: text(row.finishTime ?? row.chipTime) || "—",
    position,
    pace: text(row.pace) || undefined,
  };
}

/**
 * Results repository.
 *
 * Results are fetched from the KV-backed live tracking endpoints so local dev
 * and production resolve the same source of truth.
 */
export interface IResultsRepository {
  getAthleteResults(
    eventId: string,
    bibNumber: string,
    signal?: AbortSignal,
  ): Promise<unknown>;
  getEventResults(
    eventId: string,
    signal?: AbortSignal,
  ): Promise<RawLeaderboardResultRow[]>;
  getMyResults(): Promise<ResultModel[]>;
}

function normalizeEventResultRow(
  row: RawLeaderboardResultRow,
  index: number,
): RawLeaderboardResultRow {
  const bib = text(row.bibNumber ?? row.bib);
  const name = text(row.displayName ?? row.fullName ?? row.name) || "Athlete";
  const time = text(row.overallTime ?? row.chipTime ?? row.finishTime);
  const rank = row.rank ?? row.oRank ?? row.gRank ?? row.cRank ?? index + 1;
  const country = resolveCountryName(
    row.countryAtRace,
    row.country,
    row.countryName,
    row.nationality,
    row.countryCode,
  );
  return {
    ...row,
    id:
      text(row.id ?? row.docId ?? row.athleteUid ?? bib) ||
      `${name}:${bib || index + 1}`,
    bib: bib || undefined,
    bibNumber: bib || undefined,
    athleteUid: text(row.athleteUid) || undefined,
    athleteId: text(row.athleteId) || undefined,
    email: text(row.email) || undefined,
    avatarUrl:
      row.avatarUrl ??
      row.profilePhotoUrl ??
      row.photoUrl ??
      row.photoURL ??
      row.displayPhoto ??
      null,
    displayName: name,
    name,
    fullName: text(row.fullName) || name,
    profilePhotoUrl:
      row.profilePhotoUrl ??
      row.photoUrl ??
      row.photoURL ??
      row.avatarUrl ??
      row.displayPhoto ??
      null,
    photoUrl:
      row.photoUrl ??
      row.photoURL ??
      row.profilePhotoUrl ??
      row.avatarUrl ??
      row.displayPhoto ??
      null,
    photoURL:
      row.photoURL ??
      row.photoUrl ??
      row.profilePhotoUrl ??
      row.avatarUrl ??
      row.displayPhoto ??
      null,
    displayPhoto:
      row.displayPhoto ??
      row.profilePhotoUrl ??
      row.photoUrl ??
      row.photoURL ??
      row.avatarUrl ??
      null,
    club: text(row.club ?? row.clubName ?? row.clubNameAtRace) || null,
    clubName: text(row.clubName ?? row.club ?? row.clubNameAtRace) || null,
    clubNameAtRace:
      text(row.clubNameAtRace ?? row.clubName ?? row.club) || null,
    country: country || null,
    countryName: country || null,
    nationality: text(row.nationality) || undefined,
    countryCode: text(row.countryCode) || undefined,
    countryAtRace: text(row.countryAtRace) || undefined,
    contest: text(row.contest ?? row.contestName ?? row.raceCategory) || null,
    contestName:
      text(
        row.contestName ?? row.contest ?? row.raceCategory ?? row.ticketName,
      ) || null,
    raceCategory:
      text(
        row.raceCategory ?? row.ticketName ?? row.contest ?? row.contestName,
      ) || null,
    ageGroup: text(row.ageGroup ?? row.category) || undefined,
    category: text(row.category ?? row.ageGroup) || undefined,
    gender: text(row.gender) || undefined,
    currentLeg: text(row.currentLeg) || undefined,
    gap: text(row.gap) || undefined,
    status: text(row.status ?? row.statusNormalized) || undefined,
    statusNormalized: text(row.statusNormalized ?? row.status) || undefined,
    overallTime: time || undefined,
    chipTime: time || undefined,
    finishTime: time || undefined,
    overallPosition:
      row.overallPosition ?? row.overallRank ?? row.oRank ?? row.rank ?? null,
    overallRank:
      row.overallRank ?? row.overallPosition ?? row.oRank ?? row.rank ?? null,
    swim: text(row.swim) || undefined,
    bike: text(row.bike) || undefined,
    run: text(row.run) || undefined,
    t1: text(row.t1) || undefined,
    t2: text(row.t2) || undefined,
    team: text(row.team ?? row.teamName) || undefined,
    teamName: text(row.teamName ?? row.team) || undefined,
    raceYear: row.raceYear ?? undefined,
    pointsAwarded: row.pointsAwarded ?? undefined,
    rank,
    oRank: row.oRank ?? null,
    gRank: row.gRank ?? null,
    cRank: row.cRank ?? null,
    liveTrackingVisibility:
      text(row.liveTrackingVisibility ?? row.visibility) || undefined,
    visibility: text(row.visibility ?? row.liveTrackingVisibility) || undefined,
  };
}

function normalizeOfficialAthleteResponse(
  eventId: string,
  identifier: string,
  raw: unknown,
): AthleteModalResponse {
  const envelope =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const payload = (envelope.result ??
    envelope.data ??
    envelope.athlete ??
    raw) as Record<string, unknown>;
  const athleteName = text(
    payload.name ?? payload.displayName ?? payload.fullName,
  );
  const athleteCategory = text(
    payload.category ?? payload.ageGroup ?? payload.raceCategory,
  );
  const athleteClub = text(
    payload.club ?? payload.clubName ?? payload.clubNameAtRace,
  );
  const athleteGender = text(payload.gender);
  const athleteUid =
    text(payload.athleteUid ?? payload.athleteId ?? payload.id ?? identifier) ||
    identifier;
  const finishTime = text(
    payload.chipTime ?? payload.overallTime ?? payload.finishTime,
  );
  const athleteCountry = resolveCountryName(
    payload.countryAtRace,
    payload.country,
    payload.countryName,
    payload.nationality,
    payload.countryCode,
  );

  return {
    success: true,
    eventId,
    result: {
      status: text(payload.status ?? payload.statusNormalized ?? "FINISHED"),
      chipTime: finishTime || undefined,
      overallRank: toNumberOrString(
        payload.overallRank ??
          payload.overallPosition ??
          payload.oRank ??
          payload.rank,
      ),
      genderRank: toNumberOrString(payload.genderRank ?? payload.gRank),
      categoryRank: toNumberOrString(payload.categoryRank ?? payload.cRank),
      splits: buildOfficialSplitsFromPayload(payload),
      club: athleteClub || undefined,
      points: toNumberOrString(payload.pointsAwarded ?? payload.points),
      location:
        text(payload.location ?? payload.city ?? payload.state) || undefined,
      eventCategory:
        text(payload.eventCategory ?? payload.contest ?? payload.contestName) ||
        undefined,
      raceCategory:
        text(payload.raceCategory ?? payload.category ?? athleteCategory) ||
        undefined,
      raceDate:
        text(payload.raceDate ?? payload.date ?? payload.eventDate) ||
        undefined,
      // Rows returned by the uploaded-results endpoint are published results.
      provisional: false,
    },
    athlete: {
      id: athleteUid,
      bib: text(payload.bib ?? payload.bibNumber) || identifier,
      name: athleteName || `Bib ${identifier}`,
      fullName: athleteName || `Bib ${identifier}`,
      category: athleteCategory || undefined,
      ageGroupName: athleteCategory || undefined,
      gender: athleteGender || undefined,
      club: athleteClub || undefined,
      clubName: athleteClub || undefined,
      contest: text(payload.contest ?? payload.eventCategory) || undefined,
      contestName:
        text(payload.contestName ?? payload.raceCategory) || undefined,
      country: athleteCountry || undefined,
      city: text(payload.city) || undefined,
      state: text(payload.state) || undefined,
      photoURL:
        text(
          payload.profilePhotoUrl ??
            payload.photoUrl ??
            payload.photoURL ??
            payload.avatarUrl ??
            payload.displayPhoto,
        ) || null,
      photoUrl:
        text(
          payload.profilePhotoUrl ??
            payload.photoUrl ??
            payload.photoURL ??
            payload.avatarUrl ??
            payload.displayPhoto,
        ) || null,
      avatarUrl:
        text(
          payload.profilePhotoUrl ??
            payload.photoUrl ??
            payload.photoURL ??
            payload.avatarUrl ??
            payload.displayPhoto,
        ) || null,
      registrationStatus: text(payload.status ?? "FINISHED") || undefined,
      ticketId: text(payload.ticketId ?? payload.ticket_id) || undefined,
      ticketName:
        text(
          payload.ticketName ?? payload.ticket_name ?? payload.raceCategory,
        ) || undefined,
      visibility: "PUBLIC",
      liveTrackingVisibility: "PUBLIC",
      displayName: athleteName || `Bib ${identifier}`,
      displayPhoto:
        text(
          payload.profilePhotoUrl ??
            payload.photoUrl ??
            payload.photoURL ??
            payload.avatarUrl ??
            payload.displayPhoto,
        ) || null,
      profilePhotoUrl:
        text(
          payload.profilePhotoUrl ??
            payload.photoUrl ??
            payload.photoURL ??
            payload.avatarUrl ??
            payload.displayPhoto,
        ) || undefined,
      displayClub: athleteClub || undefined,
      displayCountry: athleteCountry || undefined,
      displayLocation:
        text(payload.location ?? payload.city ?? payload.state) || undefined,
      status: "finished",
      lifecycleLabel: "Finished",
      eventName: text(payload.eventName ?? payload.eventTitle) || undefined,
      eventDate: text(payload.eventDate ?? payload.raceDate) || undefined,
      customSlug:
        text(payload.customSlug ?? payload.eventSlug ?? payload.event_slug) ||
        undefined,
      eventSlug:
        text(payload.eventSlug ?? payload.event_slug ?? payload.customSlug) ||
        undefined,
      scheduledStart: text(payload.scheduledStart) || undefined,
      currentLegName: undefined,
      currentSplitName: undefined,
      distanceCoveredKm: undefined,
      distanceRemainingKm: undefined,
      currentPace: undefined,
      averagePace: undefined,
      elapsedTime: finishTime || undefined,
      estimatedFinish: undefined,
      overallRank: toNumberOrString(
        payload.overallRank ??
          payload.overallPosition ??
          payload.oRank ??
          payload.rank,
      ),
      genderRank: toNumberOrString(payload.genderRank ?? payload.gRank),
      ageGroupRank: toNumberOrString(payload.categoryRank ?? payload.cRank),
      clubRank: toNumberOrString(payload.clubRank),
      prediction: null,
      splits: normalizeOfficialSplits(payload.splits),
    },
    participantLive: undefined,
    courseOverview: undefined,
    cutoffs: [],
    nextSplitPrediction: undefined,
    contestContext: {
      splits: normalizeContestSplits(payload.splits),
    },
    timingConfiguration: undefined,
    courseIndex: undefined,
  };
}

export const ProductionResultsRepository: IResultsRepository = {
  getAthleteResults(eventId, bibNumber, signal) {
    const identifier = text(bibNumber);
    const fetchResult = (path: string) => api.json(path, { signal });
    return fetchResult(
      `/api/results/${eventId}/${encodeURIComponent(identifier)}`,
    )
      .then((raw) => normalizeOfficialAthleteResponse(eventId, identifier, raw))
      .catch(async () => {
        try {
          const raw = await fetchResult(
            `/api/results/${eventId}/${identifier}`,
          );
          return normalizeOfficialAthleteResponse(eventId, identifier, raw);
        } catch {
          const raw = await fetchResult(`/api/results/${identifier}`);
          return normalizeOfficialAthleteResponse(eventId, identifier, raw);
        }
      });
  },
  async getEventResults(eventId, signal) {
    try {
      const res = await api.json<{
        success?: boolean;
        data?: RawLeaderboardResultRow[];
        participants?: RawLeaderboardResultRow[];
        results?: RawLeaderboardResultRow[];
        finishers?: RawLeaderboardResultRow[];
        count?: number;
        source?: string;
      }>(`/api/results/${eventId}`, { signal });
      const rows = Array.isArray(res.data)
        ? res.data
        : Array.isArray(res.participants)
          ? res.participants
          : Array.isArray(res.results)
            ? res.results
            : Array.isArray(res.finishers)
              ? res.finishers
              : [];
      if (process.env.NODE_ENV !== "production") {
        console.log("[FinishedEvent]", {
          eventId,
          kvKey: `results:${eventId}`,
          recordCount: rows.length,
          hit: rows.length > 0,
        });
      }
      if (rows.length > 0) {
        return rows.map((row, index) => normalizeEventResultRow(row, index));
      }
    } catch {
      if (process.env.NODE_ENV !== "production") {
        console.log("[FinishedEvent]", {
          eventId,
          kvKey: `results:${eventId}`,
          recordCount: 0,
          hit: false,
        });
      }
      return [];
    }
    return [];
  },
  async getMyResults() {
    const res = await authenticatedJson<
      { recentResults?: ResultModel[] } | { results?: ResultModel[] }
    >("/api/dashboard");
    const payload =
      res && typeof res === "object" && "data" in res
        ? (
            res as {
              data?: { results?: ResultModel[]; recentResults?: ResultModel[] };
            }
          ).data
        : res;
    if (payload && "results" in payload && Array.isArray(payload.results)) {
      return (payload.results as RawResultRow[]).map(normalizeResultRow);
    }
    return payload &&
      "recentResults" in payload &&
      Array.isArray(payload.recentResults)
      ? (payload.recentResults as RawResultRow[]).map(normalizeResultRow)
      : [];
  },
};
