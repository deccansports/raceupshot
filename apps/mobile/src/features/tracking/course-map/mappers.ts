import { isDevelopment } from "@/core/constants/env";
import { formatDistanceKm } from "@/core/utils";
import type {
  CourseGeometry,
  CourseIndex,
  CourseMapMarkerKind,
  LatLng,
  ResolvedTimingConfiguration,
} from "@/core/types";
import { boundsOf, type GeoBounds } from "@/features/tracking/engine";

type MapCourse = "swim" | "bike" | "run" | "split" | "transition" | "finish";
type SplitDistanceReference = "leg" | "race";
type MarkerSource = "geometry" | "timing-point-display";

export type CourseLegView = {
  id: string;
  segment: string;
  label: string;
  distanceKm?: number;
  distanceLabel?: string;
  path: LatLng[];
};

export type CourseMarkerView = {
  id: string;
  sourceId?: string;
  contestId?: string;
  segment?: string;
  label: string;
  kind: CourseMapMarkerKind;
  position: LatLng;
  distanceKm?: number;
  distanceLabel?: string;
  distanceReference?: SplitDistanceReference;
  source?: MarkerSource;
  live?: boolean;
};

export type CourseMapViewModel = {
  name: string;
  hasGeometry: boolean;
  legs: CourseLegView[];
  mergedPath: LatLng[];
  markers: CourseMarkerView[];
  bounds?: GeoBounds;
  timingPoints: {
    id: string;
    label: string;
    segment?: string;
    distanceKm?: number;
    distanceLabel?: string;
  }[];
};

export type CourseTransitionConnector = {
  id: string;
  from: MapCourse;
  to: MapCourse;
  path: [LatLng, LatLng];
  distanceKm: number;
};

type DisplayPoint = {
  id: string;
  label: string;
  course: MapCourse;
  km: number;
  route?: string;
};

const EARTH_RADIUS_KM = 6371;
const developmentWarnings = new Set<string>();

function gpxDistanceMarkerIntervalKm(segment: string): number | undefined {
  const course = canonicalCourse(segment);
  if (course === "swim") return 1;
  // Generate every kilometre from the GPX path. Native map renderers thin
  // these points according to zoom level, allowing the whole course to be
  // represented at overview zoom and progressively revealing detail.
  if (course === "bike") return 1;
  if (course === "run") return 1;
  return undefined;
}

