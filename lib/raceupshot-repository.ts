import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { KVNamespace } from "@cloudflare/workers-types";
import { isTransientKvError, withTransientKvRetry } from "./kv-retry";
import type { Athlete, AuditEntry, EventPartner, HomepageSlide, RaceEvent, RaceSplit } from "./types";
import type { StoredCertificateTemplate } from "./certificate-storage";
import { certificateTemplateId } from "./certificate-storage";
import {
  coreCmsPages,
  defaultCmsSiteSettings,
  sanitizeCmsBlocks,
  type CmsPageRecord,
  type CmsPublishedSnapshot,
  type CmsSiteSettings,
} from "./cms";
import { sanitizeEventDocumentHtml } from "./event-document";
import { waiverParameterSources, type WaiverParameterMapping, type WaiverParameterSource } from "./waiver-template";
import { normalizeRaceStatus } from "@/packages/timing-core/src";
import type { RaceStatus } from "@/packages/contracts/src";
import { eventTicketDefinitions } from './event-ticket-definition';
import { hasEventMovedToPast, hasEventStarted } from './event-lifecycle';
import { eventWaiverPolicy, type EventWaiverPolicy } from './event-waiver-policy';

const PREFIX = "raceupshot";
let lastGoodPublicEvents: RaceEvent[] | null = null;
let lastGoodPublicSlider: { enabled: boolean; slides: HomepageSlide[] } | null = null;
let lastGoodPublicSiteSettings: CmsSiteSettings | null = null;

type JsonRecord = Record<string, unknown>;

async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, mapper: (item: T, index: number) => Promise<R>): Promise<R[]> {
  if (!items.length) return [];
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, () => worker()));
  return results;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function number(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  return text(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function productionUrl(value: unknown): string | undefined {
  const url = text(value);
  if (!url || url === "#") return undefined;
  if (/picsum\.photos|example\.com/i.test(url)) return undefined;
  return url;
}

function cmsPublicUrl(value: unknown, fallback = "/"): string {
  const url = text(value);
  if (
    url.startsWith("/")
    || url.startsWith("#")
    || /^https?:\/\//i.test(url)
    || /^(mailto|tel):/i.test(url)
  ) return url;
  return fallback;
}

function cmsMediaUrl(value: unknown): string {
  const url = text(value);
  if (/^https?:\/\//i.test(url) || /^data:(?:image\/[a-z0-9.+-]+|video\/mp4);base64,/i.test(url)) return url;
  return "";
}

function formatDate(value: unknown): { label: string; iso: string } {
  const raw = text(value);
  const date = raw ? new Date(raw) : new Date(Number.NaN);
  if (Number.isNaN(date.getTime())) return { label: raw || "Date to be announced", iso: raw };
  return {
    label: new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(date),
    iso: date.toISOString(),
  };
}

function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function getCategoryNames(raw: JsonRecord): string[] {
  const tickets = Array.isArray(raw.ticketDefinitions) ? raw.ticketDefinitions : [];
  const names = tickets
    .map((item) => item && typeof item === "object" ? text((item as JsonRecord).name) || text((item as JsonRecord).ticketName) || text((item as JsonRecord).category) : "")
    .filter(Boolean);
  return names.length ? [...new Set(names)] : stringArray(raw.categories);
}

function getEventTickets(raw: JsonRecord): Array<{ id: string; name: string }> {
  const definitions = Array.isArray(raw.ticketDefinitions) ? raw.ticketDefinitions : [];
  const tickets = definitions.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const ticket = item as JsonRecord;
    const name = text(ticket.name) || text(ticket.ticketName) || text(ticket.category);
    return name ? [{ id: text(ticket.id) || text(ticket.ticketId) || name, name }] : [];
  });
  return tickets.length ? tickets : stringArray(raw.categories).map((name) => ({ id: name, name }));
}

export function deriveEventStatus(raw: JsonRecord, resultCount: number, dateIso: string, now = Date.now()): RaceEvent["status"] {
  const stored = text(raw.status).toLowerCase();
  if (stored === "draft" || stored === "archived") return stored;
  const endsAt = text(raw.endDateTime ?? raw.endsAt ?? raw.endDate ?? raw.dateEnd);
  if (hasEventMovedToPast(dateIso, endsAt, now)) {
    if (stored === "official" || resultCount > 0 || Boolean(raw.hasResults)) return "official";
    if (stored === "provisional") return "provisional";
    return "completed";
  }
  if (stored === "live" || stored === "completed" || stored === "official" || stored === "provisional" || hasEventStarted(dateIso, now)) return "live";
  if (Boolean(raw.isUpcoming)) return "upcoming";
  return "upcoming";
}

function eventAccent(sport: string): string {
  if (sport.toLowerCase().includes("tri")) return "#14d9e5";
  if (sport.toLowerCase().includes("cycl")) return "#b9f743";
  if (sport.toLowerCase().includes("swim")) return "#6ea8ff";
  return "#ff8a3d";
}

function mapEvent(raw: JsonRecord, participantCount: number): RaceEvent {
  const name = text(raw.name) || text(raw.shortName) || "Untitled event";
  const sport = text(raw.sport) || text(raw.eventType) || "Running";
  const date = formatDate(raw.startDateTime || raw.date);
  const end = formatDate(raw.endDateTime || raw.endsAt || raw.endDate || raw.dateEnd);
  const slug = text(raw.slug) || text(raw.eventCode) || text(raw.id);
  const city = text(raw.city);
  const venue = text(raw.venueName) || text(raw.location) || text(raw.detailedAddress);
  const location = [venue, city].filter((item, index, all) => item && all.indexOf(item) === index).join(", ");
  const status = deriveEventStatus(raw, participantCount, date.iso);
  const registerUrl = productionUrl(raw.registrationUrl) || (raw.showRegisterButton ? productionUrl(raw.eventUrl) : undefined);
  const categories = getCategoryNames(raw);
  return {
    id: text(raw.id),
    slug,
    name,
    date: date.label,
    dateIso: date.iso,
    endsAt: end.iso || undefined,
    location: location || "Location to be announced",
    city,
    venue,
    venueAddress: text(raw.venueAddress) || undefined,
    organizerAddress: text(raw.organizerAddress) || undefined,
    jurisdiction: text(raw.jurisdiction) || undefined,
    sport,
    status,
    categories,
    tickets: getEventTickets(raw),
    ticketDefinitions: eventTicketDefinitions(raw.ticketDefinitions, categories),
    participants: participantCount,
    accent: eventAccent(sport),
    shortCode: text(raw.shortName) || name.split(/\s+/).map((word) => word[0]).join("").slice(0, 3).toUpperCase(),
    description: text(raw.summaryDescription) || text(raw.description) || text(raw.aboutEventContent),
    startTime: date.iso ? new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date(date.iso)) : "",
    organizer: text(raw.organizerName) || text(raw.officialEntityName),
    companyDescription: text(raw.companyDescription) || text(raw.organizerDescription),
    contactEmail: text(raw.organizerEmail),
    contactPhone: text(raw.contactPhone),
    websiteUrl: productionUrl(raw.eventWebsite) || productionUrl(raw.websiteUrl),
    registrationUrl: registerUrl,
    knowMoreUrl: productionUrl(raw.knowMoreUrl) || productionUrl(raw.eventWebsite),
    broadcastUrl: productionUrl(raw.broadcastUrl),
    rulesUrl: productionUrl(raw.rulesUrl),
    rulesHtml: text(raw.rulesHtml),
    waiverHtml: text(raw.waiverHtml) || text(raw.waiverTemplate),
    waiverVersion: text(raw.waiverVersion),
    waiverPolicy: eventWaiverPolicy(raw.waiverPolicy),
    waiverParameterMappings: Array.isArray(raw.waiverParameterMappings) ? raw.waiverParameterMappings.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const mapping = item as JsonRecord;
      const token = text(mapping.token);
      const source = text(mapping.source);
      return /^[a-zA-Z][a-zA-Z0-9_.-]{0,99}$/.test(token) && waiverParameterSources.some((option) => option.value === source)
        ? [{ token, source: source as WaiverParameterSource, ...(typeof mapping.customValue === "string" ? { customValue: mapping.customValue.slice(0, 2_000) } : {}) }]
        : [];
    }) : [],
    athleteGuidebookUrl: productionUrl(raw.athleteGuidebookUrl),
    logoUrl: productionUrl(raw.logoUrl),
    bannerUrl: productionUrl(raw.heroBannerUrl) || productionUrl(raw.bannerUrl),
    latitude: text(raw.latitude) || undefined,
    longitude: text(raw.longitude) || undefined,
    hasResults: Boolean(raw.hasResults) || participantCount > 0,
  };
}

