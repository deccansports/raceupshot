import type { CourseGeometry, LatLng } from "@/core/types";

export type ElevationPoint = {
  distance: number;
  elevation: number;
};

export type TerrainClassification = {
  gradeLabel: string;
  speedLabel: string;
  color: string;
  background: string;
  border: string;
};

export type ElevationStatistics = {
  totalDistanceKm: number;
  totalGainM: number;
  totalLossM: number;
  minElevationM: number;
  maxElevationM: number;
  averageClimbPercent: number;
  p90Slope: number;
  maxSlope: number;
  steepShare: number;
  mediumShare: number;
  flatShare: number;
};

export type ElevationRouteProfile = {
  id: string;
  segment: string;
  label: string;
  color: string;
  gpxUrl?: string;
  loadError: boolean;
  points: ElevationPoint[];
  drawPoints: ElevationPoint[];
  statistics?: ElevationStatistics;
  terrain?: TerrainClassification;
  sections?: ElevationProfileSection[];
};

export type ElevationProfileSection = {
  id: string;
  segment: string;
  label: string;
  color: string;
  startDistance: number;
  endDistance: number;
  points: ElevationPoint[];
  drawPoints: ElevationPoint[];
};

const EARTH_RADIUS_KM = 6371;
const profileCache = new WeakMap<object, ElevationRouteProfile[]>();
const analysisByGpxUrl = new Map<
  string,
  Pick<
    ElevationRouteProfile,
    "points" | "drawPoints" | "statistics" | "terrain"
  >
>();

function normalizedSegment(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function segmentMeta(segment: string, index: number) {
  const normalized = normalizedSegment(segment);
  if (normalized === "swim" || normalized === "swimming") {
    return { kind: "swim", label: "Swim", color: "#0ea5e9" };
  }
  if (
    normalized === "bike" ||
    normalized === "cycle" ||
    normalized === "cycling"
  ) {
    return { kind: "bike", label: "Bike", color: "#22c55e" };
  }
  if (normalized === "run1") {
    return { kind: "run1", label: "Run 1", color: "#f97316" };
  }
  if (normalized === "run2") {
    return { kind: "run2", label: "Run 2", color: "#f59e0b" };
  }
  if (normalized === "run" || normalized === "running") {
    return { kind: "run", label: "Run", color: "#f97316" };
  }
  return {
    kind: normalized || `route${index + 1}`,
    label: String(segment || `Route ${index + 1}`),
    color: "#64748b",
  };
}

function distanceKm(a: LatLng, b: LatLng): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export function elevationPoints(path: LatLng[]): ElevationPoint[] {
  const result: ElevationPoint[] = [];
  let cumulativeDistance = 0;
  for (let index = 0; index < path.length; index += 1) {
    const point = path[index];
    if (index > 0) cumulativeDistance += distanceKm(path[index - 1], point);
    if (typeof point.ele === "number" && Number.isFinite(point.ele)) {
      result.push({ distance: cumulativeDistance, elevation: point.ele });
    }
  }
  return result;
}

function percentile90(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.9) - 1)];
}

export function elevationStatistics(
  points: ElevationPoint[],
): ElevationStatistics | undefined {
  if (points.length < 2) return undefined;
  let totalGainM = 0;
  let totalLossM = 0;
  const slopes: number[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const deltaElevation = current.elevation - previous.elevation;
    const deltaDistanceMetres = (current.distance - previous.distance) * 1000;
    if (deltaDistanceMetres < 1) continue;
    if (deltaElevation > 0) totalGainM += deltaElevation;
    if (deltaElevation < 0) totalLossM += Math.abs(deltaElevation);
    slopes.push(Math.abs(deltaElevation / deltaDistanceMetres) * 100);
  }
  const totalDistanceKm = Math.max(0, points.at(-1)?.distance ?? 0);
  const minElevationM = Math.min(...points.map((point) => point.elevation));
  const maxElevationM = Math.max(...points.map((point) => point.elevation));
  const count = Math.max(slopes.length, 1);
  return {
    totalDistanceKm,
    totalGainM,
    totalLossM,
    minElevationM,
    maxElevationM,
    averageClimbPercent:
      totalDistanceKm > 0 ? (totalGainM / (totalDistanceKm * 1000)) * 100 : 0,
    p90Slope: percentile90(slopes),
    maxSlope: slopes.length > 0 ? Math.max(...slopes) : 0,
    steepShare: slopes.filter((slope) => slope >= 6).length / count,
    mediumShare: slopes.filter((slope) => slope >= 3).length / count,
    flatShare: slopes.filter((slope) => slope < 2).length / count,
  };
}

