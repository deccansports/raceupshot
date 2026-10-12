import { useQueries, useQuery } from "@tanstack/react-query";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Alert,
  AppState,
  PanResponder,
  Platform,
  Pressable,
  Share,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { Image } from "expo-image";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { repositories, type AthleteSearchMode } from "@/core/repositories";
import { queryKeys } from "@/core/services/query/queryKeys";
import {
  enableTrackedAthleteNotifications,
  trackedAthleteNotificationsEnabled,
} from "@/core/services/notifications";
import { useTheme } from "@/core/theme";
import { formatCutoffSummary, getInitials } from "@/core/utils";
import {
  Badge,
  BottomSheet,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Avatar,
  Icon,
  SearchBar,
  Skeleton,
  Text,
} from "@/shared/components";
import { useDebouncedValue } from "@/shared/hooks";
import { useWatchlist } from "@/features/tracking/watchlist/hooks/useWatchlist";
import {
  useAthleteSearch,
  useCourseGeometry,
  useCourseMap,
  useEventResults,
  useParticipants,
} from "@/features/tracking/hooks";
import {
  mapAthleteDetail,
  scheduledStartFromTicket,
  type AthleteDetailViewModel,
  type AthleteHeaderView,
  type TimelineSplit,
} from "@/features/tracking/mappers";
import {
  courseStageLabels,
  resolveCourseKind,
} from "@/features/tracking/courseKind";
import { resolveAthletePhoto } from "@/features/tracking/athletePhoto";
import { mapCourseMap } from "@/features/tracking/course-map/mappers";
import {
  CourseMapView,
  type MapLayerPreferences,
} from "@/features/tracking/course-map/components/CourseMapView";
import {
  ElevationProfilePanel,
  type ElevationAthleteMarker,
} from "@/features/tracking/course-map/components/ElevationProfilePanel";
import type { TrackAthlete } from "@/features/tracking/course-map/components/CourseTrackCanvas";
import {
  buildCumulativePath,
  estimatedDistanceKm,
  distanceToFraction,
  positionAtFraction,
  useRaceClock,
} from "@/features/tracking/engine";
import {
  hasCanonicalFinishEvidence,
  preferFreshestAthleteResponse,
} from "@/features/tracking/timing/freshness";
import {
  CourseOverviewCard,
  CutoffCard,
  OfficialResultsCard,
  PredictionCard,
  RankingCard,
  RaceStartCountdown,
  TimelineCard,
} from "@/features/tracking/athlete-detail/components/cards";

import { useEvent } from "../hooks/useEvents";
import {
  useEventScreenFocusRefresh,
  useEventScreenInitialization,
} from "../hooks/useEventScreenInitialization";

type SheetMode = "collapsed" | "medium" | "full";

const BERGMAN_MARK = require("../../../../assets/images/favicon.png");

type SearchHit = {
  id: string;
  participantUuid?: string;
  bib: string;
  name: string;
  email?: string;
  category?: string;
  ageGroup?: string;
  club?: string;
  photoUrl?: string;
  contestUuid?: string;
  contestId?: string;
  providerContestUuid?: string;
  providerContestId?: string;
  ticketId?: string;
  providerUuid?: string;
  providerAthleteUuid?: string;
  providerTimingUuid?: string;
  providerRecordId?: string;
  athleteUid?: string;
  bookingId?: string;
  raceDate?: string;
  trackingVisibility?: string;
  liveTrackingPrivacy?: string;
  privacy?: string;
  liveTrackingVisibility?: string;
  searchVisible?: boolean;
  mapVisible?: boolean;
  modalVisible?: boolean;
  anonymous?: boolean;
  viewerCanSeeIdentity?: boolean;
  privacyMasked?: boolean;
};

type TrackedCard = {
  athlete: SearchHit;
  detail?: ReturnType<typeof mapAthleteDetail>;
  cutoffs?: SegmentCutoffs;
  raceCategory?: string;
  timingUnavailable?: boolean;
  initialLoading?: boolean;
  refreshing?: boolean;
};

type SegmentCutoffs = {
  mode?: string;
  swim?: string;
  bike?: string;
  run?: string;
};

function elapsedLabelSeconds(value: unknown): number | null {
  const textValue = String(value ?? "").trim();
  if (!textValue || textValue === "—" || textValue === "-") return null;
  const parts = textValue.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return Number.isFinite(parts[0]) ? parts[0] : null;
}

function compareTrackedCardsByOfficialRaceState(
  a: TrackedCard,
  b: TrackedCard,
) {
  const metrics = (row: TrackedCard) => {
    const status = String(row.detail?.header.status || "").toLowerCase();
    const finished = status === "finished";
    const completed = (row.detail?.timeline || []).filter(
      (split) => split.state === "completed",
    );
    const last = completed.at(-1);
    return {
      finished,
      completedCount: completed.length,
      elapsed: elapsedLabelSeconds(last?.elapsedTimeLabel || last?.timeLabel),
      officialProgress: Number(row.detail?.raceProgress?.progress || 0),
    };
  };
  const am = metrics(a);
  const bm = metrics(b);
  if (am.finished !== bm.finished) return am.finished ? -1 : 1;
  if (am.completedCount !== bm.completedCount)
    return bm.completedCount - am.completedCount;
  if (am.elapsed !== bm.elapsed)
    return (
      (am.elapsed ?? Number.MAX_SAFE_INTEGER) -
      (bm.elapsed ?? Number.MAX_SAFE_INTEGER)
    );
  if (am.officialProgress !== bm.officialProgress)
    return bm.officialProgress - am.officialProgress;
  return String(a.athlete.bib || a.athlete.name).localeCompare(
    String(b.athlete.bib || b.athlete.name),
    undefined,
    { numeric: true },
  );
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function resolveAthleteTicket(
  eventValue: unknown,
  athlete: SearchHit,
  contestName?: string,
  contestValue?: unknown,
): Record<string, unknown> | undefined {
  const event = record(eventValue);
  const raw = record(event.raw);
  const entries = [
    event.ticketDefinitions,
    event.contests,
    raw.ticketDefinitions,
    raw.contests,
  ]
    .flatMap((value) => (Array.isArray(value) ? value : []))
    .map(record);
  const canonicalContest = record(contestValue);
  const requested = [
    athlete.ticketId,
    athlete.contestId,
    athlete.contestUuid,
    athlete.providerContestUuid,
    athlete.providerContestId,
    athlete.category,
    contestName,
    canonicalContest.bergmanTicketId,
    canonicalContest.ticketId,
    canonicalContest.id,
    canonicalContest.contestId,
    canonicalContest.contestUuid,
    canonicalContest.providerContestUuid,
    canonicalContest.displayName,
    canonicalContest.name,
    canonicalContest.contestName,
  ]
    .map(normalizeContestKey)
    .filter((value) => value !== "unknown-contest");
  return entries.find((entry) =>
    [
      entry.id,
      entry.ticketId,
      entry.contestId,
      entry.contestUuid,
      entry.providerContestUuid,
      entry.ticketName,
      entry.name,
      entry.contestName,
      entry.label,
    ]
      .map(normalizeContestKey)
      .some(
        (candidate) =>
          candidate !== "unknown-contest" && requested.includes(candidate),
      ),
  );
}

function resolveAthleteCutoffs(
  eventValue: unknown,
  athlete: SearchHit,
): SegmentCutoffs | undefined {
  const match = resolveAthleteTicket(eventValue, athlete);
  const configured = record(match?.cutoffs);
  if (Object.keys(configured).length === 0) return undefined;
  return {
    mode: firstText(configured.mode) || undefined,
    swim: firstText(configured.swim) || undefined,
    bike: firstText(configured.bike) || undefined,
    run: firstText(configured.run) || undefined,
  };
}

function athleteDetailIdentity(athlete: SearchHit) {
  return {
    bib: athlete.bib,
    athleteUid: athlete.athleteUid,
    bookingId: athlete.bookingId,
    providerUuid: athlete.providerUuid,
    email: athlete.email,
    participantUuid: athlete.participantUuid,
    providerAthleteUuid: athlete.providerAthleteUuid,
    providerTimingUuid: athlete.providerTimingUuid,
    providerRecordId: athlete.providerRecordId,
    providerContestUuid: athlete.providerContestUuid,
  };
}

function trackedAthleteFallbackDetail(athlete: SearchHit, eventId: string) {
  return mapAthleteDetail({
    success: true,
    eventId,
    visibility: "PUBLIC",
    liveTrackingVisibility: "PUBLIC",
    athlete: {
      id: athlete.athleteUid || athlete.providerUuid || athlete.id,
      bib: athlete.bib,
      name: athlete.name,
      fullName: athlete.name,
      displayName: athlete.name,
      category: athlete.category,
      ageGroupName: athlete.ageGroup,
      contest: athlete.category,
      contestName: athlete.category,
      club: athlete.club,
      clubName: athlete.club,
      displayClub: athlete.club,
      photoURL: athlete.photoUrl ?? null,
      displayPhoto: athlete.photoUrl ?? null,
      profilePhotoUrl: athlete.photoUrl,
      visibility: "PUBLIC",
      liveTrackingVisibility: "PUBLIC",
      status: "NOT_STARTED",
      lifecycleLabel: "Awaiting live timing",
      eventDate: athlete.raceDate,
    },
  });
}

function isCanonicalBuildUnavailable(error: unknown): boolean {
  const details = record(error);
  const status = Number(details.status);
  const message = firstText(details.message, details.userMessage, details.code);
  return (
    status === 404 &&
    /canonical_build_missing|no canonical live-tracking build is published/i.test(
      message,
    )
  );
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeSearchText(value: unknown): string {
  return text(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeBib(value: unknown): string {
  const normalized = text(value);
  return /^\d+$/.test(normalized)
    ? normalized.replace(/^0+(?=\d)/, "")
    : normalized.toLowerCase();
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const candidate = text(value);
    if (candidate) return candidate;
  }
  return "";
}

function isPublicTrackableAthlete(value: Record<string, unknown>): boolean {
  const registration =
    value.registration && typeof value.registration === "object"
      ? (value.registration as Record<string, unknown>)
      : undefined;
  const visibility = firstText(
    value.trackingVisibility,
    value.liveTrackingPrivacy,
    value.privacy,
    value.liveTrackingVisibility,
    value.visibility,
    registration?.trackingVisibility,
    registration?.liveTrackingPrivacy,
  ).toUpperCase();
  if (value.viewerCanSeeIdentity === true || value.privacyMasked === false) {
    return (
      value.searchVisible !== false &&
      value.mapVisible !== false &&
      value.modalVisible !== false
    );
  }
  if (
    visibility === "ANONYMOUS" ||
    visibility === "ANON" ||
    visibility === "PRIVATE" ||
    visibility === "OFFICIALS_ONLY" ||
    value.anonymous === true
  ) {
    return false;
  }
  return (
    value.searchVisible !== false &&
    value.mapVisible !== false &&
    value.modalVisible !== false
  );
}

function normalizeContestKey(value: unknown): string {
  return (
    firstText(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "unknown-contest"
  );
}

function stableAthleteKey(
  athlete: Partial<SearchHit>,
  fallbackEventId?: string,
): string {
  const event = normalizeContestKey(firstText(fallbackEventId));
  const raceDate = normalizeContestKey(athlete.raceDate);
  const contest = normalizeContestKey(
    firstText(
      athlete.ticketId,
      athlete.contestId,
      athlete.contestUuid,
      athlete.providerContestUuid,
      athlete.providerContestId,
      athlete.category,
    ),
  );
  const participant = normalizeContestKey(
    firstText(
      athlete.participantUuid,
      athlete.providerAthleteUuid,
      athlete.providerUuid,
      athlete.providerTimingUuid,
      athlete.providerRecordId,
      athlete.athleteUid,
    ),
  );
  const bib = normalizeBib(athlete.bib);
  if (event !== "unknown-contest" && bib) {
    return [
      event,
      raceDate !== "unknown-contest" ? raceDate : "",
      contest !== "unknown-contest" ? contest : "",
      `bib-${bib}`,
    ]
      .filter(Boolean)
      .join(":");
  }
  if (
    event !== "unknown-contest" &&
    contest !== "unknown-contest" &&
    participant !== "unknown-contest"
  ) {
    return [
      event,
      raceDate !== "unknown-contest" ? raceDate : "",
      contest,
      participant,
    ]
      .filter(Boolean)
      .join(":");
  }
  const booking = normalizeContestKey(athlete.bookingId);
  if (event !== "unknown-contest" && booking !== "unknown-contest") {
    return [
      event,
      raceDate !== "unknown-contest" ? raceDate : "",
      "booking",
      booking,
    ]
      .filter(Boolean)
      .join(":");
  }
  return normalizeContestKey(athlete.id);
}

function sameAthleteIdentity(
  left: Partial<SearchHit>,
  right: Partial<SearchHit>,
): boolean {
  const leftBib = normalizeBib(left.bib);
  const rightBib = normalizeBib(right.bib);
  if (leftBib && rightBib && leftBib === rightBib) return true;

  const identityValues = (athlete: Partial<SearchHit>) =>
    [
      athlete.bookingId,
      athlete.athleteUid,
      athlete.participantUuid,
      athlete.providerAthleteUuid,
      athlete.providerUuid,
      athlete.providerTimingUuid,
      athlete.providerRecordId,
    ]
      .map(normalizeContestKey)
      .filter((value) => value !== "unknown-contest");
  const rightValues = new Set(identityValues(right));
  return identityValues(left).some((value) => rightValues.has(value));
}

function displayHeader(detail: AthleteDetailViewModel): AthleteHeaderView {
  if (!detail.isAnonymous) return detail.header;
  return {
    ...detail.header,
    name: "Anonymous Athlete",
    photo: undefined,
    category: undefined,
    gender: undefined,
    club: undefined,
    countryFlag: undefined,
    location: undefined,
    registrationStatus: undefined,
    colorSeed: detail.header.bib || detail.id,
  };
}

function mergeSearchResults(...groups: SearchHit[][]): SearchHit[] {
  const merged: SearchHit[] = [];
  const identityIndex = new Map<string, number>();
  const identityKeys = (athlete: SearchHit) => {
    const keys = [
      athlete.bib ? `bib:${normalizeSearchText(athlete.bib)}` : "",
      athlete.participantUuid
        ? `participant:${normalizeContestKey(athlete.participantUuid)}`
        : "",
      athlete.providerAthleteUuid
        ? `provider-athlete:${normalizeContestKey(athlete.providerAthleteUuid)}`
        : "",
      athlete.providerUuid
        ? `provider:${normalizeContestKey(athlete.providerUuid)}`
        : "",
      athlete.providerTimingUuid
        ? `timing:${normalizeContestKey(athlete.providerTimingUuid)}`
        : "",
      athlete.providerRecordId
        ? `record:${normalizeContestKey(athlete.providerRecordId)}`
        : "",
      athlete.bookingId
        ? `booking:${normalizeContestKey(athlete.bookingId)}`
        : "",
      athlete.athleteUid
        ? `athlete:${normalizeContestKey(athlete.athleteUid)}`
        : "",
    ];
    return [...new Set(keys.filter(Boolean))];
  };
  for (const group of groups) {
    for (const athlete of group) {
      const keys = identityKeys(athlete);
      const existingIndex = keys
        .map((key) => identityIndex.get(key))
        .find((index): index is number => index !== undefined);
      if (existingIndex !== undefined) {
        const existing = merged[existingIndex];
        merged[existingIndex] = {
          ...athlete,
          ...existing,
          club: existing.club || athlete.club,
          photoUrl: existing.photoUrl || athlete.photoUrl,
          category: existing.category || athlete.category,
        };
        identityKeys(merged[existingIndex]).forEach((key) =>
          identityIndex.set(key, existingIndex),
        );
        continue;
      }
      const index = merged.length;
      merged.push(athlete);
      keys.forEach((key) => identityIndex.set(key, index));
    }
  }
  return merged;
}

function sheetHeightFor(mode: SheetMode): number {
  if (mode === "collapsed") return 230;
  if (mode === "medium") return 390;
  if (mode === "full") return 620;
  return 0;
}

function searchHitFromRaw(item: any): SearchHit {
  const provider =
    item?.provider && typeof item.provider === "object" ? item.provider : {};
  const bib = firstText(item.bib, item.bibNumber, item.number, item.id);
  const participantUuid = firstText(item.participantUuid);
  const providerUuid = firstText(item.providerUuid, provider.providerUuid);
  const providerAthleteUuid = firstText(item.providerAthleteUuid);
  const providerTimingUuid = firstText(item.providerTimingUuid);
  const providerRecordId = firstText(item.providerRecordId);
  const bookingId = firstText(item.bookingId);
  const athleteUid = firstText(item.athleteUid);
  const email = firstText(item.email);
  const category = firstText(
    item.category,
    item.contest,
    item.contestName,
    item.providerContestName,
    item.ageGroupName,
  );
  const id = firstText(
    participantUuid,
    providerUuid,
    providerAthleteUuid,
    providerTimingUuid,
    providerRecordId,
    bookingId,
    athleteUid,
    bib && category ? `bib:${bib}:contest:${category}` : undefined,
    bib,
  );
  return {
    id,
    participantUuid,
    bib,
    name: firstText(item.name, item.displayName, item.fullName) || `Bib ${bib}`,
    email,
    category,
    ageGroup: firstText(item.ageGroup, item.ageGroupName, item.categoryName),
    club: firstText(item.club, item.clubName),
    photoUrl: firstText(
      item.photoUrl,
      item.profilePhotoUrl,
      item.photoURL,
      item.displayPhoto,
    ),
    contestUuid: firstText(item.contestUuid),
    contestId: firstText(item.contestId),
    providerContestUuid: firstText(item.providerContestUuid),
    providerContestId: firstText(item.providerContestId),
    ticketId: firstText(item.ticketId),
    providerUuid,
    providerAthleteUuid,
    providerTimingUuid,
    providerRecordId,
    athleteUid,
    bookingId,
    raceDate: firstText(item.raceDate, item.eventDate, item.date),
    trackingVisibility: firstText(item.trackingVisibility),
    liveTrackingPrivacy: firstText(item.liveTrackingPrivacy),
    privacy: firstText(item.privacy),
    liveTrackingVisibility: firstText(item.liveTrackingVisibility),
    searchVisible: item.searchVisible !== false,
    mapVisible: item.mapVisible !== false,
    modalVisible: item.modalVisible !== false,
    viewerCanSeeIdentity: item.viewerCanSeeIdentity === true,
    privacyMasked: item.privacyMasked === true,
    anonymous:
      item.viewerCanSeeIdentity === true ? false : item.anonymous === true,
  };
}

const SearchResultCard = memo(function SearchResultCard({
  athlete,
  onPress,
  isTracked,
  photoUrl,
  resultsMode = false,
}: {
  athlete: SearchHit;
  onPress: () => void;
  isTracked: boolean;
  photoUrl?: string;
  resultsMode?: boolean;
}) {
  const theme = useTheme();
  return (
    <Card
      style={{
        gap: theme.spacing.sm,
        borderRadius: theme.radius.xl,
        borderWidth: 1,
        borderColor: isTracked
          ? "rgba(46,116,214,0.38)"
          : "rgba(46,116,214,0.14)",
        backgroundColor: "#FFFFFF",
        shadowColor: "#2E74D6",
        shadowOpacity: isTracked ? 0.12 : 0.06,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 6 },
        elevation: 2,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View
          style={{
            width: 54,
            height: 54,
            borderRadius: 18,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: `${theme.colors.accentSecondary}14`,
            borderWidth: 1,
            borderColor: isTracked
              ? theme.colors.accentSecondary
              : "rgba(46,116,214,0.16)",
            overflow: "hidden",
          }}
        >
          {photoUrl ? (
            <Avatar name={athlete.name} uri={photoUrl} size={54} />
          ) : (
            <Text
              variant="headline"
              style={{ color: theme.colors.accentSecondary }}
            >
              {getInitials(athlete.name)}
            </Text>
          )}
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <Text
              variant="headline"
              numberOfLines={1}
              style={{ flexShrink: 1 }}
            >
              {athlete.name}
            </Text>
            {isTracked ? (
              <View
                style={{
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                  borderRadius: 999,
                  backgroundColor: "rgba(46,116,214,0.10)",
                  borderWidth: 1,
                  borderColor: "rgba(46,116,214,0.22)",
                }}
              >
                <Text
                  variant="caption"
                  style={{
                    color: theme.colors.accentSecondary,
                    fontWeight: "900",
                  }}
                >
                  ADDED
                </Text>
              </View>
            ) : null}
          </View>
          <Text variant="bodySmall" color="textMuted" numberOfLines={2}>
            Bib {athlete.bib}
            {athlete.club ? ` · ${athlete.club}` : ""}
            {athlete.category ? ` · ${athlete.category}` : ""}
          </Text>
        </View>
      </View>
      <Button
        label={
          resultsMode
            ? isTracked
              ? "Open Result"
              : "View Result"
            : isTracked
              ? "Show Athlete"
              : "Add to Tracking"
        }
        variant={isTracked ? "secondary" : "primary"}
        size="sm"
        fullWidth
        onPress={onPress}
      />
    </Card>
  );
});

function FloatingLauncher({
  count,
  onPress,
  top = 84,
}: {
  count: number;
  onPress: () => void;
  top?: number;
}) {
  const theme = useTheme();
  const pulse = useSharedValue(0);
  const hasTrackedAthletes = count > 0;

  useEffect(() => {
    if (!hasTrackedAthletes) {
      pulse.value = 0;
      return undefined;
    }
    pulse.value = withRepeat(
      withTiming(1, {
        duration: 1500,
        easing: Easing.inOut(Easing.cubic),
      }),
      -1,
      true,
    );
    return undefined;
  }, [hasTrackedAthletes, pulse]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + pulse.value * 0.035 }],
    opacity: hasTrackedAthletes ? 0.7 + pulse.value * 0.3 : 1,
  }));

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        {
          position: "absolute",
          left: theme.spacing.base,
          top,
          zIndex: 32,
          elevation: 32,
          ...(Platform.OS === "web"
            ? ({ boxShadow: "0 12px 24px rgba(15,23,42,0.26)" } as any)
            : {
                shadowColor: "#000",
                shadowOpacity: 0.26,
                shadowRadius: 18,
                shadowOffset: { width: 0, height: 8 },
                elevation: 10,
              }),
        },
      ]}
    >
      {hasTrackedAthletes ? (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              left: -4,
              top: -4,
              right: -4,
              bottom: -4,
              borderRadius: 22,
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.55)",
              backgroundColor: "rgba(46,116,214,0.18)",
            },
            pulseStyle,
          ]}
        />
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open tracked athletes panel"
        onPress={onPress}
        style={({ pressed }) => [
          {
            height: 52,
            minWidth: 62,
            borderRadius: 18,
            paddingHorizontal: 14,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            backgroundColor: "#2E74D6",
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.28)",
          },
          pressed ? { transform: [{ scale: 0.97 }] } : null,
        ]}
      >
        <Icon name="user" size={20} colorValue="#FFFFFF" />
        <Text variant="label" style={{ color: "#FFFFFF", fontWeight: "900" }}>
          Track
        </Text>
        {hasTrackedAthletes ? (
          <View
            style={{
              position: "absolute",
              top: -8,
              right: -8,
              minWidth: 24,
              height: 24,
              borderRadius: 12,
              paddingHorizontal: 6,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "#00D4FF",
              borderWidth: 2,
              borderColor: "#FFFFFF",
            }}
          >
            <Text
              variant="caption"
              style={{ color: "#00111F", fontWeight: "900" }}
            >
              {count}
            </Text>
          </View>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

function CompactTrackedCarousel({
  rows,
  selectedIndex,
  onSelect,
  onOpen,
  onRemove,
  onSearch,
}: {
  rows: TrackedCard[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onOpen: (index: number) => void;
  onRemove: (index: number) => void;
  onSearch: () => void;
}) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const carouselRef = useRef<ScrollView>(null);
  const initialPage = Math.max(0, Math.min(selectedIndex, rows.length - 1));
  const [page, setPage] = useState(initialPage);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const cardWidth = Math.max(240, width - 48);
  const cardStep = cardWidth + theme.spacing.sm;

  useEffect(() => {
    const bounded = Math.max(0, Math.min(selectedIndex, rows.length - 1));
    const timer = setTimeout(() => {
      setPage(bounded);
      carouselRef.current?.scrollTo({
        x: bounded * cardStep,
        animated: true,
      });
    }, 0);
    return () => clearTimeout(timer);
  }, [cardStep, rows.length, selectedIndex]);

  useEffect(() => {
    const hasRunningAthlete = rows.some(
      ({ detail }) => !detail?.result && detail?.header.status === "live",
    );
    if (!hasRunningAthlete) return undefined;
    const timer = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [rows]);

  const goToPage = (nextPage: number) => {
    const bounded = Math.max(0, Math.min(nextPage, rows.length - 1));
    setPage(bounded);
    onSelect(bounded);
    carouselRef.current?.scrollTo({ x: bounded * cardStep, animated: true });
  };

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: theme.spacing.base,
        zIndex: 40,
        elevation: 40,
      }}
    >
      <View
        style={{
          marginHorizontal: theme.spacing.sm,
          borderRadius: theme.radius.xl,
          backgroundColor: "rgba(24,24,24,0.96)",
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.14)",
          paddingVertical: theme.spacing.sm,
          shadowColor: "#000",
          shadowOpacity: 0.3,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 8 },
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: theme.spacing.md,
            marginBottom: theme.spacing.xs,
          }}
        >
          <Text
            variant="caption"
            style={{ color: "#FFFFFF", fontWeight: "900" }}
          >
            {rows.length} TRACKED
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Previous tracked athlete"
              disabled={page === 0}
              onPress={() => goToPage(page - 1)}
              style={{
                width: 30,
                height: 30,
                borderRadius: 15,
                alignItems: "center",
                justifyContent: "center",
                opacity: page === 0 ? 0.35 : 1,
                backgroundColor: "rgba(255,255,255,0.10)",
              }}
            >
              <Icon name="chevronLeft" size={17} colorValue="#FFFFFF" />
            </Pressable>
            <Text
              variant="caption"
              style={{ color: "#D4D4D4", minWidth: 34, textAlign: "center" }}
            >
              {rows.length > 0 ? page + 1 : 0}/{rows.length}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Next tracked athlete"
              disabled={page >= rows.length - 1}
              onPress={() => goToPage(page + 1)}
              style={{
                width: 30,
                height: 30,
                borderRadius: 15,
                alignItems: "center",
                justifyContent: "center",
                opacity: page >= rows.length - 1 ? 0.35 : 1,
                backgroundColor: "rgba(255,255,255,0.10)",
              }}
            >
              <Icon name="chevronRight" size={17} colorValue="#FFFFFF" />
            </Pressable>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Search athletes"
            onPress={onSearch}
            hitSlop={8}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingHorizontal: 10,
              height: 30,
              borderRadius: 15,
              backgroundColor: "rgba(255,255,255,0.10)",
            }}
          >
            <Icon name="search" size={15} colorValue="#FFFFFF" />
            <Text
              variant="caption"
              style={{ color: "#FFFFFF", fontWeight: "800" }}
            >
              Search
            </Text>
          </Pressable>
        </View>

        <ScrollView
          ref={carouselRef}
          contentOffset={{ x: initialPage * cardStep, y: 0 }}
          onContentSizeChange={() => {
            const bounded = Math.max(
              0,
              Math.min(selectedIndex, rows.length - 1),
            );
            carouselRef.current?.scrollTo({
              x: bounded * cardStep,
              animated: false,
            });
          }}
          horizontal
          nestedScrollEnabled
          showsHorizontalScrollIndicator={false}
          directionalLockEnabled
          decelerationRate="fast"
          snapToInterval={cardStep}
          snapToAlignment="start"
          disableIntervalMomentum
          onMomentumScrollEnd={(event) => {
            const nextPage = Math.round(
              event.nativeEvent.contentOffset.x / cardStep,
            );
            const bounded = Math.max(0, Math.min(nextPage, rows.length - 1));
            setPage(bounded);
            onSelect(bounded);
          }}
          contentContainerStyle={{
            gap: theme.spacing.sm,
            paddingHorizontal: theme.spacing.sm,
          }}
        >
          {rows.map(({ athlete, detail, cutoffs, raceCategory }, index) => {
            const header = detail ? displayHeader(detail) : null;
            const name = header?.name || athlete.name;
            const bib = header?.bib || athlete.bib;
            const contest = header?.contest || athlete.category;
            const category = header?.category;
            const status = detail?.result
              ? detail.result.statusLabel || "Finished"
              : detail?.lifecycle.label ||
                header?.statusLabel ||
                "Waiting to Start";
            return (
              <View
                key={stableAthleteKey(athlete, String(index))}
                style={{
                  width: cardWidth,
                  minHeight: 112,
                  borderRadius: theme.radius.large,
                  overflow: "hidden",
                  backgroundColor: "#242424",
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.14)",
                }}
              >
                <View
                  accessible
                  focusable
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${name}`}
                  onStartShouldSetResponder={() => true}
                  onResponderRelease={() => onOpen(index)}
                  style={{
                    flex: 1,
                    minHeight: 205,
                    padding: theme.spacing.md,
                    paddingRight: 40,
                    gap: theme.spacing.md,
                    backgroundColor: "transparent",
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: theme.spacing.sm,
                    }}
                  >
                    <Avatar
                      name={name}
                      uri={header?.photo || athlete.photoUrl}
                      colorSeed={header?.colorSeed || athlete.id}
                      size={58}
                      bordered
                    />
                    <View style={{ flex: 1, gap: 5 }}>
                      <Text
                        variant="headline"
                        style={{ color: "#FFFFFF" }}
                        numberOfLines={1}
                      >
                        {name} {header?.countryFlag || ""}
                      </Text>
                      <Text
                        variant="bodySmall"
                        style={{ color: "#E2E2E2" }}
                        numberOfLines={1}
                      >
                        {[contest, category, bib ? `Bib ${bib}` : ""]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                      <Text
                        variant="bodySmall"
                        style={{ color: "#BDBDBD", fontWeight: "700" }}
                        numberOfLines={1}
                      >
                        {status}
                      </Text>
                    </View>
                  </View>
                  {!detail?.result &&
                  /not\s*started|waiting|awaiting\s*start/i.test(status) ? (
                    <RaceStartCountdown
                      scheduledStart={detail?.header.scheduledStart}
                      startTiming={detail?.startTiming}
                    />
                  ) : null}
                  <CompactRaceProgress
                    contest={contest || ""}
                    raceCategory={raceCategory || detail?.header.raceCategory}
                    legLabel={detail?.raceProgress?.legLabel || status}
                    progress={detail?.raceProgress?.progress ?? 0}
                    finished={Boolean(
                      detail?.result &&
                      /finish|complete/i.test(detail.result.statusLabel),
                    )}
                    resultStatus={detail?.result?.statusLabel}
                    resultSplits={detail?.result?.splits}
                    timeline={detail?.timeline}
                    finishTime={detail?.result?.chipTime}
                    elapsedTime={
                      detail?.result?.chipTime ||
                      (detail?.raceStartedAt
                        ? formatElapsedClock(
                            Math.max(
                              0,
                              Math.floor(
                                (nowMs - detail.raceStartedAt) / 1_000,
                              ),
                            ),
                          )
                        : undefined) ||
                      metricValue(detail?.liveStats, "Elapsed") ||
                      metricValue(detail?.liveStats, "Athlete Race Time")
                    }
                    clockRunning={Boolean(
                      !detail?.result && detail?.header.status === "live",
                    )}
                    cutoffs={cutoffs}
                    raceStartedAt={detail?.raceStartedAt}
                    predictionTrack={detail?.track}
                    waitingToStart={Boolean(
                      detail?.startTiming?.waitingForChipStart,
                    )}
                  />
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Untrack ${name}`}
                  onPress={() => onRemove(index)}
                  hitSlop={8}
                  style={{
                    position: "absolute",
                    top: 7,
                    right: 7,
                    width: 26,
                    height: 26,
                    borderRadius: 13,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: "rgba(0,0,0,0.42)",
                  }}
                >
                  <Text
                    variant="headline"
                    style={{ color: "#FFFFFF", fontSize: 15, lineHeight: 16 }}
                  >
                    ×
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

function CourseMapHeader({
  title,
  notificationsEnabled,
  settingsOpen,
  onToggleNotifications,
  onToggleSettings,
}: {
  title: string;
  notificationsEnabled: boolean;
  settingsOpen: boolean;
  onToggleNotifications: () => void;
  onToggleSettings: () => void;
}) {
  const theme = useTheme();
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: 12,
        right: 12,
        top: 10,
        zIndex: 40,
        elevation: 40,
      }}
    >
      <View
        style={{
          height: 58,
          borderRadius: 20,
          paddingHorizontal: 10,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          borderWidth: 1,
          borderColor: "rgba(46,116,214,0.18)",
          backgroundColor: "rgba(255,255,255,0.92)",
          ...(Platform.OS === "web"
            ? ({ boxShadow: "0 12px 24px rgba(15,23,42,0.16)" } as any)
            : {
                shadowColor: "#000",
                shadowOpacity: 0.16,
                shadowRadius: 18,
                shadowOffset: { width: 0, height: 8 },
                elevation: 10,
              }),
        }}
      >
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: 19,
            overflow: "hidden",
            borderWidth: 1,
            borderColor: "rgba(46,116,214,0.16)",
            backgroundColor: "#EFF7FF",
          }}
        >
          <Image
            source={BERGMAN_MARK}
            style={{ width: 38, height: 38 }}
            contentFit="cover"
          />
        </View>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text
            variant="caption"
            color="textMuted"
            style={{ fontWeight: "900", letterSpacing: 0.7 }}
          >
            BERGMAN
          </Text>
          <Text
            variant="headline"
            numberOfLines={1}
            style={{ maxWidth: "100%" }}
          >
            {title || "Live Tracking"}
          </Text>
        </View>
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: notificationsEnabled }}
          accessibilityLabel={
            notificationsEnabled
              ? "Turn race notifications off"
              : "Turn race notifications on"
          }
          onPress={onToggleNotifications}
          style={{
            width: 38,
            height: 38,
            borderRadius: 14,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: notificationsEnabled
              ? "rgba(46,116,214,0.12)"
              : theme.colors.surfaceSunken,
            borderWidth: 1,
            borderColor: notificationsEnabled
              ? "rgba(46,116,214,0.22)"
              : theme.colors.border,
          }}
        >
          <Icon
            name="bell"
            size={18}
            color={notificationsEnabled ? "accent" : "textMuted"}
          />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open map settings"
          onPress={onToggleSettings}
          style={{
            width: 38,
            height: 38,
            borderRadius: 14,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: settingsOpen
              ? "rgba(0,212,255,0.14)"
              : theme.colors.surfaceSunken,
            borderWidth: 1,
            borderColor: settingsOpen
              ? "rgba(0,212,255,0.24)"
              : theme.colors.border,
          }}
        >
          <Icon
            name="settings"
            size={18}
            color={settingsOpen ? "accentSecondary" : "textMuted"}
          />
        </Pressable>
      </View>
    </View>
  );
}