function mapSplits(raw: JsonRecord): RaceSplit[] {
  if (!Array.isArray(raw.splits)) return [];
  let previous = 0;
  return raw.splits.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const split = item as JsonRecord;
    const cumulative = number(split.time);
    const segment = cumulative > previous ? cumulative - previous : cumulative;
    if (cumulative > previous) previous = cumulative;
    return [{ label: text(split.name) || "Split", time: formatDuration(segment) }];
  });
}

function mapAthlete(raw: JsonRecord, raceEvent: RaceEvent): Athlete {
  const genderRaw = resultCell(raw, "gender", "sex");
  const overallSeconds = durationSecondsFromCell(
    raw,
    "overall time",
    "chip time",
    "finish time",
    "net time",
    "gun time",
    "race time",
    "time",
  );
  const status = normalizeImportedResultStatus(
    resultCell(raw, "status", "result status", "race status"),
    overallSeconds,
  );
  const splitRows = mapSplits(raw);
  return {
    id: text(raw.id) || text(raw.bib) || text(raw["Bib Number"]),
    athleteUid: text(raw.athleteUid) || text(raw.athlete_uid) || text(raw.userUid) || text(raw.user_uid)
      || text(raw.firebaseUid) || undefined,
    email: resultCell(raw, "email", "e-mail", "email address", "athlete email", "participant email") || undefined,
    name: text(raw.name) || text(raw.Name) || "Unnamed athlete",
    bib: text(raw.bib) || text(raw["Bib Number"]),
    gender: genderRaw ? genderRaw.slice(0, 1).toUpperCase() : "",
    ageGroup: text(raw.ageGroup) || text(raw["Age Group"]) || text(raw.Category),
    club: text(raw.club) || text(raw.Club),
    city: text(raw.city) || text(raw.City),
    country: text(raw.country) || text(raw.Country) || "IND",
    category: text(raw.category) || text(raw["RACE CAT"]) || text(raw.Category),
    rank: number(raw.overallRank) || number(raw["O Rank"]),
    genderRank: number(raw.genderRank) || number(raw["G Rank"]),
    ageRank: number(raw.categoryRank) || number(raw["C Rank"]),
    finishTime: overallSeconds > 0 ? formatDuration(overallSeconds) : "—",
    pace: text(raw.pace),
    status,
    lastSplit: splitRows.at(-1)?.label ?? "",
    eventId: raceEvent.id,
    eventSlug: raceEvent.slug,
    eventName: raceEvent.name,
    splits: splitRows,
    verificationCode: text(raw.verificationCode) || undefined,
    certificateUrl: text(raw.certificateUrl) || undefined,
  };
}

async function getKv(attempts?: number): Promise<KVNamespace> {
  const { env } = await getCloudflareContext({ async: true });
  if (!env.RACEUPSHOT) throw new Error("RACEUPSHOT KV binding is unavailable.");
  return withTransientKvRetry(env.RACEUPSHOT, attempts);
}

async function getIndex(kv: KVNamespace, key: string): Promise<string[]> {
  return (await kv.get<string[]>(key, "json")) ?? [];
}

async function getRawEvent(kv: KVNamespace, id: string): Promise<JsonRecord | null> {
  return kv.get<JsonRecord>(`${PREFIX}:event:${id}`, "json");
}

function normalizePartners(value: unknown): EventPartner[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const raw = item as JsonRecord;
    const name = text(raw.name);
    const logoUrl = productionUrl(raw.logoUrl);
    if (!name || !logoUrl) return [];
    return [{
      id: text(raw.id) || crypto.randomUUID(),
      name,
      logoUrl,
      website: productionUrl(raw.website),
      type: text(raw.type) || undefined,
      order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : index,
    }];
  }).sort((a, b) => a.order - b.order).map((partner, order) => ({ ...partner, order }));
}

async function appendIndex(kv: KVNamespace, key: string, id: string) {
  const ids = await getIndex(kv, key);
  if (!ids.includes(id)) await kv.put(key, JSON.stringify([...ids, id]));
}

async function writeAudit(kv: KVNamespace, action: string, entity: string, details: JsonRecord = {}) {
  const id = crypto.randomUUID();
  const row = { id, action, entity, actor: "Race Upshot admin", createdAt: new Date().toISOString(), ...details };
  await Promise.all([
    kv.put(`${PREFIX}:timing:audit:${id}`, JSON.stringify(row)),
    appendIndex(kv, `${PREFIX}:timing:audit:index`, id),
  ]);
}

async function listKeys(kv: KVNamespace, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix, cursor, limit: 1000 });
    keys.push(...page.keys.map((key) => key.name));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return keys;
}

async function getResultIds(kv: KVNamespace, eventId: string): Promise<string[]> {
  const prefix = `${PREFIX}:event:${eventId}:result:`;
  return (await listKeys(kv, prefix))
    .map((key) => key.slice(prefix.length))
    .filter(Boolean);
}

export async function getEvents(options: { includeUnpublished?: boolean } = {}): Promise<RaceEvent[]> {
  try {
    const kv = await getKv(options.includeUnpublished ? undefined : 2);
    const ids = await getIndex(kv, `${PREFIX}:events:index`);
    const rows = await mapWithConcurrency(ids, 4, async (id) => {
      const [raw, resultIds] = await Promise.all([getRawEvent(kv, id), getResultIds(kv, id)]);
      return raw ? mapEvent(raw, resultIds.length) : null;
    });
    const allEvents = rows
      .filter((row): row is RaceEvent => Boolean(row))
      .sort((a, b) => Date.parse(b.dateIso || "0") - Date.parse(a.dateIso || "0"));
    lastGoodPublicEvents = allEvents.filter((row) => !["draft", "archived"].includes(row.status));
    return options.includeUnpublished ? allEvents : lastGoodPublicEvents;
  } catch (error) {
    // Public discovery should remain available during a bounded transient KV
    // outage. Admin reads must still fail loudly so operators see the issue.
    if (!options.includeUnpublished && isTransientKvError(error)) {
      console.error(JSON.stringify({
        type: "public_events_kv_unavailable",
        fallback: lastGoodPublicEvents ? "last_good" : "empty",
        error: error instanceof Error ? error.message : String(error),
      }));
      return lastGoodPublicEvents ?? [];
    }
    throw error;
  }
}

