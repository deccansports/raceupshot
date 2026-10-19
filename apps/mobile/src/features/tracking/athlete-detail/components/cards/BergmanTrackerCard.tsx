import { useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";

import { useTheme } from "@/core/theme";
import {
  Avatar,
  Badge,
  Button,
  Card,
  Icon,
  ProgressBar,
  Text,
} from "@/shared/components";
import type {
  AthleteHeaderView,
  MetricRow,
  RaceProgressView,
  TimelineSplit,
} from "@/features/tracking/mappers";
import {
  courseStageLabels,
  resolveCourseKind,
} from "@/features/tracking/courseKind";
import { RaceStartCountdown } from "./RaceStartCountdown";
import { useSharedLiveNow } from "@/features/tracking/timing/sharedLiveClock";

type StageState = "completed" | "current" | "future";
type Stage = { label: string; value: string; state: StageState };

type BergmanTrackerCardProps = {
  header: AthleteHeaderView;
  statusLabel?: string;
  description?: string;
  metrics?: MetricRow[];
  timeline?: TimelineSplit[];
  progress?: RaceProgressView;
  rankings?: MetricRow[];
  courseOverview?: MetricRow[];
  cutoffs?: { label: string; value: string }[];
  eventLive?: boolean;
  finishTime?: string;
  raceStartedAt?: number;
  onPress?: () => void;
  onViewMap?: () => void;
  onRemove?: () => void;
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

function isDash(value: unknown): boolean {
  const text = clean(value);
  return (
    !text ||
    text === "—" ||
    text === "-" ||
    text === DASH_TIME ||
    text === "--:--:--"
  );
}

function metricValue(metrics: MetricRow[], label: string): string {
  return clean(
    metrics.find((metric) => metric.label.toLowerCase() === label.toLowerCase())
      ?.value,
  );
}

function durationSeconds(value: string): number | null {
  const parts = value.split(":").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function durationLabel(seconds: number | null, fallback = "—"): string {
  return seconds == null
    ? fallback
    : `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function LiveElapsedValue({
  value,
  raceStartedAt,
}: {
  value: string;
  raceStartedAt?: number;
}) {
  const sourceSeconds = durationSeconds(value);
  const runningFromStart =
    raceStartedAt != null && Number.isFinite(raceStartedAt);
  const nowMs = useSharedLiveNow(runningFromStart || sourceSeconds != null);
  const [fallbackAnchor] = useState(() => ({
    seconds: sourceSeconds,
    atMs: Date.now(),
  }));
  const seconds = runningFromStart
    ? Math.max(0, Math.floor((nowMs - raceStartedAt) / 1_000))
    : fallbackAnchor.seconds == null
      ? null
      : Math.floor(
          fallbackAnchor.seconds +
            Math.max(0, (nowMs - fallbackAnchor.atMs) / 1_000),
        );
  return (
    <Text variant="headline" style={{ fontWeight: "900" }}>
      {durationLabel(seconds, value || "—")}
    </Text>
  );
}

function RotatingPreRaceInfo({ items }: { items: [string, string][] }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (items.length < 2) return;
    const timer = setInterval(
      () => setIndex((current) => (current + 1) % items.length),
      3000,
    );
    return () => clearInterval(timer);
  }, [items.length]);
  const item = items[index] ?? items[0];
  if (!item) return null;
  return (
    <View
      style={{
        minHeight: 72,
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
      }}
    >
      <Text
        variant="caption"
        color="textMuted"
        style={{ fontWeight: "800", textAlign: "center" }}
      >
        {item[0]}
      </Text>
      <Text
        variant="headline"
        style={{ fontWeight: "900", textAlign: "center" }}
      >
        {item[1]}
      </Text>
      <Text variant="caption" color="textMuted">
        {index + 1} / {items.length}
      </Text>
    </View>
  );
}

function stageMatches(label: string, split: TimelineSplit): boolean {
  const target = normalized(label);
  const source = normalized(`${split.segment} ${split.name}`);
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
  if (target === "FINISH") return source.includes("FINISH");
  if (target === "T1")
    return source.includes("T1") || source.includes("BIKESTART");
  if (target === "T2")
    return source.includes("T2") || source.includes("RUNSTART");
  return source.includes(target);
}

function resolveStages(
  header: AthleteHeaderView,
  timeline: TimelineSplit[],
): Stage[] {
  if (timeline.length > 1) {
    return timeline.map((split) => ({
      label: split.splitLabel || split.name,
      value: isDash(split.timeLabel) ? DASH_TIME : split.timeLabel,
      state: split.state === "upcoming" ? "future" : split.state,
    }));
  }
  const labels = courseStageLabels(
    resolveCourseKind(
      header.raceCategory,
      header.contest,
      timeline.map((item) => `${item.segment} ${item.name}`).join(" "),
    ),
  );
  const rawStages = labels.map((label) => {
    const matches = timeline.filter((split) => stageMatches(label, split));
    const completed = matches.filter(
      (split) => split.state === "completed" || !isDash(split.timeLabel),
    );
    const current = matches.find((split) => split.state === "current");
    const lastCompleted = completed[completed.length - 1];
    const value =
      clean(lastCompleted?.timeLabel || current?.timeLabel) || DASH_TIME;
    const state: StageState = current
      ? "current"
      : lastCompleted
        ? "completed"
        : "future";
    return { label, value: isDash(value) ? DASH_TIME : value, state };
  });

  if (
    !rawStages.some((stage) => stage.state === "current") &&
    rawStages.some((stage) => stage.state === "future")
  ) {
    const nextIndex = rawStages.findIndex((stage) => stage.state === "future");
    if (nextIndex === 0)
      return [{ ...rawStages[0], state: "current" }, ...rawStages.slice(1)];
  }
  return rawStages;
}

function progressFromStages(
  stages: Stage[],
  progress?: RaceProgressView,
): number {
  if (progress) return progress.progress;
  if (stages.length === 0) return 0;
  const completed = stages.filter(
    (stage) => stage.state === "completed",
  ).length;
  const currentBonus = stages.some((stage) => stage.state === "current")
    ? 0.5
    : 0;
  return Math.min(1, (completed + currentBonus) / stages.length);
}

function statusVariant(status: string, header: AthleteHeaderView) {
  const source = `${status} ${header.status}`.toLowerCase();
  if (/dnf|dns|disqual|invalid/.test(source)) return "danger" as const;
  if (source.includes("finish")) return "finished" as const;
  if (source.includes("live") || source.includes("course"))
    return "live" as const;
  if (/\bt1\b|\bt2\b|transition/.test(source)) return "warning" as const;
  return "neutral" as const;
}

function legGlyph(label: string): string {
  if (label.startsWith("T")) return label;
  return "F";
}

function legIcon(label: string): "swim" | "bike" | "run" | null {
  if (label.startsWith("SWIM")) return "swim";
  if (label.startsWith("BIKE")) return "bike";
  if (label.startsWith("RUN")) return "run";
  return null;
}

function markerLeft(progress: number): `${number}%` {
  return `${Math.max(0, Math.min(100, progress * 100))}%`;
}

export function BergmanTrackerCard({
  header,
  statusLabel,
  description,
  metrics = [],
  timeline = [],
  progress,
  rankings = [],
  courseOverview = [],
  cutoffs = [],
  eventLive = false,
  finishTime,
  raceStartedAt,
  onPress,
  onViewMap,
  onRemove,
}: BergmanTrackerCardProps) {
  const theme = useTheme();
  const isAnonymous = header.anonymous;
  const displayName = isAnonymous
    ? "Anonymous Athlete"
    : header.name || "Athlete";
  const photo = isAnonymous ? undefined : header.photo;
  const club = isAnonymous ? undefined : header.club;
  const countryFlag = isAnonymous ? undefined : header.countryFlag;
  const ageGroup = isAnonymous ? undefined : header.category;
  const contest = header.contest || header.eventName || "Contest";
  const primaryStatus = statusLabel || header.statusLabel || "Not Started";
  const elapsed =
    metricValue(metrics, "Elapsed") ||
    metricValue(metrics, "Official Race Time") ||
    metricValue(metrics, "Athlete Race Time");
  const currentLeg = metricValue(metrics, "Current Leg");
  const eta =
    metricValue(metrics, "Est. Finish") ||
    metricValue(metrics, "Estimated Finish");
  const finished =
    header.status === "finished" ||
    primaryStatus.toLowerCase().includes("finish");
  const notStarted =
    header.status === "notStarted" ||
    /not\s*started|awaiting\s*start|waiting\s*(?:for|to)\s*start/i.test(
      primaryStatus,
    );
  const resolvedStages = useMemo(
    () => resolveStages(header, timeline),
    [header, timeline],
  );
  const stages = useMemo(
    () =>
      notStarted
        ? resolvedStages.map((stage) => ({
            ...stage,
            state: "future" as const,
          }))
        : resolvedStages,
    [notStarted, resolvedStages],
  );
  const progressValue = notStarted ? 0 : progressFromStages(stages, progress);
  const hasInlineActions = Boolean(onViewMap || onRemove);
  const live =
    !notStarted && !finished && !/dnf|dns|disqual/i.test(primaryStatus);
  const rank = (label: string) => metricValue(rankings, label) || "—";
  const lastTiming = [...timeline]
    .reverse()
    .find((row) => row.state === "completed");
  const courseDistance =
    courseOverview
      .filter((row) => /swim|bike|run/i.test(row.label))
      .map((row) => row.value)
      .join(" • ") || "Yet to be published";
  const cutoff =
    cutoffs
      .map((row) => row.value)
      .filter(Boolean)
      .join(" • ") || "See official race cut-offs";

  return (
    <Card
      onPress={hasInlineActions ? undefined : onPress}
      style={{
        gap: theme.spacing.md,
        overflow: "hidden",
        borderRadius: theme.radius.xl,
        borderColor: "rgba(229, 9, 32, 0.18)",
        backgroundColor: theme.colors.surfaceElevated,
        padding: theme.spacing.base,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: theme.spacing.sm,
        }}
      >
        <View
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            gap: theme.spacing.sm,
          }}
        >
          <Avatar
            name={displayName}
            uri={photo}
            colorSeed={header.colorSeed || header.bib}
            size={52}
            bordered
          />
          <View style={{ flex: 1, gap: 7 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 7,
              }}
            >
              <Text
                variant="headline"
                numberOfLines={1}
                style={{ flexShrink: 1, fontWeight: "900" }}
              >
                {displayName}
              </Text>
              {countryFlag ? (
                <Text variant="headline">{countryFlag}</Text>
              ) : null}
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              <Badge label={`BIB: ${header.bib || "—"}`} variant="neutral" />
              {ageGroup ? (
                <Badge label={`Age Group: ${ageGroup}`} variant="neutral" />
              ) : null}
            </View>
          </View>
        </View>

        {onViewMap || onRemove ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            {onViewMap ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="View athlete on map"
                onPress={(event) => {
                  event.stopPropagation();
                  onViewMap();
                }}
                hitSlop={8}
              >
                <View
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: theme.radius.medium,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: theme.colors.surfaceSunken,
                  }}
                >
                  <Icon name="map" color="accent" size={18} />
                </View>
              </Pressable>
            ) : null}
            {onRemove ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Remove athlete from watchlist"
                onPress={(event) => {
                  event.stopPropagation();
                  onRemove();
                }}
                hitSlop={8}
              >
                <View
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: theme.radius.medium,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: theme.colors.surfaceSunken,
                  }}
                >
                  <Text variant="headline" color="textMuted">
                    X
                  </Text>
                </View>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>

      {club ? (
        <View
          style={{
            alignSelf: "flex-start",
            borderRadius: theme.radius.full,
            borderWidth: 1,
            borderColor: `${theme.colors.success}55`,
            backgroundColor: `${theme.colors.success}14`,
            paddingHorizontal: 12,
            paddingVertical: 6,
          }}
        >
          <Text
            variant="caption"
            style={{ color: theme.colors.success, fontWeight: "800" }}
          >
            Proudly representing {club}
          </Text>
        </View>
      ) : null}

      <Text variant="bodySmall" color="textMuted" numberOfLines={2}>
        Contest:{" "}
        <Text variant="bodySmall" style={{ fontWeight: "800" }}>
          {contest}
        </Text>
      </Text>

      <View style={{ gap: notStarted ? 18 : 8 }}>
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            justifyContent: notStarted ? "center" : "flex-start",
            gap: 8,
            marginVertical: notStarted ? 10 : 0,
          }}
        >
          <Badge
            label={primaryStatus}
            variant={statusVariant(primaryStatus, header)}
          />
          {finished && (finishTime || elapsed) ? (
            <Badge label={`Time ${finishTime || elapsed}`} variant="finished" />
          ) : null}
          {!finished && elapsed ? (
            <Badge label={`Elapsed ${elapsed}`} variant="neutral" />
          ) : null}
          {!finished && currentLeg ? (
            <Badge label={`Leg ${currentLeg}`} variant="neutral" />
          ) : null}
          {!finished && eta ? (
            <Badge label={`ETA ${eta}`} variant="neutral" />
          ) : null}
        </View>
      </View>

      {description ? (
        <Text variant="bodySmall" color="textSecondary" numberOfLines={2}>
          {description}
        </Text>
      ) : null}

      {notStarted ? (
        eventLive ? (
          <View style={{ gap: theme.spacing.sm }}>
            <RaceStartCountdown scheduledStart={header.scheduledStart} />
            <RotatingPreRaceInfo
              items={[
                ["Race Status", "Not Started"],
                ["Course Distance", courseDistance],
                ["Race Cut-off Time", cutoff],
              ]}
            />
          </View>
        ) : null
      ) : (
        <View style={{ gap: theme.spacing.md }}>
          {live ? (
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 7 }}
            >
              <Badge label="Live" variant="live" />
            </View>
          ) : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {[
              ["Elapsed Time", elapsed],
              ["Current Leg", currentLeg || progress?.legLabel || "—"],
              [
                "Distance",
                progress
                  ? `${progress.coveredLabel.replace(" done", "")} / ${progress.remainingLabel.replace(" left", "")} remaining`
                  : "—",
              ],
              [
                /bike/i.test(currentLeg) ? "Average Speed" : "Average Pace",
                metricValue(metrics, "Avg Pace") || "—",
              ],
              [
                /bike/i.test(currentLeg) ? "Current Speed" : "Current Pace",
                metricValue(metrics, "Pace") || "—",
              ],
              ["Estimated Finish", eta || "—"],
              ["Remaining", progress?.remainingLabel || "—"],
              ["Heart", "♡ —"],
              ["Overall Rank", rank("Overall")],
              ["Gender Rank", rank("Gender")],
              ["Age Group Rank", rank("Category")],
              [
                "Overall Progress",
                progress?.percentLabel || `${Math.round(progressValue * 100)}%`,
              ],
              [
                "Last Timing Point",
                lastTiming?.splitLabel || lastTiming?.name || "—",
              ],
              ["Last Update", lastTiming?.timeOfDayLabel || "—"],
            ].map(([label, value]) => (
              <View
                key={label}
                style={{
                  width: "48%",
                  minHeight: 70,
                  padding: 11,
                  gap: 5,
                  borderRadius: theme.radius.medium,
                  backgroundColor: theme.colors.surfaceSunken,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                }}
              >
                <Text
                  variant="caption"
                  color="textMuted"
                  style={{ fontWeight: "800" }}
                >
                  {label}
                </Text>
                {label === "Elapsed Time" && live ? (
                  <LiveElapsedValue
                    value={value}
                    raceStartedAt={raceStartedAt}
                  />
                ) : (
                  <Text
                    variant="headline"
                    numberOfLines={2}
                    adjustsFontSizeToFit
                    style={{ fontWeight: "900" }}
                  >
                    {value}
                  </Text>
                )}
              </View>
            ))}
          </View>
          <Text
            variant="caption"
            color="textMuted"
            style={{ fontWeight: "900" }}
          >
            RACE PROGRESS
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
                  style={{
                    flex: 1,
                    minWidth: 0,
                    alignItems: "center",
                  }}
                >
                  <Text
                    variant="caption"
                    color={
                      stage.state === "future" ? "textMuted" : "textPrimary"
                    }
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
                height: 42,
                justifyContent: "center",
                paddingHorizontal: 12,
              }}
            >
              <View
                style={{
                  position: "absolute",
                  left: 22,
                  right: 22,
                  top: 19,
                  height: 5,
                  borderRadius: 2,
                  backgroundColor: theme.colors.borderStrong,
                  overflow: "hidden",
                  zIndex: 0,
                }}
              >
                <View
                  style={{
                    width: markerLeft(progressValue),
                    height: 5,
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
                  width: 26,
                  height: 26,
                  marginLeft: -13,
                  borderRadius: 13,
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
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                }}
              >
                {stages.map((stage) => {
                  const active = stage.state === "current";
                  const completed = stage.state === "completed";
                  const color =
                    active || completed
                      ? theme.colors.accent
                      : theme.colors.textMuted;
                  const sportIcon = legIcon(stage.label);
                  return (
                    <View
                      key={`${stage.label}-node`}
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 15,
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
                      {sportIcon ? (
                        <Icon name={sportIcon} size={17} colorValue={color} />
                      ) : (
                        <Text
                          variant="caption"
                          style={{ color, fontWeight: "900" }}
                        >
                          {legGlyph(stage.label)}
                        </Text>
                      )}
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
                    style={{
                      color: theme.colors.textPrimary,
                      fontWeight: "900",
                    }}
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
          <View
            style={{ flexDirection: "row", justifyContent: "space-between" }}
          >
            <Text variant="caption" color="textMuted">
              {progress?.legLabel || "Progress"}
            </Text>
            <Text
              variant="caption"
              color="accent"
              style={{ fontWeight: "800" }}
            >
              {notStarted
                ? "0%"
                : progress?.percentLabel ||
                  `${Math.round(progressValue * 100)}%`}
            </Text>
          </View>
          {hasInlineActions && onPress ? (
            <Button
              label="Open tracker"
              size="sm"
              variant="secondary"
              onPress={onPress}
            />
          ) : null}
        </View>
      )}
    </Card>
  );
}
