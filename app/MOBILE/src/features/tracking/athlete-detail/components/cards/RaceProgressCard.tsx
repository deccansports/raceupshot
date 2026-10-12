import { useEffect, useMemo } from "react";
import { View } from "react-native";
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { brand, useTheme } from "@/core/theme";
import { ProgressBar, Text, Icon } from "@/shared/components";
import type {
  RaceProgressView,
  TimelineSplit,
} from "@/features/tracking/mappers";
import {
  resolveCourseKind,
  type CourseKind,
} from "@/features/tracking/courseKind";
import {
  formatDuration,
  type AthleteRaceTiming,
} from "@/features/tracking/timing";

import { SectionCard } from "./primitives";

type StageState = "completed" | "current" | "upcoming";
type StageIcon = "swim" | "transition" | "bike" | "run" | "medal";

type Stage = {
  label: string;
  icon: StageIcon;
  color: string;
  state: StageState;
  timeLabel: string;
};

const TRIATHLON_STAGES = ["SWIM", "T1", "BIKE", "T2", "RUN"] as const;
const SWIM_STAGES = ["SWIM", "FINISH"] as const;
const BIKE_STAGES = ["BIKE", "FINISH"] as const;
const RUN_STAGES = ["RUN", "FINISH"] as const;
const DUATHLON_STAGES = ["RUN1", "T1", "BIKE", "T2", "RUN2"] as const;
const UNKNOWN_STAGES = ["RACE", "FINISH"] as const;

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function normalized(value: unknown): string {
  return text(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function stageIcon(label: string): StageIcon {
  if (label.startsWith("SWIM")) return "swim";
  if (label.startsWith("BIKE")) return "bike";
  if (label.startsWith("RUN")) return "run";
  if (label.startsWith("FINISH")) return "medal";
  return "transition";
}

function stageColor(label: string): string {
  if (label.startsWith("SWIM")) return brand.blueBright;
  if (label.startsWith("BIKE")) return "#18A56B";
  if (label.startsWith("RUN")) return "#F28C28";
  if (label.startsWith("FINISH")) return "#3DD68C";
  return brand.blueDark;
}

function stageLabels(kind: CourseKind): readonly string[] {
  if (kind === "swim") return SWIM_STAGES;
  if (kind === "bike") return BIKE_STAGES;
  if (kind === "run") return RUN_STAGES;
  if (kind === "duathlon") return DUATHLON_STAGES;
  if (kind === "triathlon") return TRIATHLON_STAGES;
  return UNKNOWN_STAGES;
}

function stageMatches(label: string, legLabel: string): boolean {
  const target = normalized(label);
  const source = normalized(legLabel);
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
  if (target === "T1")
    return source.includes("T1") || source.includes("BIKESTART");
  if (target === "T2")
    return source.includes("T2") || source.includes("RUNSTART");
  return source.includes(target);
}

function buildStages(progress: RaceProgressView): Stage[] {
  const labels = stageLabels(
    resolveCourseKind(progress.raceCategory, progress.legLabel),
  );
  const activeIndexFromLabel = labels.findIndex((label) =>
    stageMatches(label, progress.legLabel),
  );
  const activeIndexFromProgress = Math.min(
    labels.length - 1,
    Math.max(0, Math.round(progress.progress * (labels.length - 1))),
  );
  const activeIndex =
    activeIndexFromLabel >= 0 ? activeIndexFromLabel : activeIndexFromProgress;

  return labels.map((label, index) => {
    const state: StageState =
      index < activeIndex
        ? "completed"
        : index === activeIndex
          ? "current"
          : "upcoming";
    return {
      label,
      icon: stageIcon(label),
      color: stageColor(label),
      state,
      timeLabel: state === "upcoming" ? "Pending" : label,
    };
  });
}

function StageNode({ stage, animated }: { stage: Stage; animated: boolean }) {
  const theme = useTheme();
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (!animated) {
      pulse.value = 0;
      return undefined;
    }
    pulse.value = 0;
    pulse.value = withRepeat(
      withTiming(1, {
        duration: 1500,
        easing: Easing.out(Easing.cubic),
      }),
      -1,
      true,
    );
    return undefined;
  }, [animated, pulse]);

  const glowStyle = useAnimatedStyle(() => {
    if (!animated) {
      return { opacity: 0, transform: [{ scale: 1 }] };
    }
    return {
      opacity: interpolate(pulse.value, [0, 1], [0.16, 0.48]),
      transform: [{ scale: interpolate(pulse.value, [0, 1], [0.94, 1.08]) }],
    };
  }, [animated]);

  const isCompleted = stage.state === "completed";
  const isCurrent = stage.state === "current";
  const isUpcoming = stage.state === "upcoming";
  const borderColor = isUpcoming ? theme.colors.border : stage.color;
  const backgroundColor = isUpcoming
    ? theme.colors.surfaceSunken
    : `${stage.color}22`;
  const iconColor = isUpcoming ? theme.colors.textMuted : theme.colors.onAccent;

  return (
    <View style={{ flex: 1, alignItems: "center", gap: 8 }}>
      <View
        style={{
          width: 44,
          height: 44,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {isCurrent ? (
          <Animated.View
            pointerEvents="none"
            style={[
              {
                position: "absolute",
                width: 46,
                height: 46,
                borderRadius: 23,
                backgroundColor: stage.color,
              },
              glowStyle,
            ]}
          />
        ) : null}
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: 19,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor,
            borderWidth: 1.5,
            borderColor,
          }}
        >
          {isCompleted ? (
            <View
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                borderRadius: 19,
                backgroundColor: `${stage.color}16`,
              }}
            />
          ) : null}
          <Icon name={stage.icon} size={16} colorValue={iconColor} />
        </View>
      </View>
      <View style={{ alignItems: "center", gap: 2 }}>
        <Text
          variant="caption"
          color={
            isUpcoming
              ? "textMuted"
              : isCurrent
                ? "textPrimary"
                : "textSecondary"
          }
          style={{ fontWeight: "900" }}
          numberOfLines={1}
        >
          {stage.label}
        </Text>
        <Text
          variant="caption"
          color={isCurrent ? "accent" : "textMuted"}
          style={{ fontWeight: "700" }}
          numberOfLines={1}
        >
          {isCurrent ? "Current" : isCompleted ? "Completed" : "Upcoming"}
        </Text>
        <Text
          variant="caption"
          color={isUpcoming ? "textMuted" : "textPrimary"}
          style={{ fontWeight: "800" }}
          numberOfLines={1}
        >
          {stage.timeLabel}
        </Text>
      </View>
    </View>
  );
}

