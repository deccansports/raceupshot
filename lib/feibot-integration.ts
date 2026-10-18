import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { KVNamespace } from "@cloudflare/workers-types";
import { getEventBySlug, mergeEventCategories } from "./raceupshot-repository";
import {
  getEventPlatformSettings,
  saveEventPlatformSettings,
} from "./platform-repository";
import { buildAndPublishCanonicalEventVersion, getCanonicalLiveEvent, getCanonicalLiveManifest, getCanonicalParticipantIndex, publishIncrementalCanonicalParticipants, resetCanonicalLiveEvent } from "./canonical-live-tracking";
import { getLiveTrackingHubConfig, normalizeFinalRaceSplits, saveLiveTrackingHubConfig, type HubLeg, type HubSplit, type HubTimingPoint, type LiveTrackingHubConfig } from "./live-tracking-hub-config";
import { expandFeibotSportLegs } from "./race-flow-legs";
import { withTransientKvRetry } from "./kv-retry";
import { applyParticipantRegistrationEnrichment } from "./participant-roster-import";
import { getAdminEventCourseMaps } from "./course-maps";
import { ensureFeibotLiveSyncSchedule } from "./feibot-live-sync-scheduler";
import { feibotAccessDeniedRetryAt, feibotCooldownUntil, feibotRetryDelayMilliseconds, isFeibotCooldownActive, parseRetryAfterMilliseconds } from "./feibot-rate-limit";
import { reevaluateEventTimingCutoffs, storeFeibotProcessedTimingAudits } from "./feibot-timing-processing";
import { resolveConfiguredFinishers } from "./live-leaderboard";
import { timingProviderError, type TimingProviderOutcome } from "./timing-provider-response";

const PREFIX = "raceupshot";
const DEFAULT_BASE_URL = "https://apicn.feibot.com";

type JsonRecord = Record<string, unknown>;

interface StoredFeibotCredentials {
  accessKey?: string;
  secretKey?: string;
  baseUrl: string;
  eventUuid: string;
  updatedAt: string;
  credentialSource?: "EVENT" | "ACCOUNT";
}

interface ResolvedFeibotCredentials {
  accessKey: string;
  secretKey: string;
  baseUrl: string;
  eventUuid: string;
  updatedAt: string;
}

interface StoredFeibotAccountCredentials {
  accountId: string;
  accessKey: string;
  secretKey: string;
  baseUrl: string;
  updatedAt: string;
  lastTestedAt: string | null;
  lastTestSucceeded: boolean | null;
  lastTestMessage: string | null;
}

export interface FeibotAccountCredentialStatus {
  configured: boolean;
  accountId: string;
  accessKeyMasked: string | null;
  baseUrl: string;
  updatedAt: string | null;
  lastTestedAt: string | null;
  connected: boolean | null;
  message: string | null;
}

export function chooseFeibotCredentialSource(input: { requested?: "EVENT" | "ACCOUNT"; suppliedEventKey: boolean; storedSource?: "EVENT" | "ACCOUNT" | null; accountConfigured: boolean }): "EVENT" | "ACCOUNT" {
  if (input.requested) return input.requested;
  if (input.suppliedEventKey) return "EVENT";
  if (input.storedSource) return input.storedSource;
  return input.accountConfigured ? "ACCOUNT" : "EVENT";
}

export interface FeibotEndpointStatus {
  ok: boolean;
  status: number;
  count: number;
  message: string;
}

export interface FeibotAdminConnection {
  connectionId: string | null;
  label: string | null;
  raceDate: string | null;
  activeConnectionId: string | null;
  connections: FeibotConnectionCard[];
  configured: boolean;
  connected: boolean;
  status: "NOT_CONFIGURED" | "CONNECTED" | "PARTIAL_FAILURE" | "AUTH_ERROR" | "FAILED";
  accessKeyMasked: string | null;
  baseUrl: string;
  eventUuid: string;
  eventName: string | null;
  contests: Array<{ uuid: string; name: string }>;
  counts: {
    contests: number;
    participants: number;
    liveRecords: number;
    results: number;
    leaderboardRows: number;
  };
  endpoints: {
    timingRules: FeibotEndpointStatus;
    participants: FeibotEndpointStatus;
    live: FeibotEndpointStatus;
    results: FeibotEndpointStatus;
    leaderboards: FeibotEndpointStatus;
  };
  lastConnectedAt: string | null;
  canonicalBuild: { version: string; builtAt: string; completeBuildValid: boolean } | null;
  credentialSource: "EVENT" | "ACCOUNT" | null;
}

export interface FeibotConnectionCard {
  connectionId: string;
  label: string;
  eventUuid: string;
  eventName: string | null;
  raceDate: string | null;
  contests: Array<{ uuid: string; name: string }>;
  configured: boolean;
  connected: boolean;
  status: FeibotAdminConnection["status"];
  credentialSource: "EVENT" | "ACCOUNT";
  accessKeyMasked: string | null;
  lastConnectedAt: string | null;
  counts: FeibotAdminConnection["counts"];
}

interface StoredFeibotSnapshot extends FeibotAdminConnection {
  configured: true;
  accessKeyMasked: string;
}

interface StoredFeibotConnectionEntry {
  connectionId: string;
  label: string;
  raceDate: string | null;
  credential: StoredFeibotCredentials;
  snapshot: StoredFeibotSnapshot;
}

interface StoredFeibotConnectionRegistry {
  schemaVersion: 1;
  activeConnectionId: string | null;
  connections: StoredFeibotConnectionEntry[];
  updatedAt: string;
}

export function chooseFeibotConnectionId(
  connections: Array<{ connectionId: string; eventUuid: string }>,
  activeConnectionId: string | null,
  requested?: { connectionId?: string | null; eventUuid?: string | null },
): string | null {
  if (requested?.connectionId) {
    return connections.find((item) => item.connectionId === requested.connectionId)?.connectionId ?? null;
  }
  const requestedEventUuid = text(requested?.eventUuid);
  if (requestedEventUuid) {
    return connections.find((item) => item.eventUuid === requestedEventUuid)?.connectionId ?? null;
  }
  return connections.find((item) => item.connectionId === activeConnectionId)?.connectionId
    ?? connections[0]?.connectionId
    ?? null;
}

async function getKv(): Promise<KVNamespace> {
  const { env } = await getCloudflareContext({ async: true });
  if (!env.RACEUPSHOT) throw new Error("RACEUPSHOT KV binding is unavailable.");
  return withTransientKvRetry(env.RACEUPSHOT);
}

function credentialsKey(eventId: string) {
  return `${PREFIX}:event:${eventId}:feibot:credentials`;
}

function snapshotKey(eventId: string) {
  return `${PREFIX}:event:${eventId}:feibot:snapshot`;
}

function connectionsKey(eventId: string) {
  return `${PREFIX}:event:${eventId}:feibot:connections`;
}

function scopedProviderPrefix(eventId: string, eventUuid: string) {
  return `${PREFIX}:live:event:${eventId}:feibot:connection:${encodeURIComponent(eventUuid)}`;
}

export function buildFeibotConnectionId(eventId: string, raceDate: string | null, eventUuid: string) {
  return `${eventId}:${raceDate || "undated"}:${eventUuid}`;
}

