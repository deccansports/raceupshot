import { useEffect, useMemo, useState } from "react";
import {
  LayoutAnimation,
  Platform,
  Pressable,
  UIManager,
  View,
} from "react-native";

import { useTheme } from "@/core/theme";
import { Badge, Card, Divider, ProgressBar, Text } from "@/shared/components";
import type { TimelineSplit, TimelineState } from "@/features/tracking/mappers";
import { resolveCourseKind } from "@/features/tracking/courseKind";
import {
  formatDuration,
  type AthleteRaceSection,
  type AthleteRaceTiming,
} from "@/features/tracking/timing";

import { SectionCard } from "./primitives";

type LegKey = "swim" | "t1" | "bike" | "t2" | "run" | "other";

type LegSection = {
  key: LegKey;
  title: string;
  icon: string;
  tint: string;
  rows: TimelineSplit[];
};

const LEG_ORDER: LegKey[] = ["swim", "t1", "bike", "t2", "run", "other"];

const LEG_META: Record<LegKey, Omit<LegSection, "rows">> = {
  swim: { key: "swim", title: "Swim Leg", icon: "SW", tint: "#2E9AFE" },
  t1: { key: "t1", title: "T1 Transition", icon: "T1", tint: "#8B95A5" },
  bike: { key: "bike", title: "Bike Leg", icon: "BK", tint: "#22C55E" },
  t2: { key: "t2", title: "T2 Transition", icon: "T2", tint: "#8B95A5" },
  run: { key: "run", title: "Run Leg", icon: "RN", tint: "#F97316" },
  other: { key: "other", title: "Race Timing", icon: "TP", tint: "#A3AAB7" },
};

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

function dash(value: string | undefined): string {
  const candidate = String(value ?? "").trim();
  return candidate || "—";
}