function warnOnce(
  key: string,
  message: string,
  details: Record<string, unknown>,
) {
  if (!isDevelopment || developmentWarnings.has(key)) return;
  developmentWarnings.add(key);
  console.warn(message, details);
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function normalize(value: unknown): string {
  return text(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function stablePart(value: unknown): string {
  return normalize(value) || "unknown";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function normalizeDistanceKm(
  rawValue: unknown,
  explicitUnit?: unknown,
  sourceField?: string,
): number | undefined {
  const value = numberValue(rawValue);
  if (value == null || value < 0) return undefined;
  if (sourceField === "distanceKm" || sourceField === "cumulativeDistanceKm")
    return value;
  const unit = normalize(explicitUnit);
  if (["m", "meter", "meters", "metre", "metres"].includes(unit))
    return value / 1000;
  return value;
}

function canonicalCourse(value: unknown): MapCourse | undefined {
  const course = normalize(value);
  if (course.startsWith("swim")) return "swim";
  if (course.startsWith("bike") || course.startsWith("cycl")) return "bike";
  if (course.startsWith("run")) return "run";
  if (course === "split" || course === "splitpoint") return "split";
  if (course === "transition") return "transition";
  if (course === "finish") return "finish";
  return undefined;
}

/** Straight yellow gap links between consecutive published GPX files/legs. */
export function buildCourseTransitionConnectors(
  legs: CourseLegView[],
): CourseTransitionConnector[] {
  const connectors: CourseTransitionConnector[] = [];
  const connectedPairs = new Set<string>();

  const addConnector = (fromIndex: number, toIndex: number) => {
    const pairKey = `${fromIndex}:${toIndex}`;
    if (connectedPairs.has(pairKey)) return;
    const fromLeg = legs[fromIndex];
    const toLeg = legs[toIndex];
    const from = canonicalCourse(fromLeg?.segment);
    const to = canonicalCourse(toLeg?.segment);
    const fromPoint = fromLeg?.path.at(-1);
    const toPoint = toLeg?.path[0];
    if (!from || !to || !fromPoint || !toPoint) return;
    const transitionKm = distanceBetween(fromPoint, toPoint);
    if (transitionKm < 0.001) return;
    connectedPairs.add(pairKey);
    connectors.push({
      id: `transition-${fromIndex}-${stablePart(fromLeg.id)}-${stablePart(toLeg.id)}`,
      from,
      to,
      path: [fromPoint, toPoint],
      distanceKm: transitionKm,
    });
  };

  for (let index = 0; index < legs.length - 1; index += 1) {
    addConnector(index, index + 1);
  }

  for (const [fromCourse, toCourse] of [
    ["swim", "bike"],
    ["bike", "run"],
  ] as const) {
    let fromIndex = -1;
    legs.forEach((leg, index) => {
      if (canonicalCourse(leg.segment) === fromCourse) fromIndex = index;
    });
    const toIndex = legs.findIndex(
      (leg) => canonicalCourse(leg.segment) === toCourse,
    );
    if (fromIndex >= 0 && toIndex >= 0) addConnector(fromIndex, toIndex);
  }

  return connectors;
}

function distanceBetween(a: LatLng, b: LatLng): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export function coursePathDistanceKm(path: LatLng[]): number {
  let total = 0;
  for (let index = 1; index < path.length; index += 1) {
    total += distanceBetween(path[index - 1], path[index]);
  }
  return total;
}

export function coursePointAtKm(
  path: LatLng[],
  requestedKm: number,
): LatLng | undefined {
  if (path.length === 0) return undefined;
  if (path.length === 1 || requestedKm <= 0) return path[0];
  let covered = 0;
  for (let index = 1; index < path.length; index += 1) {
    const start = path[index - 1];
    const end = path[index];
    const segmentKm = distanceBetween(start, end);
    if (covered + segmentKm >= requestedKm) {
      const ratio = segmentKm > 0 ? (requestedKm - covered) / segmentKm : 0;
      return {
        lat: start.lat + (end.lat - start.lat) * ratio,
        lng: start.lng + (end.lng - start.lng) * ratio,
      };
    }
    covered += segmentKm;
  }
  return path[path.length - 1];
}

export function normalizeTimingPointDisplayConfig(
  timingConfiguration?: ResolvedTimingConfiguration,
): DisplayPoint[] {
  const points = asRecord(
    asRecord(asRecord(timingConfiguration).timingPointDisplayConfig).points,
  );
  const seen = new Set<string>();
  const normalizedPoints: DisplayPoint[] = [];

  for (const [objectKey, rawValue] of Object.entries(points)) {
    const raw = asRecord(rawValue);
    const id = text(raw.pointId) || text(objectKey);
    const label = text(raw.label);
    const course = canonicalCourse(raw.course);
    const km = numberValue(raw.km);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (raw.visible === false || !label || !course || km == null || km < 0)
      continue;
    normalizedPoints.push({
      id,
      label,
      course,
      km,
      route:
        text(
          raw.route ??
            raw.segment ??
            raw.leg ??
            raw.applicableRoute ??
            raw.courseRoute,
        ) || undefined,
    });
  }
  return normalizedPoints;
}

function segmentMatches(
  leg: CourseLegView,
  course: "swim" | "bike" | "run",
): boolean {
  return canonicalCourse(leg.segment) === course;
}

function selectMarkerLeg(
  point: DisplayPoint,
  legs: CourseLegView[],
): CourseLegView | undefined {
  const available = legs.filter((leg) => leg.path.length > 1);
  if (point.course === "finish") return available.at(-1);

  // A generic split point belongs to the only visible course for a
  // single-discipline race. Multi-discipline races can provide `route` to
  // place it on a specific GPX leg.
  if (point.course === "split") {
    const route = normalize(point.route);
    if (route) {
      return available.find((leg) => {
        const segment = normalize(leg.segment);
        return (
          segment === route ||
          canonicalCourse(segment) === canonicalCourse(route)
        );
      });
    }
    return available.length === 1 ? available[0] : undefined;
  }

  if (point.course === "transition") {
    const route = normalize(point.route);
    if (!route) return undefined;
    return available.find((leg) => {
      const segment = normalize(leg.segment);
      return (
        segment === route || canonicalCourse(segment) === canonicalCourse(route)
      );
    });
  }

  const sportCourse = point.course as "swim" | "bike" | "run";
  const candidates = available.filter((leg) =>
    segmentMatches(leg, sportCourse),
  );
  if (point.course !== "run") return candidates[0];
  const genericRun = candidates.find((leg) => normalize(leg.segment) === "run");
  if (genericRun) return genericRun;
  return (
    candidates.find(
      (leg) => point.km <= coursePathDistanceKm(leg.path) + 0.001,
    ) ?? candidates.at(-1)
  );
}

function buildDisplayMarkers(
  points: DisplayPoint[],
  legs: CourseLegView[],
  contestId?: string,
): CourseMarkerView[] {
  return points.flatMap<CourseMarkerView>((point) => {
    const leg = selectMarkerLeg(point, legs);
    if (!leg) {
      warnOnce(
        `missing-route:${contestId ?? "unknown"}:${point.id}:${point.course}:${point.route ?? ""}`,
        "[course-map] timing point skipped",
        {
          pointId: point.id,
          label: point.label,
          reason:
            point.course === "transition"
              ? "transition route not explicitly configured"
              : "applicable GPX route unavailable",
        },
      );
      return [];
    }

    const pathKm = coursePathDistanceKm(leg.path);
    const clampedKm = Math.min(point.km, pathKm);
    if (point.km > pathKm) {
      warnOnce(
        `clamped:${contestId ?? "unknown"}:${point.id}:${point.km}:${pathKm}`,
        "[course-map] timing point KM clamped to GPX endpoint",
        {
          pointId: point.id,
          label: point.label,
          configuredKm: point.km,
          pathKm,
          segment: leg.segment,
        },
      );
    }
    const position = coursePointAtKm(leg.path, clampedKm);
    if (!position) return [];
    return [
      {
        id: `timing-point-${stablePart(point.id)}`,
        sourceId: point.id,
        contestId,
        segment: point.course,
        label: point.label,
        kind:
          point.course === "finish"
            ? "finish"
            : point.course === "transition"
              ? "transition"
              : "timing",
        position,
        distanceKm: point.km,
        distanceLabel: formatDistanceKm(point.km) ?? undefined,
        distanceReference: "leg",
        source: "timing-point-display",
      },
    ];
  });
}

function buildGpxDistanceMarkers(
  legs: CourseLegView[],
  contestId?: string,
): CourseMarkerView[] {
  const markers: CourseMarkerView[] = [];
  const cumulativeKmByCourse = new Map<MapCourse, number>();
  for (const leg of legs) {
    const course = canonicalCourse(leg.segment);
    const measuredKm = coursePathDistanceKm(leg.path);
    const intervalKm = gpxDistanceMarkerIntervalKm(leg.segment);
    if (!course || leg.path.length < 2 || measuredKm <= 0 || intervalKm == null)
      continue;
    const cumulativeStartKm = cumulativeKmByCourse.get(course) ?? 0;
    const cumulativeEndKm = cumulativeStartKm + measuredKm;
    const firstMarkerKm =
      (Math.floor(cumulativeStartKm / intervalKm) + 1) * intervalKm;
    for (
      let cumulativeKm = firstMarkerKm;
      cumulativeKm <= cumulativeEndKm + 0.01;
      cumulativeKm += intervalKm
    ) {
      const localKm = Math.max(0, cumulativeKm - cumulativeStartKm);
      const displayKm = Number(cumulativeKm.toFixed(2));
      const position = coursePointAtKm(leg.path, localKm);
      if (!position) continue;
      markers.push({
        id: `gpx-distance-${stablePart(contestId)}-${stablePart(leg.id)}-${displayKm}`,
        sourceId: `gpx-distance-${stablePart(leg.id)}-${displayKm}`,
        contestId,
        segment: leg.segment,
        label: `${displayKm} km`,
        kind: "timing",
        position,
        distanceKm: displayKm,
        distanceLabel: `${displayKm} km`,
        distanceReference: "leg",
        source: "geometry",
      });
    }
    cumulativeKmByCourse.set(course, cumulativeEndKm);
  }
  return markers;
}

function formatLegLabel(segment: string, index: number): string {
  const value = text(segment);
  if (!value) return `Leg ${index + 1}`;
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function mapCourseMap(
  course?: CourseIndex,
  geometryOverride?: CourseGeometry,
  selectedContest?: { id?: string; name?: string },
  timingConfiguration?: ResolvedTimingConfiguration,
): CourseMapViewModel | undefined {
  const geometry = geometryOverride;
  if (!geometry) return undefined;

  const contestId =
    text(selectedContest?.id ?? geometry.contestId) || undefined;
  const legs: CourseLegView[] = geometry.legs.map((leg, index) => {
    const measuredKm = coursePathDistanceKm(leg.path);
    return {
      id: `leg-${stablePart(contestId)}-${stablePart(leg.segment)}-${index}`,
      segment: leg.segment,
      label: formatLegLabel(leg.segment, index),
      distanceKm: measuredKm > 0 ? measuredKm : leg.distanceKm,
      distanceLabel:
        measuredKm > 0 || leg.distanceKm != null
          ? (formatDistanceKm(measuredKm > 0 ? measuredKm : leg.distanceKm) ??
            undefined)
          : undefined,
      path: leg.path,
    };
  });

  const mergedPath: LatLng[] = [];
  for (const leg of legs) {
    for (const point of leg.path) {
      const previous = mergedPath.at(-1);
      if (
        !previous ||
        previous.lat !== point.lat ||
        previous.lng !== point.lng
      ) {
        mergedPath.push(point);
      }
    }
  }

  const displayPoints = normalizeTimingPointDisplayConfig(timingConfiguration);
  const timingMarkers = buildDisplayMarkers(displayPoints, legs, contestId);
  const gpxDistanceMarkers = buildGpxDistanceMarkers(legs, contestId);
  const markers = [...timingMarkers, ...gpxDistanceMarkers];
  const boundsPoints = [
    ...mergedPath,
    ...markers.map((marker) => marker.position),
  ];

  return {
    name: geometry.name ?? selectedContest?.name ?? "Course",
    hasGeometry: mergedPath.length > 1,
    legs,
    mergedPath,
    markers,
    bounds: boundsPoints.length > 0 ? boundsOf(boundsPoints) : undefined,
    timingPoints: displayPoints.map((point) => ({
      id: point.id,
      label: point.label,
      segment: point.course,
      distanceKm: point.km,
      distanceLabel: formatDistanceKm(point.km) ?? undefined,
    })),
  };
}
