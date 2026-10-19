import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { KVNamespace } from "@cloudflare/workers-types";
import type { LiveParticipant } from "@/packages/contracts/src";
import { getEventBySlug, getEventPartners } from "./raceupshot-repository";
import { finishLineClockWindow, maximumFinishCutoffSeconds } from "./finish-line-clock";
import { resolveConfiguredFinishers } from "./live-leaderboard";
import { getPublicLiveParticipants } from "./platform-repository";
import { normalizeLedFields, type LedField } from "./finish-line-led-fields";
import { resolveLedLogos } from "./finish-line-led-logos";

type JsonRecord = Record<string, unknown>;

export interface FinishLineLedFinisher {
  id: string;
  bib: string;
  name: string;
  finishTime: string;
  category: string;
  country: string;
  gender: string;
  ageGroup: string;
  status: "FINISHED";
  rank?: number;
  finishedAt: string | null;
  visibility: "PUBLIC" | "ANONYMOUS";
}

export interface FinishLineLedLogo {
  id: string;
  name: string;
  logoUrl: string;
  kind: "EVENT" | "SPONSOR";
}

export interface FinishLineLedConfig {
  syncEventLogos?: boolean;
  visibleFields?: LedField[];
  logos: FinishLineLedLogo[];
  idleRotationSeconds: number;
  finisherRotationSeconds: number;
}

export interface FinishLineLedFeed {
  event: {
    id: string;
    slug: string;
    name: string;
    location: string;
    logoUrl?: string;
    bannerUrl?: string;
    startsAt?: string;
    endsAt?: string;
    clockStopsAt?: string;
    status: string;
  };
  display: FinishLineLedConfig;
  finishers: FinishLineLedFinisher[];
  updatedAt: string | null;
  source: "live:event:results";
}

const DEFAULT_CONFIG = {
  idleRotationSeconds: 6,
  finisherRotationSeconds: 8,
} as const;

