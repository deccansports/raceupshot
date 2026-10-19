import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { authenticatedJson } from "@/core/auth/authenticatedFetch";
import { isDevelopment } from "@/core/constants/env";
import { api } from "@/core/services/api";
import { getCountryDisplayName } from "@/core/utils";

export type BelTier =
  "Gold" | "Silver" | "Bronze" | "Provisional" | "None" | string;

export type DashboardMetric = {
  label: string;
  value: string | number | null;
};

export type AthleteDashboardResult = {
  id?: string;
  event: string;
  date: string;
  contest?: string | null;
  chipTime?: string | null;
  position?: string | number | null;
  pointsEarned?: string | number | null;
  status?: string | null;
  location?: string | null;
  bib?: string | null;
  athleteCategory?: string | null;
  overallRank?: string | number | null;
  genderRank?: string | number | null;
  categoryRank?: string | number | null;
  swim?: string | null;
  t1?: string | null;
  bike?: string | null;
  t2?: string | null;
  run?: string | null;
  certificateUrl?: string | null;
};

type RawDashboardResult = Partial<AthleteDashboardResult> & {
  eventName?: string | null;
  raceDate?: string | null;
  raceCategory?: string | null;
  eventCategory?: string | null;
  statusNormalized?: string | null;
  status?: string | null;
  oRank?: string | number | null;
  gRank?: string | number | null;
  cRank?: string | number | null;
  pointsAwarded?: string | number | null;
  chipTime?: string | null;
  finishTime?: string | null;
};

export type AthleteDashboardRegistration = {
  id?: string;
  eventId?: string;
  bookingId?: string | null;
  ticketId?: string | null;
  ticketName?: string | null;
  ticketStatus?: string | null;
  event: string;
  eventName?: string;
  date?: string | null;
  eventDate?: string | null;
  venueName?: string | null;
  address?: string | null;
  photoUrl?: string | null;
  country?: string | null;
  state?: string | null;
  customSlug?: string | null;
  contest?: string | null;
  contestName?: string | null;
  contests?: string[];
  registrationsCount?: number;
  bib?: string | null;
  status?: string | null;
  registrationStatus?: string | null;
};

export type AthleteDashboardCertificate = {
  id: string;
  title?: string | null;
  event: string;
  date?: string | null;
  downloadUrl?: string | null;
};

export type WatchlistAthlete = {
  id: string;
  name: string;
  bib?: string | null;
  event?: string | null;
  photoUrl?: string | null;
};

export type AthleteLiveRaceStatus = {
  event?: string | null;
  currentLeg?: string | null;
  currentSplit?: string | null;
  progress?: string | number | null;
  estimatedFinish?: string | null;
  lastTimingPoint?: string | null;
  currentPace?: string | null;
  currentSpeed?: string | null;
};

export type AthleteDashboard = {
  athlete: {
    id?: string;
    uid?: string;
    email?: string | null;
    name: string;
    fullName?: string | null;
    photoUrl?: string | null;
    profilePhotoUrl?: string | null;
    photoURL?: string | null;
    profileUrl?: string | null;
    profileURL?: string | null;
    mobile?: string | null;
    belTier?: BelTier | null;
    club?: string | null;
    clubId?: string | null;
    clubName?: string | null;
    affiliatedClub?: string | null;
    affiliatedClubName?: string | null;
    affiliatedClubId?: string | null;
    role?: string | null;
    clubRole?: string | null;
    membershipRole?: string | null;
    isClubOwner?: boolean | string | null;
    ownedClubId?: string | null;
    ownedClubName?: string | null;
    clubHistory?: Record<string, unknown>[];
    country?: string | null;
    state?: string | null;
    city?: string | null;
    belStatus?: string | null;
    liveTrackingPrivacy?: "PUBLIC" | "PRIVATE" | "ANONYMOUS" | string | null;
    trackingVisibility?: "PUBLIC" | "PRIVATE" | "ANONYMOUS" | string | null;
    liveTrackingVisibility?: "PUBLIC" | "PRIVATE" | "ANONYMOUS" | string | null;
    visibility?: "PUBLIC" | "PRIVATE" | "ANONYMOUS" | string | null;
  };
  summary?: {
    currentSeason?: string | number | null;
    upcomingRace?: AthleteDashboardRegistration | null;
    lastRace?: AthleteDashboardResult | null;
    certificatesCount?: number | string | null;
    resultsCount?: number | string | null;
    trainingSummary?: string | null;
    notificationCount?: number | string | null;
    watchlistCount?: number | string | null;
  };
  statistics?: {
    totalRaces?: number | string | null;
    totalFinishes?: number | string | null;
    totalSwimDistance?: number | string | null;
    totalBikeDistance?: number | string | null;
    totalRunDistance?: number | string | null;
    totalTrainingHours?: number | string | null;
    totalBelPoints?: number | string | null;
    currentSeasonPoints?: number | string | null;
  };
  ranking?: {
    overallRank?: number | string | null;
    genderRank?: number | string | null;
    ageGroupRank?: number | string | null;
    clubRank?: number | string | null;
  };
  bel?: {
    season?: number | string | null;
    status?: string | null;
    tier?: BelTier | null;
    points?: number | string | null;
    overallRank?: number | string | null;
    categoryRank?: number | string | null;
    starts?: number | string | null;
    ageCategory?: string | null;
  };
  recentResults?: AthleteDashboardResult[];
  upcomingEvents?: AthleteDashboardRegistration[];
  certificates?: AthleteDashboardCertificate[];
  registrations?: AthleteDashboardRegistration[];
  watchlist?: WatchlistAthlete[];
  liveRaceStatus?: AthleteLiveRaceStatus | null;
};

