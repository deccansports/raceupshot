import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { KVNamespace } from "@cloudflare/workers-types";
import type {
  CanonicalBuildStatus,
  CanonicalBuildValidation,
  CanonicalCourseArtifact,
  CanonicalLiveManifest,
  CanonicalParticipantIndex,
  CanonicalParticipantIndexRow,
  EventCourseMap,
  LiveParticipant,
} from "@/packages/contracts/src";
import {
  formatDurationMs,
  hasValidatedConfiguredFinish,
  normalizeFeibotCalculatedResultParticipant,
  normalizeFeibotParticipant,
  type AthleteTimingAudit,
} from "@/packages/timing-core/src";
import { withTransientKvRetry } from "./kv-retry";
import { publishCanonicalChange } from "./canonical-change";
import { decorateLiveParticipantRanks, rankLiveLeaderboardParticipants } from "./live-leaderboard";
import { scheduleAutomaticResultNotifications } from './automatic-result-notifications';

const PREFIX = "raceupshot:canonical";
type JsonRecord = Record<string, unknown>;
type IncrementalParticipantRecord = { baseVersion: string; updatedAt?: string; participant: LiveParticipant };
type IncrementalEventRecord = { baseVersion: string; updatedAt?: string; providerEventUuids?: string[]; participants: LiveParticipant[] };
type CanonicalLiveSummary = { baseVersion: string; participantCount: number; onCourse: number; finished: number; updatedAt: string };

async function getKv(): Promise<KVNamespace> {
  const { env } = await getCloudflareContext({ async: true });
  if (!env.RACEUPSHOT) throw new Error("RACEUPSHOT KV binding is unavailable.");
  return withTransientKvRetry(env.RACEUPSHOT);
}

function manifestKey(eventId: string) { return `${PREFIX}:event:${eventId}:manifest`; }
function versionPrefix(eventId: string, version: string) { return `${PREFIX}:event:${eventId}:version:${version}`; }
function incrementalKey(eventId: string) { return `${PREFIX}:event:${eventId}:incremental:participants`; }
function incrementalParticipantKey(eventId: string, participantUid: string) {
  return `${PREFIX}:event:${eventId}:incremental:participant:${encodeURIComponent(participantUid)}`;
}
function versionedParticipantKey(eventId: string, version: string, participantUid: string) {
  return `${versionPrefix(eventId, version)}:participant:${encodeURIComponent(participantUid)}`;
}
function versionedParticipantLookupKey(eventId: string, version: string, identity: string) {
  return `${versionPrefix(eventId, version)}:participant:lookup:${encodeURIComponent(identity.trim().toLocaleLowerCase("en-US"))}`;
}
function incrementalLeaderboardKey(eventId: string) {
  return `${PREFIX}:event:${eventId}:incremental:leaderboard`;
}
function liveSummaryKey(eventId: string) { return `${PREFIX}:event:${eventId}:summary`; }

function summarizeParticipants(participants: LiveParticipant[], baseVersion: string, updatedAt: string): CanonicalLiveSummary {
  return {
    baseVersion,
    participantCount: participants.length,
    onCourse: participants.filter((participant) => !["NOT_STARTED", "CUTOFF_PENDING", "FINISHED", "DNF", "DNS", "DNQ", "DSQ", "OTL"].includes(participant.raceStatus)).length,
    finished: participants.filter((participant) => participant.raceStatus === "FINISHED").length,
    updatedAt,
  };
}

function durationSeconds(value: string | undefined): number | null {
  if (!value) return null;
  const parts = value.trim().split(":").map(Number);
  if (!parts.length || parts.some((part) => !Number.isFinite(part) || part < 0)) return null;
  return parts.reduce((seconds, part) => seconds * 60 + part, 0);
}

/**
 * Result ranks are intentionally derived from confirmed finishers only. Live
 * position remains the responsibility of `rankLiveLeaderboardParticipants`.
 * Keeping those concepts separate prevents an in-progress athlete from
 * changing a finisher's result position.
 */
export function rankCanonicalFinishers(participants: LiveParticipant[]): LiveParticipant[] {
  const rankedByUid = new Map<string, LiveParticipant>();
  const contests = new Map<string, LiveParticipant[]>();
  for (const participant of participants) {
    if (participant.raceStatus !== "FINISHED") continue;
    const elapsed = durationSeconds(participant.elapsedTime ?? participant.cumulativeTime);
    if (elapsed === null) continue;
    const key = participant.contestId || "__event__";
    const rows = contests.get(key) ?? [];
    rows.push(participant);
    contests.set(key, rows);
  }
  for (const rows of contests.values()) {
    rows.sort((left, right) => {
      const delta = (durationSeconds(left.elapsedTime ?? left.cumulativeTime) ?? Number.MAX_SAFE_INTEGER)
        - (durationSeconds(right.elapsedTime ?? right.cumulativeTime) ?? Number.MAX_SAFE_INTEGER);
      return delta || left.bib.localeCompare(right.bib) || left.participantUid.localeCompare(right.participantUid);
    });
    const genderCounts = new Map<string, number>();
    const ageCounts = new Map<string, number>();
    for (const row of rows) {
      const gender = row.gender?.trim().toLowerCase();
      const age = row.ageGroup?.trim().toLowerCase();
      if (gender) genderCounts.set(gender, (genderCounts.get(gender) ?? 0) + 1);
      if (age) ageCounts.set(age, (ageCounts.get(age) ?? 0) + 1);
    }
    const genderRanks = new Map<string, number>();
    const ageRanks = new Map<string, number>();
    rows.forEach((row, index) => {
      const gender = row.gender?.trim().toLowerCase();
      const age = row.ageGroup?.trim().toLowerCase();
      const genderRank = gender ? (genderRanks.get(gender) ?? 0) + 1 : undefined;
      const ageGroupRank = age ? (ageRanks.get(age) ?? 0) + 1 : undefined;
      if (gender && genderRank) genderRanks.set(gender, genderRank);
      if (age && ageGroupRank) ageRanks.set(age, ageGroupRank);
      rankedByUid.set(row.participantUid, {
        ...row,
        overallRank: index + 1,
        overallRankTotal: rows.length,
        genderRank,
        genderRankTotal: gender ? genderCounts.get(gender) : undefined,
        ageGroupRank,
        ageGroupRankTotal: age ? ageCounts.get(age) : undefined,
      });
    });
  }
  return participants.map((participant) => rankedByUid.get(participant.participantUid) ?? participant);
}

export function canonicalManifestVersion(manifest: CanonicalLiveManifest | null | undefined): string {
  return manifest?.activeVersion || manifest?.version || "";
}

