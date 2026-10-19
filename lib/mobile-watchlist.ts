import { getCloudflareContext } from "@opennextjs/cloudflare";

import { requireAthleteRequest } from "./athlete-request-auth";

const PREFIX = "raceupshot:mobile-watchlist:v1";
const PUSH_PREFIX = "raceupshot:mobile-push:v1";

export type MobileWatchlistRecord = {
  id: string;
  type: "live-athlete";
  eventId: string;
  athleteId: string;
  label: string;
  deviceId: string;
  athlete: Record<string, unknown>;
  updatedAt: string;
};

function text(value: unknown, max = 500): string {
  return String(value ?? "").trim().slice(0, max);
}

function validDeviceId(value: unknown): string {
  const deviceId = text(value, 200);
  if (!/^[A-Za-z0-9._:-]{8,200}$/.test(deviceId)) throw new Error("A valid device ID is required.");
  return deviceId;
}

async function storage() {
  const { env } = await getCloudflareContext({ async: true });
  if (!env.RACEUPSHOT) throw new Error("Mobile watchlist storage is unavailable.");
  return env.RACEUPSHOT;
}

async function ownerFor(request: Request) {
  const athlete = await requireAthleteRequest(request);
  return `account:${athlete.uid}`;
}

function itemKey(owner: string, itemId: string) {
  return `${PREFIX}:${encodeURIComponent(owner)}:${encodeURIComponent(itemId)}`;
}

export async function listMobileWatchlist(request: Request) {
  const kv = await storage();
  const owner = await ownerFor(request);
  const prefix = `${PREFIX}:${encodeURIComponent(owner)}:`;
  const keys = await kv.list({ prefix, limit: 1000 });
  const rows = await Promise.all(
    keys.keys.map((key: { name: string }) =>
      kv.get<MobileWatchlistRecord>(key.name, "json"),
    ),
  );
  return rows.filter(
    (row: MobileWatchlistRecord | null): row is MobileWatchlistRecord =>
      Boolean(row),
  );
}

export async function saveMobileWatchlistItem(request: Request, input: Record<string, unknown>) {
  const eventId = text(input.eventId, 160);
  const athleteId = text(input.athleteId, 240);
  const deviceId = validDeviceId(input.deviceId);
  if (!eventId || !athleteId) throw new Error("Event and athlete IDs are required.");
  const id = text(input.id, 500) || `${eventId}:${athleteId}`;
  const athlete = input.athlete && typeof input.athlete === "object" && !Array.isArray(input.athlete)
    ? input.athlete as Record<string, unknown>
    : {};
  if (JSON.stringify(athlete).length > 30_000) throw new Error("The athlete watchlist record is too large.");
  const owner = await ownerFor(request);
  const record: MobileWatchlistRecord = {
    id,
    type: "live-athlete",
    eventId,
    athleteId,
    label: text(input.label, 300) || athleteId,
    deviceId,
    athlete: { ...athlete, eventId, athleteId, id: athleteId },
    updatedAt: new Date().toISOString(),
  };
  await (await storage()).put(itemKey(owner, id), JSON.stringify(record));
  return record;
}

export async function deleteMobileWatchlistItem(request: Request, itemIdValue: string) {
  const itemId = text(itemIdValue, 500);
  if (!itemId) throw new Error("A watchlist item ID is required.");
  const owner = await ownerFor(request);
  await (await storage()).delete(itemKey(owner, itemId));
}

export async function registerMobilePushDevice(request: Request, input: Record<string, unknown>) {
  const deviceId = validDeviceId(input.deviceId);
  const expoPushToken = text(input.expoPushToken, 500);
  if (!/^ExponentPushToken\[[^\]]+\]$|^ExpoPushToken\[[^\]]+\]$/.test(expoPushToken)) {
    throw new Error("A valid Expo push token is required.");
  }
  const owner = await ownerFor(request);
  const record = {
    schemaVersion: 1,
    owner,
    deviceId,
    expoPushToken,
    platform: text(input.platform, 30),
    appVersion: text(input.appVersion, 50),
    app: text(input.app, 30) || "race",
    updatedAt: new Date().toISOString(),
  };
  await (await storage()).put(`${PUSH_PREFIX}:${encodeURIComponent(owner)}:${encodeURIComponent(deviceId)}`, JSON.stringify(record));
  return { registered: true, deviceId, updatedAt: record.updatedAt };
}
