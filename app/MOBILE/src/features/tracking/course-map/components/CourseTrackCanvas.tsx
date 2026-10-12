import { useMemo, useRef, useState } from "react";
import {
  Linking,
  Platform,
  Pressable,
  Text as RNText,
  View,
  type LayoutChangeEvent,
} from "react-native";
import Svg, {
  Circle,
  ClipPath,
  Defs,
  G,
  Image as SvgImage,
  Path,
  Polyline,
  Rect,
  Text as SvgText,
} from "react-native-svg";

import { brand, useTheme, type SemanticColors } from "@/core/theme";
import type { CourseMapMarkerKind, LatLng } from "@/core/types";
import { avatarColor, getInitials } from "@/core/utils";
import { Icon, Text } from "@/shared/components";
import { projectToBox, type GeoBounds } from "@/features/tracking/engine";

import {
  buildCourseTransitionConnectors,
  type CourseLegView,
  type CourseMarkerView,
} from "../mappers";
import { athleteBibLabelMetrics } from "../athleteBibLabel";
import type { MapLayerPreferences } from "./CourseMapView";
import { KmMarkerActionModal } from "./KmMarkerActionModal";

/** Identity for the animated athlete marker (photo → initials fallback). */
export type TrackAthlete = {
  /** Stable backend identity. Never include coordinates in a marker key. */
  id?: string;
  position: LatLng;
  name: string;
  photoUrl?: string;
  colorSeed?: string;
  bib?: string;
  selected?: boolean;
  isPending?: boolean;
  /** Normalized progress along the selected GPX course. */
  progressFraction?: number;
  heading?: number;
  status?: "live" | "finished" | "notStarted" | "upcoming";
  currentLeg?: string;
  estimatedDistanceKm?: number;
  totalDistanceKm?: number;
  lastOfficialLabel?: string;
  nextCheckpointLabel?: string;
  awaitingCheckpointConfirmation?: boolean;
};

export type CourseTrackCanvasProps = {
  legs: CourseLegView[];
  markers: CourseMarkerView[];
  bounds: GeoBounds;
  /** Interpolated athlete (moves as the parent re-renders each tick). */
  athlete?: TrackAthlete | null;
  athletes?: TrackAthlete[];
  /** Optional leader position. */
  leader?: LatLng | null;
  height?: number;
  controlsDock?: "bottom" | "top";
  controlsOffsetTop?: number;
  controlsOffsetRight?: number;
  mapPreferences?: MapLayerPreferences;
  showMapControls?: boolean;
  mapType?: "standard" | "satellite" | "hybrid" | "terrain";
  onMapTypeChange?: (
    value: "standard" | "satellite" | "hybrid" | "terrain",
  ) => void;
  mapDimension?: "2d" | "3d";
  onMapDimensionChange?: (value: "2d" | "3d") => void;
};

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

function timingPointColor(segment?: string): string {
  const normalized = String(segment ?? "").toLowerCase();
  if (normalized === "swim") return "#2E9AFE";
  if (normalized === "bike") return "#18A56B";
  if (normalized === "run") return "#F28C28";
  if (normalized === "transition") return "#7C3AED";
  return brand.blueBright;
}

function kmMarkerStrideForCanvasZoom(zoom: number): number {
  if (zoom < 1.75) return 20;
  if (zoom < 2.75) return 10;
  if (zoom < 3.75) return 5;
  if (zoom < 4.75) return 2;
  return 1;
}

function shouldShowCanvasKmMarker(
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
  return (
    preserveSwimFirstKm || wholeKm % kmMarkerStrideForCanvasZoom(zoom) === 0
  );
}

const MARKER_COLOR: Record<CourseMapMarkerKind, keyof SemanticColors> = {
  start: "success",
  finish: "accent",
  timing: "textMuted",
  transition: "textSecondary",
  aid: "success",
  camera: "accentSecondary",
};

const AVATAR_CLIP_ID = "bergman-athlete-avatar-clip";
const OSM_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

function lonToTile(lng: number, zoom: number): number {
  return ((lng + 180) / 360) * 2 ** zoom;
}

function latToTile(lat: number, zoom: number): number {
  const rad = (lat * Math.PI) / 180;
  return (
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) *
    2 ** zoom
  );
}

