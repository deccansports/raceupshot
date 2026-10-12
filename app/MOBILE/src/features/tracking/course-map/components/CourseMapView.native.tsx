import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import MapView, {
  AnimatedRegion,
  Marker,
  Polyline,
  PROVIDER_GOOGLE,
  type Camera,
  type LatLng as MapLatLng,
} from "react-native-maps";

import { brand, useTheme, type SemanticColors } from "@/core/theme";
import { formatCutoffSummary, avatarColor, getInitials } from "@/core/utils";
import { Avatar, Card, Icon, Text } from "@/shared/components";

import {
  buildCourseTransitionConnectors,
  type CourseMarkerView,
} from "../mappers";
import { athleteBibLabelMetrics } from "../athleteBibLabel";
import type { CourseMapViewProps } from "./CourseMapView";
import { KmMarkerActionModal } from "./KmMarkerActionModal";

const DEFAULT_REGION = {
  latitude: 15.4909,
  longitude: 73.8278,
  latitudeDelta: 0.12,
  longitudeDelta: 0.12,
};

const COURSE_EDGE_PADDING = { top: 48, right: 48, bottom: 48, left: 48 };

function kmMarkerStrideForZoom(zoom: number): number {
  if (zoom < 16) return 20;
  if (zoom < 17) return 10;
  if (zoom < 18) return 5;
  if (zoom < 19) return 2;
  return 1;
}

function isGpxDistanceMarker(marker: CourseMarkerView): boolean {
  return (
    marker.sourceId?.startsWith("gpx-distance-") === true ||
    (marker.source === "geometry" &&
      marker.kind === "timing" &&
      marker.distanceKm != null)
  );
}

function shouldShowKmMarker(
  marker: CourseMarkerView,
  zoom: number,
  maximumCourseKm: number,
): boolean {
  const km = marker.distanceKm;
  if (km == null || !Number.isFinite(km)) return true;
  if (maximumCourseKm > 0 && maximumCourseKm <= 10) return true;
  const wholeKm = Math.round(km);
  const segment = String(marker.segment ?? "")
    .trim()
    .toLowerCase();
  const preserveSwimFirstKm =
    wholeKm === 1 && (segment === "swim" || segment === "swimming");
  return preserveSwimFirstKm || wholeKm % kmMarkerStrideForZoom(zoom) === 0;
}