export type AthleteProfileAggregate = AthleteDashboard & {
  profile?: AthleteDashboard["athlete"];
  user?: Record<string, unknown>;
  registrations?: AthleteDashboardRegistration[];
  bel?: {
    status?: string | null;
    tier?: BelTier | null;
    overallRank?: number | string | null;
    categoryRank?: number | string | null;
    points?: number | string | null;
  };
  training?: Record<string, unknown>;
  stats?: Record<string, unknown>;
  personalBests?: { label: string; value: string | number | null }[];
  seasonSummary?: Record<string, unknown>;
};

const DASHBOARD_CACHE_KEY = "raceupshot.dashboard.cache";
const isWeb = Platform.OS === "web";
let dashboardRequest: Promise<AthleteDashboard> | null = null;
let cachedDashboard: AthleteDashboard | null = null;

function dashboardLog(event: string, details?: Record<string, unknown>) {
  if (!isDevelopment) return;
  console.log(`[dashboard] ${event}`, details ?? {});
}

async function persistDashboardCache(
  dashboard: AthleteDashboard,
): Promise<void> {
  cachedDashboard = dashboard;
  const value = JSON.stringify(dashboard);
  try {
    if (isWeb) {
      globalThis.localStorage?.setItem(DASHBOARD_CACHE_KEY, value);
      return;
    }
    await SecureStore.setItemAsync(DASHBOARD_CACHE_KEY, value);
  } catch {
    /* cache writes should never affect the dashboard */
  }
}

export async function clearDashboardCache(): Promise<void> {
  cachedDashboard = null;
  try {
    if (isWeb) {
      globalThis.localStorage?.removeItem(DASHBOARD_CACHE_KEY);
      return;
    }
    await SecureStore.deleteItemAsync(DASHBOARD_CACHE_KEY);
  } catch {
    /* cache clears should never block auth/logout flows */
  }
}