function normalize(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

function splitLabel(split: TimelineSplit): string {
  return normalize(split.splitLabel || split.name);
}

function classifyLeg(split: TimelineSplit): LegKey {
  const label = splitLabel(split);
  const segment = normalize(split.segment);
  const haystack = `${label} ${segment}`;
  if (
    haystack.includes("T1") ||
    (haystack.includes("SWIM") && haystack.includes("BIKE START"))
  )
    return "t1";
  if (
    haystack.includes("T2") ||
    (haystack.includes("BIKE FINISH") && haystack.includes("RUN START"))
  )
    return "t2";
  if (haystack.includes("BIKE")) return "bike";
  if (haystack.includes("RUN")) return "run";
  if (haystack.includes("SWIM")) return "swim";
  return "other";
}

function stateCounts(rows: TimelineSplit[]) {
  const completed = rows.filter((row) => row.state === "completed").length;
  const current = rows.some((row) => row.state === "current");
  const progress =
    rows.length > 0
      ? Math.min(1, (completed + (current ? 0.5 : 0)) / rows.length)
      : 0;
  return { completed, current, progress };
}

function groupSections(splits: TimelineSplit[], raceCategory?: string, contest?: string): LegSection[] {
  const courseKind = resolveCourseKind(raceCategory, contest);
  const grouped = new Map<LegKey, TimelineSplit[]>();
  splits.forEach((split) => {
    const identity = normalize(
      `${split.segment} ${split.splitLabel ?? split.name}`,
    );
    if (
      identity.includes("TRANSITION") &&
      !identity.includes("T1") &&
      !identity.includes("T2")
    )
      return;
    const classified = classifyLeg(split);
    // A mapped single-discipline Bergman ticket is authoritative. Feibot can
    // retain stale TypeOfSport/leg labels after the ticket changes discipline.
    const leg = courseKind === "run" || courseKind === "bike" || courseKind === "swim"
      ? courseKind
      : classified;
    grouped.set(leg, [...(grouped.get(leg) ?? []), split]);
  });
  return LEG_ORDER.map((key) => {
    const rows = grouped.get(key) ?? [];
    return {
      ...LEG_META[key],
      rows,
    };
  }).filter((section) => section.rows.length > 0);
}

function SplitStateBadge({ state }: { state: TimelineState }) {
  if (state === "current") return <Badge label="Current" variant="live" />;
  if (state === "completed") return <Badge label="Done" variant="finished" />;
  return <Badge label="Waiting" variant="neutral" />;
}

function LegProgress({ sections }: { sections: LegSection[] }) {
  const theme = useTheme();
  const activeIndex = Math.max(
    0,
    sections.findIndex((section) =>
      section.rows.some((row) => row.state === "current"),
    ),
  );
  const fallbackIndex = sections.reduce(
    (last, section, index) =>
      section.rows.some((row) => row.state === "completed") ? index : last,
    0,
  );
  const currentIndex = activeIndex >= 0 ? activeIndex : fallbackIndex;

  return (
    <Card
      elevated={false}
      style={{
        gap: theme.spacing.sm,
        backgroundColor: "#0F131A",
        borderColor: "#27303C",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          gap: theme.spacing.sm,
        }}
      >
        {sections.map((section, index) => {
          const active = index === currentIndex;
          const done =
            index < currentIndex ||
            section.rows.every((row) => row.state === "completed");
          return (
            <View
              key={section.key}
              style={{ flex: 1, alignItems: "center", gap: 6 }}
            >
              <View
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 17,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor:
                    active || done ? `${section.tint}26` : "#171C24",
                  borderWidth: 1,
                  borderColor: active
                    ? section.tint
                    : done
                      ? `${section.tint}88`
                      : "#303846",
                }}
              >
                <Text
                  variant="caption"
                  style={{
                    color: active || done ? section.tint : "#8B95A5",
                    fontWeight: "900",
                  }}
                >
                  {section.icon}
                </Text>
              </View>
              <Text
                variant="caption"
                style={{
                  color: active ? "#FFFFFF" : "#8B95A5",
                  fontWeight: "800",
                }}
                numberOfLines={1}
              >
                {section.title.replace(" Leg", "").replace(" Transition", "")}
              </Text>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

function SectionHeader({
  section,
  expanded,
  onToggle,
}: {
  section: LegSection;
  expanded: boolean;
  onToggle: () => void;
}) {
  const theme = useTheme();
  const { completed, current, progress } = stateCounts(section.rows);

  return (
    <Pressable accessibilityRole="button" onPress={onToggle}>
      <View
        style={[
          {
            gap: theme.spacing.sm,
            padding: theme.spacing.md,
            backgroundColor: "#10151D",
            borderRadius: theme.radius.large,
            borderWidth: 1,
            borderColor: current ? section.tint : "#26303B",
          },
          Platform.OS === "web"
            ? ({
                position: "sticky",
                top: 0,
                zIndex: 2,
              } as any)
            : null,
        ]}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: theme.spacing.sm,
          }}
        >
          <View
            style={{
              width: 42,
              height: 42,
              borderRadius: 21,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: `${section.tint}22`,
              borderWidth: 1,
              borderColor: `${section.tint}88`,
            }}
          >
            <Text
              variant="label"
              style={{ color: section.tint, fontWeight: "900" }}
            >
              {section.icon}
            </Text>
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <Text
              variant="headline"
              style={{ color: "#FFFFFF", fontWeight: "900" }}
            >
              {section.title}
            </Text>
            <Text variant="caption" style={{ color: "#9AA3AF" }}>
              {completed}/{section.rows.length} complete
            </Text>
          </View>
          {current ? <Badge label="Active" variant="live" /> : null}
          <Text variant="headline" style={{ color: "#9AA3AF" }}>
            {expanded ? "-" : "+"}
          </Text>
        </View>
        <ProgressBar
          progress={progress}
          height={5}
          accessibilityLabel={`${section.title} progress`}
        />
      </View>
    </Pressable>
  );
}

const TIMING_COLUMN_LABELS = ["TIME\nOF DAY", "TIME", "PACE", "RANK"];

const WEB_TIMING_COLUMN_FLEX = [1.85, 1.1, 1.25, 1, 0.65] as const;

function TimingColumnsHeader() {
  return (
    <View
      style={{
        flexDirection: "row",
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 8,
        backgroundColor: "#111821",
        borderWidth: 1,
        borderColor: "#26303B",
      }}
    >
      {TIMING_COLUMN_LABELS.map((label, index) => (
        <View
          key={label}
          style={{
            flex: 1,
            minWidth: 0,
            alignItems: "center",
            paddingHorizontal: 2,
            borderLeftWidth: index === 0 ? 0 : 1,
            borderLeftColor: "#26303B",
          }}
        >
          <Text
            variant="caption"
            style={{
              color: "#8F98A6",
              fontWeight: "900",
              fontSize: 9,
              lineHeight: 11,
              textAlign: "center",
            }}
            numberOfLines={2}
          >
            {label}
          </Text>
        </View>
      ))}
    </View>
  );
}

function TimingValuesRow({ values, tint }: { values: string[]; tint: string }) {
  return (
    <View style={{ flexDirection: "row" }}>
      {values.map((value, index) => (
        <View
          key={`${index}:${value}`}
          style={{
            flex: 1,
            minWidth: 0,
            alignItems: "center",
            paddingHorizontal: 2,
            borderLeftWidth: index === 0 ? 0 : 1,
            borderLeftColor: "#26303B",
          }}
        >
          <Text
            variant="caption"
            style={{
              color:
                value === "—"
                  ? "#687280"
                  : index === values.length - 1
                    ? tint
                    : "#E7EAF0",
              fontWeight: "800",
              textAlign: "center",
            }}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.62}
          >
            {value}
          </Text>
        </View>
      ))}
    </View>
  );
}

function MobileSplitRow({
  split,
  section,
}: {
  split: TimelineSplit;
  section: LegSection;
}) {
  const theme = useTheme();
  const current = split.state === "current";
  const completed = split.state === "completed";

  return (
    <Card
      elevated={false}
      style={{
        gap: theme.spacing.sm,
        borderColor: current
          ? section.tint
          : completed
            ? `${section.tint}66`
            : "#2A323E",
        backgroundColor: current
          ? `${section.tint}16`
          : completed
            ? "#121820"
            : "#0D1117",
      }}
    >
      <View style={{ gap: theme.spacing.sm }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: theme.spacing.sm,
          }}
        >
          <View style={{ flex: 1, gap: 4 }}>
            <Text
              variant="body"
              style={{
                color: current ? "#FFFFFF" : "#E7EAF0",
                fontWeight: "900",
              }}
            >
              {split.splitLabel || split.name}
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {split.distanceLabel ? (
                <Badge
                  label={`${split.distanceLabel} total`}
                  variant="neutral"
                />
              ) : null}
              {split.cutoffLabel ? (
                <Badge
                  label={`Cutoff ${split.cutoffLabel}`}
                  variant="upcoming"
                />
              ) : null}
            </View>
          </View>
          <SplitStateBadge state={split.state} />
        </View>

        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: "#26303B",
            paddingTop: theme.spacing.sm,
          }}
        >
          <TimingValuesRow
            tint={section.tint}
            values={[
              dash(split.timeOfDayLabel),
              dash(split.elapsedTimeLabel),
              dash(split.paceSpeedLabel),
              dash(split.positionLabel) === "—"
                ? "—"
                : `#${dash(split.positionLabel).replace(/^#/, "")}`,
            ]}
          />
        </View>
      </View>
    </Card>
  );
}

