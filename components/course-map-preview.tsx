"use client";

import type { EventCourseMap } from "@/packages/contracts/src";

export function CourseMapPreview({
  maps,
  compact = false,
}: {
  maps: EventCourseMap[];
  compact?: boolean;
}) {
  const points = maps.flatMap((map) => map.points);
  if (points.length < 2) return <div className="course-preview-empty">Upload a GPX file to preview this route.</div>;
  const minLat = Math.min(...points.map((point) => point.latitude));
  const maxLat = Math.max(...points.map((point) => point.latitude));
  const minLng = Math.min(...points.map((point) => point.longitude));
  const maxLng = Math.max(...points.map((point) => point.longitude));
  const width = 800;
  const height = compact ? 250 : 380;
  const padding = 28;
  const longitudeSpan = Math.max(maxLng - minLng, 0.000001);
  const latitudeSpan = Math.max(maxLat - minLat, 0.000001);
  const project = (latitude: number, longitude: number) => ({
    x: padding + ((longitude - minLng) / longitudeSpan) * (width - padding * 2),
    y: padding + ((maxLat - latitude) / latitudeSpan) * (height - padding * 2),
  });

  return (
    <div className={`course-map-preview ${compact ? "compact" : ""}`}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Auto-fit GPX route preview">
        <defs>
          <pattern id="course-grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#dce5ef" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width={width} height={height} fill="url(#course-grid)" />
        {maps.map((map) => {
          const route = map.points.map((point) => {
            const projected = project(point.latitude, point.longitude);
            return `${projected.x},${projected.y}`;
          }).join(" ");
          const start = project(map.points[0].latitude, map.points[0].longitude);
          const finishPoint = map.points[map.points.length - 1];
          const finish = project(finishPoint.latitude, finishPoint.longitude);
          return (
            <g key={map.mapId}>
              <polyline points={route} fill="none" stroke="#ffffff" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" opacity=".85" />
              <polyline points={route} fill="none" stroke={map.routeColor} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx={start.x} cy={start.y} r="6" fill={map.routeColor} stroke="#fff" strokeWidth="2" />
              <circle cx={finish.x} cy={finish.y} r="6" fill="#fff" stroke={map.routeColor} strokeWidth="3" />
            </g>
          );
        })}
      </svg>
      <div className="course-map-legend">
        {maps.map((map) => <span key={map.mapId}><i style={{ background: map.routeColor }} />{map.mapName}</span>)}
      </div>
      <small>Route bounds are calculated from the uploaded GPX, so the preview automatically fits the course.</small>
    </div>
  );
}
