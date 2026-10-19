import { coursePathDistanceKm, coursePointAtKm, type CourseLegView } from './mappers';

type Point = { lat: number; lng: number };
export type CourseDirectionArrow = {
  id: string;
  segment: string;
  coordinates: { latitude: number; longitude: number }[];
};

const MAX_COURSE_ARROWS = 36;
const MAX_LEG_ARROWS = 12;
const MIN_ARROW_SEPARATION_PX = 72;

function project(point: Point, zoom: number) {
  const scale = 256 * 2 ** zoom;
  const latitude = (Math.max(-85, Math.min(85, point.lat)) * Math.PI) / 180;
  return {
    x: ((point.lng + 180) / 360) * scale,
    y: ((1 - Math.log(Math.tan(Math.PI / 4 + latitude / 2)) / Math.PI) / 2) * scale,
  };
}

function unproject(x: number, y: number, zoom: number) {
  const scale = 256 * 2 ** zoom;
  return {
    latitude: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / scale))) * 180) / Math.PI,
    longitude: (x / scale) * 360 - 180,
  };
}

function separationPixels(first: Point, second: Point, zoom: number): number {
  const a = project(first, zoom);
  const b = project(second, zoom);
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function bearingDegrees(first: Point, second: Point): number {
  const a = project(first, 0);
  const b = project(second, 0);
  return ((Math.atan2(b.x - a.x, a.y - b.y) * 180) / Math.PI + 360) % 360;
}

function arrowCoordinates(position: Point, bearing: number, zoom: number) {
  const center = project(position, zoom);
  const angle = (bearing * Math.PI) / 180;
  const forward = { x: Math.sin(angle), y: -Math.cos(angle) };
  const side = { x: Math.cos(angle), y: Math.sin(angle) };
  return [[-3, -3], [3, 0], [-3, 3]].map(([along, across]) =>
    unproject(
      center.x + forward.x * along + side.x * across,
      center.y + forward.y * along + side.y * across,
      zoom,
    ),
  );
}

/** Build fixed-screen-size chevrons from the actual GPX direction. */
export function buildCourseDirectionArrows(
  legs: CourseLegView[],
  zoom: number,
): CourseDirectionArrow[] {
  const output: Array<CourseDirectionArrow & { position: Point }> = [];
  for (const leg of legs) {
    if (output.length >= MAX_COURSE_ARROWS || leg.path.length < 2) break;
    if (leg.path.some((point) => !Number.isFinite(point.lat) || !Number.isFinite(point.lng))) continue;
    const measuredKm = coursePathDistanceKm(leg.path);
    if (measuredKm < 0.15) continue;
    const segment = leg.segment.toLowerCase();
    const preferredIntervalKm = segment.includes('bike') || segment.includes('cycl')
      ? 8
      : segment.includes('run') ? 3 : 1;
    const stepKm = Math.max(
      Math.min(preferredIntervalKm, measuredKm / 4),
      measuredKm / MAX_LEG_ARROWS,
    );
    const sampleRadiusKm = Math.min(0.025, stepKm / 10);
    let retained = 0;
    for (let distanceKm = stepKm * 0.25; distanceKm < measuredKm - sampleRadiusKm; distanceKm += stepKm) {
      if (retained >= MAX_LEG_ARROWS || output.length >= MAX_COURSE_ARROWS) break;
      const position = coursePointAtKm(leg.path, distanceKm);
      const before = coursePointAtKm(leg.path, distanceKm - sampleRadiusKm);
      const after = coursePointAtKm(leg.path, distanceKm + sampleRadiusKm);
      if (!position || !before || !after || separationPixels(before, after, zoom) < 0.01) continue;
      if (output.some((arrow) => separationPixels(arrow.position, position, zoom) < MIN_ARROW_SEPARATION_PX)) continue;
      const bearing = bearingDegrees(before, after);
      output.push({
        id: `${leg.id}-direction-${retained}`,
        segment: leg.segment,
        position,
        coordinates: arrowCoordinates(position, bearing, zoom),
      });
      retained += 1;
    }
  }
  return output.map((arrow) => ({
    id: arrow.id,
    segment: arrow.segment,
    coordinates: arrow.coordinates,
  }));
}
