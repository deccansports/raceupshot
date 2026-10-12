import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { KVNamespace } from "@cloudflare/workers-types";
import {
  formatDurationMs,
  hasValidatedConfiguredFinish,
  normalizeFeibotCalculatedResultParticipant,
  processFeibotAthleteTiming,
  type AthleteTimingAudit,
  type FeibotProcessedTimingResult,
  type FeibotRawRead,
  type ManualTimingOverride,
  type TimingEngineConfiguration,
} from "@/packages/timing-core/src";
import { getEventPlatformSettings } from "./platform-repository";
import { getCanonicalParticipantIndex, publishIncrementalCanonicalParticipants } from "./canonical-live-tracking";
import { applyParticipantChipAssignments } from "./participant-chip-assignments";
import { getLiveTrackingHubConfig, normalizeFinalRaceSplits } from "./live-tracking-hub-config";
import { getEventBySlug } from "./raceupshot-repository";
import type { EventTicketDefinition } from "./event-ticket-definition";

const PREFIX = "raceupshot:timing-engine";

async function getKv(): Promise<KVNamespace> {
  const { env } = await getCloudflareContext({ async: true });
  if (!env.RACEUPSHOT) throw new Error("RACEUPSHOT KV binding is unavailable.");
  return env.RACEUPSHOT;
}

function safe(value: string): string {
  return encodeURIComponent(value.trim());
}

function athletePrefix(eventUuid: string, contestUuid: string, participantUuid: string): string {
  return `${PREFIX}:${safe(eventUuid)}:${safe(contestUuid)}:${safe(participantUuid)}`;
}

function auditKey(eventUuid: string, contestUuid: string, participantUuid: string): string {
  return `${athletePrefix(eventUuid, contestUuid, participantUuid)}:audit`;
}

function rawKey(read: FeibotRawRead): string {
  return `${athletePrefix(read.eventUuid, read.contestUuid, read.participantUuid)}:raw:${safe(read.readId)}`;
}

function overrideKey(eventUuid: string, contestUuid: string, participantUuid: string, overrideId: string): string {
  return `${athletePrefix(eventUuid, contestUuid, participantUuid)}:override:${safe(overrideId)}`;
}

type ProviderRecord = Record<string, unknown>;

/**
 * A physical mat can be reused at intermediate boundaries and at the race
 * finish. Its hardware role must therefore be interpreted in the context of
 * the saved race-flow row, not copied to every occurrence in the sequence.
 */
export function timingSequenceRole(
  index: number,
  count: number,
  physicalType: "START" | "SPLIT" | "FINISH" | undefined,
  isFinalRaceSplit?: boolean,
): "START" | "SPLIT" | "FINISH" {
  // Logical course position owns the role. A shared physical point can be
  // START, several intermediate boundaries, and FINISH for the same athlete.
  if (index === 0) return "START";
  if (isFinalRaceSplit === true) return "FINISH";
  if (isFinalRaceSplit === undefined && index === count - 1 && physicalType === "FINISH") return "FINISH";
  return "SPLIT";
}

export function rankAtTimingPoints(
  audits: Array<Pick<AthleteTimingAudit, "contestUuid" | "participantUuid" | "officialResults">>,
): Map<string, number> {
  const buckets = new Map<string, Array<{ participantUuid: string; time: number }>>();
  for (const audit of audits) {
    for (const result of audit.officialResults) {
      if (!Number.isFinite(result.officialTimeMs) || result.officialTimeMs < 0) continue;
      const key = `${audit.contestUuid}:${result.timingPointKey}`;
      const entries = buckets.get(key) ?? [];
      entries.push({ participantUuid: audit.participantUuid, time: result.officialTimeMs });
      buckets.set(key, entries);
    }
  }
  const ranks = new Map<string, number>();
  for (const [key, entries] of buckets) {
    entries
      .sort((left, right) => left.time - right.time || left.participantUuid.localeCompare(right.participantUuid))
      .forEach((entry, index) => ranks.set(`${key}:${entry.participantUuid}`, index + 1));
  }
  return ranks;
}