function tileToLon(x: number, zoom: number): number {
  return (x / 2 ** zoom) * 360 - 180;
}

function tileToLat(y: number, zoom: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** zoom;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

function osmTiles(
  bounds: GeoBounds,
  width: number,
): { key: string; url: string; nw: LatLng; se: LatLng }[] {
  const lngDelta = Math.max(0.0001, bounds.maxLng - bounds.minLng);
  const zoom = Math.max(
    8,
    Math.min(
      15,
      Math.floor(Math.log2((Math.max(width, 320) * 360) / (256 * lngDelta))),
    ),
  );
  const minX = Math.floor(lonToTile(bounds.minLng, zoom));
  const maxX = Math.floor(lonToTile(bounds.maxLng, zoom));
  const minY = Math.floor(latToTile(bounds.maxLat, zoom));
  const maxY = Math.floor(latToTile(bounds.minLat, zoom));
  const tiles: { key: string; url: string; nw: LatLng; se: LatLng }[] = [];
  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      if (tiles.length > 36) return tiles;
      tiles.push({
        key: `${zoom}-${x}-${y}`,
        url: OSM_TILE_URL.replace("{z}", String(zoom))
          .replace("{x}", String(x))
          .replace("{y}", String(y)),
        nw: { lat: tileToLat(y, zoom), lng: tileToLon(x, zoom) },
        se: { lat: tileToLat(y + 1, zoom), lng: tileToLon(x + 1, zoom) },
      });
    }
  }
  return tiles;
}

function zoomBounds(bounds: GeoBounds, zoom: number): GeoBounds {
  const scale = 1 / zoom;
  const midLat = (bounds.minLat + bounds.maxLat) / 2;
  const midLng = (bounds.minLng + bounds.maxLng) / 2;
  const latHalf = ((bounds.maxLat - bounds.minLat) * scale) / 2;
  const lngHalf = ((bounds.maxLng - bounds.minLng) * scale) / 2;
  return {
    minLat: midLat - latHalf,
    maxLat: midLat + latHalf,
    minLng: midLng - lngHalf,
    maxLng: midLng + lngHalf,
  };
}

function TimingIcon({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <G>
      <Circle
        cx={x}
        cy={y}
        r={6.5}
        fill="#FFFFFF"
        stroke={color}
        strokeWidth={2}
      />
      <Path
        d={`M${x} ${y - 3}V${y - 0.5}M${x} ${y}L${x + 2.4} ${y + 1.8}`}
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </G>
  );
}

function FlagIcon({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <G>
      <Circle
        cx={x}
        cy={y}
        r={7}
        fill="#241A05"
        stroke={color}
        strokeWidth={2}
      />
      <Path
        d={`M${x - 2.2} ${y + 3.5}V${y - 4}M${x - 2.2} ${y - 4}H${x + 3.2}L${x + 2.1} ${y - 1.8}L${x + 3.2} ${y + 0.3}H${x - 2.2}`}
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </G>
  );
}

function openMarkerNavigation(position: LatLng) {
  const coordinate = `${position.lat},${position.lng}`;
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
  mapDimension,
  onMapDimensionChange,
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
    value: "standard" | "satellite" | "hybrid" | "terrain",
  ) => void;
  mapDimension: "2d" | "3d";
  onMapDimensionChange: (value: "2d" | "3d") => void;
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
      <ToggleRow
        label="Map Dimension (2D / 3D)"
        value={mapDimension === "3d"}
        enabledLabel="3D"
        disabledLabel="2D"
        onPress={() =>
          onMapDimensionChange(mapDimension === "3d" ? "2d" : "3d")
        }
      />
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
 * Cross-platform (web + native) SVG visualization of the course with an
 * animated athlete avatar marker. Pure rendering: the parent supplies the
 * already-interpolated coordinates from the tracking engine.
 */