export async function getEventBySlug(slug: string, options: { includeUnpublished?: boolean } = {}): Promise<RaceEvent | null> {
  const kv = await getKv();
  const direct = await getRawEvent(kv, slug);
  if (direct) {
    const event = mapEvent(direct, (await getResultIds(kv, slug)).length);
    return options.includeUnpublished || !["draft", "archived"].includes(event.status) ? event : null;
  }
  const events = await getEvents(options);
  return events.find((event) => event.slug === slug || event.id === slug) ?? null;
}

export async function getResults(eventSlug: string): Promise<{ event: RaceEvent | null; athletes: Athlete[] }> {
  const kv = await getKv();
  const event = await getEventBySlug(eventSlug, { includeUnpublished: true });
  if (!event) return { event: null, athletes: [] };
  const ids = await getResultIds(kv, event.id);
  // Workers KV supports up to 100 keys in one binding bulk read. Batch the
  // result index so large published events do not issue one subrequest per
  // athlete or serialize hundreds of four-at-a-time reads.
  const resultKeys = ids.map((id) => `${PREFIX}:event:${event.id}:result:${id}`);
  const batches = Array.from(
    { length: Math.ceil(resultKeys.length / 100) },
    (_, index) => resultKeys.slice(index * 100, index * 100 + 100),
  );
  const resultMaps = await mapWithConcurrency(batches, 4, (keys) => kv.get<JsonRecord>(keys, "json"));
  const rows = resultMaps.flatMap((values, batchIndex) =>
    batches[batchIndex].map((key) => values.get(key) ?? null),
  );
  const athletes = rows
    .filter((row): row is JsonRecord => Boolean(row))
    .map((row) => mapAthlete(row, event))
    .sort((a, b) => (a.rank || Number.MAX_SAFE_INTEGER) - (b.rank || Number.MAX_SAFE_INTEGER));
  return { event, athletes };
}

export interface ResultImportInput {
  rows: JsonRecord[];
  categoryColumn: string;
  categoryMappings: Record<string, string>;
  columnMappings?: Record<string, string>;
  replaceExisting: boolean;
  fileName: string;
}

const importedResultFieldHeaders: Record<string, string> = {
  bib: "Bib Number", name: "Name", email: "Email", mobile: "Mobile", status: "Status",
  chipTime: "Chip Time", gunTime: "Gun Time", gender: "Gender", ageGroup: "Age Group",
  club: "Club", country: "Country", city: "City", overallRank: "Overall Rank",
  genderRank: "Gender Rank", categoryRank: "Category Rank",
  swim: "Swim", run1: "RUN 1", t1: "T1", bike: "Bike", t2: "T2", run: "Run", run2: "RUN 2",
  startSplit: "Start", swimFinishSplit: "Swim Finish", bikeStartSplit: "Bike Start",
  bikeFinishSplit: "Bike Finish", runStartSplit: "Run Start", finishSplit: "Race Finish",
  startTimeOfDay: "Start · Time of Day", finishTimeOfDay: "Finish · Time of Day",
};

export function applyImportedResultColumnMappings(row: JsonRecord, mappings: Record<string, string> = {}): JsonRecord {
  const mapped = { ...row };
  for (const [field, sourceColumn] of Object.entries(mappings)) {
    const targetHeader = importedResultFieldHeaders[field];
    if (!targetHeader || !sourceColumn || !(sourceColumn in row)) continue;
    mapped[targetHeader] = row[sourceColumn];
  }
  return mapped;
}

export interface ResultImportSummary {
  imported: number;
  skipped: number;
  replaced: number;
  categories: Array<{ source: string; target: string; count: number }>;
  fileName: string;
}

export interface ResultDeleteSummary {
  eventId: string;
  eventName: string;
  deletedResults: number;
  deletedNotifications: number;
}

