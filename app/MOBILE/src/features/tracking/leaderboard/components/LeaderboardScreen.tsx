import {
  useGlobalSearchParams,
  useLocalSearchParams,
  useRouter,
  type Href,
} from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  FlatList,
  type LayoutChangeEvent,
  Pressable,
  RefreshControl,
  ScrollView,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { CanonicalTrackingRepository, repositories, type LeaderboardFilters } from "@/core/repositories";
import { queryKeys } from "@/core/services/query/queryKeys";
import { useTheme } from "@/core/theme";
import { getCountryFlagEmoji } from "@/core/utils";
import { useEvent, useEventTracking } from "@/features/events";
import type { AthleteSummary } from "@/features/tracking/mappers";
import {
  useAthleteSearch,
  useCourseMap,
  useEventResults,
  useLeaderboard,
} from "@/features/tracking/hooks";
import { useWatchlist } from "@/features/tracking/watchlist";
import {
  Avatar,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Icon,
  Modal,
  Skeleton,
  SearchBar,
  Text,
  type LeaderboardEntry,
} from "@/shared/components";
import { useDebouncedValue } from "@/shared/hooks";
import { safeRouteEventId } from "@/features/events/utils/eventRoute";
import {
  useEventScreenFocusRefresh,
  useEventScreenInitialization,
} from "@/features/events/hooks/useEventScreenInitialization";
import {
  athleteIdentityLines,
  paceForLeaderboardSplit,
  paginateLeaderboard,
  shouldAnimateAthleteName,
  transitionDurationSeconds,
} from "../leaderboardPresentation";

type Mode = "overall" | "male" | "female";

const MODES: { key: Mode; label: string; filters: LeaderboardFilters }[] = [
  { key: "overall", label: "Overall", filters: { gender: "All" } },
  { key: "male", label: "Male", filters: { gender: "Male" } },
  { key: "female", label: "Female", filters: { gender: "Female" } },
];

type RawResultRow = Record<string, unknown> & {
  id?: string;
  docId?: string;
  athleteUid?: string;
  participantUuid?: string | null;
  providerUuid?: string | null;
  providerAthleteUuid?: string | null;
  providerTimingUuid?: string | null;
  providerRecordId?: string | null;
  bookingId?: string | null;
  bibNumber?: string;
  bib?: string;
  displayName?: string;
  name?: string;
  fullName?: string;
  profilePhotoUrl?: string | null;
  photoUrl?: string | null;
  photoURL?: string | null;
  avatarUrl?: string | null;
  displayPhoto?: string | null;
  contest?: string | null;
  contestName?: string | null;
  eventCategory?: string | null;
  category?: string | null;
  ageGroup?: string | null;
  ageGroupName?: string | null;
  ageCategory?: string | null;
  ticketName?: string | null;
  club?: string | null;
  clubName?: string | null;
  clubNameAtRace?: string | null;
  overallTime?: string | null;
  chipTime?: string | null;
  finishTime?: string | null;
  overallRank?: number | string | null;
  overallPosition?: number | string | null;
  oRank?: number | string | null;
  cRank?: number | string | null;
  gRank?: number | string | null;
  rank?: number | string | null;
  raceCategory?: string | null;
  gender?: string | null;
  status?: string | null;
  statusNormalized?: string | null;
  country?: string | null;
  countryName?: string | null;
  countryCode?: string | null;
  displayCountry?: string | null;
  splits?: unknown[];
};

type LeaderboardItem = LeaderboardEntry & {
  row?: RawResultRow;
  countryFlag?: string;
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
  return firstText(row.displayName, row.name, row.fullName) || "Athlete";
}