async function readDashboardCache(): Promise<AthleteDashboard | null> {
  if (cachedDashboard) {
    dashboardLog("cache-hit", { source: "memory" });
    return cachedDashboard;
  }
  try {
    const raw = isWeb
      ? (globalThis.localStorage?.getItem(DASHBOARD_CACHE_KEY) ?? null)
      : await SecureStore.getItemAsync(DASHBOARD_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AthleteDashboard;
    cachedDashboard = parsed;
    dashboardLog("cache-hit", { source: "storage" });
    return parsed;
  } catch {
    return null;
  }
}

function mergeAthleteWithCache(
  next: AthleteDashboard,
  previous: AthleteDashboard | null,
): AthleteDashboard {
  if (!previous) return next;
  return {
    ...previous,
    ...next,
    athlete: {
      ...previous.athlete,
      ...next.athlete,
      country: next.athlete.country ?? previous.athlete.country ?? null,
      clubId: next.athlete.clubId ?? null,
      clubName: next.athlete.clubName ?? null,
      ownedClubName: next.athlete.ownedClubName ?? null,
      affiliatedClub: next.athlete.affiliatedClub ?? null,
      affiliatedClubName: next.athlete.affiliatedClubName ?? null,
      affiliatedClubId: next.athlete.affiliatedClubId ?? null,
      trackingVisibility:
        next.athlete.trackingVisibility ??
        previous.athlete.trackingVisibility ??
        null,
      liveTrackingPrivacy:
        next.athlete.liveTrackingPrivacy ??
        previous.athlete.liveTrackingPrivacy ??
        null,
      liveTrackingVisibility:
        next.athlete.liveTrackingVisibility ??
        previous.athlete.liveTrackingVisibility ??
        null,
    },
    registrations: next.registrations ?? [],
    upcomingEvents: next.upcomingEvents ?? [],
  };
}

export type RankingFilters = {
  season?: string | number;
  gender?: "Overall" | "Male" | "Female" | string;
  ageGroup?: string;
  club?: string;
  country?: string;
  search?: string;
  sort?: string;
  cursor?: string | null;
  limit?: number;
};

export type AthleteRankingEntry = {
  id: string;
  athleteId?: string | null;
  uid?: string | null;
  email?: string | null;
  mobile?: string | null;
  rank: number | string;
  photoUrl?: string | null;
  name: string;
  club?: string | null;
  gender?: string | null;
  genderRank?: number | string | null;
  ageGroup?: string | null;
  ageCategory?: string | null;
  starts?: number | string | null;
  affiliation?: string | null;
  points?: number | string | null;
  totalPoints?: number | string | null;
  tier?: BelTier | null;
  categoryRank?: number | string | null;
  gold?: number | string | null;
  silver?: number | string | null;
  bronze?: number | string | null;
  raceHistory?: Record<string, unknown>[];
  pointsHistory?: { label: string; value: number | string | null }[];
  pointsTrend?: string | null;
  raceBreakdown?: { label: string; value: string | number | null }[];
  country?: string | null;
  racesFinished?: number | string | null;
};

export type ClubRankingEntry = {
  id: string;
  rank: number | string;
  logoUrl?: string | null;
  name: string;
  country?: string | null;
  coachName?: string | null;
  location?: string | null;
  members?: number | string | null;
  totalPoints?: number | string | null;
  points?: number | string | null;
  gold?: number | string | null;
  silver?: number | string | null;
  bronze?: number | string | null;
  totalRaces?: number | string | null;
  events?: number | string | null;
  races?: number | string | null;
  seasonRank?: number | string | null;
  previousRank?: number | string | null;
  movement?: number | string | null;
  averagePoints?: number | string | null;
};

export type PaginatedResponse<T> = {
  items: T[];
  nextCursor?: string | null;
};

export type Workout = {
  id: string;
  title: string;
  duration?: string | null;
  sport?: string | null;
  distance?: string | number | null;
  powerZones?: string[] | null;
  heartRateZones?: string[] | null;
  cadence?: string | null;
  instructions?: string | null;
  intervals?: string[] | null;
  coachNotes?: string | null;
};

export type ScheduledWorkout = Workout & {
  date?: string | null;
  status?: "Completed" | "Missed" | "Upcoming" | string | null;
};

export type TrainingProgress = {
  monthlyStatistics?: DashboardMetric[];
  fitnessTrend?: DashboardMetric[];
  volumeTrend?: DashboardMetric[];
  weeklyHours?: DashboardMetric[];
  monthlyHours?: DashboardMetric[];
  longestRide?: string | number | null;
  longestRun?: string | number | null;
  longestSwim?: string | number | null;
};

export type TrainingDashboard = {
  todayWorkout?: Workout | null;
  weeklyPlan?: ScheduledWorkout[];
  completedSessions?: ScheduledWorkout[];
  nextRace?: AthleteDashboardRegistration | null;
  ftp?: number | string | null;
  heartRateZones?: { zone: string; range: string }[];
  paceZones?: { zone: string; range: string }[];
  coachNotes?: string | null;
  weeklyHours?: number | string | null;
  monthlyHours?: number | string | null;
  progress?: TrainingProgress;
};

type Envelope<T, K extends string> = T | ({ success?: boolean } & Record<K, T>);

type BackendAthlete = Partial<AthleteDashboard["athlete"]> & {
  fullName?: string | null;
  profilePhotoUrl?: string | null;
  photoUrl?: string | null;
  photoURL?: string | null;
  profileUrl?: string | null;
  profileURL?: string | null;
  displayPhoto?: string | null;
  liveTrackingVisibility?: string | null;
  liveTrackingPrivacy?: string | null;
  trackingVisibility?: string | null;
  visibility?: string | null;
  email?: string | null;
  uid?: string | null;
  mobile?: string | null;
  countryName?: string | null;
  clubId?: string | null;
  clubName?: string | null;
  ownedClubName?: string | null;
  affiliatedClub?: string | null;
  affiliatedClubName?: string | null;
  affiliatedClubId?: string | null;
  role?: string | null;
  clubRole?: string | null;
  membershipRole?: string | null;
  isClubOwner?: boolean | string | null;
  ownedClubId?: string | null;
  currentAffiliation?: string | Record<string, unknown> | null;
  clubHistory?: Record<string, unknown>[];
};

type BackendDashboard = Partial<AthleteDashboard> & {
  profile?: BackendAthlete | null;
  athlete?: BackendAthlete | null;
  user?: BackendAthlete | null;
  summary?: AthleteDashboard["summary"];
  statistics?: AthleteDashboard["statistics"];
  ranking?: AthleteDashboard["ranking"];
  rankings?: AthleteDashboard["ranking"] & {
    season?: number | string | null;
    points?: number | string | null;
    racesCount?: number | string | null;
    categoryRank?: number | string | null;
  };
  bel?: AthleteDashboard["bel"];
  results?: RawDashboardResult[];
  raceHistory?: RawDashboardResult[];
  recentResults?: AthleteDashboard["recentResults"];
  events?: RawDashboardRegistration[];
  eventsIndex?: RawDashboardRegistration[];
  registeredEvents?: RawDashboardRegistration[];
  upcomingRegistrations?: RawDashboardRegistration[];
  upcomingEvents?: AthleteDashboardRegistration[];
  certificates?: AthleteDashboard["certificates"];
  notifications?: unknown[];
  registrations?: RawDashboardRegistration[];
  watchlist?: AthleteDashboard["watchlist"];
  liveRaceStatus?: AthleteDashboard["liveRaceStatus"];
  liveEvents?: AthleteDashboard["liveRaceStatus"][];
};

type RawDashboardRegistration = AthleteDashboardRegistration & {
  name?: string | null;
  athleteName?: string | null;
  fullName?: string | null;
  contestName?: string | null;
  raceDate?: string | null;
  ticketId?: string | null;
  ticketName?: string | null;
  ticketStatus?: string | null;
  selectedSubCategory?: string | null;
  categoryName?: string | null;
  bibNumber?: string | null;
  athleteBibNumber?: string | null;
  statusNormalized?: string | null;
};

function toText(value: unknown): string {
  return String(value ?? "").trim();
}

function looksLikeClubId(value: unknown): boolean {
  const text = toText(value);
  if (!text) return false;
  if (text.length >= 12 && /[A-Za-z]/.test(text) && /\d/.test(text))
    return true;
  if (/^[A-Za-z0-9_-]{16,}$/.test(text)) return true;
  return false;
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const candidate = toText(value);
    if (candidate) return candidate;
  }
  return null;
}

