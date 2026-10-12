import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { KVNamespace } from "@cloudflare/workers-types";
import type { LiveSplit, PublicEvent, RaceStatus } from "@/packages/contracts/src";
import { normalizeRaceStatus } from "@/packages/timing-core/src";
import type { FirebaseAthleteIdentity } from "./firebase-auth-server";
import { getPlatformEvents } from "./platform-repository";

const PREFIX = "raceupshot";
type JsonRecord = Record<string, unknown>;

export interface AthleteDashboardRace {
  event: PublicEvent;
  participantUid: string;
  bib: string;
  contestName: string;
  raceStatus: RaceStatus;
  elapsedTime?: string;
  latestTimingPoint?: string;
  overallRank?: number;
  genderRank?: number;
  ageGroupRank?: number;
  splits: LiveSplit[];
  hasPublishedResult: boolean;
}

export interface AthleteDashboardData {
  upcoming: AthleteDashboardRace[];
  past: AthleteDashboardRace[];
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function normalizedKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function text(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function field(record: JsonRecord, ...aliases: string[]): string {
  const wanted = new Set(aliases.map(normalizedKey));
  for (const [key, value] of Object.entries(record)) {
    if (wanted.has(normalizedKey(key)) && text(value)) return text(value);
  }
  return "";
}

function finiteNumber(record: JsonRecord, ...aliases: string[]): number | undefined {
  const parsed = Number(field(record, ...aliases).replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function nestedIdentityValues(value: unknown, keyNames: Set<string>, depth = 0): string[] {
  if (depth > 4 || value == null) return [];
  if (Array.isArray(value)) return value.flatMap((item) => nestedIdentityValues(item, keyNames, depth + 1));
  const record = asRecord(value);
  if (!record) return [];
  return Object.entries(record).flatMap(([key, item]) => {
    const own = keyNames.has(normalizedKey(key)) && text(item) ? [text(item)] : [];
    return [...own, ...nestedIdentityValues(item, keyNames, depth + 1)];
  });
}

function belongsToAthlete(record: JsonRecord, athlete: FirebaseAthleteIdentity): boolean {
  // Email ownership is only authoritative after Firebase (or the OTP flow)
  // has verified it. A newly-created, unverified account must never be able to
  // claim somebody else's registration by typing their address.
  const email = athlete.emailVerified ? athlete.email?.trim().toLowerCase() ?? "" : "";
  const emails = nestedIdentityValues(record, new Set([
    "email",
    "emailaddress",
    "emailid",
    "mail",
    "athleteemail",
    "participantemail",
    "registrationemail",
    "useremail",
  ])).map((value) => value.toLowerCase());
  if (email && emails.includes(email)) return true;

  const accountUids = nestedIdentityValues(record, new Set([
    "athleteuid",
    "accountuid",
    "firebaseuid",
    "firebaseuseruid",
    "useruid",
    "userid",
  ]));
  return accountUids.includes(athlete.uid);
}

export const athleteDashboardInternals = {
  belongsToAthlete,
  dashboardRace,
};

function unpackRows(payload: unknown): JsonRecord[] {
  if (Array.isArray(payload)) return payload.map(asRecord).filter((row): row is JsonRecord => Boolean(row));
  const record = asRecord(payload);
  if (!record) return [];
  for (const key of ["participants", "athletes", "results", "rows", "data"]) {
    if (Array.isArray(record[key])) {
      return (record[key] as unknown[]).map(asRecord).filter((row): row is JsonRecord => Boolean(row));
    }
  }
  return [];
}

function formatDuration(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  if (raw.includes(":")) return raw;
  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || numeric < 0) return raw;
  const totalSeconds = numeric > 0 && numeric < 2 ? Math.round(numeric * 86400) : Math.round(numeric);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function resultSplits(record: JsonRecord): LiveSplit[] {
  const supplied = record.splits;
  if (Array.isArray(supplied)) {
    return supplied.flatMap((value, index) => {
      const split = asRecord(value);
      if (!split) return [];
      const name = field(split, "name", "label", "timing point", "checkpoint") || `Split ${index + 1}`;
      const splitTime = field(split, "split time", "time", "cumulative time");
      return splitTime ? [{
        splitId: field(split, "id", "split id") || `split-${index + 1}`,
        name,
        splitTime,
        cumulativeTime: field(split, "cumulative time") || undefined,
      }] : [];
    });
  }

  return Object.entries(record).flatMap(([key, value], index) => {
    const normalized = normalizedKey(key);
    if (
      !/(split|checkpoint|timingpoint)/.test(normalized)
      || /(rank|pace|status|distance)/.test(normalized)
      || !text(value)
    ) return [];
    return [{
      splitId: `split-${index + 1}`,
      name: key,
      splitTime: text(value),
    }];
  });
}

function dashboardRace(event: PublicEvent, registration: JsonRecord, result?: JsonRecord): AthleteDashboardRace {
  const source = result ?? registration;
  const participantUid = field(source, "participant uid", "participant uuid", "uuid", "result id", "id")
    || field(registration, "participant uid", "participant uuid", "uuid", "athlete id", "id")
    || field(source, "bib", "bib number");
  const elapsedTime = formatDuration(
    field(source, "elapsed time", "finish time", "chip time", "net time", "overall time", "time"),
  );
  const splits = resultSplits(source);
  return {
    event,
    participantUid,
    bib: field(source, "bib", "bib number", "bib no", "race number")
      || field(registration, "bib", "bib number", "bib no", "race number"),
    contestName: field(source, "contest name", "category", "race cat", "ticket category")
      || field(registration, "contest name", "category", "race cat", "ticket category"),
    raceStatus: normalizeRaceStatus(field(source, "race status", "result status", "status")),
    elapsedTime,
    latestTimingPoint: field(source, "latest timing point", "last split", "checkpoint")
      || splits.at(-1)?.name,
    overallRank: finiteNumber(source, "overall rank", "o rank", "rank", "position"),
    genderRank: finiteNumber(source, "gender rank", "g rank"),
    ageGroupRank: finiteNumber(source, "age group rank", "category rank", "c rank", "age rank"),
    splits,
    hasPublishedResult: Boolean(result),
  };
}

async function listResultKeys(kv: KVNamespace, eventId: string): Promise<string[]> {
  const prefix = `${PREFIX}:event:${eventId}:result:`;
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix, cursor, limit: 1000 });
    keys.push(...page.keys.map((item) => item.name));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return keys;
}

export async function getAthleteDashboard(athlete: FirebaseAthleteIdentity): Promise<AthleteDashboardData> {
  if (!athlete.email && !athlete.uid) return { upcoming: [], past: [] };
  const { env } = await getCloudflareContext({ async: true });
  if (!env.RACEUPSHOT) throw new Error("RACEUPSHOT KV binding is unavailable.");
  const kv = env.RACEUPSHOT;
  const events = await getPlatformEvents({ mobileOnly: true });

  const races = await Promise.all(events.map(async (event): Promise<AthleteDashboardRace | null> => {
    const [participantPayload, resultKeys] = await Promise.all([
      kv.get<unknown>(`${PREFIX}:live:event:${event.eventId}:participants`, "json"),
      listResultKeys(kv, event.eventId),
    ]);
    const participant = unpackRows(participantPayload).find((row) => belongsToAthlete(row, athlete));
    const resultRows = (await Promise.all(resultKeys.map((key) => kv.get<JsonRecord>(key, "json"))))
      .filter((row): row is JsonRecord => Boolean(row));
    const result = resultRows.find((row) => belongsToAthlete(row, athlete));
    if (!participant && !result) return null;
    return dashboardRace(event, participant ?? result!, result);
  }));

  const owned = races.filter((race): race is AthleteDashboardRace => Boolean(race));
  return {
    upcoming: owned.filter((race) => race.event.section !== "PAST"),
    past: owned.filter((race) => race.event.section === "PAST"),
  };
}