export function CourseTrackCanvas({
  legs,
  markers,
  bounds,
  athlete,
  athletes = [],
  leader,
  height = 260,
  controlsDock = "bottom",
  controlsOffsetTop,
  controlsOffsetRight,
  mapPreferences,
  showMapControls = true,
  mapType: controlledMapType,
  onMapTypeChange,
  mapDimension: controlledMapDimension,
  onMapDimensionChange,
}: CourseTrackCanvasProps) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [showSplitPoints, setShowSplitPoints] = useState(true);
  const [showDistanceLabels, setShowDistanceLabels] = useState(true);
  const [showAthleteLabels, setShowAthleteLabels] = useState(true);
  const [showRoute, setShowRoute] = useState(true);
  const [showAidStations] = useState(true);
  const [controlsExpanded, setControlsExpanded] = useState(false);
  const [internalMapType, setInternalMapType] = useState<
    "standard" | "satellite" | "hybrid" | "terrain"
  >("standard");
  const [internalMapDimension, setInternalMapDimension] = useState<"2d" | "3d">(
    "2d",
  );
  const [selectedKmMarker, setSelectedKmMarker] =
    useState<CourseMarkerView | null>(null);
  const zoomBeforeKmMarkerRef = useRef(1);
  const onLayout = (e: LayoutChangeEvent) =>
    setWidth(e.nativeEvent.layout.width);

  const size = { width, height };
  const mapType = controlledMapType ?? internalMapType;
  const mapDimension = controlledMapDimension ?? internalMapDimension;
  const setMapType = (
    value: "standard" | "satellite" | "hybrid" | "terrain",
  ) => {
    if (controlledMapType == null) setInternalMapType(value);
    onMapTypeChange?.(value);
  };
  const setMapDimension = (value: "2d" | "3d") => {
    if (controlledMapDimension == null) setInternalMapDimension(value);
    onMapDimensionChange?.(value);
  };
  const visibleBounds = zoomBounds(bounds, zoom);
  const project = (p: LatLng) => projectToBox(p, visibleBounds, size);
  const showExpandedMapControls = showMapControls;
  const tiles =
    mapType === "standard" && width > 0 ? osmTiles(visibleBounds, width) : [];

  const renderedAthletes = athlete ? [athlete, ...athletes] : athletes;
  const transitionConnectors = useMemo(
    () => buildCourseTransitionConnectors(legs),
    [legs],
  );
  const avatarR = 13;
  const ringR = 15;
  const visibleMarkers = useMemo(
    () =>
      markers.filter((marker) => {
        const isGpxDistance =
          marker.sourceId?.startsWith("gpx-distance-") === true ||
          (marker.source === "geometry" &&
            marker.kind === "timing" &&
            marker.distanceKm != null);
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
        const maximumCourseKm = markers.reduce((maximum, candidate) => {
          if (
            candidate.segment !== marker.segment ||
            candidate.distanceKm == null ||
            !Number.isFinite(candidate.distanceKm)
          ) return maximum;
          return Math.max(maximum, candidate.distanceKm);
        }, 0);
        if (
          isGpxDistance &&
          !shouldShowCanvasKmMarker(marker, zoom, maximumCourseKm)
        )
          return false;
        if (
          !(mapPreferences?.showAidStations ?? showAidStations) &&
          marker.kind === "aid"
        )
          return false;
        return true;
      }),
    [
      mapPreferences?.showAidStations,
      mapPreferences?.showDistanceLabels,
      mapPreferences?.showSplitPoints,
      markers,
      showAidStations,
      showDistanceLabels,
      showSplitPoints,
      zoom,
    ],
  );
  const effectiveShowAthleteLabels =
    mapPreferences?.showAthleteLabels ?? showAthleteLabels;
  const effectiveShowDistanceLabels =
    mapPreferences?.showDistanceLabels ?? showDistanceLabels;
  const effectiveShowRoute = mapPreferences?.showRoute ?? showRoute;
  const closeKmMarker = () => {
    setSelectedKmMarker(null);
    setZoom(zoomBeforeKmMarkerRef.current);
  };

  return (
    <View
      onLayout={onLayout}
      accessibilityRole="image"
      accessibilityLabel="Live course map with athlete position"
      style={{
        height,
        width: "100%",
        borderRadius: theme.radius.large,
        overflow: "hidden",
        backgroundColor: theme.colors.surfaceSunken,
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}
    >
      {width > 0 ? (
        <Svg width={width} height={height}>
          {tiles.map((tile) => {
            const nw = project(tile.nw);
            const se = project(tile.se);
            return (
              <SvgImage
                key={tile.key}
                x={nw.x}
                y={nw.y}
                width={se.x - nw.x}
                height={se.y - nw.y}
                href={{ uri: tile.url }}
                preserveAspectRatio="none"
                opacity={0.72}
              />
            );
          })}

          {renderedAthletes.some((a) => a.photoUrl) ? (
            <Defs>
              {renderedAthletes.map((a, index) => {
                const point = project(a.position);
                return (
                  <ClipPath
                    key={`${a.bib ?? a.name}-${index}`}
                    id={`${AVATAR_CLIP_ID}-${index}`}
                  >
                    <Circle cx={point.x} cy={point.y} r={avatarR} />
                  </ClipPath>
                );
              })}
            </Defs>
          ) : null}

          {effectiveShowRoute
            ? transitionConnectors.map((connector) => {
                const points = connector.path
                  .map((point) => {
                    const { x, y } = project(point);
                    return `${x},${y}`;
                  })
                  .join(" ");
                return (
                  <Polyline
                    key={connector.id}
                    points={points}
                    fill="none"
                    stroke="#FACC15"
                    strokeWidth={4}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                );
              })
            : null}

          {effectiveShowRoute
            ? legs.map((leg) => {
                if (leg.path.length < 2) return null;
                const points = leg.path
                  .map((p) => {
                    const { x, y } = project(p);
                    return `${x},${y}`;
                  })
                  .join(" ");
                const color = theme.colors[segmentColor(leg.segment)];
                return (
                  <Polyline
                    key={leg.id}
                    points={points}
                    fill="none"
                    stroke={color}
                    strokeWidth={4}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={0.9}
                  />
                );
              })
            : null}

          {visibleMarkers.map((m, markerIndex) => {
            const { x, y } = project(m.position);
            const color = theme.colors[MARKER_COLOR[m.kind]];
            const labelOffset = [
              { x: 0, y: -14 },
              { x: 14, y: -10 },
              { x: -14, y: -10 },
              { x: 0, y: 18 },
              { x: 16, y: 16 },
              { x: -16, y: 16 },
            ][markerIndex % 6];
            const markerLabel =
              effectiveShowDistanceLabels && m.distanceLabel
                ? `${m.label} · ${m.distanceLabel}`
                : m.label;
            if (m.kind === "transition") {
              const transitionColor =
                m.source === "timing-point-display" ? "#7C3AED" : color;
              return (
                <G key={m.id}>
                  <Rect
                    x={x - 4}
                    y={y - 4}
                    width={8}
                    height={8}
                    fill={theme.colors.surface}
                    stroke={transitionColor}
                    strokeWidth={2}
                  />
                  <SvgText
                    x={x + labelOffset.x}
                    y={y + labelOffset.y}
                    fill={theme.colors.textPrimary}
                    fontSize={9}
                    fontWeight="bold"
                    textAnchor="middle"
                  >
                    {markerLabel}
                  </SvgText>
                </G>
              );
            }
            if (m.kind === "timing") {
              const showGpxDistance = m.sourceId?.startsWith("gpx-distance-");
              return (
                <G key={m.id}>
                  {showGpxDistance ? (
                    <Circle
                      cx={x}
                      cy={y}
                      r={4}
                      fill={brand.blueBright}
                      stroke="#FFFFFF"
                      strokeWidth={1.5}
                    />
                  ) : (
                    <TimingIcon
                      x={x}
                      y={y}
                      color={timingPointColor(m.segment)}
                    />
                  )}
                  {showGpxDistance || m.source === "timing-point-display" ? (
                    <SvgText
                      x={x + labelOffset.x}
                      y={y + labelOffset.y}
                      fill={theme.colors.textPrimary}
                      fontSize={9}
                      fontWeight="bold"
                      textAnchor="middle"
                    >
                      {showGpxDistance ? m.distanceLabel : markerLabel}
                    </SvgText>
                  ) : null}
                </G>
              );
            }
            if (m.kind === "finish") {
              return (
                <G key={m.id}>
                  <FlagIcon x={x} y={y} color="#FFD60A" />
                  {m.source === "timing-point-display" ? (
                    <SvgText
                      x={x + labelOffset.x}
                      y={y + labelOffset.y}
                      fill={theme.colors.textPrimary}
                      fontSize={9}
                      fontWeight="bold"
                      textAnchor="middle"
                    >
                      {markerLabel}
                    </SvgText>
                  ) : null}
                </G>
              );
            }
            return (
              <G key={m.id}>
                <Circle
                  cx={x}
                  cy={y}
                  r={m.kind === "start" ? 5 : 3.5}
                  fill={
                    m.kind === "aid" || m.kind === "camera"
                      ? color
                      : theme.colors.surface
                  }
                  stroke={color}
                  strokeWidth={2}
                />
              </G>
            );
          })}

          {leader ? (
            <Circle
              cx={project(leader).x}
              cy={project(leader).y}
              r={6}
              fill={theme.colors.statusUpcoming}
              stroke={theme.colors.surface}
              strokeWidth={2}
            />
          ) : null}

          {renderedAthletes.map((runner, index) => {
            const athletePoint = project(runner.position);
            const isPending = Boolean(runner.isPending);
            return (
              <G key={`${runner.bib ?? runner.name}-${index}`}>
                {/* soft glow */}
                <Circle
                  cx={athletePoint.x}
                  cy={athletePoint.y}
                  r={runner.selected ? ringR + 10 : ringR + 5}
                  fill={
                    isPending ? theme.colors.textMuted : theme.colors.accent
                  }
                  opacity={runner.selected ? 0.3 : isPending ? 0.16 : 0.18}
                />
                {/* white ring */}
                <Circle
                  cx={athletePoint.x}
                  cy={athletePoint.y}
                  r={runner.selected ? ringR + 2 : ringR}
                  fill={theme.colors.surface}
                  opacity={1}
                />
                <Circle
                  cx={athletePoint.x}
                  cy={athletePoint.y}
                  r={runner.selected ? ringR : ringR - 1}
                  fill="none"
                  stroke={theme.colors[isPending ? "textMuted" : "accent"]}
                  strokeWidth={2}
                  strokeDasharray={isPending ? "4 4" : undefined}
                  opacity={isPending ? 0.7 : 0.5}
                />
                {runner.photoUrl ? (
                  <SvgImage
                    x={athletePoint.x - avatarR}
                    y={athletePoint.y - avatarR}
                    width={avatarR * 2}
                    height={avatarR * 2}
                    href={{ uri: runner.photoUrl }}
                    preserveAspectRatio="xMidYMid slice"
                    clipPath={`url(#${AVATAR_CLIP_ID}-${index})`}
                  />
                ) : (
                  <>
                    <Circle
                      cx={athletePoint.x}
                      cy={athletePoint.y}
                      r={avatarR}
                      fill={avatarColor(runner.colorSeed ?? runner.name)}
                    />
                    {isPending ? (
                      <Circle
                        cx={athletePoint.x + 7}
                        cy={athletePoint.y - 7}
                        r={3}
                        fill={theme.colors.surface}
                        stroke={theme.colors.textMuted}
                        strokeWidth={1.5}
                      />
                    ) : null}
                    <SvgText
                      x={athletePoint.x}
                      y={athletePoint.y + 4}
                      fill="#FFFFFF"
                      fontSize={11}
                      fontWeight="bold"
                      textAnchor="middle"
                    >
                      {getInitials(runner.name)}
                    </SvgText>
                  </>
                )}
                {effectiveShowAthleteLabels && runner.bib ? (
                  <>
                    {(() => {
                      const bibMetrics = athleteBibLabelMetrics(runner.bib);
                      return (
                        <>
                    <Rect
                      x={athletePoint.x - bibMetrics.width / 2}
                      y={athletePoint.y + ringR + 3}
                      width={bibMetrics.width}
                      height={14}
                      rx={7}
                      fill={theme.colors.textPrimary}
                      opacity={0.85}
                    />
                    <SvgText
                      x={athletePoint.x}
                      y={athletePoint.y + ringR + 13}
                      fill={theme.colors.background}
                      fontSize={bibMetrics.fontSize}
                      fontWeight="bold"
                      textAnchor="middle"
                    >
                      {bibMetrics.label}
                    </SvgText>
                        </>
                      );
                    })()}
                  </>
                ) : null}
              </G>
            );
          })}
        </Svg>
      ) : null}
      {width > 0
        ? visibleMarkers
            .filter((marker) => marker.sourceId?.startsWith("gpx-distance-"))
            .map((marker) => {
              const markerPoint = project(marker.position);
              return (
                <Pressable
                  key={`press-${marker.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${marker.distanceLabel ?? marker.label} location in maps`}
                  hitSlop={6}
                  onPress={() => {
                    zoomBeforeKmMarkerRef.current = zoom;
                    setSelectedKmMarker(marker);
                  }}
                  style={{
                    position: "absolute",
                    left: markerPoint.x - 18,
                    top: markerPoint.y - 18,
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    zIndex: 8,
                  }}
                />
              );
            })
        : null}
      {tiles.length > 0 ? (
        <RNText
          style={{
            position: "absolute",
            left: 8,
            bottom: 5,
            fontSize: 9,
            color: theme.colors.textMuted,
            backgroundColor: `${theme.colors.surface}CC`,
            paddingHorizontal: 4,
          }}
        >
          © OpenStreetMap contributors
        </RNText>
      ) : null}
      {showMapControls ? (
        <View
          pointerEvents="box-none"
          style={{
            position: "absolute",
            right: controlsOffsetRight ?? 10,
            bottom: controlsDock === "bottom" ? 10 : undefined,
            top: controlsDock === "top" ? (controlsOffsetTop ?? 96) : undefined,
            zIndex: 20,
            elevation: 20,
          }}
        >
          {showExpandedMapControls ? (
            <MapControls
              expanded={controlsExpanded}
              showSplitPoints={showSplitPoints}
              showDistanceLabels={showDistanceLabels}
              showAthleteLabels={showAthleteLabels}
              showRoute={showRoute}
              onToggleExpanded={() => setControlsExpanded((value) => !value)}
              onToggleSplitPoints={() => setShowSplitPoints((value) => !value)}
              onToggleDistanceLabels={() =>
                setShowDistanceLabels((value) => !value)
              }
              onToggleAthleteLabels={() =>
                setShowAthleteLabels((value) => !value)
              }
              onToggleRoute={() => setShowRoute((value) => !value)}
              onZoomIn={() => setZoom((value) => Math.min(4, value * 1.25))}
              onZoomOut={() => setZoom((value) => Math.max(1, value / 1.25))}
              onFit={() => setZoom(1)}
              mapType={mapType}
              onMapTypeChange={setMapType}
              mapDimension={mapDimension}
              onMapDimensionChange={setMapDimension}
            />
          ) : (
            <View
              style={{
                borderRadius: 14,
                borderWidth: 1,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.surfaceElevated,
                overflow: "hidden",
              }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Zoom in course map"
                onPress={() => setZoom((value) => Math.min(4, value * 1.25))}
                style={{
                  width: 36,
                  height: 36,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <RNText
                  style={{
                    color: theme.colors.textPrimary,
                    fontSize: 20,
                    fontWeight: "900",
                  }}
                >
                  +
                </RNText>
              </Pressable>
              <View
                style={{ height: 1, backgroundColor: theme.colors.border }}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Zoom out course map"
                onPress={() => setZoom((value) => Math.max(1, value / 1.25))}
                style={{
                  width: 36,
                  height: 36,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <RNText
                  style={{
                    color: theme.colors.textPrimary,
                    fontSize: 22,
                    fontWeight: "900",
                  }}
                >
                  -
                </RNText>
              </Pressable>
              <View
                style={{ height: 1, backgroundColor: theme.colors.border }}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Fit course map"
                onPress={() => setZoom(1)}
                style={{
                  width: 42,
                  height: 32,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <RNText
                  style={{
                    color: theme.colors.textPrimary,
                    fontSize: 10,
                    fontWeight: "900",
                  }}
                >
                  FIT
                </RNText>
              </Pressable>
            </View>
          )}
        </View>
      ) : null}
      <KmMarkerActionModal
        marker={selectedKmMarker}
        onClose={closeKmMarker}
        onNavigate={(marker) => {
          closeKmMarker();
          openMarkerNavigation(marker.position);
        }}
      />
    </View>
  );
}