export function canonicalManifestUpdatedAt(manifest: CanonicalLiveManifest | null | undefined): string | null {
  return manifest?.updatedAt || manifest?.publishedAt || manifest?.builtAt || null;
}

export interface CanonicalAdminFile {
  key: string;
  label: string;
  exists: boolean;
  size: number;
  value: string | null;
  truncated: boolean;
}

export interface CanonicalAdminSnapshot {
  eventId: string;
  manifest: CanonicalLiveManifest | null;
  files: CanonicalAdminFile[];
  history: {
    versions: string[];
    files: number;
  };
  counts: {
    canonicalKeys: number;
    notificationMarkers: number;
    userReverseIndexes: number;
    runtimeKeys: number;
    timingDecisionKeys: number;
    totalTargeted: number;
  };
}

async function listKeys(kv: KVNamespace, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix, cursor, limit: 1_000 });
    keys.push(...page.keys.map((key) => key.name));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return keys;
}

function canonicalLabel(key: string): string {
  if (key.endsWith(":manifest")) return "Manifest";
  if (key.endsWith(":build:status")) return "Build status";
  if (key.endsWith(":build:validation")) return "Build validation";
  if (key.endsWith(":course")) return "Course";
  if (key.endsWith(":participant:index")) return "Participant index";
  if (key.includes(":incremental:")) return "Race-day participant updates";
  if (key.endsWith(":participants")) return "Participant index";
  if (key.endsWith(":leaderboard")) return "Leaderboard";
  return "Canonical artifact";
}

export function canonicalAdminFileSelection(eventId: string, activeVersion: string | null | undefined, canonicalKeys: string[]): {
  visibleKeys: string[];
  historyVersions: string[];
  historyFiles: number;
} {
  const activePrefix = activeVersion ? versionPrefix(eventId, activeVersion) : null;
  const incremental = incrementalKey(eventId);
  const modern = Boolean(activePrefix && canonicalKeys.some((key) => key === `${activePrefix}:participant:index` || key === `${activePrefix}:build:status`));
  const visibleKeys = [
    manifestKey(eventId),
    ...(activePrefix ? modern ? [
      `${activePrefix}:build:status`,
      `${activePrefix}:build:validation`,
      `${activePrefix}:course`,
      `${activePrefix}:participant:index`,
    ] : [`${activePrefix}:participants`, `${activePrefix}:leaderboard`] : []),
    ...(canonicalKeys.includes(incremental) ? [incremental] : []),
  ];
  const historicalKeys = canonicalKeys.filter((key) => key.includes(":version:") && (!activePrefix || !key.startsWith(`${activePrefix}:`)));
  const historyVersions = [...new Set(historicalKeys.flatMap((key) => key.match(/:version:([^:]+):/)?.[1] ?? []))].sort().reverse();
  return { visibleKeys: [...new Set(visibleKeys)], historyVersions, historyFiles: historicalKeys.length };
}

export function canonicalRuntimeResetKeys(eventId: string): string[] {
  const prefix = `raceupshot:live:event:${eventId}`;
  return [`${prefix}:participants`, `${prefix}:updated`, `${prefix}:leaderboard`, `${prefix}:results`];
}

export function isResettableTimingDecisionKey(key: string): boolean {
  return /:(audit|official|passages|decisions)$/.test(key);
}

async function existingKeys(kv: KVNamespace, keys: string[]): Promise<string[]> {
  const values = await Promise.all(keys.map((key) => kv.get(key)));
  return keys.filter((_key, index) => values[index] !== null);
}

async function resetTargets(kv: KVNamespace, eventId: string, providerEventUuid?: string): Promise<{
  canonical: string[];
  notifications: string[];
  runtime: string[];
  timingDecisions: string[];
}> {
  const [canonical, notifications, runtime, timing] = await Promise.all([
    listKeys(kv, `${PREFIX}:event:${eventId}:`),
    listKeys(kv, `raceupshot:notification:results:${eventId}:`),
    existingKeys(kv, canonicalRuntimeResetKeys(eventId)),
    providerEventUuid ? listKeys(kv, `raceupshot:timing-engine:${encodeURIComponent(providerEventUuid)}:`) : Promise.resolve([]),
  ]);
  return {
    canonical,
    notifications,
    runtime,
    timingDecisions: timing.filter(isResettableTimingDecisionKey),
  };
}

export async function getCanonicalAdminSnapshot(eventId: string, providerEventUuid?: string): Promise<CanonicalAdminSnapshot> {
  const kv = await getKv();
  const manifest = await kv.get<CanonicalLiveManifest>(manifestKey(eventId), "json");
  const targets = await resetTargets(kv, eventId, manifest?.providerEventUuid || providerEventUuid);
  const selection = canonicalAdminFileSelection(eventId, canonicalManifestVersion(manifest), targets.canonical);
  const fileKeys = selection.visibleKeys;
  const values = await Promise.all(fileKeys.map((key) => kv.get(key)));
  const files = fileKeys.map((key, index) => {
    const raw = values[index];
    const limit = 1_000_000;
    return {
      key,
      label: canonicalLabel(key),
      exists: raw !== null,
      size: raw ? new TextEncoder().encode(raw).byteLength : 0,
      value: raw && raw.length > limit ? raw.slice(0, limit) : raw,
      truncated: Boolean(raw && raw.length > limit),
    };
  }).sort((left, right) => left.label.localeCompare(right.label) || left.key.localeCompare(right.key));
  const totalTargeted = targets.canonical.length + targets.notifications.length + targets.runtime.length + targets.timingDecisions.length;
  return {
    eventId,
    manifest,
    files,
    history: { versions: selection.historyVersions, files: selection.historyFiles },
    counts: {
      canonicalKeys: targets.canonical.length,
      notificationMarkers: targets.notifications.length,
      userReverseIndexes: 0,
      runtimeKeys: targets.runtime.length,
      timingDecisionKeys: targets.timingDecisions.length,
      totalTargeted,
    },
  };
}

function normalizedRows(rows: JsonRecord[], eventId: string): LiveParticipant[] {
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    try {
      const participant = normalizeFeibotCalculatedResultParticipant(row, { eventId })
        ?? normalizeFeibotParticipant(row, { eventId });
      if (!participant.participantUid || seen.has(participant.participantUid)) return [];
      seen.add(participant.participantUid);
      return [{
        ...participant,
        splits: participant.splits.length ? participant.splits : Array.isArray(row.splits) ? row.splits as LiveParticipant["splits"] : [],
        latestTimingPoint: typeof row.latestTimingPoint === "string" ? row.latestTimingPoint : participant.latestTimingPoint,
        latestSplitTime: typeof row.latestSplitTime === "string" ? row.latestSplitTime : participant.latestSplitTime,
        cumulativeTime: typeof row.cumulativeTime === "string" ? row.cumulativeTime : participant.cumulativeTime,
        elapsedTime: typeof row.elapsedTime === "string" ? row.elapsedTime : participant.elapsedTime,
        lastUpdatedAt: typeof row.lastUpdatedAt === "string" ? row.lastUpdatedAt : participant.lastUpdatedAt,
        timingSource: participant.timingSource || (typeof row.timingSource === "string" ? row.timingSource : "FEIBOT"),
      } satisfies LiveParticipant];
    } catch {
      return [];
    }
  });
}