function debugModel(label: string, raw: unknown, mapped: unknown) {
  if (!isDevelopment) return;
  console.log(`${label} raw`, raw);
  console.log(`${label} mapped`, mapped);
}

function resolvePhoto(...values: (string | null | undefined)[]): string | null {
  for (const value of values) {
    const text = toText(value);
    if (text) return text;
  }
  return null;
}

function deriveRegistrationStatus(
  values: (string | null | undefined)[],
): string | undefined {
  const normalized = values
    .map((value) => toText(value).toLowerCase())
    .filter(Boolean);
  if (normalized.some((value) => value.includes("live"))) return "live";
  if (
    normalized.some(
      (value) =>
        value.includes("finish") ||
        value.includes("complete") ||
        value.includes("done"),
    )
  ) {
    return "finished";
  }
  if (
    normalized.some(
      (value) =>
        value.includes("upcoming") ||
        value.includes("start") ||
        value.includes("scheduled"),
    )
  ) {
    return "upcoming";
  }
  return values.find((value) => toText(value))
    ? toText(values.find((value) => toText(value)))
    : undefined;
}

function cleanContestLabel(value: string | null | undefined): string | null {
  const text = toText(value);
  if (!text) return null;
  if (/^sub-\d+$/i.test(text)) return null;
  return text;
}