function EventStatusBanner({ label }: { label: string }) {
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: 12,
        right: 12,
        top: 76,
        zIndex: 34,
        elevation: 34,
        alignItems: "center",
      }}
    >
      <View
        style={{
          borderRadius: 999,
          paddingHorizontal: 12,
          paddingVertical: 6,
          backgroundColor: "rgba(46,116,214,0.92)",
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.22)",
        }}
      >
        <Text
          variant="caption"
          style={{ color: "#FFFFFF", fontWeight: "900", letterSpacing: 0.6 }}
        >
          {label}
        </Text>
      </View>
    </View>
  );
}

function CompactMapAthleteCard({
  row,
  eventName,
  onOpen,
  onClose,
}: {
  row: TrackedCard;
  eventName?: string;
  onOpen: () => void;
  onClose: () => void;
}) {
  const detail = row.detail;
  const header = detail ? displayHeader(detail) : null;
  const name = header?.name || row.athlete.name;
  const bib = header?.bib || row.athlete.bib;
  const contest = header?.contest || row.athlete.category || "Race";
  const ageGroup = header?.category || row.athlete.ageGroup;
  const finished = Boolean(
    detail?.result && /finish|complete/i.test(detail.result.statusLabel),
  );
  const canonicalElapsed =
    parseElapsedClock(detail?.result?.chipTime) ??
    parseElapsedClock(metricValue(detail?.liveStats, "Elapsed")) ??
    parseElapsedClock(metricValue(detail?.liveStats, "Athlete Race Time"));
  const { elapsedSeconds } = useContinuousElapsedSeconds({
    running: Boolean(detail?.header.status === "live" && !finished),
    raceStartedAt: detail?.raceStartedAt,
    canonicalElapsedSeconds: canonicalElapsed,
  });
  const timeLabel =
    detail?.result?.chipTime ||
    (elapsedSeconds != null ? formatElapsedClock(elapsedSeconds) : "--:--:--");
  const pace =
    detail?.result?.averagePace ||
    metricValue(detail?.liveStats, "Average Pace") ||
    metricValue(detail?.liveStats, "Avg Pace") ||
    metricValue(detail?.liveStats, "Pace") ||
    detail?.prediction?.paceLabel ||
    "—";
  const photo = resolveAthletePhoto(
    {
      email: header?.email ?? row.athlete.email,
      athleteUid: header?.athleteUid ?? row.athlete.athleteUid,
      photoUrl: header?.photo ?? row.athlete.photoUrl,
    },
    null,
  );
  const identityLine = [
    contest,
    ageGroup && ageGroup !== contest ? ageGroup : null,
    bib ? `Bib ${bib}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <View
      style={{
        position: "absolute",
        left: 12,
        right: 12,
        bottom: 12,
        zIndex: 52,
        elevation: 52,
        borderRadius: 20,
        padding: 14,
        gap: 12,
        backgroundColor: "rgba(31,31,33,0.97)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.12)",
        shadowColor: "#000000",
        shadowOpacity: 0.3,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
      }}
    >
      <View
        style={{
          width: 44,
          height: 4,
          borderRadius: 999,
          backgroundColor: "rgba(255,255,255,0.86)",
          alignSelf: "center",
          marginTop: -6,
        }}
      />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open live tracking for ${name}`}
          onPress={onOpen}
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
          }}
        >
          <Avatar
            name={name}
            uri={photo ?? header?.photo ?? row.athlete.photoUrl}
            colorSeed={row.athlete.id}
            size={58}
          />
          <View style={{ flex: 1, gap: 3 }}>
            <Text
              variant="headline"
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.72}
              style={{ color: "#FFFFFF", fontSize: 21, lineHeight: 26 }}
            >
              {name}
            </Text>
            <Text
              variant="bodySmall"
              numberOfLines={1}
              style={{ color: "#D1D5DB" }}
            >
              {identityLine}
            </Text>
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Share ${name} tracking`}
          onPress={() => {
            void Share.share({
              message: `${name}${bib ? ` · Bib ${bib}` : ""}${eventName ? ` · ${eventName}` : ""}\n${finished ? "Finish time" : "Live elapsed"}: ${timeLabel}`,
            });
          }}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(255,255,255,0.10)",
          }}
        >
          <Icon name="share" size={19} colorValue="#FFFFFF" />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close athlete tracking card"
          onPress={onClose}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(0,0,0,0.45)",
          }}
        >
          <Text style={{ color: "#FFFFFF", fontSize: 24, lineHeight: 25 }}>
            ×
          </Text>
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View ${name} live timing details`}
        onPress={onOpen}
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
          <Icon name="clock" size={18} colorValue="#FFFFFF" />
          <Text variant="bodySmall" style={{ color: "#D1D5DB" }}>
            {finished ? "Finish Time" : "Live Elapsed"}
          </Text>
          <Text variant="headline" style={{ color: "#FFFFFF", fontSize: 18 }}>
            {timeLabel}
          </Text>
        </View>
        <Text
          variant="body"
          numberOfLines={1}
          style={{ color: "#D1D5DB", textAlign: "right" }}
        >
          {pace}
        </Text>
      </Pressable>
    </View>
  );
}

