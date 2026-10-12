import type { LatLng } from '@/core/types';

/**
 * Minimal GPX track parser (no XML dependency). Extracts ordered track,
 * route, and waypoint coordinates. Real exporter output varies: namespaces,
 * single quotes, uppercase tags, and lon-before-lat all appear in the wild.
 */
export function parseGpxTrack(xml: string): LatLng[] {
  const points: LatLng[] = [];
  const tagRe = /<(?:(?:[\w-]+):)?(?:trkpt|rtept|wpt)\b([^>]*)>([\s\S]*?)<\/(?:(?:[\w-]+):)?(?:trkpt|rtept|wpt)>|<(?:(?:[\w-]+):)?(?:trkpt|rtept|wpt)\b([^>]*)\/>/gi;
  const attrRe = /\b(lat|lon|lng)\s*=\s*["']([^"']+)["']/gi;
  const eleRe = /<(?:(?:[\w-]+):)?ele>\s*([^<]+)\s*<\/(?:(?:[\w-]+):)?ele>/i;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(xml)) !== null) {
    let lat: number | undefined;
    let lng: number | undefined;
    const attrs = match[1] ?? match[3] ?? '';
    const body = match[2] ?? '';
    attrRe.lastIndex = 0;
    let attr: RegExpExecArray | null;
    while ((attr = attrRe.exec(attrs)) !== null) {
      const parsed = Number(attr[2]);
      if (!Number.isFinite(parsed)) continue;
      if (attr[1].toLowerCase() === 'lat') lat = parsed;
      else lng = parsed;
    }
    if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
      const ele = Number(body.match(eleRe)?.[1]);
      points.push(Number.isFinite(ele) ? { lat, lng, ele } : { lat, lng });
    }
  }
  return points;
}

/**
 * Evenly downsample a polyline to at most `maxPoints` (keeps first + last).
 * Course GPX tracks have 1k–5k points; the map only needs a few hundred.
 */
export function simplifyPath(points: LatLng[], maxPoints = 300): LatLng[] {
  if (points.length <= maxPoints) return points;
  const out: LatLng[] = [];
  const step = points.length / maxPoints;
  for (let i = 0; i < maxPoints; i += 1) out.push(points[Math.floor(i * step)]);
  out.push(points[points.length - 1]);
  return out;
}