function markerCourseKey(marker: CourseMarkerView): string {
  const segment = String(marker.segment ?? "")
    .trim()
    .toLowerCase();
  if (segment.startsWith("swim")) return "swim";
  if (segment.startsWith("bike") || segment.startsWith("cycl")) return "bike";
  if (segment.startsWith("run")) return "run";
  return segment;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function progressCoordinates(
  coordinates: MapLatLng[],
  progressFraction: number | undefined,
): MapLatLng[] {
  if (coordinates.length < 2 || progressFraction == null) return [];
  const progress = clamp01(progressFraction);
  const scaled = progress * (coordinates.length - 1);
  const index = Math.min(coordinates.length - 2, Math.floor(scaled));
  const ratio = scaled - index;
  const current = coordinates[index];
  const next = coordinates[index + 1];
  return [
    ...coordinates.slice(0, index + 1),
    {
      latitude: current.latitude + (next.latitude - current.latitude) * ratio,
      longitude:
        current.longitude + (next.longitude - current.longitude) * ratio,
    },
  ];
}

function nearestPathWindow(
  coordinates: MapLatLng[],
  position: { lat: number; lng: number },
) {
  if (coordinates.length < 2) return coordinates;
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  coordinates.forEach((coordinate, index) => {
    const latitudeDelta = coordinate.latitude - position.lat;
    const longitudeDelta = coordinate.longitude - position.lng;
    const distance =
      latitudeDelta * latitudeDelta + longitudeDelta * longitudeDelta;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });
  const radius = Math.max(
    8,
    Math.min(48, Math.round(coordinates.length * 0.06)),
  );
  return coordinates.slice(
    Math.max(0, nearestIndex - radius),
    Math.min(coordinates.length, nearestIndex + radius + 1),
  );
}

type MapAthlete = NonNullable<CourseMapViewProps["athletes"]>[number];

function spreadOverlappingAthlete(
  athletes: MapAthlete[],
  athlete: MapAthlete,
  index: number,
): MapAthlete {
  const positionKey = `${athlete.position.lat.toFixed(5)}:${athlete.position.lng.toFixed(5)}`;
  const cluster = athletes
    .map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
    .filter(
      ({ candidate }) =>
        `${candidate.position.lat.toFixed(5)}:${candidate.position.lng.toFixed(5)}` ===
        positionKey,
    );
  if (cluster.length < 2) return athlete;
  const clusterIndex = cluster.findIndex(
    ({ candidateIndex }) => candidateIndex === index,
  );
  if (clusterIndex < 0) return athlete;
  const angle = (2 * Math.PI * clusterIndex) / cluster.length - Math.PI / 2;
  const radius = 0.00028 * (1 + Math.floor(clusterIndex / 8));
  const longitudeScale = Math.max(
    0.35,
    Math.cos((athlete.position.lat * Math.PI) / 180),
  );
  return {
    ...athlete,
    position: {
      lat: athlete.position.lat + Math.sin(angle) * radius,
      lng: athlete.position.lng + (Math.cos(angle) * radius) / longitudeScale,
    },
  };
}

function athleteMarkerDescription(athlete: MapAthlete): string {
  return [
    athlete.bib ? `Bib ${athlete.bib}` : null,
    athlete.currentLeg || null,
    athlete.estimatedDistanceKm != null && athlete.totalDistanceKm
      ? `Estimated: ${athlete.estimatedDistanceKm.toFixed(1)} / ${athlete.totalDistanceKm.toFixed(1)} km`
      : null,
    athlete.lastOfficialLabel
      ? `Last official: ${athlete.lastOfficialLabel}`
      : null,
    athlete.nextCheckpointLabel ? `Next: ${athlete.nextCheckpointLabel}` : null,
    athlete.awaitingCheckpointConfirmation
      ? "Awaiting official timing confirmation"
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function AthleteMarkerBody({
  athlete,
  showLabel,
}: {
  athlete: MapAthlete;
  showLabel: boolean;
}) {
  const bibMetrics = athleteBibLabelMetrics(
    athlete.bib ?? getInitials(athlete.name),
  );
  const theme = useTheme();
  return (
    <View
      style={{
        width: athlete.selected ? 50 : 38,
        height: athlete.selected ? 50 : 38,
        borderRadius: athlete.selected ? 14 : 19,
        padding: 3,
        backgroundColor: avatarColor(athlete.colorSeed ?? athlete.name),
        borderWidth: athlete.selected ? 3 : 2,
        borderColor: theme.colors.surface,
        alignItems: "center",
        justifyContent: "center",
        shadowColor: "#000",
        shadowOpacity: athlete.selected ? 0.3 : 0.18,
        shadowRadius: athlete.selected ? 8 : 4,
        shadowOffset: { width: 0, height: 3 },
        elevation: athlete.selected ? 9 : 5,
      }}
    >
      <Avatar
        name={athlete.name}
        uri={athlete.photoUrl}
        colorSeed={athlete.colorSeed}
        size={athlete.selected ? 42 : 30}
      />
      {showLabel ? (
        <View
          style={[
            styles.athleteLabel,
            {
              backgroundColor: theme.colors.textPrimary,
              width: bibMetrics.width,
              transform: [{ translateX: -(bibMetrics.width / 2) }],
            },
          ]}
        >
          <Text
            variant="caption"
            style={{
              color: theme.colors.background,
              fontWeight: "900",
              fontSize: bibMetrics.fontSize,
            }}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.65}
          >
            {bibMetrics.label}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function AnimatedSelectedAthleteMarker({
  athlete,
  showLabel,
  onPress,
}: {
  athlete: MapAthlete;
  showLabel: boolean;
  onPress?: () => void;
}) {
  const [tracksViewChanges, setTracksViewChanges] = useState(true);
  const [coordinate] = useState(
    () =>
      new AnimatedRegion({
        latitude: athlete.position.lat,
        longitude: athlete.position.lng,
        latitudeDelta: 0,
        longitudeDelta: 0,
      }),
  );

  useEffect(() => {
    coordinate
      .timing({
        latitude: athlete.position.lat,
        longitude: athlete.position.lng,
        latitudeDelta: 0,
        longitudeDelta: 0,
        duration: 700,
        useNativeDriver: false,
      } as never)
      .start();
  }, [athlete.position.lat, athlete.position.lng, coordinate]);

  useEffect(() => {
    setTracksViewChanges(true);
    const timer = setTimeout(() => setTracksViewChanges(false), 900);
    return () => clearTimeout(timer);
  }, [athlete.bib, athlete.name, athlete.photoUrl, showLabel]);

  return (
    <Marker.Animated
      coordinate={coordinate as never}
      zIndex={1_000}
      tracksViewChanges={tracksViewChanges}
      title={athlete.name}
      description={athleteMarkerDescription(athlete)}
      anchor={{ x: 0.5, y: 0.5 }}
      onPress={onPress}
    >
      <AthleteMarkerBody athlete={athlete} showLabel={showLabel} />
    </Marker.Animated>
  );
}

function StaticAthleteMarker({
  athlete,
  showLabel,
  onPress,
}: {
  athlete: MapAthlete;
  showLabel: boolean;
  onPress?: () => void;
}) {
  // Native maps renders custom marker children into a bitmap. Give both Apple
  // Maps and Google Maps a short capture window on mount/label changes, then
  // freeze the bitmap so background watchlist markers stay inexpensive.
  const [tracksViewChanges, setTracksViewChanges] = useState(true);
  useEffect(() => {
    setTracksViewChanges(true);
    const timer = setTimeout(() => setTracksViewChanges(false), 800);
    return () => clearTimeout(timer);
  }, [athlete.bib, athlete.name, athlete.photoUrl, showLabel]);

  return (
    <Marker
      coordinate={{
        latitude: athlete.position.lat,
        longitude: athlete.position.lng,
      }}
      zIndex={100}
      tracksViewChanges={tracksViewChanges}
      title={athlete.name}
      description={athleteMarkerDescription(athlete)}
      anchor={{ x: 0.5, y: 0.5 }}
      onPress={onPress}
    >
      <AthleteMarkerBody athlete={athlete} showLabel={showLabel} />
    </Marker>
  );
}

function AthleteMarker({
  athlete,
  showLabel,
  onPress,
}: {
  athlete: MapAthlete;
  showLabel: boolean;
  onPress?: () => void;
}) {
  if (athlete.selected) {
    return (
      <AnimatedSelectedAthleteMarker
        athlete={athlete}
        showLabel={showLabel}
        onPress={onPress}
      />
    );
  }
  return (
    <StaticAthleteMarker
      athlete={athlete}
      showLabel={showLabel}
      onPress={onPress}
    />
  );
}

const SEGMENT_PALETTE: (keyof SemanticColors)[] = [
  "accentSecondary",
  "success",
  "warning",
  "accent",
  "statusUpcoming",
  "statusFinished",
];

function segmentColor(segment: string): keyof SemanticColors {
  const normalized = String(segment ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "swim") return "accentSecondary";
  if (normalized === "bike") return "success";
  if (normalized === "run") return "warning";
  let hash = 0;
  for (let i = 0; i < normalized.length; i += 1)
    hash = (hash * 31 + normalized.charCodeAt(i)) >>> 0;
  return SEGMENT_PALETTE[hash % SEGMENT_PALETTE.length];
}

function courseStrokeWidth(segment: string, selected: boolean): number {
  const normalized = String(segment ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "swim" || normalized === "swimming") {
    return selected ? 3 : 2;
  }
  return selected ? 6 : 3;
}

const toMapCoords = (path: { lat: number; lng: number }[]): MapLatLng[] =>
  path.map((p) => ({ latitude: p.lat, longitude: p.lng }));

function MarkerIcon({
  kind,
  segment,
  color,
}: {
  kind: "start" | "finish" | "timing" | "transition" | "aid" | "camera";
  segment?: string;
  color: string;
}) {
  const sport = String(segment ?? "").toLowerCase();
  const iconName =
    kind === "finish"
      ? "flag"
      : kind === "transition"
        ? "transition"
        : kind === "timing"
          ? "clock"
          : sport === "swim" || sport === "bike" || sport === "run"
            ? sport
            : "map";
  return <Icon name={iconName} size={11} colorValue={color} />;
}

function markerTone(marker: {
  kind: "start" | "finish" | "timing" | "transition" | "aid" | "camera";
  label?: string;
  segment?: string;
}) {
  const label = String(marker.label ?? "").toLowerCase();
  const segment = String(marker.segment ?? "").toLowerCase();
  if (marker.kind === "finish")
    return { background: "#241A05F2", border: "#FFD60A", icon: "#FFD60A" };
  if (marker.kind === "start")
    return { background: "#E9FFF4F2", border: "#18A56B", icon: "#18A56B" };
  if (marker.kind === "transition")
    return {
      background: "#F3E8FFF2",
      border: "#7C3AED",
      icon: "#7C3AED",
    };
  if (marker.kind === "timing") {
    if (segment === "swim" || label.includes("swim"))
      return {
        background: `${brand.blueDark}F2`,
        border: brand.blueBright,
        icon: brand.blueBright,
      };
    if (segment === "bike" || label.includes("bike"))
      return { background: "#E9FFF4F2", border: "#18A56B", icon: "#18A56B" };
    if (segment === "run" || label.includes("run"))
      return { background: "#FFF4E7F2", border: "#F28C28", icon: "#F28C28" };
    return {
      background: `${brand.blueDark}F2`,
      border: brand.blueBright,
      icon: brand.blueBright,
    };
  }
  if (marker.kind === "aid")
    return { background: "#E9FFF4F2", border: "#18A56B", icon: "#18A56B" };
  return {
    background: "#F0F7FFF2",
    border: brand.blueBright,
    icon: brand.blueBright,
  };
}

function KmMarkerBadge({
  label,
  tone,
}: {
  label?: string;
  tone: { background: string; border: string; icon: string };
}) {
  return (
    <View
      style={[
        styles.kmMarkerBadge,
        { backgroundColor: tone.background, borderColor: tone.border },
      ]}
    >
      <Text
        variant="caption"
        numberOfLines={1}
        style={[styles.kmMarkerLabelText, { color: tone.icon }]}
      >
        {String(label ?? "").replace(/\s*km$/i, "")}
      </Text>
    </View>
  );
}

function openMarkerNavigation(latitude: number, longitude: number) {
  const coordinate = `${latitude},${longitude}`;
  const url =
    Platform.OS === "ios"
      ? `https://maps.apple.com/?daddr=${encodeURIComponent(coordinate)}&dirflg=d`
      : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(coordinate)}`;
  void Linking.openURL(url);
}

function ToggleRow({
  label,
  value,
  onPress,
  enabledLabel = "Visible",
  disabledLabel = "Hidden",
}: {
  label: string;
  value: boolean;
  onPress: () => void;
  enabledLabel?: string;
  disabledLabel?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        paddingVertical: 4,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          variant="caption"
          color="textSecondary"
          style={{ fontWeight: "800" }}
        >
          {label}
        </Text>
        <Text variant="caption" color="textMuted">
          {value ? enabledLabel : disabledLabel}
        </Text>
      </View>
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
          justifyContent: "center",
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

function MapControls({
  expanded,
  showSplitPoints,
  showDistanceLabels,
  showAthleteLabels,
  showRoute,
  onToggleExpanded,
  onToggleSplitPoints,
  onToggleDistanceLabels,
  onToggleAthleteLabels,
  onToggleRoute,
  onZoomIn,
  onZoomOut,
  onFit,
  mapType,
  onMapTypeChange,
}: {
  expanded: boolean;
  showSplitPoints: boolean;
  showDistanceLabels: boolean;
  showAthleteLabels: boolean;
  showRoute: boolean;
  onToggleExpanded: () => void;
  onToggleSplitPoints: () => void;
  onToggleDistanceLabels: () => void;
  onToggleAthleteLabels: () => void;
  onToggleRoute: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  mapType: "standard" | "satellite" | "hybrid" | "terrain";
  onMapTypeChange: (
    mapType: "standard" | "satellite" | "hybrid" | "terrain",
  ) => void;
}) {
  const theme = useTheme();
  if (!expanded) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open map controls"
        onPress={onToggleExpanded}
        style={{
          width: 44,
          height: 44,
          borderRadius: 15,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surfaceElevated,
          shadowColor: "#000",
          shadowOpacity: 0.18,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 8,
        }}
      >
        <Icon name="settings" size={19} color="textPrimary" />
      </Pressable>
    );
  }
  return (
    <View
      style={{
        gap: 10,
        minWidth: 176,
        maxWidth: 220,
        padding: 10,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surfaceElevated,
        shadowColor: "#000",
        shadowOpacity: 0.18,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
        elevation: 8,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <Text
          variant="caption"
          color="textMuted"
          style={{ fontWeight: "800", letterSpacing: 0.4 }}
        >
          MAP CONTROLS
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close map controls"
          onPress={onToggleExpanded}
          hitSlop={8}
        >
          <Text
            variant="caption"
            color="textMuted"
            style={{ fontWeight: "900" }}
          >
            X
          </Text>
        </Pressable>
      </View>
      <ToggleRow
        label="Show Split Points"
        value={showSplitPoints}
        onPress={onToggleSplitPoints}
      />
      <ToggleRow
        label="KM Markers"
        value={showDistanceLabels}
        onPress={onToggleDistanceLabels}
      />
      <ToggleRow
        label="Athlete Labels"
        value={showAthleteLabels}
        onPress={onToggleAthleteLabels}
      />
      <ToggleRow label="Route" value={showRoute} onPress={onToggleRoute} />
      <View style={{ gap: 6 }}>
        <Text
          variant="caption"
          color="textMuted"
          style={{ fontWeight: "800", letterSpacing: 0.4 }}
        >
          MAP TYPE
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {(["standard", "satellite", "hybrid", "terrain"] as const).map(
            (option) => (
              <Pressable
                key={option}
                accessibilityRole="button"
                accessibilityState={{ selected: mapType === option }}
                onPress={() => onMapTypeChange(option)}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor:
                    mapType === option
                      ? theme.colors.accent
                      : theme.colors.border,
                  backgroundColor:
                    mapType === option
                      ? `${theme.colors.accent}18`
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
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Zoom in course map"
          onPress={onZoomIn}
          style={{
            flex: 1,
            height: 34,
            borderRadius: 10,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surfaceSunken,
          }}
        >
          <Text
            variant="label"
            style={{ color: theme.colors.textPrimary, fontWeight: "900" }}
          >
            +
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Zoom out course map"
          onPress={onZoomOut}
          style={{
            flex: 1,
            height: 34,
            borderRadius: 10,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surfaceSunken,
          }}
        >
          <Text
            variant="label"
            style={{ color: theme.colors.textPrimary, fontWeight: "900" }}
          >
            -
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Fit course map"
          onPress={onFit}
          style={{
            flex: 1.2,
            height: 34,
            borderRadius: 10,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surfaceSunken,
          }}
        >
          <Text
            variant="caption"
            style={{ color: theme.colors.textPrimary, fontWeight: "900" }}
          >
            FIT
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Native course map (react-native-maps): draws each leg's GPX polyline and the
 * timing/aid/camera markers, and fits the camera to the course. Web/TS use
 * CourseMapView.tsx. Consumes the same CourseMapViewModel — no parsing here.
 */
function CourseMapViewComponent({
  map,
  cutoffMinutes,
  cutoffs,
  athletes = [],
  compact = false,
  fullBleed = false,
  loading = false,
  refreshError = false,
  mapPreferences,
  showMapControls = true,
  mapType: controlledMapType,
  onMapTypeChange,
  followSelectedAthlete = true,
  onAthletePress,
}: CourseMapViewProps) {
  const theme = useTheme();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const mapRef = useRef<MapView>(null);
  const [zoomLevel, setZoomLevel] = useState(14);
  const [minimumCourseZoom, setMinimumCourseZoom] = useState(0);
  const [showSplitPoints, setShowSplitPoints] = useState(true);
  const [showDistanceLabels, setShowDistanceLabels] = useState(true);
  const [showAthleteLabels, setShowAthleteLabels] = useState(true);
  const [showRoute, setShowRoute] = useState(true);
  const [showAidStations] = useState(true);
  const [controlsExpanded, setControlsExpanded] = useState(false);
  const [selectedKmMarker, setSelectedKmMarker] =
    useState<CourseMarkerView | null>(null);
  const cameraBeforeKmMarkerRef = useRef<Camera | null>(null);
  const lastInitialFocusIdRef = useRef<string | null>(null);
  const lastViewportFitKeyRef = useRef<string | null>(null);
  const [internalMapType, setInternalMapType] = useState<
    "standard" | "satellite" | "hybrid" | "terrain"
  >("standard");
  const mapType = controlledMapType ?? internalMapType;
  const setMapType = (
    value: "standard" | "satellite" | "hybrid" | "terrain",
  ) => {
    if (controlledMapType == null) setInternalMapType(value);
    onMapTypeChange?.(value);
  };
  const cutoffSummary = formatCutoffSummary(cutoffMinutes, cutoffs);
  const allCoords = useMemo(
    () => (map ? toMapCoords(map.mergedPath) : []),
    [map],
  );
  const transitionConnectors = useMemo(
    () => buildCourseTransitionConnectors(map?.legs ?? []),
    [map?.legs],
  );
  const legPolylines = useMemo(
    () =>
      (map?.legs ?? [])
        .filter((leg) => leg.path.length > 1)
        .map((leg) => ({
          id: leg.id,
          segment: leg.segment,
          coordinates: toMapCoords(leg.path),
        })),
    [map?.legs],
  );
  const transitionPolylines = useMemo(
    () =>
      transitionConnectors.map((connector) => ({
        id: connector.id,
        coordinates: toMapCoords(connector.path),
      })),
    [transitionConnectors],
  );
  const courseBounds = map?.bounds;
  const initialCourseRegion = useMemo(
    () =>
      courseBounds
        ? {
            latitude: (courseBounds.minLat + courseBounds.maxLat) / 2,
            longitude: (courseBounds.minLng + courseBounds.maxLng) / 2,
            latitudeDelta: Math.max(
              (courseBounds.maxLat - courseBounds.minLat) * 1.2,
              0.002,
            ),
            longitudeDelta: Math.max(
              (courseBounds.maxLng - courseBounds.minLng) * 1.2,
              0.002,
            ),
          }
        : DEFAULT_REGION,
    [courseBounds],
  );

  const fitCourse = useCallback(() => {
    if (mapRef.current && allCoords.length > 1) {
      mapRef.current.fitToCoordinates(allCoords, {
        edgePadding: COURSE_EDGE_PADDING,
        animated: false,
      });
      setTimeout(() => {
        mapRef.current?.animateCamera(
          {
            pitch: 0,
            heading: 0,
          },
          { duration: 0 },
        );
        void mapRef.current
          ?.getCamera()
          .then((camera) => {
            if (camera.zoom == null || !Number.isFinite(camera.zoom)) return;
            setZoomLevel(camera.zoom);
            setMinimumCourseZoom(camera.zoom);
          })
          .catch(() => undefined);
      }, 120);
    }
  }, [allCoords]);

  const syncZoomLevel = useCallback(() => {
    void mapRef.current
      ?.getCamera()
      .then((camera) => {
        if (camera.zoom != null && Number.isFinite(camera.zoom)) {
          setZoomLevel(camera.zoom);
        }
      })
      .catch(() => undefined);
  }, []);

  const zoomBy = useCallback(
    (delta: number) => {
      const nextZoom = Math.max(3, Math.min(20, zoomLevel + delta));
      setZoomLevel(nextZoom);
      mapRef.current?.animateCamera({ zoom: nextZoom }, { duration: 220 });
    },
    [zoomLevel],
  );

  const showKmMarkerActions = useCallback(async (marker: CourseMarkerView) => {
    try {
      cameraBeforeKmMarkerRef.current =
        (await mapRef.current?.getCamera()) ?? null;
    } catch {
      cameraBeforeKmMarkerRef.current = null;
    }
    setSelectedKmMarker(marker);
  }, []);

  const restoreKmMarkerViewport = useCallback(() => {
    setSelectedKmMarker(null);
    const camera = cameraBeforeKmMarkerRef.current;
    cameraBeforeKmMarkerRef.current = null;
    if (camera) mapRef.current?.animateCamera(camera, { duration: 0 });
  }, []);

  const navigateToKmMarker = useCallback(
    (marker: CourseMarkerView) => {
      restoreKmMarkerViewport();
      openMarkerNavigation(marker.position.lat, marker.position.lng);
    },
    [restoreKmMarkerViewport],
  );

  const kmMarkerModal = (
    <KmMarkerActionModal
      marker={selectedKmMarker}
      onClose={restoreKmMarkerViewport}
      onNavigate={navigateToKmMarker}
    />
  );

  const maximumKmByCourse = useMemo(() => {
    const maximum = new Map<string, number>();
    for (const marker of map?.markers ?? []) {
      if (!isGpxDistanceMarker(marker) || marker.distanceKm == null) continue;
      const key = markerCourseKey(marker);
      maximum.set(key, Math.max(maximum.get(key) ?? 0, marker.distanceKm));
    }
    return maximum;
  }, [map?.markers]);
  const visibleMarkers = useMemo(() => {
    return (map?.markers ?? []).filter((marker) => {
      const isGpxDistance = isGpxDistanceMarker(marker);
      if (
        !(mapPreferences?.showSplitPoints ?? showSplitPoints) &&
        marker.kind === "timing" &&
        !isGpxDistance
      )
        return false;
      if (
        !(mapPreferences?.showDistanceLabels ?? showDistanceLabels) &&
        isGpxDistance
      )
        return false;
      if (
        isGpxDistance &&
        !shouldShowKmMarker(
          marker,
          zoomLevel,
          maximumKmByCourse.get(markerCourseKey(marker)) ?? 0,
        )
      ) {
        return false;
      }
      if (
        !(mapPreferences?.showAidStations ?? showAidStations) &&
        marker.kind === "aid"
      )
        return false;
      return true;
    });
  }, [
    map?.markers,
    mapPreferences?.showAidStations,
    mapPreferences?.showDistanceLabels,
    mapPreferences?.showSplitPoints,
    showAidStations,
    showDistanceLabels,
    showSplitPoints,
    maximumKmByCourse,
    zoomLevel,
  ]);
  const visibleMarkerRenderKey = useMemo(
    () =>
      visibleMarkers
        .map((marker) => `${marker.id}:${marker.distanceLabel ?? marker.label}`)
        .join("|"),
    [visibleMarkers],
  );
  const [trackAndroidCourseMarkers, setTrackAndroidCourseMarkers] = useState(
    Platform.OS === "android",
  );
  useEffect(() => {
    if (Platform.OS !== "android") return;
    setTrackAndroidCourseMarkers(true);
    const timer = setTimeout(() => setTrackAndroidCourseMarkers(false), 800);
    return () => clearTimeout(timer);
  }, [visibleMarkerRenderKey]);
  const kmMarkerAnchor = useCallback(
    (marker: CourseMarkerView) => {
      const maximumKm = maximumKmByCourse.get(markerCourseKey(marker)) ?? 0;
      // Outbound and return portions of an out-and-back course often occupy
      // the same road. Put their labels on opposite sides instead of deleting
      // the later-distance marker as a geographic duplicate.
      const firstHalf = (marker.distanceKm ?? 0) <= maximumKm / 2;
      return { x: firstHalf ? 1 : 0, y: 0.5 };
    },
    [maximumKmByCourse],
  );
  const effectiveShowAthleteLabels =
    mapPreferences?.showAthleteLabels ?? showAthleteLabels;
  const effectiveShowDistanceLabels =
    mapPreferences?.showDistanceLabels ?? showDistanceLabels;
  const effectiveShowRoute = mapPreferences?.showRoute ?? showRoute;
  const selectedAthlete = athletes.find((athlete) => athlete.selected);
  const selectedLeg = useMemo(() => {
    if (!map || !selectedAthlete) return null;
    const requestedLeg = String(selectedAthlete.currentLeg || "")
      .trim()
      .toLowerCase();
    const namedLeg = requestedLeg
      ? map.legs.find((leg) => {
          const label = `${leg.segment} ${leg.label}`.toLowerCase();
          return (
            label.includes(requestedLeg) ||
            requestedLeg.includes(String(leg.segment).toLowerCase())
          );
        })
      : null;
    if (namedLeg) return namedLeg;
    return map.legs.reduce<{
      leg: (typeof map.legs)[number] | null;
      distance: number;
    }>(
      (best, leg) => {
        const nearest = leg.path.reduce((minimum, point) => {
          const lat = point.lat - selectedAthlete.position.lat;
          const lng = point.lng - selectedAthlete.position.lng;
          return Math.min(minimum, lat * lat + lng * lng);
        }, Number.POSITIVE_INFINITY);
        return nearest < best.distance ? { leg, distance: nearest } : best;
      },
      { leg: null, distance: Number.POSITIVE_INFINITY },
    ).leg;
  }, [map, selectedAthlete]);
  const selectedSectionCoordinates = useMemo(() => {
    if (!selectedAthlete) return [];
    const activePath = selectedLeg?.path?.length
      ? toMapCoords(selectedLeg.path)
      : allCoords;
    return nearestPathWindow(activePath, selectedAthlete.position);
  }, [allCoords, selectedAthlete, selectedLeg]);
  const selectedProgressPath = useMemo(
    () => progressCoordinates(allCoords, selectedAthlete?.progressFraction),
    [allCoords, selectedAthlete?.progressFraction],
  );

  const followAthlete = useCallback(
    (initial = false) => {
      if (!selectedAthlete) return;
      if (initial && selectedSectionCoordinates.length > 1) {
        mapRef.current?.fitToCoordinates(
          [
            ...selectedSectionCoordinates,
            {
              latitude: selectedAthlete.position.lat,
              longitude: selectedAthlete.position.lng,
            },
          ],
          {
            edgePadding: { top: 110, right: 76, bottom: 180, left: 76 },
            animated: true,
          },
        );
        return;
      }
      mapRef.current?.animateCamera(
        {
          center: {
            latitude: selectedAthlete.position.lat,
            longitude: selectedAthlete.position.lng,
          },
          zoom: Math.max(15, zoomLevel),
          heading: selectedAthlete.heading ?? 0,
          pitch: 0,
        },
        { duration: 850 },
      );
    },
    [selectedAthlete, selectedSectionCoordinates, zoomLevel],
  );

  const selectedAthleteId =
    selectedAthlete?.id ?? selectedAthlete?.bib ?? selectedAthlete?.name;
  const courseFocusSignature = useMemo(() => {
    const first = allCoords[0];
    const last = allCoords.at(-1);
    const point = (value: MapLatLng | undefined) =>
      value
        ? `${value.latitude.toFixed(5)},${value.longitude.toFixed(5)}`
        : "none";
    return `${map?.name || "course"}:${allCoords.length}:${point(first)}:${point(last)}`;
  }, [allCoords, map?.name]);
  useEffect(() => {
    if (!followSelectedAthlete || !selectedAthlete) return;
    // A selected athlete may be present before the selected ticket's GPX has
    // loaded. Include the geometry identity so that completing or replacing
    // that GPX triggers a fresh fit around the athlete and their course.
    const focusId = `${String(selectedAthleteId || "selected-athlete")}:${courseFocusSignature}`;
    if (lastInitialFocusIdRef.current === focusId) return;
    lastInitialFocusIdRef.current = focusId;
    const timer = setTimeout(() => followAthlete(true), 180);
    return () => clearTimeout(timer);
  }, [
    followAthlete,
    followSelectedAthlete,
    courseFocusSignature,
    selectedAthlete,
    selectedAthleteId,
  ]);

  const floatingControls = showMapControls ? (
    <MapControls
      expanded={controlsExpanded}
      showSplitPoints={showSplitPoints}
      showDistanceLabels={showDistanceLabels}
      showAthleteLabels={showAthleteLabels}
      showRoute={showRoute}
      onToggleExpanded={() => setControlsExpanded((value) => !value)}
      onToggleSplitPoints={() => setShowSplitPoints((value) => !value)}
      onToggleDistanceLabels={() => setShowDistanceLabels((value) => !value)}
      onToggleAthleteLabels={() => setShowAthleteLabels((value) => !value)}
      onToggleRoute={() => setShowRoute((value) => !value)}
      onZoomIn={() => zoomBy(1)}
      onZoomOut={() => zoomBy(-1)}
      onFit={fitCourse}
      mapType={mapType}
      onMapTypeChange={setMapType}
    />
  ) : null;
  const embeddedZoomControls = (
    <View style={styles.zoomControls}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Zoom in course map"
        onPress={() => zoomBy(1)}
        style={[
          styles.zoomButton,
          {
            backgroundColor: theme.colors.surfaceElevated,
            borderColor: theme.colors.border,
          },
        ]}
      >
        <Icon name="plus" size={18} color="textPrimary" />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Zoom out course map"
        onPress={() => zoomBy(-1)}
        style={[
          styles.zoomButton,
          {
            backgroundColor: theme.colors.surfaceElevated,
            borderColor: theme.colors.border,
          },
        ]}
      >
        <Icon name="minus" size={18} color="textPrimary" />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Fit course map"
        onPress={fitCourse}
        style={[
          styles.zoomButton,
          {
            backgroundColor: theme.colors.surfaceElevated,
            borderColor: theme.colors.border,
          },
        ]}
      >
        <Icon name="maximize" size={17} color="textPrimary" />
      </Pressable>
    </View>
  );

  useEffect(() => {
    if (allCoords.length > 1) {
      const viewportKey = `${courseFocusSignature}:${windowWidth}:${windowHeight}:${selectedAthleteId || "none"}`;
      if (lastViewportFitKeyRef.current === viewportKey) return undefined;
      lastViewportFitKeyRef.current = viewportKey;
      const timer = setTimeout(() => {
        if (followSelectedAthlete && selectedAthlete) followAthlete(true);
        else fitCourse();
      }, 50);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [
    allCoords.length,
    courseFocusSignature,
    fitCourse,
    followAthlete,
    followSelectedAthlete,
    map?.name,
    selectedAthlete,
    selectedAthleteId,
    windowHeight,
    windowWidth,
  ]);

  if (loading) {
    return (
      <Card>
        <Text variant="body" color="textMuted">
          Loading course map…
        </Text>
      </Card>
    );
  }

  const resolvedProvider =
    Platform.OS === "android" ? PROVIDER_GOOGLE : undefined;

  if (fullBleed) {
    return (
      <View style={{ flex: 1, width: "100%", minHeight: "100%" }}>
        <View style={StyleSheet.absoluteFill}>
          <MapView
            ref={mapRef}
            provider={resolvedProvider}
            mapType={mapType}
            pitchEnabled
            rotateEnabled
            scrollEnabled
            zoomEnabled
            zoomTapEnabled
            minZoomLevel={minimumCourseZoom}
            moveOnMarkerPress={false}
            toolbarEnabled={false}
            style={StyleSheet.absoluteFill}
            initialRegion={initialCourseRegion}
            onMapReady={() => {
              if (followSelectedAthlete && selectedAthlete) followAthlete(true);
              else fitCourse();
            }}
            onRegionChangeComplete={syncZoomLevel}
          >
            {effectiveShowRoute
              ? legPolylines.map((leg) => (
                  <Polyline
                    key={leg.id}
                    coordinates={leg.coordinates}
                    strokeColor={theme.colors[segmentColor(leg.segment)]}
                    strokeWidth={courseStrokeWidth(
                      leg.segment,
                      selectedLeg?.id === leg.id,
                    )}
                  />
                ))
              : null}
            {effectiveShowRoute
              ? transitionPolylines.map((connector) => (
                  <Polyline
                    key={connector.id}
                    coordinates={connector.coordinates}
                    strokeColor="#FACC15"
                    strokeWidth={5}
                    zIndex={50}
                  />
                ))
              : null}
            {effectiveShowRoute && selectedProgressPath.length > 1 ? (
              <Polyline
                coordinates={selectedProgressPath}
                strokeColor="#E11D48"
                strokeWidth={6}
                zIndex={8}
              />
            ) : null}
            {visibleMarkers.map((m) => {
              const tone = markerTone(m);
              const isKmMarker = isGpxDistanceMarker(m);
              return (
                <Marker
                  key={m.id}
                  tracksViewChanges={trackAndroidCourseMarkers}
                  coordinate={{
                    latitude: m.position.lat,
                    longitude: m.position.lng,
                  }}
                  anchor={
                    isKmMarker
                      ? Platform.OS === "android"
                        ? { x: 0.5, y: 0.5 }
                        : kmMarkerAnchor(m)
                      : undefined
                  }
                  title={isKmMarker ? undefined : m.label}
                  description={undefined}
                  onPress={
                    isKmMarker
                      ? (event) => {
                          event.stopPropagation();
                          void showKmMarkerActions(m);
                        }
                      : undefined
                  }
                >
                  {isKmMarker ? (
                    <KmMarkerBadge label={m.distanceLabel} tone={tone} />
                  ) : (
                    <View style={styles.markerWrap}>
                      <View
                        style={[
                          styles.markerBubble,
                          m.sourceId?.startsWith("gpx-distance-")
                            ? styles.kmBubble
                            : null,
                          {
                            backgroundColor: tone.background,
                            borderColor: tone.border,
                          },
                        ]}
                      >
                        {m.sourceId?.startsWith("gpx-distance-") ? (
                          <View
                            style={[
                              styles.kmDot,
                              { backgroundColor: tone.icon },
                            ]}
                          />
                        ) : (
                          <MarkerIcon
                            kind={m.kind}
                            segment={m.segment}
                            color={tone.icon}
                          />
                        )}
                      </View>
                      {m.source === "timing-point-display" ||
                      (m.kind === "timing" &&
                        m.sourceId?.startsWith("gpx-distance-")) ||
                      (m.kind !== "timing" &&
                        m.kind !== "start" &&
                        m.kind !== "finish") ? (
                        <View
                          style={[
                            styles.markerLabel,
                            m.sourceId?.startsWith("gpx-distance-")
                              ? styles.kmLabel
                              : null,
                            {
                              backgroundColor: theme.colors.surfaceElevated,
                              borderColor: tone.border,
                            },
                          ]}
                        >
                          <Text
                            variant="caption"
                            numberOfLines={1}
                            style={{
                              color: theme.colors.textPrimary,
                              fontWeight: "800",
                              fontSize: m.sourceId?.startsWith("gpx-distance-")
                                ? 8
                                : 10,
                            }}
                          >
                            {m.sourceId?.startsWith("gpx-distance-")
                              ? m.distanceLabel
                              : effectiveShowDistanceLabels && m.distanceLabel
                                ? `${m.label} · ${m.distanceLabel}`
                                : m.label}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  )}
                </Marker>
              );
            })}
            {athletes.map((athlete, index) => (
              <AthleteMarker
                key={athlete.id ?? athlete.bib ?? athlete.name}
                athlete={spreadOverlappingAthlete(athletes, athlete, index)}
                showLabel={effectiveShowAthleteLabels}
                onPress={() => {
                  onAthletePress?.(athlete, index);
                }}
              />
            ))}
          </MapView>
          {kmMarkerModal}
          {floatingControls ? (
            <View pointerEvents="box-none" style={styles.fullBleedZoomControls}>
              {floatingControls}
            </View>
          ) : null}
          {refreshError ? (
            <View pointerEvents="none" style={styles.refreshNotice}>
              <Text variant="caption" color="textSecondary">
                Map refresh failed. Showing the last saved course.
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <View style={[styles.mapWrap, { borderRadius: theme.radius.large }]}>
        <MapView
          ref={mapRef}
          provider={resolvedProvider}
          mapType={mapType}
          pitchEnabled
          rotateEnabled
          scrollEnabled
          zoomEnabled
          zoomTapEnabled
          minZoomLevel={minimumCourseZoom}
          moveOnMarkerPress={false}
          toolbarEnabled={false}
          style={StyleSheet.absoluteFill}
          initialRegion={initialCourseRegion}
          onMapReady={() => {
            if (followSelectedAthlete && selectedAthlete) followAthlete(true);
            else fitCourse();
          }}
          onRegionChangeComplete={syncZoomLevel}
        >
          {effectiveShowRoute
            ? legPolylines.map((leg) => (
                <Polyline
                  key={leg.id}
                  coordinates={leg.coordinates}
                  strokeColor={theme.colors[segmentColor(leg.segment)]}
                  strokeWidth={courseStrokeWidth(
                    leg.segment,
                    selectedLeg?.id === leg.id,
                  )}
                />
              ))
            : null}
          {effectiveShowRoute
            ? transitionPolylines.map((connector) => (
                <Polyline
                  key={connector.id}
                  coordinates={connector.coordinates}
                  strokeColor="#FACC15"
                  strokeWidth={5}
                  zIndex={50}
                />
              ))
            : null}
          {effectiveShowRoute && selectedProgressPath.length > 1 ? (
            <Polyline
              coordinates={selectedProgressPath}
              strokeColor="#E11D48"
              strokeWidth={6}
              zIndex={8}
            />
          ) : null}
          {visibleMarkers.map((m) => {
            const tone = markerTone(m);
            const isKmMarker = isGpxDistanceMarker(m);
            return (
              <Marker
                key={m.id}
                tracksViewChanges={trackAndroidCourseMarkers}
                coordinate={{
                  latitude: m.position.lat,
                  longitude: m.position.lng,
                }}
                anchor={
                  isKmMarker
                    ? Platform.OS === "android"
                      ? { x: 0.5, y: 0.5 }
                      : kmMarkerAnchor(m)
                    : undefined
                }
                title={isKmMarker ? undefined : m.label}
                description={undefined}
                onPress={
                  isKmMarker
                    ? (event) => {
                        event.stopPropagation();
                        void showKmMarkerActions(m);
                      }
                    : undefined
                }
              >
                {isKmMarker ? (
                  <KmMarkerBadge label={m.distanceLabel} tone={tone} />
                ) : (
                  <View style={styles.markerWrap}>
                    <View
                      style={[
                        styles.markerBubble,
                        m.sourceId?.startsWith("gpx-distance-")
                          ? styles.kmBubble
                          : null,
                        {
                          backgroundColor: tone.background,
                          borderColor: tone.border,
                        },
                      ]}
                    >
                      {m.sourceId?.startsWith("gpx-distance-") ? (
                        <View
                          style={[styles.kmDot, { backgroundColor: tone.icon }]}
                        />
                      ) : (
                        <MarkerIcon
                          kind={m.kind}
                          segment={m.segment}
                          color={tone.icon}
                        />
                      )}
                    </View>
                    {m.source === "timing-point-display" ||
                    (m.kind === "timing" &&
                      m.sourceId?.startsWith("gpx-distance-")) ||
                    (m.kind !== "timing" &&
                      m.kind !== "start" &&
                      m.kind !== "finish") ? (
                      <View
                        style={[
                          styles.markerLabel,
                          m.sourceId?.startsWith("gpx-distance-")
                            ? styles.kmLabel
                            : null,
                          {
                            backgroundColor: theme.colors.surfaceElevated,
                            borderColor: tone.border,
                          },
                        ]}
                      >
                        <Text
                          variant="caption"
                          numberOfLines={1}
                          style={{
                            color: theme.colors.textPrimary,
                            fontWeight: "800",
                            fontSize: m.sourceId?.startsWith("gpx-distance-")
                              ? 8
                              : 10,
                          }}
                        >
                          {m.sourceId?.startsWith("gpx-distance-")
                            ? m.distanceLabel
                            : effectiveShowDistanceLabels && m.distanceLabel
                              ? `${m.label} · ${m.distanceLabel}`
                              : m.label}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                )}
              </Marker>
            );
          })}
          {athletes.map((athlete, index) => (
            <AthleteMarker
              key={athlete.id ?? athlete.bib ?? athlete.name}
              athlete={spreadOverlappingAthlete(athletes, athlete, index)}
              showLabel={effectiveShowAthleteLabels}
              onPress={() => {
                onAthletePress?.(athlete, index);
              }}
            />
          ))}
        </MapView>
        {kmMarkerModal}
        {!controlsExpanded && floatingControls ? (
          <View pointerEvents="box-none" style={styles.embeddedMapSettings}>
            {floatingControls}
          </View>
        ) : null}
        <View pointerEvents="box-none" style={styles.embeddedZoomControls}>
          {embeddedZoomControls}
        </View>
        {refreshError ? (
          <View pointerEvents="none" style={styles.refreshNotice}>
            <Text variant="caption" color="textSecondary">
              Map refresh failed. Showing the last saved course.
            </Text>
          </View>
        ) : null}
      </View>
      {controlsExpanded && floatingControls ? (
        <View style={{ alignItems: "flex-end" }}>{floatingControls}</View>
      ) : null}
      {compact ? null : (
        <Card>
          <Text variant="body" color="textSecondary">
            {map
              ? map.legs.map((l) => l.label).join(" → ")
              : "Course publishing soon"}
          </Text>
        </Card>
      )}
      {compact || cutoffSummary.length === 0 ? null : (
        <Card
          style={{
            gap: theme.spacing.xs,
            backgroundColor: theme.colors.surfaceElevated,
          }}
        >
          <Text variant="headline">Cutoff</Text>
          <View style={{ gap: 6 }}>
            {cutoffSummary.map((line) => (
              <Text key={line} variant="bodySmall" color="textSecondary">
                {line}
              </Text>
            ))}
          </View>
        </Card>
      )}
    </View>
  );
}

function sameAthleteMarkers(
  previous: NonNullable<CourseMapViewProps["athletes"]>,
  next: NonNullable<CourseMapViewProps["athletes"]>,
): boolean {
  if (previous === next) return true;
  if (previous.length !== next.length) return false;
  return previous.every((athlete, index) => {
    const candidate = next[index];
    return (
      candidate != null &&
      athlete.id === candidate.id &&
      athlete.name === candidate.name &&
      athlete.bib === candidate.bib &&
      athlete.photoUrl === candidate.photoUrl &&
      athlete.selected === candidate.selected &&
      athlete.position.lat === candidate.position.lat &&
      athlete.position.lng === candidate.position.lng &&
      athlete.heading === candidate.heading &&
      athlete.progressFraction === candidate.progressFraction &&
      athlete.status === candidate.status &&
      athlete.currentLeg === candidate.currentLeg &&
      athlete.estimatedDistanceKm === candidate.estimatedDistanceKm &&
      athlete.totalDistanceKm === candidate.totalDistanceKm &&
      athlete.lastOfficialLabel === candidate.lastOfficialLabel &&
      athlete.nextCheckpointLabel === candidate.nextCheckpointLabel &&
      athlete.awaitingCheckpointConfirmation ===
        candidate.awaitingCheckpointConfirmation
    );
  });
}

function sameMapPreferences(
  previous: CourseMapViewProps["mapPreferences"],
  next: CourseMapViewProps["mapPreferences"],
): boolean {
  if (previous === next) return true;
  if (!previous || !next) return false;
  return (
    previous.showRoute === next.showRoute &&
    previous.showSplitPoints === next.showSplitPoints &&
    previous.showDistanceLabels === next.showDistanceLabels &&
    previous.showAthleteLabels === next.showAthleteLabels &&
    previous.showAidStations === next.showAidStations
  );
}

export const CourseMapView = memo(
  CourseMapViewComponent,
  (previous, next) =>
    previous.map === next.map &&
    previous.loading === next.loading &&
    previous.refreshError === next.refreshError &&
    previous.compact === next.compact &&
    previous.fullBleed === next.fullBleed &&
    previous.mapType === next.mapType &&
    previous.followSelectedAthlete === next.followSelectedAthlete &&
    previous.cutoffMinutes === next.cutoffMinutes &&
    previous.cutoffs === next.cutoffs &&
    sameMapPreferences(previous.mapPreferences, next.mapPreferences) &&
    sameAthleteMarkers(previous.athletes ?? [], next.athletes ?? []),
);
CourseMapView.displayName = "CourseMapView";

const styles = StyleSheet.create({
  mapWrap: { height: 300, overflow: "hidden" },
  zoomControls: {
    gap: 8,
  },
  markerWrap: {
    alignItems: "center",
    gap: 4,
  },
  markerBubble: {
    width: 26,
    height: 26,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  kmDot: { width: 5, height: 5, borderRadius: 3 },
  kmBubble: { width: 12, height: 12, borderRadius: 6 },
  kmMarkerBadge: {
    minWidth: 27,
    height: 24,
    paddingHorizontal: 5,
    borderRadius: 7,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 4,
  },
  kmMarkerLabelText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 10,
    lineHeight: 12,
  },
  markerLabel: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  kmLabel: {
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  athleteLabel: {
    position: "absolute",
    left: "50%",
    bottom: -20,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    alignItems: "center",
  },
  fullBleedZoomControls: {
    position: "absolute",
    right: 12,
    top: 12,
    zIndex: 20,
    elevation: 20,
  },
  embeddedZoomControls: {
    position: "absolute",
    right: 12,
    bottom: 12,
    zIndex: 20,
    elevation: 20,
  },
  embeddedMapSettings: {
    position: "absolute",
    right: 12,
    top: 12,
    zIndex: 22,
    elevation: 22,
  },
  refreshNotice: {
    position: "absolute",
    top: 12,
    left: 12,
    maxWidth: "72%",
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#F59E0B",
    backgroundColor: "#FFFFFFEE",
    zIndex: 21,
    elevation: 21,
  },
  zoomButton: {
    width: 42,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.16,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
});
