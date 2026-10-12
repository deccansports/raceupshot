import type { LatLng } from '@/core/types';

/**
 * Pure geospatial helpers for the live-tracking engine. No React, no I/O — safe
 * to unit test and reuse across the SVG canvas and native map.
 */

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance between two coordinates, in meters. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A polyline with per-vertex cumulative distance, precomputed once. */
export type CumulativePath = {
  points: LatLng[];
  /** cumulative meters at each vertex (cum[0] === 0). */
  cum: number[];
  totalMeters: number;
};

export function buildCumulativePath(points: LatLng[]): CumulativePath {
  const cum: number[] = [];
  let total = 0;
  for (let i = 0; i < points.length; i += 1) {
    if (i === 0) cum.push(0);
    else {
      total += haversineMeters(points[i - 1], points[i]);
      cum.push(total);
    }
  }
  return { points, cum, totalMeters: total };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const lerp = (a: LatLng, b: LatLng, t: number): LatLng => ({
  lat: a.lat + (b.lat - a.lat) * t,
  lng: a.lng + (b.lng - a.lng) * t,
});

/**
 * Position at a normalized fraction (0..1) along the path. Fraction-based so it
 * works regardless of the geometry's absolute scale (course km ≠ GPX meters).
 */
export function positionAtFraction(path: CumulativePath, fraction: number): LatLng {
  const { points, cum, totalMeters } = path;
  if (points.length === 0) return { lat: 0, lng: 0 };
  if (points.length === 1 || totalMeters === 0) return points[0];
  const target = clamp01(fraction) * totalMeters;

  // Binary search for the segment containing `target`.
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  const idx = Math.max(1, lo);
  const segStart = cum[idx - 1];
  const segEnd = cum[idx];
  const segLen = segEnd - segStart || 1;
  const t = clamp01((target - segStart) / segLen);
  return lerp(points[idx - 1], points[idx], t);
}

export type GeoBounds = { minLat: number; maxLat: number; minLng: number; maxLng: number };

export function boundsOf(points: LatLng[]): GeoBounds | undefined {
  if (points.length === 0) return undefined;
  let minLat = points[0].lat;
  let maxLat = points[0].lat;
  let minLng = points[0].lng;
  let maxLng = points[0].lng;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  return { minLat, maxLat, minLng, maxLng };
}

/**
 * Project a coordinate into an SVG box (north up), with padding. Pure — used by
 * the cross-platform track canvas.
 */
export function projectToBox(
  point: LatLng,
  bounds: GeoBounds,
  size: { width: number; height: number },
  padding = 12,
): { x: number; y: number } {
  const spanLat = bounds.maxLat - bounds.minLat || 1e-6;
  const spanLng = bounds.maxLng - bounds.minLng || 1e-6;
  const w = Math.max(1, size.width - padding * 2);
  const h = Math.max(1, size.height - padding * 2);
  const x = padding + ((point.lng - bounds.minLng) / spanLng) * w;
  // Flip Y so north is up.
  const y = padding + (1 - (point.lat - bounds.minLat) / spanLat) * h;
  return { x, y };
}
