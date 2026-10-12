"use client";

import type { EventCourseMap } from "@/packages/contracts/src";
import { Gauge, Info, Mountain } from "lucide-react";
import { useMemo } from "react";

type ElevationPoint = { distanceKm: number; elevationM: number };
type ElevationSegment = { id: string; color: string; points: ElevationPoint[] };

const EARTH_RADIUS_KM = 6371;

function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const latA = (a.latitude * Math.PI) / 180;
  const latB = (b.latitude * Math.PI) / 180;
  const haversine = Math.sin(dLat / 2) ** 2 + Math.cos(latA) * Math.cos(latB) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(haversine));
}

function elevationProfile(maps: EventCourseMap[]) {
  let offsetKm = 0;
  const segments: ElevationSegment[] = [];
  maps.forEach((map) => {
    let segmentDistanceKm = 0;
    const points: ElevationPoint[] = [];
    map.points.forEach((point, index) => {
      if (index > 0) segmentDistanceKm += distanceKm(map.points[index - 1], point);
      if (typeof point.elevation === "number" && Number.isFinite(point.elevation)) {
        points.push({ distanceKm: offsetKm + segmentDistanceKm, elevationM: point.elevation });
      }
    });
    if (points.length > 1) segments.push({ id: map.mapId, color: map.routeColor, points });
    offsetKm += segmentDistanceKm;
  });
  return { segments, totalDistanceKm: offsetKm };
}

function formatDistance(value: number) {
  return value >= 10 ? `${value.toFixed(0)} km` : `${value.toFixed(1)} km`;
}

function terrainFor(slopes: number[], ascent: number, distanceKm: number) {
  const ordered = [...slopes].sort((a, b) => a - b);
  const p90 = ordered[Math.max(0, Math.ceil(ordered.length * 0.9) - 1)] ?? 0;
  const maxSlope = ordered.at(-1) ?? 0;
  const averageClimb = distanceKm > 0 ? (ascent / (distanceKm * 1000)) * 100 : 0;
  const steepShare = slopes.filter((slope) => slope >= 6).length / Math.max(slopes.length, 1);
  const mediumShare = slopes.filter((slope) => slope >= 3).length / Math.max(slopes.length, 1);
  if (p90 >= 6 || steepShare >= 0.2 || maxSlope >= 10) return { grade: "Tough climbing grade", speed: "Reduced speed, manage effort", color: "#dc2626", background: "#fef2f2", border: "#fecaca" };
  if (p90 >= 4 || mediumShare >= 0.35 || averageClimb >= 2) return { grade: "Medium rolling grade", speed: "Moderate speed profile", color: "#2563eb", background: "#eff6ff", border: "#bfdbfe" };
  if (p90 >= 2.5 || mediumShare >= 0.2 || averageClimb >= 1.2) return { grade: "Light rolling grade", speed: "Mostly fast, watch rollers", color: "#ea580c", background: "#fff7ed", border: "#fed7aa" };
  return { grade: "Flat & Fast", speed: "High speed potential", color: "#059669", background: "#ecfdf5", border: "#a7f3d0" };
}

function slopeColor(slope: number) {
  if (slope >= 6) return "#dc2626";
  if (slope >= 3) return "#2563eb";
  if (slope >= 2) return "#ea580c";
  return "#059669";
}