function resultBib(row: RawResultRow): string {
  // athleteUid is an internal identity, not a race bib. Using it as the route
  // bib makes finished leaderboard rows request /results/:athleteUid and then
  // miss the canonical athlete alias as well.
  return firstText(
    row.bibNumber,
    row.bib,
    row.bibNo,
    row.raceNumber,
    row.startNumber,
  );
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

function resultCategory(row: RawResultRow): string {
  return firstText(
    row.contestName,
    row.contest,
    row.raceCategory,
    row.category,
    row.ageGroup,
  );
}

function resultPace(row?: RawResultRow): string {
  if (!row) return "—";
  if (row.metricHidden === true) return "—";
  return (
    firstText(
      row.pace,
      row.averagePace,
      row.currentPace,
      row.paceLabel,
      row.averagePaceLabel,
      row.speed,
      row.averageSpeed,
    ) || "—"
  );
}

function finiteMetric(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatPaceMetric(seconds: number, unit: "/100m" | "/km"): string {
  const rounded = Math.max(0, Math.round(seconds));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")} ${unit}`;
}

function sportMetricForSplit(
  split: Record<string, unknown> | undefined,
  athlete: Record<string, unknown>,
): string {
  if (!split || split.isStart === true) return "—";
  const distanceInLegKm = finiteMetric(
    split.distanceInLegKm ?? split.legDistanceKm,
  );
  if (distanceInLegKm == null) return "—";
  const leg = firstText(split.legType, split.leg, split.assignedLeg).toLowerCase();
  const directSwim = finiteMetric(split.paceSecondsPer100m);
  const directRun = finiteMetric(split.paceSecondsPerKm);
  const directBike = finiteMetric(split.speedKmh);
  if (leg === "swim" && directSwim != null) return formatPaceMetric(directSwim, "/100m");
  if (leg.startsWith("run") && directRun != null) return formatPaceMetric(directRun, "/km");
  if (leg === "bike" && directBike != null) return `${directBike.toFixed(1)} km/h`;

  const currentElapsed = cumulativeSplitSeconds(split, athlete);
  if (currentElapsed == null) return "—";
  const sameLeg = participantSplits(athlete)
    .filter((candidate) => firstText(candidate.legType, candidate.leg, candidate.assignedLeg).toLowerCase() === leg)
    .map((candidate) => ({
      split: candidate,
      elapsed: cumulativeSplitSeconds(candidate, athlete),
      distance: Number(candidate.distanceInLegKm ?? candidate.legDistanceKm),
    }))
    .filter((candidate) => candidate.elapsed != null && Number.isFinite(candidate.distance))
    .sort((a, b) => Number(a.distance) - Number(b.distance));
  const start = sameLeg[0];
  const legSeconds = start?.elapsed != null ? currentElapsed - start.elapsed : null;
  const legDistance = start && Number.isFinite(start.distance)
    ? distanceInLegKm - start.distance
    : distanceInLegKm;
  if (legSeconds == null || legSeconds <= 0 || legDistance <= 0) return "—";
  if (leg === "swim") return formatPaceMetric(legSeconds / (legDistance * 10), "/100m");
  if (leg === "bike") return `${(legDistance / (legSeconds / 3600)).toFixed(1)} km/h`;
  if (leg.startsWith("run")) return formatPaceMetric(legSeconds / legDistance, "/km");
  return "—";
}

function currentSportMetricForParticipant(
  athlete: Record<string, unknown>,
  configuredContests: Record<string, unknown>[],
): string {
  const participantContestKeys = new Set(
    [
      athlete.contestUuid,
      athlete.providerContestUuid,
      athlete.ticketId,
      athlete.bergmanTicketId,
      resultCategory(athlete as RawResultRow),
    ]
      .map((value) => normalizedKey(text(value)))
      .filter(Boolean),
  );
  const configuredContest = configuredContests.find((contest) =>
    [
      contest.providerContestUuid,
      contest.contestUuid,
      contest.bergmanTicketId,
      contest.ticketId,
      contest.name,
      contest.contestName,
      contest.displayName,
      contest.label,
    ]
      .map((value) => normalizedKey(text(value)))
      .some((value) => value && participantContestKeys.has(value)),
  );
  const configuredSplits = recordArray(configuredContest?.splits);
  const presentationSplits = participantSplits(athlete).map((split) => {
    const configuredSplit = configuredSplits.find(
      (candidate) =>
        splitKey(candidate) === splitKey(split) ||
        normalizedKey(splitLabel(candidate)) ===
          normalizedKey(splitLabel(split)),
    );
    // The canonical course owns leg-local distance. The live split owns read
    // time. Combining those presentation fields avoids deriving distance from
    // cumulative race progress in the mobile UI.
    return configuredSplit
      ? {
          ...configuredSplit,
          ...split,
          distanceInLegKm:
            split.distanceInLegKm ??
            split.legDistanceKm ??
            configuredSplit.distanceInLegKm ??
            configuredSplit.legDistanceKm,
          legType:
            split.legType ??
            split.leg ??
            configuredSplit.legType ??
            configuredSplit.leg,
        }
      : split;
  });
  const presentationAthlete = { ...athlete, splits: presentationSplits };
  const completed = presentationSplits
    .map((split, index) => {
      return {
        split,
        index,
        elapsed: cumulativeSplitSeconds(split, presentationAthlete),
      };
    })
    .filter(
      (candidate): candidate is {
        split: Record<string, unknown>;
        index: number;
        elapsed: number;
      } => candidate.elapsed != null,
    )
    .sort((a, b) => b.elapsed - a.elapsed || b.index - a.index);

  for (const candidate of completed) {
    const metric = sportMetricForSplit(candidate.split, presentationAthlete);
    if (metric !== "—") return metric;
  }
  return "—";
}

function leaderboardIdentityKeys(row: Record<string, unknown>): Set<string> {
  const identity =
    row.identity && typeof row.identity === "object"
      ? (row.identity as Record<string, unknown>)
      : undefined;
  return new Set(
    [
      row.participantUuid,
      row.providerParticipantUuid,
      row.providerUuid,
      row.providerAthleteUuid,
      row.athleteUid,
      row.athleteId,
      identity?.participantUuid,
      identity?.providerParticipantUuid,
      identity?.providerUuid,
      identity?.athleteId,
    ]
      .map((value) => text(value).toLowerCase())
      .filter(Boolean),
  );
}

function participantForLeaderboardRow(
  row: Record<string, unknown>,
  participants: Record<string, unknown>[],
): Record<string, unknown> | undefined {
  const rowKeys = leaderboardIdentityKeys(row);
  if (rowKeys.size > 0) {
    const strongMatch = participants.find((participant) => {
      for (const key of leaderboardIdentityKeys(participant)) {
        if (rowKeys.has(key)) return true;
      }
      return false;
    });
    if (strongMatch) return strongMatch;
  }

  // Bib is only a safe fallback within the same contest; separate Feibot
  // contests can reuse a bib number in one Bergman event.
  const rowBib = firstText(row.bib, row.bibNumber).toLowerCase();
  const rowContest = normalizedKey(resultCategory(row as RawResultRow));
  if (!rowBib) return undefined;
  return participants.find((participant) => {
    const participantBib = firstText(
      participant.bib,
      participant.bibNumber,
    ).toLowerCase();
    const participantContest = normalizedKey(
      resultCategory(participant as RawResultRow),
    );
    return participantBib === rowBib && (
      !rowContest || !participantContest || participantContest === rowContest
    );
  });
}

function resultGender(row: RawResultRow): string {
  return firstText(row.gender);
}

function resultAgeGroup(row: RawResultRow): string {
  return firstText(row.ageGroup, row.ageGroupName, row.ageCategory);
}

type FilterOption = { key: string; label: string };

function resultTime(row: RawResultRow): string {
  return firstText(row.overallTime, row.chipTime, row.finishTime) || "—";
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

function resultRank(row: RawResultRow, index: number): number {
  const value = firstText(
    row.overallRank,
    row.overallPosition,
    row.oRank,
    row.rank,
    row.cRank,
    row.gRank,
  );
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : index + 1;
}

function resultRankLabel(row: RawResultRow, index: number): number | string {
  return hasNoFinishRank(row) ? "-" : resultRank(row, index);
}

function numericRankValue(rank: number | string): number {
  return typeof rank === "number" ? rank : Number.MAX_SAFE_INTEGER;
}

type SplitOption = {
  key: string;
  label: string;
  order: number;
  transitionFromKey?: string;
  transitionToKey?: string;
  transitionFromLabel?: string;
  transitionToLabel?: string;
};

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object",
      )
    : [];
}

function ageGroupSortValue(label: string): [number, number, number] {
  const normalized = label.trim().toLowerCase();
  const numbers = normalized.match(/\d+/g)?.map(Number) ?? [];
  if (/\b(under|below|upto|up to|u)\s*-?\s*\d+/.test(normalized)) {
    return [0, numbers[0] ?? 0, numbers[0] ?? 0];
  }
  if (/\b(above|over)\b/.test(normalized)) {
    return [2, numbers[0] ?? Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
  }
  if (numbers.length > 0) {
    return [1, numbers[0], numbers[1] ?? numbers[0]];
  }
  return [3, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
}

function compareAgeGroupLabels(a: string, b: string): number {
  const av = ageGroupSortValue(a);
  const bv = ageGroupSortValue(b);
  return (
    av[0] - bv[0] ||
    av[1] - bv[1] ||
    av[2] - bv[2] ||
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
  );
}

function normalizeAgeGroupOption(label: string): FilterOption | null {
  const clean = label.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  const normalized = clean.toLowerCase();
  const numbers = normalized.match(/\d+/g)?.map(Number) ?? [];
  if (/\b(under|below|upto|up to|u)\s*-?\s*\d+/.test(normalized)) {
    const age = numbers[0];
    return age == null ? null : { key: `under:${age}`, label: `Under ${age}` };
  }
  if (
    /\b(above|over)\b/.test(normalized) ||
    /\d+\s*(?:\+|and above)$/.test(normalized)
  ) {
    const age = numbers[0];
    return age == null ? null : { key: `above:${age}`, label: `Above ${age}` };
  }
  if (numbers.length >= 2) {
    return {
      key: `range:${numbers[0]}-${numbers[1]}`,
      label: `${numbers[0]}–${numbers[1]}`,
    };
  }
  return { key: normalized, label: clean };
}

function splitKey(row: Record<string, unknown>): string {
  return normalizedKey(
    firstText(
      row.key,
      row.splitKey,
      row.canonicalCode,
      row.canonical_code,
      row.splitUuid,
      row.uuid,
      row.id,
      row.splitName,
      row.name,
      row.label,
      row.timingPointName,
    ),
  );
}

function splitLabel(row: Record<string, unknown>): string {
  return (
    firstText(row.splitName, row.name, row.label, row.timingPointName) ||
    "Split"
  );
}

function durationSeconds(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0)
    return value;
  const candidate = text(value);
  if (!candidate) return null;
  if (/^\d+(?:\.\d+)?$/.test(candidate)) return Number(candidate);
  const parts = candidate.split(":").map(Number);
  if (
    parts.length < 2 ||
    parts.length > 3 ||
    parts.some((part) => !Number.isFinite(part))
  )
    return null;
  const [hours, minutes, seconds] =
    parts.length === 3 ? parts : [0, parts[0], parts[1]];
  return hours * 3600 + minutes * 60 + seconds;
}

function dateMilliseconds(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  const candidate = text(value);
  if (!candidate) return null;
  const parsed = Date.parse(candidate);
  return Number.isFinite(parsed) ? parsed : null;
}

function cumulativeSplitSeconds(
  split: Record<string, unknown>,
  athlete: Record<string, unknown>,
): number | null {
  const direct = [
    split.cumulativeElapsedSeconds,
    split.cumulativeTimeSeconds,
    split.raceTimeSeconds,
    split.elapsedSeconds,
    split.cumulativeElapsedTime,
    split.cumulativeTime,
    split.raceTime,
    split.elapsedTime,
    split.timeSec,
    split.time,
  ];
  for (const value of direct) {
    const seconds = durationSeconds(value);
    if (seconds != null && seconds >= 0) return seconds;
  }

  const arrival = dateMilliseconds(
    split.timeOfDay ??
      split.timestamp ??
      split.providerTimestamp ??
      split.readTimestamp ??
      split.readAt ??
      split.recordedAt ??
      split.passedAt ??
      split.absoluteTimestamp,
  );
  const registration =
    athlete.registration && typeof athlete.registration === "object"
      ? (athlete.registration as Record<string, unknown>)
      : undefined;
  const start = dateMilliseconds(
    athlete.officialStartTime ??
      athlete.chipStartTime ??
      athlete.actualStartTime ??
      athlete.startTime ??
      registration?.officialStartTime ??
      registration?.chipStartTime ??
      registration?.startTime,
  );
  return arrival != null && start != null && arrival >= start
    ? (arrival - start) / 1000
    : null;
}

function formatElapsed(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return `${hours > 0 ? `${String(hours).padStart(2, "0")}:` : ""}${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function formatGap(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return `+${hours > 0 ? `${String(hours).padStart(2, "0")}:` : ""}${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function participantSplits(
  row: Record<string, unknown>,
): Record<string, unknown>[] {
  return recordArray(
    row.splits ?? (row.result as Record<string, unknown> | undefined)?.splits,
  );
}

function normalizedKey(value: string): string {
  return value.trim().toLowerCase();
}

function contestStartTimestamp(contest: Record<string, unknown>): number {
  const raw =
    contest.raw && typeof contest.raw === "object"
      ? (contest.raw as Record<string, unknown>)
      : undefined;
  const schedule =
    contest.schedule && typeof contest.schedule === "object"
      ? (contest.schedule as Record<string, unknown>)
      : undefined;
  const value = firstText(
    contest.gunStartTime,
    contest.GunStartTime,
    contest.scheduledStart,
    contest.startDate,
    contest.startTime,
    contest.raceDate,
    contest.eventDate,
    contest.date,
    raw?.GunStartTime,
    raw?.gunStartTime,
    raw?.StartTime,
    raw?.startTime,
    raw?.RaceDate,
    raw?.raceDate,
    schedule?.startDate,
    schedule?.startTime,
    schedule?.date,
  );
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function contestIsLive(contest: Record<string, unknown>): boolean {
  const raw =
    contest.raw && typeof contest.raw === "object"
      ? (contest.raw as Record<string, unknown>)
      : undefined;
  const status = firstText(
    contest.status,
    contest.state,
    contest.liveState,
    raw?.status,
    raw?.state,
  ).toLowerCase();
  return contest.isLive === true || status === "live" || status === "started";
}

function contestLabelPriority(label: string): number {
  const normalized = normalizedKey(label);
  if (
    normalized.includes("bergman 102") ||
    normalized.includes("102 triathlon")
  )
    return 0;
  if (normalized.includes("olympic")) return 1;
  if (normalized.includes("swimathon")) return 2;
  return 3;
}

function rowMatchesMode(row: RawResultRow | undefined, mode: Mode): boolean {
  if (!row) return true;
  switch (mode) {
    case "male":
      return normalizedKey(resultGender(row)) === "male";
    case "female":
      return normalizedKey(resultGender(row)) === "female";
    case "overall":
    default:
      return true;
  }
}

function compareRows(a: RawResultRow, b: RawResultRow): number {
  const statusDiff =
    statusPriority(resultStatus(a)) - statusPriority(resultStatus(b));
  if (statusDiff !== 0) return statusDiff;

  const aPosition = resultRank(a, Number.MAX_SAFE_INTEGER);
  const bPosition = resultRank(b, Number.MAX_SAFE_INTEGER);
  if (aPosition !== bPosition) return aPosition - bPosition;

  return resultName(a).localeCompare(resultName(b), undefined, {
    sensitivity: "base",
  });
}

function mapResultRow(row: RawResultRow, index: number) {
  return {
    id:
      resultBib(row) ||
      text(row.id ?? row.docId ?? row.athleteUid) ||
      `${resultName(row)}:${index + 1}`,
    rank: resultRankLabel(row, index),
    name: resultName(row),
    time: resultTime(row),
    detail:
      [resultCategory(row), resultClub(row)].filter(Boolean).join(" · ") ||
      undefined,
    countryFlag: resultCountryFlag(row),
    avatarUri:
      firstText(row.profilePhotoUrl, row.photoUrl, row.photoURL, row.avatarUrl, row.displayPhoto) || undefined,
    avatarSeed: text(row.athleteUid ?? row.bib ?? row.bibNumber) || undefined,
    row,
  };
}

function AthleteTrackingSearchRow({
  athlete,
  watched,
  onTrack,
  onToggleTracking,
}: {
  athlete: AthleteSummary;
  watched: boolean;
  onTrack: () => void;
  onToggleTracking: () => void;
}) {
  const theme = useTheme();
  return (
    <Card style={{ gap: theme.spacing.md }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: theme.spacing.md,
        }}
      >
        <Avatar
          name={athlete.name}
          uri={athlete.photoUrl}
          colorSeed={athlete.id}
          size={44}
        />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="headline" numberOfLines={1}>
            {athlete.name}
          </Text>
          <Text variant="bodySmall" color="textMuted" numberOfLines={1}>
            {athlete.category ? `${athlete.category} · ` : ""}Bib {athlete.bib}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: theme.spacing.sm }}>
        <Button label="Live Tracking" size="sm" onPress={onTrack} />
        <Button
          label={watched ? "Added" : "Add to Tracking"}
          variant={watched ? "secondary" : "ghost"}
          size="sm"
          onPress={onToggleTracking}
        />
      </View>
    </Card>
  );
}

function SlidingAthleteName({ name, compact }: { name: string; compact: boolean }) {
  const [translateX] = useState(() => new Animated.Value(0));
  const [availableNameWidth, setAvailableNameWidth] = useState(0);
  const [measuredNameWidth, setMeasuredNameWidth] = useState(0);
  const overflow = Math.max(0, measuredNameWidth - availableNameWidth);
  const shouldAnimate = shouldAnimateAthleteName(
    measuredNameWidth,
    availableNameWidth,
  );

  useEffect(() => {
    translateX.stopAnimation();
    translateX.setValue(0);
    if (!shouldAnimate) return;

    const travelDuration = Math.max(2200, overflow * 55);
    const animation = Animated.loop(
      Animated.sequence([
        Animated.delay(500),
        Animated.timing(translateX, {
          toValue: -overflow,
          duration: travelDuration,
          easing: Easing.linear,
          useNativeDriver: false,
        }),
        Animated.delay(650),
        Animated.timing(translateX, {
          toValue: 0,
          duration: travelDuration,
          easing: Easing.linear,
          useNativeDriver: false,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [overflow, shouldAnimate, translateX]);

  const measureContainer = (event: LayoutChangeEvent) =>
    setAvailableNameWidth(event.nativeEvent.layout.width);

  return (
    <View
      onLayout={measureContainer}
      style={{ width: "100%", overflow: "hidden" }}
    >
      <ScrollView
        horizontal
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        onContentSizeChange={(width) => setMeasuredNameWidth(width)}
        style={{ width: "100%", overflow: "hidden" }}
        contentContainerStyle={{ flexGrow: 0 }}
      >
        <Animated.Text
          accessibilityLabel={name}
          numberOfLines={1}
          style={{
            color: "#075B36",
            fontWeight: "900",
            fontSize: compact ? 12 : 14,
            lineHeight: compact ? 15 : 18,
            transform: [{ translateX }],
          }}
        >
          {name}
        </Animated.Text>
      </ScrollView>
    </View>
  );
}

function SportyLeaderboardRow({
  item,
  index,
  leaderSeconds,
  onPress,
}: {
  item: LeaderboardItem;
  index: number;
  leaderSeconds: number | null;
  onPress: () => void;
}) {
  const { width: viewportWidth } = useWindowDimensions();
  const compact = viewportWidth < 480;
  const athleteSeconds = durationSeconds(item.time);
  const canonicalGap = firstText((item.row as Record<string, unknown> | undefined)?.gapDisplay);
  const itemRank = Number(item.rank);
  const gap = canonicalGap || (
    (!Number.isFinite(itemRank) || itemRank > 1) &&
    leaderSeconds != null &&
    athleteSeconds != null &&
    athleteSeconds >= leaderSeconds
      ? formatGap(athleteSeconds - leaderSeconds)
      : null);
  const bib = item.row ? resultBib(item.row) : item.id;
  const privacyRow = item.row as (RawResultRow & Record<string, unknown>) | undefined;
  const viewerCanSeeIdentity = privacyRow?.viewerCanSeeIdentity === true
    || privacyRow?.privacyMasked === false;
  const anonymous = !viewerCanSeeIdentity && String(
    privacyRow?.trackingVisibility ??
      privacyRow?.liveTrackingPrivacy ??
      privacyRow?.privacy ??
      "",
  ).toUpperCase() === "ANONYMOUS";
  const rank = typeof item.rank === "number" ? item.rank : item.rank || "—";
  const numericRank = Number(rank);
  const podiumAccent = numericRank === 1
    ? "#D8A600"
    : numericRank === 2
      ? "#7D8B86"
      : numericRank === 3
        ? "#B86F32"
        : "#075B36";
  const club = item.row ? resultClub(item.row) : "";
  const identity = athleteIdentityLines({
    name: item.name,
    club,
    bib: bib || undefined,
    flag: item.countryFlag,
  });
  const positionDeltaValue = Number(privacyRow?.positionDelta);
  const positionDelta = Number.isFinite(positionDeltaValue) && positionDeltaValue !== 0
    ? positionDeltaValue
    : null;
  const positionDescription = firstText(privacyRow?.positionDescription) || "Position unchanged";

  return (
    <Pressable
      accessibilityRole={anonymous ? undefined : "button"}
      accessibilityLabel={anonymous ? "Anonymous leaderboard athlete" : `Open ${item.name}`}
      onPress={anonymous ? undefined : onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        minHeight: compact ? 88 : 82,
        paddingHorizontal: compact ? 8 : 12,
        paddingVertical: 10,
        backgroundColor: pressed
          ? "#E6F0EC"
          : numericRank > 0 && numericRank <= 3
            ? "#FBFAF3"
            : index % 2 === 0
              ? "#FFFFFF"
              : "#F4F6F5",
        borderBottomWidth: 1,
        borderBottomColor: "#E1E7E4",
        borderLeftWidth: numericRank > 0 && numericRank <= 3 ? 4 : 0,
        borderLeftColor: podiumAccent,
      })}
    >
      <View style={{ width: compact ? 28 : 38, alignItems: "center", justifyContent: "center" }}>
        <Text
          variant={numericRank > 0 && numericRank <= 3 ? "headline" : "body"}
          style={{ color: podiumAccent, fontWeight: "900" }}
        >
          {rank}
        </Text>
        {numericRank === 1 ? (
          <Icon name="trophy" size={13} colorValue={podiumAccent} />
        ) : null}
      </View>
      <Avatar
        name={item.name}
        uri={anonymous ? undefined : item.avatarUri}
        colorSeed={item.avatarSeed || bib || item.id}
        size={compact ? 36 : 44}
      />
      <View
        style={{ flex: 1, minWidth: 0, paddingLeft: compact ? 7 : 9, paddingRight: compact ? 4 : 8, gap: 1 }}
      >
        <SlidingAthleteName name={identity.name} compact={compact} />
        {!anonymous && identity.club ? (
          <Text
            variant="caption"
            numberOfLines={1}
            style={{ color: "#4F6259", ...(compact ? { fontSize: 9 } : null) }}
          >
            {identity.club}
          </Text>
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
          <Text
            variant="caption"
            numberOfLines={1}
            style={{ flexShrink: 1, color: "#66736D", ...(compact ? { fontSize: 10 } : null) }}
          >
            {anonymous
              ? "Identity protected"
              : identity.bib}
          </Text>
        </View>
      </View>
      <View style={{ width: compact ? 62 : 86, alignItems: "flex-end", gap: 2 }}>
        <Text
          variant="bodySmall"
          numberOfLines={1}
          style={{ color: "#101513", fontWeight: "900", ...(compact ? { fontSize: 12 } : null) }}
        >
          {item.time || "—"}
        </Text>
        {gap ? (
          <Text
            variant="caption"
            style={{ color: "#8A948F", fontStyle: "italic" }}
          >
            {gap}
          </Text>
        ) : numericRank === 1 ? (
          <Text
            variant="caption"
            style={{ color: "#178A57", fontWeight: "800" }}
          >
            LEADER
          </Text>
        ) : null}
      </View>
      <View
        accessible
        accessibilityLabel={positionDescription}
        style={{ width: compact ? 38 : 52, alignItems: "flex-end" }}
      >
        <Text
          variant="bodySmall"
          style={{
            color: positionDelta == null ? "#8A948F" : positionDelta > 0 ? "#178A57" : "#D32F2F",
            fontWeight: "900",
            ...(compact ? { fontSize: 11 } : null),
          }}
        >
          {positionDelta == null ? "—" : `${positionDelta > 0 ? "↑" : "↓"} ${Math.abs(positionDelta)}`}
        </Text>
      </View>
      <View style={{ width: compact ? 42 : 66, alignItems: "flex-end" }}>
        <Text
          variant="bodySmall"
          numberOfLines={1}
          style={{ color: "#26312C", ...(compact ? { fontSize: 11 } : null) }}
        >
          {resultPace(item.row)}
        </Text>
      </View>
    </Pressable>
  );
}

export function LeaderboardScreen() {
  const theme = useTheme();
  const { width: viewportWidth } = useWindowDimensions();
  const compactLeaderboard = viewportWidth < 480;
  const router = useRouter();
  const queryClient = useQueryClient();
  const { eventId } = useLocalSearchParams<{ eventId?: string | string[] }>();
  const globalParams = useGlobalSearchParams<{ eventId?: string | string[] }>();
  const id = safeRouteEventId(eventId, globalParams.eventId) ?? "";

  const handleBackPress = () => {
    if (!id) {
      router.replace("/");
      return;
    }
    router.replace({ pathname: "/event/[eventId]", params: { eventId: id } });
  };

  const { event, refetch: refetchEvent } = useEvent(id);
  const eventScreen = useEventScreenInitialization();
  const isFinished = event?.status === "finished";
  const isLive = event?.status === "live" || event?.status === "upcoming";
  const finishedResultsQuery = useEventResults(id, Boolean(id && isFinished));
  const usesOfficialResults = isFinished;
  const dataSource: "live" | "results" = usesOfficialResults
    ? "results"
    : "live";
  const trackingQuery = useEventTracking(
    id,
    eventScreen.queryEnabled && Boolean(id && !isFinished),
    false,
  );
  const courseQuery = useCourseMap(id, Boolean(id && !isFinished));
  const trackingState = String(
    (trackingQuery.data as Record<string, unknown> | undefined)?.state ??
      "visibility-disabled",
  );
  const publicAthleteVisibilityEnabled =
    (trackingQuery.data as Record<string, unknown> | undefined)
      ?.publicAthleteVisibility === true &&
    trackingState !== "visibility-disabled";
  const liveAthleteDataReady =
    publicAthleteVisibilityEnabled && trackingState !== "data-pending";

  const [mode, setMode] = useState<Mode>("overall");
  const [athleteQuery, setAthleteQuery] = useState("");
  const [contestKey, setContestKey] = useState("all");
  const [ageGroupKey, setAgeGroupKey] = useState("all");
  const [leaderboardPage, setLeaderboardPage] = useState(0);
  const leaderboardListRef = useRef<FlatList<LeaderboardItem>>(null);
  const [selectedSplitKey, setSelectedSplitKey] = useState("overall");
  const [followLeadingSplit, setFollowLeadingSplit] = useState(true);
  const [activeFilterPicker, setActiveFilterPicker] = useState<
    null | "contest" | "ageGroup" | "gender"
  >(null);
  const autoRefreshEventRef = useRef<string | null>(null);
  const refreshInFlightRef = useRef(false);
  const autoRefreshAttemptedRef = useRef<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const filters = useMemo(
    () => MODES.find((m) => m.key === mode)?.filters ?? {},
    [mode],
  );
  const debouncedQuery = useDebouncedValue(athleteQuery, 200);

  const query = useLeaderboard(
    id,
    filters,
    {
      focused: eventScreen.focused,
      isLive,
      enabled:
        eventScreen.queryEnabled &&
        Boolean(event) &&
        !isFinished &&
        liveAthleteDataReady,
    },
    "live",
  );
  const refetchOfficialResults = finishedResultsQuery.refetch;
  const officialResultsLoading = finishedResultsQuery.isLoading;
  const officialResultsFetching = finishedResultsQuery.isFetching;
  const refetchLiveLeaderboard = query.refetch;
  const search = useAthleteSearch(
    id,
    debouncedQuery,
    "name",
    eventScreen.focused && (dataSource === "results" || liveAthleteDataReady),
    dataSource,
  );
  const { addAthlete, isWatched } = useWatchlist(id);
  useEventScreenFocusRefresh(
    id,
    isLive
      ? [
          { refetch: () => refetchOfficialResults({ cancelRefetch: false }) },
          { refetch: () => refetchLiveLeaderboard({ cancelRefetch: false }) },
        ]
      : [{ refetch: () => refetchOfficialResults({ cancelRefetch: false }) }],
  );
  useEffect(() => {
    if (!eventScreen.focused || typeof document === "undefined") return;
    const active = document.activeElement as HTMLElement | null;
    if (active && typeof active.blur === "function") {
      requestAnimationFrame(() => active.blur());
    }
  }, [eventScreen.focused]);
  const liveParticipants = useMemo(
    () =>
      recordArray(
        (trackingQuery.data as Record<string, unknown> | undefined)
          ?.participants,
      ),
    [trackingQuery.data],
  );
  const configuredContests = useMemo(
    () =>
      recordArray(
        (courseQuery.data?.courseIndex as Record<string, unknown> | undefined)
          ?.contests,
      ),
    [courseQuery.data?.courseIndex],
  );
  const leaderboardEntries = useMemo<LeaderboardItem[]>(() => {
    if (usesOfficialResults) {
      const rows = [
        ...((finishedResultsQuery.data ?? []) as RawResultRow[]),
      ].sort(compareRows);
      return rows.map((row, index) =>
        mapResultRow(row, index),
      ) as LeaderboardItem[];
    }
    return ((query.data ?? []) as LeaderboardItem[]).map((item) => {
      const row = item.row;
      if (!row || resultPace(row) !== "—") return item;
      const participant = participantForLeaderboardRow(row, liveParticipants);
      if (!participant) return item;
      const pace = currentSportMetricForParticipant(
        participant,
        configuredContests,
      );
      if (pace === "—") return item;
      return {
        ...item,
        row: {
          ...row,
          pace,
          metricHidden: false,
        },
      };
    });
  }, [configuredContests, finishedResultsQuery.data, liveParticipants, query.data, usesOfficialResults]);
  const contestOptions = useMemo<FilterOption[]>(() => {
    const options = new Map<string, FilterOption>();
    const metadata = new Map<
      string,
      { live: boolean; startsAt: number; order: number }
    >();
    const add = (label: string, contest?: Record<string, unknown>) => {
      const cleanLabel = text(label);
      const key = normalizedKey(cleanLabel);
      if (key && !options.has(key))
        options.set(key, { key, label: cleanLabel });
      if (key && contest) {
        metadata.set(key, {
          live: contestIsLive(contest),
          startsAt: contestStartTimestamp(contest),
          order: Number(
            contest.order ?? contest.sortOrder ?? Number.MAX_SAFE_INTEGER,
          ),
        });
      }
    };
    configuredContests.forEach((contest) =>
      add(
        firstText(
          contest.name,
          contest.contestName,
          contest.label,
          contest.title,
        ),
        contest,
      ),
    );
    liveParticipants.forEach((participant) => add(resultCategory(participant)));
    leaderboardEntries.forEach((entry) => {
      if (entry.row) add(resultCategory(entry.row));
    });
    return [...options.values()].sort((a, b) => {
      const aMeta = metadata.get(a.key);
      const bMeta = metadata.get(b.key);
      if (aMeta?.live !== bMeta?.live) return aMeta?.live ? -1 : 1;
      const aDate = aMeta?.startsAt ?? Number.POSITIVE_INFINITY;
      const bDate = bMeta?.startsAt ?? Number.POSITIVE_INFINITY;
      if (aDate !== bDate) return aDate - bDate;
      const priority =
        contestLabelPriority(a.label) - contestLabelPriority(b.label);
      if (priority !== 0) return priority;
      const order =
        (aMeta?.order ?? Number.MAX_SAFE_INTEGER) -
        (bMeta?.order ?? Number.MAX_SAFE_INTEGER);
      if (order !== 0) return order;
      return a.label.localeCompare(b.label, undefined, { numeric: true });
    });
  }, [configuredContests, leaderboardEntries, liveParticipants]);
  const selectedContest = useMemo<FilterOption | "all">(() => {
    if (contestOptions.length === 0) return "all";
    return (
      contestOptions.find((option) => option.key === contestKey) ??
      contestOptions[0]
    );
  }, [contestKey, contestOptions]);
  const selectedConfiguredContest = useMemo(() => {
    if (selectedContest === "all") return null;
    const selectedKey = normalizedKey(selectedContest.label);
    return (
      configuredContests.find(
        (contest) =>
          normalizedKey(
            firstText(
              contest.name,
              contest.contestName,
              contest.label,
              contest.title,
            ),
          ) === selectedKey,
      ) ?? null
    );
  }, [configuredContests, selectedContest]);

  const splitOptions = useMemo<SplitOption[]>(() => {
    if (selectedContest === "all") return [];
    const selectedContestKey = normalizedKey(selectedContest.label);
    const configuredSplits = configuredContests
      .filter(
        (contest) =>
          normalizedKey(
            firstText(
              contest.name,
              contest.contestName,
              contest.label,
              contest.title,
            ),
          ) === selectedContestKey,
      )
      .flatMap((contest) =>
        recordArray(contest.splits).map((split, index) => ({
          key: splitKey(split),
          label: splitLabel(split),
          order: Number(split.order ?? index + 1),
        })),
      );
    const completedSplits = liveParticipants
      .filter(
        (participant) =>
          normalizedKey(resultCategory(participant)) === selectedContestKey,
      )
      .flatMap((participant) =>
        participantSplits(participant).map((split, index) => ({
          key: splitKey(split),
          label: splitLabel(split),
          order: Number(split.order ?? index + 1),
        })),
      );
    const unique = new Map<string, SplitOption>();
    for (const option of [...configuredSplits, ...completedSplits]) {
      if (!option.key) continue;
      // A provider UUID and canonical key can describe the same checkpoint.
      // Spectator navigation is semantic, so dedupe by the human checkpoint
      // label and retain the canonical/configured row encountered first.
      const semanticKey = normalizedKey(option.label)
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
      const identity = semanticKey || option.key;
      if (unique.has(identity)) continue;
      unique.set(identity, option);
    }
    const ordered = [...unique.values()].sort(
      (a, b) =>
        a.order - b.order ||
        a.label.localeCompare(b.label, undefined, { numeric: true }),
    );
    const findBoundary = (label: string) => ordered.find(
      (option) => normalizedKey(option.label).replace(/[_-]+/g, " ") === label,
    );
    const withTransitions = [...ordered];
    const addTransition = (
      key: string,
      label: string,
      from: SplitOption | undefined,
      to: SplitOption | undefined,
    ) => {
      if (!from || !to || withTransitions.some((option) => option.key === key)) return;
      withTransitions.push({
        key,
        label,
        order: (from.order + to.order) / 2,
        transitionFromKey: from.key,
        transitionToKey: to.key,
        transitionFromLabel: from.label,
        transitionToLabel: to.label,
      });
    };
    addTransition("transition:t1", "T1", findBoundary("swim finish"), findBoundary("bike start"));
    addTransition("transition:t2", "T2", findBoundary("bike finish"), findBoundary("run start"));
    return withTransitions.sort(
      (a, b) => a.order - b.order || a.label.localeCompare(b.label),
    );
  }, [configuredContests, liveParticipants, selectedContest]);
  const leadingSplitKey = useMemo(() => {
    if (selectedContest === "all") return null;
    const contestKey = normalizedKey(selectedContest.label);
    const contestParticipants = liveParticipants.filter(
      (participant) =>
        normalizedKey(resultCategory(participant)) === contestKey,
    );
    const completed = [...splitOptions]
      .sort((a, b) => b.order - a.order)
      .find((option) =>
        contestParticipants.some((participant) =>
          participantSplits(participant).some(
            (split) =>
              (splitKey(split) === option.key ||
                normalizedKey(splitLabel(split)) ===
                  normalizedKey(option.label)) &&
              cumulativeSplitSeconds(split, participant) != null,
          ),
        ),
      );
    return completed?.key ?? null;
  }, [liveParticipants, selectedContest, splitOptions]);
  const manuallySelectedSplitKey =
    selectedSplitKey === "overall" ||
    splitOptions.some((split) => split.key === selectedSplitKey)
      ? selectedSplitKey
      : "overall";
  const effectiveSplitKey =
    followLeadingSplit && leadingSplitKey
      ? leadingSplitKey
      : manuallySelectedSplitKey;
  const effectiveSplitOption = splitOptions.find(
    (split) => split.key === effectiveSplitKey,
  );
  const canonicalContestId = selectedContest === "all"
    ? ""
    : firstText(
        selectedConfiguredContest?.providerContestUuid,
        selectedConfiguredContest?.contestUuid,
        selectedConfiguredContest?.bergmanTicketId,
        selectedContest.label,
      );
  const canonicalLeaderboardMode = ageGroupKey !== "all"
    ? "age"
    : mode === "male" || mode === "female" ? "gender" : "overall";
  const canonicalSplitLeaderboardQuery = useQuery({
    queryKey: [
      "canonical-split-leaderboard",
      id,
      canonicalContestId,
      effectiveSplitKey,
      canonicalLeaderboardMode,
      ageGroupKey,
      mode,
    ],
    enabled: Boolean(
      id
      && canonicalContestId
      && effectiveSplitKey !== "overall"
      && !effectiveSplitOption?.transitionFromKey
      && !usesOfficialResults
      && eventScreen.focused,
    ),
    queryFn: ({ signal }) => CanonicalTrackingRepository.getCanonicalLeaderboard(id, {
      contestId: canonicalContestId,
      mode: canonicalLeaderboardMode,
      split: effectiveSplitKey,
      ageGroup: canonicalLeaderboardMode === "age" ? ageGroupKey : undefined,
      gender: canonicalLeaderboardMode === "gender" ? (mode === "male" ? "male" : "female") : undefined,
      limit: 500,
    }, signal),
    refetchInterval: isLive ? 3_000 : false,
    staleTime: 1_000,
  });
  const splitNavigationOptions = useMemo(
    () => [{ key: "overall", label: "Overall", order: 0 }, ...splitOptions],
    [splitOptions],
  );
  const activeSplitIndex = Math.max(
    0,
    splitNavigationOptions.findIndex(
      (split) => split.key === effectiveSplitKey,
    ),
  );
  const splitLeaderboardEntries = useMemo<LeaderboardItem[]>(() => {
    if (effectiveSplitKey === "overall") return [];
    const splitPresentationLabel = effectiveSplitOption?.label ?? effectiveSplitKey;
    const canonicalEntries = canonicalSplitLeaderboardQuery.data?.data?.entries;
    if (!effectiveSplitOption?.transitionFromKey && Array.isArray(canonicalEntries)) {
      return canonicalEntries.map((entry, index) => {
        const row = entry as RawResultRow & Record<string, unknown>;
        const pace = paceForLeaderboardSplit(
          splitPresentationLabel,
          firstText(
            row.paceDisplay,
            row.pace,
            row.speedDisplay,
            row.speed,
            row.averageSpeed,
          ),
        );
        const visibility = String(row.trackingVisibility ?? "PUBLIC").toUpperCase();
        const anonymous = visibility !== "PUBLIC";
        return {
          id: anonymous
            ? `anonymous:${row.rank ?? index + 1}:${canonicalContestId}`
            : firstText(row.participantUuid, row.providerParticipantUuid, row.bib) || `canonical-athlete-${index}`,
          rank: Number(row.rank ?? index + 1),
          name: anonymous ? "Anonymous Athlete" : firstText(row.displayName, row.name) || "Athlete",
          time: formatElapsed(Number(row.elapsedSeconds ?? 0)),
          detail: [selectedContest === "all" ? "" : selectedContest.label, firstText(row.clubName), row.bib ? `Bib ${row.bib}` : ""].filter(Boolean).join(" · "),
          countryFlag: anonymous ? undefined : getCountryFlagEmoji(firstText(row.countryCode)) || undefined,
          avatarUri: anonymous ? undefined : firstText(row.photoUrl) || undefined,
          avatarSeed: firstText(row.participantUuid, row.providerParticipantUuid, row.bib) || undefined,
          row: {
            ...row,
            name: anonymous ? "Anonymous Athlete" : firstText(row.displayName, row.name),
            pace,
            gap: firstText(row.gapDisplay) || "—",
            metricHidden: pace === "—",
          },
        };
      });
    }
    const contestParticipants = liveParticipants.filter(
      (participant) =>
        selectedContest !== "all" &&
        normalizedKey(resultCategory(participant)) ===
          normalizedKey(selectedContest.label),
    );
    const participantIdentity = (participant: Record<string, unknown>) =>
      firstText(
        participant.participantUuid,
        participant.providerUuid,
        participant.athleteUid,
        participant.bib,
        participant.bibNumber,
      );
    const previousTransitionRanks = new Map<string, number>();
    if (effectiveSplitOption?.transitionFromKey) {
      contestParticipants
        .flatMap((participant) => {
          const boundary = participantSplits(participant).find(
            (candidate) =>
              splitKey(candidate) === effectiveSplitOption.transitionFromKey ||
              normalizedKey(splitLabel(candidate)) ===
                normalizedKey(effectiveSplitOption.transitionFromLabel || ""),
          );
          const elapsed = boundary
            ? cumulativeSplitSeconds(boundary, participant)
            : null;
          const identity = participantIdentity(participant);
          return elapsed == null || !identity
            ? []
            : [{ identity, elapsed }];
        })
        .sort((a, b) => a.elapsed - b.elapsed)
        .forEach((entry, index) =>
          previousTransitionRanks.set(entry.identity, index + 1),
        );
    }
    return contestParticipants
      .flatMap((participant) => {
        const rows = participantSplits(participant);
        const split = rows.find(
          (candidate) => splitKey(candidate) === effectiveSplitKey
            || (effectiveSplitOption
              && normalizedKey(splitLabel(candidate)) === normalizedKey(effectiveSplitOption.label)),
        );
        const fromSplit = effectiveSplitOption?.transitionFromKey
          ? rows.find((candidate) => (
              splitKey(candidate) === effectiveSplitOption.transitionFromKey
              || normalizedKey(splitLabel(candidate)) === normalizedKey(effectiveSplitOption.transitionFromLabel || "")
            ))
          : undefined;
        const toSplit = effectiveSplitOption?.transitionToKey
          ? rows.find((candidate) => (
              splitKey(candidate) === effectiveSplitOption.transitionToKey
              || normalizedKey(splitLabel(candidate)) === normalizedKey(effectiveSplitOption.transitionToLabel || "")
            ))
          : undefined;
        const fromSeconds = fromSplit ? cumulativeSplitSeconds(fromSplit, participant) : null;
        const toSeconds = toSplit ? cumulativeSplitSeconds(toSplit, participant) : null;
        const elapsedSeconds = effectiveSplitOption?.transitionFromKey
          ? transitionDurationSeconds(fromSeconds, toSeconds)
          : (split ? cumulativeSplitSeconds(split, participant) : null);
        if (elapsedSeconds == null) return [];
        return [{ participant, elapsedSeconds }];
      })
      .sort((a, b) => a.elapsedSeconds - b.elapsedSeconds)
      .map(({ participant, elapsedSeconds }, index) => {
        const row = participant as RawResultRow;
        const selectedSplit = participantSplits(participant).find(
          (candidate) => splitKey(candidate) === effectiveSplitKey
            || (effectiveSplitOption
              && normalizedKey(splitLabel(candidate)) === normalizedKey(effectiveSplitOption.label)),
        );
        const pace = paceForLeaderboardSplit(
          splitPresentationLabel,
          sportMetricForSplit(selectedSplit, participant),
        );
        const previousRank = previousTransitionRanks.get(
          participantIdentity(participant),
        );
        const positionDelta = previousRank == null
          ? null
          : previousRank - (index + 1);
        const displayRow: RawResultRow = {
          ...row,
          pace,
          metricHidden: pace === "—",
          ...(effectiveSplitOption?.transitionFromKey
            ? {
                positionDelta: positionDelta || null,
                positionDescription:
                  positionDelta == null || positionDelta === 0
                    ? "Position unchanged"
                    : `Moved ${positionDelta > 0 ? "up" : "down"} ${Math.abs(positionDelta)}`,
              }
            : null),
        };
        return {
          id:
            resultBib(row) ||
            firstText(row.participantUuid, row.providerUuid, row.athleteUid) ||
            `split-athlete-${index}`,
          rank: index + 1,
          name: resultName(row),
          time: formatElapsed(elapsedSeconds),
          detail: [
            resultCategory(row),
            resultClub(row),
            resultBib(row) ? `Bib ${resultBib(row)}` : "",
          ]
            .filter(Boolean)
            .join(" · "),
          countryFlag: resultCountryFlag(row),
          avatarUri:
            firstText(row.profilePhotoUrl, row.photoUrl, row.photoURL, row.avatarUrl, row.displayPhoto) ||
            undefined,
          avatarSeed:
            firstText(
              row.athleteUid,
              row.providerUuid,
              row.bib,
              row.bibNumber,
            ) || undefined,
          row: displayRow,
        };
      });
  }, [canonicalContestId, canonicalSplitLeaderboardQuery.data, effectiveSplitKey, effectiveSplitOption, liveParticipants, selectedContest]);
  const rankedEntries =
    effectiveSplitKey === "overall" || usesOfficialResults
      ? leaderboardEntries
      : splitLeaderboardEntries;

  const fetchOfficialResults = useCallback(async () => {
    if (!id) return [];
    if (process.env.NODE_ENV !== "production") {
      console.log("[Leaderboard Refresh] fetching official results", {
        eventId: id,
      });
    }
    const rows = await repositories.results.getEventResults(id);
    queryClient.setQueryData(queryKeys.eventResults(id), rows);
    return rows;
  }, [id, queryClient]);

  const refreshLeaderboard = useCallback(async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    setIsRefreshing(true);
    try {
      if (process.env.NODE_ENV !== "production") {
        console.log("[Leaderboard Refresh] triggered", { eventId: id, isLive });
      }
      const requests: Promise<unknown>[] = [
        refetchEvent(),
        fetchOfficialResults(),
      ];
      if (isLive) {
        requests.push(refetchLiveLeaderboard());
      }
      // Keep the loading state visible even when an empty response returns immediately.
      requests.push(new Promise((resolve) => setTimeout(resolve, 600)));
      await Promise.allSettled(requests);
    } finally {
      refreshInFlightRef.current = false;
      setIsRefreshing(false);
    }
  }, [fetchOfficialResults, id, isLive, refetchEvent, refetchLiveLeaderboard]);

  useEffect(() => {
    if (
      !id ||
      !eventScreen.focused ||
      leaderboardEntries.length > 0 ||
      officialResultsLoading ||
      officialResultsFetching
    )
      return;
    if (autoRefreshEventRef.current === id) return;

    autoRefreshEventRef.current = id;
    if (process.env.NODE_ENV !== "production") {
      console.log(
        "[Leaderboard Screen] auto-refreshing empty leaderboard once",
        { eventId: id, isLive, usesOfficialResults },
      );
    }
    void fetchOfficialResults();
  }, [
    eventScreen.focused,
    fetchOfficialResults,
    id,
    isLive,
    leaderboardEntries.length,
    officialResultsFetching,
    officialResultsLoading,
    usesOfficialResults,
  ]);

  useEffect(() => {
    if (!id || !eventScreen.focused) return;
    if (autoRefreshAttemptedRef.current === id) return;
    autoRefreshAttemptedRef.current = id;
    if (process.env.NODE_ENV !== "production") {
      console.log("[Leaderboard Screen] mounted/visible", {
        eventId: id,
        isLive,
        usesOfficialResults,
      });
    }
    void fetchOfficialResults();
  }, [
    eventScreen.focused,
    fetchOfficialResults,
    id,
    isLive,
    usesOfficialResults,
  ]);
  const leaderboardRows = useMemo(
    () =>
      rankedEntries.map((item) => item.row).filter(Boolean) as RawResultRow[],
    [rankedEntries],
  );
  const ageGroupOptions = useMemo<FilterOption[]>(() => {
    if (selectedContest === "all") return [];
    const selectedContestKey = normalizedKey(selectedContest.label);
    const options = new Map<string, FilterOption>();
    const add = (label: unknown) => {
      const cleanLabel = text(label);
      const option = normalizeAgeGroupOption(cleanLabel);
      if (!option || normalizedKey(cleanLabel) === selectedContestKey) return;
      const ageValues = option.label.match(/\d+/g)?.map(Number) ?? [];
      const isSwimathon = selectedContestKey.includes("swimathon");
      if (!isSwimathon && ageValues.length > 0 && ageValues[0] < 16) {
        return;
      }
      if (!options.has(option.key)) {
        options.set(option.key, option);
      }
    };
    const addConfiguredGroups = (value: unknown) => {
      recordArray(value).forEach((group) =>
        add(
          firstText(
            group.name,
            group.label,
            group.ageGroup,
            group.ageGroupName,
            group.ageCategory,
            group.title,
          ),
        ),
      );
    };

    if (selectedConfiguredContest) {
      addConfiguredGroups(selectedConfiguredContest.ageGroups);
      addConfiguredGroups(selectedConfiguredContest.ageGroupIndex);
      const ageGroupSet = selectedConfiguredContest.ageGroupSet;
      if (ageGroupSet && typeof ageGroupSet === "object") {
        const set = ageGroupSet as Record<string, unknown>;
        addConfiguredGroups(set.ageGroups ?? set.rows ?? set.items);
      }
    }

    for (const row of [...leaderboardRows, ...liveParticipants]) {
      if (normalizedKey(resultCategory(row)) === selectedContestKey) {
        add(resultAgeGroup(row));
      }
    }

    return [...options.values()].sort((a, b) =>
      compareAgeGroupLabels(a.label, b.label),
    );
  }, [
    leaderboardRows,
    liveParticipants,
    selectedConfiguredContest,
    selectedContest,
  ]);
  const selectedAgeGroup = useMemo<FilterOption | "all">(
    () =>
      ageGroupKey === "all"
        ? "all"
        : (ageGroupOptions.find((option) => option.key === ageGroupKey) ??
          "all"),
    [ageGroupKey, ageGroupOptions],
  );
  const filteredEntries = useMemo(
    () =>
      [...rankedEntries]
        .sort((a, b) =>
          usesOfficialResults
            ? compareRows(a.row ?? {}, b.row ?? {})
            : numericRankValue(a.rank) - numericRankValue(b.rank),
        )
        .filter((item) => {
          const row = item.row;
          if (!row) return true;
          const contest = normalizedKey(resultCategory(row));
          const ageGroup = normalizeAgeGroupOption(resultAgeGroup(row));
          return (
            (selectedContest === "all" ||
              contest === normalizedKey(selectedContest.label)) &&
            (selectedAgeGroup === "all" ||
              ageGroup?.key === selectedAgeGroup.key)
          );
        }),
    [rankedEntries, selectedAgeGroup, selectedContest, usesOfficialResults],
  );
  const modeFilteredEntries = useMemo(
    () => filteredEntries.filter((item) => rowMatchesMode(item.row, mode)),
    [filteredEntries, mode],
  );
  const paginatedLeaderboard = useMemo(
    () => paginateLeaderboard(modeFilteredEntries, leaderboardPage),
    [leaderboardPage, modeFilteredEntries],
  );
  const {
    rows: paginatedEntries,
    page: activeLeaderboardPage,
    pageCount: leaderboardPageCount,
    start: pageStart,
    end: pageEnd,
  } = paginatedLeaderboard;
  const leaderSeconds = useMemo(
    () => durationSeconds(modeFilteredEntries[0]?.time),
    [modeFilteredEntries],
  );
  const podiumEntries = useMemo(
    () =>
      modeFilteredEntries
        .filter((item) => typeof item.rank === "number")
        .slice(0, 3)
        .sort((a, b) => numericRankValue(a.rank) - numericRankValue(b.rank)),
    [modeFilteredEntries],
  );

  const openAthlete = (
    bib: string,
    athlete?: Pick<
      AthleteSummary,
      | "athleteUid"
      | "participantUuid"
      | "providerUuid"
      | "providerTimingUuid"
      | "providerRecordId"
      | "bookingId"
    >,
  ) => {
    const params = new URLSearchParams({ eventId: id, bib });
    if (athlete?.athleteUid) params.set("athleteUid", athlete.athleteUid);
    if (athlete?.participantUuid)
      params.set("participantUuid", athlete.participantUuid);
    if (athlete?.providerUuid) params.set("providerUuid", athlete.providerUuid);
    if (athlete?.providerTimingUuid)
      params.set("providerTimingUuid", athlete.providerTimingUuid);
    if (athlete?.providerRecordId)
      params.set("providerRecordId", athlete.providerRecordId);
    if (athlete?.bookingId) params.set("bookingId", athlete.bookingId);
    router.push(
      `/athletes/${encodeURIComponent(bib)}?${params.toString()}` as Href,
    );
  };

  const renderItem = useCallback(
    ({ item, index }: { item: LeaderboardItem; index: number }) => (
      <SportyLeaderboardRow
        item={item}
        index={index}
        leaderSeconds={leaderSeconds}
        onPress={() => {
          const rawRow = item.row;
          const rowBib = rawRow ? resultBib(rawRow) : "";
          openAthlete(
            rowBib || item.id,
            rawRow
              ? {
                  athleteUid: text(rawRow.athleteUid) || undefined,
                  participantUuid: text(rawRow.participantUuid) || undefined,
                  providerUuid:
                    firstText(
                      rawRow.providerUuid,
                      rawRow.providerParticipantUuid,
                      rawRow.providerAthleteUuid,
                    ) || undefined,
                  providerTimingUuid:
                    text(rawRow.providerTimingUuid) || undefined,
                  providerRecordId: text(rawRow.providerRecordId) || undefined,
                  bookingId: text(rawRow.bookingId) || undefined,
                }
              : undefined,
          );
        }}
      />
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, leaderSeconds],
  );
  const changeLeaderboardPage = (nextPage: number) => {
    setLeaderboardPage(Math.max(0, Math.min(leaderboardPageCount - 1, nextPage)));
    requestAnimationFrame(() =>
      leaderboardListRef.current?.scrollToOffset({ offset: 0, animated: true }),
    );
  };
  const renderPaginationControls = () => modeFilteredEntries.length > 0 ? (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: theme.spacing.sm,
        paddingVertical: 6,
      }}
    >
      <Text variant="caption" color="textMuted" style={{ fontWeight: "800" }}>
        {pageStart}–{pageEnd} of {modeFilteredEntries.length}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Previous 50 athletes"
        accessibilityState={{ disabled: activeLeaderboardPage === 0 }}
        disabled={activeLeaderboardPage === 0}
        onPress={() => changeLeaderboardPage(activeLeaderboardPage - 1)}
        style={{
          width: 34,
          height: 34,
          borderRadius: 17,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: activeLeaderboardPage === 0 ? "#EEF2F0" : "#E3F1EA",
          opacity: activeLeaderboardPage === 0 ? 0.45 : 1,
        }}
      >
        <Icon name="chevronLeft" size={18} colorValue="#075B36" />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Next 50 athletes"
        accessibilityState={{ disabled: activeLeaderboardPage >= leaderboardPageCount - 1 }}
        disabled={activeLeaderboardPage >= leaderboardPageCount - 1}
        onPress={() => changeLeaderboardPage(activeLeaderboardPage + 1)}
        style={{
          width: 34,
          height: 34,
          borderRadius: 17,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: activeLeaderboardPage >= leaderboardPageCount - 1 ? "#EEF2F0" : "#E3F1EA",
          opacity: activeLeaderboardPage >= leaderboardPageCount - 1 ? 0.45 : 1,
        }}
      >
        <Icon name="chevronRight" size={18} colorValue="#075B36" />
      </Pressable>
    </View>
  ) : null;

  const header = (
    <View style={{ gap: theme.spacing.md, paddingBottom: theme.spacing.sm }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: theme.spacing.sm,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={8}
          onPress={handleBackPress}
        >
          <Icon name="chevronLeft" />
        </Pressable>
        <Text variant="display">Leaderboard</Text>
      </View>
      <View
        style={{
          borderRadius: theme.radius.large,
          backgroundColor: "#061A14",
          padding: theme.spacing.md,
          gap: theme.spacing.sm,
          borderWidth: 1,
          borderColor: "#123C2E",
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View
            style={{
              width: 38,
              height: 38,
              borderRadius: 19,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "#123C2E",
            }}
          >
            <Icon name="trophy" size={20} colorValue="#3DD68C" />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="headline" style={{ color: "#FFFFFF" }} numberOfLines={1}>
              {usesOfficialResults ? "Official finishers" : "Live standings"}
            </Text>
            <Text variant="caption" style={{ color: "#9DB7AC" }} numberOfLines={1}>
              {selectedContest === "all" ? "All categories" : selectedContest.label}
              {` · ${selectedAgeGroup === "all" ? "All ages" : selectedAgeGroup.label}`}
              {` · ${mode === "overall" ? "All genders" : mode === "male" ? "Men" : "Women"}`}
            </Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text variant="headline" style={{ color: "#3DD68C", fontWeight: "900" }}>
              {modeFilteredEntries.length}
            </Text>
            <Text variant="caption" style={{ color: "#9DB7AC" }}>
              ATHLETES
            </Text>
          </View>
        </View>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            borderTopWidth: 1,
            borderTopColor: "#234A3B",
            paddingTop: theme.spacing.sm,
          }}
        >
          <Text variant="caption" style={{ color: "#9DB7AC" }}>
            VIEW
          </Text>
          <Text variant="bodySmall" style={{ color: "#FFFFFF", fontWeight: "900" }}>
            {splitNavigationOptions.find((split) => split.key === effectiveSplitKey)?.label ?? "Overall"}
          </Text>
          <Text variant="caption" style={{ color: "#3DD68C", fontWeight: "900" }}>
            {usesOfficialResults ? "FINAL" : "LIVE · AUTO REFRESH"}
          </Text>
        </View>
      </View>
      <View style={{ gap: theme.spacing.sm }}>
        <SearchBar
          value={athleteQuery}
          onChangeText={setAthleteQuery}
          placeholder={
            usesOfficialResults
              ? "Search official results by athlete name or bib"
              : "Search athlete name or bib"
          }
        />
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: theme.spacing.sm,
          }}
        >
          <View style={{ justifyContent: "center", paddingHorizontal: 4 }}>
            <Text
              variant="caption"
              color="textMuted"
              style={{ fontWeight: "800", textTransform: "uppercase" }}
            >
              Event Category
            </Text>
          </View>
          <Button
            label={
              selectedContest === "all"
                ? "Select Contest"
                : selectedContest.label
            }
            variant="ghost"
            size="sm"
            onPress={() => setActiveFilterPicker("contest")}
          />
          <Button
            label={
              selectedAgeGroup === "all" ? "Age Group" : selectedAgeGroup.label
            }
            variant="ghost"
            size="sm"
            onPress={() => setActiveFilterPicker("ageGroup")}
          />
          <Button
            label={
              mode === "male"
                ? "Gender · Male"
                : mode === "female"
                  ? "Gender · Female"
                  : "Gender"
            }
            variant="ghost"
            size="sm"
            onPress={() => setActiveFilterPicker("gender")}
          />
          <Button
            label={isRefreshing ? "Refreshing..." : "Refresh"}
            variant="secondary"
            size="sm"
            loading={isRefreshing}
            onPress={() => void refreshLeaderboard()}
          />
        </View>
        {debouncedQuery.trim().length > 0 ? (
          <View style={{ gap: theme.spacing.sm }}>
            {search.isFetching ? (
              <View style={{ gap: theme.spacing.sm }}>
                <Skeleton height={76} radius={theme.radius.large} />
                <Text variant="bodySmall" color="textMuted">
                  Syncing live data...
                </Text>
              </View>
            ) : (search.data ?? []).length > 0 ? (
              (search.data ?? []).map((athlete) => (
                <AthleteTrackingSearchRow
                  key={athlete.id}
                  athlete={athlete}
                  watched={isWatched(athlete.id)}
                  onTrack={() => openAthlete(athlete.bib, athlete)}
                  onToggleTracking={() =>
                    addAthlete({
                      id: athlete.id,
                      bib: athlete.bib,
                      name: athlete.name,
                      eventId: id,
                      category: athlete.category,
                      club: athlete.club,
                      photoUrl: athlete.photoUrl,
                      athleteUid: athlete.athleteUid,
                      participantUuid: athlete.participantUuid,
                      providerUuid: athlete.providerUuid,
                      providerTimingUuid: athlete.providerTimingUuid,
                      providerRecordId: athlete.providerRecordId,
                      bookingId: athlete.bookingId,
                    })
                  }
                />
              ))
            ) : (
              <Text variant="bodySmall" color="textMuted">
                No athletes found for “{debouncedQuery}”.
              </Text>
            )}
          </View>
        ) : (
          <Text variant="bodySmall" color="textMuted">
            {usesOfficialResults
              ? "Search published results to view official rankings and finish times."
              : "Search an athlete name to track them or add them to Tracking."}
          </Text>
        )}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: theme.spacing.sm }}
      >
        <Chip
          label="Overall"
          selected={mode === "overall"}
          onPress={() => {
            setMode("overall");
            setLeaderboardPage(0);
          }}
        />
      </ScrollView>
      {!usesOfficialResults && splitOptions.length > 0 ? (
        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="label">Split standings</Text>
          <Text variant="bodySmall" color="textMuted">
            {effectiveSplitOption?.transitionFromKey
              ? "Ranked by fastest accepted transition duration."
              : "Ranked by cumulative elapsed time from each athlete’s official start."}
          </Text>
          {followLeadingSplit ? (
            <Text
              variant="caption"
              style={{ color: "#178A57", fontWeight: "900" }}
            >
              AUTO · FOLLOWING THE LEADING ATHLETE
            </Text>
          ) : null}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Previous split"
              disabled={activeSplitIndex === 0}
              onPress={() => {
                setFollowLeadingSplit(false);
                setLeaderboardPage(0);
                setSelectedSplitKey(
                  splitNavigationOptions[Math.max(0, activeSplitIndex - 1)].key,
                );
              }}
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "#E5ECE8",
                opacity: activeSplitIndex === 0 ? 0.35 : 1,
              }}
            >
              <Icon name="chevronLeft" size={18} colorValue="#075B36" />
            </Pressable>
            <ScrollView
              horizontal
              style={{ flex: 1 }}
              nestedScrollEnabled
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: theme.spacing.sm }}
            >
              {splitNavigationOptions.map((split) => (
                <Chip
                  key={split.key}
                  label={split.label}
                  selected={effectiveSplitKey === split.key}
                  onPress={() => {
                    setFollowLeadingSplit(false);
                    setLeaderboardPage(0);
                    setSelectedSplitKey(split.key);
                  }}
                />
              ))}
            </ScrollView>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Next split"
              disabled={activeSplitIndex >= splitNavigationOptions.length - 1}
              onPress={() => {
                setFollowLeadingSplit(false);
                setLeaderboardPage(0);
                setSelectedSplitKey(
                  splitNavigationOptions[
                    Math.min(
                      splitNavigationOptions.length - 1,
                      activeSplitIndex + 1,
                    )
                  ].key,
                );
              }}
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "#E5ECE8",
                opacity:
                  activeSplitIndex >= splitNavigationOptions.length - 1
                    ? 0.35
                    : 1,
              }}
            >
              <Icon name="chevronRight" size={18} colorValue="#075B36" />
            </Pressable>
          </View>
        </View>
      ) : null}
      {usesOfficialResults && podiumEntries.length >= 3 ? (
        <View style={{ gap: theme.spacing.sm, paddingTop: theme.spacing.sm }}>
          <Text variant="headline" style={{ textAlign: "center" }}>
            Podium
          </Text>
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-end",
              justifyContent: "center",
              gap: theme.spacing.sm,
            }}
          >
            {[
              { item: podiumEntries[1], place: 2 },
              { item: podiumEntries[0], place: 1 },
              { item: podiumEntries[2], place: 3 },
            ].map(({ item, place }) => {
              if (!item) return null;
              const isWinner = place === 1;
              const isSecond = place === 2;
              const accent = isWinner
                ? "#F4D24E"
                : isSecond
                  ? "#CBD5E1"
                  : "#F6B36D";
              const height = isWinner ? 232 : 212;
              const initials = item.name
                .split(/\s+/)
                .filter(Boolean)
                .map((part) => part[0])
                .join("")
                .slice(0, 2)
                .toUpperCase();
              return (
                <View
                  key={`podium-${item.id}-${place}`}
                  style={{
                    flex: 1,
                    maxWidth: 220,
                    marginTop: isWinner ? 0 : theme.spacing.lg,
                  }}
                >
                  <View
                    style={{
                      height,
                      borderRadius: theme.radius.xl,
                      borderWidth: 2,
                      borderColor: accent,
                      backgroundColor: isWinner
                        ? "#FFFBE8"
                        : theme.colors.surface,
                      paddingHorizontal: theme.spacing.md,
                        paddingTop: theme.spacing.lg,
                      paddingBottom: theme.spacing.md,
                      alignItems: "center",
                      justifyContent: "space-between",
                      shadowColor: "#000",
                      shadowOpacity: 0.12,
                      shadowRadius: 18,
                      shadowOffset: { width: 0, height: 8 },
                    }}
                  >
                    <View
                      style={{
                        position: "absolute",
                        top: -24,
                        width: 48,
                        height: 48,
                        borderRadius: 24,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: `${accent}25`,
                        borderWidth: 3,
                        borderColor: accent,
                      }}
                    >
                      <Text
                        variant="body"
                        style={{
                          color: theme.colors.textPrimary,
                          fontWeight: "900",
                        }}
                      >
                        {initials}
                      </Text>
                    </View>
                    <View
                      style={{ alignItems: "center", gap: 6, width: "100%" }}
                    >
                      <View
                        style={{
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 4,
                          flexWrap: "wrap",
                        }}
                      >
                        <Text
                          variant="headline"
                          style={{ textAlign: "center", paddingTop: 4 }}
                          numberOfLines={2}
                        >
                          {item.name}
                        </Text>
                        {item.countryFlag ? (
                          <Text variant="body">{item.countryFlag}</Text>
                        ) : null}
                      </View>
                      <Text variant="caption" color="textMuted">
                        BIB NO
                      </Text>
                      <Text
                        variant="headline"
                        style={{ color: theme.colors.accent }}
                      >
                        {item.row ? resultBib(item.row) : item.id}
                      </Text>
                      <Text variant="caption" color="textMuted">
                        FINISHED TIME
                      </Text>
                      <Text
                        variant="monoMetric"
                        style={{ color: theme.colors.textPrimary }}
                      >
                        {item.time}
                      </Text>
                    </View>
                    <View style={{ alignItems: "center", gap: 2 }}>
                      <Text variant="caption" color="textMuted">
                        RANK
                      </Text>
                      <Text
                        variant="display"
                        style={{
                          color: accent,
                          lineHeight: 34,
                        }}
                      >
                        {item.rank}
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}
      {renderPaginationControls()}
      {modeFilteredEntries.length > 0 ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            minHeight: compactLeaderboard ? 36 : 44,
            paddingHorizontal: compactLeaderboard ? 8 : 12,
            borderTopLeftRadius: theme.radius.medium,
            borderTopRightRadius: theme.radius.medium,
            backgroundColor: "#061A14",
            borderBottomWidth: 3,
            borderBottomColor: "#20A66A",
          }}
        >
          <Text
            variant="caption"
            numberOfLines={1}
            adjustsFontSizeToFit
            style={{ width: compactLeaderboard ? 28 : 38, color: "#FFFFFF", fontWeight: "900", textAlign: "center", ...(compactLeaderboard ? { fontSize: 8, lineHeight: 10 } : null) }}
          >
            PLACE
          </Text>
          <Text
            variant="caption"
            style={{ flex: 1, color: "#FFFFFF", fontWeight: "900", paddingLeft: compactLeaderboard ? 43 : 53, ...(compactLeaderboard ? { fontSize: 8, lineHeight: 10 } : null) }}
          >
            NAME / BIB
          </Text>
          <Text
            variant="caption"
            style={{
              width: compactLeaderboard ? 62 : 86,
              color: "#FFFFFF",
              fontWeight: "900",
              textAlign: "right",
              ...(compactLeaderboard ? { fontSize: 8, lineHeight: 10 } : null),
            }}
          >
            TIME
          </Text>
          <Text
            variant="caption"
            style={{
              width: compactLeaderboard ? 38 : 52,
              color: "#FFFFFF",
              fontWeight: "900",
              textAlign: "right",
              ...(compactLeaderboard ? { fontSize: 8, lineHeight: 10 } : null),
            }}
          >
            MOVE
          </Text>
          <Text
            variant="caption"
            style={{
              width: compactLeaderboard ? 42 : 66,
              color: "#FFFFFF",
              fontWeight: "900",
              textAlign: "right",
              ...(compactLeaderboard ? { fontSize: 8, lineHeight: 10 } : null),
            }}
          >
            PACE
          </Text>
        </View>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      edges={["top", "left", "right"]}
    >
      {(
        usesOfficialResults
          ? finishedResultsQuery.isLoading
          : isLive && query.isLoading
      ) ? (
        <View style={{ padding: theme.spacing.base, gap: theme.spacing.sm }}>
          {header}
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} height={56} radius={theme.radius.medium} />
          ))}
        </View>
      ) : (
          usesOfficialResults
            ? finishedResultsQuery.isError
            : isLive && query.isError
        ) ? (
        <View style={{ padding: theme.spacing.base }}>
          {header}
          <ErrorState
            description="Couldn't load the leaderboard."
            onRetry={() => void refreshLeaderboard()}
          />
        </View>
      ) : (
        <FlatList
          ref={leaderboardListRef}
          data={paginatedEntries}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          ListHeaderComponent={header}
          ListFooterComponent={renderPaginationControls()}
          ListEmptyComponent={
            <EmptyState
              title={
                effectiveSplitKey !== "overall" && !usesOfficialResults
                  ? "No athletes have completed this split yet"
                  : usesOfficialResults
                    ? "Official results not published yet"
                    : isLive
                      ? "No leaderboard entries yet"
                      : "No race timing data available"
              }
              description={
                effectiveSplitKey !== "overall" && !usesOfficialResults
                  ? "Standings will appear as athletes record a valid cumulative elapsed time at this split."
                  : usesOfficialResults
                    ? "Official rankings will appear here once results are published."
                    : isLive
                      ? "Live standings will appear shortly."
                      : "Leaderboard entries will appear when race timing data becomes available."
              }
            />
          }
          contentContainerStyle={{
            padding: theme.spacing.base,
            gap: 4,
            flexGrow: 1,
          }}
          showsVerticalScrollIndicator={false}
          initialNumToRender={20}
          windowSize={11}
          removeClippedSubviews
          refreshControl={
            <RefreshControl
              refreshing={
                (usesOfficialResults
                  ? finishedResultsQuery.isFetching
                  : query.isFetching) &&
                !(usesOfficialResults
                  ? finishedResultsQuery.isLoading
                  : query.isLoading)
              }
              onRefresh={() => void refreshLeaderboard()}
              tintColor={theme.colors.accent}
            />
          }
        />
      )}

      <Modal
        visible={activeFilterPicker !== null}
        onClose={() => setActiveFilterPicker(null)}
        title="Filters"
      >
        <View style={{ gap: theme.spacing.sm }}>
          <Button
            label="Clear all"
            variant="ghost"
            fullWidth
            size="sm"
            onPress={() => {
              setContestKey(contestOptions[0]?.key ?? "all");
              setAgeGroupKey("all");
              setMode("overall");
              setSelectedSplitKey("overall");
              setLeaderboardPage(0);
              setFollowLeadingSplit(true);
              setActiveFilterPicker(null);
            }}
          />
          {(activeFilterPicker === "contest"
            ? contestOptions
            : activeFilterPicker === "ageGroup"
              ? [{ key: "all", label: "All Age Groups" }, ...ageGroupOptions]
              : [
                  { key: "overall", label: "All Genders" },
                  { key: "male", label: "Male" },
                  { key: "female", label: "Female" },
                ]
          ).map((option) => {
            const isSelected =
              (activeFilterPicker === "contest" &&
                selectedContest !== "all" &&
                option.key === selectedContest.key) ||
              (activeFilterPicker === "ageGroup" &&
                ((option.key === "all" && ageGroupKey === "all") ||
                  option.key === ageGroupKey)) ||
              (activeFilterPicker === "gender" && option.key === mode);
            return (
              <Button
                key={option.key}
                label={option.label}
                variant={isSelected ? "secondary" : "ghost"}
                fullWidth
                size="sm"
                onPress={() => {
                  setLeaderboardPage(0);
                  if (activeFilterPicker === "contest") {
                    setContestKey(option.key);
                    setAgeGroupKey("all");
                    setSelectedSplitKey("overall");
                    setFollowLeadingSplit(true);
                  }
                  if (activeFilterPicker === "ageGroup")
                    setAgeGroupKey(option.key);
                  if (activeFilterPicker === "gender")
                    setMode(option.key as Mode);
                  setActiveFilterPicker(null);
                }}
              />
            );
          })}
        </View>
      </Modal>
    </SafeAreaView>
  );
}
