import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { KVNamespace } from "@cloudflare/workers-types";
import { validateBikeRackRanges, type BikeRackRange } from "./bike-rack-ranges";

export interface BikeRackConfiguration { eventId: string; ranges: BikeRackRange[]; updatedAt: string; updatedBy: string }

const key = (eventId: string) => `raceupshot:live:event:${eventId}:bike-rack-ranges`;

async function store(): Promise<KVNamespace> {
  const { env } = await getCloudflareContext({ async: true });
  if (!env.RACEUPSHOT) throw new Error("RACEUPSHOT KV binding is unavailable.");
  return env.RACEUPSHOT;
}

export async function getBikeRackConfiguration(eventId: string): Promise<BikeRackConfiguration> {
  const saved = await (await store()).get<BikeRackConfiguration>(key(eventId), "json");
  return saved?.eventId === eventId && Array.isArray(saved.ranges)
    ? saved : { eventId, ranges: [], updatedAt: "", updatedBy: "" };
}

export async function saveBikeRackConfiguration(eventId: string, ranges: BikeRackRange[], updatedBy: string): Promise<BikeRackConfiguration> {
  const configuration: BikeRackConfiguration = { eventId, ranges: validateBikeRackRanges(ranges), updatedAt: new Date().toISOString(), updatedBy };
  await (await store()).put(key(eventId), JSON.stringify(configuration));
  return configuration;
}