function splitIdentity(split: LiveParticipant["splits"][number]): string {
  const id = split.splitId?.trim().toLowerCase();
  return id ? `id:${id}` : `name:${String(split.name ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function splitRichness(split: LiveParticipant["splits"][number]): number {
  return (split.timestamp ? 8 : 0) + (split.readerTimestamp ? 4 : 0)
    + (split.source === "FEIBOT_PROCESSED" ? 4 : 0) + (split.officialTimeMs !== undefined ? 2 : 0)
    + (split.cumulativeTime ? 1 : 0);
}

function statusWeight(status: LiveParticipant["raceStatus"]): number {
  // Non-finisher terminal decisions outrank a previously projected FINISHED
  // value. In particular, an enforced cutoff must not be undone by a later
  // provider row carrying a finish-like clock.
  if (["DNF", "DNS", "DNQ", "DSQ", "OTL"].includes(status)) return 6;
  if (status === "CUTOFF_PENDING") return 5;
  if (status === "FINISHED") return 4;
  if (["STARTED", "SWIMMING", "T1", "CYCLING", "T2", "RUNNING"].includes(status)) return 3;
  if (status === "NOT_STARTED") return 2;
  return 1;
}

export function mergeCanonicalParticipantState(...states: Array<LiveParticipant | null | undefined>): LiveParticipant {
  const available = states.filter((state): state is LiveParticipant => Boolean(state));
  if (!available.length) throw new Error("A canonical participant merge requires at least one state.");
  const base = available[0];
  const splitOrder: string[] = [];
  const splits = new Map<string, LiveParticipant["splits"][number]>();
  for (const state of available) {
    for (const split of state.splits ?? []) {
      const identity = splitIdentity(split);
      if (!splits.has(identity)) splitOrder.push(identity);
      const existing = splits.get(identity);
      if (!existing || splitRichness(split) >= splitRichness(existing)) splits.set(identity, { ...existing, ...split });
    }
  }
  const mergedSplits = splitOrder.map((identity) => splits.get(identity)!).filter(Boolean);
  const richest = available.reduce((current, candidate) => {
    const currentScore = statusWeight(current.raceStatus) * 100 + current.splits.length;
    const candidateScore = statusWeight(candidate.raceStatus) * 100 + candidate.splits.length;
    // Preserve the already accepted record on equal evidence. A normalized
    // provider row is often intentionally sparse and must not erase ranks or
    // profile fields merely because it has the same status/split count.
    return candidateScore > currentScore ? candidate : current;
  }, base);
  const latest = mergedSplits[mergedSplits.length - 1];
  const nonEmpty = (key: keyof LiveParticipant) => [...available].reverse().map((state) => state[key]).find((value) => value !== undefined && value !== null && value !== "");
  const raceStatus = available.reduce((status, state) => statusWeight(state.raceStatus) > statusWeight(status) ? state.raceStatus : status, base.raceStatus);
  const nonFinisherTerminal = ["CUTOFF_PENDING", "DNF", "DNS", "DNQ", "DSQ", "OTL"].includes(raceStatus);
  return {
    ...base,
    ...richest,
    participantUid: base.participantUid,
    bib: String(nonEmpty("bib") ?? ""),
    displayName: String(nonEmpty("displayName") ?? base.displayName),
    fullName: nonEmpty("fullName") as string | undefined,
    initials: String(nonEmpty("initials") ?? base.initials),
    contestId: nonEmpty("contestId") as string | undefined,
    contestName: String(nonEmpty("contestName") ?? ""),
    raceStatus,
    statusReason: nonFinisherTerminal ? available.map((state) => state.statusReason).find((value) => value) ?? null : null,
    cutoffDeadline: nonFinisherTerminal ? available.map((state) => state.cutoffDeadline).find((value) => value) ?? null : null,
    cutoffReconcileAt: nonFinisherTerminal ? available.map((state) => state.cutoffReconcileAt).find((value) => value) ?? null : null,
    currentLeg: nonEmpty("currentLeg") as string | undefined,
    latestTimingPoint: latest?.name || nonEmpty("latestTimingPoint") as string | undefined,
    latestSplitTime: latest?.splitTime || nonEmpty("latestSplitTime") as string | undefined,
    estimatedFinishAt: nonFinisherTerminal ? undefined : nonEmpty("estimatedFinishAt") as string | undefined,
    pace: nonFinisherTerminal ? undefined : nonEmpty("pace") as string | undefined,
    progressPercent: nonFinisherTerminal ? undefined : richest.progressPercent,
    cumulativeTime: nonFinisherTerminal ? undefined : latest?.cumulativeTime || nonEmpty("cumulativeTime") as string | undefined,
    elapsedTime: nonFinisherTerminal ? undefined : latest?.cumulativeTime || nonEmpty("elapsedTime") as string | undefined,
    overallRank: nonFinisherTerminal ? undefined : richest.overallRank,
    genderRank: nonFinisherTerminal ? undefined : richest.genderRank,
    ageGroupRank: nonFinisherTerminal ? undefined : richest.ageGroupRank,
    splits: mergedSplits,
    lastUpdatedAt: [...available].map((state) => state.lastUpdatedAt).filter(Boolean).sort().at(-1),
  };
}

function normalizeStoredCanonicalParticipant(participant: LiveParticipant, eventId: string, fallbackUpdatedAt?: string): LiveParticipant {
  const canonicalSplits = (participant.splits ?? []).filter((split) => Boolean(split?.splitId && split?.name));
  const calculated = normalizeFeibotCalculatedResultParticipant(
    { ...participant as unknown as JsonRecord, splits: participant.splits as unknown },
    { eventId, contestId: participant.contestId },
  );
  return calculated ? mergeCanonicalParticipantState(
    { ...participant, splits: canonicalSplits },
    { ...calculated, lastUpdatedAt: calculated.lastUpdatedAt || fallbackUpdatedAt || participant.lastUpdatedAt },
  ) : participant;
}

function timingAuditKey(providerEventUuid: string, contestUuid: string, participantUuid: string): string {
  const safe = (value: string) => encodeURIComponent(value.trim());
  return `raceupshot:timing-engine:${safe(providerEventUuid)}:${safe(contestUuid)}:${safe(participantUuid)}:audit`;
}

function participantFromTimingAudit(base: LiveParticipant, audit: AthleteTimingAudit | null): LiveParticipant | null {
  if (!audit?.officialResults?.length) return null;
  const latest = audit.officialResults.at(-1)!;
  const finished = hasValidatedConfiguredFinish(audit);
  const cutoffStopped = ["DNF", "CUTOFF_PENDING"].includes(audit.state) && audit.statusSource === "AUTO_CUTOFF_RULE";
  return {
    ...base,
    participantUid: audit.participantUuid,
    bib: audit.bib || base.bib,
    raceStatus: cutoffStopped ? audit.state as "DNF" | "CUTOFF_PENDING" : finished ? "FINISHED" : "STARTED",
    statusReason: cutoffStopped ? audit.statusReason ?? null : null,
    cutoffDeadline: cutoffStopped ? audit.cutoffDeadline ?? null : null,
    cutoffReconcileAt: cutoffStopped ? audit.cutoffReconcileAt ?? null : null,
    latestTimingPoint: latest.timingPointName,
    latestSplitTime: formatDurationMs(latest.sectionTimeMs),
    elapsedTime: cutoffStopped ? undefined : formatDurationMs(latest.officialTimeMs),
    cumulativeTime: cutoffStopped ? undefined : formatDurationMs(latest.chipTimeMs),
    estimatedFinishAt: cutoffStopped ? undefined : base.estimatedFinishAt,
    splits: audit.officialResults.map((result) => ({
      splitId: result.timingPointKey,
      name: result.timingPointName,
      splitTime: formatDurationMs(result.sectionTimeMs),
      cumulativeTime: formatDurationMs(result.chipTimeMs),
      timestamp: result.readerTimestamp,
      readerTimestamp: result.readerTimestamp,
      gunStartTimestamp: result.gunStartTimestamp,
      chipStartTimestamp: result.chipStartTimestamp,
      gunTimeMs: result.gunTimeMs,
      chipTimeMs: result.chipTimeMs,
      sectionTimeMs: result.sectionTimeMs,
      officialTimeMs: result.officialTimeMs,
      source: result.source,
      status: result.status,
    })),
    timingSource: audit.timingResultSource,
    lastUpdatedAt: latest.readerTimestamp,
  };
}

function recordText(record: JsonRecord | undefined, ...keys: string[]): string {
  if (!record) return "";
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function recordNumber(record: JsonRecord | undefined, ...keys: string[]): number | null {
  const raw = recordText(record, ...keys);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function canonicalKey(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return normalized || null;
}

export function buildCanonicalParticipantIndexRows(rows: JsonRecord[], participants: LiveParticipant[], eventId: string, providerEventUuid: string): CanonicalParticipantIndexRow[] {
  const sourceByUid = new Map<string, JsonRecord>();
  for (const row of rows) {
    try {
      const participant = normalizeFeibotParticipant(row, { eventId });
      sourceByUid.set(participant.participantUid, row);
    } catch { /* Invalid provider rows were already excluded from participants. */ }
  }
  return participants.map((participant) => {
    const source = sourceByUid.get(participant.participantUid);
    const contestUuid = participant.contestId || recordText(source, "contestUuid", "contest_uuid", "ContestUUID");
    return {
      providerEventUuid: recordText(source, "providerEventUuid", "eventUuid", "event_uuid", "EventUUID") || providerEventUuid,
      participantUuid: participant.participantUid,
      providerParticipantUuid: recordText(source, "providerParticipantUuid", "provider_participant_uuid", "participantUuid", "participant_uuid", "uuid", "UUID", "id") || null,
      chipCode: recordText(source, "chipCode", "chip_code", "chip", "rfid") || null,
      waveStartTime: recordText(source, "waveStartTime", "wave_start_time") || null,
      bib: participant.bib,
      displayName: participant.displayName,
      contestUuid,
      providerContestUuid: recordText(source, "providerContestUuid", "contestUuid", "contest_uuid", "ContestUUID") || contestUuid,
      canonicalContestUuid: contestUuid,
      contestName: participant.contestName,
      genderKey: canonicalKey(participant.gender),
      ageGroupKey: canonicalKey(participant.ageGroup),
      clubName: participant.club || null,
      countryCode: participant.country || null,
      photoUrl: participant.photoUrl || null,
      trackingVisibility: participant.visibility,
      status: participant.raceStatus.toLowerCase(),
      statusReason: recordText(source, "statusReason", "status_reason") || null,
      statusSource: recordText(source, "statusSource", "status_source") || null,
      statusResolvedAt: recordText(source, "statusResolvedAt", "status_resolved_at") || null,
      failedCheckpoint: recordText(source, "failedCheckpoint", "failed_checkpoint") || null,
      cutoffSeconds: recordNumber(source, "cutoffSeconds", "cutoff_seconds"),
      cutoffDeadline: recordText(source, "cutoffDeadline", "cutoff_deadline") || null,
      elapsedAtResolution: recordNumber(source, "elapsedAtResolution", "elapsed_at_resolution"),
      currentLeg: participant.currentLeg || null,
      lastSplitKey: participant.latestTimingPoint || null,
      lastSplitLabel: participant.latestTimingPoint || null,
      overallSeconds: recordNumber(source, "overallSeconds", "overall_seconds", "chipTimeSeconds", "chip_time_seconds"),
      overallRank: participant.overallRank ?? null,
      genderRank: participant.genderRank ?? null,
      ageGroupRank: participant.ageGroupRank ?? null,
      splits: participant.splits,
      sourceParticipantUid: participant.participantUid,
      lastUpdatedAt: participant.lastUpdatedAt ?? null,
    };
  });
}

function liveParticipantFromIndex(row: CanonicalParticipantIndexRow, eventId: string): LiveParticipant {
  const displayName = row.displayName || (row.bib ? `Athlete ${row.bib}` : "Race participant");
  const storedStatus = String(row.status || "").trim().toUpperCase();
  return {
    eventId,
    participantUid: row.sourceParticipantUid || row.participantUuid,
    bib: row.bib,
    displayName,
    fullName: displayName,
    initials: displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "RU",
    photoUrl: row.photoUrl || undefined,
    contestId: row.canonicalContestUuid || row.contestUuid || undefined,
    contestName: row.contestName,
    gender: row.genderKey || undefined,
    ageGroup: row.ageGroupKey || undefined,
    country: row.countryCode || undefined,
    club: row.clubName || undefined,
    visibility: row.trackingVisibility,
    raceStatus: (storedStatus && storedStatus !== "UNKNOWN" ? storedStatus : "NOT_STARTED") as LiveParticipant["raceStatus"],
    currentLeg: row.currentLeg || undefined,
    latestTimingPoint: row.lastSplitKey || undefined,
    overallRank: row.overallRank ?? undefined,
    genderRank: row.genderRank ?? undefined,
    ageGroupRank: row.ageGroupRank ?? undefined,
    elapsedTime: row.overallSeconds != null && row.overallSeconds >= 0
      ? formatDurationMs(row.overallSeconds * 1_000)
      : undefined,
    splits: row.splits ?? [],
    lastUpdatedAt: row.lastUpdatedAt || undefined,
    timingSource: "FEIBOT",
  };
}

export async function buildAndPublishCanonicalEventVersion(input: {
  eventId: string;
  provider: "FEIBOT" | "RACE_UPSHOT";
  providerEventUuid: string;
  rows: JsonRecord[];
  eventName?: string;
  timezone?: string;
  status?: string;
  previousVersion?: string | null;
  contestMappings?: Record<string, { raceUpshotCategoryId: string; name: string }>;
  courseMaps?: EventCourseMap[];
}): Promise<CanonicalLiveManifest> {
  if (!input.eventId.trim() || !input.providerEventUuid.trim()) throw new Error("Canonical publication requires an event and provider event UUID.");
  // A canonical participant index is the complete provider roster, including
  // registered/not-started athletes. Live leaderboard ranking intentionally
  // excludes athletes without race evidence, so never use its filtered output
  // as the canonical identity set.
  const normalizedParticipants = normalizedRows(input.rows, input.eventId);
  if (input.rows.length > 0 && normalizedParticipants.length === 0) {
    throw new Error(
      `Canonical participant normalization rejected all ${input.rows.length} provider rows; the active canonical version was preserved.`,
    );
  }
  const participants = rankCanonicalFinishers(decorateLiveParticipantRanks(normalizedParticipants));
  const leaderboard = rankLiveLeaderboardParticipants(participants);
  const builtAt = new Date().toISOString();
  const version = `${builtAt.replaceAll(":", "")}-${crypto.randomUUID().slice(0, 6)}`;
  const indexRows = buildCanonicalParticipantIndexRows(input.rows, participants, input.eventId, input.providerEventUuid);
  const manifest: CanonicalLiveManifest = {
    schemaVersion: 1,
    eventId: input.eventId,
    activeVersion: version,
    previousVersion: input.previousVersion ?? null,
    provider: input.provider === "FEIBOT" ? "feibot" : "race_upshot",
    courseVersion: 1,
    participantVersion: 1,
    timingVersion: 0,
    raceDayRevision: 0,
    leaderboardVersion: 1,
    eventName: input.eventName || input.eventId,
    timezone: input.timezone || "Asia/Kolkata",
    status: input.status || "upcoming",
    participantCount: participants.length,
    contestMappings: input.contestMappings ?? {},
    // The manifest is deliberately written last: public clients can only see a fully-written version.
    completeBuildValid: true,
    publishedAt: builtAt,
    updatedAt: builtAt,
  };
  const kv = await getKv();
  const prefix = versionPrefix(input.eventId, version);
  const expectedFiles = [manifestKey(input.eventId), `${prefix}:build:status`, `${prefix}:build:validation`, `${prefix}:course`, `${prefix}:participant:index`];
  const building: CanonicalBuildStatus = { schemaVersion: 1, eventId: input.eventId, buildVersion: version, status: "building", startedAt: builtAt, completedAt: null, participantCount: participants.length, message: "Canonical build is writing version-pinned artifacts." };
  const participantIndex: CanonicalParticipantIndex = { schemaVersion: 1, eventId: input.eventId, buildVersion: version, updatedAt: builtAt, participantCount: indexRows.length, rows: indexRows };
  const course: CanonicalCourseArtifact = { schemaVersion: 1, eventId: input.eventId, buildVersion: version, updatedAt: builtAt, courseVersion: 1, maps: input.courseMaps ?? [] };
  await kv.put(`${prefix}:build:status`, JSON.stringify(building));
  await Promise.all([
    kv.put(`${prefix}:course`, JSON.stringify(course)),
    kv.put(`${prefix}:participant:index`, JSON.stringify(participantIndex)),
    ...participants.flatMap((participant) => {
      const row = indexRows.find((candidate) => candidate.sourceParticipantUid === participant.participantUid);
      const identities = new Set([
        participant.participantUid,
        participant.bib,
        row?.participantUuid,
        row?.providerParticipantUuid ?? undefined,
      ].filter((value): value is string => Boolean(value?.trim())));
      return [
        kv.put(versionedParticipantKey(input.eventId, version, participant.participantUid), JSON.stringify(participant)),
        ...[...identities].map((identity) => kv.put(
          versionedParticipantLookupKey(input.eventId, version, identity),
          participant.participantUid,
        )),
      ];
    }),
  ]);
  const errors = [
    indexRows.length !== participants.length ? `Participant index contains ${indexRows.length} rows; expected ${participants.length}.` : "",
    indexRows.some((row) => !row.participantUuid) ? "One or more participant rows have no canonical participant UUID." : "",
  ].filter(Boolean);
  const validation: CanonicalBuildValidation = { schemaVersion: 1, eventId: input.eventId, buildVersion: version, valid: errors.length === 0, checkedAt: new Date().toISOString(), errors, expectedFiles };
  const completed: CanonicalBuildStatus = { ...building, status: validation.valid ? "complete" : "failed", completedAt: new Date().toISOString(), message: validation.valid ? `Published ${participants.length} participants and ${leaderboard.length} ranked athletes.` : errors.join(" ") };
  await Promise.all([
    kv.put(`${prefix}:build:validation`, JSON.stringify(validation)),
    kv.put(`${prefix}:build:status`, JSON.stringify(completed)),
  ]);
  if (!validation.valid) throw new Error(`Canonical validation failed: ${errors.join(" ")}`);
  await kv.put(manifestKey(input.eventId), JSON.stringify(manifest));
  const manifestPersistedAt = new Date().toISOString();
  const staleIncrementalKeys = await listKeys(kv, `${PREFIX}:event:${input.eventId}:incremental:`);
  await Promise.all(staleIncrementalKeys.map((key) => kv.delete(key)));
  await kv.put(liveSummaryKey(input.eventId), JSON.stringify(summarizeParticipants(participants, version, builtAt)));
  await publishCanonicalChange({
    eventId: input.eventId,
    canonicalVersion: version,
    timingVersion: manifest.timingVersion ?? 0,
    revision: manifest.raceDayRevision ?? manifest.timingVersion ?? 0,
    reason: "canonical_rebuilt",
    updatedAt: manifest.updatedAt ?? builtAt,
    canonicalWriteCompletedAt: manifestPersistedAt,
    manifestPersistedAt,
  });
  if (participants.some(participant => participant.raceStatus === 'FINISHED')) await scheduleAutomaticResultNotifications(input.eventId);
  return manifest;
}

/**
 * Race-day reads update only the changed participant projection. They are never
 * treated as a replacement for the complete Feibot reconciliation manifest.
 */
export async function publishIncrementalCanonicalParticipants(input: {
  eventId: string;
  providerEventUuid: string;
  rows: JsonRecord[];
  participantUuid?: string;
  contestUuid?: string;
  reason?: "split_updated" | "participant_updated" | "leaderboard_updated" | "race_status_updated";
  feibotReadReceivedAt?: string;
  feibotReadAcceptedAt?: string;
  timingPointId?: string;
  chipCode?: string;
  providerReadTimestamp?: string;
}): Promise<boolean> {
  const canonicalWriteStartedAt = new Date().toISOString();
  const kv = await getKv();
  const manifest = await kv.get<CanonicalLiveManifest>(manifestKey(input.eventId), "json");
  if (!manifest?.completeBuildValid) return false;
  const version = canonicalManifestVersion(manifest);
  if (!version) return false;
  const index = await kv.get<CanonicalParticipantIndex>(`${versionPrefix(input.eventId, version)}:participant:index`, "json");
  if (index?.rows.length && !index.rows.some((row) => row.providerEventUuid === input.providerEventUuid)) return false;
  const participants = normalizedRows(input.rows, input.eventId);
  if (!participants.length) return false;
  const existing = await kv.get<IncrementalEventRecord>(incrementalKey(input.eventId), "json");
  const merged = new Map<string, LiveParticipant>();
  const baseByUid = new Map((index?.rows ?? []).map((row) => [row.sourceParticipantUid || row.participantUuid, liveParticipantFromIndex(row, input.eventId)]));
  const indexByParticipantUid = new Map<string, CanonicalParticipantIndexRow>();
  for (const row of index?.rows ?? []) {
    for (const identity of [row.sourceParticipantUid, row.participantUuid, row.providerParticipantUuid]) {
      if (identity) indexByParticipantUid.set(identity, row);
    }
  }
  if (existing?.baseVersion === version) {
    for (const participant of existing.participants ?? []) merged.set(participant.participantUid, participant);
  }
  const targeted = await Promise.all(participants.map((participant) => kv.get<IncrementalParticipantRecord>(
    incrementalParticipantKey(input.eventId, participant.participantUid), "json",
  )));
  const timingAudits = await Promise.all(participants.map((participant) => {
    const base = baseByUid.get(participant.participantUid);
    const indexRow = indexByParticipantUid.get(participant.participantUid);
    // Timing audits are keyed by Feibot's provider contest UUID. The public
    // participant projection deliberately carries the Race Upshot canonical
    // contest UUID, and those values are not guaranteed to be the same.
    const contestUuid = indexRow?.providerContestUuid || participant.contestId || base?.contestId;
    const auditParticipantUuid = indexRow?.participantUuid || participant.participantUid;
    return contestUuid
      ? kv.get<AthleteTimingAudit>(timingAuditKey(input.providerEventUuid, contestUuid, auditParticipantUuid), "json")
      : Promise.resolve(null);
  }));
  const timingParticipants = participants.map((participant, indexPosition) => participantFromTimingAudit(
    baseByUid.get(participant.participantUid) ?? participant,
    timingAudits[indexPosition],
  ));
  const previousParticipants = participants.map((participant, indexPosition) => mergeCanonicalParticipantState(
    baseByUid.get(participant.participantUid) ?? { ...participant, raceStatus: "UNKNOWN", currentLeg: undefined, latestTimingPoint: undefined, latestSplitTime: undefined, cumulativeTime: undefined, elapsedTime: undefined, splits: [] },
    merged.get(participant.participantUid),
    targeted[indexPosition]?.baseVersion === version ? targeted[indexPosition]?.participant : null,
  ));
  const currentParticipants = participants.map((participant, indexPosition) => mergeCanonicalParticipantState(
    timingParticipants[indexPosition]
      && timingParticipants[indexPosition]?.raceStatus !== "FINISHED"
      && previousParticipants[indexPosition].raceStatus === "FINISHED"
      ? { ...previousParticipants[indexPosition], raceStatus: "STARTED" }
      : timingParticipants[indexPosition]?.raceStatus === "FINISHED" && ["DNF", "CUTOFF_PENDING"].includes(previousParticipants[indexPosition].raceStatus)
        ? { ...previousParticipants[indexPosition], raceStatus: "STARTED" }
        : previousParticipants[indexPosition],
    timingParticipants[indexPosition]
      && timingParticipants[indexPosition]?.raceStatus !== "FINISHED"
      && participant.raceStatus === "FINISHED"
      ? { ...participant, raceStatus: "STARTED" }
      : timingParticipants[indexPosition]?.raceStatus === "FINISHED" && ["DNF", "CUTOFF_PENDING"].includes(participant.raceStatus)
        ? { ...participant, raceStatus: "STARTED" }
        : participant,
    timingParticipants[indexPosition],
  ));
  const timingFingerprint = (participant: LiveParticipant) => JSON.stringify({
    raceStatus: participant.raceStatus,
    currentLeg: participant.currentLeg,
    latestTimingPoint: participant.latestTimingPoint,
    latestSplitTime: participant.latestSplitTime,
    cumulativeTime: participant.cumulativeTime,
    elapsedTime: participant.elapsedTime,
    overallRank: participant.overallRank,
    genderRank: participant.genderRank,
    ageGroupRank: participant.ageGroupRank,
    splits: participant.splits.map((split) => ({
      splitId: split.splitId,
      name: split.name,
      timestamp: split.readerTimestamp || split.timestamp,
      cumulativeTime: split.cumulativeTime,
      splitTime: split.splitTime,
      gunTimeMs: split.gunTimeMs,
      chipTimeMs: split.chipTimeMs,
      sectionTimeMs: split.sectionTimeMs,
      officialTimeMs: split.officialTimeMs,
      status: split.status,
      source: split.source,
    })),
  });
  const changedParticipants = currentParticipants.filter((participant, indexPosition) =>
    timingFingerprint(participant) !== timingFingerprint(previousParticipants[indexPosition]),
  );
  if (!changedParticipants.length) return false;
  for (const participant of changedParticipants) merged.set(participant.participantUid, participant);
  const canonicalProjection = new Map(baseByUid);
  for (const participant of merged.values()) canonicalProjection.set(participant.participantUid, participant);
  const rankedFinishers = rankCanonicalFinishers(decorateLiveParticipantRanks([...canonicalProjection.values()]));
  const rankedByUid = new Map(rankedFinishers.map((participant) => [participant.participantUid, participant]));
  const publishedParticipants = changedParticipants.map((participant) => rankedByUid.get(participant.participantUid) ?? participant);
  const updatedAt = new Date().toISOString();
  await Promise.all([
    ...publishedParticipants.map((participant) => kv.put(incrementalParticipantKey(input.eventId, participant.participantUid), JSON.stringify({
      baseVersion: version,
      providerEventUuid: input.providerEventUuid,
      updatedAt,
      participant,
    }))),
    kv.put(incrementalKey(input.eventId), JSON.stringify({
    baseVersion: version,
    providerEventUuids: [...new Set([input.providerEventUuid, ...(existing && "providerEventUuids" in existing ? (existing as { providerEventUuids?: string[] }).providerEventUuids ?? [] : [])])],
    updatedAt,
    completeBuildValid: false,
    participants: [...merged.values()].map((participant) => rankedByUid.get(participant.participantUid) ?? participant),
    })),
    // Persist the contest-result projection separately from mutable timing
    // overlays. This makes a finish rank durable immediately, without a full
    // Feibot canonical rebuild.
    kv.put(incrementalLeaderboardKey(input.eventId), JSON.stringify({
      baseVersion: version,
      updatedAt,
      participants: rankedFinishers.filter((participant) => participant.raceStatus === "FINISHED"),
    })),
    kv.put(liveSummaryKey(input.eventId), JSON.stringify(summarizeParticipants(rankedFinishers, version, updatedAt))),
  ]);
  const canonicalWriteCompletedAt = new Date().toISOString();
  const revision = Math.max(0, Number(manifest.raceDayRevision ?? manifest.timingVersion ?? 0)) + 1;
  const timingVersion = revision;
  const nextManifest: CanonicalLiveManifest = {
    ...manifest,
    timingVersion,
    raceDayRevision: revision,
    leaderboardVersion: Math.max(0, Number(manifest.leaderboardVersion ?? 0)) + 1,
    updatedAt,
  };
  await kv.put(manifestKey(input.eventId), JSON.stringify(nextManifest));
  const manifestPersistedAt = new Date().toISOString();
  const acceptedAt = input.feibotReadAcceptedAt ? Date.parse(input.feibotReadAcceptedAt) : Number.NaN;
  console.info(JSON.stringify({
    type: "canonical_incremental_persisted",
    eventId: input.eventId,
    participantUuid: input.participantUuid ?? changedParticipants[0]?.participantUid ?? null,
    contestUuid: input.contestUuid ?? changedParticipants[0]?.contestId ?? null,
    timingPointId: input.timingPointId ?? null,
    chipCode: input.chipCode ?? null,
    providerReadTimestamp: input.providerReadTimestamp ?? null,
    feibotReadReceivedAt: input.feibotReadReceivedAt ?? null,
    feibotReadAcceptedAt: input.feibotReadAcceptedAt ?? null,
    canonicalWriteStartedAt,
    canonicalWriteCompletedAt,
    manifestPersistedAt,
    read_to_canonical_ms: Number.isFinite(acceptedAt) ? Date.parse(canonicalWriteCompletedAt) - acceptedAt : null,
    canonical_write_ms: Date.parse(canonicalWriteCompletedAt) - Date.parse(canonicalWriteStartedAt),
  }));
  await publishCanonicalChange({
    eventId: input.eventId,
    participantUuid: input.participantUuid ?? (changedParticipants.length === 1 ? changedParticipants[0]?.participantUid : undefined),
    contestUuid: input.contestUuid ?? (changedParticipants.length === 1 ? changedParticipants[0]?.contestId : undefined),
    canonicalVersion: version,
    timingVersion,
    revision,
    reason: input.reason ?? "participant_updated",
    updatedAt,
    canonicalWriteCompletedAt,
    manifestPersistedAt,
    feibotReadAcceptedAt: input.feibotReadAcceptedAt,
  });
  if (changedParticipants.some(participant => participant.raceStatus === 'FINISHED')) await scheduleAutomaticResultNotifications(input.eventId);
  return true;
}

export async function getCanonicalLiveEvent(eventId: string): Promise<{
  manifest: CanonicalLiveManifest;
  participants: LiveParticipant[];
  leaderboard: LiveParticipant[];
} | null> {
  const kv = await getKv();
  const manifest = await kv.get<CanonicalLiveManifest>(manifestKey(eventId), "json");
  const version = canonicalManifestVersion(manifest);
  if (!manifest?.completeBuildValid || manifest.eventId !== eventId || !version) return null;
  const prefix = versionPrefix(eventId, version);
  const [participantIndex, legacyParticipants, legacyLeaderboard, incremental] = await Promise.all([
    kv.get<CanonicalParticipantIndex>(`${prefix}:participant:index`, "json"),
    kv.get<LiveParticipant[]>(`${prefix}:participants`, "json"),
    kv.get<LiveParticipant[]>(`${prefix}:leaderboard`, "json"),
    kv.get<IncrementalEventRecord>(incrementalKey(eventId), "json"),
  ]);
  const participants = participantIndex?.rows?.map((row) => liveParticipantFromIndex(row, eventId)) ?? legacyParticipants;
  if (!participants) return null;
  const rankedParticipants = rankCanonicalFinishers(decorateLiveParticipantRanks(participants));
  const leaderboardSource = legacyLeaderboard?.length ? legacyLeaderboard : rankedParticipants;
  const leaderboard = rankLiveLeaderboardParticipants(leaderboardSource);
  if (!incremental || incremental.baseVersion !== version) return { manifest, participants: rankedParticipants, leaderboard };
  const merged = new Map(participants.map((participant) => [participant.participantUid, participant]));
  for (const participant of incremental.participants) {
    const normalized = normalizeStoredCanonicalParticipant(participant, eventId, incremental.updatedAt);
    merged.set(participant.participantUid, mergeCanonicalParticipantState(merged.get(participant.participantUid), normalized));
  }
  const currentParticipants = rankCanonicalFinishers(decorateLiveParticipantRanks([...merged.values()]));
  const currentLeaderboard = rankLiveLeaderboardParticipants(currentParticipants);
  return { manifest, participants: currentParticipants, leaderboard: currentLeaderboard };
}

export async function getCanonicalLiveManifest(eventId: string): Promise<CanonicalLiveManifest | null> {
  const kv = await getKv();
  return kv.get<CanonicalLiveManifest>(manifestKey(eventId), "json");
}

export async function getCanonicalLiveSummary(eventId: string): Promise<{
  manifest: CanonicalLiveManifest;
  participantCount: number;
  onCourse: number;
  finished: number;
  updatedAt: string | null;
} | null> {
  const kv = await getKv();
  const [manifest, summary] = await Promise.all([
    kv.get<CanonicalLiveManifest>(manifestKey(eventId), "json"),
    kv.get<CanonicalLiveSummary>(liveSummaryKey(eventId), "json"),
  ]);
  const version = canonicalManifestVersion(manifest);
  if (!manifest?.completeBuildValid || manifest.eventId !== eventId || !version) return null;
  const current = summary?.baseVersion === version ? summary : null;
  return {
    manifest,
    participantCount: current?.participantCount ?? manifest.participantCount ?? 0,
    onCourse: current?.onCourse ?? 0,
    finished: current?.finished ?? 0,
    updatedAt: current?.updatedAt ?? canonicalManifestUpdatedAt(manifest),
  };
}

/** Read the active, version-pinned canonical participant index for admin projections. */
export async function getCanonicalParticipantIndex(eventId: string): Promise<CanonicalParticipantIndex | null> {
  const kv = await getKv();
  const manifest = await kv.get<CanonicalLiveManifest>(manifestKey(eventId), "json");
  const version = canonicalManifestVersion(manifest);
  if (!manifest?.completeBuildValid || manifest.eventId !== eventId || !version) return null;
  return kv.get<CanonicalParticipantIndex>(`${versionPrefix(eventId, version)}:participant:index`, "json");
}

export async function searchCanonicalLiveParticipants(
  eventId: string,
  query: string,
  limit = 50,
): Promise<{ manifest: CanonicalLiveManifest; participants: LiveParticipant[] } | null> {
  const kv = await getKv();
  const manifest = await kv.get<CanonicalLiveManifest>(manifestKey(eventId), "json");
  const version = canonicalManifestVersion(manifest);
  if (!manifest?.completeBuildValid || manifest.eventId !== eventId || !version) return null;
  const wanted = query.trim().toLocaleLowerCase("en-US");
  if (!wanted) return { manifest, participants: [] };
  const index = await kv.get<CanonicalParticipantIndex>(`${versionPrefix(eventId, version)}:participant:index`, "json");
  if (!index) return null;
  const rows = index.rows.filter((row) =>
    row.bib.trim().toLocaleLowerCase("en-US") === wanted
    || row.displayName.toLocaleLowerCase("en-US").includes(wanted),
  ).slice(0, Math.max(1, Math.min(limit, 50)));
  const overlays = await Promise.all(rows.map((row) => kv.get<IncrementalParticipantRecord>(
    incrementalParticipantKey(eventId, row.sourceParticipantUid || row.participantUuid),
    "json",
  )));
  return {
    manifest,
    participants: rows.map((row, position) => {
      const base = liveParticipantFromIndex(row, eventId);
      const overlay = overlays[position];
      return overlay?.baseVersion === version
        ? mergeCanonicalParticipantState(base, normalizeStoredCanonicalParticipant(overlay.participant, eventId, overlay.updatedAt))
        : base;
    }),
  };
}

export async function getCanonicalLiveParticipant(eventId: string, participantUidOrBib: string): Promise<{
  manifest: CanonicalLiveManifest;
  participant: LiveParticipant;
} | null> {
  const kv = await getKv();
  const manifest = await kv.get<CanonicalLiveManifest>(manifestKey(eventId), "json");
  const version = canonicalManifestVersion(manifest);
  if (!manifest?.completeBuildValid || manifest.eventId !== eventId || !version) return null;
  const wanted = participantUidOrBib.trim();
  const prefix = versionPrefix(eventId, version);
  const [directBase, aliasUid, directOverlay] = await Promise.all([
    kv.get<LiveParticipant>(versionedParticipantKey(eventId, version, wanted), "json"),
    kv.get(versionedParticipantLookupKey(eventId, version, wanted)),
    kv.get<IncrementalParticipantRecord>(incrementalParticipantKey(eventId, wanted), "json"),
  ]);
  const resolvedUid = aliasUid?.trim() || directBase?.participantUid || directOverlay?.participant.participantUid || wanted;
  const [baseByAlias, overlayByAlias] = resolvedUid === wanted
    ? [directBase, directOverlay]
    : await Promise.all([
        kv.get<LiveParticipant>(versionedParticipantKey(eventId, version, resolvedUid), "json"),
        kv.get<IncrementalParticipantRecord>(incrementalParticipantKey(eventId, resolvedUid), "json"),
      ]);
  const fastBase = baseByAlias ?? directBase;
  const fastOverlay = overlayByAlias?.baseVersion === version ? overlayByAlias : directOverlay?.baseVersion === version ? directOverlay : null;
  if (fastBase || fastOverlay) {
    const base = fastBase ?? normalizeStoredCanonicalParticipant(fastOverlay!.participant, eventId, fastOverlay!.updatedAt);
    return { manifest, participant: fastOverlay ? mergeCanonicalParticipantState(base, normalizeStoredCanonicalParticipant(fastOverlay.participant, eventId, fastOverlay.updatedAt)) : base };
  }
  const index = await kv.get<CanonicalParticipantIndex>(`${prefix}:participant:index`, "json");
  const row = index?.rows.find((item) => item.participantUuid === wanted || item.sourceParticipantUid === wanted || item.bib === wanted);
  if (!row) return null;
  const base = liveParticipantFromIndex(row, eventId);
  const override = directOverlay?.baseVersion === version && directOverlay.participant.participantUid === (row.sourceParticipantUid || row.participantUuid)
    ? directOverlay
    : await kv.get<IncrementalParticipantRecord>(incrementalParticipantKey(eventId, row.sourceParticipantUid || row.participantUuid), "json");
  const selected = override?.baseVersion === version
    ? mergeCanonicalParticipantState(base, normalizeStoredCanonicalParticipant(override.participant, eventId, override.updatedAt))
    : base;
  return { manifest, participant: selected };
}

export async function resetCanonicalLiveEvent(eventId: string, providerEventUuid?: string): Promise<{ eventId: string; deletedVersion: string | null; deleted: number; counts: CanonicalAdminSnapshot["counts"] }> {
  const kv = await getKv();
  const manifest = await kv.get<CanonicalLiveManifest>(manifestKey(eventId), "json");
  const targets = await resetTargets(kv, eventId, manifest?.providerEventUuid || providerEventUuid);
  const keys = [...new Set([...targets.canonical, ...targets.notifications, ...targets.runtime, ...targets.timingDecisions])];
  await Promise.all(keys.map((key) => kv.delete(key)));
  return {
    eventId,
    deletedVersion: canonicalManifestVersion(manifest) || null,
    deleted: keys.length,
    counts: {
      canonicalKeys: targets.canonical.length,
      notificationMarkers: targets.notifications.length,
      userReverseIndexes: 0,
      runtimeKeys: targets.runtime.length,
      timingDecisionKeys: targets.timingDecisions.length,
      totalTargeted: keys.length,
    },
  };
}
