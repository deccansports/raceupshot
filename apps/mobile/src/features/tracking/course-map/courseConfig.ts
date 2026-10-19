import type { CourseGeometry, LatLng } from "@/core/types";
import { env } from "@/core/constants/env";

import { parseGpxTrack, simplifyPath } from "./gpx";

export type CourseMapSelection = {
  ticketId?: string;
  contestId?: string;
  contestName?: string;
};

type LegConfig = {
  segment: string;
  gpxUrl?: string;
  points?: LatLng[];
  distanceKm?: number;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function normalized(value: unknown): string {
  return text(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function finitePositive(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function normalizeGpxUrl(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    if (
      parsed.protocol === "http:" &&
      parsed.hostname === "raw.githubusercontent.com"
    ) {
      parsed.protocol = "https:";
    }
    return parsed.toString();
  } catch {
    return raw.startsWith("http://raw.githubusercontent.com/")
      ? raw.replace(/^http:\/\//i, "https://")
      : raw;
  }
}

function ticketCandidates(ticket: Record<string, unknown>): string[] {
  return [
    ticket.id,
    ticket.ticketId,
    ticket.ticketDefinitionId,
    ticket.contestId,
    ticket.contestUuid,
    ticket.providerContestUuid,
    ticket.mappedContestId,
    ticket.mappedContestUuid,
    ticket.ticketName,
    ticket.name,
    ticket.label,
  ]
    .map(normalized)
    .filter(Boolean);
}

function selectionCandidates(selection?: CourseMapSelection): string[] {
  return [selection?.ticketId, selection?.contestId, selection?.contestName]
    .map(normalized)
    .filter(Boolean);
}

function readTicketDefinitions(
  root: Record<string, unknown>,
): Record<string, unknown>[] {
  const courseMapsEnvelope = asRecord(root.courseMaps);
  const raw = Array.isArray(root.ticketDefinitions)
    ? root.ticketDefinitions
    : Array.isArray(courseMapsEnvelope.ticketDefinitions)
      ? courseMapsEnvelope.ticketDefinitions
      : [];
  return raw.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item),
  );
}

function selectTicket(
  root: Record<string, unknown>,
  tickets: Record<string, unknown>[],
  selection?: CourseMapSelection,
): Record<string, unknown> | undefined {
  const requested = selectionCandidates(selection);
  if (requested.length > 0) {
    const exact = tickets.find((ticket) =>
      ticketCandidates(ticket).some((candidate) =>
        requested.includes(candidate),
      ),
    );
    if (exact) return exact;
    // A tracked athlete is an explicit course scope. Never fall back to an
    // arbitrary event ticket because that can combine another contest's GPX
    // and elevation data with the selected athlete. A one-ticket event is the
    // exception: Feibot search rows may only expose the provider contest UUID,
    // while the saved Bergman course is keyed by the ticket ID. There is no
    // alternate course to select in that case.
    if (tickets.length === 1) return tickets[0];
    return undefined;
  }

  const primaryId = normalized(
    root.primaryTicketId ?? asRecord(root.courseMaps).primaryTicketId,
  );
  if (primaryId) {
    const primary = tickets.find((ticket) =>
      ticketCandidates(ticket).includes(primaryId),
    );
    if (primary) return primary;
  }
  return tickets[0];
}

function selectCanonicalContest(
  root: Record<string, unknown>,
  selection?: CourseMapSelection,
): Record<string, unknown> | undefined {
  const contests = Array.isArray(root.contests)
    ? root.contests.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
  const requested = selectionCandidates(selection);
  if (requested.length > 0) {
    const exact = contests.find((contest) =>
      [
        contest.providerContestUuid,
        contest.contestUuid,
        contest.id,
        contest.bergmanTicketId,
        contest.displayName,
        contest.contestName,
        contest.name,
      ].map(normalized).some((candidate) => requested.includes(candidate)),
    );
    if (exact) return exact;
    return undefined;
  }
  return contests[0];
}

function addLeg(
  legs: LegConfig[],
  segment: string,
  gpxUrl: unknown,
  distanceKm?: unknown,
  rawPoints?: unknown,
) {
  const url = normalizeGpxUrl(gpxUrl);
  const points = Array.isArray(rawPoints)
    ? rawPoints.map((value) => {
        const point = asRecord(value);
        const lat = Number(point.lat ?? point.latitude);
        const lng = Number(point.lng ?? point.lon ?? point.longitude);
        const ele = Number(point.ele ?? point.elevation);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return Number.isFinite(ele) ? { lat, lng, ele } : { lat, lng };
      }).filter((point): point is LatLng => point !== null)
    : [];
  if (!url && points.length < 2) return;
  legs.push({
    segment,
    ...(url ? { gpxUrl: url } : {}),
    ...(points.length > 1 ? { points } : {}),
    distanceKm: finitePositive(distanceKm),
  });
}

/**
 * Reads GPX URLs only from the selected ticket definition. Race Flow split
 * arrays and legacy `courseMaps.*Splits` fields are deliberately ignored.
 */
export function extractCourseConfig(
  config: unknown,
  selection?: CourseMapSelection,
): { name?: string; ticketId?: string; legs: LegConfig[] } {
  const root = asRecord(config);
  const tickets = readTicketDefinitions(root);
  const ticket = selectTicket(root, tickets, selection);
  if (!ticket) {
    const contest = selectCanonicalContest(root, selection);
    if (!contest) return { legs: [] };
    const legs: LegConfig[] = [];
    for (const value of Array.isArray(contest.legs) ? contest.legs : []) {
      const leg = asRecord(value);
      const urls = Array.isArray(leg.gpxUrls) ? leg.gpxUrls : [];
      addLeg(
        legs,
        text(leg.type ?? leg.key ?? leg.legType) || "course",
        leg.gpxUrl ?? urls[0],
        leg.distanceKm,
      );
    }
    return {
      name: text(contest.displayName ?? contest.contestName ?? contest.name) || undefined,
      ticketId: text(contest.bergmanTicketId ?? contest.providerContestUuid ?? contest.contestUuid ?? contest.id) || undefined,
      legs,
    };
  }

  const maps = asRecord(ticket.courseMaps);
  const legs: LegConfig[] = [];
  addLeg(legs, "swim", maps.swimGpxUrl, maps.swimDistance, maps.swimPoints);
  addLeg(legs, "bike", maps.bikeGpxUrl, maps.bikeDistance, maps.bikePoints);

  if (normalizeGpxUrl(maps.runGpxUrl) || Array.isArray(maps.runPoints)) {
    addLeg(legs, "run", maps.runGpxUrl, maps.runDistance, maps.runPoints);
  } else {
    addLeg(legs, "run1", maps.run1GpxUrl, maps.run1Distance, maps.run1Points);
    addLeg(legs, "run2", maps.run2GpxUrl, maps.run2Distance, maps.run2Points);
  }

  return {
    name: text(ticket.ticketName ?? ticket.name) || undefined,
    ticketId: text(ticket.id ?? ticket.ticketId) || undefined,
    legs,
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

const parsedGpxByUrl = new Map<string, Promise<LatLng[]>>();

function cachedGpxTrack(
  url: string,
  fetchText: (url: string) => Promise<string>,
): Promise<LatLng[]> {
  const cached = parsedGpxByUrl.get(url);
  if (cached) return cached;
  const proxyUrl = `${env.mobileApiBaseUrl.replace(/\/$/, "")}/api/proxy-gpx?url=${encodeURIComponent(url)}`;
  const candidates = url.includes('/api/proxy-gpx?') ? [url] : [proxyUrl, url];
  const pending = (async () => {
    let lastError: unknown = null;
    for (const candidate of candidates) {
      try {
        const parsed = parseGpxTrack(await fetchText(candidate));
        if (parsed.length > 1) return parsed;
        lastError = new Error(`GPX contained ${parsed.length} usable track point(s).`);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('GPX course could not be loaded.');
  })();
  parsedGpxByUrl.set(url, pending);
  void pending.catch(() => {
    if (parsedGpxByUrl.get(url) === pending) parsedGpxByUrl.delete(url);
  });
  return pending;
}

/** Fetches and parses only the selected ticket's GPX routes. Marker placement
 * is performed later from `timingPointDisplayConfig.points`.
 */
export async function resolveCourseGeometry(
  config: unknown,
  fetchText: (url: string) => Promise<string>,
  selection?: CourseMapSelection,
): Promise<CourseGeometry | undefined> {
  const { name, ticketId, legs } = extractCourseConfig(config, selection);
  if (legs.length === 0) return undefined;

  const routes = await Promise.all(
    legs.map(async (leg) => {
      if (leg.points && leg.points.length > 1) {
        return {
          parsed: leg.points,
          simplified: simplifyPath(leg.points),
          loadError: false,
        };
      }
      try {
        const parsed = await cachedGpxTrack(leg.gpxUrl!, fetchText);
        const simplified = simplifyPath(parsed);
        if (process.env.NODE_ENV !== "production") {
          console.info("[course-geometry] GPX parsed", {
            segment: leg.segment,
            points: parsed.length,
            simplifiedPoints: simplified.length,
          });
        }
        return { parsed, simplified, loadError: false };
      } catch (error) {
        if (isAbortError(error)) throw error;
        if (process.env.NODE_ENV !== "production") {
          console.warn("[course-geometry] GPX fetch failed", {
            segment: leg.segment,
            message: error instanceof Error ? error.message : String(error),
          });
        }
        return {
          parsed: [] as LatLng[],
          simplified: [] as LatLng[],
          loadError: true,
        };
      }
    }),
  );

  const geometryLegs = legs.map<CourseGeometry["legs"][number]>(
    (leg, index) => ({
      segment: leg.segment,
      path: routes[index].simplified,
      elevationPath: routes[index].parsed,
      gpxUrl: leg.gpxUrl,
      loadError: routes[index].loadError,
      distanceKm: leg.distanceKm,
    }),
  );

  return {
    contestId: ticketId,
    name,
    legs: geometryLegs,
    markers: [],
  };
}
