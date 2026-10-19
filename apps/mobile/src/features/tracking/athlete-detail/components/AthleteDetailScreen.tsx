import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Pressable,
  ScrollView,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useTheme } from "@/core/theme";
import { queryKeys } from "@/core/services/query/queryKeys";
import { markCanonicalParticipantRendered, useCanonicalChangeStream } from "@/features/tracking/hooks/useCanonicalChangeStream";
import type { ApiError } from "@/core/types";
import {
  EmptyState,
  ErrorState,
  Icon,
  LiveStatusPill,
  Avatar,
  Badge,
  Button,
  Card,
  ProgressBar,
  ReplayControls,
  Skeleton,
  Text,
  type ReplaySpeed,
} from "@/shared/components";
import {
  mapAthleteDetail,
  type AthleteTrack,
  type AthleteDetailViewModel,
  type AthleteHeaderView,
  type AthleteResultView,
  type MetricRow,
} from "@/features/tracking/mappers";
import {
  courseStageLabels,
  resolveCourseKind,
  type CourseKind,
} from "@/features/tracking/courseKind";
import {
  coursePathDistanceKm,
  mapCourseMap,
} from "@/features/tracking/course-map/mappers";
import { CourseMapView } from "@/features/tracking/course-map/components/CourseMapView";
import {
  useAthleteDetail,
  useCourseGeometry,
  useCourseMap,
} from "@/features/tracking/hooks";
import { useEvent } from "@/features/events/hooks/useEvents";
import { useEventTracking } from "@/features/events/hooks/useEventExperience";
import { safeRouteEventId } from "@/features/events/utils/eventRoute";
import { formatDuration } from "@/features/tracking/timing";
import { useSlowNetwork } from "@/shared/hooks";

import {
  CourseOverviewCard,
  CutoffCard,
  LiveMapCard,
  OfficialResultsCard,
  PredictionCard,
  RankingCard,
  SectionCard,
  TimelineCard,
} from "./cards";

function routeText(value: string | string[] | undefined): string {
  return safeRouteEventId(value) ?? "";
}

function metricValue(items: MetricRow[] | undefined, label: string): string {
  const found = items?.find(
    (item) => item.label.toLowerCase() === label.toLowerCase(),
  );
  return String(found?.value ?? "—");
}

