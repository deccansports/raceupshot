"use client";

import type { EventCourseMap } from "@/packages/contracts/src";

function mercator(latitude: number) {
  const bounded = Math.max(-85, Math.min(85, latitude));
  return Math.log(Math.tan(Math.PI / 4 + (bounded * Math.PI) / 360));
}

function projectedSegments(maps: EventCourseMap[]) {
  const rows = maps.map((map) => ({
    ...map,
    projected: map.points.map((point) => ({ x: point.longitude, y: mercator(point.latitude) })),
  }));
  const points = rows.flatMap((map) => map.projected);
  if (!points.length) return [];
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const width = Math.max(maxX - minX, 0.000001);
  const height = Math.max(maxY - minY, 0.000001);
  const scale = Math.min(920 / width, 440 / height);
  const offsetX = (1000 - width * scale) / 2;
  const offsetY = (520 - height * scale) / 2;
  return rows.map((map) => ({
    ...map,
    path: map.projected.map((point) => `${offsetX + (point.x - minX) * scale},${offsetY + (maxY - point.y) * scale}`).join(" "),
  }));
}

export function CourseMapCanvas({ maps, label = "Course map preview" }: { maps: EventCourseMap[]; label?: string }) {
  const segments = projectedSegments(maps);
  return (
    <div className="course-map-canvas">
      {segments.length ? (
        <svg viewBox="0 0 1000 520" role="img" aria-label={label} preserveAspectRatio="xMidYMid meet">
          <defs>
            <pattern id="course-grid" width="50" height="50" patternUnits="userSpaceOnUse">
              <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#dce5ed" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="1000" height="520" fill="#f3f7f9" />
          <rect width="1000" height="520" fill="url(#course-grid)" />
          {segments.map((map) => <polyline key={map.mapId} points={map.path} fill="none" stroke="#fff" strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" />)}
          {segments.map((map) => <polyline key={`${map.mapId}-color`} points={map.path} fill="none" stroke={map.routeColor} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />)}
          {segments.map((map) => {
            const start = map.path.split(" ")[0]?.split(",");
            if (!start) return null;
            return <circle key={`${map.mapId}-start`} cx={start[0]} cy={start[1]} r="8" fill={map.routeColor} stroke="#fff" strokeWidth="4" />;
          })}
        </svg>
      ) : <div className="course-map-empty">Upload a GPX file to preview its actual route.</div>}
    </div>
  );
}