function MapSettingsToggle({
  label,
  value,
  onPress,
}: {
  label: string;
  value: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        paddingVertical: 6,
      }}
    >
      <Text
        variant="bodySmall"
        color="textSecondary"
        style={{ fontWeight: "800", flex: 1 }}
      >
        {label}
      </Text>
      <View
        style={{
          width: 42,
          height: 24,
          borderRadius: 999,
          padding: 2,
          backgroundColor: value
            ? theme.colors.accent
            : theme.colors.surfaceSunken,
          borderWidth: 1,
          borderColor: value ? theme.colors.accent : theme.colors.border,
        }}
      >
        <View
          style={{
            width: 18,
            height: 18,
            borderRadius: 9,
            backgroundColor: theme.colors.surface,
            alignSelf: value ? "flex-end" : "flex-start",
          }}
        />
      </View>
    </Pressable>
  );
}

function metricValue(
  items: { label: string; value: string }[] | undefined,
  label: string,
): string {
  return firstText(
    items?.find((item) => item.label.toLowerCase() === label.toLowerCase())
      ?.value,
  );
}

function eventStatusLabel(status?: string, trackedCount = 0): string {
  const normalized = String(status ?? "").toLowerCase();
  if (normalized === "finished") return "EVENT COMPLETE · RESULTS PROVISIONAL";
  if (normalized === "live")
    return trackedCount > 0
      ? "LIVE · ATHLETES ON COURSE"
      : "LIVE · TRACKING OPEN";
  if (normalized === "upcoming" || normalized === "scheduled")
    return "RACE NOT STARTED";
  if (normalized === "results") return "OFFICIAL RESULTS PUBLISHED";
  return trackedCount > 0 ? "TRACKING · WATCHLIST ACTIVE" : "LIVE TRACKING";
}

function indiaDateKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function scheduledRaceFamilyToday(schedule: unknown): string | null {
  if (!Array.isArray(schedule)) return null;
  const today = indiaDateKey();
  const disciplines = schedule.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (firstText(row.date, row.eventDate, row.raceDate) !== today) return [];
    const values = row.disciplines ?? row.events ?? row.categories;
    return Array.isArray(values) ? values.map((value) => firstText(value)) : [];
  });
  const raceDisciplines = disciplines.filter(
    (value) => !isAgeGroupLabel(value),
  );
  const hasSwimathon = raceDisciplines.some((value) =>
    value.toLowerCase().includes("swimathon"),
  );
  const hasTriathlon = raceDisciplines.some((value) =>
    /triathlon|relay/i.test(value),
  );
  if (hasSwimathon && hasTriathlon) return "SWIMATHON & TRIATHLON";
  if (hasSwimathon) return "SWIMATHON";
  if (hasTriathlon) return "TRIATHLON";
  return raceDisciplines[0]?.toUpperCase() || null;
}

function hasRaceScheduledToday(schedule: unknown): boolean {
  if (!Array.isArray(schedule)) return false;
  const today = indiaDateKey();
  return schedule.some((item) => {
    if (!item || typeof item !== "object") return false;
    const row = item as Record<string, unknown>;
    return firstText(row.date, row.eventDate, row.raceDate) === today;
  });
}

function isAgeGroupLabel(value: unknown): boolean {
  const label = firstText(value).toLowerCase();
  if (!label) return false;
  return (
    /^(?:age\s*group\s*)?(?:under\s*)?\d+\s*(?:-|to|and under|and above|\+|above)?\s*\d*$/.test(
      label,
    ) || /^(?:above|under)\s+\d+$/.test(label)
  );
}