/** Contest-driven progress timeline with color-coded leg states. */
export function RaceProgressCard({
  progress,
  timeline = [],
  raceTiming,
}: {
  progress: RaceProgressView;
  timeline?: TimelineSplit[];
  raceTiming?: AthleteRaceTiming;
}) {
  const theme = useTheme();
  const stages = useMemo(() => {
    if (raceTiming?.sections.length) {
      return raceTiming.sections.map((section) => ({
        label: section.shortLabel ?? section.title,
        icon: stageIcon(section.legType ?? section.shortLabel ?? section.title),
        color: stageColor(section.legType ?? section.shortLabel ?? section.title),
        state: section.status === "completed"
          ? "completed" as const
          : section.status === "in_progress"
            ? "current" as const
            : "upcoming" as const,
        timeLabel: formatDuration(section.durationSeconds),
      }));
    }
    if (timeline.length <= 1) return buildStages(progress);
    return timeline.map((split) => ({
      label: split.splitLabel || split.name,
      icon: stageIcon(split.segment || split.name),
      color: stageColor(split.segment || split.name),
      state: split.state,
      timeLabel: split.timeLabel,
    }));
  }, [progress, raceTiming, timeline]);
  const activeIndex = stages.findIndex((stage) => stage.state === "current");
  const progressWidth =
    `${Math.max(0, Math.min(100, progress.progress * 100)).toFixed(1)}%` as `${number}%`;

  return (
    <SectionCard
      title="Race Progress"
      titleColor="accentSecondary"
      style={{ gap: theme.spacing.md }}
    >
      <View
        style={{
          gap: theme.spacing.md,
          borderRadius: theme.radius.large,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surfaceElevated,
          padding: theme.spacing.base,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            height: 3,
            backgroundColor: `${theme.colors.accentSecondary}18`,
          }}
        />

        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <View style={{ flex: 1, gap: 6 }}>
            <Text
              variant="headline"
              style={{ fontWeight: "900" }}
              numberOfLines={2}
            >
              {progress.legLabel}
            </Text>
            <Text variant="bodySmall" color="textMuted">
              {progress.coveredLabel} · {progress.remainingLabel}
            </Text>
          </View>
          <View
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: theme.radius.full,
              backgroundColor: `${theme.colors.accentSecondary}14`,
              borderWidth: 1,
              borderColor: `${theme.colors.accentSecondary}2A`,
            }}
          >
            <Text variant="label" color="accent" style={{ fontWeight: "900" }}>
              {progress.percentLabel}
            </Text>
          </View>
        </View>

        <View style={{ gap: 10 }}>
          <View
            style={{ position: "relative", paddingTop: 4, paddingBottom: 4 }}
          >
            <View
              style={{
                position: "absolute",
                left: 22,
                right: 22,
                top: 22,
                height: 5,
                borderRadius: 999,
                backgroundColor: theme.colors.borderStrong,
              }}
            />
            <View
              style={{
                position: "absolute",
                left: 22,
                right: 22,
                top: 22,
                height: 5,
                borderRadius: 999,
                backgroundColor: `${theme.colors.accentSecondary}20`,
                overflow: "hidden",
              }}
            >
              <View
                style={{
                  width: progressWidth,
                  height: 4,
                  borderRadius: 999,
                  backgroundColor: theme.colors.accentSecondary,
                }}
              />
            </View>
            <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
              {stages.map((stage, index) => (
                <StageNode
                  key={stage.label}
                  stage={stage}
                  animated={index === activeIndex}
                />
              ))}
            </View>
          </View>

          <ProgressBar
            progress={progress.progress}
            height={6}
            accessibilityLabel="Race progress"
          />
        </View>
      </View>
    </SectionCard>
  );
}