function WebLegTable({ section }: { section: LegSection }) {
  return (
    <Card
      padded={false}
      elevated={false}
      style={{
        overflow: "hidden",
        borderColor: "#26303B",
        backgroundColor: "#0B1016",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          backgroundColor: "#111821",
          borderBottomWidth: 1,
          borderBottomColor: "#26303B",
        }}
      >
        {[
          ["Checkpoint", WEB_TIMING_COLUMN_FLEX[0]],
          ["Time of Day", WEB_TIMING_COLUMN_FLEX[1]],
          ["Time", WEB_TIMING_COLUMN_FLEX[2]],
          ["Pace", WEB_TIMING_COLUMN_FLEX[3]],
          ["Rank", WEB_TIMING_COLUMN_FLEX[4]],
        ].map(([label, flex]) => {
          const headerLabel =
            label === "Time of Day"
              ? "TIME\nOF DAY"
              : String(label).toUpperCase();
          return (
            <View
              key={label}
              style={{
                flex: Number(flex),
                paddingVertical: 9,
                paddingHorizontal: 5,
                minWidth: 0,
              }}
            >
              <Text
                variant="caption"
                style={{ color: "#8F98A6", fontWeight: "900", lineHeight: 13 }}
                numberOfLines={2}
              >
                {headerLabel}
              </Text>
            </View>
          );
        })}
      </View>

      {section.rows.map((split, index) => {
        const current = split.state === "current";
        const values = [
          split.splitLabel || split.name,
          dash(split.timeOfDayLabel),
          dash(split.elapsedTimeLabel),
          dash(split.paceSpeedLabel),
          dash(split.positionLabel) === "—"
            ? "—"
            : `#${dash(split.positionLabel).replace(/^#/, "")}`,
        ];
        return (
          <View key={split.key}>
            {index > 0 ? <Divider /> : null}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: current ? `${section.tint}12` : "transparent",
              }}
            >
              {values.map((value, valueIndex) => {
                const flex = WEB_TIMING_COLUMN_FLEX[valueIndex];
                return (
                  <View
                    key={`${split.key}-${valueIndex}`}
                    style={{
                      flex,
                      paddingVertical: 11,
                      paddingHorizontal: 5,
                      minWidth: 0,
                    }}
                  >
                    {valueIndex === 0 ? (
                      <View style={{ gap: 5 }}>
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 7,
                          }}
                        >
                          <View
                            style={{
                              width: 7,
                              height: 7,
                              borderRadius: 4,
                              backgroundColor:
                                split.state === "upcoming"
                                  ? "#5F6876"
                                  : section.tint,
                            }}
                          />
                          <Text
                            variant="bodySmall"
                            style={{
                              color:
                                split.state === "upcoming"
                                  ? "#99A2AF"
                                  : "#FFFFFF",
                              fontWeight: "900",
                              flex: 1,
                            }}
                            numberOfLines={2}
                          >
                            {value}
                          </Text>
                        </View>
                        {split.distanceLabel || split.cutoffLabel ? (
                          <Text
                            variant="caption"
                            style={{ color: "#8F98A6", fontWeight: "700" }}
                            numberOfLines={2}
                          >
                            {[
                              split.distanceLabel
                                ? `${split.distanceLabel} total`
                                : "",
                              split.cutoffLabel
                                ? `Cutoff ${split.cutoffLabel}`
                                : "",
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </Text>
                        ) : null}
                        {current ? (
                          <SplitStateBadge state={split.state} />
                        ) : null}
                      </View>
                    ) : (
                      <Text
                        variant="caption"
                        style={{
                          color: value === "—" ? "#697381" : "#E7EAF0",
                          fontWeight: "800",
                          fontVariant: ["tabular-nums"],
                          letterSpacing: 0,
                        }}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.72}
                      >
                        {value}
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
          </View>
        );
      })}
    </Card>
  );
}

function LegSectionCard({ section }: { section: LegSection }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(true);

  function toggle() {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((value) => !value);
  }

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <SectionHeader section={section} expanded={expanded} onToggle={toggle} />
      {expanded ? (
        Platform.OS === "web" ? (
          <WebLegTable section={section} />
        ) : (
          <View style={{ gap: theme.spacing.sm }}>
            <TimingColumnsHeader />
            {section.rows.map((split) => (
              <MobileSplitRow key={split.key} split={split} section={section} />
            ))}
          </View>
        )
      ) : null}
    </View>
  );
}

function derivedSectionColor(section: AthleteRaceSection): string {
  if (section.type === "transition") return "#8B95A5";
  const type = normalize(section.legType);
  if (type.includes("SWIM")) return "#2E9AFE";
  if (type.includes("BIKE") || type.includes("CYCLE")) return "#22C55E";
  if (type.includes("RUN")) return "#F97316";
  return "#A3AAB7";
}

function derivedStatusLabel(section: AthleteRaceSection): string {
  if (section.status === "completed") return "Completed";
  if (section.status === "in_progress")
    return section.type === "transition" ? "In Transition" : "In Progress";
  if (section.status === "invalid") return "Timing under review";
  if (section.status === "missing_data") return "Awaiting timing read";
  if (["dnf", "dns", "dnq", "disqualified"].includes(section.status))
    return section.status.toUpperCase();
  return "Not Started";
}

function LiveSectionDuration({
  section,
  color,
}: {
  section: AthleteRaceSection;
  color: string;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const startedAtMs = section.startedAt ? Date.parse(section.startedAt) : Number.NaN;
  const shouldTick = section.type === "transition" &&
    section.status === "in_progress" &&
    Number.isFinite(startedAtMs);

  useEffect(() => {
    if (!shouldTick) return;
    const interval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [shouldTick, startedAtMs]);

  const liveDuration = shouldTick
    ? Math.max(
        section.durationSeconds ?? 0,
        Math.floor((nowMs - startedAtMs) / 1000),
      )
    : section.durationSeconds;

  return (
    <Text variant="headline" style={{ color, fontWeight: "900" }}>
      {formatDuration(liveDuration)}
    </Text>
  );
}

function DerivedRaceSectionCard({ section }: { section: AthleteRaceSection }) {
  const theme = useTheme();
  const tint = derivedSectionColor(section);
  return (
    <Card
      elevated={false}
      style={{
        gap: theme.spacing.sm,
        backgroundColor: "#10151D",
        borderColor: section.status === "in_progress" ? tint : "#26303B",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: theme.spacing.sm,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View
            style={{
              minWidth: 42,
              height: 42,
              paddingHorizontal: 8,
              borderRadius: 21,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: `${tint}22`,
              borderWidth: 1,
              borderColor: `${tint}88`,
            }}
          >
            <Text variant="label" style={{ color: tint, fontWeight: "900" }}>
              {section.shortLabel ?? section.title.slice(0, 2).toUpperCase()}
            </Text>
          </View>
          <View style={{ gap: 2 }}>
            <Text variant="headline" style={{ color: "#FFFFFF" }}>
              {section.type === "transition"
                ? `${section.shortLabel} · Transition`
                : section.title}
            </Text>
            <Text variant="caption" style={{ color: "#9AA3AF" }}>
              {derivedStatusLabel(section)}
            </Text>
          </View>
        </View>
        <LiveSectionDuration section={section} color={tint} />
      </View>
      {section.averageMetric ? (
        <Text variant="caption" style={{ color: "#B6BEC9" }}>
          Average {section.averageMetric}
        </Text>
      ) : null}
      {section.rows.length > 0 ? <TimingColumnsHeader /> : null}
      <View style={{ gap: 8 }}>
        {section.rows.map((row) => (
          <View
            key={`${section.id}:${row.key}`}
            style={{
              padding: 10,
              gap: 8,
              borderRadius: theme.radius.medium,
              backgroundColor: "#0B1016",
              borderWidth: 1,
              borderColor: "#26303B",
            }}
          >
            <Text
              variant="bodySmall"
              style={{ color: "#FFFFFF", fontWeight: "900" }}
            >
              {row.name}
            </Text>
            {row.distanceInLegKm != null ? (
              <Text variant="caption" style={{ color: "#8F98A6" }}>
                {row.distanceInLegKm} km {section.legType?.toLowerCase() || "leg"}
              </Text>
            ) : null}
            <TimingValuesRow
              tint={tint}
              values={[
                row.timeOfDay || "—",
                formatDuration(row.legElapsedSeconds),
                row.metric || "—",
                row.rank || "—",
              ]}
            />
          </View>
        ))}
      </View>
    </Card>
  );
}

function singleDisciplineRaceTiming(
  timing: AthleteRaceTiming,
  raceCategory?: string,
  contest?: string,
): AthleteRaceTiming {
  const courseKind = resolveCourseKind(raceCategory, contest);
  if (courseKind !== "swim" && courseKind !== "bike" && courseKind !== "run") {
    return timing;
  }

  const title =
    courseKind === "swim" ? "Swim" : courseKind === "bike" ? "Bike" : "Run";
  const shortLabel =
    courseKind === "swim" ? "SW" : courseKind === "bike" ? "BK" : "RN";
  const staleDiscipline = /^(?:swim|bike|run)\b/i;
  return {
    ...timing,
    sections: timing.sections
      .filter((section) => section.type !== "transition")
      .map((section) => ({
        ...section,
        title,
        shortLabel,
        legType: courseKind,
        rows: section.rows.map((row) => ({
          ...row,
          name: staleDiscipline.test(row.name)
            ? row.name.replace(staleDiscipline, title)
            : row.name,
        })),
      })),
  };
}

function DerivedRaceTiming({
  timing,
  raceCategory,
  contest,
}: {
  timing: AthleteRaceTiming;
  raceCategory?: string;
  contest?: string;
}) {
  const theme = useTheme();
  const resolvedTiming = singleDisciplineRaceTiming(
    timing,
    raceCategory,
    contest,
  );
  const sections = resolvedTiming.sections.filter((section) => {
    const genericTransitionRows =
      section.rows.length > 0 &&
      section.rows.every((row) => {
        const identity = normalize(`${row.key} ${row.name}`);
        return (
          identity.includes("TRANSITION") &&
          !identity.includes("T1") &&
          !identity.includes("T2")
        );
      });
    return !genericTransitionRows;
  });
  const raceFinished = sections.length > 0 && sections.at(-1)?.status === "completed";
  return (
    <SectionCard title="LIVE SPLIT FLOW">
      <View
        style={{
          marginHorizontal: -theme.spacing.base,
          padding: theme.spacing.base,
          gap: theme.spacing.md,
          backgroundColor: "#070A0F",
          borderRadius: theme.radius.xl,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <View style={{ flex: 1, gap: 3 }}>
            <Text variant="bodySmall" style={{ color: "#8F98A6" }}>
              Contest sport legs and transitions from official timing reads.
            </Text>
          </View>
          <View style={{ alignItems: "flex-end", gap: 2 }}>
            <Text
              variant="caption"
              style={{ color: "#8F98A6", fontWeight: "900" }}
            >
              {raceFinished ? "OVERALL" : "LIVE ELAPSED"}
            </Text>
            <Text variant="headline" style={{ color: "#FFFFFF" }}>
              {formatDuration(resolvedTiming.overallTimeSeconds)}
            </Text>
          </View>
        </View>
        {sections.map((section) => (
          <DerivedRaceSectionCard key={section.id} section={section} />
        ))}
        <ProvisionalNotice />
      </View>
    </SectionCard>
  );
}

function ProvisionalNotice() {
  return (
    <Text
      variant="caption"
      style={{
        color: "#8F98A6",
        alignSelf: "center",
        maxWidth: 300,
        textAlign: "center",
        lineHeight: 17,
      }}
    >
      <Text variant="caption" style={{ color: "#C7CDD6", fontWeight: "900" }}>
        Provisional:
      </Text>{" "}
      Event times and places may be updated.
    </Text>
  );
}

/**
 * Premium leg-grouped race timing view. Rows are contest-scoped timing points
 * merged with athlete reads; future rows remain visible with dash values.
 */
export function TimelineCard({
  splits,
  raceTiming,
  contest,
  raceCategory,
}: {
  splits: TimelineSplit[];
  raceTiming?: AthleteRaceTiming;
  contest?: string;
  raceCategory?: string;
}) {
  const theme = useTheme();
  const sections = useMemo(
    () => groupSections(splits, raceCategory, contest),
    [contest, raceCategory, splits],
  );

  if (raceTiming?.sections.length) {
    return (
      <DerivedRaceTiming
        timing={raceTiming}
        raceCategory={raceCategory}
        contest={contest}
      />
    );
  }

  if (sections.length === 0) {
    return (
      <SectionCard title="LIVE SPLIT FLOW">
        <Text variant="body" color="textMuted">
          The official split configuration for this contest has not been
          published yet.
        </Text>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="LIVE SPLIT FLOW">
      <View
        style={{
          marginHorizontal: -theme.spacing.base,
          paddingHorizontal: theme.spacing.base,
          paddingVertical: theme.spacing.base,
          gap: theme.spacing.md,
          backgroundColor: "#070A0F",
          borderRadius: theme.radius.xl,
        }}
      >
        <View style={{ gap: 4 }}>
          <Text
            variant="headline"
            style={{ color: "#FFFFFF", fontWeight: "900" }}
          >
            Live Split Flow
          </Text>
          <Text variant="bodySmall" style={{ color: "#8F98A6" }}>
            Follow each race leg with time of day, elapsed time, pace, and rank.
          </Text>
        </View>
        <LegProgress sections={sections} />
        {sections.map((section) => (
          <LegSectionCard key={section.key} section={section} />
        ))}
        <ProvisionalNotice />
      </View>
    </SectionCard>
  );
}