export function enforceConfiguredCutoffs(input: {
  audit: AthleteTimingAudit;
  previousAudit: AthleteTimingAudit | null;
  configuration: TimingEngineConfiguration;
  hubConfig: Awaited<ReturnType<typeof getLiveTrackingHubConfig>>;
  now: string;
  ticketDefinitions?: EventTicketDefinition[];
  waveStartTime?: string | null;
}): AthleteTimingAudit {
  const { audit, configuration, hubConfig, now } = input;
  void input.previousAudit;
  if (!hubConfig || audit.officialResults.length === 0) return audit;
  // Do not silently activate official DNF decisions for an existing event.
  // Operators must confirm its start reference, stage rules and grace period.
  if (!hubConfig.start.strictFinalCutoff) {
    const finishResults = audit.officialResults.filter((result) => result.timingPointType === "FINISH");
    const latest = audit.officialResults.at(-1);
    return finishResults.length === 1 && latest?.timingPointType === "FINISH"
      && finishResults[0]?.timingPointKey === latest.timingPointKey
      ? { ...audit, state: "FINISHED", statusReason: null, statusSource: null, statusResolvedAt: now, failedCheckpoint: null, cutoffSeconds: null, cutoffDeadline: null, cutoffReconcileAt: null, elapsedAtResolution: null }
      : audit;
  }
  // The configured cutoff clock is independent of the result/ranking clock.
  // A wave cutoff without an athlete-specific wave timestamp is not guessed.
  const start = audit.officialResults.find((result) => result.timingPointType === "START");
  if (!start) return audit;
  const baseline = hubConfig.start.timingMode === "GUN"
    ? input.waveStartTime || hubConfig.start.gunStartAt || configuration.gunStartTimestamp
    : hubConfig.start.timingMode === "WAVE"
      ? input.waveStartTime
      : start.readerTimestamp;
  const nowMs = Date.parse(now);
  const baselineMs = Date.parse(baseline || "");
  if (!Number.isFinite(nowMs) || !Number.isFinite(baselineMs)) return audit;
  const resultByKey = new Map(audit.officialResults.map((result) => [result.timingPointKey, result]));
  const configuredSplits = normalizeFinalRaceSplits(hubConfig.splits ?? [])
    .filter((split) => !split.providerContestUuid || split.providerContestUuid === configuration.contestUuid)
    .sort((left, right) => left.order - right.order);
  const configuredFinalSplit = configuredSplits.find((split) => split.isFinalRaceSplit === true);
  const ticket = input.ticketDefinitions?.find((candidate) => candidate.providerContestUuid === configuration.contestUuid);
  const ticketSplits = ticket?.splits.slice().sort((left, right) => left.order - right.order) ?? [];
  const rules: Array<{ key: string; seconds: number; reason: string }> = [];
  for (const split of configuredSplits) {
    const ticketSplit = ticketSplits.find((row) => row.id === split.id || row.name.trim().toLowerCase() === split.name.trim().toLowerCase());
    const seconds = ticket ? ticketSplit?.cutoffSeconds : split.cutoffSeconds;
    if (seconds && seconds > 0) rules.push({ key: split.id, seconds, reason: split.id === configuredFinalSplit?.id ? "OVERALL_CUTOFF_EXCEEDED" : "CHECKPOINT_CUTOFF_EXCEEDED" });
  }
  const orderedLegs = [...(hubConfig.legs ?? [])].sort((left, right) => left.order - right.order);
  for (const leg of orderedLegs) {
    const last = configuredSplits.filter((split) => split.legId === leg.id).at(-1);
    const ticketLeg = ticket?.legs.find((row) => row.id === leg.id || row.type === leg.type);
    const seconds = ticket ? ticketLeg?.cutoffSeconds : leg.cutoffSeconds;
    if (last && seconds && seconds > 0) rules.push({ key: last.id, seconds, reason: leg.type === "SWIM" ? "SWIM_CUTOFF_EXCEEDED" : leg.type === "BIKE" ? "BIKE_CUTOFF_EXCEEDED" : "CHECKPOINT_CUTOFF_EXCEEDED" });
  }
  const overallSeconds = ticket ? ticket.overallCutoffSeconds : hubConfig.start.overallCutoffSeconds;
  if (configuredFinalSplit && overallSeconds && overallSeconds > 0) {
    rules.push({ key: configuredFinalSplit.id, seconds: overallSeconds, reason: "OVERALL_CUTOFF_EXCEEDED" });
  }
  rules.sort((left, right) => left.seconds - right.seconds);
  const failure = rules.find((rule) => {
    const deadlineMs = baselineMs + rule.seconds * 1_000;
    const result = resultByKey.get(rule.key);
    // The physical reader timestamp, not the arrival time or ranking elapsed,
    // determines whether an accepted checkpoint beats its cutoff.
    if (result && Date.parse(result.readerTimestamp) <= deadlineMs) return false;
    return nowMs >= deadlineMs;
  });
  const terminalEvidence = configuredFinalSplit && resultByKey.get(configuredFinalSplit.id)?.timingPointType === "FINISH";
  if (!failure) {
    if (terminalEvidence && audit.state === "FINISHED" && !audit.statusSource) return audit;
    return terminalEvidence ? {
      ...audit, state: "FINISHED", statusReason: null, statusSource: null,
      statusResolvedAt: now, failedCheckpoint: null, cutoffSeconds: null,
      cutoffDeadline: null, cutoffReconcileAt: null, elapsedAtResolution: null,
    } : audit;
  }
  const deadlineMs = baselineMs + failure.seconds * 1_000;
  const deadline = new Date(deadlineMs).toISOString();
  const reconcileAtMs = deadlineMs + Math.max(0, hubConfig.start.cutoffReconciliationSeconds ?? 1_800) * 1_000;
  return {
    ...audit,
    state: nowMs >= reconcileAtMs ? "DNF" : "CUTOFF_PENDING",
    statusReason: failure.reason,
    statusSource: "AUTO_CUTOFF_RULE",
    statusResolvedAt: nowMs >= reconcileAtMs ? new Date(reconcileAtMs).toISOString() : deadline,
    failedCheckpoint: failure.key,
    cutoffSeconds: failure.seconds,
    cutoffDeadline: deadline,
    cutoffReconcileAt: new Date(reconcileAtMs).toISOString(),
    elapsedAtResolution: failure.seconds,
  };
}