function accountCredentialsKey() {
  return `${PREFIX}:integration:feibot:account:credentials`;
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function normalizedRecordKey(value: string): string {
  return value.toLowerCase().replaceAll("_", "");
}

function recordValue(record: JsonRecord, ...keys: string[]): unknown {
  const entries = Object.entries(record);
  for (const requestedKey of keys) {
    const normalizedRequestedKey = normalizedRecordKey(requestedKey);
    const entry = entries.find(([recordKey]) => normalizedRecordKey(recordKey) === normalizedRequestedKey);
    if (entry) return entry[1];
  }
  return undefined;
}

function rows(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.map(asRecord).filter((row): row is JsonRecord => Boolean(row));
  const record = asRecord(value);
  return record ? Object.values(record).map(asRecord).filter((row): row is JsonRecord => Boolean(row)) : [];
}

function responseRows(payload: unknown, ...keys: string[]): JsonRecord[] {
  const record = asRecord(payload);
  if (!record) return rows(payload);
  for (const key of keys) {
    const found = rows(record[key]);
    if (found.length) return found;
  }
  const data = asRecord(record.data);
  if (data) {
    for (const key of keys) {
      const found = rows(data[key]);
      if (found.length) return found;
    }
    const direct = rows(record.data);
    if (direct.length) return direct;
  }
  return [];
}

function deepResponseRows(payload: unknown, ...keys: string[]): JsonRecord[] {
  const direct = responseRows(payload, ...keys);
  if (direct.length) return direct;
  const queue: unknown[] = [payload];
  let fallback: JsonRecord[] = [];
  while (queue.length) {
    const current = queue.shift();
    const record = asRecord(current);
    if (!record) continue;
    for (const key of keys) {
      const found = rows(record[key]);
      if (found.length) return found;
    }
    for (const value of Object.values(record)) {
      if (Array.isArray(value)) {
        const found = rows(value);
        if (found.length > fallback.length) fallback = found;
      } else if (value && typeof value === "object") {
        queue.push(value);
      }
    }
  }
  return fallback;
}

function findDownloadUrl(payload: unknown): string {
  const queue: unknown[] = [payload];
  while (queue.length) {
    const current = queue.shift();
    const record = asRecord(current);
    if (!record) continue;
    const url = text(record.download_url ?? record.downloadUrl);
    if (url) return url;
    queue.push(...Object.values(record).filter((value) => value && typeof value === "object"));
  }
  return "";
}

async function resolveDownloadedPayload(payload: unknown): Promise<unknown> {
  const downloadUrl = findDownloadUrl(payload);
  if (!downloadUrl) return payload;
  const url = new URL(downloadUrl);
  if (url.protocol !== "https:") throw new Error("Feibot returned an insecure participant download URL.");
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Feibot participant download returned HTTP ${response.status}.`);
  // Feibot download URLs sometimes use application/octet-stream and omit a
  // .json suffix even though the body is JSON. Parse the body, not the label.
  const body = (await response.text()).replace(/^\uFEFF/, "").trim();
  if (!body) return payload;
  try { return JSON.parse(body) as unknown; }
  catch { return payload; }
}

function timingPayload(payload: unknown): JsonRecord {
  const root = asRecord(payload) ?? {};
  const data = asRecord(root.data);
  return asRecord(root.timing_rules)
    ?? asRecord(root.timingRules)
    ?? asRecord(data?.timing_rules)
    ?? asRecord(data?.timingRules)
    ?? data
    ?? root;
}

function contestRows(payload: unknown): Array<{ uuid: string; name: string }> {
  const config = timingPayload(payload);
  return responseRows(config, "contests", "contest_map").flatMap((contest, index) => {
    const uuid = text(recordValue(contest, "contest_uuid", "contestUuid", "uuid", "id"));
    const name = text(recordValue(contest, "contest_name", "contestName", "name"));
    return uuid || name ? [{ uuid: uuid || `contest-${index + 1}`, name: name || uuid }] : [];
  });
}

function countLeaderboardRows(payload: unknown): number {
  let count = 0;
  const visit = (value: unknown, depth: number) => {
    if (depth > 8 || value == null) return;
    if (Array.isArray(value)) {
      if (value.some((item) => {
        const record = asRecord(item);
        return Boolean(record && (record.rank !== undefined || record.bib !== undefined || record.athlete_id !== undefined));
      })) {
        count += value.length;
      } else {
        value.forEach((item) => visit(item, depth + 1));
      }
      return;
    }
    const record = asRecord(value);
    if (record) Object.values(record).forEach((item) => visit(item, depth + 1));
  };
  visit(payload, 0);
  return count;
}

function maskAccessKey(accessKey: string): string {
  if (accessKey.length < 9) return "••••••••";
  return `${accessKey.slice(0, 8)}••••${accessKey.slice(-4)}`;
}

export function normalizedParticipantRows(
  source: JsonRecord[],
  eventUuid: string,
): JsonRecord[] {
  return source.map((row, index) => {
    const bib = text(recordValue(row, "bib", "bib_number", "bibNumber", "Unsafe_ParticipantBib", "ParticipantBib"));
    const participantUid = text(
      recordValue(row, "participantUid", "participantUuid", "participant_uuid", "providerParticipantUuid", "uuid", "athlete_id", "id", "id_code"),
    ) || `${eventUuid}-${bib || index + 1}`;
    const chipCode = text(recordValue(row, "chipCode", "chip_code", "chip", "rfid", "transponder", "timingChipCode", "ParticipantChipCode"));
    return {
      ...row,
      participantUid,
      participantUuid: participantUid,
      providerParticipantUuid: text(recordValue(row, "providerParticipantUuid", "participantUuid", "participant_uuid", "uuid", "id")) || participantUid,
      providerEventUuid: text(row.providerEventUuid ?? row.eventUuid ?? row.event_uuid) || eventUuid,
      bib,
      fullName: text(recordValue(row, "fullName", "full_name", "name", "Unsafe_ParticipantName", "ParticipantName")),
      contestId: text(recordValue(row, "contestId", "contest_uuid", "contestUuid", "ContestUUID")),
      contestName: text(recordValue(row, "contestName", "contest_name", "category", "Unsafe_ContestName", "ContestName")),
      chipCode,
      chip_code: chipCode,
      providerParticipantSource: "FEIBOT",
      overallRank: row.overallRank ?? row.overall_rank ?? row.rank,
      genderRank: row.genderRank ?? row.gender_rank,
      ageGroupRank: row.ageGroupRank ?? row.age_group_rank,
      status: row.status ?? row.raceStatus ?? row.result_status,
      lastUpdatedAt: text(row.lastUpdatedAt ?? row.updated_at ?? row.updatedAt) || new Date().toISOString(),
      timingSource: "FEIBOT",
    };
  });
}

function participantMatchKeys(row: JsonRecord): string[] {
  const identity = participantIdentity(row);
  const bib = text(recordValue(row, "bib", "bibNumber", "bib_number", "Unsafe_ParticipantBib"));
  return [...new Set([identity && `id:${identity.toLowerCase()}`, bib && `bib:${bib.toLowerCase()}`].filter(Boolean))];
}

/**
 * Build the canonical Feibot roster from the participant endpoint only.
 * Result/live endpoints can enrich those athletes, but cannot add identities
 * or replace Feibot's participant chip assignment.
 */
export function buildFeibotCanonicalParticipantRows(
  providerRows: JsonRecord[],
  supplementalRows: JsonRecord[],
  eventUuid: string,
): JsonRecord[] {
  const providers = normalizedParticipantRows(providerRows, eventUuid);
  const supplementalByKey = new Map<string, JsonRecord[]>();
  for (const row of supplementalRows) {
    for (const key of participantMatchKeys(row)) {
      const matches = supplementalByKey.get(key) ?? [];
      matches.push(row);
      supplementalByKey.set(key, matches);
    }
  }
  return providers.map((provider) => {
    const matches = participantMatchKeys(provider).flatMap((key) => supplementalByKey.get(key) ?? []);
    const enriched = matches.reduce((current, row) => ({ ...current, ...row }), provider);
    const chipCode = text(recordValue(provider, "chipCode", "chip_code", "chip", "rfid", "transponder", "timingChipCode", "ParticipantChipCode"));
    return {
      ...enriched,
      participantUid: provider.participantUid,
      participantUuid: provider.participantUuid,
      providerParticipantUuid: provider.providerParticipantUuid,
      providerEventUuid: provider.providerEventUuid,
      bib: provider.bib,
      chipCode,
      chip_code: chipCode,
      providerParticipantSource: "FEIBOT",
    };
  });
}

function participantIdentity(row: JsonRecord): string {
  return text(
    row.participantUid
    ?? row.participant_uuid
    ?? row.participantUuid
    ?? row.uuid
    ?? row.athlete_id
    ?? row.bookingId
    ?? row.id_code
    ?? row.id
    ?? row.bib
    ?? row.bib_number
    ?? row.bibNumber,
  );
}

function mergeParticipantRows(...collections: JsonRecord[][]): JsonRecord[] {
  const merged = new Map<string, JsonRecord>();
  let anonymous = 0;
  for (const collection of collections) {
    for (const row of collection) {
      const key = participantIdentity(row) || `anonymous-${anonymous++}`;
      merged.set(key, { ...(merged.get(key) ?? {}), ...row });
    }
  }
  return [...merged.values()];
}

function emptyEndpoint(message = "Not connected"): FeibotEndpointStatus {
  return { ok: false, status: 0, count: 0, message };
}

function emptyConnection(): FeibotAdminConnection {
  return {
    connectionId: null,
    label: null,
    raceDate: null,
    activeConnectionId: null,
    connections: [],
    configured: false,
    connected: false,
    status: "NOT_CONFIGURED",
    accessKeyMasked: null,
    baseUrl: DEFAULT_BASE_URL,
    eventUuid: "",
    eventName: null,
    contests: [],
    counts: { contests: 0, participants: 0, liveRecords: 0, results: 0, leaderboardRows: 0 },
    endpoints: {
      timingRules: emptyEndpoint(),
      participants: emptyEndpoint(),
      live: emptyEndpoint(),
      results: emptyEndpoint(),
      leaderboards: emptyEndpoint(),
    },
    lastConnectedAt: null,
    canonicalBuild: null,
    credentialSource: null,
  };
}

async function hmacSha256Hex(secret: string, value: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return Array.from(new Uint8Array(signature)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function callFeibot(
  credentials: ResolvedFeibotCredentials,
  path: string,
): Promise<{
  ok: boolean;
  status: number;
  data: unknown;
  message: string;
  retryAfterMilliseconds: number | null;
  retryable: boolean;
  providerCode: string | null;
  providerType: string | null;
  outcome: TimingProviderOutcome;
}> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const query = `event_uuid=${credentials.eventUuid}`;
  const signature = await hmacSha256Hex(
    credentials.secretKey,
    `GET${path}${timestamp}${query}`,
  );
  try {
    const response = await fetch(
      `${credentials.baseUrl.replace(/\/$/, "")}${path}?${query}`,
      {
        method: "GET",
        headers: {
          "X-Feibot-AK": credentials.accessKey,
          "X-Feibot-Access-Key": credentials.accessKey,
          "X-Feibot-Timestamp": timestamp,
          "X-Feibot-Signature": signature,
          Accept: "application/json",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      },
    );
    const raw = await response.text();
    let data: unknown = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = null;
    }
    const record = asRecord(data);
    const embeddedError = timingProviderError(data, response.status);
    const providerMessage = embeddedError?.displayMessage || text(record?.message ?? record?.msg);
    const informationalOutcome = embeddedError?.outcome === "no_results" || embeddedError?.outcome === "not_modified";
    return {
      ok: response.ok && (!embeddedError || informationalOutcome),
      status: embeddedError && !informationalOutcome ? embeddedError.status : response.status,
      data,
      message: providerMessage || (response.ok ? "Connected" : `Feibot returned HTTP ${response.status}`),
      retryAfterMilliseconds: parseRetryAfterMilliseconds(response.headers.get("Retry-After")),
      retryable: embeddedError?.retryable ?? (response.status === 429 || response.status >= 500),
      providerCode: embeddedError?.code ?? null,
      providerType: embeddedError?.type ?? null,
      outcome: embeddedError?.outcome ?? (response.ok ? "data" : "error"),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      message: error instanceof Error ? error.message : "Unable to reach Feibot.",
      retryAfterMilliseconds: null,
      retryable: true,
      providerCode: null,
      providerType: null,
      outcome: "error",
    };
  }
}

async function callFeibotWithRateLimitRetry(credentials: ResolvedFeibotCredentials, path: string) {
  let response = await callFeibot(credentials, path);
  for (let attempt = 1; !response.ok && response.retryable && attempt < 3; attempt += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, feibotRetryDelayMilliseconds(attempt, response.retryAfterMilliseconds)));
    response = await callFeibot(credentials, path);
  }
  return response;
}

async function readAccountCredentials(kv: KVNamespace): Promise<StoredFeibotAccountCredentials | null> {
  return kv.get<StoredFeibotAccountCredentials>(accountCredentialsKey(), "json");
}

function connectionCard(entry: StoredFeibotConnectionEntry): FeibotConnectionCard {
  const snapshot = entry.snapshot;
  return {
    connectionId: entry.connectionId,
    label: entry.label,
    eventUuid: entry.credential.eventUuid,
    eventName: snapshot.eventName,
    raceDate: entry.raceDate,
    contests: snapshot.contests,
    configured: true,
    connected: snapshot.connected,
    status: snapshot.status,
    credentialSource: entry.credential.credentialSource ?? "EVENT",
    accessKeyMasked: snapshot.accessKeyMasked,
    lastConnectedAt: snapshot.lastConnectedAt,
    counts: snapshot.counts,
  };
}

function decorateConnection(registry: StoredFeibotConnectionRegistry, entry: StoredFeibotConnectionEntry | null): FeibotAdminConnection {
  const connections = registry.connections.map(connectionCard);
  if (!entry) return { ...emptyConnection(), activeConnectionId: registry.activeConnectionId, connections };
  return {
    ...entry.snapshot,
    connectionId: entry.connectionId,
    label: entry.label,
    raceDate: entry.raceDate,
    activeConnectionId: registry.activeConnectionId,
    connections,
    configured: true,
    credentialSource: entry.credential.credentialSource ?? "EVENT",
  };
}

async function readConnectionRegistry(
  kv: KVNamespace,
  event: { id: string; name: string; dateIso?: string | null },
): Promise<StoredFeibotConnectionRegistry> {
  const registry = await kv.get<StoredFeibotConnectionRegistry>(connectionsKey(event.id), "json");
  if (registry?.schemaVersion === 1 && Array.isArray(registry.connections)) return registry;

  // Backward-compatible one-time migration of the original single connection.
  const [credential, snapshot] = await Promise.all([
    kv.get<StoredFeibotCredentials>(credentialsKey(event.id), "json"),
    kv.get<StoredFeibotSnapshot>(snapshotKey(event.id), "json"),
  ]);
  const raceDate = event.dateIso?.slice(0, 10) || null;
  const migrated: StoredFeibotConnectionRegistry = {
    schemaVersion: 1,
    activeConnectionId: credential ? buildFeibotConnectionId(event.id, raceDate, credential.eventUuid) : null,
    connections: credential ? [{
      connectionId: buildFeibotConnectionId(event.id, raceDate, credential.eventUuid),
      label: snapshot?.eventName || event.name,
      raceDate,
      credential,
      snapshot: snapshot ?? ({
        ...emptyConnection(),
        configured: true,
        accessKeyMasked: credential.accessKey ? maskAccessKey(credential.accessKey) : "Account credentials",
        eventUuid: credential.eventUuid,
        eventName: event.name,
        credentialSource: credential.credentialSource ?? "EVENT",
      } as StoredFeibotSnapshot),
    }] : [],
    updatedAt: new Date().toISOString(),
  };
  if (credential) await kv.put(connectionsKey(event.id), JSON.stringify(migrated));
  return migrated;
}

async function resolveEventCredentials(
  kv: KVNamespace,
  event: { id: string; name: string; dateIso?: string | null },
  connectionId?: string | null,
): Promise<{ entry: StoredFeibotConnectionEntry; registry: StoredFeibotConnectionRegistry; stored: StoredFeibotCredentials; resolved: ResolvedFeibotCredentials; source: "EVENT" | "ACCOUNT" } | null> {
  const registry = await readConnectionRegistry(kv, event);
  const entry = connectionId
    ? registry.connections.find((item) => item.connectionId === connectionId)
    : registry.connections.find((item) => item.connectionId === registry.activeConnectionId) ?? registry.connections[0];
  // Exact selection is deliberate: never fall back to another race's key.
  if (!entry) return null;
  const stored = entry.credential;
  const source = stored.credentialSource ?? (stored.accessKey && stored.secretKey ? "EVENT" : "ACCOUNT");
  if (source === "EVENT") {
    if (!stored.accessKey || !stored.secretKey) return null;
    return { entry, registry, stored, source, resolved: { accessKey: stored.accessKey, secretKey: stored.secretKey, baseUrl: stored.baseUrl, eventUuid: stored.eventUuid, updatedAt: stored.updatedAt } };
  }
  const account = await readAccountCredentials(kv);
  if (!account) return null;
  return { entry, registry, stored, source, resolved: { accessKey: account.accessKey, secretKey: account.secretKey, baseUrl: stored.baseUrl || account.baseUrl, eventUuid: stored.eventUuid, updatedAt: stored.updatedAt } };
}

export async function getFeibotAccountCredentialStatus(): Promise<FeibotAccountCredentialStatus> {
  const kv = await getKv();
  const stored = await readAccountCredentials(kv);
  if (!stored) return { configured: false, accountId: "", accessKeyMasked: null, baseUrl: DEFAULT_BASE_URL, updatedAt: null, lastTestedAt: null, connected: null, message: null };
  return { configured: true, accountId: stored.accountId, accessKeyMasked: maskAccessKey(stored.accessKey), baseUrl: stored.baseUrl, updatedAt: stored.updatedAt, lastTestedAt: stored.lastTestedAt, connected: stored.lastTestSucceeded, message: stored.lastTestMessage };
}

export async function saveFeibotAccountCredentials(input: { accountId: string; accessKey: string; secretKey: string; baseUrl?: string }): Promise<FeibotAccountCredentialStatus> {
  const accountId = text(input.accountId);
  const accessKey = text(input.accessKey);
  const secretKey = text(input.secretKey);
  const baseUrl = DEFAULT_BASE_URL;
  if (!accountId || !accessKey || !secretKey) throw new Error("Enter the Account ID, Access Key and Secret Key.");
  if (!baseUrl.startsWith("https://")) throw new Error("Feibot base URL must use HTTPS.");
  const kv = await getKv();
  await kv.put(accountCredentialsKey(), JSON.stringify({ accountId, accessKey, secretKey, baseUrl, updatedAt: new Date().toISOString(), lastTestedAt: null, lastTestSucceeded: null, lastTestMessage: null } satisfies StoredFeibotAccountCredentials));
  return getFeibotAccountCredentialStatus();
}

export async function testFeibotAccountCredentials(eventUuid: string): Promise<FeibotAccountCredentialStatus> {
  if (!/^[A-Za-z0-9_-]{6,100}$/.test(text(eventUuid))) throw new Error("Select or enter a valid Feibot Event UUID before testing the account key.");
  const kv = await getKv();
  const stored = await readAccountCredentials(kv);
  if (!stored) throw new Error("Save account credentials first.");
  const response = await callFeibot({ ...stored, eventUuid: text(eventUuid) }, "/eventConfigFile/timingRulesGet");
  const updated: StoredFeibotAccountCredentials = { ...stored, lastTestedAt: new Date().toISOString(), lastTestSucceeded: response.ok, lastTestMessage: response.message };
  await kv.put(accountCredentialsKey(), JSON.stringify(updated));
  if (!response.ok) throw new Error(response.message);
  return getFeibotAccountCredentialStatus();
}

export async function deleteFeibotAccountCredentials(): Promise<FeibotAccountCredentialStatus> {
  const kv = await getKv();
  await kv.delete(accountCredentialsKey());
  return getFeibotAccountCredentialStatus();
}

function endpoint(
  response: { ok: boolean; status: number; message: string },
  count: number,
): FeibotEndpointStatus {
  return { ok: response.ok, status: response.status, count, message: response.message };
}

export async function getFeibotAdminConnection(eventIdOrSlug: string, connectionId?: string | null): Promise<FeibotAdminConnection> {
  const event = await getEventBySlug(eventIdOrSlug, { includeUnpublished: true });
  if (!event) throw new Error("Event not found.");
  const kv = await getKv();
  const registry = await readConnectionRegistry(kv, event);
  const entry = connectionId
    ? registry.connections.find((item) => item.connectionId === connectionId) ?? null
    : registry.connections.find((item) => item.connectionId === registry.activeConnectionId) ?? registry.connections[0] ?? null;
  return decorateConnection(registry, entry);
}

/** Read the persisted Feibot participant roster without registration-upload rows. */
export async function getFeibotProviderParticipantRows(eventIdOrSlug: string): Promise<JsonRecord[]> {
  const event = await getEventBySlug(eventIdOrSlug, { includeUnpublished: true });
  if (!event) throw new Error("Event not found.");
  const kv = await getKv();
  const registry = await readConnectionRegistry(kv, event);
  const [payloads, legacyRawPayload] = await Promise.all([
    Promise.all(registry.connections.map((item) =>
      kv.get<unknown>(`${scopedProviderPrefix(event.id, item.credential.eventUuid)}:participants`, "json"),
    )),
    kv.get<unknown>(`${PREFIX}:live:event:${event.id}:providerParticipants`, "json"),
  ]);
  const rawRows = deepResponseRows(legacyRawPayload, "participants", "athletes", "rows", "data").filter((row) =>
    participantIdentity(row) || text(recordValue(row, "bib", "bibNumber", "bib_number", "Unsafe_ParticipantBib")),
  );
  if (rawRows.length) {
    const active = registry.connections.find((item) => item.connectionId === registry.activeConnectionId) ?? registry.connections[0];
    return normalizedParticipantRows(rawRows, active?.credential.eventUuid ?? "feibot");
  }
  return mergeParticipantRows(...payloads.map((payload) =>
    deepResponseRows(payload, "participants", "rows", "data").filter((row) =>
      text(recordValue(row, "providerEventUuid", "eventUuid", "event_uuid"))
      || text(recordValue(row, "providerParticipantSource")) === "FEIBOT",
    ),
  ));
}

export async function disconnectFeibotEvent(eventIdOrSlug: string, connectionId?: string | null): Promise<FeibotAdminConnection> {
  const event = await getEventBySlug(eventIdOrSlug, { includeUnpublished: true });
  if (!event) throw new Error("Event not found.");
  const kv = await getKv();
  const registry = await readConnectionRegistry(kv, event);
  const target = connectionId
    ? registry.connections.find((item) => item.connectionId === connectionId)
    : registry.connections.find((item) => item.connectionId === registry.activeConnectionId);
  if (!target) throw new Error("The selected Feibot connection was not found.");
  const remaining = registry.connections.filter((item) => item.connectionId !== target.connectionId);
  const activeConnectionId = registry.activeConnectionId === target.connectionId
    ? remaining[0]?.connectionId ?? null
    : registry.activeConnectionId;
  const nextRegistry: StoredFeibotConnectionRegistry = { ...registry, connections: remaining, activeConnectionId, updatedAt: new Date().toISOString() };
  const settings = await getEventPlatformSettings(event.id);
  await Promise.all([
    kv.put(connectionsKey(event.id), JSON.stringify(nextRegistry)),
    ...["timing-rules", "participants", "provider-state", "leaderboard", "live-results", "process", "results"].map((suffix) => kv.delete(`${scopedProviderPrefix(event.id, target.credential.eventUuid)}:${suffix}`)),
    !remaining.length ? kv.delete(credentialsKey(event.id)) : Promise.resolve(),
    !remaining.length ? kv.delete(snapshotKey(event.id)) : Promise.resolve(),
    settings ? saveEventPlatformSettings(event.id, {
      live: settings.live,
      mobile: settings.mobile,
      timingIntegration: remaining.length ? {
        ...settings.timingIntegration!,
        providerEventUuid: remaining.find((item) => item.connectionId === activeConnectionId)?.credential.eventUuid ?? remaining[0].credential.eventUuid,
        updatedAt: new Date().toISOString(),
      } : null,
    }) : Promise.resolve(null),
  ]);
  const remainingPayloads = await Promise.all(remaining.map((item) =>
    kv.get<unknown>(`${scopedProviderPrefix(event.id, item.credential.eventUuid)}:participants`, "json"),
  ));
  const remainingRows = mergeParticipantRows(
    ...remainingPayloads.map((payload) => deepResponseRows(payload, "participants", "rows", "data")),
  ).filter((row) => text(recordValue(row, "providerEventUuid", "eventUuid", "event_uuid"))
    || text(recordValue(row, "providerParticipantSource")) === "FEIBOT");
  await kv.put(`${PREFIX}:live:event:${event.id}:participants`, JSON.stringify({ participants: remainingRows }));
  const [hubConfig, courseMaps, previousManifest] = await Promise.all([
    getLiveTrackingHubConfig(event.id),
    getAdminEventCourseMaps(event.id),
    getCanonicalLiveManifest(event.id),
  ]);
  if (remaining.length) {
    await buildAndPublishCanonicalEventVersion({
      eventId: event.id,
      provider: "FEIBOT",
      providerEventUuid: remaining.find((item) => item.connectionId === activeConnectionId)?.credential.eventUuid ?? remaining[0].credential.eventUuid,
      rows: remainingRows,
      eventName: event.name,
      timezone: "Asia/Kolkata",
      status: event.status,
      previousVersion: previousManifest?.activeVersion ?? previousManifest?.version ?? null,
      contestMappings: Object.fromEntries((hubConfig?.contestMappings ?? []).map((mapping) => [mapping.providerContestUuid, { raceUpshotCategoryId: mapping.contestId, name: mapping.contestId }])),
      courseMaps: courseMaps?.maps ?? [],
    });
  } else {
    // The canonical publisher requires a provider UUID. With no connections
    // left, remove the active public snapshot instead of attempting an invalid
    // empty-provider build after the credential has already been deleted.
    await resetCanonicalLiveEvent(event.id, target.credential.eventUuid);
  }
  return decorateConnection(nextRegistry, remaining.find((item) => item.connectionId === activeConnectionId) ?? remaining[0] ?? null);
}

export async function verifyFeibotEventConnection(eventIdOrSlug: string, connectionId?: string | null): Promise<FeibotAdminConnection> {
  const event = await getEventBySlug(eventIdOrSlug, { includeUnpublished: true });
  if (!event) throw new Error("Event not found.");
  const kv = await getKv();
  const credentialRecord = await resolveEventCredentials(kv, event, connectionId);
  if (!credentialRecord) throw new Error("Save an Event Key or link the Account Key to this event first.");
  const current = credentialRecord.entry.snapshot;
  const response = await callFeibot(credentialRecord.resolved, "/eventConfigFile/timingRulesGet");
  await persistVerifiedConnectionSnapshot({ event, kv, credentialRecord, current, response });
  // Verification state is authoritative; a best-effort audit write must not
  // turn a successful provider check into a failed button action.
  await writeOperationLog(event.id, "VERIFY_CONNECTION", response.ok ? "SUCCESS" : "ERROR", response.message).catch(() => undefined);
  return getFeibotAdminConnection(event.id, credentialRecord.entry.connectionId);
}

async function persistVerifiedConnectionSnapshot(input: {
  event: { id: string; name: string };
  kv: KVNamespace;
  credentialRecord: NonNullable<Awaited<ReturnType<typeof resolveEventCredentials>>>;
  current: StoredFeibotSnapshot | null;
  response: Awaited<ReturnType<typeof callFeibot>>;
}): Promise<StoredFeibotSnapshot> {
  const { event, kv, credentialRecord, current, response } = input;
  const contests = response.ok ? contestRows(response.data) : current?.contests ?? [];
  const next: StoredFeibotSnapshot = {
    ...(current ?? emptyConnection()),
    configured: true,
    connected: response.ok,
    status: response.ok ? "CONNECTED" : response.status === 401 || response.status === 403 ? "AUTH_ERROR" : "FAILED",
    accessKeyMasked: maskAccessKey(credentialRecord.resolved.accessKey),
    baseUrl: DEFAULT_BASE_URL,
    eventUuid: credentialRecord.resolved.eventUuid,
    eventName: current?.eventName ?? event.name,
    contests,
    counts: { ...(current?.counts ?? emptyConnection().counts), contests: contests.length },
    endpoints: { ...(current?.endpoints ?? emptyConnection().endpoints), timingRules: endpoint(response, contests.length) },
    lastConnectedAt: response.ok ? new Date().toISOString() : current?.lastConnectedAt ?? null,
    canonicalBuild: current?.canonicalBuild ?? null,
    credentialSource: credentialRecord.source,
  };
  const updatedEntry = { ...credentialRecord.entry, snapshot: next };
  const registry: StoredFeibotConnectionRegistry = {
    ...credentialRecord.registry,
    activeConnectionId: updatedEntry.connectionId,
    connections: credentialRecord.registry.connections.map((item) => item.connectionId === updatedEntry.connectionId ? updatedEntry : item),
    updatedAt: new Date().toISOString(),
  };
  await Promise.all([
    kv.put(connectionsKey(event.id), JSON.stringify(registry)),
    response.ok
      ? kv.put(`${scopedProviderPrefix(event.id, credentialRecord.resolved.eventUuid)}:timing-rules`, JSON.stringify(response.data))
      : Promise.resolve(),
  ]);
  return next;
}

export async function connectFeibotEvent(
  eventIdOrSlug: string,
  input?: { accessKey?: string; secretKey?: string; baseUrl?: string; eventUuid?: string; credentialSource?: "EVENT" | "ACCOUNT"; connectionId?: string; label?: string },
): Promise<FeibotAdminConnection> {
  const event = await getEventBySlug(eventIdOrSlug, { includeUnpublished: true });
  if (!event) throw new Error("Event not found.");
  const kv = await getKv();
  const settings = await getEventPlatformSettings(event.id);
  const useRaceUpshotEngine = settings?.timingIntegration?.timingResultSource === "RACE_UPSHOT_ENGINE";
  const [registry, account] = await Promise.all([readConnectionRegistry(kv, event), readAccountCredentials(kv)]);
  const selectedConnectionId = chooseFeibotConnectionId(
    registry.connections.map((item) => ({ connectionId: item.connectionId, eventUuid: item.credential.eventUuid })),
    registry.activeConnectionId,
    input,
  );
  const existingEntry = selectedConnectionId
    ? registry.connections.find((item) => item.connectionId === selectedConnectionId)
    : undefined;
  if (input?.connectionId && !existingEntry) throw new Error("The selected Feibot connection was not found.");
  const stored = existingEntry?.credential;
  const suppliedAccessKey = text(input?.accessKey);
  const suppliedSecretKey = text(input?.secretKey);
  if (Boolean(suppliedAccessKey) !== Boolean(suppliedSecretKey)) throw new Error("Enter both the Feibot Access Key and Secret Key.");
  const storedSource = stored?.credentialSource ?? (stored?.accessKey && stored?.secretKey ? "EVENT" : null);
  const credentialSource = chooseFeibotCredentialSource({ requested: input?.credentialSource, suppliedEventKey: Boolean(suppliedAccessKey), storedSource, accountConfigured: Boolean(account) });
  const eventUuid = text(input?.eventUuid) || stored?.eventUuid || "";
  const baseUrl = DEFAULT_BASE_URL;
  const credentials: ResolvedFeibotCredentials = {
    accessKey: credentialSource === "ACCOUNT" ? account?.accessKey ?? "" : suppliedAccessKey || stored?.accessKey || "",
    secretKey: credentialSource === "ACCOUNT" ? account?.secretKey ?? "" : suppliedSecretKey || stored?.secretKey || "",
    baseUrl,
    eventUuid,
    updatedAt: new Date().toISOString(),
  };
  if (credentialSource === "ACCOUNT" && !account) throw new Error("Save Feibot account credentials before selecting Account Credentials.");
  if (!credentials.accessKey || !credentials.secretKey) throw new Error("Enter the Feibot Access Key and Secret Key.");
  if (!credentials.baseUrl.startsWith("https://")) throw new Error("Feibot base URL must use HTTPS.");
  if (!/^[A-Za-z0-9_-]{6,100}$/.test(credentials.eventUuid)) throw new Error("Enter a valid Feibot event UUID.");

  const timingRules = await callFeibot(credentials, "/eventConfigFile/timingRulesGet");
  if (!timingRules.ok) {
    const status = timingRules.status === 401 || timingRules.status === 403 ? "AUTH_ERROR" : "FAILED";
    throw new Error(`${status === "AUTH_ERROR" ? "Feibot rejected the key or event UUID" : "Feibot connection failed"}: ${timingRules.message}`);
  }

  const [
    participantsResponse,
    liveResultsResponse,
    processResponse,
    resultsResponse,
    leaderboardResponse,
  ] = await Promise.all([
    callFeibot(credentials, "/temporary/participantsGetAll"),
    callFeibot(credentials, "/temporary/temporary_ResultDataGetAll"),
    callFeibot(credentials, "/api/processQuery"),
    callFeibot(credentials, "/finishResultGetAll"),
    callFeibot(credentials, "/api/leaderboardQuery"),
  ]);
  const [participantPayload, liveResultPayload, finalResultPayload, leaderboardPayload] = await Promise.all([
    participantsResponse.ok
      ? resolveDownloadedPayload(participantsResponse.data).catch(() => participantsResponse.data)
      : participantsResponse.data,
    liveResultsResponse.ok
      ? resolveDownloadedPayload(liveResultsResponse.data).catch(() => liveResultsResponse.data)
      : liveResultsResponse.data,
    resultsResponse.ok
      ? resolveDownloadedPayload(resultsResponse.data).catch(() => resultsResponse.data)
      : resultsResponse.data,
    leaderboardResponse.ok
      ? resolveDownloadedPayload(leaderboardResponse.data).catch(() => leaderboardResponse.data)
      : leaderboardResponse.data,
  ]);
  const contests = contestRows(timingRules.data);
  const providerParticipantRows = deepResponseRows(
    participantPayload,
    "participants",
    "athletes",
    "rows",
    "data",
  );
  const liveResultRows = deepResponseRows(
    liveResultPayload,
    "results",
    "participants",
    "athletes",
    "rows",
    "data",
  );
  const processRows = deepResponseRows(
    processResponse.data,
    "process",
    "participants",
    "athletes",
    "rows",
    "data",
  );
  const finalResultRows = deepResponseRows(
    finalResultPayload,
    "results",
    "participants",
    "athletes",
    "rows",
    "data",
  );
  const leaderboardDataRows = deepResponseRows(
    leaderboardPayload,
    "leaderboard",
    "rankings",
    "participants",
    "athletes",
    "rows",
    "data",
  );
  const existingParticipantPayload = useRaceUpshotEngine
    ? await kv.get<unknown>(`${PREFIX}:live:event:${event.id}:participants`, "json")
    : null;
  const existingParticipantRows = deepResponseRows(existingParticipantPayload, "participants", "rows", "data");
  const supplementalRows = useRaceUpshotEngine
    ? existingParticipantRows
    : mergeParticipantRows(liveResultRows, processRows, finalResultRows, leaderboardDataRows);
  const providerCanonicalRows = buildFeibotCanonicalParticipantRows(
    providerParticipantRows,
    supplementalRows,
    credentials.eventUuid,
  );
  // Registration data (waiver, contact, athlete band, etc.) may enrich a
  // provider athlete, but uploaded timing identities and chip codes are never
  // admitted into the Feibot canonical roster.
  const selectedParticipantRows = await applyParticipantRegistrationEnrichment(
    kv,
    event.id,
    providerCanonicalRows,
  );
  const siblingParticipantPayloads = await Promise.all(registry.connections
    .filter((item) => item.connectionId !== existingEntry?.connectionId)
    .map((item) => kv.get<unknown>(`${scopedProviderPrefix(event.id, item.credential.eventUuid)}:participants`, "json")));
  const participantRows = mergeParticipantRows(
    ...siblingParticipantPayloads.map((payload) => deepResponseRows(payload, "participants", "rows", "data").filter((row) =>
      text(recordValue(row, "providerEventUuid", "eventUuid", "event_uuid"))
      || text(recordValue(row, "providerParticipantSource")) === "FEIBOT",
    )),
    selectedParticipantRows,
  );
  const liveRows = mergeParticipantRows(liveResultRows, processRows);
  const leaderboardRows = Math.max(
    leaderboardDataRows.length,
    countLeaderboardRows(leaderboardPayload),
  );
  const connectedAt = new Date().toISOString();
  const snapshot: StoredFeibotSnapshot = {
    connectionId: existingEntry?.connectionId ?? null,
    label: text(input?.label) || null,
    raceDate: event.dateIso.slice(0, 10),
    activeConnectionId: existingEntry?.connectionId ?? null,
    connections: [],
    configured: true,
    connected: true,
    // timingRulesGet already authenticated the event key above. Optional data
    // endpoints can be disabled for an event/account without making the
    // provider connection itself partial.
    status: "CONNECTED",
    accessKeyMasked: maskAccessKey(credentials.accessKey),
    baseUrl: credentials.baseUrl,
    eventUuid: credentials.eventUuid,
    eventName: text((timingPayload(timingRules.data).event_name) ?? (asRecord(timingRules.data)?.event_name)) || event.name,
    contests,
    counts: {
      contests: contests.length,
      participants: selectedParticipantRows.length,
      liveRecords: liveRows.length,
      results: finalResultRows.length,
      leaderboardRows,
    },
    endpoints: {
      timingRules: endpoint(timingRules, contests.length),
      participants: endpoint(participantsResponse, selectedParticipantRows.length),
      live: {
        ok: liveResultsResponse.ok || processResponse.ok,
        status: liveResultsResponse.ok ? liveResultsResponse.status : processResponse.status,
        count: liveRows.length,
        message: liveResultsResponse.ok
          ? liveResultsResponse.message
          : processResponse.ok
            ? processResponse.message
            : [liveResultsResponse.message, processResponse.message].filter(Boolean).join(" · "),
      },
      results: endpoint(resultsResponse, finalResultRows.length),
      leaderboards: endpoint(leaderboardResponse, leaderboardRows),
    },
    lastConnectedAt: connectedAt,
    canonicalBuild: null,
    credentialSource,
  };

  const storedLink: StoredFeibotCredentials = credentialSource === "ACCOUNT"
    ? { credentialSource, baseUrl: credentials.baseUrl, eventUuid: credentials.eventUuid, updatedAt: credentials.updatedAt }
    : { credentialSource, accessKey: credentials.accessKey, secretKey: credentials.secretKey, baseUrl: credentials.baseUrl, eventUuid: credentials.eventUuid, updatedAt: credentials.updatedAt };

  const parsedRules = parseFeibotTimingRules(timingRules.data);
  const providerDate = parsedRules.contests.find((contest) => contest.raceDate)?.raceDate
    ?? parsedRules.contests.find((contest) => contest.gunStartAt)?.gunStartAt
    ?? null;
  const parsedProviderDate = providerDate ? new Date(providerDate) : null;
  const raceDate = providerDate && /^\d{4}-\d{2}-\d{2}/.test(providerDate)
    ? providerDate.slice(0, 10)
    : parsedProviderDate && !Number.isNaN(parsedProviderDate.getTime())
      ? parsedProviderDate.toISOString().slice(0, 10)
      : event.dateIso.slice(0, 10);
  const connectionId = existingEntry?.connectionId ?? buildFeibotConnectionId(event.id, raceDate, credentials.eventUuid);
  const label = text(input?.label) || snapshot.eventName || contests.map((contest) => contest.name).join(" / ") || credentials.eventUuid;
  snapshot.connectionId = connectionId;
  snapshot.label = label;
  snapshot.raceDate = raceDate;
  snapshot.activeConnectionId = connectionId;
  snapshot.connections = [];
  const entry: StoredFeibotConnectionEntry = { connectionId, label, raceDate, credential: storedLink, snapshot };
  const nextRegistry: StoredFeibotConnectionRegistry = {
    schemaVersion: 1,
    activeConnectionId: connectionId,
    connections: [...registry.connections.filter((item) => item.connectionId !== connectionId), entry],
    updatedAt: connectedAt,
  };
  const scopedPrefix = scopedProviderPrefix(event.id, credentials.eventUuid);
  const writes: Promise<unknown>[] = [
    kv.put(connectionsKey(event.id), JSON.stringify(nextRegistry)),
    // Keep legacy selected mirrors during migration for older server paths.
    kv.put(credentialsKey(event.id), JSON.stringify(storedLink)),
    kv.put(snapshotKey(event.id), JSON.stringify(snapshot)),
    kv.put(`${PREFIX}:live:event:${event.id}:feibot:timing-rules`, JSON.stringify(timingRules.data)),
    kv.put(`${scopedPrefix}:timing-rules`, JSON.stringify(timingRules.data)),
    kv.put(`${scopedPrefix}:participants`, JSON.stringify({ participants: selectedParticipantRows })),
    kv.put(`${scopedPrefix}:provider-state`, JSON.stringify(snapshot)),
    kv.put(`${scopedPrefix}:leaderboard`, JSON.stringify(leaderboardPayload)),
    kv.put(`${scopedPrefix}:live-results`, JSON.stringify(liveResultPayload)),
    kv.put(`${scopedPrefix}:process`, JSON.stringify(processResponse.data)),
    kv.put(`${scopedPrefix}:results`, JSON.stringify(finalResultPayload)),
    kv.put(`${PREFIX}:live:event:${event.id}:providerParticipants`, JSON.stringify(participantPayload)),
    kv.put(`${PREFIX}:live:event:${event.id}:providerState`, JSON.stringify(snapshot)),
    kv.put(`${PREFIX}:live:event:${event.id}:feibot:leaderboard`, JSON.stringify(leaderboardPayload)),
    kv.put(`${PREFIX}:live:event:${event.id}:feibot:live-results`, JSON.stringify(liveResultPayload)),
    kv.put(`${PREFIX}:live:event:${event.id}:feibot:process`, JSON.stringify(processResponse.data)),
    kv.put(`${PREFIX}:live:event:${event.id}:feibot:results`, JSON.stringify(finalResultPayload)),
    kv.put(`${PREFIX}:live:event:${event.id}:updated`, connectedAt),
  ];
  if (!useRaceUpshotEngine) {
    writes.push(
      kv.put(`${PREFIX}:live:event:${event.id}:leaderboard`, JSON.stringify(leaderboardPayload)),
      kv.put(`${PREFIX}:live:event:${event.id}:results`, JSON.stringify(finalResultPayload)),
    );
  }
  if (participantRows.length) {
    writes.push(kv.put(`${PREFIX}:live:event:${event.id}:participants`, JSON.stringify({ participants: participantRows })));
  }
  await Promise.all(writes);
  // Feibot is an ingestion source. The versioned canonical snapshot is the only
  // live dataset exposed to web/mobile once it exists.
  if (participantsResponse.ok && providerParticipantRows.length > 0) {
    const [hubConfig, courseMaps, previousManifest] = await Promise.all([
      getLiveTrackingHubConfig(event.id),
      getAdminEventCourseMaps(event.id),
      getCanonicalLiveManifest(event.id),
    ]);
    const contestMappings = Object.fromEntries((hubConfig?.contestMappings ?? []).map((mapping) => [
      mapping.providerContestUuid,
      { raceUpshotCategoryId: mapping.contestId, name: mapping.contestId },
    ]));
    const canonical = await buildAndPublishCanonicalEventVersion({
      eventId: event.id,
      provider: "FEIBOT",
      providerEventUuid: credentials.eventUuid,
      rows: participantRows,
      eventName: event.name,
      timezone: "Asia/Kolkata",
      status: event.status,
      previousVersion: previousManifest?.activeVersion ?? previousManifest?.version ?? null,
      contestMappings,
      courseMaps: courseMaps?.maps ?? [],
    });
    snapshot.canonicalBuild = {
      version: canonical.activeVersion ?? canonical.version ?? "",
      builtAt: canonical.updatedAt ?? canonical.publishedAt ?? canonical.builtAt ?? connectedAt,
      completeBuildValid: canonical.completeBuildValid,
    };
    entry.snapshot = snapshot;
    const publishedRegistry = { ...nextRegistry, connections: nextRegistry.connections.map((item) => item.connectionId === connectionId ? entry : item), updatedAt: new Date().toISOString() };
    await Promise.all([
      kv.put(snapshotKey(event.id), JSON.stringify(snapshot)),
      kv.put(connectionsKey(event.id), JSON.stringify(publishedRegistry)),
    ]);
  } else if (participantsResponse.ok) {
    snapshot.status = "PARTIAL_FAILURE";
    snapshot.endpoints.participants = {
      ...snapshot.endpoints.participants,
      ok: false,
      count: 0,
      message: "Feibot returned no readable participant rows; the previous canonical version was preserved.",
    };
    entry.snapshot = snapshot;
    const preservedRegistry = { ...nextRegistry, connections: nextRegistry.connections.map((item) => item.connectionId === connectionId ? entry : item), updatedAt: new Date().toISOString() };
    await Promise.all([
      kv.put(snapshotKey(event.id), JSON.stringify(snapshot)),
      kv.put(connectionsKey(event.id), JSON.stringify(preservedRegistry)),
    ]);
  }
  if (contests.length) await mergeEventCategories(event.id, contests.map((contest) => contest.name));

  if (settings) {
    await saveEventPlatformSettings(event.id, {
      live: settings.live,
      mobile: settings.mobile,
      timingIntegration: {
        ...(settings.timingIntegration ?? {
          provider: "FEIBOT" as const,
          enabled: true,
          baseUrl: credentials.baseUrl,
          accountReference: "FEIBOT_EVENT_KEY",
          providerEventUuid: credentials.eventUuid,
          contestMappings: [],
          syncParticipants: true,
          syncContests: true,
          syncTimingPoints: true,
          syncRealtime: true,
          syncLeaderboards: true,
          syncResults: true,
          participantSyncIntervalSeconds: 300,
          realtimeSyncIntervalSeconds: 10,
          leaderboardSyncIntervalSeconds: 15,
          resultSyncIntervalSeconds: 60,
          enabledForWeb: true,
          enabledForMobile: true,
          timingResultSource: "FEIBOT_PROCESSED" as const,
          resultTimeMode: "CHIP" as const,
          passageGapMs: 5_000,
          readerDetectionTimeoutMs: {},
          status: "CONNECTED" as const,
          lastTestedAt: null,
          lastSuccessfulSyncAt: null,
          updatedAt: connectedAt,
        }),
        enabled: true,
        baseUrl: credentials.baseUrl,
        providerEventUuid: credentials.eventUuid,
        status: snapshot.status === "CONNECTED" ? "READY" : "PARTIAL_FAILURE",
        lastTestedAt: connectedAt,
        lastSuccessfulSyncAt: connectedAt,
        updatedAt: connectedAt,
      },
    });
  }

  return getFeibotAdminConnection(event.id, connectionId);
}

export type FeibotOperationName =
  | "IMPORT_TIMING_RULES" | "REBUILD_SPLIT_INDEX" | "VALIDATE_KV" | "REFRESH_STATUS"
  | "TEST_TIMING_RULES" | "TEST_PARTICIPANTS" | "FULL_REBUILD" | "HARD_RESET_SYNC"
  | "DELETE_IMPORTED_DATA" | "CANONICAL_SUMMARY" | "CLEAR_LOGS" | "VERIFY_CONNECTION"
  | "FETCH_FEIBOT_READS" | "FETCH_FEIBOT_RESULTS";

export interface FeibotOperationLog {
  id: string;
  eventId: string;
  operation: string;
  status: "INFO" | "SUCCESS" | "WARNING" | "ERROR";
  message: string;
  createdAt: string;
}

export interface ImportedFeibotRules {
  contests: Array<{ uuid: string; name: string; raceDate: string | null; gunStartAt: string | null }>;
  legs: HubLeg[];
  splits: HubSplit[];
  timingPoints: HubTimingPoint[];
}

const namedRows = (payload: unknown, aliases: string[]): JsonRecord[] => {
  const wanted = new Set(aliases.map((item) => item.toLowerCase().replaceAll("_", "")));
  const found: JsonRecord[] = [];
  const queue: unknown[] = [payload];
  while (queue.length) {
    const current = queue.shift();
    if (Array.isArray(current)) { queue.push(...current); continue; }
    const record = asRecord(current);
    if (!record) continue;
    for (const [key, value] of Object.entries(record)) {
      const normalized = key.toLowerCase().replaceAll("_", "");
      if (wanted.has(normalized)) found.push(...rows(value));
      if (value && typeof value === "object") queue.push(value);
    }
  }
  return found;
};

const numeric = (record: JsonRecord, ...keys: string[]): number | null => {
  for (const key of keys) {
    const value = recordValue(record, key);
    if (value !== "" && value !== null && value !== undefined && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
};

const recordText = (record: JsonRecord, ...keys: string[]) => {
  for (const key of keys) { const value = text(recordValue(record, key)); if (value) return value; }
  return "";
};

const recordBoolean = (record: JsonRecord, ...keys: string[]): boolean | undefined => {
  for (const key of keys) {
    const value = recordValue(record, key);
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    const normalized = text(value).toLowerCase();
    if (["true", "yes", "1"].includes(normalized)) return true;
    if (["false", "no", "0"].includes(normalized)) return false;
  }
  return undefined;
};

const inferredLegType = (name: string): HubLeg["type"] => {
  const value = name.toLowerCase();
  if (/transition|\bt1\b|\bt2\b/.test(value)) return "TRANSITION";
  if (/swim/.test(value)) return "SWIM";
  if (/bike|cycle/.test(value)) return "BIKE";
  if (/run/.test(value)) return "RUN";
  return "OTHER";
};

export function parseFeibotTimingRules(payload: unknown): ImportedFeibotRules {
  const contests = contestRows(payload).map((contest) => {
    const source = namedRows(payload, ["contests", "contest_map"]).find((row) => recordText(row, "contest_uuid", "contestUuid", "uuid", "id") === contest.uuid) ?? {};
    const gunStarts = asRecord(recordValue(source, "gun_start_times", "gunStartTimes"));
    return {
      uuid: contest.uuid,
      name: contest.name,
      raceDate: recordText(source, "race_date", "raceDate", "date") || null,
      gunStartAt: recordText(source, "start_time", "startTime", "gun_start", "gunStartTimestamp") || (gunStarts ? recordText(gunStarts, "default") : "") || null,
    };
  });
  const splitRows = namedRows(payload, ["splits", "split_index", "splitIndex", "split_list"]);
  const deviceRows = namedRows(payload, ["devices", "readers", "timing_devices"]);
  const pointRows = namedRows(payload, ["timing_points", "timingPoints", "timing_point_list", "timingPointList"]);
  const timingPoints = pointRows.flatMap((row, index): HubTimingPoint[] => {
    const id = recordText(row, "timing_point_uuid", "timingPointUuid", "point_uuid", "uuid", "id");
    if (!id) return [];
    const name = recordText(row, "display_name", "timing_point_name", "timingPointName", "name", "short_name") || `Timing Point ${index + 1}`;
    const lower = name.toLowerCase();
    const type: HubTimingPoint["type"] = /finish/.test(lower) ? "FINISH" : /start/.test(lower) ? "START" : "SPLIT";
    const course: HubTimingPoint["course"] = type === "FINISH" ? "FINISH" : /swim/.test(lower) ? "SWIM" : /bike|cycle/.test(lower) ? "BIKE" : /run/.test(lower) ? "RUN" : "SPLIT";
    const readerValues = recordValue(row, "reader_uuids", "readerUuids", "readers");
    const explicitReaders = Array.isArray(readerValues) ? readerValues.map(text).filter(Boolean) : text(readerValues).split(",").map((item) => item.trim()).filter(Boolean);
    const deviceReaders = deviceRows
      .filter((device) => recordText(device, "timing_point_uuid", "timingPointUuid") === id)
      .map((device) => recordText(device, "uuid", "device_uuid", "deviceUuid"))
      .filter(Boolean);
    const linkedDistances = splitRows
      .filter((split) => recordText(split, "timing_point_uuid", "timingPointUuid", "timing_point_id") === id)
      .map((split) => numeric(split, "distance_from_start", "distanceFromStart", "km", "km_marking", "distance_km", "distanceKm"))
      .filter((value): value is number => value !== null);
    return [{
      id,
      name,
      type,
      order: Math.max(0, numeric(row, "split_index", "order", "index") ?? index),
      readerUuids: [...new Set([...explicitReaders, ...deviceReaders])],
      course,
      km: numeric(row, "km", "km_marking", "distance_km", "distanceKm") ?? (linkedDistances.length ? Math.min(...linkedDistances) : null),
      visible: true,
    }];
  });
  const legRows = namedRows(payload, ["legs", "sport_legs", "race_legs"]);
  let legs = legRows.flatMap((row, index): HubLeg[] => {
    const name = recordText(row, "display_name", "leg_name", "legName", "name", "type") || `Leg ${index + 1}`;
    const id = recordText(row, "leg_uuid", "legUuid", "uuid", "id") || `leg-${index + 1}`;
    const contestUuid = recordText(row, "contest_uuid", "contestUuid");
    const linkedSplits = splitRows.filter((split) => !contestUuid || recordText(split, "contest_uuid", "contestUuid") === contestUuid);
    const providerSport = linkedSplits.map((split) => recordText(split, "type_of_sport", "typeOfSport")).find(Boolean) ?? "";
    const linkedDistances = linkedSplits
      .map((split) => numeric(split, "distance_from_start", "distanceFromStart", "km", "distance_km", "distanceKm"))
      .filter((value): value is number => value !== null);
    return [{
      id,
      name,
      type: inferredLegType(name) !== "OTHER" ? inferredLegType(name) : inferredLegType(providerSport),
      order: Math.max(0, numeric(row, "order", "leg_index", "index") ?? index),
      distanceKm: numeric(row, "distance_km", "distanceKm", "km") ?? (linkedDistances.length ? Math.max(...linkedDistances) : null),
      cutoffSeconds: numeric(row, "cutoff_seconds", "cutoffSeconds"),
    }];
  });
  if (!legs.length && contests.length) legs = contests.map((contest, index) => ({ id: `leg-${contest.uuid}`, name: contest.name, type: inferredLegType(contest.name), order: index, distanceKm: null, cutoffSeconds: null }));
  if (!legs.length) legs = [{ id: "leg-overall", name: "Overall", type: "OTHER", order: 0, distanceKm: null, cutoffSeconds: null }];
  const splits = splitRows.flatMap((row, index): HubSplit[] => {
    const id = recordText(row, "split_uuid", "splitUuid", "uuid", "id");
    if (!id) return [];
    const importedName = recordText(row, "split_name", "splitName", "display_name", "name") || `Split ${index + 1}`;
    const rawLegId = recordText(row, "leg_uuid", "legUuid", "leg_id", "legId");
    const namedSport = inferredLegType(importedName);
    const legId = legs.some((leg) => leg.id === rawLegId)
      ? rawLegId
      : legs.find((leg) => leg.type === namedSport)?.id ?? legs[0].id;
    return [{ id, name: importedName, importedName, legId, order: Math.max(0, numeric(row, "split_index", "splitIndex", "order", "index") ?? index), distanceKm: numeric(row, "distance_from_start", "distanceFromStart", "km", "km_marking", "distance_km", "distanceKm"), timingPointId: recordText(row, "timing_point_uuid", "timingPointUuid", "timing_point_id") || null, passage: Math.max(1, numeric(row, "calculated_timing_point_use_pass_num", "calculatedTimingPointUsePassNum", "passage", "pass", "lap") ?? 1), cutoffSeconds: numeric(row, "cutoff_seconds", "cutoffSeconds"), providerContestUuid: recordText(row, "contest_uuid", "contestUuid") || null, isFinalRaceSplit: recordBoolean(row, "is_final_race_split", "isFinalRaceSplit", "is_race_finish", "isRaceFinish"), visible: true }];
  });
  const expandedFlow = expandFeibotSportLegs(legs, splits);
  return {
    contests: contests.filter((item, index, all) => all.findIndex((other) => other.uuid === item.uuid) === index),
    legs: expandedFlow.legs.filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index),
    splits: normalizeFinalRaceSplits(expandedFlow.splits.filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index)),
    timingPoints: timingPoints.filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index),
  };
}

function operationLogKey(eventId: string, id: string) { return `${PREFIX}:live:event:${eventId}:admin-log:${id}`; }
function operationLogIndexKey(eventId: string) { return `${PREFIX}:live:event:${eventId}:admin-log:index`; }
function operationRecentLogsKey(eventId: string) { return `${PREFIX}:live:event:${eventId}:admin-log:recent`; }

async function writeOperationLog(eventId: string, operation: string, status: FeibotOperationLog["status"], message: string) {
  const kv = await getKv();
  const log: FeibotOperationLog = { id: crypto.randomUUID(), eventId, operation, status, message, createdAt: new Date().toISOString() };
  const [index, recent] = await Promise.all([
    kv.get<string[]>(operationLogIndexKey(eventId), "json"),
    kv.get<FeibotOperationLog[]>(operationRecentLogsKey(eventId), "json"),
  ]);
  const next = [log.id, ...(index ?? []).filter((id) => id !== log.id)].slice(0, 500);
  const nextRecent = [log, ...(Array.isArray(recent) ? recent : []).filter((item) => item.id !== log.id)].slice(0, 100);
  await Promise.all([
    kv.put(operationLogKey(eventId, log.id), JSON.stringify(log), { expirationTtl: 60 * 60 * 24 * 30 }),
    kv.put(operationLogIndexKey(eventId), JSON.stringify(next)),
    kv.put(operationRecentLogsKey(eventId), JSON.stringify(nextRecent)),
  ]);
  return log;
}

async function operationLogs(eventId: string): Promise<FeibotOperationLog[]> {
  const kv = await getKv();
  const recent = await kv.get<FeibotOperationLog[]>(operationRecentLogsKey(eventId), "json");
  if (Array.isArray(recent)) return recent.slice(0, 100);
  const index = (await kv.get<string[]>(operationLogIndexKey(eventId), "json")) ?? [];
  // One-time migration for older event logs. Keep this deliberately bounded;
  // loading the former 500-key index overwhelmed Wrangler's remote KV bridge.
  const logs = await Promise.all(index.slice(0, 100).map((id) => kv.get<FeibotOperationLog>(operationLogKey(eventId, id), "json")));
  const available = logs.filter((item): item is FeibotOperationLog => Boolean(item));
  await kv.put(operationRecentLogsKey(eventId), JSON.stringify(available));
  return available;
}

async function importedRules(eventId: string, providerEventUuid?: string | null) {
  const kv = await getKv();
  const event = providerEventUuid ? null : await getEventBySlug(eventId, { includeUnpublished: true });
  const selected = !providerEventUuid && event ? await resolveEventCredentials(kv, event) : null;
  const selectedEventUuid = text(providerEventUuid) || selected?.resolved.eventUuid || "";
  const raw = selectedEventUuid
    ? await kv.get<unknown>(`${scopedProviderPrefix(eventId, selectedEventUuid)}:timing-rules`, "json")
      ?? await kv.get<unknown>(`${PREFIX}:live:event:${eventId}:feibot:timing-rules`, "json")
    : await kv.get<unknown>(`${PREFIX}:live:event:${eventId}:feibot:timing-rules`, "json");
  return raw ? parseFeibotTimingRules(raw) : { contests: [], legs: [], splits: [], timingPoints: [] };
}

export type FeibotContestGunStart = ImportedFeibotRules["contests"][number];

/** Read the official contest-level gun starts from the persisted Feibot rules. */
export async function getFeibotContestGunStarts(eventId: string): Promise<FeibotContestGunStart[]> {
  const connection = await getFeibotAdminConnection(eventId);
  const rules = await importedRules(eventId, connection.eventUuid);
  return rules.contests.filter((contest) => contest.name && contest.gunStartAt);
}

const normalizedContestName = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Match a registration category to its mapped Feibot contest gun start. */
export function resolveFeibotContestGunStart(
  category: string,
  mappings: LiveTrackingHubConfig["contestMappings"],
  contests: ImportedFeibotRules["contests"],
): FeibotContestGunStart | null {
  const wanted = normalizedContestName(category);
  if (!wanted) return null;
  const mappedUuid = mappings.find((mapping) => normalizedContestName(mapping.contestId) === wanted)?.providerContestUuid;
  const match = (mappedUuid ? contests.find((contest) => contest.uuid === mappedUuid) : null)
    ?? contests.find((contest) => normalizedContestName(contest.name) === wanted)
    ?? null;
  return match?.gunStartAt && Number.isFinite(Date.parse(match.gunStartAt)) ? match : null;
}

export function reconcileFeibotContestMappings(
  mappings: LiveTrackingHubConfig["contestMappings"],
  contests: ImportedFeibotRules["contests"],
): LiveTrackingHubConfig["contestMappings"] {
  const providerUuids = new Set(contests.map((contest) => contest.uuid));
  return mappings.map((mapping) => {
    if (providerUuids.has(mapping.providerContestUuid)) return mapping;
    const wanted = normalizedContestName(mapping.contestId);
    const match = contests.find((contest) => normalizedContestName(contest.name) === wanted);
    return match ? { ...mapping, providerContestUuid: match.uuid } : mapping;
  });
}

/** Select the explicit Feibot gun start for this event's mapped contest. */
export function mappedFeibotGunStart(
  mappings: LiveTrackingHubConfig["contestMappings"],
  contests: ImportedFeibotRules["contests"],
): string | null {
  const mappedUuids = new Set(
    mappings.map((mapping) => mapping.providerContestUuid).filter(Boolean),
  );
  return contests.find(
    (contest) => mappedUuids.has(contest.uuid) && contest.gunStartAt,
  )?.gunStartAt ?? contests.find((contest) => contest.gunStartAt)?.gunStartAt ?? null;
}

/**
 * CHIP athletes retain their individual accepted START-mat time.  The allowed
 * START window itself is anchored to Feibot's official gun time.
 */
export function startWindowFromFeibotGun(
  start: LiveTrackingHubConfig["start"],
  providerGunStart: string | null,
): LiveTrackingHubConfig["start"] {
  if (!providerGunStart || Number.isNaN(Date.parse(providerGunStart))) return start;
  const gunStartAt = new Date(providerGunStart).toISOString();
  const validStartWindowMinutes = Math.max(0, Number(start.validStartWindowMinutes) || 0);
  return {
    ...start,
    gunStartAt,
    startWindowOpenAt: gunStartAt,
    startWindowCloseAt: new Date(
      Date.parse(gunStartAt) + validStartWindowMinutes * 60_000,
    ).toISOString(),
  };
}

export function mergeImportedFeibotSplits(
  importedSplits: HubSplit[],
  savedSplits: HubSplit[],
  legs: HubLeg[],
  timingPoints: HubTimingPoint[],
): HubSplit[] {
  const legIds = new Set(legs.map((leg) => leg.id));
  const timingPointIds = new Set(timingPoints.map((point) => point.id));
  const importedIds = new Set(importedSplits.map((split) => split.id));
  const mergedImported = importedSplits.map((split) => {
    const saved = savedSplits.find((item) => item.id === split.id);
    return saved ? {
      ...split,
      name: saved.name,
      legId: legIds.has(saved.legId) ? saved.legId : split.legId,
      order: saved.order,
      distanceKm: saved.distanceKm,
      cutoffSeconds: saved.cutoffSeconds,
      providerContestUuid: split.providerContestUuid ?? saved.providerContestUuid ?? null,
      isFinalRaceSplit: saved.isFinalRaceSplit ?? split.isFinalRaceSplit,
      visible: saved.visible,
      requiredForProgression: saved.requiredForProgression ?? true,
    } : split;
  });
  const customSplits = savedSplits
    .filter((split) => !importedIds.has(split.id) && split.importedName == null && split.id.startsWith("split-"))
    .map((split) => ({
      ...split,
      legId: legIds.has(split.legId) ? split.legId : legs[0]?.id ?? split.legId,
      timingPointId: split.timingPointId && timingPointIds.has(split.timingPointId) ? split.timingPointId : null,
    }));
  return normalizeFinalRaceSplits([...mergedImported, ...customSplits]
    .sort((left, right) => left.order - right.order)
    .map((split, order) => ({ ...split, order })));
}

async function importTimingRules(eventId: string) {
  const event = await getEventBySlug(eventId, { includeUnpublished: true });
  if (!event) throw new Error("Event not found.");
  const kv = await getKv();
  const credentialRecord = await resolveEventCredentials(kv, event);
  if (!credentialRecord) throw new Error("Store an event or account-scoped Feibot credential first.");
  const response = await callFeibot(credentialRecord.resolved, "/eventConfigFile/timingRulesGet");
  if (!response.ok) throw new Error(response.message);
  const rules = parseFeibotTimingRules(response.data);
  const config = await getLiveTrackingHubConfig(event.id);
  if (!config) throw new Error("Live tracking configuration is unavailable.");
  const { eventId: ignoredEventId, updatedAt: ignoredUpdatedAt, ...body } = config; void ignoredEventId; void ignoredUpdatedAt;
  const contestMappings = reconcileFeibotContestMappings(body.contestMappings, rules.contests);
  const providerStart = mappedFeibotGunStart(contestMappings, rules.contests);
  const start = startWindowFromFeibotGun(body.start, providerStart);
  const wasCollapsedFlow = expandFeibotSportLegs(config.legs, config.splits).legs !== config.legs;
  const mergedLegs = rules.legs.map((leg) => {
    const saved = wasCollapsedFlow ? null : config.legs.find((item) => item.id === leg.id);
    return saved ? { ...leg, name: saved.name, type: saved.type, order: saved.order, distanceKm: saved.distanceKm, cutoffSeconds: saved.cutoffSeconds } : leg;
  });
  const mergedTimingPoints = rules.timingPoints.map((point) => {
    const saved = config.timingPoints.find((item) => item.id === point.id);
    return saved ? { ...point, name: saved.name, course: saved.course, km: saved.km, visible: saved.visible } : point;
  });
  const savedSplits = wasCollapsedFlow
    ? config.splits.map((split) => ({ ...split, legId: "" }))
    : config.splits;
  const mergedSplits = mergeImportedFeibotSplits(rules.splits, savedSplits, mergedLegs, mergedTimingPoints);
  const saved = await saveLiveTrackingHubConfig(event.id, {
    ...body,
    contestMappings,
    start,
    legs: mergedLegs,
    splits: mergedSplits,
    timingPoints: mergedTimingPoints,
  });
  await Promise.all([
    kv.put(`${PREFIX}:live:event:${event.id}:feibot:timing-rules`, JSON.stringify(response.data)),
    kv.put(`${scopedProviderPrefix(event.id, credentialRecord.resolved.eventUuid)}:timing-rules`, JSON.stringify(response.data)),
    persistLiveTrackingSplitIndex(saved),
  ]);
  await writeOperationLog(event.id, "IMPORT_TIMING_RULES", "SUCCESS", `Imported ${rules.contests.length} contests, ${rules.splits.length} splits and ${rules.timingPoints.length} timing points.`);
  return rules;
}

export async function persistLiveTrackingSplitIndex(config: LiveTrackingHubConfig) {
  const kv = await getKv();
  const index = config.splits.toSorted((left, right) => left.order - right.order).map((split) => ({ ...split, leg: config.legs.find((leg) => leg.id === split.legId) ?? null, timingPoint: config.timingPoints.find((point) => point.id === split.timingPointId) ?? null }));
  const byLeg = Object.fromEntries(config.legs.map((leg) => [leg.id, index.filter((split) => split.legId === leg.id)]));
  const byTimingPoint = Object.fromEntries(index.filter((split) => split.timingPointId).map((split) => [`${split.timingPointId}:${split.passage}`, split]));
  await Promise.all([
    kv.put(`${PREFIX}:live:event:${config.eventId}:split:index`, JSON.stringify(index)),
    kv.put(`${PREFIX}:live:event:${config.eventId}:split:by-leg`, JSON.stringify(byLeg)),
    kv.put(`${PREFIX}:live:event:${config.eventId}:split:by-timing-point`, JSON.stringify(byTimingPoint)),
  ]);
  await writeOperationLog(config.eventId, "REBUILD_SPLIT_INDEX", "SUCCESS", `Rebuilt and verified ${index.length} split index rows.`);
  return { count: index.length, byLeg: Object.keys(byLeg).length, byTimingPoint: Object.keys(byTimingPoint).length };
}

export async function persistStoredFeibotOfficialStart(config: LiveTrackingHubConfig) {
  const connection = await getFeibotAdminConnection(config.eventId);
  const rules = await importedRules(config.eventId, connection.eventUuid);
  const contestMappings = reconcileFeibotContestMappings(config.contestMappings, rules.contests);
  const providerStart = mappedFeibotGunStart(contestMappings, rules.contests);
  const start = startWindowFromFeibotGun(config.start, providerStart);
  const mappingsChanged = contestMappings.some((mapping, index) => mapping.providerContestUuid !== config.contestMappings[index]?.providerContestUuid);
  const startChanged =
    config.start.gunStartAt !== start.gunStartAt ||
    config.start.startWindowOpenAt !== start.startWindowOpenAt ||
    config.start.startWindowCloseAt !== start.startWindowCloseAt;
  if (!mappingsChanged && !startChanged) return config;
  const { eventId: ignoredEventId, updatedAt: ignoredUpdatedAt, ...body } = config;
  void ignoredEventId; void ignoredUpdatedAt;
  return saveLiveTrackingHubConfig(config.eventId, {
    ...body,
    contestMappings,
    start,
  });
}

async function rebuildSplitIndex(eventId: string) {
  const config = await getLiveTrackingHubConfig(eventId);
  if (!config) throw new Error("Event not found.");
  return persistLiveTrackingSplitIndex(config);
}

export const feibotImportedDataKeys = (eventId: string) => [
  `${PREFIX}:live:event:${eventId}:feibot:timing-rules`, `${PREFIX}:live:event:${eventId}:providerParticipants`, `${PREFIX}:live:event:${eventId}:providerState`,
  `${PREFIX}:live:event:${eventId}:feibot:leaderboard`, `${PREFIX}:live:event:${eventId}:feibot:live-results`, `${PREFIX}:live:event:${eventId}:feibot:process`,
  `${PREFIX}:live:event:${eventId}:feibot:results`, `${PREFIX}:live:event:${eventId}:leaderboard`, `${PREFIX}:live:event:${eventId}:results`,
  `${PREFIX}:live:event:${eventId}:participants`, `${PREFIX}:live:event:${eventId}:updated`, `${PREFIX}:live:event:${eventId}:split:index`,
  `${PREFIX}:live:event:${eventId}:split:by-leg`, `${PREFIX}:live:event:${eventId}:split:by-timing-point`,
];

async function deleteImported(eventId: string) {
  const event = await getEventBySlug(eventId, { includeUnpublished: true });
  if (!event) throw new Error("Event not found.");
  const kv = await getKv();
  const keys = feibotImportedDataKeys(event.id);
  await Promise.all(keys.map((key) => kv.delete(key)));
  await writeOperationLog(event.id, "DELETE_IMPORTED_DATA", "SUCCESS", `Deleted ${keys.length} event-scoped imported keys; credentials, hub configuration, mappings, course maps and canonical versions were preserved.`);
  return { deleted: keys.length, preserved: [credentialsKey(event.id), keyForHubConfig(event.id), "course maps", "canonical versions"] };
}

function keyForHubConfig(eventId: string) { return `${PREFIX}:live:event:${eventId}:hub-config`; }
function liveSyncStateKey(eventId: string) { return `${PREFIX}:live:event:${eventId}:feibot:live-sync-state`; }
function liveResultsCooldownKey(eventId: string, connectionId: string) { return `${PREFIX}:live:event:${eventId}:feibot:live-results:cooldown:${connectionId}`; }

interface FeibotLiveSyncState {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastWarning?: string | null;
  rateLimitedUntil?: string | null;
  fetchedRows: number;
  publishedConnections: number;
  connections: number;
  accessDeniedFeeds?: FeibotFeedAccessBackoff[];
}

type FeibotResultFeedEndpoint = "/temporary/temporary_ResultDataGetAll" | "/api/processQuery" | "/finishResultGetAll";

interface FeibotFeedAccessBackoff {
  connectionId: string;
  endpoint: FeibotResultFeedEndpoint;
  status: 401 | 403;
  detectedAt: string;
  retryAt: string;
}

interface FeibotLiveResultsCooldown {
  eventId: string;
  connectionId: string;
  endpoint: FeibotResultFeedEndpoint;
  limitedAt: string;
  retryAt: string;
}

/** Clears display-only sync history when its canonical source is reset. */
export async function clearFeibotCanonicalDisplayState(eventId: string) {
  const kv = await getKv();
  const index = (await kv.get<string[]>(operationLogIndexKey(eventId), "json")) ?? [];
  await Promise.all([
    kv.delete(liveSyncStateKey(eventId)),
    ...index.map((id) => kv.delete(operationLogKey(eventId, id))),
    kv.delete(operationLogIndexKey(eventId)),
    kv.delete(operationRecentLogsKey(eventId)),
  ]);
  return { liveSyncStateDeleted: true, logsDeleted: index.length };
}

function sanitizedPreview(value: unknown) {
  return JSON.stringify(value, (key, item) => /secret|access.?key|signature|token|download.?url/i.test(key) ? "[REDACTED]" : item, 2).slice(0, 30_000);
}

export function confirmedCanonicalFinishSplit(live: {
  raceStatus?: string;
  splits?: Array<{
    readerTimestamp?: string;
    timestamp?: string;
  }>;
}) {
  // Swim Finish and Bike Finish are intermediate leg boundaries. Only the
  // canonical race engine may declare the athlete finished; once it does, the
  // last timestamped canonical split is the accepted terminal evidence.
  if (String(live.raceStatus ?? "").trim().toUpperCase() !== "FINISHED") {
    return undefined;
  }
  return [...(live.splits ?? [])]
    .reverse()
    .find((split) => Boolean(split.readerTimestamp || split.timestamp));
}

export function emailForExactParticipantIdentity(
  participantIds: Array<string | null | undefined>,
  rows: JsonRecord[],
): string {
  const wanted = new Set(participantIds.map(text).filter(Boolean).map((value) => value.toLowerCase()));
  if (!wanted.size) return "";
  const emails = new Set(rows.flatMap((row) => {
    const identities = [
      row.participantUid,
      row.participantUuid,
      row.participant_uuid,
      row.providerParticipantUuid,
      row.athleteUid,
      row.athlete_id,
      row.uuid,
      row.id_code,
      row.id,
    ].map(text).filter(Boolean).map((value) => value.toLowerCase());
    if (!identities.some((identity) => wanted.has(identity))) return [];
    const email = text(recordValue(row, "email", "emailAddress", "email_address", "participantEmail", "rosterEmail")).toLowerCase();
    return email ? [email] : [];
  }));
  // Conflicting contact records must be resolved by an admin instead of
  // exposing a possibly unrelated athlete's address.
  return emails.size === 1 ? [...emails][0] : "";
}

export async function getFeibotOperationsDashboard(eventId: string) {
  const event = await getEventBySlug(eventId, { includeUnpublished: true });
  if (!event) throw new Error("Event not found.");
  const kv = await getKv();
  const connection = await getFeibotAdminConnection(event.id);
  const [config, manifest, canonical, canonicalIndex, rules, logs, splitIndex, liveSync, providerParticipantRows] = await Promise.all([
    getLiveTrackingHubConfig(event.id), getCanonicalLiveManifest(event.id), getCanonicalLiveEvent(event.id), getCanonicalParticipantIndex(event.id), importedRules(event.id, connection.eventUuid), operationLogs(event.id), kv.get<unknown[]>(`${PREFIX}:live:event:${event.id}:split:index`, "json"), kv.get<FeibotLiveSyncState>(liveSyncStateKey(event.id), "json"), getFeibotProviderParticipantRows(event.id).catch(() => []),
  ]);
  const canonicalIndexById = new Map((canonicalIndex?.rows ?? []).flatMap((row) => {
    const ids = [row.participantUuid, row.sourceParticipantUid].filter((value): value is string => Boolean(value));
    return ids.map((id) => [id, row] as const);
  }));
  // The version-pinned participant index is the canonical roster. Prefer the
  // hydrated live projection, but fall back to the index so registered athletes
  // remain visible even when there is no start/split evidence yet.
  const canonicalParticipantSources = canonical?.participants?.length
    ? resolveConfiguredFinishers(canonical.participants, config?.splits ?? [], { preserveDnf: true })
    : (canonicalIndex?.rows ?? []).map((row) => ({
      participantUid: row.sourceParticipantUid || row.participantUuid,
      bib: row.bib,
      displayName: row.displayName,
      contestName: row.contestName,
      ageGroup: row.ageGroupKey || undefined,
      gender: row.genderKey || undefined,
      raceStatus: String(row.status || "UNKNOWN").toUpperCase(),
      latestTimingPoint: row.lastSplitLabel || undefined,
      splits: row.splits ?? [],
    }));
  const participants = canonicalParticipantSources.slice(0, 500).map((live) => {
    const indexRow = canonicalIndexById.get(live.participantUid);
    const participantId = live.participantUid;
    const providerEventUuid = indexRow?.providerEventUuid || manifest?.providerEventUuid || connection.eventUuid;
    const providerConnection = connection.connections.find((item) => item.eventUuid === providerEventUuid);
    const liveSplits = live.splits ?? [];
    const acceptedStart = liveSplits.find((split) => /start/i.test(`${split.splitId} ${split.name}`));
    const acceptedFinish = live.raceStatus === "FINISHED" ? confirmedCanonicalFinishSplit(live) : undefined;
    return ({
    id: participantId,
    bib: live.bib,
    name: live.displayName,
    email: emailForExactParticipantIdentity([
      live.participantUid,
      indexRow?.participantUuid,
      indexRow?.sourceParticipantUid,
      indexRow?.providerParticipantUuid,
    ], providerParticipantRows),
    chipCode: indexRow?.chipCode || "",
    providerEventUuid,
    providerEventName: providerConnection?.label || providerConnection?.eventName || connection.eventName || connection.label || "Feibot",
    raceDate: providerConnection?.raceDate || connection.raceDate || event.date,
    contest: live.contestName || indexRow?.contestName || "",
    ageGroup: live.ageGroup || indexRow?.ageGroupKey || "",
    gender: live.gender || indexRow?.genderKey || "",
    status: live.raceStatus || String(indexRow?.status || "UNKNOWN").toUpperCase(),
    timingState: live.raceStatus || String(indexRow?.status || "UNKNOWN").toUpperCase(),
    currentSplit: live.latestTimingPoint || indexRow?.lastSplitLabel || "",
    startTime: acceptedStart?.readerTimestamp || acceptedStart?.timestamp || acceptedStart?.chipStartTimestamp || indexRow?.waveStartTime || "",
    finishTime: acceptedFinish?.readerTimestamp || acceptedFinish?.timestamp || "",
    splits: liveSplits.map((split) => ({
      id: split.splitId,
      name: split.name,
      timestamp: split.readerTimestamp || split.timestamp || "",
      time: split.cumulativeTime || split.splitTime || "",
    })),
    previousChipCode: "",
    chipChangeReason: "",
    chipChangedBy: "",
    chipChangedAt: "",
  });
  });
  const gates = [
    { id: "credentials", label: "Credentials stored", ready: connection.configured, detail: connection.configured ? `Credentials are stored for ${connection.eventUuid}.` : "Store an event-scoped Feibot credential." },
    { id: "event", label: "Feibot event selected", ready: Boolean(connection.eventUuid), detail: connection.eventUuid ? `Selected Feibot event: ${connection.eventUuid}.` : "Select a Feibot event UUID." },
    { id: "linked", label: "Event APIs linked", ready: connection.endpoints.timingRules.ok, detail: connection.endpoints.timingRules.message },
    { id: "raceupshot", label: "Race Upshot event set", ready: Boolean(event.id), detail: `Using ${event.name}.` },
    { id: "verified", label: "Connection verified", ready: connection.connected, detail: connection.connected ? "Feibot authentication is verified." : "Recheck the Feibot connection." },
    { id: "database", label: "Canonical database built", ready: Boolean(manifest?.completeBuildValid), detail: manifest?.completeBuildValid ? `${manifest.participantCount} canonical participants are published.` : "Run a full canonical rebuild." },
    { id: "link", label: "Event link extracted", ready: Boolean(connection.eventUuid), detail: connection.eventUuid ? `Provider event UUID: ${connection.eventUuid}.` : "No provider event UUID." },
    { id: "canonical", label: "KV built", ready: Boolean(manifest?.completeBuildValid), detail: manifest?.completeBuildValid ? `Canonical version ${manifest.activeVersion ?? manifest.version}.` : "Run a full rebuild." },
    { id: "participants", label: "Canonical participants", ready: (manifest?.participantCount ?? 0) > 0, detail: `${manifest?.participantCount ?? 0} participants in the active canonical version.` },
    { id: "splits", label: "Split mapping", ready: Boolean(config?.splits.length || splitIndex?.length), detail: config?.splits.length ? `${config.splits.length} splits configured.` : "Import timing rules or configure a split mapping." },
  ];
  await ensureFeibotLiveSyncSchedule(event.id, connection.configured && Boolean(manifest?.completeBuildValid));
  return {
    event: { id: event.id, name: event.name, date: event.date },
    connection,
    manifest,
    rules: { contests: rules.contests.length, legs: rules.legs.length, splits: rules.splits.length, timingPoints: rules.timingPoints.length },
    timingContests: rules.contests.map((contest) => ({
      uuid: contest.uuid,
      name: contest.name,
      raceDate: contest.raceDate,
      gunStartAt: contest.gunStartAt,
    })),
    splitIndexCount: splitIndex?.length ?? 0,
    gates,
    ready: gates.every((gate) => gate.ready),
    participants,
    liveSync: liveSync ?? { lastAttemptAt: null, lastSuccessAt: null, lastError: null, lastWarning: null, rateLimitedUntil: null, fetchedRows: 0, publishedConnections: 0, connections: connection.connections.length },
    logs,
  };
}

export type FeibotOperationsDashboard = Awaited<ReturnType<typeof getFeibotOperationsDashboard>>;

export async function syncFeibotLiveResults(eventId: string) {
  const event = await getEventBySlug(eventId, { includeUnpublished: true });
  if (!event) throw new Error("Event not found.");
  const kv = await getKv();
  const registry = await readConnectionRegistry(kv, event);
  const previousState = await kv.get<FeibotLiveSyncState>(liveSyncStateKey(event.id), "json");
  const lastAttemptAt = new Date().toISOString();
  let fetchedRows = 0;
  let publishedConnections = 0;
  let successfulConnections = 0;
  const errors: string[] = [];
  const warnings: string[] = [];
  const accessNotices: string[] = [];
  const rateLimitedUntil: string[] = [];
  const accessDeniedFeeds = (previousState?.accessDeniedFeeds ?? [])
    .filter((feed) => isFeibotCooldownActive(feed.retryAt));
  for (const entry of registry.connections) {
    const credentialRecord = await resolveEventCredentials(kv, event, entry.connectionId);
    if (!credentialRecord) {
      errors.push(`${entry.label}: credentials unavailable`);
      continue;
    }
    const cooldown = await kv.get<FeibotLiveResultsCooldown>(liveResultsCooldownKey(event.id, entry.connectionId), "json");
    if (isFeibotCooldownActive(cooldown?.retryAt)) {
      rateLimitedUntil.push(cooldown!.retryAt);
      warnings.push(`${entry.label}: Feibot rate-limit cooldown until ${cooldown!.retryAt}; existing imported data is preserved.`);
      continue;
    }
    const receivedAt = new Date().toISOString();
    const resultFeeds: Array<{ endpoint: FeibotResultFeedEndpoint; storage: string }> = [
      { endpoint: "/temporary/temporary_ResultDataGetAll" as const, storage: "live-results" },
      { endpoint: "/api/processQuery" as const, storage: "process" },
      { endpoint: "/finishResultGetAll" as const, storage: "results" },
    ];
    const availableResultFeeds = resultFeeds.filter((feed) => !accessDeniedFeeds.some((blocked) =>
      blocked.connectionId === entry.connectionId
      && blocked.endpoint === feed.endpoint
      && isFeibotCooldownActive(blocked.retryAt),
    ));
    const responses = await Promise.all(availableResultFeeds.map(async (feed) => ({
      ...feed,
      response: await callFeibotWithRateLimitRetry(credentialRecord.resolved, feed.endpoint),
    })));
    const readableRows: JsonRecord[][] = [];
    let successfulFeeds = 0;
    for (const feed of responses) {
      if (!feed.response.ok) {
        if (feed.response.status === 429) {
          const limitedAt = new Date().toISOString();
          const retryAt = feibotCooldownUntil(Date.now(), feed.response.retryAfterMilliseconds);
          const cooldownRecord: FeibotLiveResultsCooldown = { eventId: event.id, connectionId: entry.connectionId, endpoint: feed.endpoint, limitedAt, retryAt };
          await kv.put(liveResultsCooldownKey(event.id, entry.connectionId), JSON.stringify(cooldownRecord), { expirationTtl: Math.max(1, Math.ceil((Date.parse(retryAt) - Date.now()) / 1_000) + 60) });
          rateLimitedUntil.push(retryAt);
          warnings.push(`${entry.label}: Feibot rate-limited ${feed.endpoint} (HTTP 429); retrying after ${retryAt}. Existing canonical data was preserved.`);
        } else if (feed.response.status === 401 || feed.response.status === 403) {
          const detectedAt = new Date().toISOString();
          const retryAt = feibotAccessDeniedRetryAt();
          accessDeniedFeeds.push({
            connectionId: entry.connectionId,
            endpoint: feed.endpoint,
            status: feed.response.status,
            detectedAt,
            retryAt,
          });
          accessNotices.push(`${entry.label}: ${feed.endpoint} is not enabled by Feibot (HTTP ${feed.response.status}); continuing with the available result feeds and retrying after ${retryAt}.`);
        } else {
          warnings.push(`${entry.label}: ${feed.endpoint} returned ${feed.response.message}`);
        }
        continue;
      }
      successfulFeeds += 1;
      if (feed.response.outcome === "not_modified" || feed.response.outcome === "no_results") continue;
      const payload = await resolveDownloadedPayload(feed.response.data).catch(() => feed.response.data);
      readableRows.push(deepResponseRows(payload, "results", "process", "participants", "athletes", "rows", "data"));
      await kv.put(`${scopedProviderPrefix(event.id, credentialRecord.resolved.eventUuid)}:${feed.storage}`, JSON.stringify(payload));
    }
    if (!successfulFeeds) {
      errors.push(`${entry.label}: no Feibot result feed could be read.`);
      continue;
    }
    successfulConnections += 1;
    if (!responses.some((feed) => feed.response.status === 429)) await kv.delete(liveResultsCooldownKey(event.id, entry.connectionId));
    const rows = mergeParticipantRows(...readableRows);
    fetchedRows += rows.length;
    if (rows.length) {
      await storeFeibotProcessedTimingAudits({
        eventId: event.id,
        providerEventUuid: credentialRecord.resolved.eventUuid,
        rows,
      });
      const published = await publishIncrementalCanonicalParticipants({
        eventId: event.id,
        providerEventUuid: credentialRecord.resolved.eventUuid,
        rows,
        reason: "split_updated",
        feibotReadReceivedAt: receivedAt,
        feibotReadAcceptedAt: new Date().toISOString(),
      });
      if (published) publishedConnections += 1;
    }
  }
  // The Durable Object invokes this sync on its own alarm. Re-evaluate time-
  // based status even when Feibot returned no changed rows, was rate limited,
  // or no spectator/admin client is connected.
  const cutoffSweep = await reevaluateEventTimingCutoffs({ eventId: event.id, now: new Date().toISOString() });
  if (cutoffSweep.published) publishedConnections += 1;
  const state: FeibotLiveSyncState = {
    lastAttemptAt,
    lastSuccessAt: successfulConnections ? new Date().toISOString() : previousState?.lastSuccessAt ?? null,
    lastError: errors.length ? errors.join(" | ") : null,
    lastWarning: warnings.length ? warnings.join(" | ") : null,
    rateLimitedUntil: rateLimitedUntil.sort().at(-1) ?? null,
    fetchedRows,
    publishedConnections,
    connections: registry.connections.length,
    accessDeniedFeeds,
  };
  await kv.put(liveSyncStateKey(event.id), JSON.stringify(state));
  if (publishedConnections) await writeOperationLog(event.id, "FETCH_FEIBOT_RESULTS", "SUCCESS", `${fetchedRows} result rows checked; ${publishedConnections} connection update${publishedConnections === 1 ? "" : "s"} published to canonical.`);
  if (accessNotices.length) await writeOperationLog(event.id, "FETCH_FEIBOT_RESULTS", "INFO", accessNotices.join(" | "));
  // Only write a warning when we actually reached the provider's limit. Cooldown skips
  // deliberately stay quiet so the 10-second scheduler cannot flood the admin audit log.
  if (warnings.length && !rateLimitedUntil.some((retryAt) => previousState?.rateLimitedUntil === retryAt)) await writeOperationLog(event.id, "FETCH_FEIBOT_RESULTS", "WARNING", warnings.join(" | "));
  if (errors.length) await writeOperationLog(event.id, "FETCH_FEIBOT_RESULTS", "ERROR", errors.join(" | "));
  return state;
}

export async function runFeibotOperation(eventId: string, action: FeibotOperationName) {
  const event = await getEventBySlug(eventId, { includeUnpublished: true });
  if (!event) throw new Error("Event not found.");
  const kv = await getKv();
  try {
    if (action === "IMPORT_TIMING_RULES") return { action, data: await importTimingRules(event.id), dashboard: await getFeibotOperationsDashboard(event.id) };
    if (action === "REBUILD_SPLIT_INDEX") return { action, data: await rebuildSplitIndex(event.id), dashboard: await getFeibotOperationsDashboard(event.id) };
    if (action === "DELETE_IMPORTED_DATA") return { action, data: await deleteImported(event.id), dashboard: await getFeibotOperationsDashboard(event.id) };
    if (action === "CLEAR_LOGS") {
      const index = (await kv.get<string[]>(operationLogIndexKey(event.id), "json")) ?? [];
      await Promise.all([
        ...index.map((id) => kv.delete(operationLogKey(event.id, id))),
        kv.delete(operationLogIndexKey(event.id)),
        kv.delete(operationRecentLogsKey(event.id)),
      ]);
      return { action, data: { deleted: index.length }, dashboard: await getFeibotOperationsDashboard(event.id) };
    }
    if (action === "TEST_TIMING_RULES" || action === "TEST_PARTICIPANTS") {
      const credentialRecord = await resolveEventCredentials(kv, event);
      if (!credentialRecord) throw new Error("Store an event or account-scoped Feibot credential first.");
      const path = action === "TEST_TIMING_RULES" ? "/eventConfigFile/timingRulesGet" : "/temporary/participantsGetAll";
      const response = await callFeibot(credentialRecord.resolved, path);
      if (action === "TEST_TIMING_RULES") {
        const current = await kv.get<StoredFeibotSnapshot>(snapshotKey(event.id), "json");
        await persistVerifiedConnectionSnapshot({ event, kv, credentialRecord, current, response });
      }
      await writeOperationLog(event.id, action, response.ok ? "SUCCESS" : "ERROR", response.message);
      return { action, data: { ok: response.ok, status: response.status, message: response.message, preview: sanitizedPreview(response.data) }, dashboard: await getFeibotOperationsDashboard(event.id) };
    }
    if (action === "FETCH_FEIBOT_READS" || action === "FETCH_FEIBOT_RESULTS") {
      if (action === "FETCH_FEIBOT_RESULTS") {
        const data = await syncFeibotLiveResults(event.id);
        return { action, data: { ok: !data.lastError, status: data.lastError ? 207 : 200, count: data.fetchedRows, connections: data.connections, publishedConnections: data.publishedConnections }, dashboard: await getFeibotOperationsDashboard(event.id) };
      }
      const credentialRecord = await resolveEventCredentials(kv, event);
      if (!credentialRecord) throw new Error("Store an event or account-scoped Feibot credential first.");
      const isResultFetch = false;
      const path = "/api/processQuery";
      const response = await callFeibot(credentialRecord.resolved, path);
      if (!response.ok) throw new Error(response.message);
      const payload = isResultFetch
        ? await resolveDownloadedPayload(response.data).catch(() => response.data)
        : response.data;
      const fetchedRows = deepResponseRows(payload, "results", "process", "participants", "athletes", "rows", "data");
      const storageKey = `${PREFIX}:live:event:${event.id}:feibot:${isResultFetch ? "live-results" : "process"}`;
      await kv.put(storageKey, JSON.stringify(payload));
      if (isResultFetch && fetchedRows.length) {
        await publishIncrementalCanonicalParticipants({
          eventId: event.id,
          providerEventUuid: credentialRecord.resolved.eventUuid,
          rows: fetchedRows,
        });
      }
      await writeOperationLog(event.id, action, "SUCCESS", `${fetchedRows.length} Feibot ${isResultFetch ? "result" : "processed read"} rows fetched for ${credentialRecord.resolved.eventUuid}.`);
      return {
        action,
        data: { ok: true, status: response.status, count: fetchedRows.length, eventUuid: credentialRecord.resolved.eventUuid },
        dashboard: await getFeibotOperationsDashboard(event.id),
      };
    }
    if (action === "FULL_REBUILD") {
      await importTimingRules(event.id); await rebuildSplitIndex(event.id); const connection = await connectFeibotEvent(event.id);
      await writeOperationLog(event.id, action, "SUCCESS", `Full rebuild published canonical version ${connection.canonicalBuild?.version ?? "unknown"}.`);
      return { action, data: connection, dashboard: await getFeibotOperationsDashboard(event.id) };
    }
    if (action === "HARD_RESET_SYNC") {
      const selected = await getFeibotAdminConnection(event.id);
      if (!selected.connectionId) throw new Error("Select a Feibot connection before starting a fresh cloud sync.");
      await deleteImported(event.id);
      const connection = await connectFeibotEvent(event.id, { connectionId: selected.connectionId });
      await importTimingRules(event.id);
      await rebuildSplitIndex(event.id);
      await writeOperationLog(event.id, action, "SUCCESS", `Fresh cloud sync published canonical version ${connection.canonicalBuild?.version ?? "unknown"}.`);
      return { action, data: connection, dashboard: await getFeibotOperationsDashboard(event.id) };
    }
    const dashboard = await getFeibotOperationsDashboard(event.id);
    await writeOperationLog(event.id, action, "SUCCESS", action === "CANONICAL_SUMMARY" ? `Manifest ${dashboard.manifest?.activeVersion ?? dashboard.manifest?.version ?? "not published"}.` : "Provider status refreshed.");
    return { action, data: dashboard, dashboard: await getFeibotOperationsDashboard(event.id) };
  } catch (error) {
    await writeOperationLog(event.id, action, "ERROR", error instanceof Error ? error.message : "Operation failed.");
    throw error;
  }
}
