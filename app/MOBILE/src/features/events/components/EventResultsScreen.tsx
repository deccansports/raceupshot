import { useRouter, type Href } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQueries } from "@tanstack/react-query";

import { repositories } from "@/core/repositories";
import { queryKeys } from "@/core/services/query/queryKeys";
import { useTheme } from "@/core/theme";
import { formatCutoffSummary, getCountryFlagEmoji } from "@/core/utils";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  LeaderboardRow,
  Modal,
  SearchBar,
  Skeleton,
  Text,
} from "@/shared/components";
import { useDebouncedValue } from "@/shared/hooks";
import {
  useCourseGeometry,
  useCourseMap,
  useEventResults,
  useLeaderboard,
} from "@/features/tracking/hooks";
import { mapCourseMap } from "@/features/tracking/course-map/mappers";
import { CourseMapView } from "@/features/tracking/course-map/components/CourseMapView";

import { useEvent } from "../hooks/useEvents";
import {
  useEventScreenFocusRefresh,
  useEventScreenInitialization,
} from "../hooks/useEventScreenInitialization";

type Mode =
  | "overall"
  | "male"
  | "female"
  | "contest"
  | "ageGroup"
  | "club"
  | "relay"
  | "team";

type RawResultRow = Record<string, unknown> & {
  id?: string;
  docId?: string;
  athleteUid?: string;
  athleteId?: string;
  bibNumber?: string;
  bib?: string;
  displayName?: string;
  name?: string;
  fullName?: string;
  email?: string | null;
  profilePhotoUrl?: string | null;
  photoUrl?: string | null;
  photoURL?: string | null;
  avatarUrl?: string | null;
  displayPhoto?: string | null;
  contest?: string | null;
  contestName?: string | null;
  contestUuid?: string | null;
  category?: string | null;
  ageGroup?: string | null;
  ticketName?: string | null;
  club?: string | null;
  clubName?: string | null;
  clubNameAtRace?: string | null;
  team?: string | null;
  teamName?: string | null;
  gender?: string | null;
  status?: string | null;
  statusNormalized?: string | null;
  overallTime?: string | null;
  chipTime?: string | null;
  finishTime?: string | null;
  overallPosition?: number | string | null;
  overallRank?: number | string | null;
  oRank?: number | string | null;
  gRank?: number | string | null;
  cRank?: number | string | null;
  rank?: number | string | null;
  raceCategory?: string | null;
  raceDate?: string | null;
  country?: string | null;
  countryName?: string | null;
  countryCode?: string | null;
  displayCountry?: string | null;
};

type LeaderboardItem = {
  id: string;
  rank: number | string;
  name: string;
  time: string;
  detail?: string;
  avatarUri?: string | number;
  avatarSeed?: string;
  row: RawResultRow;
};

type LeaderboardSection = {
  title: string;
  items: LeaderboardItem[];
};

type AvatarLookup = {
  key: string;
  athleteUid?: string;
  email?: string;
  bib?: string;
};

const MODES: { key: Mode; label: string }[] = [
  { key: "contest", label: "Category" },
  { key: "overall", label: "Overall" },
  { key: "male", label: "Male" },
  { key: "female", label: "Female" },
  { key: "ageGroup", label: "Age Group" },
  { key: "club", label: "Club" },
  { key: "relay", label: "Relay" },
  { key: "team", label: "Team" },
];

const RESULTS_LEADERBOARD_LIMIT = 3;

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