function normalizeLogo(value: unknown): FinishLineLedLogo | null {
  const row = record(value);
  if (!row) return null;
  const id = text(row, "id");
  const name = text(row, "name");
  const logoUrl = text(row, "logoUrl");
  if (!id || !name || !/^https?:\/\//i.test(logoUrl) && !logoUrl.startsWith("/")) return null;
  return { id, name, logoUrl, kind: text(row, "kind").toUpperCase() === "EVENT" ? "EVENT" : "SPONSOR" };
}

function rotationSeconds(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(3, Math.min(30, Math.round(parsed))) : fallback;
}

async function resolvedDisplayConfig(binding: KVNamespace, event: Awaited<ReturnType<typeof getEventBySlug>>): Promise<FinishLineLedConfig> {
  if (!event) return { logos: [], ...DEFAULT_CONFIG };
  const [stored, partners] = await Promise.all([
    binding.get<unknown>(`raceupshot:event:${event.id}:finish-line-led`, "json"),
    getEventPartners(event.id),
  ]);
  const raw = record(stored);
  const configured = Array.isArray(raw?.logos) ? raw.logos.map(normalizeLogo).filter((logo): logo is FinishLineLedLogo => Boolean(logo)) : [];
  const defaults: FinishLineLedLogo[] = [
    ...(event.logoUrl ? [{ id: `event:${event.id}`, name: event.name, logoUrl: event.logoUrl, kind: "EVENT" as const }] : []),
    ...(partners ?? []).map((partner) => ({ id: `partner:${partner.id}`, name: partner.name, logoUrl: partner.logoUrl, kind: "SPONSOR" as const })),
  ];
  return {
    visibleFields: normalizeLedFields(raw?.visibleFields),
    syncEventLogos: raw?.syncEventLogos !== false,
    logos: resolveLedLogos(defaults, configured, raw?.syncEventLogos !== false),
    idleRotationSeconds: rotationSeconds(raw?.idleRotationSeconds, DEFAULT_CONFIG.idleRotationSeconds),
    finisherRotationSeconds: rotationSeconds(raw?.finisherRotationSeconds, DEFAULT_CONFIG.finisherRotationSeconds),
  };
}

export async function getFinishLineLedConfig(eventIdOrSlug: string): Promise<{ eventId: string; availableLogos: FinishLineLedLogo[]; config: FinishLineLedConfig } | null> {
  const event = await getEventBySlug(eventIdOrSlug, { includeUnpublished: true });
  if (!event) return null;
  const binding = await kv();
  const partners = await getEventPartners(event.id);
  const availableLogos: FinishLineLedLogo[] = [
    ...(event.logoUrl ? [{ id: `event:${event.id}`, name: event.name, logoUrl: event.logoUrl, kind: "EVENT" as const }] : []),
    ...(partners ?? []).map((partner) => ({ id: `partner:${partner.id}`, name: partner.name, logoUrl: partner.logoUrl, kind: "SPONSOR" as const })),
  ];
  return { eventId: event.id, availableLogos, config: await resolvedDisplayConfig(binding, event) };
}

export async function saveFinishLineLedConfig(eventIdOrSlug: string, input: FinishLineLedConfig): Promise<FinishLineLedConfig | null> {
  const event = await getEventBySlug(eventIdOrSlug, { includeUnpublished: true });
  if (!event) return null;
  const binding = await kv();
  const config: FinishLineLedConfig = {
    syncEventLogos: input.syncEventLogos !== false,
    visibleFields: normalizeLedFields(input.visibleFields),
    logos: input.logos.map(normalizeLogo).filter((logo): logo is FinishLineLedLogo => Boolean(logo)).slice(0, 140),
    idleRotationSeconds: rotationSeconds(input.idleRotationSeconds, DEFAULT_CONFIG.idleRotationSeconds),
    finisherRotationSeconds: rotationSeconds(input.finisherRotationSeconds, DEFAULT_CONFIG.finisherRotationSeconds),
  };
  await binding.put(`raceupshot:event:${event.id}:finish-line-led`, JSON.stringify(config));
  return config;
}

async function kv(): Promise<KVNamespace> {
  const { env } = await getCloudflareContext({ async: true });
  if (!env.RACEUPSHOT) throw new Error("RACEUPSHOT KV binding is unavailable.");
  return env.RACEUPSHOT;
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function text(row: JsonRecord, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function rowsFromPayload(payload: unknown): JsonRecord[] {
  if (Array.isArray(payload)) return payload.map(record).filter((row): row is JsonRecord => Boolean(row));
  const root = record(payload);
  if (!root) return [];
  const queue: unknown[] = [root];
  const visited = new Set<unknown>();
  const candidates: JsonRecord[][] = [];
  while (queue.length) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    if (Array.isArray(current)) {
      const parsed = current.map(record).filter((row): row is JsonRecord => Boolean(row));
      if (parsed.length) candidates.push(parsed);
      continue;
    }
    const currentRecord = record(current);
    if (!currentRecord) continue;
    for (const value of Object.values(currentRecord)) {
      if (value && typeof value === "object") queue.push(value);
    }
  }
  const score = (rows: JsonRecord[]) => rows.reduce((total, row) => total
    + (terminal(row) ? 5 : 0)
    + (text(row, "bib", "bibNumber", "participantUid") ? 2 : 0)
    + (text(row, "name", "fullName", "athleteName") ? 1 : 0), 0);
  return candidates.sort((a, b) => score(b) - score(a) || b.length - a.length)[0] ?? [];
}

function terminal(row: JsonRecord): boolean {
  const status = text(row, "raceStatus", "resultStatus", "status", "state").toUpperCase().replaceAll(" ", "_");
  if (["FINISHED", "FINISH", "COMPLETED", "OFFICIAL"].includes(status)) return true;
  return row.finished === true || row.isFinished === true || Boolean(text(row, "finishTime", "chipTime", "overallTime", "gunTime"));
}

function duration(value: unknown): string {
  if (typeof value === "string" && value.trim() && !/^\d+(?:\.\d+)?$/.test(value.trim())) return value.trim();
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = Math.floor(seconds % 60);
  return [hours, minutes, remainder].map((part) => String(part).padStart(2, "0")).join(":");
}

function timestamp(row: JsonRecord): string | null {
  const raw = text(row, "finishedAt", "finishTimestamp", "finish_at", "updatedAt", "lastUpdatedAt", "sourceUpdatedAt");
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function participantFinishTimestamp(participant: LiveParticipant): string | null {
  const terminal = participant.splits.at(-1);
  const raw = terminal?.readerTimestamp
    || terminal?.timestamp
    || participant.estimatedFinishAt
    || participant.lastUpdatedAt;
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function canonicalFinisher(participant: LiveParticipant): FinishLineLedFinisher | null {
  if (participant.visibility === "PRIVATE" || participant.raceStatus !== "FINISHED") return null;
  const anonymous = participant.visibility === "ANONYMOUS";
  const finishSplit = participant.splits.at(-1);
  return {
    id: participant.participantUid,
    bib: anonymous ? "" : participant.bib,
    name: anonymous ? "Anonymous Athlete" : participant.displayName || participant.fullName || `Athlete ${participant.bib}`,
    finishTime: duration(participant.elapsedTime || participant.cumulativeTime || finishSplit?.cumulativeTime || finishSplit?.officialTimeMs && finishSplit.officialTimeMs / 1_000),
    category: participant.contestName,
    country: participant.country || "IND",
    gender: participant.gender || "",
    ageGroup: participant.ageGroup || "",
    status: "FINISHED",
    rank: participant.overallRank,
    finishedAt: participantFinishTimestamp(participant),
    visibility: anonymous ? "ANONYMOUS" : "PUBLIC",
  };
}

async function accountVisibility(binding: KVNamespace, row: JsonRecord): Promise<"PUBLIC" | "ANONYMOUS" | "PRIVATE"> {
  let uid = text(row, "athleteUid", "athlete_uid", "userUid", "user_uid");
  const email = text(row, "email", "emailAddress", "email_address", "participantEmail").toLowerCase();
  if (!uid && email) uid = await binding.get(`raceupshot:athlete-profile-email:${email}`) || "";
  if (!uid) {
    const raw = text(row, "visibility", "privacyStatus").toUpperCase();
    return raw === "PRIVATE" || raw === "ANONYMOUS" ? raw : "PUBLIC";
  }
  const profile = await binding.get<{ trackingVisibility?: "PUBLIC" | "ANONYMOUS" | "PRIVATE" }>(`raceupshot:athlete-profile:${uid}`, "json");
  if (!profile?.trackingVisibility) return "PUBLIC";
  return profile.trackingVisibility === "PUBLIC" ? "PUBLIC" : "ANONYMOUS";
}

export async function getFinishLineLedFeed(eventIdOrSlug: string): Promise<FinishLineLedFeed | null> {
  const event = await getEventBySlug(eventIdOrSlug, { includeUnpublished: true });
  if (!event) return null;
  const binding = await kv();
  const [payload, updated, display, hubConfig, resultSummary, liveRead] = await Promise.all([
    binding.get<unknown>(`raceupshot:live:event:${event.id}:results`, "json"),
    binding.get(`raceupshot:live:event:${event.id}:updated`),
    resolvedDisplayConfig(binding, event),
    binding.get<{
      start?: { gunStartAt?: string | null; eventEndAt?: string | null; overallCutoffSeconds?: number | null; strictFinalCutoff?: boolean };
      splits?: Array<{ id: string; name: string; order: number }>;
    }>(`raceupshot:live:event:${event.id}:hub-config`, "json"),
    binding.get<{ maxFinishSeconds?: number }>(`raceupshot:event:${event.id}:results:summary`, "json"),
    getPublicLiveParticipants(event.id).catch(() => null),
  ]);
  const sourceRows = rowsFromPayload(payload).filter(terminal);
  const canonical = liveRead
    ? resolveConfiguredFinishers(liveRead.data, hubConfig?.splits ?? [], { preserveDnf: true })
        .map(canonicalFinisher)
        .filter((row): row is FinishLineLedFinisher => Boolean(row))
    : [];
  const legacyMapped = await Promise.all(sourceRows.map(async (row, index): Promise<FinishLineLedFinisher | null> => {
    const visibility = await accountVisibility(binding, row);
    if (visibility === "PRIVATE") return null;
    const bib = text(row, "bib", "bibNumber", "bib_number", "raceNumber");
    const id = text(row, "participantUid", "participantUuid", "participant_uuid", "providerAthleteId", "id") || bib || `finisher-${index}`;
    const fullName = text(row, "displayName", "fullName", "full_name", "name", "athleteName", "participantName");
    return {
      id,
      bib: visibility === "ANONYMOUS" ? "" : bib,
      name: visibility === "ANONYMOUS" ? "Anonymous Athlete" : fullName || (bib ? `Athlete ${bib}` : "Athlete"),
      finishTime: duration(text(row, "chipTime", "finishTime", "overallTime", "gunTime", "elapsedTime", "cumulativeTime") || row.elapsedSeconds),
      category: text(row, "contestName", "contest_name", "ticketName", "category", "raceCategory"),
      country: text(row, "country", "countryCode", "country_code", "nationality") || "IND",
      gender: text(row, "gender", "sex"),
      ageGroup: text(row, "ageGroup", "age_group", "ageCategory", "age_category"),
      status: "FINISHED",
      rank: Number(text(row, "overallRank", "rank", "position")) || undefined,
      finishedAt: timestamp(row),
      visibility,
    };
  }));
  const mapped = canonical.length > 0 ? canonical : legacyMapped;
  const deduped = new Map<string, FinishLineLedFinisher>();
  mapped.filter((row): row is FinishLineLedFinisher => Boolean(row)).forEach((row) => {
    const existing = deduped.get(row.id);
    if (!existing || Date.parse(row.finishedAt || "") >= Date.parse(existing.finishedAt || "")) deduped.set(row.id, row);
  });
  const finishers = [...deduped.values()]
    .sort((a, b) => {
      const timeDifference = Date.parse(b.finishedAt || "") - Date.parse(a.finishedAt || "");
      if (Number.isFinite(timeDifference) && timeDifference !== 0) return timeDifference;
      return (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER);
    })
    .slice(0, 100);
  const clockStartsAt = hubConfig?.start?.gunStartAt || event.dateIso;
  const maxCutoffSeconds = maximumFinishCutoffSeconds([
    ...(event.ticketDefinitions ?? []),
    { overallCutoffSeconds: hubConfig?.start?.overallCutoffSeconds },
  ]);
  const parsedClockStart = Date.parse(clockStartsAt || "");
  const defaultTwoHourEnd = Number.isFinite(parsedClockStart)
    ? new Date(parsedClockStart + 2 * 60 * 60 * 1_000).toISOString()
    : null;
  const clock = finishLineClockWindow({
    startsAt: clockStartsAt,
    eventEndAt: hubConfig?.start?.eventEndAt || (maxCutoffSeconds ? null : defaultTwoHourEnd),
    maxCutoffSeconds,
    maxFinishSeconds: resultSummary?.maxFinishSeconds,
    eventStatus: event.status,
    stopDelaySeconds: 0,
  });
  return {
    event: {
      id: event.id,
      slug: event.slug,
      name: event.name,
      location: event.location,
      logoUrl: event.logoUrl,
      bannerUrl: event.bannerUrl,
      startsAt: clockStartsAt,
      endsAt: clock.endsAt,
      clockStopsAt: clock.stopsAt,
      status: event.status,
    },
    display,
    finishers,
    updatedAt: updated || finishers[0]?.finishedAt || null,
    source: "live:event:results",
  };
}