function normalizedColumn(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function resultCell(row: JsonRecord, ...aliases: string[]): string {
  const byHeader = new Map(Object.entries(row).map(([key, cell]) => [normalizedColumn(key), text(cell)]));
  for (const alias of aliases) {
    const found = byHeader.get(normalizedColumn(alias));
    if (found) return found;
  }
  return "";
}

function resultNumber(row: JsonRecord, ...aliases: string[]): number {
  const raw = resultCell(row, ...aliases).replace(/,/g, "");
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function durationSeconds(value: unknown): number {
  const raw = text(value);
  if (!raw) return 0;
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return numeric > 0 && numeric < 2 ? numeric * 86400 : numeric;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/i.test(raw)) {
    const parsedDate = new Date(raw);
    if (!Number.isNaN(parsedDate.getTime())) {
      return parsedDate.getUTCHours() * 3600
        + parsedDate.getUTCMinutes() * 60
        + parsedDate.getUTCSeconds()
        + parsedDate.getUTCMilliseconds() / 1000;
    }
  }
  const parts = raw.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

function durationSecondsFromCell(row: JsonRecord, ...aliases: string[]): number {
  for (const alias of aliases) {
    const normalizedAlias = normalizedColumn(alias);
    for (const [header, value] of Object.entries(row)) {
      if (normalizedColumn(header) !== normalizedAlias) continue;
      const seconds = durationSeconds(value);
      // Legacy imports can contain both `Chip Time` and a canonical
      // `chipTime: 0`. Do not let the empty canonical value mask the sheet.
      if (seconds > 0) return seconds;
    }
  }
  return 0;
}

function resultDurationSeconds(row: JsonRecord): number {
  return durationSecondsFromCell(row, "chip time", "finish time", "net time", "overall time", "time", "race time");
}

export function normalizeImportedResultStatus(status: unknown, overallTime: number): RaceStatus {
  const raw = text(status);
  const normalized = raw.toUpperCase().replace(/[\s-]+/g, "_");
  const aliases: Record<string, RaceStatus> = {
    COMPLETE: "FINISHED",
    COMPLETED: "FINISHED",
    FINISHER: "FINISHED",
    DID_NOT_START: "DNS",
    DID_NOT_FINISH: "DNF",
    DID_NOT_QUALIFY: "DNQ",
    NOT_QUALIFIED: "DNQ",
    DISQUALIFIED: "DSQ",
    DQ: "DSQ",
    OUT_OF_TIME: "OTL",
    OUT_OF_TIME_LIMIT: "OTL",
  };
  const resolved = aliases[normalized] ?? normalizeRaceStatus(raw);
  if (resolved !== "UNKNOWN") return resolved;
  return overallTime > 0 ? "FINISHED" : "DNS";
}

function resultLegs(row: JsonRecord): Array<{ name: string; time: number }> {
  const definitions: Array<[string, string[]]> = [
    ["Swim", ["swim", "swim time"]],
    ["Run 1", ["run 1", "run1", "first run"]],
    ["T1", ["t1", "transition 1", "transition1"]],
    ["Bike", ["bike", "bike time", "cycle", "cycling"]],
    ["T2", ["t2", "transition 2", "transition2"]],
    ["Run", ["run", "run time"]],
    ["Run 2", ["run 2", "run2", "second run"]],
  ];
  return definitions.flatMap(([name, aliases]) => {
    const seconds = durationSecondsFromCell(row, ...aliases);
    return seconds > 0 ? [{ name, time: seconds }] : [];
  });
}

function resultSplits(row: JsonRecord, legs = resultLegs(row)): Array<{ name: string; time: number }> {
  const checkpointDefinitions: Array<[string, string[]]> = [
    ["Start", ["start", "race start", "start elapsed"]],
    ["Swim Finish", ["swim finish", "swim finish elapsed"]],
    ["Bike Start", ["bike start", "bike start elapsed"]],
    ["Bike Finish", ["bike finish", "bike finish elapsed"]],
    ["Run Start", ["run start", "run start elapsed"]],
    ["Race Finish", ["race finish", "finish", "finish elapsed"]],
  ];
  const checkpoints = checkpointDefinitions.flatMap(([name, aliases]) => {
    const seconds = durationSecondsFromCell(row, ...aliases);
    return seconds > 0 ? [{ name, time: seconds }] : [];
  });
  const checkpointsAreChronological = checkpoints.every((checkpoint, index) =>
    index === 0 || checkpoint.time > checkpoints[index - 1].time);
  if (checkpoints.length >= 2 && checkpointsAreChronological) return checkpoints;

  let cumulative = 0;
  return legs.map(({ name, time }) => {
    cumulative += time;
    return [{ name, time: cumulative }];
  }).flat();
}

export function buildImportedResultTiming(row: Record<string, unknown>) {
  const legs = resultLegs(row);
  return {
    overallTime: resultDurationSeconds(row),
    gunTime: durationSecondsFromCell(row, "gun time", "gross time", "official time"),
    legs,
    splits: resultSplits(row, legs),
  };
}

function resultRecordId(row: JsonRecord, category: string, rowNumber: number): string {
  const supplied = resultCell(row, "participant uid", "participant id", "result id", "id");
  const bib = resultCell(row, "bib", "bib no", "bib number", "bib#", "race number");
  const seed = supplied || [category, bib].filter(Boolean).join("-") || `row-${rowNumber}`;
  return seed
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 150) || `row-${rowNumber}`;
}

export async function importEventResults(eventId: string, input: ResultImportInput): Promise<ResultImportSummary> {
  const kv = await getKv();
  const current = await getRawEvent(kv, eventId);
  if (!current) throw new Error("Event not found.");
  const event = mapEvent(current, (await getResultIds(kv, eventId)).length);
  const validTargets = new Set(event.categories.length ? event.categories : ["Overall"]);
  const normalizedMappings = new Map(
    Object.entries(input.categoryMappings)
      .map(([source, target]) => [source.trim(), target.trim()] as const)
      .filter(([, target]) => validTargets.has(target)),
  );
  if (!normalizedMappings.size) throw new Error("Map at least one spreadsheet ticket category to an event category.");

  const existingIds = await getResultIds(kv, eventId);
  const prepared: Array<{ id: string; record: JsonRecord; source: string; target: string }> = [];
  const usedIds = new Set<string>();
  let skipped = 0;
  input.rows.forEach((row, index) => {
    const mappedRow = applyImportedResultColumnMappings(row, input.columnMappings);
    const source = resultCell(mappedRow, input.categoryColumn);
    const target = normalizedMappings.get(source);
    if (!target) {
      skipped += 1;
      return;
    }
    const bib = resultCell(mappedRow, "bib", "bib no", "bib number", "bib#", "race number");
    const name = resultCell(mappedRow, "name", "full name", "athlete", "athlete name", "participant name");
    if (!bib && !name) {
      skipped += 1;
      return;
    }
    let id = resultRecordId(mappedRow, target, index + 2);
    let duplicate = 2;
    while (usedIds.has(id)) {
      id = `${resultRecordId(mappedRow, target, index + 2)}-${duplicate}`;
      duplicate += 1;
    }
    usedIds.add(id);
    const timing = buildImportedResultTiming(mappedRow);
    const overallTime = timing.overallTime;
    const statusRaw = resultCell(mappedRow, "status", "result status", "race status");
    const status = normalizeImportedResultStatus(statusRaw, overallTime);
    const explicitAgeGroup = resultCell(mappedRow, "age group", "age category", "agegroup");
    const sheetCategory = normalizedColumn(input.categoryColumn) === normalizedColumn("category")
      ? ""
      : resultCell(mappedRow, "category");
    prepared.push({
      id,
      source,
      target,
      record: {
        ...mappedRow,
        id,
        notificationSourceId: resultCell(mappedRow, "participant uid", "participant id", "result id", "id"),
        bib,
        "Bib Number": bib,
        name,
        Name: name,
        email: resultCell(mappedRow, "email", "email address", "athlete email", "participant email"),
        mobile: resultCell(mappedRow, "mobile", "mobile number", "phone", "phone number", "contact number"),
        category: target,
        Category: target,
        "RACE CAT": target,
        sourceCategory: source,
        status,
        overallTime,
        chipTime: overallTime,
        gunTime: timing.gunTime,
        legTimes: timing.legs,
        splits: timing.splits,
        startTimeOfDay: resultCell(mappedRow, "start time of day", "start · time of day"),
        finishTimeOfDay: resultCell(mappedRow, "finish time of day", "finish · time of day", "race finish time of day"),
        pace: resultCell(mappedRow, "pace", "average pace", "avg pace", "speed"),
        gender: resultCell(mappedRow, "gender", "sex"),
        ageGroup: explicitAgeGroup || sheetCategory,
        country: resultCell(mappedRow, "country", "country code", "nationality"),
        club: resultCell(mappedRow, "club", "team", "running club"),
        city: resultCell(mappedRow, "city", "location"),
        overallRank: resultNumber(mappedRow, "overall rank", "o rank", "rank", "position"),
        genderRank: resultNumber(mappedRow, "gender rank", "g rank"),
        categoryRank: resultNumber(mappedRow, "category rank", "c rank", "age rank", "age group rank"),
        importedAt: new Date().toISOString(),
        importFileName: input.fileName,
        importRow: index + 2,
      },
    });
  });
  if (!prepared.length) throw new Error("No valid result rows remain after applying the category mapping.");

  const existingSummary = input.replaceExisting
    ? null
    : await kv.get<{ maxFinishSeconds?: number; finishedCount?: number }>(`${PREFIX}:event:${eventId}:results:summary`, "json");
  const importedFinishSeconds = prepared.flatMap(({ record }) =>
    text(record.status).toUpperCase() === "FINISHED" && number(record.overallTime) > 0
      ? [number(record.overallTime)]
      : []);
  const maxFinishSeconds = Math.max(existingSummary?.maxFinishSeconds ?? 0, ...importedFinishSeconds);
  const finishedCount = (input.replaceExisting ? 0 : existingSummary?.finishedCount ?? 0) + importedFinishSeconds.length;
  const resultSummary = { maxFinishSeconds, finishedCount, updatedAt: new Date().toISOString() };

  if (input.replaceExisting && existingIds.length) {
    await Promise.all(existingIds.map((id) => kv.delete(`${PREFIX}:event:${eventId}:result:${id}`)));
  }
  await Promise.all(prepared.map(({ id, record }) =>
    kv.put(`${PREFIX}:event:${eventId}:result:${id}`, JSON.stringify(record))));
  const nextIds = input.replaceExisting
    ? prepared.map((item) => item.id)
    : [...new Set([...existingIds, ...prepared.map((item) => item.id)])];
  const updatedEvent = { ...current, hasResults: true, updatedAt: new Date().toISOString() };
  await Promise.all([
    kv.put(`${PREFIX}:event:${eventId}:results:index`, JSON.stringify(nextIds)),
    kv.put(`${PREFIX}:event:${eventId}:results:summary`, JSON.stringify(resultSummary)),
    kv.put(`${PREFIX}:event:${eventId}`, JSON.stringify(updatedEvent)),
  ]);
  const categoryCounts = new Map<string, { source: string; target: string; count: number }>();
  prepared.forEach(({ source, target }) => {
    const key = `${source}\u0000${target}`;
    const currentCount = categoryCounts.get(key);
    categoryCounts.set(key, { source, target, count: (currentCount?.count ?? 0) + 1 });
  });
  await writeAudit(kv, "RESULTS_IMPORTED", text(current.name), {
    eventId,
    fileName: input.fileName,
    imported: prepared.length,
    skipped,
    replaceExisting: input.replaceExisting,
    replaced: input.replaceExisting ? existingIds.length : 0,
    categoryMappings: Object.fromEntries(normalizedMappings),
  });
  return {
    imported: prepared.length,
    skipped,
    replaced: input.replaceExisting ? existingIds.length : 0,
    categories: [...categoryCounts.values()],
    fileName: input.fileName,
  };
}

export async function deleteEventResults(eventId: string): Promise<ResultDeleteSummary> {
  const kv = await getKv();
  const current = await getRawEvent(kv, eventId);
  if (!current) throw new Error("Event not found.");

  const resultKeys = await listKeys(kv, `${PREFIX}:event:${eventId}:result:`);
  const updatedEvent = {
    ...current,
    hasResults: false,
    updatedAt: new Date().toISOString(),
  };

  await Promise.all([
    ...resultKeys.map((key) => kv.delete(key)),
    kv.delete(`${PREFIX}:event:${eventId}:results:index`),
    kv.delete(`${PREFIX}:event:${eventId}:results:summary`),
    kv.put(`${PREFIX}:event:${eventId}`, JSON.stringify(updatedEvent)),
  ]);
  await writeAudit(kv, "RESULTS_DELETED", text(current.name), {
    eventId,
    deletedResults: resultKeys.length,
    deletedNotifications: 0,
  });

  return {
    eventId,
    eventName: text(current.name) || "Event",
    deletedResults: resultKeys.length,
    deletedNotifications: 0,
  };
}

export async function getAthleteResult(eventSlug: string, participantId: string): Promise<{ event: RaceEvent; athlete: Athlete } | null> {
  const kv = await getKv();
  const event = await getEventBySlug(eventSlug, { includeUnpublished: true });
  if (!event) return null;
  const raw = await kv.get<JsonRecord>(`${PREFIX}:event:${event.id}:result:${participantId}`, "json");
  return raw ? { event, athlete: mapAthlete(raw, event) } : null;
}

function mapHomepageSlides(stored: JsonRecord[], knownEvents: RaceEvent[], includeDisabled = false): HomepageSlide[] {
  return stored.map((slide, index) => {
    const linked = knownEvents.find((event) => event.id === text(slide.eventId) || event.slug === text(slide.eventSlug));
    return {
      id: text(slide.id) || `slide-${index + 1}`,
      eventId: text(slide.eventId) || linked?.id,
      eventSlug: text(slide.eventSlug) || linked?.slug,
      eventName: text(slide.eventName) || linked?.name || "Race Upshot",
      headline: text(slide.headline) || linked?.name || "Every second. Accounted for.",
      description: text(slide.description) || linked?.description || "Precision timing technology and live race intelligence.",
      image: text(slide.image) || text(slide.imageUrl) || linked?.bannerUrl || "/race-upshot-hero.png",
      imageName: text(slide.imageName) || undefined,
      primaryLabel: text(slide.primaryLabel) || undefined,
      primaryUrl: text(slide.primaryUrl) || (linked ? `/events/${linked.slug}` : undefined),
      secondaryLabel: text(slide.secondaryLabel) || undefined,
      secondaryUrl: text(slide.secondaryUrl) || linked?.registrationUrl,
      enabled: slide.enabled !== false,
      order: number(slide.order) || index + 1,
    };
  }).filter((slide) => includeDisabled || slide.enabled).sort((a, b) => a.order - b.order);
}

export async function getHomepageSlides(events?: RaceEvent[]): Promise<HomepageSlide[]> {
  const kv = await getKv();
  const [enabledRaw, stored, knownEvents] = await Promise.all([
    kv.get(`${PREFIX}:homepage-slider:enabled`),
    kv.get<JsonRecord[]>(`${PREFIX}:homepage-slider:index`, "json"),
    events ? Promise.resolve(events) : getEvents(),
  ]);
  if (enabledRaw === "false") return [];
  return mapHomepageSlides(stored ?? [], knownEvents);
}

export async function getHomepageSliderConfig(options: { publicFallback?: boolean; events?: RaceEvent[] } = {}): Promise<{ enabled: boolean; slides: HomepageSlide[] }> {
  try {
    const kv = await getKv(options.publicFallback ? 2 : undefined);
    const [enabledRaw, rawSlides, events] = await Promise.all([
      kv.get(`${PREFIX}:homepage-slider:enabled`),
      kv.get<JsonRecord[]>(`${PREFIX}:homepage-slider:index`, "json"),
      options.events ? Promise.resolve(options.events) : getEvents({ includeUnpublished: !options.publicFallback }),
    ]);
    const config = { enabled: enabledRaw !== "false", slides: mapHomepageSlides(rawSlides ?? [], events, true) };
    if (options.publicFallback) lastGoodPublicSlider = config;
    return config;
  } catch (error) {
    if (options.publicFallback && isTransientKvError(error)) {
      console.error(JSON.stringify({
        type: "public_homepage_slider_kv_unavailable",
        fallback: lastGoodPublicSlider ? "last_good" : "default",
        error: error instanceof Error ? error.message : String(error),
      }));
      return lastGoodPublicSlider ?? { enabled: true, slides: [] };
    }
    throw error;
  }
}

export async function saveHomepageSliderConfig(input: { enabled: boolean; slides: HomepageSlide[] }) {
  const kv = await getKv();
  const slides = input.slides.map((slide, index) => ({ ...slide, order: index + 1 }));
  await Promise.all([
    kv.put(`${PREFIX}:homepage-slider:enabled`, String(input.enabled)),
    kv.put(`${PREFIX}:homepage-slider:index`, JSON.stringify(slides)),
  ]);
  await writeAudit(kv, "HOMEPAGE_SLIDER_UPDATED", `${slides.length} slides`);
  return { enabled: input.enabled, slides };
}

export async function getCmsSiteSettings(options: { publicFallback?: boolean } = {}): Promise<CmsSiteSettings> {
  try {
    const kv = await getKv(options.publicFallback ? 2 : undefined);
    const stored = await kv.get<CmsSiteSettings>(`${PREFIX}:cms:site-settings`, "json");
    const settings: CmsSiteSettings = !stored ? structuredClone(defaultCmsSiteSettings) : {
      loginMedia: Array.isArray(stored.loginMedia)
        ? stored.loginMedia
            .map((item, index) => ({ ...item, src: cmsMediaUrl(item?.src), enabled: item.enabled !== false, order: item.order || index + 1 }))
            .filter((item) => item.src && (item.type === "image" || item.type === "video"))
            .sort((a, b) => a.order - b.order)
        : [],
      footer: {
        tagline: text(stored.footer?.tagline) || defaultCmsSiteSettings.footer.tagline,
        email: text(stored.footer?.email) || defaultCmsSiteSettings.footer.email,
        location: text(stored.footer?.location) || defaultCmsSiteSettings.footer.location,
        columns: Array.isArray(stored.footer?.columns) && stored.footer.columns.length
          ? stored.footer.columns.map((column, columnIndex) => ({
              id: text(column.id) || `column-${columnIndex + 1}`,
              title: text(column.title) || `Column ${columnIndex + 1}`,
              links: Array.isArray(column.links) ? column.links.map((link, linkIndex) => ({
                id: text(link.id) || `link-${columnIndex + 1}-${linkIndex + 1}`,
                label: text(link.label),
                url: cmsPublicUrl(link.url),
              })).filter((link) => link.label && link.url) : [],
            }))
          : structuredClone(defaultCmsSiteSettings.footer.columns),
      },
    };
    if (options.publicFallback) lastGoodPublicSiteSettings = settings;
    return settings;
  } catch (error) {
    if (options.publicFallback && isTransientKvError(error)) {
      console.error(JSON.stringify({
        type: "public_site_settings_kv_unavailable",
        fallback: lastGoodPublicSiteSettings ? "last_good" : "default",
        error: error instanceof Error ? error.message : String(error),
      }));
      return lastGoodPublicSiteSettings ?? structuredClone(defaultCmsSiteSettings);
    }
    throw error;
  }
}

export async function saveCmsSiteSettings(input: CmsSiteSettings): Promise<CmsSiteSettings> {
  const kv = await getKv();
  const saved: CmsSiteSettings = {
    loginMedia: input.loginMedia.map((item, index) => ({ ...item, src: cmsMediaUrl(item.src), order: index + 1 })).filter((item) => item.src),
    footer: {
      tagline: input.footer.tagline.trim(),
      email: input.footer.email.trim(),
      location: input.footer.location.trim(),
      columns: input.footer.columns.map((column, columnIndex) => ({
        ...column,
        id: column.id || `column-${columnIndex + 1}`,
        title: column.title.trim(),
        links: column.links.map((link) => ({
          ...link,
          label: link.label.trim(),
          url: cmsPublicUrl(link.url),
        })),
      })),
    },
  };
  await kv.put(`${PREFIX}:cms:site-settings`, JSON.stringify(saved));
  await writeAudit(kv, "CMS_SITE_SETTINGS_UPDATED", `${saved.loginMedia.length} login media items`);
  return saved;
}

export async function getAuditEntries(limit = 100): Promise<AuditEntry[]> {
  const kv = await getKv();
  const ids = await getIndex(kv, `${PREFIX}:timing:audit:index`);
  const selectedIds = ids.slice(-Math.max(0, limit)).reverse();
  const rows = await mapWithConcurrency(selectedIds, 8, (id) => kv.get<JsonRecord>(`${PREFIX}:timing:audit:${id}`, "json"));
  return rows.filter((row): row is JsonRecord => Boolean(row)).map((row, index) => {
    const timestamp = text(row.timestamp) || text(row.createdAt) || text(row.time);
    const parsed = Date.parse(timestamp);
    return {
      id: text(row.id) || selectedIds[index] || `audit-${index}`,
      time: Number.isNaN(parsed) ? timestamp : new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Kolkata" }).format(new Date(parsed)),
      actor: text(row.actorName) || text(row.actor) || text(row.email) || "System",
      action: text(row.action) || text(row.type) || "ACTIVITY_RECORDED",
      entity: text(row.entity) || text(row.eventName) || text(row.message) || text(row.eventId),
      ip: text(row.ip) || text(row.ipAddress) || "worker",
      severity: text(row.severity) === "critical" ? "critical" : text(row.severity) === "warning" ? "warning" : "normal",
    };
  });
}

export interface EventWriteInput {
  name: string;
  slug: string;
  sport: string;
  date: string;
  startTime?: string;
  city: string;
  venue: string;
  venueAddress?: string;
  organizerAddress?: string;
  jurisdiction?: string;
  organizer?: string;
  companyDescription?: string;
  contactEmail?: string;
  contactPhone?: string;
  websiteUrl?: string;
  registrationUrl?: string;
  knowMoreUrl?: string;
  broadcastUrl?: string;
  rulesUrl?: string;
  rulesHtml?: string;
  waiverHtml?: string;
  waiverVersion?: string;
  waiverPolicy?: EventWaiverPolicy;
  waiverParameterMappings?: WaiverParameterMapping[];
  athleteGuidebookUrl?: string;
  athleteGuidebookData?: string;
  latitude?: string;
  longitude?: string;
  description?: string;
  logoData?: string;
  bannerData?: string;
  categories?: string[];
  ticketDefinitions?: import('./event-ticket-definition').EventTicketDefinition[];
}

export class EventSlugConflictError extends Error {
  conflict: Pick<RaceEvent, "id" | "name" | "slug" | "status">;

  constructor(slug: string, conflict: RaceEvent) {
    super(`The slug “${slug}” is already used by “${conflict.name}”. Edit that event or choose a different slug.`);
    this.name = "EventSlugConflictError";
    this.conflict = {
      id: conflict.id,
      name: conflict.name,
      slug: conflict.slug,
      status: conflict.status,
    };
  }
}

export function normalizedEventSlug(value: string): string {
  return value.trim().toLowerCase();
}

export function eventWriteRecord(input: EventWriteInput): JsonRecord {
  const ticketDefinitions = input.ticketDefinitions ?? [];
  const categories = [...new Set([
    ...(input.categories ?? []),
    ...ticketDefinitions.map((ticket) => ticket.name),
  ].map((category) => category.trim()).filter(Boolean))];
  const startDateTime = input.date
    ? new Date(`${input.date}T${input.startTime || "00:00"}:00+05:30`).toISOString()
    : "";
  return {
    name: input.name.trim(),
    slug: input.slug.trim(),
    eventCode: input.slug.trim(),
    shortName: input.name.trim(),
    sport: input.sport,
    date: startDateTime,
    startDateTime,
    city: input.city.trim(),
    location: input.city.trim(),
    venueName: input.venue.trim(),
    venueAddress: input.venueAddress?.trim() ?? "",
    organizerAddress: input.organizerAddress?.trim() ?? "",
    jurisdiction: input.jurisdiction?.trim() ?? "",
    description: input.description?.trim() ?? "",
    summaryDescription: input.description?.trim() ?? "",
    organizerName: input.organizer?.trim() ?? "",
    companyDescription: input.companyDescription?.trim() ?? "",
    organizerEmail: input.contactEmail?.trim() ?? "",
    contactPhone: input.contactPhone?.trim() ?? "",
    websiteUrl: input.websiteUrl?.trim() ?? "",
    eventWebsite: input.websiteUrl?.trim() ?? "",
    registrationUrl: input.registrationUrl?.trim() ?? "",
    knowMoreUrl: input.knowMoreUrl?.trim() ?? "",
    broadcastUrl: input.broadcastUrl?.trim() ?? "",
    rulesUrl: input.rulesUrl?.trim() ?? "",
    rulesHtml: sanitizeEventDocumentHtml(input.rulesHtml ?? ""),
    waiverHtml: sanitizeEventDocumentHtml(input.waiverHtml ?? ""),
    waiverVersion: input.waiverVersion?.trim() ?? "",
    waiverPolicy: eventWaiverPolicy(input.waiverPolicy),
    waiverParameterMappings: (input.waiverParameterMappings ?? []).flatMap((mapping) =>
      /^[a-zA-Z][a-zA-Z0-9_.-]{0,99}$/.test(mapping.token) && waiverParameterSources.some((option) => option.value === mapping.source)
        ? [{ token: mapping.token, source: mapping.source, ...(mapping.source === "custom" ? { customValue: (mapping.customValue ?? "").slice(0, 2_000) } : {}) }]
        : []),
    athleteGuidebookUrl: input.athleteGuidebookUrl?.trim() ?? "",
    latitude: input.latitude?.trim() ?? "",
    longitude: input.longitude?.trim() ?? "",
    logoUrl: input.logoData ?? "",
    bannerUrl: input.bannerData ?? "",
    heroBannerUrl: input.bannerData ?? "",
    categories,
    ticketDefinitions,
  };
}

export async function createEvent(input: EventWriteInput): Promise<RaceEvent> {
  const kv = await getKv();
  const existing = await getEvents({ includeUnpublished: true });
  const slug = normalizedEventSlug(input.slug);
  const conflict = existing.find((event) => normalizedEventSlug(event.slug) === slug);
  if (conflict) throw new EventSlugConflictError(slug, conflict);
  const id = crypto.randomUUID();
  const guidebookData = input.athleteGuidebookData?.trim();
  const writeRecord = eventWriteRecord({ ...input, slug });
  if (guidebookData) writeRecord.athleteGuidebookUrl = `/api/v1/events/${encodeURIComponent(id)}/media/guidebook`;
  const raw = { id, ...writeRecord, status: "draft", hasResults: false, isUpcoming: true, createdAt: new Date().toISOString() };
  const writes = [
    kv.put(`${PREFIX}:event:${id}`, JSON.stringify(raw)),
    appendIndex(kv, `${PREFIX}:events:index`, id),
  ];
  if (guidebookData) writes.push(kv.put(`${PREFIX}:event:${id}:guidebook`, guidebookData));
  await Promise.all(writes);
  await writeAudit(kv, "EVENT_CREATED", input.name, { eventId: id });
  return mapEvent(raw, 0);
}

export async function updateEvent(id: string, input: EventWriteInput): Promise<RaceEvent> {
  const kv = await getKv();
  const current = await getRawEvent(kv, id);
  if (!current) throw new Error("Event not found.");
  const slug = normalizedEventSlug(input.slug);
  const existing = await getEvents({ includeUnpublished: true });
  const conflict = existing.find((event) => event.id !== id && normalizedEventSlug(event.slug) === slug);
  if (conflict) throw new EventSlugConflictError(slug, conflict);
  const guidebookData = input.athleteGuidebookData?.trim();
  const writeRecord = eventWriteRecord({ ...input, slug });
  const internalGuidebookUrl = `/api/v1/events/${encodeURIComponent(id)}/media/guidebook`;
  if (guidebookData) writeRecord.athleteGuidebookUrl = internalGuidebookUrl;
  const updated = { ...current, ...writeRecord, id, updatedAt: new Date().toISOString() };
  const writes: Promise<void>[] = [kv.put(`${PREFIX}:event:${id}`, JSON.stringify(updated))];
  if (guidebookData) writes.push(kv.put(`${PREFIX}:event:${id}:guidebook`, guidebookData));
  else if (writeRecord.athleteGuidebookUrl !== internalGuidebookUrl) writes.push(kv.delete(`${PREFIX}:event:${id}:guidebook`));
  await Promise.all(writes);
  await writeAudit(kv, "EVENT_UPDATED", input.name, { eventId: id });
  return mapEvent(updated, (await getResultIds(kv, id)).length);
}

export async function getEventGuidebookData(eventId: string): Promise<string | null> {
  const kv = await getKv();
  return kv.get(`${PREFIX}:event:${eventId}:guidebook`);
}

export async function getEventPartners(eventReference: string): Promise<EventPartner[] | null> {
  const kv = await getKv();
  const event = await getEventBySlug(eventReference, { includeUnpublished: true });
  if (!event) return null;
  return normalizePartners(await kv.get<unknown>(`${PREFIX}:event:${event.id}:partners`, "json"));
}

export async function replaceEventPartners(eventId: string, partners: EventPartner[]): Promise<EventPartner[]> {
  const kv = await getKv();
  const event = await getRawEvent(kv, eventId);
  if (!event) throw new Error("Event not found.");
  const normalized = normalizePartners(partners);
  await kv.put(`${PREFIX}:event:${eventId}:partners`, JSON.stringify(normalized));
  await writeAudit(kv, "EVENT_PARTNERS_UPDATED", text(event.name), { eventId, partnerCount: normalized.length });
  return normalized;
}

export async function publishEvent(id: string): Promise<RaceEvent> {
  const kv = await getKv();
  const current = await getRawEvent(kv, id);
  if (!current) throw new Error("Event not found.");
  const published = {
    ...current,
    id,
    status: "upcoming",
    isUpcoming: true,
    publishedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await kv.put(`${PREFIX}:event:${id}`, JSON.stringify(published));
  await writeAudit(kv, "EVENT_PUBLISHED", text(current.name), { eventId: id });
  return mapEvent(published, (await getResultIds(kv, id)).length);
}

export async function mergeEventCategories(id: string, categories: string[]): Promise<RaceEvent> {
  const kv = await getKv();
  const current = await getRawEvent(kv, id);
  if (!current) throw new Error("Event not found.");
  const merged = [...new Set([
    ...getCategoryNames(current),
    ...categories.map((category) => category.trim()).filter(Boolean),
  ])];
  const updated = { ...current, categories: merged, updatedAt: new Date().toISOString() };
  await kv.put(`${PREFIX}:event:${id}`, JSON.stringify(updated));
  await writeAudit(kv, "EVENT_CATEGORIES_SYNCED", text(current.name), {
    eventId: id,
    categoryCount: merged.length,
  });
  return mapEvent(updated, (await getResultIds(kv, id)).length);
}

export async function deleteEvent(id: string): Promise<void> {
  const kv = await getKv();
  const current = await getRawEvent(kv, id);
  if (!current) throw new Error("Event not found.");
  const ids = await getIndex(kv, `${PREFIX}:events:index`);
  const eventDataPrefix = `${PREFIX}:event:${id}:`;
  const eventDataKeys = await listKeys(kv, eventDataPrefix);
  await Promise.all([
    kv.delete(`${PREFIX}:event:${id}`),
    ...eventDataKeys.map((key) => kv.delete(key)),
    kv.delete(`${PREFIX}:course-maps:event:${id}`),
    kv.delete(`${PREFIX}:live:event:${id}:participants`),
    kv.delete(`${PREFIX}:live:event:${id}:updated`),
    kv.put(`${PREFIX}:events:index`, JSON.stringify(ids.filter((eventId) => eventId !== id))),
  ]);
  await writeAudit(kv, "EVENT_DELETED", text(current.name), {
    eventId: id,
    previousStatus: text(current.status),
    relatedRecordsDeleted: eventDataKeys.length,
  });
}

export async function getCertificateTemplates(): Promise<StoredCertificateTemplate[]> {
  const kv = await getKv();
  const ids = await getIndex(kv, `${PREFIX}:certificate-templates:index`);
  const rows = await Promise.all(ids.map((id) => kv.get<StoredCertificateTemplate>(`${PREFIX}:certificate-template:${id}`, "json")));
  return rows.filter((row): row is StoredCertificateTemplate => Boolean(row));
}

export async function saveCertificateTemplate(template: StoredCertificateTemplate): Promise<StoredCertificateTemplate> {
  const kv = await getKv();
  const id = encodeURIComponent(certificateTemplateId(template.eventSlug, template.category));
  const saved = { ...template, savedAt: new Date().toISOString() };
  await Promise.all([
    kv.put(`${PREFIX}:certificate-template:${id}`, JSON.stringify(saved)),
    appendIndex(kv, `${PREFIX}:certificate-templates:index`, id),
  ]);
  await writeAudit(kv, "CERTIFICATE_TEMPLATE_SAVED", `${template.eventSlug} · ${template.category}`);
  return saved;
}

export async function findCertificate(verificationCode: string): Promise<{ event: RaceEvent; athlete: Athlete } | null> {
  const events = await getEvents();
  for (const event of events.filter((item) => item.hasResults)) {
    const result = await getResults(event.slug);
    const athlete = result.athletes.find((item) => item.verificationCode === verificationCode);
    if (athlete) return { event, athlete };
  }
  return null;
}

export async function getStoredUserCount(): Promise<number> {
  const kv = await getKv();
  return (await getIndex(kv, `${PREFIX}:users:index`)).length;
}

function normalizeCmsPage(page: CmsPageRecord): CmsPageRecord {
  const blocks = sanitizeCmsBlocks(Array.isArray(page.blocks) ? page.blocks : []);
  const published = page.published ? {
    ...page.published,
    blocks: sanitizeCmsBlocks(Array.isArray(page.published.blocks) ? page.published.blocks : []),
  } : undefined;
  return {
    ...page,
    path: page.slug ? `/${page.slug}` : "/",
    blocks,
    placements: Array.isArray(page.placements) ? page.placements : [],
    published,
  };
}

export async function getCmsPages(): Promise<CmsPageRecord[]> {
  const kv = await getKv();
  const ids = await getIndex(kv, `${PREFIX}:cms:pages:index`);
  const rows = await Promise.all(ids.map((id) => kv.get<CmsPageRecord>(`${PREFIX}:cms:page:${id}`, "json")));
  const stored = rows.filter((row): row is CmsPageRecord => Boolean(row)).map(normalizeCmsPage);
  const core = coreCmsPages.map((page) => stored.find((item) => item.slug === page.slug) ?? page);
  const custom = stored.filter((page) => !coreCmsPages.some((corePage) => corePage.slug === page.slug));
  return [...core, ...custom].sort((a, b) => a.order - b.order);
}

export async function getPublishedCmsPage(slug: string): Promise<CmsPublishedSnapshot | null> {
  const page = (await getCmsPages()).find((item) => item.slug === slug);
  if (!page || page.access !== "Public" || !page.published) return null;
  return {
    ...page.published,
    blocks: sanitizeCmsBlocks(page.published.blocks),
  };
}

export async function saveCmsPageDraft(input: CmsPageRecord): Promise<CmsPageRecord> {
  const kv = await getKv();
  const pages = await getCmsPages();
  const id = input.id || `page-${crypto.randomUUID()}`;
  const slug = input.slug.trim().replace(/^\/+|\/+$/g, "");
  const duplicate = pages.find((page) => page.slug === slug && page.id !== id);
  if (duplicate) throw new Error("A CMS page with this slug already exists.");
  const existing = pages.find((page) => page.id === id);
  const saved: CmsPageRecord = normalizeCmsPage({
    ...input,
    id,
    slug,
    path: slug ? `/${slug}` : "/",
    title: input.title.trim(),
    description: input.description.trim(),
    blocks: sanitizeCmsBlocks(input.blocks),
    status: "Draft",
    updatedAt: new Date().toISOString(),
    published: existing?.published,
  });
  await Promise.all([
    kv.put(`${PREFIX}:cms:page:${id}`, JSON.stringify(saved)),
    appendIndex(kv, `${PREFIX}:cms:pages:index`, id),
  ]);
  await writeAudit(kv, "CMS_PAGE_DRAFT_SAVED", saved.title, { pageId: id, slug });
  return saved;
}

export async function publishCmsPage(id: string): Promise<CmsPageRecord> {
  const kv = await getKv();
  const current = (await getCmsPages()).find((page) => page.id === id);
  if (!current) throw new Error("CMS page not found.");
  const publishedAt = new Date().toISOString();
  const published: CmsPublishedSnapshot = {
    title: current.title,
    description: current.description,
    blocks: sanitizeCmsBlocks(current.blocks),
    publishedAt,
  };
  const saved: CmsPageRecord = { ...current, status: "Published", published, updatedAt: publishedAt };
  await Promise.all([
    kv.put(`${PREFIX}:cms:page:${id}`, JSON.stringify(saved)),
    appendIndex(kv, `${PREFIX}:cms:pages:index`, id),
  ]);
  await writeAudit(kv, "CMS_PAGE_PUBLISHED", saved.title, { pageId: id, slug: saved.slug });
  return saved;
}

export async function saveCmsPageOrder(ids: string[]): Promise<CmsPageRecord[]> {
  const kv = await getKv();
  const pages = await getCmsPages();
  const existingIds = pages.map((page) => page.id);
  if (ids.length !== existingIds.length || new Set(ids).size !== ids.length) {
    throw new Error("Page order must include every CMS page exactly once.");
  }
  if (ids.some((id) => !existingIds.includes(id))) {
    throw new Error("Page order contains an unknown CMS page.");
  }
  const now = new Date().toISOString();
  const ordered = ids.map((id, index) => ({
    ...pages.find((page) => page.id === id)!,
    order: index + 1,
    updatedAt: now,
  }));
  await Promise.all([
    ...ordered.map((page) => kv.put(`${PREFIX}:cms:page:${page.id}`, JSON.stringify(page))),
    kv.put(`${PREFIX}:cms:pages:index`, JSON.stringify(ids)),
  ]);
  await writeAudit(kv, "CMS_PAGE_ORDER_SAVED", `${ordered.length} pages`, { pageIds: ids });
  return ordered;
}

export async function deleteCmsPage(id: string): Promise<void> {
  if (id.startsWith("core-")) throw new Error("Core website pages cannot be deleted.");
  const kv = await getKv();
  const pages = await getCmsPages();
  const page = pages.find((item) => item.id === id);
  if (!page) throw new Error("CMS page not found.");
  const ids = await getIndex(kv, `${PREFIX}:cms:pages:index`);
  await Promise.all([
    kv.delete(`${PREFIX}:cms:page:${id}`),
    kv.put(`${PREFIX}:cms:pages:index`, JSON.stringify(ids.filter((pageId) => pageId !== id))),
  ]);
  await writeAudit(kv, "CMS_PAGE_DELETED", page.title, { pageId: id, slug: page.slug });
}