function parseHms(value: string | null | undefined): number | null {
  const raw = text(value);
  if (!raw || raw === "—") return null;
  const parts = raw.split(":").map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

function statusPriority(status: string): number {
  const s = status.trim().toUpperCase();
  if (!s) return 4;
  if (s.includes("DQ") || s.includes("DISQUAL")) return 3;
  if (s.includes("DNS") || s.includes("DID NOT START")) return 2;
  if (s.includes("DNF") || s.includes("DID NOT FINISH")) return 1;
  return 0;
}

function resultStatus(row: RawResultRow): string {
  return firstText(row.statusNormalized, row.status);
}

function resultName(row: RawResultRow): string {
  return firstText(row.displayName, row.fullName, row.name) || "Athlete";
}

function resultBib(row: RawResultRow): string {
  return firstText(row.bibNumber, row.bib, row.athleteUid);
}

function resultClub(row: RawResultRow): string {
  return firstText(row.club, row.clubName, row.clubNameAtRace);
}

function resultCountry(row: RawResultRow): string {
  return firstText(
    row.country,
    row.countryName,
    row.countryCode,
    row.displayCountry,
  );
}

function resultCountryFlag(row: RawResultRow): string | undefined {
  return getCountryFlagEmoji(resultCountry(row)) || undefined;
}

function resultContest(row: RawResultRow): string {
  return firstText(
    row.contestName,
    row.contest,
    row.raceCategory,
    row.ticketName,
  );
}

function resultAgeGroup(row: RawResultRow): string {
  return firstText(row.category, row.ageGroup);
}

function resultCategory(row: RawResultRow): string {
  // Main race category equals the contest/ticket category. Age group remains
  // an independent ranking dimension instead of fragmenting this selector.
  return resultContest(row);
}

function resultTeam(row: RawResultRow): string {
  const team = firstText(row.teamName, row.team);
  const club = resultClub(row);
  return team && team.toLowerCase() !== club.toLowerCase() ? team : "";
}

function resultContestUuid(row: RawResultRow): string {
  return firstText(row.contestUuid);
}

function officialPosition(row: RawResultRow): number | null {
  const value = firstText(
    row.overallPosition,
    row.overallRank,
    row.oRank,
    row.rank,
    row.cRank,
    row.gRank,
  );
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasNoFinishRank(row: RawResultRow): boolean {
  const status = resultStatus(row).toUpperCase();
  return (
    status.includes("DNF") ||
    status.includes("DNS") ||
    status.includes("DID NOT FINISH") ||
    status.includes("DID NOT START")
  );
}

function isDnsResult(row: RawResultRow): boolean {
  const status = resultStatus(row).trim().toUpperCase();
  return status === "DNS" || status.includes("DID NOT START");
}

function resultRankLabel(row: RawResultRow, rank: number): number | string {
  if (hasNoFinishRank(row)) return "-";
  return officialPosition(row) ?? rank;
}

function resultTime(row: RawResultRow): string {
  return firstText(row.overallTime, row.chipTime, row.finishTime) || "—";
}

function resultTimeSeconds(row: RawResultRow): number | null {
  return parseHms(firstText(row.overallTime, row.chipTime, row.finishTime));
}

function compareRows(a: RawResultRow, b: RawResultRow): number {
  const statusDiff =
    statusPriority(resultStatus(a)) - statusPriority(resultStatus(b));
  if (statusDiff !== 0) return statusDiff;

  const aPosition = officialPosition(a);
  const bPosition = officialPosition(b);
  if (aPosition != null && bPosition != null && aPosition !== bPosition)
    return aPosition - bPosition;
  if (aPosition != null && bPosition == null) return -1;
  if (aPosition == null && bPosition != null) return 1;

  const aTime = resultTimeSeconds(a);
  const bTime = resultTimeSeconds(b);
  if (aTime != null && bTime != null && aTime !== bTime) return aTime - bTime;
  if (aTime != null && bTime == null) return -1;
  if (aTime == null && bTime != null) return 1;

  return resultName(a).localeCompare(resultName(b), undefined, {
    sensitivity: "base",
  });
}

type CategoryOption = {
  key: string;
  label: string;
  contestUuid?: string;
  contestName?: string;
};

function categoryKey(row: RawResultRow): string {
  return resultContestUuid(row) || resultCategory(row);
}

function normalizedKey(value: string): string {
  return value.trim().toLowerCase();
}

function buildCategoryOptions(rows: RawResultRow[]): CategoryOption[] {
  const options = new Map<string, CategoryOption>();
  for (const row of rows) {
    const label = resultCategory(row) || resultContestUuid(row);
    if (!label) continue;
    const contestUuid = resultContestUuid(row) || undefined;
    const key = contestUuid
      ? `uuid:${contestUuid}`
      : `name:${label.toLowerCase()}`;
    if (!options.has(key)) {
      options.set(key, {
        key,
        label,
        contestUuid,
        contestName: label,
      });
    }
  }
  return [...options.values()].sort((a, b) =>
    a.label.localeCompare(b.label, undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

function rowMatchesCategory(
  row: RawResultRow,
  category: CategoryOption | "all",
): boolean {
  if (category === "all") return true;
  const labels = [
    resultCategory(row),
    resultContest(row),
    resultAgeGroup(row),
    resultContestUuid(row),
    row.ticketName,
    row.raceCategory,
    row.eventCategory,
  ]
    .map((value) => normalizedKey(text(value)))
    .filter(Boolean);
  if (category.contestUuid) {
    return (
      labels.includes(normalizedKey(category.contestUuid)) ||
      labels.includes(normalizedKey(category.label))
    );
  }
  return (
    labels.includes(normalizedKey(category.label)) ||
    normalizedKey(categoryKey(row)) === normalizedKey(category.label)
  );
}

function isRelayRow(row: RawResultRow): boolean {
  const label = [
    row.team,
    row.teamName,
    row.contest,
    row.contestName,
    row.category,
    row.ageGroup,
    row.raceCategory,
  ]
    .map(text)
    .join(" ")
    .toLowerCase();
  return label.includes("relay");
}

function isTeamRow(row: RawResultRow): boolean {
  const team = resultTeam(row);
  const label = [
    row.team,
    row.teamName,
    row.contest,
    row.contestName,
    row.category,
    row.ageGroup,
    row.raceCategory,
  ]
    .map(text)
    .join(" ")
    .toLowerCase();
  return (
    Boolean(team) ||
    label.includes("team result") ||
    label.includes("team category") ||
    label.includes("relay team")
  );
}

function matchesSearch(row: RawResultRow, q: string): boolean {
  const query = q.trim().toLowerCase();
  if (!query) return true;
  const haystack = [
    resultBib(row),
    resultName(row),
    row.email,
    row.city,
    row.state,
    row.country,
    resultClub(row),
    resultCategory(row),
    row.gender,
    row.status,
    row.statusNormalized,
  ]
    .map((value) => text(value).toLowerCase())
    .join(" ");
  return haystack.includes(query);
}

function mapItem(
  row: RawResultRow,
  rank: number,
  detailMode: Mode = "overall",
): LeaderboardItem {
  const visibility = text(row.liveTrackingVisibility ?? row.visibility);
  const hidden = visibility === "ANONYMOUS" || visibility === "PRIVATE";
  const team = resultTeam(row);
  const detail =
    detailMode === "team" && team
      ? [resultContest(row), team].filter(Boolean).join(" · ")
      : [resultCategory(row), resultClub(row)].filter(Boolean).join(" · ");
  return {
    id: resultBib(row) || text(row.id ?? row.docId ?? row.athleteUid),
    rank: resultRankLabel(row, rank),
    name: resultName(row),
    time: resultTime(row),
    detail: detail || undefined,
    avatarUri: hidden
      ? undefined
      : firstText(
          row.profilePhotoUrl,
          row.photoUrl,
          row.photoURL,
          row.avatarUrl,
          row.displayPhoto,
        ) || undefined,
    avatarSeed: text(row.athleteUid ?? row.bib ?? row.bibNumber) || undefined,
    row,
  };
}

function avatarLookupKey(row: RawResultRow): string {
  return text(
    row.athleteUid ||
      row.email ||
      row.bib ||
      row.bibNumber ||
      row.id ||
      row.docId ||
      row.name,
  );
}

function extractAthletePhotoFromDetail(
  result: { athlete?: Record<string, unknown> } | undefined,
): string | undefined {
  const athlete = result?.athlete;
  if (!athlete) return undefined;
  return (
    text(athlete.profilePhotoUrl) ||
    text(athlete.displayPhoto) ||
    text(athlete.photoURL) ||
    text(athlete.photoUrl) ||
    text(athlete.avatarUrl) ||
    undefined
  );
}

function buildOverall(
  rows: RawResultRow[],
  detailMode: Mode = "overall",
): LeaderboardItem[] {
  return [...rows]
    .sort(compareRows)
    .map((row, index) => mapItem(row, index + 1, detailMode));
}

function buildFiltered(
  rows: RawResultRow[],
  predicate: (row: RawResultRow) => boolean,
  detailMode: Mode = "overall",
): LeaderboardItem[] {
  return [...rows]
    .filter(predicate)
    .sort(compareRows)
    .map((row, index) => mapItem(row, index + 1, detailMode));
}

function groupBy(
  rows: RawResultRow[],
  getKey: (row: RawResultRow) => string,
): LeaderboardSection[] {
  const buckets = new Map<string, RawResultRow[]>();
  for (const row of rows) {
    const key = getKey(row) || "Unspecified";
    const bucket = buckets.get(key) ?? [];
    bucket.push(row);
    buckets.set(key, bucket);
  }

  const keys = [...buckets.keys()].sort((a, b) => {
    const aNum = Number.parseInt(a, 10);
    const bNum = Number.parseInt(b, 10);
    if (Number.isFinite(aNum) && Number.isFinite(bNum) && aNum !== bNum)
      return aNum - bNum;
    return a.localeCompare(b, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });

  return keys.map((key) => ({
    title: key,
    items: [...(buckets.get(key) ?? [])]
      .sort(compareRows)
      .map((row, index) => mapItem(row, index + 1)),
  }));
}

function getModeLabel(mode: Mode): string {
  return MODES.find((m) => m.key === mode)?.label ?? "Results";
}

function getEmptyTitle(mode: Mode, official: boolean): string {
  if (!official) {
    switch (mode) {
      case "male":
        return "No Male Results";
      case "female":
        return "No Female Results";
      case "contest":
        return "No Contest Results";
      case "ageGroup":
        return "No Age Group Results";
      case "club":
        return "No Club Rankings";
      case "relay":
        return "No Relay Results";
      case "team":
        return "No Team Rankings";
      default:
        return "No Canonical Results Available";
    }
  }
  switch (mode) {
    case "male":
      return "No Male Results";
    case "female":
      return "No Female Results";
    case "contest":
      return "No Contest Results";
    case "ageGroup":
      return "No Age Group Results";
    case "club":
      return "No Club Rankings";
    case "relay":
      return "No Relay Results";
    case "team":
      return "No Team Rankings";
    default:
      return "No Official Results Available";
  }
}

function getEmptyDescription(mode: Mode, official: boolean): string {
  if (!official) {
    switch (mode) {
      case "male":
        return "No male athletes were found in accepted canonical timing.";
      case "female":
        return "No female athletes were found in accepted canonical timing.";
      case "contest":
        return "No contest rankings were found in accepted canonical timing.";
      case "ageGroup":
        return "No age group rankings were found in accepted canonical timing.";
      case "club":
        return "No club rankings were found in accepted canonical timing.";
      case "relay":
        return "No relay results were found in accepted canonical timing.";
      case "team":
        return "No team rankings were found in accepted canonical timing.";
      default:
        return "Accepted canonical timing will appear here when it is available.";
    }
  }
  switch (mode) {
    case "male":
      return "No male athletes were found in the published results.";
    case "female":
      return "No female athletes were found in the published results.";
    case "contest":
      return "No contest rankings were found in the published results.";
    case "ageGroup":
      return "No age group rankings were found in the published results.";
    case "club":
      return "No club rankings were found in the published results.";
    case "relay":
      return "No relay results were found in the published results.";
    case "team":
      return "No team rankings were found in the published results.";
    default:
      return "Official rankings will appear once results are published.";
  }
}

export function EventResultsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const eventScreen = useEventScreenInitialization();
  const id = eventScreen.eventId;

  const eventQuery = useEvent(id);
  const resultsQuery = useEventResults(id, eventScreen.queryEnabled);
  const liveResultsQuery = useLeaderboard(
    id,
    undefined,
    { enabled: eventScreen.queryEnabled, focused: true, isLive: true },
    "live",
  );
  const courseQuery = useCourseMap(id);

  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search, 200);
  const [mode, setMode] = useState<Mode>("contest");
  const [categoryKey, setCategoryKey] = useState("all");
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const focusRefreshQueries = useMemo(
    () => [
      { refetch: eventQuery.refetch },
      { refetch: resultsQuery.refetch },
      { refetch: liveResultsQuery.refetch },
    ],
    [eventQuery.refetch, liveResultsQuery.refetch, resultsQuery.refetch],
  );
  useEventScreenFocusRefresh(id, focusRefreshQueries);
  const event = eventQuery.event;
  const geometryQuery = useCourseGeometry(id, event?.raw);
  const courseMap = useMemo(
    () =>
      mapCourseMap(
        courseQuery.data?.courseIndex,
        geometryQuery.data ?? undefined,
        undefined,
        courseQuery.data?.timingConfiguration,
      ),
    [courseQuery.data, geometryQuery.data],
  );

  const exitEvent = () => router.replace("/");
  const openAthlete = (bib: string, athleteUid?: string) => {
    const query = athleteUid
      ? `?eventId=${encodeURIComponent(id)}&athleteUid=${encodeURIComponent(athleteUid)}`
      : `?eventId=${encodeURIComponent(id)}`;
    router.push(`/athletes/${encodeURIComponent(bib)}${query}` as Href);
  };

  const resultPublication = useMemo(() => {
    const raw = (event?.raw ?? {}) as Record<string, any>;
    const official =
      raw.officialResults && typeof raw.officialResults === "object"
        ? (raw.officialResults as Record<string, any>)
        : {};
    const publicationMarked =
      raw.resultsPublished === true ||
      raw.results_published === true ||
      raw.hasPublishedResults === true ||
      String(official.status || raw.resultState || "")
        .trim()
        .toUpperCase() === "PUBLISHED" ||
      String(raw.status || "")
        .trim()
        .toUpperCase() === "RESULTS_PUBLISHED";
    const rawStatus = String(raw.status || raw.eventStatus || "")
      .trim()
      .toLowerCase();
    const eventIsFinished =
      event?.status === "finished" ||
      ["finished", "completed", "ended", "results_published"].includes(
        rawStatus,
      );
    const uploadedResultsAvailable =
      Array.isArray(resultsQuery.data) && resultsQuery.data.length > 0;
    const officialResultsPublished =
      eventIsFinished && (publicationMarked || uploadedResultsAvailable);
    const checkingUploadedResults =
      eventIsFinished &&
      !publicationMarked &&
      resultsQuery.data === undefined &&
      (resultsQuery.isLoading || resultsQuery.isFetching);
    const underReview =
      String(official.status || raw.resultState || "")
        .trim()
        .toUpperCase() === "UNDER_REVIEW";
    const resultState = officialResultsPublished
      ? "PUBLISHED"
      : underReview
        ? "UNDER_REVIEW"
        : event?.status === "live"
          ? "LIVE"
          : event?.status === "finished"
            ? "PROVISIONAL"
            : "UPCOMING";
    return {
      resultState,
      officialResultsPublished,
      checkingUploadedResults,
      publishedAt:
        official.publishedAt ||
        raw.resultsPublishedAt ||
        raw.publishedAt ||
        null,
      resultAuthority: officialResultsPublished
        ? "OFFICIAL_PUBLISHED"
        : "CANONICAL_LIVE",
    } as const;
  }, [
    event?.raw,
    event?.status,
    resultsQuery.data,
    resultsQuery.isFetching,
    resultsQuery.isLoading,
  ]);
  const officialRows = useMemo<RawResultRow[]>(() => {
    const source = resultPublication.officialResultsPublished
      ? resultsQuery.data
      : liveResultsQuery.data;
    const rows = Array.isArray(source) ? (source as RawResultRow[]) : [];
    return rows;
  }, [
    liveResultsQuery.data,
    resultPublication.officialResultsPublished,
    resultsQuery.data,
  ]);
  const categoryOptions = useMemo(
    () => buildCategoryOptions(officialRows),
    [officialRows],
  );
  const selectedCategory = useMemo<CategoryOption | "all">(() => {
    if (categoryKey === "all") return "all";
    return (
      categoryOptions.find((option) => option.key === categoryKey) ?? "all"
    );
  }, [categoryKey, categoryOptions]);
  const categoryRows = useMemo(
    () =>
      officialRows
        .filter((row) => rowMatchesCategory(row, selectedCategory))
        .sort(compareRows),
    [officialRows, selectedCategory],
  );
  const visibleModes = useMemo(
    () =>
      MODES.filter((candidate) => {
        if (candidate.key === "relay") return categoryRows.some(isRelayRow);
        if (candidate.key === "team") return categoryRows.some(isTeamRow);
        return true;
      }),
    [categoryRows],
  );
  const displayedMode = visibleModes.some((candidate) => candidate.key === mode)
    ? mode
    : "overall";
  const searchRows = useMemo(
    () =>
      categoryRows.filter((row) => matchesSearch(row, debounced)).slice(0, 10),
    [categoryRows, debounced],
  );

  const leaderboardView = useMemo(() => {
    switch (displayedMode) {
      case "male":
        return {
          count: categoryRows.filter(
            (row) => text(row.gender).toLowerCase() === "male",
          ).length,
          sections: [] as LeaderboardSection[],
          rows: buildFiltered(
            categoryRows,
            (row) => text(row.gender).toLowerCase() === "male",
          ),
        };
      case "female":
        return {
          count: categoryRows.filter(
            (row) => text(row.gender).toLowerCase() === "female",
          ).length,
          sections: [] as LeaderboardSection[],
          rows: buildFiltered(
            categoryRows,
            (row) => text(row.gender).toLowerCase() === "female",
          ),
        };
      case "relay":
        return {
          count: categoryRows.filter(isRelayRow).length,
          sections: [] as LeaderboardSection[],
          rows: buildFiltered(categoryRows, isRelayRow),
        };
      case "team":
        return {
          count: categoryRows.filter(isTeamRow).length,
          sections: [] as LeaderboardSection[],
          rows: buildFiltered(categoryRows, isTeamRow, "team"),
        };
      case "contest": {
        const filtered = categoryRows.filter((row) =>
          Boolean(resultContest(row)),
        );
        const sections = groupBy(filtered, (row) => resultContest(row));
        return {
          count: filtered.length,
          sections,
          rows: [] as LeaderboardItem[],
        };
      }
      case "ageGroup": {
        const filtered = categoryRows.filter((row) =>
          Boolean(resultAgeGroup(row)),
        );
        const sections = groupBy(filtered, (row) => resultAgeGroup(row));
        return {
          count: filtered.length,
          sections,
          rows: [] as LeaderboardItem[],
        };
      }
      case "club": {
        const filtered = categoryRows.filter(
          (row) => Boolean(resultClub(row)) && !isDnsResult(row),
        );
        const sections = groupBy(filtered, (row) => resultClub(row));
        return {
          count: filtered.length,
          sections,
          rows: [] as LeaderboardItem[],
        };
      }
      default:
        return {
          count: categoryRows.length,
          sections: [] as LeaderboardSection[],
          rows: buildOverall(categoryRows),
        };
    }
  }, [categoryRows, displayedMode]);

  const visibleRows = useMemo(() => {
    if (
      displayedMode === "contest" ||
      displayedMode === "ageGroup" ||
      displayedMode === "club"
    ) {
      return leaderboardView.sections.flatMap((section) =>
        section.items
          .slice(0, RESULTS_LEADERBOARD_LIMIT)
          .map((item) => item.row),
      );
    }
    return leaderboardView.rows
      .slice(0, RESULTS_LEADERBOARD_LIMIT)
      .map((item) => item.row);
  }, [displayedMode, leaderboardView]);

  const avatarLookups = useMemo(() => {
    const deduped = new Map<string, AvatarLookup>();
    for (const row of visibleRows) {
      const key = avatarLookupKey(row);
      if (!key || deduped.has(key)) continue;
      const email = text(row.email);
      const athleteUid = text(row.athleteUid);
      const bib = resultBib(row);
      deduped.set(key, {
        key,
        athleteUid: email ? undefined : athleteUid || undefined,
        email: email || undefined,
        bib: email || athleteUid ? undefined : bib || undefined,
      });
    }
    return [...deduped.values()];
  }, [visibleRows]);

  const avatarQueries = useQueries({
    queries: avatarLookups.map((lookup) => {
      const params = {
        bib: lookup.bib,
        athleteUid: lookup.athleteUid,
        email: lookup.email,
      };
      return {
        queryKey: queryKeys.athleteDetail(id, params),
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          repositories.athlete.getDetail(id, params, signal, "results"),
        enabled:
          Boolean(id) &&
          Boolean(lookup.bib || lookup.athleteUid || lookup.email),
        staleTime: 5 * 60 * 1000,
      };
    }),
  });

  const avatarByLookupKey = useMemo(() => {
    const result = new Map<string, string>();
    avatarLookups.forEach((lookup, index) => {
      const query = avatarQueries[index];
      const photo = extractAthletePhotoFromDetail(
        query?.data as { athlete?: Record<string, unknown> } | undefined,
      );
      if (photo) {
        result.set(lookup.key, photo);
      }
    });
    return result;
  }, [avatarLookups, avatarQueries]);

  const resolvedAvatar = (
    row: RawResultRow,
    fallback: string | number | undefined,
  ): string | number | undefined => {
    return avatarByLookupKey.get(avatarLookupKey(row)) || fallback;
  };

  const categoryLabel =
    selectedCategory === "all" ? "All Categories" : selectedCategory.label;

  const cutoffSummary = useMemo(
    () => formatCutoffSummary(event?.cutoffMinutes, event?.cutoffs),
    [event?.cutoffMinutes, event?.cutoffs],
  );
  const activeResultsQuery =
    resultPublication.officialResultsPublished ||
    resultPublication.checkingUploadedResults
      ? resultsQuery
      : liveResultsQuery;
  const loadingFreshResults =
    resultPublication.checkingUploadedResults ||
    activeResultsQuery.isLoading ||
    (activeResultsQuery.isFetching && officialRows.length === 0);

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      edges={["top", "left", "right"]}
    >
      <ScrollView
        contentContainerStyle={{
          padding: theme.spacing.base,
          gap: theme.spacing.lg,
          paddingBottom: theme.spacing.xxl,
        }}
        refreshControl={
          <RefreshControl
            refreshing={activeResultsQuery.isFetching}
            onRefresh={() => activeResultsQuery.refetch()}
            tintColor={theme.colors.accent}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={{ gap: theme.spacing.sm }}>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
            }}
          >
            <View style={{ flex: 1, gap: 4 }}>
              <Text variant="display">
                {resultPublication.officialResultsPublished
                  ? "Official Results"
                  : "Race Results"}
              </Text>
              <Text variant="bodySmall" color="textMuted">
                {resultPublication.officialResultsPublished
                  ? "Search official race results by athlete name or bib."
                  : "Live and provisional results from accepted canonical timing."}
              </Text>
            </View>
            <Button
              label="Exit Event"
              variant="secondary"
              onPress={exitEvent}
            />
          </View>
          <Badge
            label={
              resultPublication.resultState === "PUBLISHED"
                ? "RESULTS PUBLISHED"
                : resultPublication.resultState === "UNDER_REVIEW"
                  ? "RESULTS UNDER REVIEW"
                  : resultPublication.resultState === "LIVE"
                    ? "LIVE RESULTS · PROVISIONAL"
                    : resultPublication.resultState === "PROVISIONAL"
                      ? "PROVISIONAL RESULTS"
                      : "RESULTS PENDING"
            }
            variant={
              resultPublication.officialResultsPublished
                ? "finished"
                : "neutral"
            }
          />
        </View>

        <Card style={{ gap: theme.spacing.sm }}>
          <Text variant="headline">Search Results</Text>
          <SearchBar
            value={search}
            onChangeText={setSearch}
            placeholder={
              resultPublication.officialResultsPublished
                ? "Search official race results by athlete name or bib"
                : "Search live and provisional race results by athlete name or bib"
            }
          />
          <Button
            label={`Race Category: ${categoryLabel}`}
            variant="ghost"
            size="sm"
            fullWidth
            onPress={() => setShowCategoryPicker(true)}
          />
          {debounced.trim().length > 0 ? (
            <View style={{ gap: theme.spacing.sm }}>
              {loadingFreshResults ? (
                <Skeleton height={76} radius={theme.radius.large} />
              ) : searchRows.length > 0 ? (
                searchRows.map((athlete) => (
                  <Card key={String(athlete.id)}>
                    <View style={{ gap: 4 }}>
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 8,
                          flexWrap: "wrap",
                        }}
                      >
                        {resultCountryFlag(athlete) ? (
                          <Text variant="body">
                            {resultCountryFlag(athlete)}
                          </Text>
                        ) : null}
                        <Text variant="headline" style={{ flexShrink: 1 }}>
                          {resultName(athlete)}
                        </Text>
                      </View>
                      <Text variant="bodySmall" color="textMuted">
                        Bib {resultBib(athlete)}
                        {resultClub(athlete) ? ` · ${resultClub(athlete)}` : ""}
                        {resultCategory(athlete)
                          ? ` · ${resultCategory(athlete)}`
                          : ""}
                      </Text>
                      <Button
                        label="Open athlete"
                        variant="ghost"
                        size="sm"
                        onPress={() =>
                          openAthlete(
                            resultBib(athlete),
                            text(athlete.athleteUid) || undefined,
                          )
                        }
                      />
                    </View>
                  </Card>
                ))
              ) : (
                <EmptyState
                  title="No athletes found"
                  description={`No ${resultPublication.officialResultsPublished ? "official" : "live or provisional"} results match “${debounced}”.`}
                />
              )}
            </View>
          ) : (
            <Text variant="bodySmall" color="textMuted">
              {resultPublication.officialResultsPublished
                ? "Search the published results list."
                : "Search accepted canonical live timing and provisional results."}
            </Text>
          )}
        </Card>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {visibleModes.map((m) => (
            <Pressable
              key={m.key}
              onPress={() => setMode(m.key)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 999,
                backgroundColor:
                  displayedMode === m.key
                    ? theme.colors.accent
                    : theme.colors.surfaceSunken,
              }}
            >
              <Text
                variant="caption"
                style={{
                  color:
                    displayedMode === m.key
                      ? theme.colors.onAccent
                      : theme.colors.textPrimary,
                  fontWeight: "700",
                }}
              >
                {m.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={{ gap: 2 }}>
          <Text variant="bodySmall" color="textMuted" style={{ flexShrink: 1 }}>
            {categoryLabel}
          </Text>
          <Text variant="caption" color="textMuted">
            {leaderboardView.count} athletes · {getModeLabel(displayedMode)}
          </Text>
        </View>

        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="headline">
            {displayedMode === "overall"
              ? "Overall Results"
              : `${getModeLabel(displayedMode)} Results`}
          </Text>
          {loadingFreshResults ? (
            <>
              <Skeleton height={74} radius={theme.radius.large} />
              <Skeleton height={74} radius={theme.radius.large} />
              <Skeleton height={74} radius={theme.radius.large} />
            </>
          ) : activeResultsQuery.isError || leaderboardView.count === 0 ? (
            <EmptyState
              title={
                categoryRows.length === 0
                  ? resultPublication.officialResultsPublished
                    ? "No official results found for this ticket category."
                    : "No canonical results found for this ticket category."
                  : getEmptyTitle(
                      displayedMode,
                      resultPublication.officialResultsPublished,
                    )
              }
              description={
                categoryRows.length === 0
                  ? resultPublication.officialResultsPublished
                    ? "No athletes were published in the selected ticket category."
                    : "No accepted canonical timing records are available in the selected ticket category."
                  : getEmptyDescription(
                      displayedMode,
                      resultPublication.officialResultsPublished,
                    )
              }
            />
          ) : displayedMode === "contest" ||
            displayedMode === "ageGroup" ||
            displayedMode === "club" ? (
            leaderboardView.sections.map((section) => (
              <View key={section.title} style={{ gap: theme.spacing.xs }}>
                <Text variant="headline" style={{ flexShrink: 1 }}>
                  {section.title}
                </Text>
                {section.items.length > 0
                  ? section.items
                      .slice(0, RESULTS_LEADERBOARD_LIMIT)
                      .map((item) => (
                        <LeaderboardRow
                          key={`${section.title}-${item.id}-${item.rank}`}
                          rank={item.rank}
                          name={item.name}
                          time={item.time}
                          countryFlag={resultCountryFlag(item.row)}
                          detail={item.detail}
                          avatarUri={resolvedAvatar(item.row, item.avatarUri)}
                          avatarSeed={item.avatarSeed}
                          onPress={() =>
                            openAthlete(
                              resultBib(item.row),
                              text(item.row.athleteUid) || undefined,
                            )
                          }
                        />
                      ))
                  : null}
              </View>
            ))
          ) : (
            leaderboardView.rows
              .slice(0, RESULTS_LEADERBOARD_LIMIT)
              .map((item) => (
                <LeaderboardRow
                  key={`${item.id}-${item.rank}`}
                  rank={item.rank}
                  name={item.name}
                  time={item.time}
                  countryFlag={resultCountryFlag(item.row)}
                  detail={item.detail}
                  avatarUri={resolvedAvatar(item.row, item.avatarUri)}
                  avatarSeed={item.avatarSeed}
                  onPress={() =>
                    openAthlete(
                      resultBib(item.row),
                      text(item.row.athleteUid) || undefined,
                    )
                  }
                />
              ))
          )}
        </View>

        <Card style={{ gap: theme.spacing.sm }}>
          <Text variant="headline">Course Map</Text>
          {courseMap ? (
            <CourseMapView
              map={courseMap}
              athletes={[]}
              cutoffMinutes={event?.cutoffMinutes}
              cutoffs={event?.cutoffs}
              compact
              refreshError={
                courseQuery.isRefetchError || geometryQuery.isRefetchError
              }
            />
          ) : (
            <EmptyState
              title="Course Map unavailable"
              description="No course map data was returned for this event."
            />
          )}
        </Card>

        {cutoffSummary.length > 0 ? (
          <Card style={{ gap: theme.spacing.xs }}>
            <Text variant="headline">Cutoffs</Text>
            {cutoffSummary.map((line) => (
              <Text key={line} variant="bodySmall" color="textMuted">
                {line}
              </Text>
            ))}
          </Card>
        ) : null}
      </ScrollView>

      <Modal
        visible={showCategoryPicker}
        onClose={() => setShowCategoryPicker(false)}
        title="Race Category"
      >
        <View style={{ gap: theme.spacing.sm }}>
          <Button
            label="All Categories"
            variant={categoryKey === "all" ? "secondary" : "ghost"}
            fullWidth
            size="sm"
            onPress={() => {
              setCategoryKey("all");
              setShowCategoryPicker(false);
            }}
          />
          {categoryOptions.map((option) => (
            <Button
              key={option.key}
              label={option.label}
              variant={categoryKey === option.key ? "secondary" : "ghost"}
              fullWidth
              size="sm"
              onPress={() => {
                setCategoryKey(option.key);
                setShowCategoryPicker(false);
              }}
            />
          ))}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

export default EventResultsScreen;
