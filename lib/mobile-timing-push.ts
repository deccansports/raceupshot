import type { KVNamespace } from "@cloudflare/workers-types";
import type {
  AthleteTimingAudit,
  OfficialTimingPointResult,
} from "@/packages/timing-core/src";

import type { MobileWatchlistRecord } from "./mobile-watchlist";

const WATCHLIST_PREFIX = "raceupshot:mobile-watchlist:v1";
const PUSH_PREFIX = "raceupshot:mobile-push:v1";
const DELIVERY_PREFIX = "raceupshot:mobile-timing-push:v1";
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

type PushDeviceRecord = {
  owner: string;
  deviceId: string;
  expoPushToken: string;
};

function normalized(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function watchlistMatchesTimingAudit(
  record: MobileWatchlistRecord,
  eventId: string,
  audit: AthleteTimingAudit,
): boolean {
  if (normalized(record.eventId) !== normalized(eventId)) return false;
  const athlete = record.athlete ?? {};
  const identities = [
    record.athleteId,
    athlete.athleteId,
    athlete.id,
    athlete.participantUuid,
    athlete.providerUuid,
    athlete.providerAthleteUuid,
    athlete.providerTimingUuid,
    athlete.providerRecordId,
    athlete.bib,
  ].map(normalized).filter(Boolean);
  return [audit.participantUuid, audit.bib, `bib:${audit.bib}`]
    .map(normalized)
    .filter(Boolean)
    .some((identity) => identities.includes(identity));
}

async function listJson<T>(
  kv: KVNamespace,
  prefix: string,
): Promise<Array<{ key: string; value: T }>> {
  const values: Array<{ key: string; value: T }> = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix, cursor, limit: 1_000 });
    const rows = await Promise.all(
      page.keys.map(async ({ name }) => ({
        key: name,
        value: await kv.get<T>(name, "json"),
      })),
    );
    for (const row of rows) {
      if (row.value) values.push(row as { key: string; value: T });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return values;
}

function resultSignature(result: OfficialTimingPointResult): string {
  // Feibot can correct the official/section time while retaining the same
  // timing point and reader timestamp. Include the accepted timing values so
  // that a real canonical correction emits one new notification instead of
  // being mistaken for a duplicate delivery.
  return [
    result.timingPointKey,
    result.readerTimestamp,
    result.officialTimeMs,
    result.sectionTimeMs,
    result.status,
  ].join(":");
}

function elapsedLabel(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  return [hours, minutes, remainder]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

export async function dispatchMobileTimingNotifications(input: {
  kv: KVNamespace;
  eventId: string;
  previousAudit?: AthleteTimingAudit | null;
  audit: AthleteTimingAudit;
}): Promise<{ attempted: number; delivered: number }> {
  const previousResults = new Set(
    (input.previousAudit?.officialResults ?? []).map(resultSignature),
  );
  const latestNewResult = input.audit.officialResults
    .filter((result) => !previousResults.has(resultSignature(result)))
    .at(-1);
  const terminalChanged =
    input.previousAudit?.state !== input.audit.state &&
    ["DNF", "DNS", "DSQ", "OTL"].includes(input.audit.state);
  if (!latestNewResult && !terminalChanged) {
    return { attempted: 0, delivered: 0 };
  }

  const watchlists = await listJson<MobileWatchlistRecord>(
    input.kv,
    `${WATCHLIST_PREFIX}:`,
  );
  const owners = new Set(
    watchlists
      .filter(({ value }) =>
        watchlistMatchesTimingAudit(value, input.eventId, input.audit),
      )
      .map(({ key }) => decodeURIComponent(key.split(":").at(-2) ?? ""))
      .filter(Boolean),
  );
  if (!owners.size) return { attempted: 0, delivered: 0 };

  const devices = (
    await listJson<PushDeviceRecord>(input.kv, `${PUSH_PREFIX}:`)
  )
    .map(({ value }) => value)
    .filter(
      (device) =>
        owners.has(device.owner) &&
        /^Expo(?:nent)?PushToken\[[^\]]+\]$/.test(device.expoPushToken),
    );
  const checkpoint =
    latestNewResult?.timingPointName ??
    input.audit.failedCheckpoint ??
    "Race status";
  const signature = latestNewResult
    ? resultSignature(latestNewResult)
    : `${input.audit.state}:${input.audit.statusResolvedAt ?? input.audit.cutoffDeadline ?? "terminal"}`;
  const pending: Array<{ device: PushDeviceRecord; key: string }> = [];
  for (const device of devices) {
    const key = `${DELIVERY_PREFIX}:${encodeURIComponent(device.owner)}:${encodeURIComponent(device.deviceId)}:${encodeURIComponent(input.eventId)}:${encodeURIComponent(input.audit.participantUuid)}:${encodeURIComponent(signature)}`;
    if (!(await input.kv.get(key))) pending.push({ device, key });
  }
  if (!pending.length) return { attempted: 0, delivered: 0 };

  const title = terminalChanged
    ? `${input.audit.bib} · No finish time`
    : `${input.audit.bib} crossed ${checkpoint}`;
  const body = terminalChanged
    ? `${input.audit.state}: the configured cutoff expired before the required mat was crossed.`
    : `${checkpoint} · ${elapsedLabel(latestNewResult!.officialTimeMs)}`;
  const messages = pending.map(({ device }) => ({
    to: device.expoPushToken,
    sound: "default",
    channelId: "live-timing",
    title,
    body,
    data: {
      type: terminalChanged ? "race_status" : "split_crossed",
      eventId: input.eventId,
      athleteId: input.audit.participantUuid,
      participantUuid: input.audit.participantUuid,
      bib: input.audit.bib,
      checkpoint,
    },
  }));
  const response = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(messages),
  });
  if (!response.ok) {
    throw new Error(`Expo push returned HTTP ${response.status}.`);
  }
  const payload = (await response.json()) as {
    data?: Array<{ status?: string }>;
  };
  const tickets = Array.isArray(payload.data) ? payload.data : [];
  let delivered = 0;
  await Promise.all(
    pending.map(async ({ key }, index) => {
      if (tickets[index]?.status !== "ok") return;
      delivered += 1;
      await input.kv.put(key, new Date().toISOString(), {
        expirationTtl: 60 * 60 * 24 * 14,
      });
    }),
  );
  return { attempted: pending.length, delivered };
}