function providerText(record: ProviderRecord, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

/** Persist provider-calculated splits as audits without creating fake antenna reads. */
export async function storeFeibotProcessedTimingAudits(input: {
  eventId: string;
  providerEventUuid: string;
  rows: ProviderRecord[];
}): Promise<number> {
  if (!input.rows.length) return 0;
  const [settings, hubConfig, participantIndex, event] = await Promise.all([
    getEventPlatformSettings(input.eventId),
    getLiveTrackingHubConfig(input.eventId),
    getCanonicalParticipantIndex(input.eventId),
    getEventBySlug(input.eventId, { includeUnpublished: true }),
  ]);
  const integration = settings?.timingIntegration;
  const gunStartTimestamp = hubConfig?.start.gunStartAt;
  if (!integration?.enabled || integration.timingResultSource !== "FEIBOT_PROCESSED" || !hubConfig || !gunStartTimestamp) return 0;
  const gunStartMs = Date.parse(gunStartTimestamp);
  if (!Number.isFinite(gunStartMs)) return 0;
  const configuredSplits = normalizeFinalRaceSplits(hubConfig.splits)
    .filter((split) => split.timingPointId)
    .sort((left, right) => left.order - right.order);
  if (configuredSplits.length < 2) return 0;
  const timingPoints = new Map(hubConfig.timingPoints.map((point) => [point.id, point]));
  const participantIndexRows = participantIndex?.rows ?? [];
  const indexByParticipant = new Map<string, (typeof participantIndexRows)[number]>();
  for (const row of participantIndexRows) {
    for (const id of [row.participantUuid, row.providerParticipantUuid, row.sourceParticipantUid]) {
      if (id) indexByParticipant.set(id, row);
    }
  }
  const fallbackContestUuid = hubConfig.contestMappings.length === 1
    ? hubConfig.contestMappings[0].providerContestUuid
    : "";
  const kv = await getKv();
  let stored = 0;
  for (const row of input.rows) {
    const participant = normalizeFeibotCalculatedResultParticipant(row, { eventId: input.eventId });
    if (!participant) continue;
    const indexed = indexByParticipant.get(participant.participantUid);
    const contestUuid = indexed?.providerContestUuid || indexed?.contestUuid || fallbackContestUuid;
    if (!contestUuid) continue;
    const orderedSplits = configuredSplits.filter((split) => !split.providerContestUuid || split.providerContestUuid === contestUuid);
    if (orderedSplits.length < 2) continue;
    const finalSplits = orderedSplits.filter((split) => split.isFinalRaceSplit === true);
    if (finalSplits.length !== 1 || finalSplits[0]?.id !== orderedSplits.at(-1)?.id) {
      throw new Error(`Contest ${contestUuid} must have exactly one final logical split at the end of its configured sequence.`);
    }
    const sequence: TimingEngineConfiguration["sequence"] = orderedSplits.map((split, index) => {
      const point = timingPoints.get(split.timingPointId!);
      return {
        timingPointKey: split.id,
        timingPointUuid: split.timingPointId!,
        name: split.name,
        type: timingSequenceRole(index, orderedSplits.length, point?.type, split.isFinalRaceSplit),
        order: split.order,
        readerUuids: point?.readerUuids ?? [],
      };
    });
    const splitById = new Map(orderedSplits.map((split) => [split.id, split]));
    const chipCode = providerText(row, "chipCode", "chip_code", "chip", "Unsafe_ParticipantChipCode", "unsafe_participant_chip_code");
    if (!chipCode) continue;
    const processedResults: FeibotProcessedTimingResult[] = participant.splits.flatMap((split) => {
      const configured = splitById.get(split.splitId);
      if (!configured?.timingPointId) return [];
      const gunTimeMs = Number.isFinite(split.gunTimeMs) ? split.gunTimeMs! : null;
      const chipTimeMs = Number.isFinite(split.chipTimeMs) ? split.chipTimeMs! : null;
      const timestampOffset = gunTimeMs ?? chipTimeMs;
      if (timestampOffset === null) return [];
      return [{
        timingPointKey: configured.id,
        timingPointUuid: configured.timingPointId,
        timingPointName: configured.name,
        readerTimestamp: new Date(gunStartMs + timestampOffset).toISOString(),
        gunTimeMs,
        chipTimeMs,
        sectionTimeMs: Number.isFinite(split.sectionTimeMs) ? split.sectionTimeMs! : null,
      }];
    });
    if (!processedResults.length) continue;
    const configuration: TimingEngineConfiguration = {
      eventUuid: input.providerEventUuid,
      contestUuid,
      timingResultSource: "FEIBOT_PROCESSED",
      resultTimeMode: integration.resultTimeMode,
      gunStartTimestamp,
      startWindowOpenTimestamp: hubConfig.start.startWindowOpenAt || gunStartTimestamp,
      startWindowCloseTimestamp: hubConfig.start.startWindowCloseAt,
      eventEndTimestamp: hubConfig.start.eventEndAt,
      passageGapMs: integration.passageGapMs,
      readerDetectionTimeoutMs: integration.readerDetectionTimeoutMs,
      minimumFinishGapMs: hubConfig.start.minimumFinishGapSeconds * 1_000,
      sequence,
    };
    const existing = await kv.get<AthleteTimingAudit>(auditKey(input.providerEventUuid, contestUuid, participant.participantUid), "json");
    const computedAudit = processFeibotAthleteTiming({
      configuration,
      rawReads: [],
      participantIdentity: { participantUuid: participant.participantUid, bib: participant.bib, chipCode },
      manualOverrides: existing?.manualOverrides ?? [],
      feibotProcessedResults: processedResults,
    });
    const audit = enforceConfiguredCutoffs({
      audit: computedAudit,
      previousAudit: existing,
      configuration,
      hubConfig,
      now: new Date().toISOString(),
      ticketDefinitions: event?.ticketDefinitions,
      waveStartTime: indexed?.waveStartTime,
    });
    if (JSON.stringify(existing) === JSON.stringify(audit)) continue;
    const prefix = athletePrefix(input.providerEventUuid, contestUuid, participant.participantUid);
    await Promise.all([
      kv.put(auditKey(input.providerEventUuid, contestUuid, participant.participantUid), JSON.stringify(audit)),
      kv.put(`${prefix}:official`, JSON.stringify(audit.officialResults)),
      kv.put(`${prefix}:passages`, JSON.stringify(audit.passages)),
      kv.put(`${prefix}:decisions`, JSON.stringify(audit.decisions)),
    ]);
    stored += 1;
  }
  return stored;
}

async function listValues<T>(kv: KVNamespace, prefix: string): Promise<T[]> {
  const values: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix, cursor, limit: 1_000 });
    const rows = await Promise.all(page.keys.map((key) => kv.get<T>(key.name, "json")));
    for (const row of rows) {
      if (row !== null) values.push(row as T);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return values;
}