export function CourseElevationProfile({ maps }: { maps: EventCourseMap[] }) {
  const profile = useMemo(() => elevationProfile(maps), [maps]);
  const elevationPoints = profile.segments.flatMap((segment) => segment.points);
  if (elevationPoints.length < 2) return null;

  const elevations = elevationPoints.map((point) => point.elevationM);
  const minElevation = Math.min(...elevations);
  const maxElevation = Math.max(...elevations);
  const elevationPadding = Math.max((maxElevation - minElevation) * 0.12, 5);
  const lowerElevation = minElevation - elevationPadding;
  const upperElevation = maxElevation + elevationPadding;
  const elevationSpan = Math.max(upperElevation - lowerElevation, 1);
  let ascent = 0;
  let descent = 0;
  const slopes: number[] = [];
  profile.segments.forEach((segment) => {
    segment.points.forEach((point, index) => {
      if (!index) return;
      const change = point.elevationM - segment.points[index - 1].elevationM;
      const distanceMetres = (point.distanceKm - segment.points[index - 1].distanceKm) * 1000;
      if (change > 0) ascent += change;
      else descent += Math.abs(change);
      if (distanceMetres >= 1) slopes.push(Math.abs(change / distanceMetres) * 100);
    });
  });

  const width = 1000;
  const height = 250;
  const left = 48;
  const right = 22;
  const top = 28;
  const bottom = 188;
  const chartWidth = width - left - right;
  const totalDistance = Math.max(profile.totalDistanceKm, 0.001);
  const toX = (distance: number) => left + (distance / totalDistance) * chartWidth;
  const toY = (elevation: number) => bottom - ((elevation - lowerElevation) / elevationSpan) * (bottom - top);
  const linePath = (points: ElevationPoint[]) => points.map((point, index) => `${index ? "L" : "M"} ${toX(point.distanceKm).toFixed(1)} ${toY(point.elevationM).toFixed(1)}`).join(" ");
  const areaPath = (points: ElevationPoint[]) => `${linePath(points)} L ${toX(points.at(-1)?.distanceKm ?? 0).toFixed(1)} ${bottom} L ${toX(points[0]?.distanceKm ?? 0).toFixed(1)} ${bottom} Z`;
  const terrain = terrainFor(slopes, ascent, profile.totalDistanceKm);
  const routeLabel = maps.length === 1 ? maps[0].mapName : "Combined course";

  return (
    <section className="course-elevation-card" aria-label="Course elevation profile">
      <header><h3><Mountain /> {routeLabel.toUpperCase()} ELEVATION PROFILE</h3></header>
      <div className="course-elevation-insights">
        <article style={{ background: terrain.background, borderColor: terrain.border }}><small><Mountain /> GRADE</small><b style={{ color: terrain.color }}>{terrain.grade}</b><span>Avg climb {((ascent / Math.max(profile.totalDistanceKm * 1000, 1)) * 100).toFixed(2)}% · P90 slope {(slopes.sort((a, b) => a - b).at(Math.max(0, Math.ceil(slopes.length * .9) - 1)) ?? 0).toFixed(1)}%</span></article>
        <article><small><Gauge /> SPEED IMPACT</small><b style={{ color: terrain.color }}>{terrain.speed}</b><span>Gain {Math.round(ascent)} m · Loss {Math.round(descent)} m</span></article>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Elevation profile over ${formatDistance(profile.totalDistanceKm)}. Total ascent ${Math.round(ascent)} metres and descent ${Math.round(descent)} metres.`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="course-elevation-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#1670b5" stopOpacity=".42" /><stop offset="100%" stopColor="#1670b5" stopOpacity=".04" /></linearGradient>
        </defs>
        {[0, 1, 2, 3].map((index) => {
          const y = top + ((bottom - top) / 3) * index;
          const elevation = upperElevation - (elevationSpan / 3) * index;
          return <g key={`horizontal-${index}`}><line x1={left} x2={width - right} y1={y} y2={y} className="course-elevation-grid" /><text x={left - 9} y={y + 4} textAnchor="end">{Math.round(elevation)}m</text></g>;
        })}
        {[0, 1, 2, 3, 4].map((index) => {
          const x = left + (chartWidth / 4) * index;
          const distance = (profile.totalDistanceKm / 4) * index;
          return <g key={`vertical-${index}`}><line x1={x} x2={x} y1={top} y2={bottom} className="course-elevation-grid vertical" /><text x={x} y={bottom + 24} textAnchor="middle">{formatDistance(distance)}</text></g>;
        })}
        {profile.segments.map((segment) => <path key={`${segment.id}-area`} d={areaPath(segment.points)} fill="url(#course-elevation-fill)" />)}
        {profile.segments.flatMap((segment) => segment.points.slice(1).map((point, index) => { const previous = segment.points[index]; const metres = (point.distanceKm - previous.distanceKm) * 1000; const slope = metres > 0 ? Math.abs((point.elevationM - previous.elevationM) / metres) * 100 : 0; return <line key={`${segment.id}-${index}`} x1={toX(previous.distanceKm)} y1={toY(previous.elevationM)} x2={toX(point.distanceKm)} y2={toY(point.elevationM)} stroke={slopeColor(slope)} strokeWidth="4" strokeLinecap="round" />; }))}
      </svg>
      <footer><span>LOW {Math.round(minElevation)} m</span><b>{formatDistance(profile.totalDistanceKm)} course</b><span>HIGH {Math.round(maxElevation)} m</span></footer>
      <div className="course-elevation-meaning"><Info /> <span><b>WHAT THIS MEANS</b><br /><i>Red:</i> tough climbing, slower pace expected. <em>Blue/Orange:</em> medium or rolling terrain, controlled pacing helps. <strong>Green:</strong> flatter route, better speed potential.</span></div>
    </section>
  );
}
