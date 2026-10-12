import { Fragment, useMemo, useState } from "react";
import {
  PanResponder,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from "react-native";
import Svg, {
  Circle,
  Defs,
  Line,
  LinearGradient,
  Path,
  Rect,
  Stop,
  Text as SvgText,
} from "react-native-svg";

import type { CourseGeometry } from "@/core/types";
import { useTheme } from "@/core/theme";
import { Button, Card, Icon, Skeleton, Text } from "@/shared/components";

import {
  buildElevationProfiles,
  combineElevationProfiles,
  nearestElevationPoint,
  type ElevationProfileSection,
  type ElevationPoint,
  type ElevationRouteProfile,
} from "../elevation";

export type ElevationAthleteMarker = {
  routeSegment: string;
  distanceKm: number;
  label: string;
  color?: string;
};

type ElevationProfilePanelProps = {
  geometry?: CourseGeometry | null;
  loading?: boolean;
  error?: boolean;
  athlete?: ElevationAthleteMarker | null;
  onRetry?: () => void;
  onClose: () => void;
};

type CombinedElevationProfileProps = {
  geometry?: CourseGeometry | null;
  loading?: boolean;
  error?: boolean;
  athlete?: ElevationAthleteMarker | null;
};

function normalized(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function routeMatches(
  profileSegment: string,
  segment: string,
  runRoutes: number,
) {
  const athleteRoute = normalized(segment);
  const profileRoute = normalized(profileSegment);
  if (athleteRoute === profileRoute) return true;
  return (
    athleteRoute === "run" && profileRoute.startsWith("run") && runRoutes === 1
  );
}

function smoothPath(
  points: ElevationPoint[],
  toX: (distance: number) => number,
  toY: (elevation: number) => number,
): string {
  if (points.length === 0) return "";
  if (points.length === 1)
    return `M ${toX(points[0].distance)} ${toY(points[0].elevation)}`;
  let path = `M ${toX(points[0].distance).toFixed(1)} ${toY(points[0].elevation).toFixed(1)}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const midX = (toX(current.distance) + toX(next.distance)) / 2;
    const midY = (toY(current.elevation) + toY(next.elevation)) / 2;
    path += ` Q ${toX(current.distance).toFixed(1)} ${toY(current.elevation).toFixed(1)} ${midX.toFixed(1)} ${midY.toFixed(1)}`;
  }
  const last = points[points.length - 1];
  return `${path} L ${toX(last.distance).toFixed(1)} ${toY(last.elevation).toFixed(1)}`;
}

function ElevationChart({
  profile,
  athlete,
}: {
  profile: ElevationRouteProfile;
  athlete?: ElevationAthleteMarker | null;
}) {
  const theme = useTheme();
  const [width, setWidth] = useState(320);
  const [selected, setSelected] = useState<ElevationPoint | null>(null);
  const height = 190;
  const chartTop = 38;
  const chartBottom = 158;
  const paddingX = 14;
  const chartWidth = Math.max(1, width - paddingX * 2);
  const sections: ElevationProfileSection[] =
    profile.sections ?? [
      {
        id: profile.id,
        segment: profile.segment,
        label: profile.label,
        color: profile.color,
        startDistance: 0,
        endDistance: profile.statistics?.totalDistanceKm ?? 0,
        points: profile.points,
        drawPoints: profile.drawPoints,
      },
    ];
  const stats = profile.statistics!;
  const terrain = profile.terrain!;
  const elevationSpan = Math.max(stats.maxElevationM - stats.minElevationM, 1);
  const toX = (distance: number) =>
    paddingX + (distance / Math.max(stats.totalDistanceKm, 0.001)) * chartWidth;
  const toY = (elevation: number) =>
    chartBottom -
    ((elevation - stats.minElevationM) / elevationSpan) *
      (chartBottom - chartTop);
  const sectionPaths = sections
    .filter((section) => section.drawPoints.length > 1)
    .map((section) => {
      const linePath = smoothPath(section.drawPoints, toX, toY);
      const areaPath = `${linePath} L ${toX(section.endDistance)} ${chartBottom} L ${toX(section.startDistance)} ${chartBottom} Z`;
      return { section, linePath, areaPath };
    });
  const gradientKey = profile.id.replace(/[^a-z0-9]/gi, "");
  const choosePoint = (locationX: number) => {
    const ratio = Math.max(0, Math.min(1, (locationX - paddingX) / chartWidth));
    setSelected(
      nearestElevationPoint(profile.points, ratio * stats.totalDistanceKm) ??
        null,
    );
  };
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dx) > 4 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.2,
        onPanResponderGrant: (event) =>
          choosePoint(event.nativeEvent.locationX),
        onPanResponderMove: (event) => choosePoint(event.nativeEvent.locationX),
        onPanResponderTerminationRequest: () => true,
      }),
    // The responder must be rebuilt when chart geometry or profile changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chartWidth, profile.id, stats.totalDistanceKm],
  );
  const runSections = sections.filter((section) =>
    section.segment.startsWith("run"),
  );
  const athleteSection = athlete
    ? sections.find((section) =>
        routeMatches(section.segment, athlete.routeSegment, runSections.length),
      )
    : undefined;
  const livePoint =
    athlete && athleteSection
      ? nearestElevationPoint(
          athleteSection.points,
          athleteSection.startDistance + athlete.distanceKm,
        )
      : undefined;
  const tooltipX = selected ? toX(selected.distance) : 0;
  const tooltipWidth = 112;
  const tooltipLeft = Math.max(
    4,
    Math.min(width - tooltipWidth - 4, tooltipX - tooltipWidth / 2),
  );

  const onLayout = (event: LayoutChangeEvent) => {
    const nextWidth = event.nativeEvent.layout.width;
    if (nextWidth > 0 && Math.abs(nextWidth - width) > 1) setWidth(nextWidth);
  };

  return (
    <View
      onLayout={onLayout}
      accessible
      accessibilityLabel={`${profile.label} elevation profile. ${terrain.gradeLabel}. Gain ${Math.round(stats.totalGainM)} metres, loss ${Math.round(stats.totalLossM)} metres.`}
      style={[styles.chart, { borderColor: theme.colors.border }]}
      onTouchEnd={(event) => choosePoint(event.nativeEvent.locationX)}
      {...responder.panHandlers}
    >
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        <Defs>
          <LinearGradient id={`fill${gradientKey}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#dc2626" stopOpacity={0.45} />
            <Stop offset="45%" stopColor={terrain.color} stopOpacity={0.35} />
            <Stop offset="100%" stopColor="#16a34a" stopOpacity={0.28} />
          </LinearGradient>
          <LinearGradient
            id={`stroke${gradientKey}`}
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <Stop offset="0%" stopColor="#dc2626" />
            <Stop offset="45%" stopColor={terrain.color} />
            <Stop offset="100%" stopColor="#16a34a" />
          </LinearGradient>
        </Defs>
        {[0, 1, 2, 3].map((index) => {
          const y = chartTop + ((chartBottom - chartTop) / 3) * index;
          return (
            <Line
              key={`h-${index}`}
              x1={paddingX}
              x2={paddingX + chartWidth}
              y1={y}
              y2={y}
              stroke={theme.colors.border}
              strokeDasharray="4 5"
              strokeOpacity={0.75}
            />
          );
        })}
        {[0, 1, 2, 3, 4].map((index) => {
          const x = paddingX + (chartWidth / 4) * index;
          return (
            <Line
              key={`v-${index}`}
              x1={x}
              x2={x}
              y1={chartTop}
              y2={chartBottom}
              stroke={theme.colors.border}
              strokeDasharray="4 5"
              strokeOpacity={0.55}
            />
          );
        })}
        {sectionPaths.map(({ section, areaPath }) => (
          <Path
            key={`area-${section.id}`}
            d={areaPath}
            fill={`url(#fill${gradientKey})`}
          />
        ))}
        {sectionPaths.map(({ section, linePath }) => (
          <Path
            key={`line-${section.id}`}
            d={linePath}
            fill="none"
            stroke={`url(#stroke${gradientKey})`}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {sections.map((section) =>
          section.endDistance > section.startDistance ? (
            <Fragment key={`label-${section.id}`}>
              <Line
                x1={toX(section.startDistance)}
                x2={toX(section.endDistance)}
                y1={30}
                y2={30}
                stroke={section.color}
                strokeWidth={4}
                strokeLinecap="round"
              />
              <SvgText
                x={(toX(section.startDistance) + toX(section.endDistance)) / 2}
                y={25}
                fill={section.color}
                fontSize={9}
                fontWeight="bold"
                textAnchor="middle"
              >
                {section.label.toUpperCase()}
              </SvgText>
            </Fragment>
          ) : null,
        )}
        {livePoint ? (
          <>
            <Line
              x1={toX(livePoint.distance)}
              x2={toX(livePoint.distance)}
              y1={chartTop}
              y2={chartBottom}
              stroke={athlete?.color ?? theme.colors.accent}
              strokeWidth={2}
            />
            <Circle
              cx={toX(livePoint.distance)}
              cy={toY(livePoint.elevation)}
              r={6}
              fill={athlete?.color ?? theme.colors.accent}
              stroke="#FFFFFF"
              strokeWidth={2}
            />
            <SvgText
              x={toX(livePoint.distance)}
              y={chartTop - 7}
              fill={theme.colors.textPrimary}
              fontSize={9}
              fontWeight="bold"
              textAnchor="middle"
            >
              {athlete?.label}
            </SvgText>
          </>
        ) : null}
        {selected ? (
          <>
            <Line
              x1={tooltipX}
              x2={tooltipX}
              y1={chartTop}
              y2={chartBottom}
              stroke={theme.colors.textPrimary}
              strokeDasharray="4 4"
              strokeOpacity={0.8}
            />
            <Circle
              cx={tooltipX}
              cy={toY(selected.elevation)}
              r={5}
              fill={terrain.color}
              stroke="#FFFFFF"
              strokeWidth={2}
            />
            <Rect
              x={tooltipLeft}
              y={2}
              width={tooltipWidth}
              height={20}
              rx={8}
              fill={theme.colors.textPrimary}
            />
            <SvgText
              x={tooltipLeft + tooltipWidth / 2}
              y={16}
              fill={theme.colors.background}
              fontSize={10}
              fontWeight="bold"
              textAnchor="middle"
            >
              {`${selected.distance.toFixed(2)} km · ${Math.round(selected.elevation)} m`}
            </SvgText>
          </>
        ) : null}
        <SvgText
          x={paddingX}
          y={182}
          fill={theme.colors.textMuted}
          fontSize={9}
        >
          0 km
        </SvgText>
        <SvgText
          x={paddingX + chartWidth}
          y={182}
          fill={theme.colors.textMuted}
          fontSize={9}
          textAnchor="end"
        >
          {stats.totalDistanceKm.toFixed(1)} km
        </SvgText>
      </Svg>
    </View>
  );
}

function SummaryTile({
  icon,
  title,
  value,
  detail,
  profile,
}: {
  icon: "mountain" | "gauge";
  title: string;
  value: string;
  detail: string;
  profile: ElevationRouteProfile;
}) {
  const terrain = profile.terrain!;
  return (
    <View
      style={[
        styles.summaryTile,
        { backgroundColor: terrain.background, borderColor: terrain.border },
      ]}
    >
      <Icon name={icon} size={20} colorValue={terrain.color} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          variant="caption"
          style={{ color: terrain.color, fontWeight: "900" }}
        >
          {title}
        </Text>
        <Text
          variant="bodySmall"
          style={{ color: "#0F172A", fontWeight: "900" }}
        >
          {value}
        </Text>
        <Text variant="caption" style={{ color: "#475569" }}>
          {detail}
        </Text>
      </View>
    </View>
  );
}

/** One combined bike + run chart. Section labels stay aligned above each leg. */
export function CombinedElevationProfile({
  geometry,
  loading = false,
  error = false,
  athlete,
}: CombinedElevationProfileProps) {
  const theme = useTheme();
  const profiles = useMemo(() => buildElevationProfiles(geometry), [geometry]);
  const routes = profiles.filter((profile) => profile.segment !== "swim");
  const combined = useMemo(
    () => combineElevationProfiles(profiles),
    [profiles],
  );

  if (loading) {
    return <Skeleton height={190} radius={theme.radius.medium} />;
  }
  if (error) {
    return (
      <Text variant="bodySmall" color="textSecondary">
        Bike and run elevation could not be loaded.
      </Text>
    );
  }
  if (routes.length === 0 || !combined?.statistics || combined.points.length < 2) {
    return null;
  }

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <View style={{ gap: 2 }}>
        <Text variant="label" color="accentSecondary">
          BIKE + RUN ELEVATION
        </Text>
        <Text variant="caption" color="textMuted">
          One combined profile · bike and run are marked above their sections.
        </Text>
      </View>
      <ElevationChart profile={combined} athlete={athlete} />
      <View style={styles.statsRow}>
        {[
          `Gain ${Math.round(combined.statistics.totalGainM)} m`,
          `Loss ${Math.round(combined.statistics.totalLossM)} m`,
          `Min ${Math.round(combined.statistics.minElevationM)} m`,
          `Max ${Math.round(combined.statistics.maxElevationM)} m`,
        ].map((label) => (
          <View
            key={label}
            style={[
              styles.statPill,
              { backgroundColor: theme.colors.surfaceSunken },
            ]}
          >
            <Text variant="caption" color="textSecondary">
              {label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function ElevationProfilePanel({
  geometry,
  loading = false,
  error = false,
  athlete,
  onRetry,
  onClose,
}: ElevationProfilePanelProps) {
  const theme = useTheme();
  const profiles = useMemo(() => buildElevationProfiles(geometry), [geometry]);
  const routes = profiles.filter((profile) => profile.segment !== "swim");
  const selected = useMemo(() => combineElevationProfiles(profiles), [profiles]);

  return (
    <View
      style={[
        styles.panel,
        { left: theme.spacing.base, right: theme.spacing.base },
      ]}
    >
      <Card style={styles.card}>
        <View style={styles.header}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="headline">Elevation Dynamics</Text>
            <Text variant="bodySmall" color="textMuted">
              Combined bike and run elevation profile.
            </Text>
          </View>
          <Button label="Close" size="sm" variant="ghost" onPress={onClose} />
        </View>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
        >
          {loading ? (
            <View style={{ gap: theme.spacing.sm }}>
              <Skeleton height={74} radius={theme.radius.medium} />
              <Skeleton height={178} radius={theme.radius.medium} />
            </View>
          ) : error ? (
            <View style={styles.state}>
              <Text variant="bodySmall" color="textSecondary">
                The elevation GPX could not be loaded. The course map remains
                available.
              </Text>
              {onRetry ? (
                <Button label="Retry" size="sm" onPress={onRetry} />
              ) : null}
            </View>
          ) : routes.length === 0 &&
            profiles.some((profile) => profile.segment === "swim") ? (
            <Text variant="bodySmall" color="textSecondary">
              No elevation profile for swim leg.
            </Text>
          ) : !selected ? (
            <Text variant="bodySmall" color="textSecondary">
              No elevation data available for this route.
            </Text>
          ) : (
            <>
              {selected.loadError ? (
                <View style={styles.state}>
                  <Text variant="bodySmall" color="textSecondary">
                    One or more bike or run GPX files could not be loaded.
                  </Text>
                  {onRetry ? (
                    <Button label="Retry" size="sm" onPress={onRetry} />
                  ) : null}
                </View>
              ) : !selected.statistics || selected.points.length < 2 ? (
                <Text variant="bodySmall" color="textSecondary">
                  No elevation data available for this route.
                </Text>
              ) : (
                <>
                  <View style={styles.summaryRow}>
                    <SummaryTile
                      icon="mountain"
                      title="TERRAIN"
                      value={selected.terrain!.gradeLabel}
                      detail={`Avg climb ${selected.statistics.averageClimbPercent.toFixed(2)}% • P90 slope ${selected.statistics.p90Slope.toFixed(1)}%`}
                      profile={selected}
                    />
                    <SummaryTile
                      icon="gauge"
                      title="SPEED IMPACT"
                      value={selected.terrain!.speedLabel}
                      detail={`Gain ${Math.round(selected.statistics.totalGainM)} m • Loss ${Math.round(selected.statistics.totalLossM)} m`}
                      profile={selected}
                    />
                  </View>
                  <ElevationChart
                    profile={selected}
                    athlete={athlete}
                  />
                  <View style={styles.statsRow}>
                    {[
                      `Total gain ${Math.round(selected.statistics.totalGainM)} m`,
                      `Total loss ${Math.round(selected.statistics.totalLossM)} m`,
                      `Min ${Math.round(selected.statistics.minElevationM)} m`,
                      `Max ${Math.round(selected.statistics.maxElevationM)} m`,
                      `Max slope ${selected.statistics.maxSlope.toFixed(1)}%`,
                    ].map((label) => (
                      <View
                        key={label}
                        style={[
                          styles.statPill,
                          { backgroundColor: theme.colors.surfaceSunken },
                        ]}
                      >
                        <Text variant="caption" color="textSecondary">
                          {label}
                        </Text>
                      </View>
                    ))}
                  </View>
                  <View
                    style={[
                      styles.explanation,
                      { borderColor: theme.colors.border },
                    ]}
                  >
                    <Text variant="caption" color="textSecondary">
                      Red: tough climbing, slower pace expected.{"\n"}
                      Blue/Orange: medium or rolling terrain, controlled pacing
                      helps.{"\n"}
                      Green: flatter route, better speed potential.
                    </Text>
                  </View>
                </>
              )}
            </>
          )}
        </ScrollView>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: "absolute",
    bottom: 16,
    maxHeight: "76%",
    zIndex: 60,
    elevation: 60,
  },
  card: { gap: 12, paddingBottom: 10 },
  header: { flexDirection: "row", alignItems: "center", gap: 10 },
  scroll: { flexGrow: 0 },
  content: { gap: 12, paddingBottom: 4 },
  summaryRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  summaryTile: {
    flex: 1,
    minWidth: 145,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 10,
    borderRadius: 14,
    borderWidth: 1,
  },
  chart: {
    width: "100%",
    minHeight: 178,
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
  },
  statsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 8,
  },
  statPill: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: 999 },
  explanation: { padding: 10, borderRadius: 12, borderWidth: 1 },
  state: { gap: 12, alignItems: "flex-start" },
});