function SelectedAthletePanel({
  row,
  eventName,
  index,
  total,
  expanded,
  onPrevious,
  onNext,
  onExpand,
  onViewMap,
  onRemove,
}: {
  row?: TrackedCard;
  eventName?: string;
  index: number;
  total: number;
  expanded: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onExpand: () => void;
  onViewMap: () => void;
  onRemove: () => void;
}) {
  const theme = useTheme();
  const swipeResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_, gestureState) => {
          const horizontalDistance = Math.abs(gestureState.dx);
          const verticalDistance = Math.abs(gestureState.dy);
          return (
            total > 1 &&
            horizontalDistance > 18 &&
            horizontalDistance > verticalDistance * 1.5
          );
        },
        onPanResponderTerminationRequest: () => true,
        onShouldBlockNativeResponder: () => false,
        onPanResponderRelease: (_, gestureState) => {
          const horizontalDistance = Math.abs(gestureState.dx);
          const verticalDistance = Math.abs(gestureState.dy);
          if (
            horizontalDistance < 45 ||
            horizontalDistance <= verticalDistance * 1.5
          )
            return;
          if (gestureState.dx < 0) onNext();
          else onPrevious();
        },
      }),
    [onNext, onPrevious, total],
  );
  if (!row) {
    return (
      <EmptyState
        title="No athletes tracked"
        description="You aren’t tracking any athletes yet. Search for an athlete to start tracking."
      />
    );
  }

  const { athlete, detail, raceCategory } = row;
  if (row.initialLoading) {
    return (
      <View style={{ gap: theme.spacing.sm }}>
        <Card
          accessibilityLabel="Loading live tracking"
          style={{
            backgroundColor: "#242424",
            borderColor: "rgba(255,255,255,0.10)",
            gap: 12,
          }}
        >
          <Text variant="headline" style={{ color: "#FFFFFF" }}>
            Loading live tracking…
          </Text>
          <Text variant="bodySmall" style={{ color: "#C4CAD3" }}>
            Assembling athlete, course, official timing, rankings, and map data.
          </Text>
          <Skeleton height={18} radius={9} />
          <Skeleton height={90} radius={14} />
          <Skeleton height={160} radius={14} />
        </Card>
      </View>
    );
  }
  if (!detail || row.timingUnavailable) {
    return (
      <View style={{ gap: theme.spacing.sm }}>
        <View
          {...swipeResponder.panHandlers}
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Button
            label="‹"
            variant="ghost"
            size="sm"
            disabled={total < 2}
            onPress={onPrevious}
          />
          <View
            style={{
              width: 104,
              height: 5,
              borderRadius: 999,
              backgroundColor: theme.colors.border,
            }}
          />
          <Button
            label="›"
            variant="ghost"
            size="sm"
            disabled={total < 2}
            onPress={onNext}
          />
        </View>
        <Card
          style={{
            backgroundColor: "#202020",
            borderColor: "rgba(255,255,255,0.08)",
            gap: theme.spacing.md,
            shadowOpacity: 0.14,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Avatar
              name={athlete.name}
              uri={athlete.photoUrl}
              size={58}
              bordered
            />
            <View style={{ flex: 1, gap: 3 }}>
              <Text variant="headline" style={{ color: "#FFFFFF" }}>
                {athlete.name || `Bib ${athlete.bib}`}
              </Text>
              <Text variant="bodySmall" style={{ color: "#D2D2D2" }}>
                {[athlete.category, `Bib ${athlete.bib}`]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            </View>
            <Button label="×" variant="ghost" size="sm" onPress={onRemove} />
          </View>
          <Text variant="label" style={{ color: "#FFFFFF" }}>
            {row.timingUnavailable
              ? "Timing configuration pending"
              : "Awaiting start"}
          </Text>
          <Text variant="caption" style={{ color: "#9FA6B2" }}>
            {row.timingUnavailable
              ? "Live race flow will appear after this event’s timing build is published."
              : "Live timing details are updating in the background."}
          </Text>
          {!row.timingUnavailable ? (
            <CompactRaceProgress
              contest={athlete.category || ""}
              raceCategory={raceCategory}
              legLabel="Not Started"
              progress={0}
            />
          ) : null}
        </Card>
      </View>
    );
  }

  if (detail.isPrivate) {
    return (
      <View style={{ gap: theme.spacing.sm }}>
        <EmptyState
          title="Tracking unavailable"
          description="This athlete has set their live tracking to private."
        />
        <Button label="Untrack" size="sm" variant="ghost" onPress={onRemove} />
      </View>
    );
  }

  const header = displayHeader(detail);
  const finishTime =
    detail.result?.chipTime ||
    metricValue(detail.liveStats, "Elapsed") ||
    metricValue(detail.liveStats, "Official Race Time") ||
    metricValue(detail.liveStats, "Athlete Race Time");
  const averagePace =
    detail.result?.averagePace ||
    metricValue(detail.liveStats, "Average Pace") ||
    metricValue(detail.liveStats, "Average Speed") ||
    metricValue(detail.liveStats, "Current Speed");
  const status = detail.result
    ? detail.result.statusLabel || "Finished"
    : header.statusLabel || "Tracking";
  const resolvedHeaderPhoto =
    resolveAthletePhoto(
      {
        email: row?.athlete.email ?? header.email,
        athleteUid: row?.athlete.athleteUid ?? header.athleteUid,
        photoUrl: header.photo ?? row?.athlete.photoUrl,
      },
      null,
    ) ?? header.photo;
  const resolvedHeader = { ...header, photo: resolvedHeaderPhoto };
  const isNotStarted =
    !detail.result &&
    (detail.lifecycle.label || header.statusLabel || "")
      .toLowerCase()
      .includes("not started");

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <View
        {...swipeResponder.panHandlers}
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Button
          label="‹"
          variant="ghost"
          size="sm"
          disabled={total < 2}
          onPress={onPrevious}
        />
        <View style={{ alignItems: "center", gap: 5 }}>
          <View
            style={{
              width: 104,
              height: 5,
              borderRadius: 999,
              backgroundColor: "#FFFFFF",
            }}
          />
          <Text
            variant="caption"
            style={{ color: "#D4D4D4", fontWeight: "800" }}
          >
            {index + 1} / {total}
          </Text>
        </View>
        <Button
          label="›"
          variant="ghost"
          size="sm"
          disabled={total < 2}
          onPress={onNext}
        />
      </View>

      <Card
        onPress={expanded ? undefined : onExpand}
        style={{
          backgroundColor: "#242424",
          borderColor: "rgba(255,255,255,0.10)",
          gap: theme.spacing.md,
          shadowOpacity: 0.18,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              expanded ? "Hide details" : "Show athlete details"
            }
            onPress={onExpand}
            hitSlop={8}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingVertical: 2,
            }}
          >
            <Text
              variant="caption"
              style={{ color: "#FFFFFF", fontWeight: "900" }}
            >
              {expanded ? "Hide" : "Details"}
            </Text>
            <Icon
              name={expanded ? "chevronDown" : "chevronDown"}
              size={14}
              colorValue="#FFFFFF"
            />
          </Pressable>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Badge
              label={status}
              variant={
                /\b(dnf|dns|dsq)\b/i.test(status)
                  ? "danger"
                  : detail.result
                    ? "finished"
                    : "neutral"
              }
            />
            {row.refreshing ? (
              <Text variant="caption" style={{ color: "#9FA6B2" }}>
                Refreshing…
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Untrack ${header.name}`}
              onPress={(event) => {
                event.stopPropagation();
                onRemove();
              }}
              hitSlop={8}
              style={{
                width: 30,
                height: 30,
                borderRadius: 15,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "rgba(225,18,42,0.14)",
                borderWidth: 1,
                borderColor: "rgba(225,18,42,0.42)",
              }}
            >
              <Text
                variant="headline"
                style={{ color: "#FF4D5E", fontSize: 17, lineHeight: 18 }}
              >
                ×
              </Text>
            </Pressable>
          </View>
        </View>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: theme.spacing.md,
          }}
        >
          <Avatar
            name={resolvedHeader.name}
            uri={resolvedHeader.photo}
            colorSeed={resolvedHeader.colorSeed || resolvedHeader.bib}
            size={68}
            bordered
          />
          <View style={{ flex: 1, gap: 6 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <Text
                variant="title"
                style={{ color: "#FFFFFF", flexShrink: 1 }}
                numberOfLines={2}
              >
                {header.name}
              </Text>
              {header.countryFlag ? (
                <Text variant="headline" style={{ color: "#FFFFFF" }}>
                  {header.countryFlag}
                </Text>
              ) : null}
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {[
                `BIB: ${header.bib || "—"}`,
                header.category ? `AGE GROUP: ${header.category}` : null,
              ]
                .filter((label): label is string => Boolean(label))
                .map((label) => (
                  <View
                    key={label}
                    style={{
                      alignSelf: "flex-start",
                      paddingHorizontal: 10,
                      paddingVertical: 4,
                      borderRadius: 999,
                      backgroundColor: "rgba(255,255,255,0.14)",
                    }}
                  >
                    <Text
                      variant="label"
                      style={{ color: "#FFFFFF", fontWeight: "900" }}
                    >
                      {label}
                    </Text>
                  </View>
                ))}
            </View>
            {header.contest ? (
              <Text
                variant="bodySmall"
                style={{ color: "#D2D2D2" }}
                numberOfLines={2}
              >
                Contest: {header.contest}
              </Text>
            ) : null}
            {header.club ? (
              <View
                style={{
                  alignSelf: "flex-start",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 7,
                  maxWidth: "100%",
                  paddingHorizontal: 11,
                  paddingVertical: 7,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: "rgba(61,214,140,0.46)",
                  backgroundColor: "rgba(61,214,140,0.14)",
                }}
              >
                <Icon name="medal" size={15} colorValue="#3DD68C" />
                <Text
                  variant="caption"
                  numberOfLines={2}
                  style={{
                    flexShrink: 1,
                    color: "#B8F7D8",
                    fontWeight: "900",
                    letterSpacing: 0.2,
                  }}
                >
                  Proudly representing {header.club}
                </Text>
              </View>
            ) : null}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Show athlete on map"
            onPress={onViewMap}
            hitSlop={8}
            style={{
              width: 38,
              height: 38,
              borderRadius: 13,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(255,255,255,0.10)",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.16)",
            }}
          >
            <Icon name="location" size={18} colorValue="#FFFFFF" />
          </Pressable>
        </View>

        {!expanded ? (
          <View style={{ gap: 4 }}>
            <Text
              variant="bodySmall"
              style={{ color: "#FFFFFF", fontWeight: "800" }}
            >
              {isNotStarted
                ? "Awaiting start"
                : detail.result
                  ? "Finish Time"
                  : "Current Time"}{" "}
              {isNotStarted ? "" : finishTime || "—"}
            </Text>
            {!isNotStarted ? (
              <Text variant="bodySmall" style={{ color: "#FFFFFF" }}>
                {averagePace ||
                  detail.header.statusLabel ||
                  "Awaiting timing data"}
              </Text>
            ) : null}
          </View>
        ) : null}

        {isNotStarted ? (
          <RaceStartCountdown
            scheduledStart={header.scheduledStart}
            startTiming={detail.startTiming}
          />
        ) : null}

        {!isNotStarted && !detail.result ? (
          <CompactLiveTimingSummary detail={detail} />
        ) : null}

        <CompactRaceProgress
          contest={header.contest || row.athlete.category || ""}
          raceCategory={raceCategory || header.raceCategory}
          legLabel={detail.raceProgress?.legLabel || status}
          progress={detail.raceProgress?.progress ?? 0}
          finished={Boolean(
            detail.result && /finish|complete/i.test(detail.result.statusLabel),
          )}
          resultStatus={detail.result?.statusLabel}
          resultSplits={detail.result?.splits}
          timeline={detail.timeline}
          finishTime={detail.result?.chipTime}
          elapsedTime={finishTime}
          clockRunning={!detail.result && header.status === "live"}
          cutoffs={row.cutoffs}
          raceStartedAt={detail.raceStartedAt}
          predictionTrack={detail.track}
          waitingToStart={Boolean(detail.startTiming?.waitingForChipStart)}
        />

        {expanded ? (
          <View style={{ gap: theme.spacing.sm }}>
            {detail.result ? (
              <OfficialResultsCard
                header={header}
                result={detail.result}
                eventName={eventName}
              />
            ) : (
              <>
                <TimelineCard
                  splits={detail.timeline}
                  raceTiming={detail.raceTiming}
                  contest={header.contest}
                  raceCategory={raceCategory || header.raceCategory}
                />
                {detail.prediction ||
                detail.nextSplit ||
                detail.predictedCheckpoints?.length ? (
                  <PredictionCard
                    nextSplit={detail.nextSplit}
                    projected={detail.prediction}
                    checkpoints={detail.predictedCheckpoints}
                  />
                ) : null}
                {detail.rankings.length > 0 ? (
                  <RankingCard rankings={detail.rankings} />
                ) : null}
                {detail.courseOverview.length > 0 ? (
                  <CourseOverviewCard items={detail.courseOverview} />
                ) : null}
                {detail.cutoffs.length > 0 ? (
                  <CutoffCard
                    cutoffs={detail.cutoffs}
                    status={detail.livePosition?.cutoffStatus}
                  />
                ) : null}
              </>
            )}
          </View>
        ) : null}
      </Card>
    </View>
  );
}

function parseElapsedClock(value?: string): number | null {
  const parts = String(value ?? "")
    .trim()
    .split(":")
    .map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some(Number.isNaN))
    return null;
  const [hours, minutes, seconds] =
    parts.length === 3 ? parts : [0, parts[0], parts[1]];
  return hours * 3600 + minutes * 60 + seconds;
}

function formatElapsedClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

function useContinuousElapsedSeconds({
  running,
  raceStartedAt,
  canonicalElapsedSeconds,
}: {
  running: boolean;
  raceStartedAt?: number;
  canonicalElapsedSeconds: number | null;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const anchorRef = useRef({
    sourceSeconds: canonicalElapsedSeconds,
    elapsedSeconds: canonicalElapsedSeconds,
    atMs: Date.now(),
  });
  if (anchorRef.current.sourceSeconds !== canonicalElapsedSeconds) {
    const currentEstimate =
      anchorRef.current.elapsedSeconds == null
        ? null
        : anchorRef.current.elapsedSeconds +
          Math.max(0, (Date.now() - anchorRef.current.atMs) / 1_000);
    anchorRef.current = {
      sourceSeconds: canonicalElapsedSeconds,
      elapsedSeconds:
        canonicalElapsedSeconds == null
          ? currentEstimate
          : Math.max(canonicalElapsedSeconds, currentEstimate ?? 0),
      atMs: Date.now(),
    };
  }
  useEffect(() => {
    if (!running) return undefined;
    setNowMs(Date.now());
    const timer = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [running]);

  const elapsedSeconds = !running
    ? canonicalElapsedSeconds
    : raceStartedAt && Number.isFinite(raceStartedAt)
      ? Math.max(0, Math.floor((nowMs - raceStartedAt) / 1_000))
      : anchorRef.current.elapsedSeconds == null
        ? null
        : Math.max(
            0,
            Math.floor(
              anchorRef.current.elapsedSeconds +
                (nowMs - anchorRef.current.atMs) / 1_000,
            ),
          );
  return { elapsedSeconds, nowMs };
}

function CompactLiveTimingSummary({
  detail,
}: {
  detail?: AthleteDetailViewModel;
}) {
  if (!detail) return null;
  return <CompactLiveTimingSummaryContent detail={detail} />;
}

function CompactLiveTimingSummaryContent({
  detail,
}: {
  detail: AthleteDetailViewModel;
}) {
  const [activeMetric, setActiveMetric] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [appActive, setAppActive] = useState(
    AppState.currentState === "active",
  );
  const [pauseUntil, setPauseUntil] = useState(0);
  const metricTranslateX = useSharedValue(0);
  const metricOpacity = useSharedValue(1);
  const timeline = detail?.timeline ?? [];
  const reachedRows = timeline.filter((row) => {
    const elapsed = parseElapsedClock(row.elapsedTimeLabel || row.timeLabel);
    return row.state !== "upcoming" && elapsed != null;
  });
  const lastReached = reachedRows[reachedRows.length - 1];
  const lastIndex = lastReached ? timeline.indexOf(lastReached) : -1;
  const nextRow =
    lastIndex >= 0
      ? timeline
          .slice(lastIndex + 1)
          .find(
            (row) =>
              row.state === "upcoming" ||
              parseElapsedClock(row.elapsedTimeLabel || row.timeLabel) == null,
          )
      : timeline[0];
  const running = detail?.header.status === "live";

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    const motionSubscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    const appSubscription = AppState.addEventListener("change", (state) => {
      setAppActive(state === "active");
    });
    return () => {
      mounted = false;
      motionSubscription.remove();
      appSubscription.remove();
    };
  }, []);

  const completedElapsed =
    parseElapsedClock(detail.result?.chipTime) ??
    parseElapsedClock(lastReached?.elapsedTimeLabel || lastReached?.timeLabel);
  const canonicalLiveElapsed =
    parseElapsedClock(metricValue(detail.liveStats, "Elapsed")) ??
    parseElapsedClock(metricValue(detail.liveStats, "Athlete Race Time")) ??
    completedElapsed;
  const { elapsedSeconds: continuousElapsedSeconds } =
    useContinuousElapsedSeconds({
      running,
      raceStartedAt: detail.raceStartedAt,
      canonicalElapsedSeconds: canonicalLiveElapsed,
    });
  const elapsedSeconds = continuousElapsedSeconds ?? completedElapsed ?? 0;
  const predictedElapsed = parseElapsedClock(detail.nextSplit?.etaElapsed);
  const canonicalEtaRemaining = parseElapsedClock(
    detail.nextSplit?.etaRemaining,
  );
  const etaRemaining =
    canonicalEtaRemaining != null
      ? canonicalEtaRemaining
      : predictedElapsed != null
        ? Math.max(0, predictedElapsed - elapsedSeconds)
        : null;
  const coveredLabel =
    detail.raceProgress?.coveredLabel?.replace(/\s+done$/i, "") || "—";
  const remainingValue = Number(
    detail.raceProgress?.remainingLabel?.match(/[\d.]+/)?.[0],
  );
  const coveredValue = Number(coveredLabel.match(/[\d.]+/)?.[0]);
  // The interpolation seed is anchored to official cumulative race elapsed,
  // not to the time this component happened to render. That keeps movement
  // continuous across polling/re-renders and re-anchors immediately when a
  // newer official split (for example Run Start) arrives.
  const trackElapsedSeconds = detail.track
    ? Math.max(0, elapsedSeconds - detail.track.seed.anchorTimeSec)
    : 0;
  const locallyEstimatedDistance = detail.track
    ? estimatedDistanceKm(detail.track.seed, trackElapsedSeconds)
    : null;
  const displayedCoveredValue = Math.max(
    Number.isFinite(coveredValue) ? coveredValue : 0,
    locallyEstimatedDistance ?? 0,
  );
  const totalValue =
    detail.track?.totalKm && detail.track.totalKm > 0
      ? detail.track.totalKm
      : Number.isFinite(coveredValue) && Number.isFinite(remainingValue)
        ? coveredValue + remainingValue
        : null;
  const displayedProgress =
    totalValue && totalValue > 0
      ? `${Math.min(100, Math.max(0, (displayedCoveredValue / totalValue) * 100)).toFixed(0)}%`
      : detail.raceProgress?.percentLabel || "—";
  const predictedFinish =
    detail.prediction?.finishTimeLabel?.split("·").at(-1)?.trim() ||
    detail.nextSplit?.etaClock ||
    "Waiting for split";
  const finished = Boolean(
    detail.result && /finish|complete/i.test(detail.result.statusLabel),
  );
  const notStarted = !finished && detail.header.status !== "live";
  const nextName =
    detail.nextSplit?.checkpoint || nextRow?.splitLabel || nextRow?.name || "—";
  const remainingLabel =
    detail.nextSplit?.remaining || detail.raceProgress?.remainingLabel || "—";
  const projectedDuration = detail.prediction?.finishTimeLabel
    ?.split("·")[0]
    ?.trim();
  const lastSplitName = lastReached?.splitLabel || lastReached?.name || "START";
  const lastSplitElapsed =
    lastReached?.elapsedTimeLabel || lastReached?.timeLabel || "—";
  const averagePace =
    detail.result?.averagePace ||
    metricValue(detail.liveStats, "Average Pace") ||
    metricValue(detail.liveStats, "Avg Pace") ||
    detail.prediction?.paceLabel ||
    "—";
  const startTiming = detail.startTiming;
  const waitingForChipStart = Boolean(startTiming?.waitingForChipStart);
  const officialTimingMode = startTiming?.officialTimingMode ?? "GUN";
  const metrics = finished
    ? [
        {
          label: "FINISH TIME",
          value: detail.result?.chipTime || formatElapsedClock(elapsedSeconds),
          secondary: "OFFICIAL",
        },
        {
          label: "FINISHED",
          value: detail.result?.finishTimeOfDay || "—",
          secondary: "TIME OF DAY",
        },
        {
          label: "DISTANCE",
          value:
            totalValue != null ? `${totalValue.toFixed(2)} KM` : coveredLabel,
          secondary: "OFFICIAL",
        },
        { label: "OVERALL PACE", value: averagePace, secondary: "FINAL" },
        {
          label: "OVERALL",
          value: metricValue(detail.rankings, "Overall") || "—",
          secondary: metricValue(detail.rankings, "Category")
            ? `CATEGORY ${metricValue(detail.rankings, "Category")}`
            : "FINAL RANK",
        },
      ]
    : notStarted
      ? [
          {
            label: "STATUS",
            value: waitingForChipStart ? "WAITING TO START" : "NOT STARTED",
            secondary: waitingForChipStart
              ? "WAITING FOR CHIP START"
              : "WAITING FOR START",
          },
          {
            label: "GUN START",
            value: startTiming?.gunStartLabel || "—",
            secondary: "EVENT CLOCK · INFORMATIONAL",
          },
          {
            label: "START TYPE",
            value:
              officialTimingMode === "CHIP" ? "CHIP START" : officialTimingMode,
            secondary: "FIRST VALID MAT PASSAGE",
          },
          { label: "NEXT", value: "START", secondary: "CHECKPOINT" },
        ]
      : [
          {
            label:
              officialTimingMode === "CHIP" ? "NET TIME" : "OFFICIAL RACE TIME",
            value: formatElapsedClock(elapsedSeconds),
            secondary: "LIVE",
          },
          ...(officialTimingMode === "CHIP" && startTiming?.chipStartLabel
            ? [
                {
                  label: "CHIP START",
                  value: startTiming.chipStartLabel,
                  secondary: "ACCEPTED START MAT",
                },
              ]
            : []),
          {
            label: "LAST SPLIT",
            value: lastSplitName,
            secondary: lastSplitElapsed,
          },
          {
            label: "NEXT",
            value: nextName,
            secondary:
              etaRemaining != null
                ? `ETA IN ${formatElapsedClock(etaRemaining)}`
                : remainingLabel,
          },
          {
            label: "EST. FINISH",
            value: predictedFinish,
            secondary: projectedDuration || "WAITING FOR SPLIT",
          },
          {
            label: "DISTANCE · EST.",
            value:
              totalValue != null
                ? `${displayedCoveredValue.toFixed(2)} / ${totalValue.toFixed(2)} KM`
                : coveredLabel,
            secondary: displayedProgress,
          },
        ];

  const metricCount = metrics.length;
  const safeActiveMetric = Math.min(activeMetric, Math.max(0, metricCount - 1));

  useEffect(() => {
    if (!appActive || reduceMotion || metricCount < 2) return undefined;
    const timer = setInterval(() => {
      if (Date.now() < pauseUntil) return;
      setActiveMetric((current) => (current + 1) % metricCount);
    }, 3_500);
    return () => clearInterval(timer);
  }, [appActive, metricCount, pauseUntil, reduceMotion]);

  useEffect(() => {
    if (reduceMotion) {
      metricTranslateX.value = 0;
      metricOpacity.value = 1;
      return;
    }
    metricTranslateX.value = 18;
    metricOpacity.value = 0.65;
    metricTranslateX.value = withTiming(0, {
      duration: 300,
      easing: Easing.out(Easing.cubic),
    });
    metricOpacity.value = withTiming(1, { duration: 260 });
  }, [metricOpacity, metricTranslateX, reduceMotion, safeActiveMetric]);

  const metricAnimatedStyle = useAnimatedStyle(() => ({
    opacity: metricOpacity.value,
    transform: [{ translateX: metricTranslateX.value }],
  }));
  const selectMetric = useCallback(
    (index: number) => {
      setPauseUntil(Date.now() + 5_000);
      setActiveMetric((index + metricCount) % metricCount);
    },
    [metricCount],
  );
  const metricSwipeResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > 18 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dx < -30) selectMetric(safeActiveMetric + 1);
          else if (gesture.dx > 30) selectMetric(safeActiveMetric - 1);
        },
      }),
    [safeActiveMetric, selectMetric],
  );
  const metric = metrics[safeActiveMetric] ?? metrics[0];

  return (
    <View
      {...metricSwipeResponder.panHandlers}
      accessibilityLabel={`${metric?.label || "Live metric"}: ${metric?.value || "Unavailable"}`}
      style={{
        height: 112,
        justifyContent: "center",
        alignItems: "center",
        gap: 9,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 12,
        backgroundColor: "rgba(255,255,255,0.08)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.10)",
        overflow: "hidden",
      }}
    >
      <Animated.View
        style={[
          { alignItems: "center", justifyContent: "center", gap: 3 },
          metricAnimatedStyle,
        ]}
      >
        <Text
          variant="caption"
          style={{ color: "#8F98A6", fontWeight: "900", fontSize: 10 }}
        >
          {metric?.label}
        </Text>
        <Text
          variant="headline"
          style={{ color: "#FFFFFF", fontWeight: "900", textAlign: "center" }}
          numberOfLines={1}
        >
          {metric?.value}
        </Text>
        <Text
          variant="caption"
          style={{ color: "#C4CAD3", fontWeight: "800", textAlign: "center" }}
          numberOfLines={1}
        >
          {metric?.secondary}
        </Text>
      </Animated.View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        {metrics.map((item, index) => (
          <View
            key={`${item.label}-${index}`}
            accessibilityRole="button"
            accessibilityLabel={`Show ${item.label}`}
            accessible
            focusable
            onStartShouldSetResponder={() => true}
            onResponderRelease={() => selectMetric(index)}
            hitSlop={8}
          >
            <View
              style={{
                width: index === safeActiveMetric ? 16 : 6,
                height: 6,
                borderRadius: 999,
                backgroundColor:
                  index === safeActiveMetric ? "#EF1738" : "#596272",
              }}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

function CompactRaceProgress({
  contest,
  raceCategory,
  legLabel,
  progress,
  finished = false,
  resultStatus,
  resultSplits = [],
  timeline = [],
  finishTime,
  elapsedTime,
  clockRunning = false,
  cutoffs,
  raceStartedAt,
  predictionTrack,
  waitingToStart = false,
}: {
  contest: string;
  raceCategory?: string;
  legLabel: string;
  progress: number;
  finished?: boolean;
  resultStatus?: string;
  resultSplits?: { label: string; value: string }[];
  timeline?: TimelineSplit[];
  finishTime?: string;
  elapsedTime?: string;
  clockRunning?: boolean;
  cutoffs?: SegmentCutoffs;
  raceStartedAt?: number;
  predictionTrack?: AthleteDetailViewModel["track"];
  waitingToStart?: boolean;
}) {
  const predictionFingerprint = predictionTrack
    ? [
        predictionTrack.seed.anchorKm,
        predictionTrack.seed.anchorTimeSec,
        predictionTrack.seed.nextKm,
        predictionTrack.seed.paceSecPerKm,
      ].join(":")
    : "";
  const predictionAnchorRef = useRef({ fingerprint: "", at: Date.now() });
  if (predictionAnchorRef.current.fingerprint !== predictionFingerprint) {
    predictionAnchorRef.current = {
      fingerprint: predictionFingerprint,
      at: Date.now(),
    };
  }
  const canonicalElapsedSeconds = parseElapsedClock(elapsedTime);
  const { elapsedSeconds: continuousElapsedSeconds, nowMs: predictionNow } =
    useContinuousElapsedSeconds({
      running: clockRunning,
      raceStartedAt,
      canonicalElapsedSeconds,
    });
  const effectiveProgress = useMemo(() => {
    const canonicalProgress = Math.max(0, Math.min(1, progress));
    if (finished) return 1;
    if (!clockRunning || !predictionTrack || !(predictionTrack.totalKm > 0)) {
      return canonicalProgress;
    }
    // The interpolation seed is tied to the last accepted split's cumulative
    // race elapsed. Drive it from the live race clock so polling, rerenders,
    // reopening the sheet, and app resume cannot reset movement back to the
    // Bike/Run start node. The final keyframe is official timing evidence; it
    // is only the prediction anchor and never marks the next split complete.
    const officialAnchor = predictionTrack.keyframes.reduce<
      { distanceKm: number; timeSec: number } | undefined
    >(
      (latest, frame) =>
        !latest || frame.timeSec > latest.timeSec ? frame : latest,
      undefined,
    );
    const hasOfficialClock = officialAnchor && continuousElapsedSeconds != null;
    const elapsedSinceAnchor = hasOfficialClock
      ? Math.max(0, continuousElapsedSeconds - officialAnchor.timeSec)
      : Math.max(0, (predictionNow - predictionAnchorRef.current.at) / 1_000);
    const movementSeed = hasOfficialClock
      ? {
          ...predictionTrack.seed,
          anchorKm: officialAnchor.distanceKm,
          anchorTimeSec: officialAnchor.timeSec,
        }
      : predictionTrack.seed;
    const predictedDistance = estimatedDistanceKm(
      movementSeed,
      elapsedSinceAnchor,
    );
    return Math.max(
      canonicalProgress,
      distanceToFraction(predictedDistance, predictionTrack.totalKm),
    );
  }, [
    clockRunning,
    continuousElapsedSeconds,
    elapsedTime,
    finished,
    predictionNow,
    predictionTrack,
    progress,
    raceStartedAt,
  ]);
  const normalizedLeg = normalizeSearchText(legLabel);
  const courseKind = resolveCourseKind(raceCategory, contest);
  const stages = courseStageLabels(courseKind);
  // The compact race card communicates sport legs plus configured transition
  // boundaries. Detailed timing checkpoints remain in Live Split Flow.
  const displayStages = stages.map((stage) => ({
    key: stage,
    label: stage,
    value: "",
    state: "upcoming" as const,
  }));
  const isDnf = /\bdnf\b|did not finish/i.test(resultStatus ?? "");
  const isDns = /\bdns\b|did not start/i.test(resultStatus ?? "");
  const sportStages = stages.filter((stage) =>
    /^(?:SWIM|BIKE|RUN|RUN1|RUN2)$/.test(stage),
  );
  const timelineRowsForStage = (stage: string) =>
    timeline.filter((split) => {
      const identity = normalizeSearchText(
        `${split.segment} ${split.name} ${split.splitLabel}`,
      );
      if (stage === "BIKE") return /\b(?:bike|cycle)\b/.test(identity);
      if (stage === "SWIM") {
        return (
          /\bswim\b/.test(identity) ||
          (/\bstart\b/.test(identity) &&
            !/\b(?:bike|cycle|run)\b/.test(identity))
        );
      }
      if (stage === "RUN") return /\brun\b/.test(identity);
      return identity.includes(stage.toLowerCase());
    });
  let completedBoundaryIndex = 0;
  for (const stage of sportStages) {
    const rowsForStage = timelineRowsForStage(stage);
    const finishRow = rowsForStage.find((split) =>
      /finish/i.test(`${split.name} ${split.splitLabel}`),
    );
    const completed = finishRow
      ? finishRow.state === "completed"
      : rowsForStage.length > 1 &&
        rowsForStage.every((split) => split.state === "completed");
    if (!completed) break;
    const sportIndex = stages.indexOf(stage);
    completedBoundaryIndex = Math.min(stages.length - 1, sportIndex + 1);
  }
  const labelIndex = stages.findIndex((stage) =>
    normalizedLeg.includes(stage.toLowerCase()),
  );
  const officialBoundaryProgress =
    stages.length > 1
      ? Math.min(
          1,
          Math.max(completedBoundaryIndex, labelIndex) / (stages.length - 1),
        )
      : finished
        ? 1
        : 0;
  const configuredStageDistanceEndpoints = sportStages.map((stage) => {
    const values = timelineRowsForStage(stage)
      .map((split) =>
        Number(String(split.distanceLabel || "").match(/\d+(?:\.\d+)?/)?.[0]),
      )
      .filter((value) => Number.isFinite(value) && value > 0);
    return values.length ? Math.max(...values) : null;
  });
  const endpointsLookCumulative = Boolean(
    predictionTrack &&
    predictionTrack.totalKm > 0 &&
    configuredStageDistanceEndpoints.every(
      (distance) => distance != null && distance > 0,
    ) &&
    configuredStageDistanceEndpoints.every(
      (distance, index, all) =>
        index === 0 || Number(distance) >= Number(all[index - 1]),
    ) &&
    Math.abs(
      Number(configuredStageDistanceEndpoints.at(-1)) - predictionTrack.totalKm,
    ) /
      predictionTrack.totalKm <=
      0.1,
  );
  const configuredStageDistances = endpointsLookCumulative
    ? configuredStageDistanceEndpoints.map(
        (distance, index, all) =>
          Number(distance) - (index > 0 ? Number(all[index - 1]) : 0),
      )
    : configuredStageDistanceEndpoints;
  const configuredTotalDistance = configuredStageDistances.reduce<number>(
    (total, distance) => total + (distance ?? 0),
    0,
  );
  const stageDistancesAreUsable =
    predictionTrack &&
    predictionTrack.totalKm > 0 &&
    configuredStageDistances.every(
      (distance) => distance != null && distance > 0,
    ) &&
    configuredTotalDistance > 0 &&
    Math.abs(configuredTotalDistance - predictionTrack.totalKm) /
      predictionTrack.totalKm <=
      0.1;
  const visualPredictionProgress = (() => {
    if (!stageDistancesAreUsable || stages.length <= 1 || !predictionTrack)
      return effectiveProgress;
    const estimatedCourseDistance = effectiveProgress * predictionTrack.totalKm;
    let distanceBeforeStage = 0;
    for (let index = 0; index < configuredStageDistances.length; index += 1) {
      const stageDistance = configuredStageDistances[index] ?? 0;
      if (
        estimatedCourseDistance <= distanceBeforeStage + stageDistance ||
        index === configuredStageDistances.length - 1
      ) {
        const fractionWithinStage =
          stageDistance > 0
            ? Math.max(
                0,
                Math.min(
                  1,
                  (estimatedCourseDistance - distanceBeforeStage) /
                    stageDistance,
                ),
              )
            : 0;
        const displayStageIndex = stages.indexOf(sportStages[index]);
        const nextBoundaryIndex =
          index === configuredStageDistances.length - 1
            ? stages.length - 1
            : Math.max(
                displayStageIndex + 1,
                stages.indexOf(sportStages[index + 1]) - 1,
              );
        const displaySpan = Math.max(1, nextBoundaryIndex - displayStageIndex);
        return Math.min(
          1,
          (displayStageIndex + fractionWithinStage * displaySpan) /
            (stages.length - 1),
        );
      }
      distanceBeforeStage += stageDistance;
    }
    return effectiveProgress;
  })();
  const visualProgress = waitingToStart
    ? 0
    : Math.max(visualPredictionProgress, officialBoundaryProgress);
  const progressIndex = Math.min(
    stages.length - 1,
    Math.max(0, Math.floor(visualProgress * (stages.length - 1))),
  );
  const activeIndex = finished
    ? stages.length - 1
    : Math.max(labelIndex, progressIndex, completedBoundaryIndex);
  const splitTimeForStage = (stage: string): string => {
    if (stage === "FINISH") return finishTime || "--:--";
    const aliases: Record<string, string[]> = {
      SWIM: ["swim"],
      T1: ["t1", "transition 1", "transition1"],
      BIKE: ["bike", "cycle"],
      T2: ["t2", "transition 2", "transition2"],
      RUN: ["run"],
    };
    const match = resultSplits.find((split) => {
      const label = normalizeSearchText(split.label);
      return (aliases[stage] ?? [stage.toLowerCase()]).some(
        (alias) => label === alias || label.includes(alias),
      );
    });
    return match?.value || "--:--";
  };
  const hasOfficialTime = (stage: string) =>
    !["", "--:--", "—", "dnf", "dns", "dsq"].includes(
      splitTimeForStage(stage).trim().toLowerCase(),
    );
  const cutoffMode = normalizeSearchText(cutoffs?.mode);
  const stageElapsedSeconds = (stage: "SWIM" | "BIKE" | "RUN") => {
    const stageIndex = stages.indexOf(stage);
    if (stageIndex < 0) return null;
    if (!cutoffMode.includes("cumulative"))
      return parseElapsedClock(splitTimeForStage(stage));
    const values = stages
      .slice(0, stageIndex + 1)
      .map((candidate) => parseElapsedClock(splitTimeForStage(candidate)));
    if (values.some((value) => value == null)) return null;
    return values.reduce<number>((total, value) => total + (value ?? 0), 0);
  };
  const cutoffBreach = (["SWIM", "BIKE", "RUN"] as const)
    .map((stage) => {
      const cutoffKey = stage.toLowerCase() as "swim" | "bike" | "run";
      const configured = parseElapsedClock(cutoffs?.[cutoffKey]);
      const actual = stageElapsedSeconds(stage);
      return configured != null && actual != null && actual > configured
        ? { stage, configured, actual }
        : null;
    })
    .find(
      (
        breach,
      ): breach is {
        stage: "SWIM" | "BIKE" | "RUN";
        configured: number;
        actual: number;
      } => Boolean(breach),
    );
  const hasAnyOfficialSplit = stages.some(hasOfficialTime);
  const hasUnknownDnfStage = isDnf && !cutoffBreach && !hasAnyOfficialSplit;
  const dnfStageIndex = isDnf
    ? stages.indexOf(
        cutoffBreach?.stage ??
          (courseKind === "swim"
            ? hasOfficialTime("SWIM")
              ? "FINISH"
              : "SWIM"
            : courseKind === "bike"
              ? hasOfficialTime("BIKE")
                ? "FINISH"
                : "BIKE"
              : courseKind === "run"
                ? hasOfficialTime("RUN")
                  ? "FINISH"
                  : "RUN"
                : hasOfficialTime("RUN")
                  ? "RUN"
                  : hasOfficialTime("BIKE")
                    ? "RUN"
                    : hasOfficialTime("SWIM")
                      ? "BIKE"
                      : "SWIM"),
      )
    : -1;
  const resolvedActiveIndex = isDnf ? Math.max(0, dnfStageIndex) : activeIndex;
  const movingStage = stages[resolvedActiveIndex] ?? "RUN";
  const movingIcon =
    movingStage === "SWIM"
      ? "swim"
      : movingStage === "BIKE"
        ? "bike"
        : movingStage === "RUN"
          ? "run"
          : "flag";
  const raceElapsedSeconds = continuousElapsedSeconds;
  const displayedElapsedTime =
    raceElapsedSeconds != null
      ? formatElapsedClock(raceElapsedSeconds)
      : elapsedTime;
  const currentCutoffStage = (["SWIM", "BIKE", "RUN"] as const).find(
    (stage) => stages.indexOf(stage) >= resolvedActiveIndex,
  );
  const currentCutoffSeconds = currentCutoffStage
    ? parseElapsedClock(
        cutoffs?.[currentCutoffStage.toLowerCase() as "swim" | "bike" | "run"],
      )
    : null;
  const usesLegCutoff =
    cutoffMode.includes("segment") || cutoffMode.includes("leg");
  const stageStartElapsedSeconds =
    currentCutoffStage === "SWIM"
      ? 0
      : currentCutoffStage
        ? (() => {
            const boundary = `${currentCutoffStage.toLowerCase()} start`;
            const row = timeline.find((candidate) =>
              normalizeSearchText(
                `${candidate.segment} ${candidate.splitLabel} ${candidate.name}`,
              ).includes(boundary),
            );
            return parseElapsedClock(row?.elapsedTimeLabel || row?.timeLabel);
          })()
        : null;
  // BERGMAN's normal cutoffs are cumulative from the athlete's official start.
  // Only explicitly configured leg/segment cutoffs reset at a sport boundary.
  const elapsedAgainstCutoff =
    raceElapsedSeconds == null
      ? null
      : usesLegCutoff
        ? Math.max(
            0,
            raceElapsedSeconds -
              (stageStartElapsedSeconds ?? raceElapsedSeconds),
          )
        : raceElapsedSeconds;
  const cutoffRemainingSeconds =
    currentCutoffSeconds != null && elapsedAgainstCutoff != null
      ? currentCutoffSeconds - elapsedAgainstCutoff
      : null;

  return (
    <View style={{ gap: 9 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <Text
          variant="caption"
          style={{ color: "#AEB6C3", fontWeight: "900", letterSpacing: 0.6 }}
        >
          {finished ? "RACE PROGRESS · CUMULATIVE TIMES" : "RACE PROGRESS"}
        </Text>
        {!waitingToStart && displayedElapsedTime ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingHorizontal: 9,
              paddingVertical: 4,
              borderRadius: 999,
              backgroundColor: "rgba(255,255,255,0.10)",
            }}
          >
            <Text
              variant="caption"
              style={{ color: "#AEB6C3", fontWeight: "800" }}
            >
              {resultStatus ? "TOTAL" : "ELAPSED"}
            </Text>
            <Text
              variant="label"
              style={{ color: "#FFFFFF", fontWeight: "900" }}
            >
              {displayedElapsedTime}
            </Text>
          </View>
        ) : null}
      </View>
      {isDnf ? (
        <Text variant="caption" style={{ color: "#FF8A98", fontWeight: "900" }}>
          {cutoffBreach
            ? `DNF AT ${cutoffBreach.stage} · ${formatElapsedClock(cutoffBreach.actual)} exceeded ${formatElapsedClock(cutoffBreach.configured)} cutoff`
            : hasUnknownDnfStage
              ? "DNF · stage not recorded in the official results"
              : `DNF AT ${stages[resolvedActiveIndex]} · inferred from the last official split`}
        </Text>
      ) : null}
      {isDns ? (
        <Text variant="caption" style={{ color: "#FFB4BE", fontWeight: "900" }}>
          DNS · ATHLETE DID NOT START
        </Text>
      ) : null}
      {!waitingToStart &&
      !resultStatus &&
      currentCutoffStage &&
      cutoffRemainingSeconds != null ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            paddingHorizontal: 10,
            paddingVertical: 7,
            borderRadius: 10,
            backgroundColor:
              cutoffRemainingSeconds < 0
                ? "rgba(225,18,42,0.16)"
                : "rgba(255,255,255,0.08)",
          }}
        >
          <Text
            variant="caption"
            style={{ color: "#AEB6C3", fontWeight: "900" }}
          >
            {currentCutoffStage} CUTOFF
          </Text>
          <Text
            variant="caption"
            style={{
              color: cutoffRemainingSeconds < 0 ? "#FF8A98" : "#FFFFFF",
              fontWeight: "900",
            }}
          >
            {cutoffRemainingSeconds < 0
              ? `OVER BY ${formatElapsedClock(Math.abs(cutoffRemainingSeconds))}`
              : `${formatElapsedClock(cutoffRemainingSeconds)} REMAINING`}
          </Text>
        </View>
      ) : null}
      <View
        style={{
          position: "relative",
          flexDirection: "row",
          alignItems: "flex-start",
        }}
      >
        {displayStages.length > 1 &&
        visualProgress > 0 &&
        visualProgress < 1 ? (
          <View
            pointerEvents="none"
            accessibilityLabel={`Estimated race progress ${Math.round(visualProgress * 100)} percent`}
            style={{
              position: "absolute",
              left: `${50 / displayStages.length + visualProgress * (100 - 100 / displayStages.length)}%`,
              top: 19,
              width: 23,
              height: 23,
              marginLeft: -11.5,
              borderRadius: 999,
              backgroundColor: "#FFFFFF",
              borderWidth: 2,
              borderColor: "#E1122A",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 4,
            }}
          >
            <Icon name={movingIcon} size={14} colorValue="#E1122A" />
          </View>
        ) : null}
        {displayStages.map((displayStage, index) => {
          const stage = displayStage.label;
          const segmentProgress =
            index < displayStages.length - 1
              ? Math.max(
                  0,
                  Math.min(
                    1,
                    visualProgress * (displayStages.length - 1) - index,
                  ),
                )
              : 0;
          const previousSegmentProgress =
            index > 0
              ? Math.max(
                  0,
                  Math.min(
                    1,
                    visualProgress * (displayStages.length - 1) - (index - 1),
                  ),
                )
              : 0;
          const rightConnectorProgress = Math.max(
            0,
            Math.min(1, segmentProgress * 2),
          );
          const leftConnectorProgress = Math.max(
            0,
            Math.min(1, previousSegmentProgress * 2 - 1),
          );
          const completed = finished || index < resolvedActiveIndex;
          const current =
            !finished &&
            !waitingToStart &&
            !isDns &&
            !hasUnknownDnfStage &&
            index === resolvedActiveIndex;
          return (
            <View
              key={displayStage.key}
              style={{ flex: 1, minWidth: 0, alignItems: "center", gap: 6 }}
            >
              <Text
                variant="caption"
                style={{
                  color: current || completed ? "#FFFFFF" : "#8F98A6",
                  fontWeight: "900",
                  fontSize: 10,
                }}
              >
                {stage}
              </Text>
              <View
                style={{
                  position: "relative",
                  width: "100%",
                  height: 26,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {index > 0 ? (
                  <View
                    pointerEvents="none"
                    style={{
                      position: "absolute",
                      left: 0,
                      right: "50%",
                      marginRight: 13,
                      top: 11.5,
                      height: 3,
                      backgroundColor: "#4B5563",
                      overflow: "hidden",
                      zIndex: 1,
                    }}
                  >
                    <View
                      style={{
                        width: `${leftConnectorProgress * 100}%`,
                        height: "100%",
                        backgroundColor: "#E1122A",
                      }}
                    />
                  </View>
                ) : null}
                {index < displayStages.length - 1 ? (
                  <View
                    pointerEvents="none"
                    style={{
                      position: "absolute",
                      left: "50%",
                      right: 0,
                      marginLeft: 13,
                      top: 11.5,
                      height: 3,
                      backgroundColor: "#4B5563",
                      overflow: "hidden",
                      zIndex: 1,
                    }}
                  >
                    <View
                      style={{
                        width: `${rightConnectorProgress * 100}%`,
                        height: "100%",
                        backgroundColor: "#E1122A",
                      }}
                    />
                  </View>
                ) : null}
                <View
                  style={{
                    position: "relative",
                    width: 26,
                    height: 26,
                    borderRadius: 13,
                    alignItems: "center",
                    justifyContent: "center",
                    zIndex: 2,
                    backgroundColor: current
                      ? "#E1122A"
                      : completed
                        ? "#9F1239"
                        : "#242424",
                    borderWidth: 2,
                    borderColor: current || completed ? "#FF5A6B" : "#6B7280",
                  }}
                >
                  {stage === "SWIM" ? (
                    <Icon name="swim" size={15} colorValue="#FFFFFF" />
                  ) : stage === "BIKE" ? (
                    <Icon name="bike" size={15} colorValue="#FFFFFF" />
                  ) : stage === "RUN" ? (
                    <Icon name="run" size={15} colorValue="#FFFFFF" />
                  ) : stage === "T1" || stage === "T2" ? (
                    <Icon name="transition" size={15} colorValue="#FFFFFF" />
                  ) : /finish/i.test(stage) ? (
                    <Icon name="flag" size={15} colorValue="#FFFFFF" />
                  ) : (
                    <Text
                      variant="caption"
                      style={{
                        color: "#FFFFFF",
                        fontWeight: "900",
                        fontSize: 9,
                      }}
                    >
                      {String(index + 1)}
                    </Text>
                  )}
                </View>
              </View>
              <Text
                variant="caption"
                style={{
                  color: completed || current ? "#FFFFFF" : "#8F98A6",
                  fontSize: 9,
                  fontWeight: completed ? "800" : "500",
                }}
              >
                {isDnf && current && !hasOfficialTime(stage)
                  ? "DNF"
                  : displayStage.value || splitTimeForStage(stage)}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function TrackedAthleteListCard({
  row,
  onOpen,
  onRemove,
}: {
  row: TrackedCard;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const theme = useTheme();
  const header = row.detail ? displayHeader(row.detail) : null;
  const name = header?.name || row.athlete.name;
  const bib = header?.bib || row.athlete.bib;
  const contest = header?.contest || row.athlete.category;
  const category = header?.category;
  const status = row.detail?.result
    ? row.detail.result.statusLabel || "Finished"
    : row.timingUnavailable
      ? "TIMING DATA PENDING"
      : row.detail?.lifecycle.label ||
        header?.statusLabel ||
        "Waiting to Start";
  const progress = row.detail?.raceProgress;
  const predictionFingerprint = row.detail?.track
    ? [
        row.detail.track.seed.anchorKm,
        row.detail.track.seed.anchorTimeSec,
        row.detail.track.seed.nextKm,
        row.detail.track.seed.paceSecPerKm,
      ].join(":")
    : "";
  const predictionAnchorRef = useRef({ fingerprint: "", at: Date.now() });
  const [predictionNow, setPredictionNow] = useState(() => Date.now());
  if (predictionAnchorRef.current.fingerprint !== predictionFingerprint) {
    predictionAnchorRef.current = {
      fingerprint: predictionFingerprint,
      at: Date.now(),
    };
  }
  useEffect(() => {
    if (!row.detail?.track || row.detail?.header.status !== "live")
      return undefined;
    const timer = setInterval(() => setPredictionNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [predictionFingerprint, row.detail?.header.status, row.detail?.track]);
  const predictedProgress = useMemo(() => {
    const track = row.detail?.track;
    if (!track || !(track.totalKm > 0)) return progress?.progress ?? 0;
    if (row.detail?.header.status === "finished") return 1;
    const elapsedSinceAnchor = Math.max(
      0,
      (predictionNow - predictionAnchorRef.current.at) / 1000,
    );
    const predictedDistance = estimatedDistanceKm(
      track.seed,
      elapsedSinceAnchor,
    );
    return Math.max(
      progress?.progress ?? 0,
      distanceToFraction(predictedDistance, track.totalKm),
    );
  }, [
    predictionNow,
    progress?.progress,
    row.detail?.header.status,
    row.detail?.track,
  ]);
  const isNotStarted =
    !row.detail?.result &&
    /not\s*started|waiting|awaiting\s*start/i.test(status);

  return (
    <View
      style={{
        minHeight: 118,
        borderRadius: theme.radius.large,
        overflow: "hidden",
        backgroundColor: "#242424",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.12)",
      }}
    >
      <View
        style={{
          flex: 1,
          minHeight: 210,
          paddingVertical: theme.spacing.md,
          // The close button occupies the top-right corner. Reserve the same
          // amount on the left so the athlete identity and progress content
          // remain visually centered within the card.
          paddingLeft: 48,
          paddingRight: 48,
          gap: theme.spacing.md,
          backgroundColor: "transparent",
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open ${name}`}
          onPress={onOpen}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: theme.spacing.md,
          }}
        >
          <Avatar
            name={name}
            uri={header?.photo || row.athlete.photoUrl}
            colorSeed={header?.colorSeed || row.athlete.id}
            size={62}
            bordered
          />
          <View style={{ flex: 1, gap: 5 }}>
            <Text
              variant="headline"
              style={{ color: "#FFFFFF" }}
              numberOfLines={1}
            >
              {name} {header?.countryFlag || ""}
            </Text>
            <Text
              variant="bodySmall"
              style={{ color: "#FFFFFF" }}
              numberOfLines={2}
            >
              {[contest, category, bib ? `Bib ${bib}` : ""]
                .filter(Boolean)
                .join(" · ")}
            </Text>
            <Text
              variant="bodySmall"
              style={{ color: "#BDBDBD", fontWeight: "800" }}
              numberOfLines={1}
            >
              {status}
            </Text>
          </View>
        </Pressable>
        {row.timingUnavailable ? (
          <View
            style={{
              borderRadius: theme.radius.medium,
              padding: theme.spacing.md,
              gap: 4,
              backgroundColor: "rgba(255,255,255,0.06)",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.10)",
            }}
          >
            <Text variant="label" style={{ color: "#FFFFFF" }}>
              Timing configuration pending
            </Text>
            <Text variant="caption" style={{ color: "#AEB6C2" }}>
              Race progress will appear after the event timing build is
              published.
            </Text>
          </View>
        ) : (
          <>
            {isNotStarted ? (
              <RaceStartCountdown
                scheduledStart={header?.scheduledStart}
                startTiming={row.detail?.startTiming}
              />
            ) : null}
            {!isNotStarted ? (
              <CompactLiveTimingSummary detail={row.detail} />
            ) : null}
            <CompactRaceProgress
              contest={contest || ""}
              raceCategory={row.raceCategory || row.detail?.header.raceCategory}
              legLabel={progress?.legLabel || status}
              progress={predictedProgress}
              finished={Boolean(
                row.detail?.result &&
                /finish|complete/i.test(row.detail.result.statusLabel),
              )}
              resultStatus={row.detail?.result?.statusLabel}
              resultSplits={row.detail?.result?.splits}
              timeline={row.detail?.timeline}
              finishTime={row.detail?.result?.chipTime}
              elapsedTime={
                row.detail?.result?.chipTime ||
                metricValue(row.detail?.liveStats, "Elapsed") ||
                metricValue(row.detail?.liveStats, "Athlete Race Time")
              }
              clockRunning={Boolean(
                !row.detail?.result && row.detail?.header.status === "live",
              )}
              cutoffs={row.cutoffs}
              raceStartedAt={row.detail?.raceStartedAt}
              predictionTrack={row.detail?.track}
              waitingToStart={Boolean(
                row.detail?.startTiming?.waitingForChipStart,
              )}
            />
          </>
        )}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Untrack ${name}`}
        onPress={onRemove}
        hitSlop={8}
        style={{
          position: "absolute",
          top: 10,
          right: 10,
          width: 30,
          height: 30,
          borderRadius: 15,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "rgba(225,18,42,0.14)",
          borderWidth: 1,
          borderColor: "rgba(225,18,42,0.42)",
        }}
      >
        <Text
          variant="headline"
          style={{ color: "#FF4D5E", fontSize: 17, lineHeight: 18 }}
        >
          ×
        </Text>
      </Pressable>
    </View>
  );
}

export function LiveTrackScreen() {
  const theme = useTheme();
  const routeParams = useLocalSearchParams<{
    eventId?: string;
    email?: string;
    bib?: string;
    athleteUid?: string;
    bookingId?: string;
    participantUuid?: string;
    providerUuid?: string;
    providerAthleteUuid?: string;
    providerTimingUuid?: string;
    providerRecordId?: string;
    providerContestUuid?: string;
    contestUuid?: string;
    ticketId?: string;
    name?: string;
    category?: string;
    club?: string;
    photoUrl?: string;
    profilePhotoUrl?: string;
    photoURL?: string;
    displayPhoto?: string;
  }>();
  const eventScreen = useEventScreenInitialization();
  const id = eventScreen.eventId;
  const autoTrackAthlete = useMemo<SearchHit | null>(() => {
    const bib = firstText(routeParams.bib);
    const athleteUid = firstText(routeParams.athleteUid);
    const bookingId = firstText(routeParams.bookingId);
    const participantUuid = firstText(routeParams.participantUuid);
    const providerUuid = firstText(routeParams.providerUuid);
    const providerAthleteUuid = firstText(routeParams.providerAthleteUuid);
    const providerTimingUuid = firstText(routeParams.providerTimingUuid);
    const providerRecordId = firstText(routeParams.providerRecordId);
    const email = firstText(routeParams.email);
    const providerContestUuid = firstText(routeParams.providerContestUuid);
    const contestUuid = firstText(routeParams.contestUuid);
    const ticketId = firstText(routeParams.ticketId);
    const hasIdentity = Boolean(
      bib ||
      athleteUid ||
      bookingId ||
      email ||
      participantUuid ||
      providerUuid ||
      providerAthleteUuid ||
      providerTimingUuid ||
      providerRecordId,
    );
    if (!hasIdentity) return null;
    const category = firstText(routeParams.category);
    return {
      id: firstText(
        participantUuid,
        providerUuid,
        providerAthleteUuid,
        providerTimingUuid,
        providerRecordId,
        bookingId,
        athleteUid,
        bib && category ? `bib:${bib}:contest:${category}` : undefined,
        bib,
      ),
      participantUuid: participantUuid || undefined,
      bib,
      name: firstText(routeParams.name) || (bib ? `Bib ${bib}` : "Athlete"),
      email,
      category: category || undefined,
      club: firstText(routeParams.club) || undefined,
      photoUrl:
        firstText(
          routeParams.photoUrl,
          routeParams.profilePhotoUrl,
          routeParams.photoURL,
          routeParams.displayPhoto,
        ) || undefined,
      contestUuid: contestUuid || undefined,
      contestId: undefined,
      providerContestUuid: providerContestUuid || undefined,
      providerContestId: undefined,
      ticketId: ticketId || undefined,
      providerUuid: providerUuid || undefined,
      providerAthleteUuid: providerAthleteUuid || undefined,
      providerTimingUuid: providerTimingUuid || undefined,
      providerRecordId: providerRecordId || undefined,
      athleteUid: athleteUid || undefined,
      bookingId: bookingId || undefined,
      raceDate: undefined,
    };
  }, [
    routeParams.athleteUid,
    routeParams.bib,
    routeParams.bookingId,
    routeParams.category,
    routeParams.club,
    routeParams.displayPhoto,
    routeParams.name,
    routeParams.email,
    routeParams.participantUuid,
    routeParams.photoURL,
    routeParams.photoUrl,
    routeParams.profilePhotoUrl,
    routeParams.providerAthleteUuid,
    routeParams.providerContestUuid,
    routeParams.providerRecordId,
    routeParams.providerTimingUuid,
    routeParams.providerUuid,
    routeParams.contestUuid,
    routeParams.ticketId,
  ]);

  const eventQuery = useEvent(id);
  const normalizedEventStatus = String(
    eventQuery.event?.status ?? "",
  ).toLowerCase();
  const eventHasFinished = ["finished", "past", "results"].includes(
    normalizedEventStatus,
  );
  // Calendar status never overrides an explicitly enabled canonical live feed.
  // An event may remain live while Feibot is still producing official results.
  const canonicalLiveEnabled = eventQuery.event?.liveTrackingEnabled === true;
  const eventResultsQuery = useEventResults(
    id,
    eventScreen.queryEnabled && eventHasFinished && !canonicalLiveEnabled,
  );
  const liveParticipantsQuery = useParticipants(
    id,
    eventScreen.queryEnabled && (canonicalLiveEnabled || !eventHasFinished),
  );
  const courseQuery = useCourseMap(id);
  const resultsMode =
    !canonicalLiveEnabled &&
    (eventHasFinished || (eventResultsQuery.data?.length ?? 0) > 0);
  const athleteDataSource: "live" | "results" = resultsMode
    ? "results"
    : "live";
  const athleteRoster = useMemo<Record<string, unknown>[]>(() => {
    const rows =
      resultsMode && Array.isArray(eventResultsQuery.data)
        ? (eventResultsQuery.data as Record<string, unknown>[])
        : Array.isArray(liveParticipantsQuery.data)
          ? (liveParticipantsQuery.data as Record<string, unknown>[])
          : [];
    return rows.filter(isPublicTrackableAthlete);
  }, [eventResultsQuery.data, liveParticipantsQuery.data, resultsMode]);
  const liveTrackingResolved =
    !eventQuery.isLoading && !eventQuery.isError && Boolean(eventQuery.event);
  const liveTrackingDataPending = false;
  const publicAthleteVisibilityEnabled = useMemo(() => {
    const payload = (eventQuery.event?.raw ?? eventQuery.event) as
      Record<string, unknown> | undefined;
    if (!payload) return true;
    if (
      payload.state === "visibility-disabled" ||
      payload.source === "visibility_lock"
    )
      return false;
    if (
      payload.visibilityEnabled === false ||
      payload.publicAthleteVisibility === false
    )
      return false;
    return true;
  }, [eventQuery.event]);
  const athleteInteractionsEnabled =
    resultsMode || (publicAthleteVisibilityEnabled && !liveTrackingDataPending);
  const {
    athletes: rawWatchlistAthletes,
    addAthlete,
    toggle: storeToggleWatchlist,
  } = useWatchlist(id, athleteRoster, eventScreen.pollingEnabled);
  type ScreenTrackedAthlete = SearchHit & {
    eventId?: string;
    providerUuid?: string;
    athleteUid?: string;
    bookingId?: string;
    contestId?: string;
    contestUuid?: string;
    providerContestUuid?: string;
    providerContestId?: string;
    ticketId?: string;
  };
  const [optimisticTrackedAthletes, setOptimisticTrackedAthletes] = useState<
    ScreenTrackedAthlete[]
  >([]);
  const watchlistAthletes = useMemo<ScreenTrackedAthlete[]>(() => {
    const rows = [
      ...optimisticTrackedAthletes,
      ...(rawWatchlistAthletes as ScreenTrackedAthlete[]),
    ].filter((athlete) =>
      isPublicTrackableAthlete(athlete as unknown as Record<string, unknown>),
    );
    return rows.reduce<ScreenTrackedAthlete[]>((unique, athlete) => {
      const existingIndex = unique.findIndex((existing) =>
        sameAthleteIdentity(existing, athlete),
      );
      if (existingIndex < 0) {
        unique.push(athlete);
        return unique;
      }
      const existing = unique[existingIndex];
      unique[existingIndex] = Object.fromEntries(
        Object.entries({ ...athlete, ...existing }).filter(
          ([, value]) => value !== undefined && value !== null && value !== "",
        ),
      ) as ScreenTrackedAthlete;
      return unique;
    }, []);
  }, [optimisticTrackedAthletes, rawWatchlistAthletes]);
  const toggleWatchlist = useCallback(
    (athleteId: string) => {
      setOptimisticTrackedAthletes((current) =>
        current.filter(
          (athlete) => athlete.id !== athleteId && athlete.bib !== athleteId,
        ),
      );
      storeToggleWatchlist(athleteId);
    },
    [storeToggleWatchlist],
  );

  const [search, setSearch] = useState("");
  const [resultsSearchOpen, setResultsSearchOpen] = useState(false);
  const debounced = useDebouncedValue(search, 150);
  const searchEnabled = debounced.trim().length > 0;
  const hasLocalSearchMatch = useMemo(() => {
    const query = normalizeSearchText(debounced);
    if (!query) return false;
    return athleteRoster.some((athlete) =>
      [
        athlete.name,
        athlete.displayName,
        athlete.fullName,
        athlete.bib,
        athlete.bibNumber,
      ].some((value) => normalizeSearchText(value).includes(query)),
    );
  }, [athleteRoster, debounced]);
  const athleteSearch = useAthleteSearch(
    id,
    debounced,
    "name" as AthleteSearchMode,
    eventScreen.queryEnabled &&
      searchEnabled &&
      athleteInteractionsEnabled &&
      !hasLocalSearchMatch,
    athleteDataSource,
  );
  const registeredAthleteBib = firstText(autoTrackAthlete?.bib);
  const registeredAthleteSearch = useAthleteSearch(
    id,
    registeredAthleteBib,
    "bib" as AthleteSearchMode,
    eventScreen.queryEnabled &&
      athleteInteractionsEnabled &&
      Boolean(registeredAthleteBib),
    athleteDataSource,
  );
  const verifiedAutoTrackAthlete = useMemo<SearchHit | null>(() => {
    if (!autoTrackAthlete || !registeredAthleteBib) return null;
    const expectedBib = normalizeBib(registeredAthleteBib);
    const match = (registeredAthleteSearch.data ?? []).find(
      (athlete) =>
        normalizeBib(athlete.bib) === expectedBib &&
        isPublicTrackableAthlete(athlete as unknown as Record<string, unknown>),
    );
    if (!match) return null;
    const verified = searchHitFromRaw(match);
    return {
      ...autoTrackAthlete,
      ...verified,
      id: verified.id || autoTrackAthlete.id,
      bookingId: autoTrackAthlete.bookingId || verified.bookingId,
      athleteUid: autoTrackAthlete.athleteUid || verified.athleteUid,
      name:
        verified.name && !verified.name.startsWith("Bib ")
          ? verified.name
          : autoTrackAthlete.name,
    };
  }, [autoTrackAthlete, registeredAthleteBib, registeredAthleteSearch.data]);
  const remoteSearchResults = useMemo(
    () =>
      mergeSearchResults(
        (athleteSearch.data ?? [])
          .filter((athlete) =>
            isPublicTrackableAthlete(
              athlete as unknown as Record<string, unknown>,
            ),
          )
          .map(searchHitFromRaw),
      ),
    [athleteSearch.data],
  );
  const localSearchResults = useMemo(() => {
    const query = normalizeSearchText(search);
    if (!query) return [];
    return athleteRoster
      .filter((athlete) =>
        [
          athlete.name,
          athlete.displayName,
          athlete.fullName,
          athlete.bib,
          athlete.bibNumber,
          athlete.contestName,
          athlete.category,
        ].some((value) => normalizeSearchText(value).includes(query)),
      )
      .slice(0, 12)
      .map(searchHitFromRaw);
  }, [athleteRoster, search]);
  const searchResults = useMemo(() => {
    return mergeSearchResults(localSearchResults, remoteSearchResults);
  }, [localSearchResults, remoteSearchResults]);

  const trackedForEvent = useMemo(() => {
    if (!athleteInteractionsEnabled) return [];
    const seen = new Set<string>();
    return watchlistAthletes.filter((athlete) => {
      if (athlete.eventId && athlete.eventId !== id) return false;
      const key = stableAthleteKey(athlete, id);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [id, athleteInteractionsEnabled, watchlistAthletes]);

  const trackedResultIndex = useCallback(
    (athlete: Partial<SearchHit>) =>
      trackedForEvent.findIndex((tracked) =>
        sameAthleteIdentity(tracked, athlete),
      ),
    [trackedForEvent],
  );
  const visibleSearchResults = useMemo(
    () => searchResults.filter((athlete) => trackedResultIndex(athlete) < 0),
    [searchResults, trackedResultIndex],
  );

  // Open map-first. Search and full athlete timing are mounted only when the
  // user opens the tracker panel, so a slow athlete endpoint cannot cover or
  // delay the cached course render.
  const [sheetMode, setSheetMode] = useState<SheetMode>("collapsed");
  const [selectedTrackedIndex, setSelectedTrackedIndex] = useState(0);
  const [selectedTrackedKey, setSelectedTrackedKey] = useState<string | null>(
    null,
  );
  const [compactCardDismissed, setCompactCardDismissed] = useState(false);
  const [athleteExpanded, setAthleteExpanded] = useState(false);
  const [elevationOpen, setElevationOpen] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [notificationEnablePending, setNotificationEnablePending] =
    useState(false);
  const [headerSettingsOpen, setHeaderSettingsOpen] = useState(false);
  const [mapType, setMapType] = useState<
    "standard" | "satellite" | "hybrid" | "terrain"
  >("standard");
  const [mapDimension, setMapDimension] = useState<"2d" | "3d">("2d");
  const [mapPreferences, setMapPreferences] = useState<MapLayerPreferences>({
    showRoute: true,
    showSplitPoints: true,
    showDistanceLabels: true,
    showAthleteLabels: true,
    showAidStations: true,
  });
  useEffect(() => {
    if (selectedTrackedKey) setCompactCardDismissed(false);
  }, [selectedTrackedKey]);
  useEffect(() => {
    let active = true;
    void trackedAthleteNotificationsEnabled().then((enabled) => {
      if (active) setNotificationsEnabled(enabled);
    });
    return () => {
      active = false;
    };
  }, []);
  const handleNotificationToggle = useCallback(async () => {
    if (notificationEnablePending) return;
    if (notificationsEnabled) {
      Alert.alert(
        "Notifications Enabled",
        "Live split and finish notifications are enabled for tracked athletes.",
      );
      return;
    }
    setNotificationEnablePending(true);
    try {
      const enabled = await enableTrackedAthleteNotifications();
      setNotificationsEnabled(enabled);
      if (!enabled) {
        Alert.alert(
          "Notifications Not Enabled",
          "Allow notifications in your device settings, then tap the bell again. Push notifications require a physical device and an internet connection.",
        );
      }
    } catch (error) {
      console.warn(
        "[push] enabling tracked-athlete notifications failed",
        error,
      );
      Alert.alert(
        "Notification Setup Failed",
        "The device could not be registered for push notifications. Please check your connection and try again.",
      );
    } finally {
      setNotificationEnablePending(false);
    }
  }, [notificationEnablePending, notificationsEnabled]);
  useEffect(() => {
    if (!selectedTrackedKey) return;
    const selectedIndex = trackedForEvent.findIndex(
      (athlete) => stableAthleteKey(athlete, id) === selectedTrackedKey,
    );
    if (selectedIndex >= 0) return;

    // The selected athlete was removed. Close its detail card and move the
    // selection to a real remaining row instead of rendering a stale query or
    // a placeholder watchlist ID as an athlete.
    const resetSelection = setTimeout(() => {
      setAthleteExpanded(false);
      if (trackedForEvent.length === 0) {
        setSelectedTrackedIndex(0);
        setSelectedTrackedKey(null);
        return;
      }
      const nextIndex = Math.min(
        selectedTrackedIndex,
        trackedForEvent.length - 1,
      );
      setSelectedTrackedIndex(nextIndex);
      setSelectedTrackedKey(stableAthleteKey(trackedForEvent[nextIndex], id));
    }, 0);
    return () => clearTimeout(resetSelection);
  }, [id, selectedTrackedIndex, selectedTrackedKey, trackedForEvent]);
  const requestedTrackedIndex = selectedTrackedKey
    ? trackedForEvent.findIndex(
        (athlete) => stableAthleteKey(athlete, id) === selectedTrackedKey,
      )
    : -1;
  const fullDetailIndex = trackedForEvent.length
    ? requestedTrackedIndex >= 0
      ? requestedTrackedIndex
      : Math.min(selectedTrackedIndex, trackedForEvent.length - 1)
    : 0;
  const mapAthlete =
    requestedTrackedIndex >= 0
      ? trackedForEvent[requestedTrackedIndex]
      : (verifiedAutoTrackAthlete ?? undefined);
  const geometryQuery = useCourseGeometry(id, eventQuery.event?.raw, true, {
    ticketId: mapAthlete?.ticketId,
    contestId:
      mapAthlete?.providerContestUuid ??
      mapAthlete?.contestUuid ??
      mapAthlete?.contestId,
    contestName: mapAthlete?.category,
  });
  const courseMap = useMemo(
    () =>
      mapCourseMap(
        courseQuery.data?.courseIndex,
        geometryQuery.data ?? undefined,
        mapAthlete
          ? {
              id:
                mapAthlete.providerContestUuid ??
                mapAthlete.contestUuid ??
                mapAthlete.contestId,
              name: mapAthlete.category,
            }
          : undefined,
        courseQuery.data?.timingConfiguration,
      ),
    [courseQuery.data, geometryQuery.data, mapAthlete],
  );
  const hasElevationCourse = Boolean(
    courseMap?.legs.some((leg) => /bike|run/i.test(leg.segment)),
  );
  useEffect(() => {
    if (!hasElevationCourse) setElevationOpen(false);
  }, [hasElevationCourse]);

  const athleteQueries = useQueries({
    queries: trackedForEvent.map((athlete, index) => {
      const identity = athleteDetailIdentity(athlete);
      const isSelectedAthlete =
        selectedTrackedKey === stableAthleteKey(athlete, id);
      const lightweight = !resultsMode;
      const hasIdentity = Boolean(
        identity.bib ||
        identity.athleteUid ||
        identity.bookingId ||
        identity.providerUuid ||
        identity.email ||
        identity.participantUuid ||
        identity.providerAthleteUuid ||
        identity.providerTimingUuid ||
        identity.providerRecordId,
      );
      return {
        queryKey: queryKeys.athleteDetail(id, identity),
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          repositories.athlete.getDetail(
            id,
            identity,
            signal,
            resultsMode ? "results" : "live",
            lightweight ? "athleteOnly" : "full",
          ),
        enabled: Boolean(
          eventScreen.queryEnabled && athleteInteractionsEnabled && hasIdentity,
        ),
        placeholderData: {
          success: true,
          eventId: id,
          visibility: "PUBLIC" as const,
          liveTrackingVisibility: "PUBLIC" as const,
          athlete: {
            id: athlete.athleteUid || athlete.providerUuid || athlete.id,
            bib: athlete.bib,
            name: athlete.name,
            fullName: athlete.name,
            displayName: athlete.name,
            category: athlete.category,
            ageGroup: athlete.ageGroup,
            ageGroupName: athlete.ageGroup,
            contest: athlete.category,
            contestName: athlete.category,
            club: athlete.club,
            clubName: athlete.club,
            displayClub: athlete.club,
            photoURL: athlete.photoUrl ?? null,
            displayPhoto: athlete.photoUrl ?? null,
            profilePhotoUrl: athlete.photoUrl,
            visibility: "PUBLIC" as const,
            liveTrackingVisibility: "PUBLIC" as const,
            status: "NOT_STARTED",
            lifecycleLabel: "Loading live timing…",
            eventDate: athlete.raceDate,
          },
          contestContext: {
            contest: {
              providerContestUuid:
                athlete.providerContestUuid ??
                athlete.contestUuid ??
                athlete.contestId,
              contestUuid:
                athlete.contestUuid ??
                athlete.providerContestUuid ??
                athlete.contestId,
              name: athlete.category,
              contestName: athlete.category,
            },
          },
          timingConfiguration: courseQuery.data?.timingConfiguration,
        },
        staleTime: 0,
        gcTime: 10 * 60_000,
        refetchInterval: (query: { state: { data?: unknown } }) => {
          if (!eventScreen.pollingEnabled || resultsMode) return false;
          // A canonical finish is terminal timing evidence. Keep the frozen
          // snapshot in cache; shared leaderboard queries continue updating
          // provisional ranks without polling every finished athlete.
          if (hasCanonicalFinishEvidence(query.state.data)) return false;
          // Keep the athlete being viewed genuinely live. Other watchlist rows
          // remain current without making every marker issue a request and a
          // native animation every second.
          return isSelectedAthlete ? 1_000 : 5_000;
        },
        refetchIntervalInBackground: false,
        refetchOnMount: isSelectedAthlete ? "always" : false,
        refetchOnWindowFocus: isSelectedAthlete,
        refetchOnReconnect: true,
        // Polling should not redraw the native map merely because a request
        // entered/exited the fetching state. Render only when timing data or
        // its actionable error state actually changes.
        notifyOnChangeProps: ["data", "error", "isPlaceholderData"],
        structuralSharing: (current: unknown, incoming: unknown) =>
          preferFreshestAthleteResponse(current, incoming),
      };
    }),
  });

  const sharedRankingQuery = useQuery({
    queryKey: ["canonical-live-rankings", id, "overall"],
    queryFn: ({ signal }) =>
      repositories.canonicalTracking.getCanonicalLeaderboard(
        id,
        { mode: "overall", limit: 500 },
        signal,
      ),
    enabled: Boolean(
      eventScreen.pollingEnabled && !resultsMode && trackedForEvent.length > 0,
    ),
    staleTime: 5_000,
    refetchInterval:
      eventScreen.pollingEnabled && !resultsMode ? 10_000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
  });

  const watchedRows = useMemo<TrackedCard[]>(
    () =>
      trackedForEvent
        .map((athlete, index) => {
          const sourceHasData = Boolean(athleteQueries[index]?.data);
          const sourceIsPlaceholder = Boolean(
            athleteQueries[index]?.isPlaceholderData,
          );
          const timingUnavailable = isCanonicalBuildUnavailable(
            athleteQueries[index]?.error,
          );
          const response = athleteQueries[index]?.data;
          const rawDetail = response
            ? mapAthleteDetail(response)
            : trackedAthleteFallbackDetail(athlete, id);
          const ticket = resolveAthleteTicket(
            eventQuery.event,
            athlete,
            rawDetail.header.contest,
            response?.contestDefinition ?? response?.contestContext?.contest,
          );
          const scheduledStart = scheduledStartFromTicket(
            athlete as unknown as Record<string, unknown>,
            ticket ?? {},
          );
          const ticketName = firstText(
            ticket?.ticketName,
            ticket?.name,
            ticket?.contestName,
          );
          const ticketRaceCategory = firstText(
            ticket?.ticketCategory,
            ticket?.raceCategory,
            ticket?.category,
          );
          const baseDetail =
            scheduledStart || ticketName || ticketRaceCategory
              ? {
                  ...rawDetail,
                  header: {
                    ...rawDetail.header,
                    contest: ticketName || rawDetail.header.contest,
                    raceCategory:
                      ticketRaceCategory || rawDetail.header.raceCategory,
                    scheduledStart:
                      scheduledStart || rawDetail.header.scheduledStart,
                  },
                }
              : rawDetail;
          const canonicalRank = sharedRankingQuery.data?.data.entries.find(
            (entry) => {
              const participantUuid = String(
                entry.participantUuid ?? "",
              ).trim();
              const bib = String(entry.bib ?? "").trim();
              return (
                (participantUuid &&
                  participantUuid ===
                    String(athlete.participantUuid ?? "").trim()) ||
                (bib && bib === String(athlete.bib ?? "").trim())
              );
            },
          );
          const overallRank = Number(canonicalRank?.rank);
          const detail =
            Number.isFinite(overallRank) && overallRank > 0
              ? {
                  ...baseDetail,
                  rankings: baseDetail.rankings.map((row) =>
                    row.label.toLowerCase() === "overall"
                      ? { ...row, value: String(overallRank) }
                      : row,
                  ),
                  result: baseDetail.result
                    ? {
                        ...baseDetail.result,
                        ranks: baseDetail.result.ranks.map((row) =>
                          row.label.toLowerCase() === "overall"
                            ? { ...row, value: String(overallRank) }
                            : row,
                        ),
                      }
                    : baseDetail.result,
                }
              : baseDetail;
          return {
            athlete,
            initialLoading: Boolean(
              !timingUnavailable && (!sourceHasData || sourceIsPlaceholder),
            ),
            // Background polling is silent. A visible loading state is reserved
            // for the initial load or an explicit user refresh.
            refreshing: false,
            cutoffs: resolveAthleteCutoffs(eventQuery.event, athlete),
            raceCategory:
              firstText(
                ticket?.ticketCategory,
                ticket?.raceCategory,
                ticket?.category,
                detail.header.raceCategory,
              ) || undefined,
            timingUnavailable,
            detail,
          };
        })
        .sort(compareTrackedCardsByOfficialRaceState),
    [
      athleteQueries,
      eventQuery.event,
      id,
      trackedForEvent,
      sharedRankingQuery.data,
    ],
  );
  const previousFinishStateRef = useRef<Map<string, boolean>>(new Map());
  useEffect(() => {
    const previous = previousFinishStateRef.current;
    const next = new Map<string, boolean>();
    watchedRows.forEach((row, index) => {
      const key = stableAthleteKey(row.athlete, id);
      const finished = Boolean(
        row.detail?.result &&
        /finish|complete/i.test(row.detail.result.statusLabel),
      );
      next.set(key, finished);
      if (
        notificationsEnabled &&
        previous.has(key) &&
        previous.get(key) === false &&
        finished
      ) {
        const publicName = row.detail?.isAnonymous
          ? "Anonymous Athlete"
          : row.detail?.header.name || row.athlete.name;
        Alert.alert(
          `🏁 ${publicName} has finished!`,
          [
            `Finish Time: ${row.detail?.result?.officialTime || row.detail?.result?.chipTime || "—"}`,
            row.detail?.result?.ranks
              .map((rank) => `${rank.label}: #${rank.value}`)
              .join(" · "),
          ]
            .filter(Boolean)
            .join("\n"),
          row.detail?.isAnonymous
            ? [{ text: "Close", style: "cancel" }]
            : [
                {
                  text: "View Result",
                  onPress: () => {
                    setSelectedTrackedIndex(index);
                    setSelectedTrackedKey(key);
                    setAthleteExpanded(true);
                    setSheetMode("full");
                  },
                },
                { text: "Close", style: "cancel" },
              ],
        );
      }
    });
    previousFinishStateRef.current = next;
  }, [id, notificationsEnabled, watchedRows]);
  const alreadyTrackedMatch = useMemo(() => {
    if (!searchEnabled) return null;
    const query = normalizeSearchText(debounced);
    if (!query) return null;
    const index = watchedRows.findIndex(({ athlete, detail }) =>
      [
        athlete.name,
        athlete.bib,
        detail?.header.name,
        detail?.header.bib,
        detail?.header.contest,
      ]
        .filter(Boolean)
        .some((value) => normalizeSearchText(value).includes(query)),
    );
    if (index < 0) return null;
    return { index, athlete: watchedRows[index].athlete };
  }, [debounced, searchEnabled, watchedRows]);
  const autoTrackKeyRef = useRef<string | null>(null);

  const cutoffSummary = useMemo(
    () =>
      formatCutoffSummary(
        eventQuery.event?.cutoffMinutes,
        eventQuery.event?.cutoffs,
      ),
    [eventQuery.event?.cutoffMinutes, eventQuery.event?.cutoffs],
  );

  const toggleMapPreference = useCallback((key: keyof MapLayerPreferences) => {
    setMapPreferences((current) => ({ ...current, [key]: !current[key] }));
  }, []);
  useEffect(() => {
    if (!liveTrackingResolved || athleteInteractionsEnabled) return;
    const resetTimer = setTimeout(() => {
      setSearch("");
      setSelectedTrackedIndex(0);
      setSelectedTrackedKey(null);
      setAthleteExpanded(false);
      setElevationOpen(false);
      setSheetMode("full");
    }, 0);
    return () => clearTimeout(resetTimer);
  }, [athleteInteractionsEnabled, liveTrackingResolved]);
  const focusAthleteOnMap = useCallback(
    (index: number) => {
      if (!watchedRows.length) return;
      setSelectedTrackedIndex(
        Math.max(0, Math.min(index, watchedRows.length - 1)),
      );
      setSelectedTrackedKey(
        stableAthleteKey(
          watchedRows[Math.max(0, Math.min(index, watchedRows.length - 1))]
            .athlete,
          id,
        ),
      );
      setAthleteExpanded(false);
      setElevationOpen(false);
      // Map focus is the primary tracking experience. Collapse the athlete
      // sheet completely so the selected marker and nearby course geometry
      // use the full viewport; the compact Track launcher restores details.
      setSheetMode("collapsed");
    },
    [id, watchedRows],
  );

  const selectTrackedAthlete = useCallback(
    (index: number) => {
      if (!watchedRows.length) return;
      const bounded = Math.max(0, Math.min(index, watchedRows.length - 1));
      setSelectedTrackedIndex(bounded);
      setSelectedTrackedKey(stableAthleteKey(watchedRows[bounded].athlete, id));
      setElevationOpen(false);
    },
    [id, watchedRows],
  );

  const keyedSelectedIndex = selectedTrackedKey
    ? watchedRows.findIndex(
        (row) => stableAthleteKey(row.athlete, id) === selectedTrackedKey,
      )
    : -1;
  const safeSelectedTrackedIndex = watchedRows.length
    ? keyedSelectedIndex >= 0
      ? keyedSelectedIndex
      : Math.min(selectedTrackedIndex, watchedRows.length - 1)
    : 0;
  const selectedTrackedRow = watchedRows[safeSelectedTrackedIndex];
  const { clockSec: liveMapClockSec } = useRaceClock({
    mode: "live",
    focused: eventScreen.pollingEnabled,
    liveTickMs: 5_000,
  });
  const trackAnchorClocksRef = useRef(
    new Map<string, { fingerprint: string; clockSec: number }>(),
  );
  const selectedAthleteRefetch =
    requestedTrackedIndex >= 0
      ? athleteQueries[requestedTrackedIndex]?.refetch
      : undefined;
  const focusRefreshQueries = useMemo(() => {
    const queries: Array<{ refetch: () => unknown }> = [
      { refetch: () => eventQuery.refetch() },
    ];
    if (selectedAthleteRefetch) {
      queries.push({ refetch: () => selectedAthleteRefetch() });
    }
    return queries;
  }, [eventQuery.refetch, selectedAthleteRefetch]);
  useEventScreenFocusRefresh(id, focusRefreshQueries);
  const headerTitle = eventQuery.event?.name || "Live Tracking";
  const scheduledRaceToday = scheduledRaceFamilyToday(
    eventQuery.event?.disciplineSchedule,
  );
  const raceScheduledToday = hasRaceScheduledToday(
    eventQuery.event?.disciplineSchedule,
  );
  const selectedTicketToday = selectedTrackedRow
    ? resolveAthleteTicket(
        eventQuery.event,
        selectedTrackedRow.athlete,
        selectedTrackedRow.detail?.header.contest,
      )
    : undefined;
  const activeContestToday = [
    selectedTrackedRow?.detail?.header.contest,
    selectedTicketToday?.ticketName,
    selectedTicketToday?.name,
    selectedTicketToday?.contestName,
    watchedRows[0]?.detail?.header.contest,
    selectedTrackedRow?.athlete.category,
    watchedRows[0]?.athlete.category,
  ]
    .map((value) => firstText(value))
    .find((value) => value && !isAgeGroupLabel(value));
  const statusBannerLabel =
    (scheduledRaceToday || raceScheduledToday) && !resultsMode
      ? `${activeContestToday || scheduledRaceToday || "RACE"} · LIVE TODAY`
      : eventStatusLabel(
          resultsMode &&
            (eventQuery.event?.raw?.resultsPublished === true ||
              eventQuery.event?.raw?.officialResultsPublished === true ||
              String(eventQuery.event?.raw?.resultState || "").toUpperCase() ===
                "PUBLISHED")
            ? "results"
            : resultsMode
              ? "finished"
              : canonicalLiveEnabled
                ? "live"
                : eventQuery.event?.status,
          watchedRows.length,
        );

  const mapAthletes = useMemo<TrackAthlete[]>(() => {
    if (
      !courseMap?.hasGeometry ||
      !courseMap.bounds ||
      courseMap.mergedPath.length < 2
    )
      return [];
    const cumPath = buildCumulativePath(courseMap.mergedPath);
    const legPaths = courseMap.legs
      .filter((leg) => leg.path.length > 1)
      .map((leg) => ({ leg, path: buildCumulativePath(leg.path) }));
    const mappedCourseMeters = legPaths.reduce(
      (total, entry) => total + entry.path.totalMeters,
      0,
    );
    const positionOnConfiguredCourse = (
      distanceKm: number,
      totalKm: number,
    ) => {
      if (!(mappedCourseMeters > 0) || !(totalKm > 0)) return undefined;
      let remainingMeters =
        Math.min(1, Math.max(0, distanceKm / totalKm)) * mappedCourseMeters;
      for (const entry of legPaths) {
        if (remainingMeters <= entry.path.totalMeters) {
          return positionAtFraction(
            entry.path,
            entry.path.totalMeters > 0
              ? remainingMeters / entry.path.totalMeters
              : 0,
          );
        }
        remainingMeters -= entry.path.totalMeters;
      }
      const finalPath = legPaths.at(-1)?.path;
      return finalPath ? positionAtFraction(finalPath, 1) : undefined;
    };
    const positionOnCurrentLeg = (
      detail: AthleteDetailViewModel | undefined,
      estimatedCourseDistanceKm: number,
    ) => {
      const legKey = String(detail?.track?.currentLeg || "").toLowerCase();
      const legTotal = Number(detail?.track?.currentLegDistanceKm);
      if (!legKey || !(legTotal > 0) || !detail?.track) return undefined;
      const configuredLegStartKm = Math.max(
        0,
        detail.track.seed.nextKm - legTotal,
      );
      const canonicalLegDistance = Number(detail.track.estimatedLegDistanceKm);
      const legDistance = Math.max(
        Number.isFinite(canonicalLegDistance) ? canonicalLegDistance : 0,
        estimatedCourseDistanceKm - configuredLegStartKm,
      );
      const entry = legPaths.find(({ leg }) => {
        const segment = String(leg.segment || "").toLowerCase();
        return (
          segment === legKey ||
          segment.includes(legKey) ||
          legKey.includes(segment)
        );
      });
      return entry
        ? positionAtFraction(
            entry.path,
            Math.min(1, Math.max(0, legDistance / legTotal)),
          )
        : undefined;
    };
    // The ref-backed cache intentionally persists split fingerprints between
    // renders so each new official timing read resets interpolation once.
    return watchedRows.flatMap(({ athlete, detail }) => {
      const stableId = stableAthleteKey(athlete, id);
      const isFinished =
        detail?.header.status === "finished" ||
        /finish|complete/i.test(detail?.result?.statusLabel ?? "");
      const isPending = !Boolean(
        isFinished || detail?.liveLocation || detail?.track,
      );
      const resolvedPhoto = resolveAthletePhoto(
        {
          email: detail?.header.email ?? athlete.email,
          athleteUid: detail?.header.athleteUid ?? athlete.athleteUid,
          photoUrl: detail?.header.photo ?? athlete.photoUrl,
        },
        null,
      );
      let progressFraction = isFinished ? 1 : 0;
      let estimatedCourseDistanceKm = isFinished
        ? Number(detail?.track?.totalKm || 0)
        : 0;
      if (detail?.track) {
        const fingerprint = [
          detail.track.seed.anchorKm,
          detail.track.seed.anchorTimeSec,
          detail.track.seed.nextKm,
          detail.track.seed.paceSecPerKm,
        ].join(":");
        const previous = trackAnchorClocksRef.current.get(stableId);
        if (!previous || previous.fingerprint !== fingerprint) {
          trackAnchorClocksRef.current.set(stableId, {
            fingerprint,
            clockSec: liveMapClockSec,
          });
        }
        const anchorClock =
          trackAnchorClocksRef.current.get(stableId)?.clockSec ??
          liveMapClockSec;
        const elapsedSinceRead = Math.max(0, liveMapClockSec - anchorClock);
        const latestOfficialKm = detail.track.keyframes.reduce(
          (max, keyframe) => Math.max(max, keyframe.distanceKm),
          detail.track.seed.anchorKm,
        );
        const distanceKm = isFinished
          ? detail.track.totalKm
          : resultsMode
            ? latestOfficialKm
            : estimatedDistanceKm(detail.track.seed, elapsedSinceRead);
        estimatedCourseDistanceKm = distanceKm;
        progressFraction = distanceToFraction(distanceKm, detail.track.totalKm);
      }
      const directGpsPosition =
        !resultsMode && detail?.liveLocationSource === "GPS"
          ? detail.liveLocation
          : undefined;
      const position =
        directGpsPosition ??
        positionOnCurrentLeg(detail, estimatedCourseDistanceKm) ??
        positionOnConfiguredCourse(
          estimatedCourseDistanceKm,
          Number(detail?.track?.totalKm || 0),
        ) ??
        positionAtFraction(cumPath, progressFraction) ??
        cumPath.points[0];
      if (!position) return [];
      return [
        {
          id: stableId,
          position,
          name: detail?.header.name ?? athlete.name,
          bib: detail?.header.bib ?? athlete.bib,
          photoUrl: resolvedPhoto ?? detail?.header.photo ?? athlete.photoUrl,
          colorSeed: detail?.header.colorSeed ?? athlete.id,
          selected: selectedTrackedKey === stableId,
          isPending,
          progressFraction,
          status: detail?.header.status,
          currentLeg: detail?.raceProgress?.legLabel,
          estimatedDistanceKm: estimatedCourseDistanceKm,
          totalDistanceKm: detail?.track?.totalKm,
          lastOfficialLabel: detail?.track
            ? `${detail.track.seed.anchorKm.toFixed(1)} km`
            : undefined,
          nextCheckpointLabel: detail?.nextSplit?.checkpoint,
          awaitingCheckpointConfirmation: Boolean(
            detail?.track &&
            !isFinished &&
            detail.track.seed.nextKm > detail.track.seed.anchorKm &&
            progressFraction >=
              distanceToFraction(
                detail.track.seed.nextKm,
                detail.track.totalKm,
              ) -
                0.0001,
          ),
        },
      ];
    });
  }, [
    courseMap,
    id,
    liveMapClockSec,
    resultsMode,
    selectedTrackedKey,
    watchedRows,
  ]);
  const selectedMapAthlete =
    mapAthletes.find((athlete) => athlete.selected) ?? null;
  const elevationAthlete = useMemo<ElevationAthleteMarker | null>(() => {
    const detail = selectedTrackedRow?.detail;
    if (!detail?.track || !selectedMapAthlete) return null;
    const sportSections = (detail.raceTiming?.sections ?? []).filter(
      (candidate) =>
        candidate.type === "leg" &&
        /bike|run/i.test(
          firstText(candidate.legType, candidate.id, candidate.title),
        ),
    );
    const section =
      sportSections.find((candidate) => candidate.status === "in_progress") ??
      [...sportSections]
        .reverse()
        .find((candidate) => candidate.status === "completed");
    if (!section) return null;
    const routeIdentity = firstText(section.legType, section.id, section.title);
    const routeSegment = /bike/i.test(routeIdentity)
      ? "bike"
      : /run\s*2|run2/i.test(routeIdentity)
        ? "run2"
        : /run\s*1|run1/i.test(routeIdentity)
          ? "run1"
          : "run";
    const configuredDistances = section.rows
      .map((row) => row.cumulativeDistanceKm)
      .filter(
        (distance): distance is number =>
          typeof distance === "number" && Number.isFinite(distance),
      );
    if (configuredDistances.length === 0) return null;
    const legStartKm = Math.min(...configuredDistances);
    return {
      routeSegment,
      // Both map and elevation use the same continuously interpolated course
      // distance. Shared zero-distance boundaries still stop at the mat.
      distanceKm: Math.max(
        0,
        Math.min(
          Number(detail.track.currentLegDistanceKm) || Number.POSITIVE_INFINITY,
          Number(selectedMapAthlete.estimatedDistanceKm || 0) - legStartKm,
        ),
      ),
      label: getInitials(detail.header.name ?? selectedTrackedRow.athlete.name),
      color: "#E11D48",
    };
  }, [selectedMapAthlete, selectedTrackedRow]);
  useEffect(() => {
    // Route params can outlive a Feibot event replacement and may point at an
    // old or newly-anonymous participant. Only auto-track after the active
    // canonical search endpoint verifies the bib and public visibility.
    const routedAthlete = verifiedAutoTrackAthlete;
    if (!routedAthlete || !id || !athleteInteractionsEnabled) return;
    const key = stableAthleteKey(routedAthlete, id);
    if (!key || autoTrackKeyRef.current === key) return;
    const existingIndex = watchedRows.findIndex((row) =>
      sameAthleteIdentity(row.athlete, routedAthlete),
    );
    autoTrackKeyRef.current = key;
    const timeout = setTimeout(() => {
      if (existingIndex >= 0) {
        const existingKey = stableAthleteKey(
          watchedRows[existingIndex].athlete,
          id,
        );
        setSelectedTrackedIndex(existingIndex);
        setSelectedTrackedKey(existingKey);
        setSearch("");
        setElevationOpen(false);
        setAthleteExpanded(false);
        setSheetMode("collapsed");
        return;
      }
      addAthlete({
        ...routedAthlete,
        eventId: id,
      });
      setSelectedTrackedIndex(watchedRows.length);
      setSelectedTrackedKey(key);
      setSearch("");
      setElevationOpen(false);
      setAthleteExpanded(false);
      setSheetMode("collapsed");
    }, 0);
    return () => clearTimeout(timeout);
  }, [
    addAthlete,
    athleteInteractionsEnabled,
    id,
    verifiedAutoTrackAthlete,
    watchedRows,
  ]);

  const panelVisible = sheetMode !== "collapsed";
  const showPanel = panelVisible && !elevationOpen;
  const hasExpandedAthlete = athleteExpanded && Boolean(selectedTrackedRow);
  const showAthleteSearch =
    sheetMode === "full" &&
    (resultsMode ? resultsSearchOpen : !hasExpandedAthlete);
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      edges={["top", "left", "right"]}
    >
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <View style={{ flex: 1 }}>
          <CourseMapView
            map={courseMap}
            loading={courseQuery.isLoading || geometryQuery.isLoading}
            athletes={mapAthletes}
            cutoffMinutes={eventQuery.event?.cutoffMinutes}
            cutoffs={eventQuery.event?.cutoffs}
            fullBleed
            refreshError={
              courseQuery.isError ||
              geometryQuery.isError ||
              courseQuery.isRefetchError ||
              geometryQuery.isRefetchError
            }
            onRetry={() => {
              void courseQuery.refetch();
              void geometryQuery.refetch();
            }}
            controlsOffsetTop={154}
            controlsOffsetRight={12}
            mapPreferences={mapPreferences}
            showMapControls={false}
            mapType={mapType}
            onMapTypeChange={setMapType}
            mapDimension={mapDimension}
            onMapDimensionChange={setMapDimension}
            followSelectedAthlete
            onAthletePress={(athlete) => {
              const index = watchedRows.findIndex(
                (row) => stableAthleteKey(row.athlete, id) === athlete.id,
              );
              if (index >= 0) selectTrackedAthlete(index);
            }}
          />
          <CourseMapHeader
            title={headerTitle}
            notificationsEnabled={notificationsEnabled}
            settingsOpen={headerSettingsOpen}
            onToggleNotifications={() => void handleNotificationToggle()}
            onToggleSettings={() => setHeaderSettingsOpen((value) => !value)}
          />
          <EventStatusBanner label={statusBannerLabel} />
          {headerSettingsOpen ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close map settings"
              onPress={() => setHeaderSettingsOpen(false)}
              style={StyleSheet.absoluteFill}
            />
          ) : null}
          {headerSettingsOpen ? (
            <Card
              style={{
                position: "absolute",
                right: 12,
                top: 76,
                zIndex: 42,
                elevation: 42,
                width: 214,
                gap: 8,
                padding: 10,
                backgroundColor: "rgba(255,255,255,0.94)",
                borderColor: "rgba(15,23,42,0.1)",
              }}
            >
              <Text
                variant="caption"
                color="textMuted"
                style={{ fontWeight: "900", letterSpacing: 0.5 }}
              >
                MAP SETTINGS
              </Text>
              <MapSettingsToggle
                label="Course Route"
                value={mapPreferences.showRoute}
                onPress={() => toggleMapPreference("showRoute")}
              />
              <MapSettingsToggle
                label="Split Points"
                value={mapPreferences.showSplitPoints}
                onPress={() => toggleMapPreference("showSplitPoints")}
              />
              <MapSettingsToggle
                label="KM Markers"
                value={mapPreferences.showDistanceLabels}
                onPress={() => toggleMapPreference("showDistanceLabels")}
              />
              <MapSettingsToggle
                label="Athlete Labels"
                value={mapPreferences.showAthleteLabels}
                onPress={() => toggleMapPreference("showAthleteLabels")}
              />
              <MapSettingsToggle
                label={`Map Dimension · ${mapDimension === "3d" ? "3D" : "2D"}`}
                value={mapDimension === "3d"}
                onPress={() =>
                  setMapDimension((current) => (current === "3d" ? "2d" : "3d"))
                }
              />
              <View
                style={{
                  height: 1,
                  backgroundColor: "rgba(15,23,42,0.08)",
                  marginVertical: 2,
                }}
              />
              <Text
                variant="caption"
                color="textMuted"
                style={{ fontWeight: "900", letterSpacing: 0.4 }}
              >
                MAP STYLE
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {(["standard", "satellite", "hybrid", "terrain"] as const).map(
                  (option) => (
                    <Pressable
                      key={option}
                      accessibilityRole="button"
                      accessibilityState={{ selected: mapType === option }}
                      onPress={() => setMapType(option)}
                      style={{
                        paddingHorizontal: 9,
                        paddingVertical: 7,
                        borderRadius: 999,
                        borderWidth: 1,
                        borderColor:
                          mapType === option
                            ? theme.colors.accent
                            : theme.colors.border,
                        backgroundColor:
                          mapType === option
                            ? `${theme.colors.accent}16`
                            : theme.colors.surfaceSunken,
                      }}
                    >
                      <Text
                        variant="caption"
                        style={{
                          color: theme.colors.textPrimary,
                          fontWeight: "800",
                          textTransform: "capitalize",
                        }}
                      >
                        {option}
                      </Text>
                    </Pressable>
                  ),
                )}
              </View>
              {hasElevationCourse ? (
                <Button
                  label="Elevation"
                  size="sm"
                  variant={elevationOpen ? "primary" : "secondary"}
                  onPress={() => {
                    setElevationOpen((current) => !current);
                    setSheetMode("collapsed");
                    setHeaderSettingsOpen(false);
                  }}
                />
              ) : null}
            </Card>
          ) : null}
          {elevationOpen && hasElevationCourse ? (
            <ElevationProfilePanel
              geometry={geometryQuery.data}
              loading={geometryQuery.isLoading}
              error={geometryQuery.isError}
              athlete={elevationAthlete}
              onRetry={() => void geometryQuery.refetch()}
              onClose={() => setElevationOpen(false)}
            />
          ) : null}
        </View>

        <BottomSheet
          inline
          visible={showPanel}
          onClose={() => setSheetMode("collapsed")}
          height={sheetHeightFor(sheetMode)}
        >
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{
              gap: theme.spacing.md,
              paddingTop: 2,
              paddingBottom: Math.max(theme.spacing.lg, 24),
            }}
            nestedScrollEnabled
            scrollEnabled
            keyboardDismissMode="on-drag"
            scrollEventThrottle={16}
            overScrollMode="always"
            removeClippedSubviews={false}
            keyboardShouldPersistTaps="always"
            showsVerticalScrollIndicator
          >
            <View style={{ gap: theme.spacing.xs }}>
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text
                    variant="headline"
                    style={{ color: theme.colors.textPrimary }}
                  >
                    {resultsMode ? "Official Results" : "Live Athletes"}
                  </Text>
                  <Text variant="caption" color="textMuted" numberOfLines={1}>
                    {resultsMode
                      ? "Search uploaded finish and split results"
                      : "Positions are estimated between official timing points"}
                  </Text>
                </View>
                <View
                  style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
                >
                  {resultsMode && !resultsSearchOpen ? (
                    <Button
                      label="Search"
                      size="sm"
                      variant="secondary"
                      onPress={() => setResultsSearchOpen(true)}
                    />
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Close tracker panel"
                    onPress={() => {
                      setAthleteExpanded(false);
                      setSelectedTrackedIndex(0);
                      setSelectedTrackedKey(
                        watchedRows[0]
                          ? stableAthleteKey(watchedRows[0].athlete, id)
                          : null,
                      );
                      setSheetMode("collapsed");
                    }}
                    hitSlop={6}
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 15,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: "#F4F8FF",
                      borderWidth: 1,
                      borderColor: "rgba(46,116,214,0.18)",
                      shadowColor: "#2E74D6",
                      shadowOpacity: 0.12,
                      shadowRadius: 6,
                      shadowOffset: { width: 0, height: 2 },
                      elevation: 1,
                    }}
                  >
                    <Text
                      variant="headline"
                      style={{ color: "#E1122A", lineHeight: 18, fontSize: 16 }}
                    >
                      ×
                    </Text>
                  </Pressable>
                </View>
              </View>
            </View>

            {showAthleteSearch ? (
              <Card
                style={{
                  gap: theme.spacing.xs,
                  padding: theme.spacing.sm,
                  backgroundColor: "#F7FAFF",
                  borderColor: "rgba(46,116,214,0.18)",
                  shadowOpacity: 0.06,
                }}
              >
                <SearchBar
                  value={search}
                  onChangeText={(value) => {
                    setSearch(value);
                    setElevationOpen(false);
                    if (value.trim().length > 0 && sheetMode !== "full")
                      setSheetMode("full");
                  }}
                  onClear={() => setSearch("")}
                  placeholder={
                    resultsMode
                      ? "Search official results by name or bib"
                      : "Search athlete by name or bib"
                  }
                  dense
                />
                {resultsMode ? (
                  <Button
                    label="Close Search"
                    size="sm"
                    variant="ghost"
                    onPress={() => {
                      setSearch("");
                      setResultsSearchOpen(false);
                    }}
                  />
                ) : null}
              </Card>
            ) : null}

            {!resultsMode &&
            liveTrackingResolved &&
            !publicAthleteVisibilityEnabled ? (
              <EmptyState
                title="Live tracking unavailable"
                description="Athlete tracking is currently unavailable."
              />
            ) : liveTrackingResolved && liveTrackingDataPending ? (
              <EmptyState
                title="Live tracking is being prepared"
                description="Athlete data is yet to be mapped. Please check again later."
              />
            ) : showAthleteSearch && searchEnabled ? (
              <View style={{ gap: theme.spacing.sm }}>
                <View style={{ minHeight: 96, gap: theme.spacing.sm }}>
                  {athleteSearch.isFetching ? (
                    <Text variant="bodySmall" color="textMuted">
                      Searching...
                    </Text>
                  ) : null}
                  {visibleSearchResults.length > 0 ? (
                    visibleSearchResults.slice(0, 8).map((athlete) => {
                      const watchedIndex = trackedResultIndex(athlete);
                      const watched = watchedIndex >= 0;
                      const resolvedPhoto = resolveAthletePhoto(
                        {
                          email: athlete.email,
                          athleteUid: athlete.athleteUid,
                          photoUrl: athlete.photoUrl,
                        },
                        null,
                      );
                      return (
                        <SearchResultCard
                          key={stableAthleteKey(athlete, id)}
                          athlete={athlete}
                          isTracked={watched}
                          photoUrl={resolvedPhoto}
                          resultsMode={resultsMode}
                          onPress={() => {
                            if (watched) {
                              const existingIndex = watchedRows.findIndex(
                                (row) =>
                                  sameAthleteIdentity(row.athlete, athlete),
                              );
                              if (existingIndex >= 0) {
                                setSelectedTrackedIndex(existingIndex);
                                setSelectedTrackedKey(
                                  stableAthleteKey(
                                    watchedRows[existingIndex].athlete,
                                    id,
                                  ),
                                );
                              }
                              setAthleteExpanded(false);
                              setSearch("");
                              setResultsSearchOpen(false);
                              setElevationOpen(false);
                              setSheetMode("collapsed");
                              return;
                            }
                            const trackedAthlete: ScreenTrackedAthlete = {
                              id: athlete.id,
                              bib: athlete.bib,
                              name: athlete.name,
                              eventId: id,
                              email: athlete.email,
                              category: athlete.category,
                              ageGroup: athlete.ageGroup,
                              club: athlete.club,
                              photoUrl: athlete.photoUrl,
                              providerUuid: athlete.providerUuid,
                              providerAthleteUuid: athlete.providerAthleteUuid,
                              providerTimingUuid: athlete.providerTimingUuid,
                              providerRecordId: athlete.providerRecordId,
                              participantUuid: athlete.participantUuid,
                              athleteUid: athlete.athleteUid,
                              bookingId: athlete.bookingId,
                              raceDate: athlete.raceDate,
                              contestId: athlete.contestId,
                              contestUuid: athlete.contestUuid,
                              providerContestUuid: athlete.providerContestUuid,
                              providerContestId: athlete.providerContestId,
                              ticketId: athlete.ticketId,
                              trackingVisibility: athlete.trackingVisibility,
                              liveTrackingPrivacy: athlete.liveTrackingPrivacy,
                              privacy: athlete.privacy,
                              liveTrackingVisibility:
                                athlete.liveTrackingVisibility,
                              searchVisible: athlete.searchVisible,
                              mapVisible: athlete.mapVisible,
                              modalVisible: athlete.modalVisible,
                              anonymous: athlete.anonymous,
                            };
                            setOptimisticTrackedAthletes((current) => {
                              const key = stableAthleteKey(trackedAthlete, id);
                              return current.some(
                                (row) => stableAthleteKey(row, id) === key,
                              )
                                ? current
                                : [trackedAthlete, ...current];
                            });
                            addAthlete(trackedAthlete);
                            setSelectedTrackedIndex(0);
                            setSelectedTrackedKey(
                              stableAthleteKey(athlete, id),
                            );
                            setAthleteExpanded(false);
                            setSearch("");
                            setResultsSearchOpen(false);
                            setElevationOpen(false);
                            setSheetMode("collapsed");
                          }}
                        />
                      );
                    })
                  ) : !athleteSearch.isFetching ? (
                    alreadyTrackedMatch ? (
                      <Card
                        style={{
                          gap: theme.spacing.sm,
                          borderRadius: theme.radius.xl,
                          borderWidth: 1,
                          borderColor: "rgba(46,116,214,0.18)",
                          backgroundColor: "#FFFFFF",
                        }}
                      >
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 12,
                          }}
                        >
                          <Avatar
                            name={alreadyTrackedMatch.athlete.name}
                            uri={resolveAthletePhoto(
                              {
                                email: alreadyTrackedMatch.athlete.email,
                                athleteUid:
                                  alreadyTrackedMatch.athlete.athleteUid,
                                photoUrl: alreadyTrackedMatch.athlete.photoUrl,
                              },
                              null,
                            )}
                            size={48}
                            bordered
                          />
                          <View style={{ flex: 1, gap: 2 }}>
                            <Text variant="headline" numberOfLines={1}>
                              {alreadyTrackedMatch.athlete.name}
                            </Text>
                            <Text
                              variant="bodySmall"
                              color="textMuted"
                              numberOfLines={1}
                            >
                              Bib {alreadyTrackedMatch.athlete.bib}
                              {alreadyTrackedMatch.athlete.club
                                ? ` · ${alreadyTrackedMatch.athlete.club}`
                                : ""}
                              {alreadyTrackedMatch.athlete.category
                                ? ` · ${alreadyTrackedMatch.athlete.category}`
                                : ""}
                            </Text>
                            <Text
                              variant="caption"
                              style={{
                                color: theme.colors.accentSecondary,
                                fontWeight: "800",
                              }}
                            >
                              Already watching · open from Active Track
                            </Text>
                          </View>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Untrack athlete"
                            onPress={(event) => {
                              event.stopPropagation();
                              toggleWatchlist(alreadyTrackedMatch.athlete.id);
                            }}
                            hitSlop={8}
                            style={{
                              paddingHorizontal: 10,
                              height: 30,
                              borderRadius: 999,
                              alignItems: "center",
                              justifyContent: "center",
                              backgroundColor: "rgba(46,116,214,0.10)",
                              borderWidth: 1,
                              borderColor: "rgba(46,116,214,0.20)",
                            }}
                          >
                            <Text
                              variant="caption"
                              style={{
                                color: theme.colors.accentSecondary,
                                fontWeight: "900",
                              }}
                            >
                              Untrack
                            </Text>
                          </Pressable>
                        </View>
                      </Card>
                    ) : athleteSearch.isError ? (
                      <ErrorState
                        title="Athlete search unavailable"
                        description="The athlete search took too long. Please try again."
                        onRetry={() => {
                          void athleteSearch.refetch();
                        }}
                      />
                    ) : (
                      <EmptyState
                        title="No athletes found"
                        description={`No athletes match “${debounced}”.`}
                      />
                    )
                  ) : null}
                </View>
              </View>
            ) : null}

            <View style={{ gap: theme.spacing.xs }}>
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text
                    variant="caption"
                    color="textMuted"
                    style={{ letterSpacing: 0.6, textTransform: "uppercase" }}
                  >
                    {resultsMode ? "Selected results" : "Active track"}
                  </Text>
                </View>
                {watchedRows.length > 0 ? (
                  <Badge
                    label={`${watchedRows.length} tracked`}
                    variant="live"
                  />
                ) : null}
              </View>
              {hasExpandedAthlete ? (
                <SelectedAthletePanel
                  row={selectedTrackedRow}
                  eventName={eventQuery.event?.name}
                  index={safeSelectedTrackedIndex}
                  total={watchedRows.length}
                  expanded
                  onPrevious={() => {
                    setElevationOpen(false);
                    const nextIndex = watchedRows.length
                      ? (safeSelectedTrackedIndex - 1 + watchedRows.length) %
                        watchedRows.length
                      : 0;
                    setSelectedTrackedIndex(nextIndex);
                    setSelectedTrackedKey(
                      watchedRows[nextIndex]
                        ? stableAthleteKey(watchedRows[nextIndex].athlete, id)
                        : null,
                    );
                  }}
                  onNext={() => {
                    setElevationOpen(false);
                    const nextIndex = watchedRows.length
                      ? (safeSelectedTrackedIndex + 1) % watchedRows.length
                      : 0;
                    setSelectedTrackedIndex(nextIndex);
                    setSelectedTrackedKey(
                      watchedRows[nextIndex]
                        ? stableAthleteKey(watchedRows[nextIndex].athlete, id)
                        : null,
                    );
                  }}
                  onExpand={() => {
                    setAthleteExpanded(false);
                    setSelectedTrackedIndex(0);
                    setSelectedTrackedKey(
                      watchedRows[0]
                        ? stableAthleteKey(watchedRows[0].athlete, id)
                        : null,
                    );
                    setSheetMode("collapsed");
                  }}
                  onViewMap={() => {
                    if (!athleteInteractionsEnabled) return;
                    focusAthleteOnMap(safeSelectedTrackedIndex);
                  }}
                  onRemove={() => {
                    if (!selectedTrackedRow) return;
                    toggleWatchlist(selectedTrackedRow.athlete.id);
                  }}
                />
              ) : watchedRows.length > 0 ? (
                <View style={{ gap: theme.spacing.sm }}>
                  {watchedRows.map((row, index) => (
                    <TrackedAthleteListCard
                      key={stableAthleteKey(row.athlete, String(index))}
                      row={row}
                      onOpen={() => {
                        setSelectedTrackedIndex(index);
                        setSelectedTrackedKey(
                          stableAthleteKey(row.athlete, id),
                        );
                        setAthleteExpanded(true);
                        setElevationOpen(false);
                        setSheetMode("full");
                      }}
                      onRemove={() => toggleWatchlist(row.athlete.id)}
                    />
                  ))}
                </View>
              ) : (
                <EmptyState
                  title={
                    resultsMode ? "No result selected" : "No athletes tracked"
                  }
                  description={
                    resultsMode
                      ? "Search the uploaded results and select an athlete to view their finish and splits."
                      : "Search for an athlete to start tracking."
                  }
                />
              )}
            </View>

            {hasExpandedAthlete && cutoffSummary.length > 0 ? (
              <Card
                style={{
                  gap: theme.spacing.xs,
                  backgroundColor: "#F7FAFF",
                  borderColor: "rgba(46,116,214,0.16)",
                }}
              >
                <Text variant="headline">Cutoff summary</Text>
                <View style={{ gap: 6 }}>
                  {cutoffSummary.map((line) => (
                    <Text key={line} variant="bodySmall" color="textSecondary">
                      {line}
                    </Text>
                  ))}
                </View>
              </Card>
            ) : null}
          </ScrollView>
        </BottomSheet>

        {sheetMode === "collapsed" &&
        selectedTrackedRow &&
        !compactCardDismissed ? (
          <CompactMapAthleteCard
            row={selectedTrackedRow}
            eventName={eventQuery.event?.name}
            onOpen={() => {
              setSelectedTrackedIndex(safeSelectedTrackedIndex);
              setSelectedTrackedKey(
                stableAthleteKey(selectedTrackedRow.athlete, id),
              );
              setAthleteExpanded(true);
              setElevationOpen(false);
              setHeaderSettingsOpen(false);
              setSheetMode("full");
            }}
            onClose={() => {
              setCompactCardDismissed(true);
              setSelectedTrackedKey(null);
              setAthleteExpanded(false);
            }}
          />
        ) : null}

        {sheetMode === "collapsed" ? (
          <FloatingLauncher
            count={watchedRows.length}
            top={112}
            onPress={() => {
              setAthleteExpanded(false);
              setElevationOpen(false);
              setHeaderSettingsOpen(false);
              setSheetMode("full");
            }}
          />
        ) : null}
      </View>
    </SafeAreaView>
  );
}

export default LiveTrackScreen;