export function classifyTerrain(
  stats: ElevationStatistics,
): TerrainClassification {
  if (stats.p90Slope >= 6 || stats.steepShare >= 0.2 || stats.maxSlope >= 10) {
    return {
      gradeLabel: "Tough climbing grade",
      speedLabel: "Reduced speed, manage effort",
      color: "#dc2626",
      background: "#fef2f2",
      border: "#fecaca",
    };
  }
  if (
    stats.p90Slope >= 4 ||
    stats.mediumShare >= 0.35 ||
    stats.averageClimbPercent >= 2
  ) {
    return {
      gradeLabel: "Medium rolling grade",
      speedLabel: "Moderate speed profile",
      color: "#2563eb",
      background: "#eff6ff",
      border: "#bfdbfe",
    };
  }
  if (
    stats.p90Slope >= 2.5 ||
    stats.mediumShare >= 0.2 ||
    stats.averageClimbPercent >= 1.2 ||
    (stats.flatShare < 0.6 && stats.p90Slope >= 2)
  ) {
    return {
      gradeLabel: "Light rolling grade",
      speedLabel: "Mostly fast, watch rollers",
      color: "#ea580c",
      background: "#fff7ed",
      border: "#fed7aa",
    };
  }
  return {
    gradeLabel: "Flat & Fast",
    speedLabel: "High speed potential",
    color: "#059669",
    background: "#ecfdf5",
    border: "#a7f3d0",
  };
}

export function downsampleElevation(
  points: ElevationPoint[],
  maxPoints = 240,
): ElevationPoint[] {
  if (points.length <= maxPoints) return points;
  const indices = new Set<number>([0, points.length - 1]);
  let minIndex = 0;
  let maxIndex = 0;
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].elevation < points[minIndex].elevation) minIndex = index;
    if (points[index].elevation > points[maxIndex].elevation) maxIndex = index;
  }
  indices.add(minIndex);
  indices.add(maxIndex);
  const remainingSlots = Math.max(0, maxPoints - indices.size);
  for (let index = 1; index <= remainingSlots; index += 1) {
    indices.add(
      Math.round((index / (remainingSlots + 1)) * (points.length - 1)),
    );
  }
  return [...indices].sort((a, b) => a - b).map((index) => points[index]);
}

export function buildElevationProfiles(
  geometry?: CourseGeometry | null,
): ElevationRouteProfile[] {
  if (!geometry) return [];
  const cached = profileCache.get(geometry);
  if (cached) return cached;
  const profiles = geometry.legs.map((leg, index) => {
    const meta = segmentMeta(leg.segment, index);
    const cachedAnalysis = leg.gpxUrl
      ? analysisByGpxUrl.get(leg.gpxUrl)
      : undefined;
    const points =
      cachedAnalysis?.points ?? elevationPoints(leg.elevationPath ?? leg.path);
    const statistics =
      cachedAnalysis?.statistics ?? elevationStatistics(points);
    const analysis = cachedAnalysis ?? {
      points,
      drawPoints: downsampleElevation(points),
      statistics,
      terrain: statistics ? classifyTerrain(statistics) : undefined,
    };
    if (leg.gpxUrl && !leg.loadError)
      analysisByGpxUrl.set(leg.gpxUrl, analysis);
    return {
      id: `${meta.kind}-${index}`,
      segment: meta.kind,
      label: meta.label,
      color: meta.color,
      gpxUrl: leg.gpxUrl,
      loadError: Boolean(leg.loadError),
      ...analysis,
    } satisfies ElevationRouteProfile;
  });
  profileCache.set(geometry, profiles);
  return profiles;
}

export function combineElevationProfiles(
  profiles: ElevationRouteProfile[],
): ElevationRouteProfile | undefined {
  const routes = profiles.filter((profile) => profile.segment !== "swim");
  if (routes.length === 0) return undefined;
  const sections: ElevationProfileSection[] = [];
  const points: ElevationPoint[] = [];
  const drawPoints: ElevationPoint[] = [];
  let offset = 0;
  for (const route of routes) {
    const routeDistance = route.statistics?.totalDistanceKm ?? 0;
    const sectionPoints = route.points.map((point) => ({
      distance: offset + point.distance,
      elevation: point.elevation,
    }));
    const sectionDrawPoints = route.drawPoints.map((point) => ({
      distance: offset + point.distance,
      elevation: point.elevation,
    }));
    sections.push({
      id: route.id,
      segment: route.segment,
      label: route.label,
      color: route.color,
      startDistance: offset,
      endDistance: offset + routeDistance,
      points: sectionPoints,
      drawPoints: sectionDrawPoints,
    });
    points.push(...sectionPoints);
    drawPoints.push(...sectionDrawPoints);
    offset += routeDistance;
  }
  const statistics = elevationStatistics(points);
  return {
    id: `combined-${routes.map((route) => route.id).join("-")}`,
    segment: "combined",
    label: routes.map((route) => route.label).join(" + "),
    color: statistics ? classifyTerrain(statistics).color : "#64748b",
    loadError: routes.some((route) => route.loadError),
    points,
    drawPoints,
    statistics,
    terrain: statistics ? classifyTerrain(statistics) : undefined,
    sections,
  };
}

export function nearestElevationPoint(
  points: ElevationPoint[],
  distance: number,
): ElevationPoint | undefined {
  if (points.length === 0) return undefined;
  const clamped = Math.max(0, Math.min(distance, points.at(-1)?.distance ?? 0));
  let low = 0;
  let high = points.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (points[mid].distance < clamped) low = mid + 1;
    else high = mid;
  }
  const current = points[low];
  const previous = points[Math.max(0, low - 1)];
  return Math.abs(previous.distance - clamped) <=
    Math.abs(current.distance - clamped)
    ? previous
    : current;
}
