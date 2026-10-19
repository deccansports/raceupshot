import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { KVNamespace } from "@cloudflare/workers-types";
import type {
  EventCourseCollection,
  EventCourseMap,
  EventCourseView,
} from "@/packages/contracts/src";
import { getEventBySlug } from "./raceupshot-repository";
import { withTransientKvRetry } from "./kv-retry";

const PREFIX = "raceupshot";

async function getKv(): Promise<KVNamespace> {
  const { env } = await getCloudflareContext({ async: true });
  if (!env.RACEUPSHOT) throw new Error("RACEUPSHOT KV binding is unavailable.");
  return withTransientKvRetry(env.RACEUPSHOT);
}

function courseMapsKey(eventId: string) {
  return `${PREFIX}:course-maps:event:${eventId}`;
}

function ordered(maps: EventCourseMap[]) {
  return [...maps].sort((left, right) => left.displayOrder - right.displayOrder || left.mapName.localeCompare(right.mapName));
}

export async function getAdminEventCourseMaps(eventIdOrSlug: string): Promise<EventCourseCollection | null> {
  const event = await getEventBySlug(eventIdOrSlug, { includeUnpublished: true });
  if (!event) return null;
  const kv = await getKv();
  const stored = await kv.get<EventCourseCollection>(courseMapsKey(event.id), "json");
  return {
    eventId: event.id,
    maps: ordered(stored?.maps ?? []),
    updatedAt: stored?.updatedAt ?? null,
  };
}

export async function saveEventCourseMaps(eventIdOrSlug: string, maps: EventCourseMap[]): Promise<EventCourseCollection> {
  const event = await getEventBySlug(eventIdOrSlug, { includeUnpublished: true });
  if (!event) throw new Error("Event not found.");
  const kv = await getKv();
  const updatedAt = new Date().toISOString();
  const normalized: EventCourseMap[] = ordered(maps).map((storedMap, index) => {
    const { gpxData, ...map } = storedMap;
    void gpxData;
    return {
      ...map,
      eventId: event.id,
      ticketId: map.ticketId?.trim() || undefined,
      providerContestUuid: map.providerContestUuid?.trim() || undefined,
      category: map.category.trim(),
      mapName: map.mapName.trim(),
      customType: map.customType?.trim() || undefined,
      gpxUrl: map.gpxUrl?.trim() || undefined,
      description: map.description?.trim() || undefined,
      distanceKm: map.distanceKm ?? null,
      cutoffSeconds: map.cutoffSeconds ?? null,
      displayOrder: index,
      updatedAt,
    };
  });
  const collection: EventCourseCollection = { eventId: event.id, maps: normalized, updatedAt };
  await kv.put(courseMapsKey(event.id), JSON.stringify(collection));
  return collection;
}

export async function getPublicEventCourseMaps(
  eventIdOrSlug: string,
  options: {
    surface: "web" | "mobile";
    category?: string | null;
    ticketId?: string | null;
    contestId?: string | null;
    includeGeometry?: boolean;
  } = { surface: "web" },
): Promise<EventCourseView | null> {
  const collection = await getAdminEventCourseMaps(eventIdOrSlug);
  if (!collection) return null;
  const normalize = (value: string | null | undefined) => (value ?? "").trim().normalize("NFKC").toLowerCase().replace(/[\s_-]+/g, "");
  const requestedIds = [options.ticketId, options.contestId].map(normalize).filter(Boolean);
  const requestedCategory = normalize(options.category);
  const hasExactIdMatch = requestedIds.length > 0 && collection.maps.some((map) =>
    [map.ticketId, map.providerContestUuid].map(normalize).some((alias) => requestedIds.includes(alias)),
  );
  const onlyOneCategory = new Set(collection.maps.map((map) => normalize(map.category)).filter(Boolean)).size === 1;
  const visible = collection.maps.filter((map) => {
    if (!map.visibility.public || (options.surface === "web" ? !map.visibility.web : !map.visibility.mobile)) return false;
    if (hasExactIdMatch) return [map.ticketId, map.providerContestUuid].map(normalize).some((alias) => requestedIds.includes(alias));
    if (requestedCategory) return normalize(map.category) === requestedCategory;
    if (requestedIds.length) return onlyOneCategory;
    return true;
  }).map((storedMap) => {
    const { gpxData, ...map } = storedMap;
    void gpxData;
    return options.includeGeometry === false ? { ...map, points: [] } : map;
  });
  const categories = [...new Set(visible.map((map) => map.category))];
  return {
    eventId: collection.eventId,
    maps: visible,
    updatedAt: collection.updatedAt,
    category: options.category ?? null,
    categories,
    combined: categories.map((category) => ({
      category,
      segments: visible.filter((map) => map.category === category),
    })),
  };
}