function normalizedResultToken(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function positiveDistance(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

function durationSeconds(value: unknown): number | undefined {
  const parts = String(value ?? "")
    .trim()
    .split(":")
    .map(Number);
  if (
    (parts.length !== 2 && parts.length !== 3) ||
    parts.some((part) => !Number.isFinite(part))
  ) {
    return undefined;
  }
  const [hours, minutes, seconds] =
    parts.length === 3 ? parts : [0, parts[0], parts[1]];
  if (minutes < 0 || minutes >= 60 || seconds < 0 || seconds >= 60) {
    return undefined;
  }
  const total = hours * 3600 + minutes * 60 + seconds;
  return total > 0 ? total : undefined;
}

function compactPace(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainder = rounded % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function resultSplitMetric(
  label: string,
  value: string,
  ticket: Record<string, unknown>,
): string | undefined {
  const seconds = durationSeconds(value);
  if (!seconds) return undefined;
  const maps =
    ticket.courseMaps && typeof ticket.courseMaps === "object"
      ? (ticket.courseMaps as Record<string, unknown>)
      : ticket.courseMap && typeof ticket.courseMap === "object"
        ? (ticket.courseMap as Record<string, unknown>)
        : {};
  const key = normalizedResultToken(label).replace(/\s/g, "");
  const legs = Array.isArray(ticket.legs) ? ticket.legs.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object') : [];
  const configuredLeg = legs.find((leg) => {
    const type = normalizedResultToken(leg.type).replace(/\s/g, '');
    const name = normalizedResultToken(leg.name).replace(/\s/g, '');
    return Boolean((type && key.includes(type)) || (name && key.includes(name)));
  });
  if (
    key.includes("transition") ||
    key === "t1" ||
    key === "t2" ||
    key === "start" ||
    key.endsWith("start")
  ) {
    return undefined;
  }
  if (key.includes("swim")) {
    const distanceKm = positiveDistance(
      maps.swimDistance,
      maps.swim_distance,
      ticket.swimDistance,
      configuredLeg?.distanceKm,
    );
    return distanceKm
      ? `${compactPace(seconds / (distanceKm * 10))} /100m`
      : undefined;
  }
  if (key.includes("bike") || key.includes("cycle")) {
    const distanceKm = positiveDistance(
      maps.bikeDistance,
      maps.bike_distance,
      ticket.bikeDistance,
      configuredLeg?.distanceKm,
    );
    return distanceKm
      ? `${(distanceKm / (seconds / 3600)).toFixed(2)} km/h`
      : undefined;
  }
  if (key.includes("run")) {
    const numberedRun = key.includes("run1")
      ? positiveDistance(maps.run1Distance, ticket.run1Distance)
      : key.includes("run2")
        ? positiveDistance(maps.run2Distance, ticket.run2Distance)
        : undefined;
    const distanceKm =
      numberedRun ??
      positiveDistance(maps.runDistance, maps.run_distance, ticket.runDistance);
    const configuredDistance = positiveDistance(configuredLeg?.distanceKm);
    return distanceKm || configuredDistance ? `${compactPace(seconds / (distanceKm ?? configuredDistance!))} /km` : undefined;
  }
  return undefined;
}

function addUploadedResultPaces(
  result: AthleteResultView | undefined,
  tickets: Record<string, unknown>[] | null | undefined,
  athlete: Record<string, unknown>,
  contestName: string | undefined,
): AthleteResultView | undefined {
  if (!result || !tickets?.length)
    return result;
  const ticketId = String(athlete.ticketId ?? "").trim();
  const names = [
    athlete.ticketName,
    athlete.contestName,
    athlete.raceCategory,
    contestName,
    result.meta.find((item) => item.label === "Category")?.value,
  ]
    .map(normalizedResultToken)
    .filter(Boolean);
  const ticket = tickets.find((candidate) => {
    const candidateId = String(candidate.id ?? candidate.ticketId ?? "").trim();
    if (ticketId && candidateId === ticketId) return true;
    const candidateName = normalizedResultToken(
      candidate.ticketName ?? candidate.name ?? candidate.contestName,
    );
    return Boolean(candidateName && names.includes(candidateName));
  });
  if (!ticket) return result;
  const configuredSplits = Array.isArray(ticket.splits) ? ticket.splits.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object') : [];
  const configuredLegs = Array.isArray(ticket.legs) ? ticket.legs.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object') : [];
  const summedLegDistance = configuredLegs.reduce((total, leg) => total + (positiveDistance(leg.distanceKm) ?? 0), 0);
  const configuredDistance = positiveDistance(ticket.totalDistanceKm) ?? (summedLegDistance > 0 ? summedLegDistance : undefined);
  const officialSeconds = durationSeconds(result.officialTime || result.chipTime || result.gunTime);
  return {
    ...result,
    distanceKm: result.distanceKm ?? configuredDistance,
    averageSpeedKmh: result.averageSpeedKmh ?? (configuredDistance && officialSeconds ? configuredDistance / (officialSeconds / 3600) : undefined),
    splits: result.splits.map((split) => {
      const configured = configuredSplits.find((candidate) => normalizedResultToken(candidate.name) === normalizedResultToken(split.label));
      const distanceKm = split.distanceKm ?? positiveDistance(configured?.distanceKm);
      return {
        ...split,
        distanceKm,
        paceSpeed: split.paceSpeed || resultSplitMetric(split.label, split.segmentTime || split.value, ticket),
      };
    }),
  };
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

function TrackerHero({
  detail,
  minimized,
  onViewMap,
  onToggleMinimized,
}: {
  detail: AthleteDetailViewModel;
  minimized: boolean;
  onViewMap?: () => void;
  onToggleMinimized: () => void;
}) {
  const theme = useTheme();
  const header = displayHeader(detail);
  const status = detail.lifecycle.label ?? header.statusLabel ?? "Not Started";
  const meta = [header.gender, header.contest, header.location]
    .filter(Boolean)
    .join(" · ");

  return (
    <Card
      style={{
        gap: theme.spacing.md,
        borderRadius: theme.radius.xl,
        borderColor: "rgba(229, 9, 32, 0.24)",
        backgroundColor: theme.colors.surface,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: theme.spacing.md,
        }}
      >
        <Avatar name={header.name} uri={header.photo} size={64} bordered />
        <View style={{ flex: 1, gap: 4 }}>
          <Text variant="caption" color="accent" style={{ fontWeight: "900" }}>
            {header.contest || header.eventName || "RACE UPSHOT TRACKING"}
          </Text>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <Text variant="title" numberOfLines={2} style={{ flexShrink: 1 }}>
              {header.name}
            </Text>
            {header.countryFlag ? (
              <Text variant="headline">{header.countryFlag}</Text>
            ) : null}
          </View>
          <Text variant="bodySmall" color="textMuted" numberOfLines={2}>
            BIB: {header.bib || "—"}
            {meta ? ` · ${meta}` : ""}
          </Text>
        </View>
        <View style={{ alignItems: "flex-end", gap: 8 }}>
          {onViewMap ? (
            <Pressable
              accessibilityRole="button"
              onPress={onViewMap}
              hitSlop={8}
            >
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
              >
                <Icon name="map" color="accent" />
                <Text
                  variant="caption"
                  color="accent"
                  style={{ fontWeight: "900" }}
                >
                  Show on map
                </Text>
              </View>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={onToggleMinimized}
            hitSlop={8}
          >
            <Icon
              name={minimized ? "chevronDown" : "chevronRight"}
              color="textMuted"
            />
          </Pressable>
        </View>
      </View>

      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: theme.spacing.sm,
        }}
      >
        <Badge
          label={status}
          variant={
            header.status === "live"
              ? "live"
              : header.status === "finished"
                ? "finished"
                : "neutral"
          }
        />
        {header.category ? (
          <Badge label={`Age Group: ${header.category}`} variant="neutral" />
        ) : null}
        {header.club ? <Badge label={header.club} variant="success" /> : null}
      </View>

      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: theme.spacing.sm,
        }}
      >
        {[
          [
            "Current Leg",
            detail.livePosition
              ? metricValue(detail.livePosition.items, "Current Leg")
              : "Not Started",
          ],
          [
            "Current Split",
            detail.livePosition
              ? metricValue(detail.livePosition.items, "Current Split")
              : "—",
          ],
          [
            "Official Time",
            metricValue(detail.liveStats, "Official Race Time"),
          ],
          ["Athlete Time", metricValue(detail.liveStats, "Athlete Race Time")],
        ].map(([label, value]) => (
          <View
            key={label}
            style={{
              flexGrow: 1,
              flexBasis: "45%",
              minWidth: 132,
              padding: theme.spacing.sm,
              borderRadius: theme.radius.medium,
              backgroundColor: theme.colors.surfaceSunken,
              gap: 4,
            }}
          >
            <Text variant="caption" color="textMuted">
              {label.toUpperCase()}
            </Text>
            <Text variant="headline">{value}</Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

type ProgressStageState = "completed" | "current" | "future";
type ProgressStage = {
  label: string;
  value: string;
  state: ProgressStageState;
};
const DASH_TIME = "--:--";

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function normalized(value: unknown): string {
  return clean(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function isEmptyTime(value: unknown): boolean {
  const text = clean(value);
  return (
    !text ||
    text === "—" ||
    text === "-" ||
    text === DASH_TIME ||
    text === "--:--:--"
  );
}

function splitMatchesStage(
  label: string,
  split: AthleteDetailViewModel["timeline"][number],
): boolean {
  const target = normalized(label);
  const source = normalized(
    `${split.segment} ${split.splitLabel} ${split.name}`,
  );
  if (target === "RUN1")
    return (
      source.includes("RUN1") ||
      source.includes("RUNSTART") ||
      source.includes("FIRSTRUN")
    );
  if (target === "RUN2")
    return (
      source.includes("RUN2") ||
      source.includes("RUNFINISH") ||
      source.includes("SECONDRUN")
    );
  // The final FINISH stage is resolved contextually from the last configured
  // checkpoint in resolveProgressStages. A broad `includes("FINISH")` here
  // incorrectly promoted Swim Finish and Bike Finish to race completion.
  if (target === "FINISH") return false;
  if (target === "T1")
    return source.includes("T1") || source.includes("BIKESTART");
  if (target === "T2")
    return source.includes("T2") || source.includes("RUNSTART");
  return source.includes(target);
}

function resolveProgressCourseKind(detail: AthleteDetailViewModel): CourseKind {
  // Canonical leg sections are explicit course configuration, so they are
  // stronger evidence than incomplete ticket/category display metadata.
  const configuredLegs = (detail.raceTiming?.sections ?? [])
    .filter((section) => section.type === "leg")
    .map((section) =>
      normalized(`${section.legType} ${section.id} ${section.title}`),
    );
  const hasSwim = configuredLegs.some((leg) => leg.includes("SWIM"));
  const hasBike = configuredLegs.some(
    (leg) => leg.includes("BIKE") || leg.includes("CYCLE"),
  );
  const runLegs = configuredLegs.filter((leg) => leg.includes("RUN"));
  if (hasSwim && hasBike && runLegs.length > 0) return "triathlon";
  if (!hasSwim && hasBike && runLegs.length >= 2) return "duathlon";

  return resolveCourseKind(
    detail.header.raceCategory,
    detail.header.contest,
    detail.timeline.map((item) => `${item.segment} ${item.name}`).join(" "),
  );
}

function resolveProgressStages(
  detail: AthleteDetailViewModel,
): ProgressStage[] {
  const canonicalSections = detail.raceTiming?.sections ?? [];
  const finalCheckpoint = detail.timeline[detail.timeline.length - 1];
  const stages = courseStageLabels(resolveProgressCourseKind(detail)).map(
    (label) => {
      const matches =
        label === "FINISH"
          ? finalCheckpoint
            ? [finalCheckpoint]
            : []
          : detail.timeline.filter((split) => splitMatchesStage(label, split));
      const completed = matches.filter(
        (split) => split.state === "completed" || !isEmptyTime(split.timeLabel),
      );
      const current = matches.find((split) => split.state === "current");
      const lastCompleted = completed[completed.length - 1];
      const value =
        clean(lastCompleted?.timeLabel || current?.timeLabel) || DASH_TIME;
      const state: ProgressStageState = current
        ? "current"
        : lastCompleted
          ? "completed"
          : "future";
      const canonicalSection = canonicalSections.find((section) => {
        const sectionKey = normalized(
          `${section.shortLabel} ${section.legType} ${section.title}`,
        );
        const target = normalized(label);
        if (target === "T1" || target === "T2")
          return sectionKey.includes(target);
        return sectionKey.includes(target.replace(/\d+$/, ""));
      });
      if (canonicalSection) {
        const canonicalState: ProgressStageState =
          canonicalSection.status === "completed"
            ? "completed"
            : canonicalSection.status === "in_progress"
              ? "current"
              : "future";
        return {
          label,
          value: formatDuration(canonicalSection.durationSeconds),
          state: canonicalState,
        };
      }
      return { label, value: isEmptyTime(value) ? DASH_TIME : value, state };
    },
  );

  if (
    !stages.some((stage) => stage.state === "current") &&
    stages.some((stage) => stage.state === "future")
  ) {
    const nextIndex = stages.findIndex((stage) => stage.state === "future");
    if (nextIndex === 0)
      return [{ ...stages[0], state: "current" }, ...stages.slice(1)];
  }
  return stages;
}

function progressFromStages(
  stages: ProgressStage[],
  detail: AthleteDetailViewModel,
): number {
  if (detail.raceProgress) return detail.raceProgress.progress;
  if (stages.length === 0) return 0;
  const completed = stages.filter(
    (stage) => stage.state === "completed",
  ).length;
  const currentBonus = stages.some((stage) => stage.state === "current")
    ? 0.5
    : 0;
  return Math.min(1, (completed + currentBonus) / stages.length);
}

function stageGlyph(label: string): string {
  if (label.startsWith("SWIM")) return "S";
  if (label.startsWith("BIKE")) return "B";
  if (label.startsWith("RUN"))
    return label.endsWith("1") ? "R1" : label.endsWith("2") ? "R2" : "R";
  if (label.startsWith("T")) return label;
  return "F";
}

function markerLeft(progress: number): `${number}%` {
  return `${Math.max(0, Math.min(100, progress * 100))}%`;
}

function LegSplitStrip({ detail }: { detail: AthleteDetailViewModel }) {
  const theme = useTheme();
  const stages = resolveProgressStages(detail);
  const progressValue = progressFromStages(stages, detail);

  return (
    <Card style={{ gap: theme.spacing.md }}>
      <Text variant="label" color="accent" style={{ fontWeight: "900" }}>
        ATHLETE PROGRESS
      </Text>
      <View style={{ gap: theme.spacing.sm }}>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            gap: 4,
          }}
        >
          {stages.map((stage) => (
            <View
              key={stage.label}
              style={{ flex: 1, minWidth: 0, alignItems: "center" }}
            >
              <Text
                variant="caption"
                color={stage.state === "future" ? "textMuted" : "textPrimary"}
                style={{ fontWeight: "900" }}
                numberOfLines={1}
              >
                {stage.label}
              </Text>
            </View>
          ))}
        </View>

        <View
          style={{
            position: "relative",
            height: 44,
            justifyContent: "center",
            paddingHorizontal: 12,
          }}
        >
          <View
            style={{
              position: "absolute",
              left: 22,
              right: 22,
              top: 20,
              height: 4,
              borderRadius: 2,
              backgroundColor: theme.colors.border,
              overflow: "hidden",
            }}
          >
            <View
              style={{
                width: markerLeft(progressValue),
                height: 4,
                borderRadius: 2,
                backgroundColor: theme.colors.accent,
              }}
            />
          </View>
          <View
            style={{
              position: "absolute",
              left: markerLeft(progressValue),
              top: 8,
              width: 28,
              height: 28,
              marginLeft: -14,
              borderRadius: 14,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: theme.colors.accent,
              borderWidth: 3,
              borderColor: theme.colors.surfaceElevated,
              zIndex: 2,
            }}
          >
            <Text
              variant="caption"
              style={{ color: theme.colors.onAccent, fontWeight: "900" }}
            >
              A
            </Text>
          </View>
          <View
            style={{ flexDirection: "row", justifyContent: "space-between" }}
          >
            {stages.map((stage) => {
              const active = stage.state === "current";
              const completed = stage.state === "completed";
              const color =
                active || completed
                  ? theme.colors.accent
                  : theme.colors.textMuted;
              return (
                <View
                  key={`${stage.label}-node`}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: active
                      ? `${theme.colors.accent}22`
                      : theme.colors.surface,
                    borderWidth: 2,
                    borderColor:
                      active || completed
                        ? theme.colors.accent
                        : theme.colors.border,
                  }}
                >
                  <Text variant="caption" style={{ color, fontWeight: "900" }}>
                    {stageGlyph(stage.label)}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            gap: 4,
          }}
        >
          {stages.map((stage) => (
            <View
              key={`${stage.label}-time`}
              style={{ flex: 1, minWidth: 0, alignItems: "center" }}
            >
              <Text
                variant="caption"
                style={{ color: theme.colors.textPrimary, fontWeight: "900" }}
                numberOfLines={1}
              >
                {stage.value}
              </Text>
            </View>
          ))}
        </View>
      </View>
      <ProgressBar
        progress={progressValue}
        height={6}
        accessibilityLabel="Athlete race progress"
      />
    </Card>
  );
}

function RaceOverviewCard({ detail }: { detail: AthleteDetailViewModel }) {
  const theme = useTheme();
  const live = detail.livePosition?.items ?? [];
  const rows = [
    [
      "Race Status",
      detail.lifecycle.label ??
        detail.header.statusLabel ??
        "Waiting for Chip Start",
    ],
    ["Current Leg", metricValue(live, "Current Leg")],
    ["Current Split", metricValue(live, "Current Split")],
    ["Overall Rank", metricValue(detail.rankings, "Overall")],
    ["Category Rank", metricValue(detail.rankings, "Category")],
    ["Gender Rank", metricValue(detail.rankings, "Gender")],
    [
      "Estimated Finish",
      detail.prediction?.finishTimeLabel ??
        metricValue(live, "Estimated Finish"),
    ],
    ["Average Speed", metricValue(live, "Average Speed")],
    ["Average Pace", metricValue(live, "Average Pace")],
  ];

  return (
    <SectionCard title="Race Overview" titleColor="accent">
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: theme.spacing.sm,
        }}
      >
        {rows.map(([label, value]) => (
          <View
            key={label}
            style={{
              flexGrow: 1,
              flexBasis: "30%",
              minWidth: 120,
              padding: theme.spacing.sm,
              borderRadius: theme.radius.medium,
              backgroundColor: theme.colors.surfaceSunken,
              gap: 4,
            }}
          >
            <Text variant="caption" color="textMuted">
              {label}
            </Text>
            <Text variant="body" style={{ fontWeight: "700" }}>
              {value || "—"}
            </Text>
          </View>
        ))}
      </View>
    </SectionCard>
  );
}

function ProgressMiniCard({ detail }: { detail: AthleteDetailViewModel }) {
  const progress = detail.raceProgress;
  if (!progress) return null;
  return (
    <SectionCard title="Progress" titleColor="accentSecondary">
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text variant="label" color="textMuted">
          {progress.legLabel}
        </Text>
        <Text variant="label" color="accent">
          {progress.percentLabel}
        </Text>
      </View>
      <ProgressBar
        progress={progress.progress}
        accessibilityLabel="Race progress"
      />
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text variant="caption" color="textMuted">
          {progress.coveredLabel}
        </Text>
        <Text variant="caption" color="textMuted">
          {progress.remainingLabel}
        </Text>
      </View>
    </SectionCard>
  );
}

export function AthleteDetailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const scrollViewRef = useRef<ScrollView>(null);
  const mapSectionTop = useRef(0);
  const params = useLocalSearchParams<{
    bib: string;
    eventId: string;
    athleteUid?: string;
    email?: string;
    providerUuid?: string;
    providerAthleteUuid?: string;
    providerTimingUuid?: string;
    participantUuid?: string;
    providerRecordId?: string;
    bookingId?: string;
    origin?: string;
  }>();
  const bib = routeText(params.bib);
  const eventId = routeText(params.eventId);
  useCanonicalChangeStream(eventId, Boolean(eventId));
  const athleteUid = routeText(params.athleteUid) || undefined;
  const email = routeText(params.email) || undefined;
  const providerUuid = routeText(params.providerUuid) || undefined;
  const providerAthleteUuid =
    routeText(params.providerAthleteUuid) || undefined;
  const providerTimingUuid = routeText(params.providerTimingUuid) || undefined;
  const participantUuid = routeText(params.participantUuid) || undefined;
  const providerRecordId = routeText(params.providerRecordId) || undefined;
  const bookingId = routeText(params.bookingId) || undefined;
  const origin = routeText(params.origin);
  const athleteIdentity = useMemo(
    () => ({
      bib: bib || undefined,
      athleteUid,
      bookingId,
      participantUuid,
      providerAthleteUuid,
      providerRecordId,
      providerTimingUuid,
      providerUuid,
      email,
    }),
    [
      athleteUid,
      bib,
      bookingId,
      email,
      participantUuid,
      providerAthleteUuid,
      providerRecordId,
      providerTimingUuid,
      providerUuid,
    ],
  );
  const hasAthleteIdentity = Boolean(
    athleteIdentity.bib ||
    athleteIdentity.athleteUid ||
    athleteIdentity.bookingId ||
    athleteIdentity.participantUuid ||
    athleteIdentity.providerAthleteUuid ||
    athleteIdentity.providerRecordId ||
    athleteIdentity.providerTimingUuid ||
    athleteIdentity.providerUuid ||
    athleteIdentity.email,
  );
  const handleBackPress = () => {
    if (origin === "live-tracking" && eventId) {
      if ((router as { canGoBack?: () => boolean }).canGoBack?.()) {
        router.back();
        return;
      }
      router.replace({
        pathname: "/event/[eventId]/track",
        params: { eventId },
      });
      return;
    }
    router.replace(eventId ? `/event/${eventId}` : "/events");
  };

  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  // Replay transport is UI-local; live/replay both render the same view model.
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState<ReplaySpeed>(1);
  const [minimized, setMinimized] = useState(false);
  const { event } = useEvent(eventId);
  const isResultsMode = event?.status === "finished";
  const trackingQuery = useEventTracking(
    eventId,
    Boolean(focused && eventId && !isResultsMode),
    false,
  );
  const trackingState = String(
    (trackingQuery.data as Record<string, unknown> | undefined)?.state ??
      "visibility-disabled",
  );
  const liveAthleteDataReady =
    isResultsMode ||
    ((trackingQuery.data as Record<string, unknown> | undefined)
      ?.publicAthleteVisibility === true &&
      trackingState === "ready");
  const athleteDetailQuery = useAthleteDetail(
    eventId,
    athleteIdentity,
    {
      focused,
      isLive: event?.status === "live",
      enabled: Boolean(
        focused && eventId && hasAthleteIdentity && liveAthleteDataReady,
      ),
    },
    isResultsMode ? "results" : "live",
  );
  const athleteLoading = athleteDetailQuery.isLoading || (athleteDetailQuery.isFetching && !athleteDetailQuery.data);
  const athleteSlow = useSlowNetwork(athleteLoading);
  useEffect(() => {
    const athlete = athleteDetailQuery.data?.athlete as Record<string, unknown> | undefined;
    const resolvedParticipantUuid = String(
      athlete?.participantUuid ?? athlete?.participantUid ?? participantUuid ?? "",
    ).trim();
    markCanonicalParticipantRendered(eventId, resolvedParticipantUuid || undefined);
  }, [athleteDetailQuery.data, eventId, participantUuid]);
  const certificateEventSlug = useMemo(() => {
    const raw = (event?.raw ?? {}) as Record<string, unknown>;
    const athlete = (athleteDetailQuery.data?.athlete ?? {}) as Record<
      string,
      unknown
    >;
    return [
      event?.customSlug,
      event?.eventSlug,
      raw.customSlug,
      raw.eventSlug,
      raw.event_slug,
      raw.slug,
      athlete.customSlug,
      athlete.eventSlug,
      athlete.event_slug,
    ]
      .map((value) => String(value ?? "").trim())
      .find(Boolean);
  }, [
    athleteDetailQuery.data?.athlete,
    event?.customSlug,
    event?.eventSlug,
    event?.raw,
  ]);
  const refetchAthleteDetail = athleteDetailQuery.refetch;
  useFocusEffect(
    useCallback(() => {
      if (!eventId || !hasAthleteIdentity) return () => {};
      void queryClient.invalidateQueries({
        queryKey: queryKeys.athleteDetail(eventId, athleteIdentity),
      });
      void refetchAthleteDetail();
      return () => {};
    }, [
      athleteIdentity,
      eventId,
      hasAthleteIdentity,
      queryClient,
      refetchAthleteDetail,
    ]),
  );
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    if (!eventId && !bib) return;
    console.log("[athlete-detail-screen] query status", {
      eventId,
      bib,
      status: athleteDetailQuery.status,
      isLoading: athleteDetailQuery.isLoading,
      isError: athleteDetailQuery.isError,
      hasData: Boolean(athleteDetailQuery.data),
      error: athleteDetailQuery.error,
    });
  }, [
    athleteDetailQuery.data,
    athleteDetailQuery.error,
    athleteDetailQuery.isError,
    athleteDetailQuery.isLoading,
    athleteDetailQuery.status,
    bib,
    eventId,
  ]);
  if (process.env.NODE_ENV !== "production" && (eventId || bib)) {
    console.log("[athlete-detail-screen] route params", {
      eventId,
      bib,
      athleteUid,
      email,
      providerUuid,
      providerAthleteUuid,
      providerTimingUuid,
      participantUuid,
      providerRecordId,
      bookingId,
      renderMode: event?.status === "finished" ? "results" : "live",
    });
  }
  const errorStatus =
    (athleteDetailQuery.error as unknown as ApiError | undefined)?.status ??
    null;
  const errorTitle =
    errorStatus === 404
      ? "Athlete not found"
      : errorStatus === 500
        ? "Unable to load athlete details."
        : "Couldn't load this athlete.";
  const errorDescription =
    errorStatus === 404
      ? "This athlete could not be found in the published data."
      : errorStatus === 500
        ? "Please try again in a moment."
        : "Please try again.";
  const detail = useMemo(
    () =>
      athleteDetailQuery.data
        ? mapAthleteDetail(athleteDetailQuery.data)
        : undefined,
    [athleteDetailQuery.data],
  );
  const displayedResult = useMemo(
    () =>
      addUploadedResultPaces(
        detail?.result,
        event?.ticketDefinitions,
        (athleteDetailQuery.data?.athlete ?? {}) as Record<string, unknown>,
        detail?.header.contest,
      ),
    [
      athleteDetailQuery.data?.athlete,
      detail?.header.contest,
      detail?.result,
      event?.ticketDefinitions,
    ],
  );

  // Course geometry for the live map (cached; no polling needed). Routes come
  // from the backend event course config / GPX.
  const mapSelection = useMemo(() => {
    const athlete = (athleteDetailQuery.data?.athlete ?? {}) as Record<
      string,
      unknown
    >;
    return {
      ticketId: String(athlete.ticketId ?? "").trim() || undefined,
      contestId:
        String(
          athlete.providerContestUuid ??
            athlete.contestUuid ??
            athlete.contestId ??
            "",
        ).trim() || undefined,
      contestName: detail?.header.contest,
    };
  }, [athleteDetailQuery.data?.athlete, detail?.header.contest]);
  const courseQuery = useCourseMap(eventId, Boolean(eventId));
  const courseGeometry = useCourseGeometry(
    eventId,
    event?.raw,
    Boolean(eventId),
    mapSelection,
  );
  const courseMap = useMemo(
    () =>
      mapCourseMap(
        courseQuery.data?.courseIndex,
        courseGeometry.data ?? undefined,
        { name: detail?.header.contest },
        courseQuery.data?.timingConfiguration,
      ),
    [courseQuery.data, courseGeometry.data, detail?.header.contest],
  );
  const displayTrack = useMemo<AthleteTrack | undefined>(() => {
    if (detail?.track) return detail.track;
    if (!courseMap?.hasGeometry || courseMap.mergedPath.length < 2)
      return undefined;
    const totalKm = courseMap.legs.reduce(
      (total, leg) => total + Math.max(0, leg.distanceKm ?? 0),
      0,
    );
    const measuredKm = coursePathDistanceKm(courseMap.mergedPath);
    const safeTotalKm = totalKm > 0 ? totalKm : Math.max(measuredKm, 0.001);
    return {
      seed: {
        anchorKm: 0,
        anchorTimeSec: 0,
        nextKm: 0,
        paceSecPerKm: 0,
        totalKm: safeTotalKm,
      },
      keyframes: [{ distanceKm: 0, timeSec: 0 }],
      totalKm: safeTotalKm,
    };
  }, [courseMap, detail]);

  const back = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Go back"
      onPress={handleBackPress}
      hitSlop={8}
      style={{ marginBottom: theme.spacing.base }}
    >
      <Icon name="chevronLeft" />
    </Pressable>
  );
  const showMap = useCallback(() => {
    const targetY = Math.max(0, mapSectionTop.current);
    scrollViewRef.current?.scrollTo({ y: targetY, animated: true });
  }, []);

  const handleMapSectionLayout = useCallback((event: LayoutChangeEvent) => {
    mapSectionTop.current = event.nativeEvent.layout.y;
  }, []);

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      edges={["top", "left", "right"]}
    >
      <ScrollView
        ref={scrollViewRef}
        contentContainerStyle={{
          padding: theme.spacing.base,
          gap: theme.spacing.lg,
          paddingBottom: 40,
        }}
        showsVerticalScrollIndicator={false}
      >
        {back}

        {athleteLoading ? (
          <>
            <Skeleton height={90} radius={theme.radius.large} />
            <Skeleton height={60} radius={theme.radius.large} />
            <Skeleton height={200} radius={theme.radius.large} />
            <Text variant="bodySmall" color="textMuted">
              {athleteSlow ? "Slow network detected. Athlete timing is still loading." : "Loading athlete timing..."}
            </Text>
          </>
        ) : athleteDetailQuery.isError ? (
          <ErrorState
            title={errorTitle}
            description={errorDescription}
            onRetry={
              errorStatus === 401 || errorStatus === 404
                ? undefined
                : () => athleteDetailQuery.refetch()
            }
          />
        ) : !detail ? (
          <EmptyState
            title="Athlete not found"
            description="This athlete is unavailable."
          />
        ) : detail.isPrivate ? (
          <EmptyState
            title="Tracking unavailable"
            description="This athlete has set their live tracking to private."
          />
        ) : (
          (() => {
            const header = displayHeader(detail);
            return displayedResult ? (
              <OfficialResultsCard
                header={header}
                result={displayedResult}
                eventSlug={certificateEventSlug}
                eventName={event?.name}
                eventLogoUrl={event?.logoUrl ?? undefined}
              />
            ) : (
              <>
                {displayTrack && courseMap?.hasGeometry && courseMap.bounds ? (
                  <View
                    style={{
                      marginHorizontal: -theme.spacing.base,
                      marginTop: -theme.spacing.sm,
                    }}
                  >
                    <LiveMapCard
                      track={displayTrack}
                      map={courseMap}
                      athlete={{
                        name: header.name,
                        photoUrl: header.photo,
                        colorSeed: header.colorSeed,
                        bib: header.bib,
                      }}
                      liveLocation={detail.liveLocation}
                      liveLocationSource={detail.liveLocationSource}
                      geometry={courseGeometry.data}
                      geometryLoading={courseGeometry.isLoading}
                      geometryError={courseGeometry.isError}
                      focused={focused}
                      onLayout={handleMapSectionLayout}
                      refreshError={
                        courseQuery.isRefetchError ||
                        courseGeometry.isRefetchError
                      }
                    />
                  </View>
                ) : detail.liveLocation ? (
                  <View onLayout={handleMapSectionLayout}>
                    <SectionCard title="Live Map" titleColor="accentSecondary">
                      <CourseMapView
                        athletes={[{
                          name: header.name,
                          photoUrl: header.photo,
                          colorSeed: header.colorSeed,
                          bib: header.bib,
                          position: detail.liveLocation,
                          selected: true,
                        }]}
                        compact
                        showMapControls
                      />
                      <Text variant="caption" color="textMuted">
                        Live GPS position shown. Add GPX files to display the course route.
                      </Text>
                    </SectionCard>
                  </View>
                ) : (
                  <SectionCard title="Live Map" titleColor="accentSecondary">
                    <Text variant="bodySmall" color="textMuted">
                      {courseGeometry.isLoading
                        ? "Loading course map…"
                        : courseGeometry.isError
                          ? "Course map could not be loaded. Check the saved GPX routes."
                          : "No GPX route or live GPS position is available for this contest."}
                    </Text>
                  </SectionCard>
                )}

                <View
                  style={{
                    marginTop:
                      displayTrack && courseMap?.hasGeometry ? -theme.spacing.lg : 0,
                  }}
                >
                  <TrackerHero
                    detail={detail}
                    minimized={minimized}
                    onViewMap={displayTrack && courseMap?.hasGeometry || detail.liveLocation ? showMap : undefined}
                    onToggleMinimized={() => setMinimized((value) => !value)}
                  />
                </View>

                {minimized ? (
                  <Button
                    label="Expand tracker"
                    variant="secondary"
                    fullWidth
                    onPress={() => setMinimized(false)}
                  />
                ) : (
                  <>
                    <LiveStatusPill
                      connected
                      lastUpdatedLabel={detail.livePosition?.updatedAt ?? "—"}
                      pollingLabel="5s"
                    />

                    <LegSplitStrip detail={detail} />

                    <CourseOverviewCard items={detail.courseOverview} />

                    <RaceOverviewCard detail={detail} />

                    <ProgressMiniCard detail={detail} />

                    <CutoffCard
                      cutoffs={detail.cutoffs}
                      status={detail.livePosition?.cutoffStatus}
                    />

                    <TimelineCard
                      splits={detail.timeline}
                      raceTiming={detail.raceTiming}
                      contest={detail.header.contest}
                      raceCategory={detail.header.raceCategory}
                      raceStartedAt={detail.raceStartedAt}
                      clockRunning={!detail.result && detail.header.status === "live"}
                      raceStartTimeOfDay={
                        detail.startTiming.officialStartLabel ??
                        detail.startTiming.gunStartLabel
                      }
                      nextSplit={detail.nextSplit}
                    />

                    <RankingCard rankings={detail.rankings} />

                    <PredictionCard
                      nextSplit={detail.nextSplit}
                      projected={detail.prediction}
                    />

                    {detail.replay.available ? (
                      <SectionCard title="Replay">
                        <ReplayControls
                          playing={replayPlaying}
                          speed={replaySpeed}
                          progress={0}
                          onTogglePlay={() => setReplayPlaying((p) => !p)}
                          onChangeSpeed={setReplaySpeed}
                        />
                      </SectionCard>
                    ) : null}
                  </>
                )}
              </>
            );
          })()
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