function compactUniqueLabels(values: (string | null | undefined)[]): string[] {
  return [
    ...new Set(
      values
        .map(cleanContestLabel)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
}

function normalizeRegistration(
  registration: RawDashboardRegistration,
): AthleteDashboardRegistration {
  const eventName =
    toText(registration.eventName ?? registration.event) || "Event";
  const contestNames = compactUniqueLabels([
    registration.contestName,
    registration.ticketName,
    registration.contest,
    registration.selectedSubCategory,
    registration.categoryName,
  ]);
  const uniqueContests = contestNames;
  const contest = uniqueContests.length > 0 ? uniqueContests.join(" · ") : null;
  const eventDate =
    registration.raceDate ??
    registration.eventDate ??
    registration.date ??
    null;
  const status = deriveRegistrationStatus([
    registration.registrationStatus,
    registration.ticketStatus,
    registration.status,
    registration.statusNormalized,
  ]);

  return {
    ...registration,
    id:
      registration.id ??
      registration.bookingId ??
      registration.eventId ??
      eventName,
    eventId: registration.eventId ?? undefined,
    bookingId: registration.bookingId ?? null,
    ticketId: registration.ticketId ?? null,
    ticketName: registration.ticketName ?? null,
    ticketStatus: registration.ticketStatus ?? null,
    event: eventName,
    eventName,
    date: eventDate,
    eventDate,
    venueName: registration.venueName ?? null,
    address: registration.address ?? null,
    photoUrl: registration.photoUrl ?? null,
    country: registration.country ?? null,
    state: registration.state ?? null,
    customSlug: registration.customSlug ?? null,
    contest,
    contestName: contest,
    contests: uniqueContests.length > 0 ? uniqueContests : undefined,
    registrationsCount:
      uniqueContests.length > 0 ? uniqueContests.length : undefined,
    bib:
      registration.bibNumber ??
      registration.bib ??
      registration.athleteBibNumber ??
      null,
    status,
    registrationStatus: status,
  };
}

function normalizeAthlete(
  athlete: BackendAthlete | null | undefined,
  fallback?: BackendAthlete | null,
): AthleteDashboard["athlete"] {
  const clubObject =
    athlete?.club && typeof athlete.club === "object"
      ? (athlete.club as Record<string, unknown>)
      : null;
  const currentAffiliationObject =
    athlete?.currentAffiliation &&
    typeof athlete.currentAffiliation === "object"
      ? (athlete.currentAffiliation as Record<string, unknown>)
      : null;
  const clubString = typeof athlete?.club === "string" ? athlete.club : null;
  const currentAffiliationString =
    typeof athlete?.currentAffiliation === "string"
      ? athlete.currentAffiliation
      : null;
  const currentAffiliationValue =
    typeof athlete?.currentAffiliation === "string"
      ? !looksLikeClubId(currentAffiliationString)
        ? currentAffiliationString
        : null
      : toText(currentAffiliationObject?.clubName) ||
        toText(currentAffiliationObject?.name) ||
        toText(currentAffiliationObject?.displayName) ||
        (looksLikeClubId(toText(currentAffiliationObject?.id))
          ? null
          : toText(currentAffiliationObject?.id)) ||
        (looksLikeClubId(toText(currentAffiliationObject?.clubId))
          ? null
          : toText(currentAffiliationObject?.clubId));
  const currentClubSource = (
    athlete as { currentClub?: Record<string, unknown> | null }
  )?.currentClub;
  const currentClubObject =
    currentClubSource && typeof currentClubSource === "object"
      ? currentClubSource
      : null;
  const clubValue =
    clubString && !looksLikeClubId(clubString)
      ? clubString
      : toText(clubObject?.name) ||
        toText(clubObject?.clubName) ||
        toText(clubObject?.title) ||
        (looksLikeClubId(toText(clubObject?.id))
          ? null
          : toText(clubObject?.id)) ||
        (looksLikeClubId(toText(clubObject?.clubId))
          ? null
          : toText(clubObject?.clubId)) ||
        toText(currentClubObject?.name) ||
        toText(currentClubObject?.clubName) ||
        toText(currentClubObject?.displayName) ||
        (looksLikeClubId(toText(currentClubObject?.id))
          ? null
          : toText(currentClubObject?.id)) ||
        (looksLikeClubId(toText(currentClubObject?.clubId))
          ? null
          : toText(currentClubObject?.clubId)) ||
        toText(currentAffiliationValue) ||
        toText(
          (
            athlete as {
              affiliatedClub?: string | null;
              affiliatedClubId?: string | null;
              firstAffiliatedClubId?: string | null;
            }
          )?.affiliatedClub,
        ) ||
        toText(
          (
            athlete as {
              affiliatedClub?: string | null;
              affiliatedClubId?: string | null;
              firstAffiliatedClubId?: string | null;
            }
          )?.affiliatedClubId,
        ) ||
        toText(
          (
            athlete as {
              affiliatedClub?: string | null;
              affiliatedClubId?: string | null;
              firstAffiliatedClubId?: string | null;
            }
          )?.firstAffiliatedClubId,
        ) ||
        null;
  const countryObject =
    athlete?.country && typeof athlete.country === "object"
      ? (athlete.country as Record<string, unknown>)
      : null;
  const countryValue =
    getCountryDisplayName(
      toText(athlete?.country as string | null | undefined),
    ) ||
    getCountryDisplayName(toText(countryObject?.name)) ||
    getCountryDisplayName(toText(countryObject?.code)) ||
    getCountryDisplayName(toText(countryObject?.label)) ||
    getCountryDisplayName(
      toText(
        (
          athlete as {
            countryName?: string | null;
            nationality?: string | null;
            countryCode?: string | null;
            country_code?: string | null;
          }
        )?.countryName,
      ),
    ) ||
    getCountryDisplayName(toText(fallback?.country)) ||
    getCountryDisplayName(toText(fallback?.countryName)) ||
    getCountryDisplayName(
      toText(
        (
          athlete as {
            countryName?: string | null;
            nationality?: string | null;
            countryCode?: string | null;
            country_code?: string | null;
          }
        )?.nationality,
      ),
    ) ||
    getCountryDisplayName(
      toText(
        (
          athlete as {
            countryName?: string | null;
            nationality?: string | null;
            countryCode?: string | null;
            country_code?: string | null;
          }
        )?.countryCode,
      ),
    ) ||
    getCountryDisplayName(
      toText(
        (
          athlete as {
            countryName?: string | null;
            nationality?: string | null;
            countryCode?: string | null;
            country_code?: string | null;
          }
        )?.country_code,
      ),
    ) ||
    null;
  const clubIdValue = firstText(
    athlete?.clubId,
    athlete?.affiliatedClubId,
    looksLikeClubId(clubObject?.id) ? null : clubObject?.id,
    looksLikeClubId(clubObject?.clubId) ? null : clubObject?.clubId,
    looksLikeClubId(currentAffiliationObject?.clubId)
      ? null
      : currentAffiliationObject?.clubId,
    looksLikeClubId(currentAffiliationObject?.id)
      ? null
      : currentAffiliationObject?.id,
  );
  return {
    id: toText(athlete?.id) || undefined,
    uid: toText(athlete?.uid) || toText(athlete?.id) || undefined,
    email: athlete?.email ?? fallback?.email ?? null,
    name:
      toText(
        athlete?.name ||
          athlete?.fullName ||
          fallback?.name ||
          fallback?.fullName,
      ) || "Athlete",
    fullName: toText(athlete?.fullName) || null,
    mobile: athlete?.mobile ?? null,
    photoUrl: resolvePhoto(
      athlete?.photoUrl,
      athlete?.photoURL,
      athlete?.profilePhotoUrl,
      athlete?.profileUrl,
      athlete?.profileURL,
      athlete?.displayPhoto,
    ),
    profilePhotoUrl: resolvePhoto(
      athlete?.profilePhotoUrl,
      athlete?.profileUrl,
      athlete?.profileURL,
      athlete?.photoUrl,
      athlete?.photoURL,
      athlete?.displayPhoto,
    ),
    photoURL: resolvePhoto(
      athlete?.photoURL,
      athlete?.photoUrl,
      athlete?.profilePhotoUrl,
      athlete?.profileUrl,
      athlete?.profileURL,
      athlete?.displayPhoto,
    ),
    profileUrl: resolvePhoto(
      athlete?.profileUrl,
      athlete?.profileURL,
      athlete?.profilePhotoUrl,
      athlete?.photoUrl,
      athlete?.photoURL,
      athlete?.displayPhoto,
    ),
    profileURL: resolvePhoto(
      athlete?.profileURL,
      athlete?.profileUrl,
      athlete?.profilePhotoUrl,
      athlete?.photoUrl,
      athlete?.photoURL,
      athlete?.displayPhoto,
    ),
    belTier: athlete?.belTier ?? null,
    club: clubValue,
    clubId: clubIdValue,
    clubName: clubValue || null,
    affiliatedClub: athlete?.affiliatedClub ?? null,
    affiliatedClubName: athlete?.affiliatedClubName ?? null,
    affiliatedClubId: athlete?.affiliatedClubId ?? null,
    role: athlete?.role ?? null,
    clubRole: athlete?.clubRole ?? null,
    membershipRole: athlete?.membershipRole ?? null,
    isClubOwner: athlete?.isClubOwner ?? null,
    ownedClubId: athlete?.ownedClubId ?? null,
    ownedClubName: athlete?.ownedClubName ?? null,
    clubHistory: athlete?.clubHistory,
    country: countryValue,
    state: athlete?.state ?? null,
    city: athlete?.city ?? null,
    belStatus: athlete?.belStatus ?? null,
    liveTrackingPrivacy:
      athlete?.trackingVisibility ??
      athlete?.liveTrackingPrivacy ??
      fallback?.trackingVisibility ??
      fallback?.liveTrackingPrivacy ??
      athlete?.liveTrackingVisibility ??
      athlete?.visibility ??
      null,
    trackingVisibility:
      athlete?.trackingVisibility ??
      athlete?.liveTrackingPrivacy ??
      fallback?.trackingVisibility ??
      fallback?.liveTrackingPrivacy ??
      athlete?.liveTrackingVisibility ??
      athlete?.visibility ??
      null,
    liveTrackingVisibility:
      athlete?.trackingVisibility ??
      athlete?.liveTrackingPrivacy ??
      fallback?.trackingVisibility ??
      fallback?.liveTrackingPrivacy ??
      athlete?.liveTrackingVisibility ??
      athlete?.visibility ??
      null,
    visibility:
      athlete?.trackingVisibility ??
      athlete?.liveTrackingPrivacy ??
      fallback?.trackingVisibility ??
      fallback?.liveTrackingPrivacy ??
      athlete?.visibility ??
      athlete?.liveTrackingVisibility ??
      null,
  };
}

function normalizeResult(result: RawDashboardResult): AthleteDashboardResult {
  const event = toText(result.event ?? result.eventName) || "Event";
  const date = toText(result.date ?? result.raceDate) || "";
  const contest =
    cleanContestLabel(
      result.contest ?? result.raceCategory ?? result.eventCategory,
    ) || null;
  const chipTime = toText(result.chipTime ?? result.finishTime) || null;
  const position =
    result.position ?? result.oRank ?? result.gRank ?? result.cRank ?? null;
  const pointsEarned = result.pointsEarned ?? result.pointsAwarded ?? null;

  return {
    ...result,
    id: toText(result.id) || undefined,
    event,
    date,
    contest,
    chipTime,
    position,
    pointsEarned,
  };
}

function normalizeDashboard(
  payload: BackendDashboard | undefined,
): AthleteDashboard {
  const rootSource = { ...(payload ?? {}) } as BackendAthlete;
  const upcomingEventsSource = Array.isArray(payload?.upcomingRegistrations)
    ? payload.upcomingRegistrations
    : Array.isArray(payload?.registeredEvents)
      ? payload.registeredEvents
      : Array.isArray(payload?.registrations)
        ? payload.registrations
        : Array.isArray(payload?.eventsIndex)
          ? payload.eventsIndex
          : Array.isArray(payload?.upcomingEvents)
            ? payload.upcomingEvents
            : Array.isArray(payload?.events)
              ? payload.events
              : [];
  const firstRegistrationSource = (upcomingEventsSource[0] ??
    (Array.isArray(payload?.registrations)
      ? payload.registrations[0]
      : undefined)) as BackendAthlete | undefined;
  const profileSource = payload?.profile ?? payload?.athlete ?? null;
  const userSource = payload?.user ?? null;
  const athleteFallback = {
    ...rootSource,
    ...(userSource ?? {}),
    ...(firstRegistrationSource ?? {}),
  } as BackendAthlete;
  const athlete = normalizeAthlete(
    profileSource ?? rootSource,
    athleteFallback,
  );
  const summary = payload?.summary
    ? {
        ...payload.summary,
        notificationCount:
          payload.summary.notificationCount ??
          (Array.isArray(payload.notifications)
            ? payload.notifications.length
            : undefined),
        certificatesCount:
          payload.summary.certificatesCount ??
          (Array.isArray(payload.certificates)
            ? payload.certificates.length
            : undefined),
        upcomingRace: payload.summary.upcomingRace
          ? normalizeRegistration(
              payload.summary.upcomingRace as RawDashboardRegistration,
            )
          : (payload.summary.upcomingRace ?? null),
      }
    : {
        notificationCount: Array.isArray(payload?.notifications)
          ? payload.notifications.length
          : undefined,
        certificatesCount: Array.isArray(payload?.certificates)
          ? payload.certificates.length
          : undefined,
      };

  const recentResultsSource = Array.isArray(payload?.results)
    ? payload?.results
    : Array.isArray(payload?.raceHistory)
      ? payload?.raceHistory
      : payload?.recentResults;
  const liveRaceStatus =
    Array.isArray(payload?.liveEvents) && payload.liveEvents.length > 0
      ? payload.liveEvents[0]
      : (payload?.liveRaceStatus ?? null);

  return {
    athlete,
    summary,
    statistics: payload?.statistics,
    ranking:
      payload?.ranking ??
      (payload?.rankings
        ? {
            overallRank: payload.rankings.overallRank,
            ageGroupRank:
              payload.rankings.ageGroupRank ?? payload.rankings.categoryRank,
          }
        : undefined),
    bel: payload?.bel,
    recentResults: (recentResultsSource ?? []).map((result) =>
      normalizeResult(result as RawDashboardResult),
    ),
    upcomingEvents: dedupeRegistrationsByBooking(
      upcomingEventsSource as RawDashboardRegistration[] | undefined,
    ),
    certificates: payload?.certificates ?? [],
    registrations: dedupeRegistrationsByBooking(
      upcomingEventsSource as RawDashboardRegistration[] | undefined,
    ),
    watchlist: payload?.watchlist ?? [],
    liveRaceStatus,
  };
}

function dedupeRegistrationsByBooking(
  registrations: RawDashboardRegistration[] | undefined,
): AthleteDashboardRegistration[] {
  const items = Array.isArray(registrations) ? registrations : [];
  const seen = new Set<string>();
  const rows: AthleteDashboardRegistration[] = [];

  items.forEach((registration, index) => {
    const normalized = normalizeRegistration(registration);
    const key =
      toText(normalized.bookingId ?? registration.bookingId) ||
      `booking-${index}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(normalized);
  });

  return rows;
}

function unwrap<T, K extends string>(payload: Envelope<T, K>, key: K): T {
  if (payload && typeof payload === "object" && key in payload) {
    return (payload as Record<K, T>)[key];
  }
  return payload as T;
}

function unwrapApiPayload<T>(
  payload: unknown,
  keys: string[] = [],
): T | undefined {
  if (!payload || typeof payload !== "object") {
    return payload as T | undefined;
  }

  const record = payload as Record<string, unknown>;

  if ("data" in record && record.data !== undefined) {
    return record.data as T;
  }

  for (const key of keys) {
    if (key in record && record[key] !== undefined) {
      return record[key] as T;
    }
  }

  return payload as T;
}

function params(filters: RankingFilters = {}) {
  return Object.fromEntries(
    Object.entries(filters).filter(
      ([, value]) => value !== undefined && value !== null && value !== "",
    ),
  ) as Record<string, string | number | boolean>;
}

function describeError(error: unknown) {
  const record =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  return {
    status: typeof record.status === "number" ? record.status : null,
    code: typeof record.code === "string" ? record.code : undefined,
    message:
      typeof record.message === "string"
        ? record.message
        : error instanceof Error
          ? error.message
          : String(error),
    userMessage:
      typeof record.userMessage === "string" ? record.userMessage : undefined,
    retryable:
      typeof record.retryable === "boolean" ? record.retryable : undefined,
  };
}

export interface IMobileRepository {
  getAthleteDashboard(): Promise<AthleteDashboard>;
  getAthleteProfile(athleteId: string): Promise<AthleteProfileAggregate>;
  getAthleteRankings(
    filters?: RankingFilters,
  ): Promise<PaginatedResponse<AthleteRankingEntry>>;
  getAthleteRankingYears(): Promise<number[]>;
  getClubRankings(
    filters?: RankingFilters,
  ): Promise<PaginatedResponse<ClubRankingEntry>>;
  getTraining(): Promise<TrainingDashboard>;
}

export const ProductionMobileRepository: IMobileRepository = {
  async getAthleteDashboard() {
    if (dashboardRequest) {
      dashboardLog("deduplicated");
      return dashboardRequest;
    }

    dashboardRequest = (async () => {
      let res: Envelope<AthleteDashboard, "dashboard">;
      try {
        dashboardLog("fetch-start");
        const [dashboardResponse, accountResponse] = await Promise.all([
          authenticatedJson<{ success?: boolean; data?: { upcoming?: unknown[]; past?: unknown[] } }>(
            "/api/v1/athlete/dashboard",
          ),
          authenticatedJson<{ success?: boolean; data?: Record<string, unknown> }>(
            "/api/v1/athlete/me",
          ),
        ]);
        const dashboardData = dashboardResponse.data ?? {};
        const accountData = accountResponse.data ?? {};
        const profile = accountData.profile && typeof accountData.profile === "object"
          ? accountData.profile as Record<string, unknown>
          : {};
        const races = [...(dashboardData.upcoming ?? []), ...(dashboardData.past ?? [])]
          .map((entry) => {
            const row = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
            const event = row.event && typeof row.event === "object" ? row.event as Record<string, unknown> : {};
            return { ...event, ...row, eventName: event.eventName ?? row.eventName, eventId: event.eventId ?? row.eventId };
          });
        res = {
          success: true,
          dashboard: {
            athlete: { ...accountData, ...profile },
            registrations: races,
            recentResults: dashboardData.past ?? [],
          } as AthleteDashboard,
        };
      } catch (error) {
        const details = describeError(error);
        if (details.status === 429)
          dashboardLog("rate-limited", { retryable: details.retryable });
        if (isDevelopment) {
          console.warn("[mobile.repository] Race Upshot athlete dashboard failed", details);
        }
        const cached = await readDashboardCache();
        if (details.status === 429 && cached) return cached;
        if (details.status === 404) {
          const empty = normalizeDashboard(undefined);
          await persistDashboardCache(empty);
          return empty;
        }
        throw error;
      }
      const previous = await readDashboardCache();
      const dashboard = mergeAthleteWithCache(
        normalizeDashboard(
          unwrapApiPayload<BackendDashboard>(res, ["dashboard"]),
        ),
        previous,
      );

      debugModel("[mobile.repository] /api/v1/athlete/dashboard", res, dashboard);
      await persistDashboardCache(dashboard);
      dashboardLog("fetch-success");

      return dashboard;
    })().finally(() => {
      dashboardRequest = null;
    });

    return dashboardRequest;
  },
  async getAthleteProfile() {
    try {
      return (await this.getAthleteDashboard()) as AthleteProfileAggregate;
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 404) {
        return normalizeDashboard(undefined) as AthleteProfileAggregate;
      }
      throw error;
    }
  },
  async getAthleteRankings(filters = {}) {
    const res = await api.json<{
      items?: AthleteRankingEntry[];
      rankings?: AthleteRankingEntry[];
      nextCursor?: string | null;
    }>("/api/rankings/athletes", {
      params: { ...params(filters), year: filters.season },
    });
    const mapped = {
      items: res.items ?? res.rankings ?? [],
      nextCursor: res.nextCursor ?? null,
    };
    debugModel("[mobile.repository] /api/rankings/athletes", res, mapped);
    return mapped;
  },
  async getAthleteRankingYears() {
    const res = await api.json<{
      years?: number[];
      data?: { years?: number[] };
    }>("/api/rankings/athletes/years");
    const years = Array.isArray(res.years)
      ? res.years
      : Array.isArray(res.data?.years)
        ? res.data.years
        : [];
    return [...new Set(years.map(Number).filter((year) => year >= 2022))].sort(
      (a, b) => b - a,
    );
  },
  async getClubRankings(filters = {}) {
    const res = await api.json<{
      items?: ClubRankingEntry[];
      rankings?: ClubRankingEntry[];
      nextCursor?: string | null;
    }>("/api/rankings/clubs", {
      params: { ...params(filters), year: filters.season },
    });
    const mapped = {
      items: res.items ?? res.rankings ?? [],
      nextCursor: res.nextCursor ?? null,
    };
    debugModel("[mobile.repository] /api/rankings/clubs", res, mapped);
    return mapped;
  },
  async getTraining() {
    const res =
      await api.json<Envelope<TrainingDashboard, "training">>("/api/training");
    const mapped =
      unwrapApiPayload<TrainingDashboard>(res, ["training"]) ??
      unwrap(res, "training");
    debugModel("[mobile.repository] /api/training", res, mapped);
    return mapped;
  },
};