export async function processAndStoreTimingBatch(input: {
  eventId: string;
  configuration: TimingEngineConfiguration;
  rawReads: FeibotRawRead[];
  manualOverrides?: ManualTimingOverride[];
  feibotProcessedResults?: FeibotProcessedTimingResult[];
}): Promise<AthleteTimingAudit[]> {
  const batchReceivedAt = new Date().toISOString();
  const kv = await getKv();
  const [settings, hubConfig, event, participantIndex] = await Promise.all([
    getEventPlatformSettings(input.eventId),
    getLiveTrackingHubConfig(input.eventId),
    getEventBySlug(input.eventId, { includeUnpublished: true }),
    getCanonicalParticipantIndex(input.eventId),
  ]);
  const integration = settings?.timingIntegration;
  if (!integration?.enabled) throw new Error("Timing integration is not enabled for this event.");
  if (integration.providerEventUuid !== input.configuration.eventUuid) {
    throw new Error("Raw reads do not belong to the configured Feibot event.");
  }
  const configuration: TimingEngineConfiguration = {
    ...input.configuration,
    sequence: [...input.configuration.sequence].sort((left, right) => left.order - right.order),
    timingResultSource: integration.timingResultSource,
    resultTimeMode: integration.resultTimeMode,
    passageGapMs: integration.passageGapMs,
    readerDetectionTimeoutMs: {
      ...input.configuration.readerDetectionTimeoutMs,
      ...integration.readerDetectionTimeoutMs,
    },
  };
  if (input.rawReads.some((read) => read.eventUuid !== configuration.eventUuid)) {
    throw new Error("One or more raw reads belong to a different Feibot event.");
  }
  if (input.rawReads.some((read) => read.contestUuid !== configuration.contestUuid)) {
    throw new Error("One or more raw reads belong to a different contest.");
  }
  const athleteKeys = new Map<string, FeibotRawRead[]>();
  for (const read of input.rawReads) {
    athleteKeys.set(read.participantUuid, [...(athleteKeys.get(read.participantUuid) ?? []), read]);
  }
  for (const override of input.manualOverrides ?? []) {
    if (!athleteKeys.has(override.participantUuid)) athleteKeys.set(override.participantUuid, []);
  }
  const audits: AthleteTimingAudit[] = [];
  const acceptedUpdates = new Map<string, {
    participantUuid: string; contestUuid: string; timingPointId: string; chipCode: string;
    providerReadTimestamp: string; feibotReadReceivedAt: string; feibotReadAcceptedAt: string;
  }>();
  const participantFeedKey = `raceupshot:live:event:${input.eventId}:participants`;
  const participantPayload = await kv.get<unknown>(participantFeedKey, "json");
  const participantRows = Array.isArray(participantPayload)
    ? participantPayload as Record<string, unknown>[]
    : participantPayload && typeof participantPayload === "object" && Array.isArray((participantPayload as { participants?: unknown[] }).participants)
      ? (participantPayload as { participants: Record<string, unknown>[] }).participants
      : [];
  for (const [participantUuid, incomingReads] of athleteKeys) {
    const prefix = athletePrefix(configuration.eventUuid, configuration.contestUuid, participantUuid);
    const [storedReads, storedOverrides, previousAudit] = await Promise.all([
      listValues<FeibotRawRead>(kv, `${prefix}:raw:`),
      listValues<ManualTimingOverride>(kv, `${prefix}:override:`),
      kv.get<AthleteTimingAudit>(auditKey(configuration.eventUuid, configuration.contestUuid, participantUuid), "json"),
    ]);
    const seed = incomingReads[0] ?? storedReads[0];
    if (!seed) throw new Error(`Cannot apply a timing override before raw identity data exists for participant ${participantUuid}.`);
    const readMap = new Map(storedReads.map((read) => [read.readId, read]));
    for (const read of incomingReads) readMap.set(read.readId, read);
    const overrideMap = new Map(storedOverrides.map((override) => [override.overrideId, override]));
    const athleteOverrides = (input.manualOverrides ?? []).filter((override) => override.participantUuid === participantUuid);
    for (const override of athleteOverrides) {
      if (override.authorized) overrideMap.set(override.overrideId, override);
    }
    const computedAudit = processFeibotAthleteTiming({
      configuration: { ...configuration, contestUuid: seed.contestUuid },
      rawReads: Array.from(readMap.values()),
      manualOverrides: Array.from(overrideMap.values()),
      feibotProcessedResults: input.feibotProcessedResults,
    });
    const audit = enforceConfiguredCutoffs({
      audit: computedAudit,
      previousAudit,
      configuration,
      hubConfig,
      now: batchReceivedAt,
      ticketDefinitions: event?.ticketDefinitions,
      waveStartTime: participantIndex?.rows.find((row) => row.participantUuid === participantUuid || row.sourceParticipantUid === participantUuid)?.waveStartTime,
    });
    const previousSignature = JSON.stringify(previousAudit?.officialResults ?? []);
    const nextSignature = JSON.stringify(audit.officialResults);
    const raceStateChanged = previousAudit?.state !== audit.state
      || previousAudit?.statusSource !== audit.statusSource;
    if ((previousSignature !== nextSignature || raceStateChanged) && audit.officialResults.length) {
      const latest = audit.officialResults.at(-1)!;
      const sourceRead = [...incomingReads]
        .sort((left, right) => Date.parse(right.readerTimestamp) - Date.parse(left.readerTimestamp))
        .find((read) => read.readerTimestamp === latest.readerTimestamp || read.timingPointUuid === latest.timingPointUuid)
        ?? incomingReads.at(-1);
      const acceptedAt = new Date().toISOString();
      acceptedUpdates.set(participantUuid, {
        participantUuid,
        contestUuid: audit.contestUuid,
        timingPointId: latest.timingPointUuid,
        chipCode: audit.chipCode,
        providerReadTimestamp: latest.readerTimestamp,
        feibotReadReceivedAt: sourceRead?.receivedAt ?? batchReceivedAt,
        feibotReadAcceptedAt: acceptedAt,
      });
      console.info(JSON.stringify({
        type: "feibot_read_accepted", eventId: input.eventId, participantUuid,
        contestUuid: audit.contestUuid, timingPointId: latest.timingPointUuid,
        chipCode: audit.chipCode, providerReadTimestamp: latest.readerTimestamp,
        feibotReadReceivedAt: sourceRead?.receivedAt ?? batchReceivedAt,
        feibotReadAcceptedAt: acceptedAt,
      }));
    }
    await Promise.all([
      ...incomingReads.map((read) => kv.put(rawKey(read), JSON.stringify(read))),
      ...athleteOverrides
        .filter((override) => override.authorized)
        .map((override) => kv.put(overrideKey(seed.eventUuid, seed.contestUuid, seed.participantUuid, override.overrideId), JSON.stringify(override))),
    ]);
    await Promise.all([
      kv.put(auditKey(seed.eventUuid, seed.contestUuid, seed.participantUuid), JSON.stringify(audit)),
      kv.put(`${prefix}:official`, JSON.stringify(audit.officialResults)),
      kv.put(`${prefix}:passages`, JSON.stringify(audit.passages)),
      kv.put(`${prefix}:decisions`, JSON.stringify(audit.decisions)),
    ]);
    audits.push(audit);
  }
  const auditByParticipant = new Map(audits.map((audit) => [audit.participantUuid, audit]));
  const auditByBib = new Map(audits.filter((audit) => audit.bib).map((audit) => [audit.bib.replace(/^0+/, ""), audit]));
  const auditByChip = new Map(audits.filter((audit) => audit.chipCode).map((audit) => [audit.chipCode.toLowerCase(), audit]));
  const storedAudits = await listEventTimingAudits(configuration.eventUuid);
  const allAuditMap = new Map(storedAudits.map((audit) => [`${audit.contestUuid}:${audit.participantUuid}`, audit]));
  for (const audit of audits) allAuditMap.set(`${audit.contestUuid}:${audit.participantUuid}`, audit);
  const finishTimes = new Map<string, number>();
  for (const audit of allAuditMap.values()) {
    const finish = hasValidatedConfiguredFinish(audit) ? audit.officialResults.at(-1) : undefined;
    if (finish) finishTimes.set(`${audit.contestUuid}:${audit.participantUuid}`, finish.officialTimeMs);
  }
  const participantMetadata = new Map(participantRows.map((participant) => {
    const participantUuid = String(participant.participantUid ?? participant.participantUuid ?? participant.participant_uuid ?? participant.uuid ?? "").trim();
    return [participantUuid, participant];
  }));
  type RankEntry = { athleteKey: string; participantUuid: string; time: number };
  const overallBuckets = new Map<string, RankEntry[]>();
  const genderBuckets = new Map<string, RankEntry[]>();
  const ageGroupBuckets = new Map<string, RankEntry[]>();
  for (const audit of allAuditMap.values()) {
    const athleteKey = `${audit.contestUuid}:${audit.participantUuid}`;
    const time = finishTimes.get(athleteKey);
    if (time === undefined) continue;
    const metadata = participantMetadata.get(audit.participantUuid);
    const gender = String(metadata?.gender ?? "").trim().toLowerCase();
    const ageGroup = String(metadata?.ageGroup ?? "").trim().toLowerCase();
    const entry = { athleteKey, participantUuid: audit.participantUuid, time };
    overallBuckets.set(audit.contestUuid, [...(overallBuckets.get(audit.contestUuid) ?? []), entry]);
    genderBuckets.set(`${audit.contestUuid}:${gender}`, [...(genderBuckets.get(`${audit.contestUuid}:${gender}`) ?? []), entry]);
    ageGroupBuckets.set(`${audit.contestUuid}:${ageGroup}`, [...(ageGroupBuckets.get(`${audit.contestUuid}:${ageGroup}`) ?? []), entry]);
  }
  const rankMap = (buckets: Map<string, RankEntry[]>) => {
    const ranks = new Map<string, number>();
    for (const entries of buckets.values()) {
      entries
        .sort((left, right) => left.time - right.time || left.participantUuid.localeCompare(right.participantUuid))
        .forEach((entry, index) => ranks.set(entry.athleteKey, index + 1));
    }
    return ranks;
  };
  const overallRanks = rankMap(overallBuckets);
  const genderRanks = rankMap(genderBuckets);
  const ageGroupRanks = rankMap(ageGroupBuckets);
  const splitRanks = rankAtTimingPoints([...allAuditMap.values()]);
  const processedParticipants = participantRows.map((participant) => {
    const participantUuid = String(participant.participantUid ?? participant.participantUuid ?? participant.participant_uuid ?? participant.uuid ?? "").trim();
    const bib = String(participant.bib ?? participant.bibNumber ?? "").trim().replace(/^0+/, "");
    const chip = String(participant.chipCode ?? participant.chip ?? "").trim().toLowerCase();
    const audit = auditByParticipant.get(participantUuid) ?? auditByBib.get(bib) ?? auditByChip.get(chip);
    if (!audit) return participant;
    const latest = audit.officialResults.at(-1);
    const finished = hasValidatedConfiguredFinish(audit);
    return {
      ...participant,
      participantUid: audit.participantUuid,
      bib: audit.bib || participant.bib,
      chipCode: audit.chipCode,
      raceStatus: audit.state === "DNF" || audit.state === "CUTOFF_PENDING" ? audit.state : finished ? "FINISHED" : audit.officialResults.length ? "STARTED" : "NOT_STARTED",
      status: audit.state === "DNF" || audit.state === "CUTOFF_PENDING" ? audit.state : finished ? "FINISHED" : audit.officialResults.length ? "STARTED" : "NOT_STARTED",
      statusReason: audit.statusReason ?? null,
      statusSource: audit.statusSource ?? null,
      statusResolvedAt: audit.statusResolvedAt ?? null,
      failedCheckpoint: audit.failedCheckpoint ?? null,
      cutoffSeconds: audit.cutoffSeconds ?? null,
      cutoffDeadline: audit.cutoffDeadline ?? null,
      cutoffReconcileAt: audit.cutoffReconcileAt ?? null,
      elapsedAtResolution: audit.elapsedAtResolution ?? null,
      latestTimingPoint: latest?.timingPointName,
      latestSplitTime: latest ? formatDurationMs(latest.sectionTimeMs) : undefined,
      elapsedTime: ["DNF", "CUTOFF_PENDING"].includes(audit.state) ? undefined : latest ? formatDurationMs(latest.officialTimeMs) : undefined,
      cumulativeTime: ["DNF", "CUTOFF_PENDING"].includes(audit.state) ? undefined : latest ? formatDurationMs(latest.chipTimeMs) : undefined,
      overallRank: finished ? overallRanks.get(`${audit.contestUuid}:${audit.participantUuid}`) : undefined,
      genderRank: finished ? genderRanks.get(`${audit.contestUuid}:${audit.participantUuid}`) : undefined,
      ageGroupRank: finished ? ageGroupRanks.get(`${audit.contestUuid}:${audit.participantUuid}`) : undefined,
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
        rankAtSplit: splitRanks.get(`${audit.contestUuid}:${result.timingPointKey}:${audit.participantUuid}`),
        source: result.source,
        status: result.status,
      })),
      timingSource: audit.timingResultSource,
      lastUpdatedAt: latest?.readerTimestamp ?? participant.lastUpdatedAt,
    };
  });
  const updatedParticipants = await applyParticipantChipAssignments(kv, input.eventId, processedParticipants);
  if (audits.length && updatedParticipants.length) {
    await Promise.all([
      kv.put(participantFeedKey, JSON.stringify({ participants: updatedParticipants })),
      kv.put(`raceupshot:live:event:${input.eventId}:updated`, new Date().toISOString()),
    ]);
    for (const update of acceptedUpdates.values()) {
      const participant = updatedParticipants.find((row) => String(row.participantUid ?? row.participantUuid ?? "") === update.participantUuid);
      if (!participant) continue;
      await publishIncrementalCanonicalParticipants({
        eventId: input.eventId,
        providerEventUuid: configuration.eventUuid,
        rows: [participant],
        reason: "split_updated",
        ...update,
      });
    }
  }
  return audits;
}

export async function getAthleteTimingAudit(
  eventUuid: string,
  contestUuid: string,
  participantUuid: string,
): Promise<AthleteTimingAudit | null> {
  const kv = await getKv();
  return kv.get<AthleteTimingAudit>(auditKey(eventUuid, contestUuid, participantUuid), "json");
}

export async function listEventTimingAudits(eventUuid: string): Promise<AthleteTimingAudit[]> {
  const kv = await getKv();
  const values: AthleteTimingAudit[] = [];
  let cursor: string | undefined;
  const prefix = `${PREFIX}:${safe(eventUuid)}:`;
  do {
    const page = await kv.list({ prefix, cursor, limit: 1_000 });
    const auditKeys = page.keys.filter((key) => key.name.endsWith(":audit"));
    const rows = await Promise.all(auditKeys.map((key) => kv.get<AthleteTimingAudit>(key.name, "json")));
    values.push(...rows.filter((row): row is AthleteTimingAudit => row !== null));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return values.sort((left, right) => left.bib.localeCompare(right.bib, undefined, { numeric: true }));
}
