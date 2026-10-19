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
import { getCanonicalLiveEvent, getCanonicalParticipantIndex, publishIncrementalCanonicalParticipants } from "./canonical-live-tracking";
import { applyParticipantChipAssignments } from "./participant-chip-assignments";
import { getLiveTrackingHubConfig, normalizeFinalRaceSplits } from "./live-tracking-hub-config";
import { getEventBySlug } from "./raceupshot-repository";
import type { EventTicketDefinition } from "./event-ticket-definition";
import { dispatchMobileTimingNotifications } from "./mobile-timing-push";

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
 * Builds the only sequence the timing engine may use: the ordered logical
 * splits imported from Feibot. A request may carry reader observations and
 * clocks, but it cannot redefine course progression or the race finish.
 */
export function authoritativeFeibotTimingSequence(
  hubConfig: NonNullable<Awaited<ReturnType<typeof getLiveTrackingHubConfig>>>,
  contestUuid: string,
  options: { requireAssignedReaders?: boolean } = {},
): TimingEngineConfiguration["sequence"] {
  const normalized = normalizeFinalRaceSplits(hubConfig.splits ?? []);
  const contestSplits = normalized.filter((split) => split.providerContestUuid === contestUuid);
  const legacyEventSplits = normalized.filter((split) => !split.providerContestUuid);
  const selected = (contestSplits.length ? contestSplits : legacyEventSplits)
    .filter((split) => split.timingPointId)
    .sort((left, right) => left.order - right.order);
  if (selected.length < 2) throw new Error(`Contest ${contestUuid} has no complete Feibot-imported split sequence.`);
  if (new Set(selected.map((split) => split.id)).size !== selected.length) {
    throw new Error(`Contest ${contestUuid} has duplicate logical split IDs in the Feibot-imported sequence.`);
  }
  if (new Set(selected.map((split) => split.order)).size !== selected.length) {
    throw new Error(`Contest ${contestUuid} has ambiguous split ordering in the Feibot-imported sequence.`);
  }
  const finalSplits = selected.filter((split) => split.isFinalRaceSplit === true);
  if (finalSplits.length !== 1 || finalSplits[0]?.id !== selected.at(-1)?.id) {
    throw new Error(`Contest ${contestUuid} must have exactly one final logical split at the end of its Feibot-imported sequence.`);
  }
  const timingPoints = new Map(hubConfig.timingPoints.map((point) => [point.id, point]));
  return selected.map((split, index) => {
    const point = timingPoints.get(split.timingPointId!);
    if (!point) throw new Error(`Feibot split ${split.id} references missing timing point ${split.timingPointId}.`);
    if (options.requireAssignedReaders !== false && !point.readerUuids.length) {
      throw new Error(`Feibot timing point ${point.id} has no assigned readers.`);
    }
    return {
      timingPointKey: split.id,
      timingPointUuid: point.id,
      name: split.name,
      type: timingSequenceRole(index, selected.length, point.type, split.isFinalRaceSplit),
      order: split.order,
      passage: Math.max(1, split.passage || 1),
      required: split.requiredForProgression ?? true,
      publicVisible: split.visible !== false,
      readerUuids: [...point.readerUuids],
    };
  });
}

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
    const scopedSplits = configuredSplits.filter((split) => split.providerContestUuid === contestUuid);
    const orderedSplits = (scopedSplits.length
      ? scopedSplits
      : configuredSplits.filter((split) => !split.providerContestUuid));
    if (orderedSplits.length < 2) continue;
    const sequence = authoritativeFeibotTimingSequence(hubConfig, contestUuid, { requireAssignedReaders: false });
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
    const prefix = athletePrefix(input.providerEventUuid, contestUuid, participant.participantUid);
    // Retain the provider's unmodified values separately from admin corrections.
    await kv.put(`${prefix}:provider-review`, JSON.stringify({ eventId: input.eventId, configuration, processedResults, receivedAt: new Date().toISOString() }));
    const savedOverrides = await listValues<ManualTimingOverride>(kv, `${prefix}:override:`);
    const overrides = new Map((existing?.manualOverrides ?? []).map((entry) => [entry.overrideId, entry]));
    for (const entry of savedOverrides) overrides.set(entry.overrideId, entry);
    let computedAudit: AthleteTimingAudit;
    try {
      computedAudit = processFeibotAthleteTiming({
        configuration, rawReads: [],
        participantIdentity: { participantUuid: participant.participantUid, bib: participant.bib, chipCode },
        manualOverrides: [...overrides.values()], feibotProcessedResults: processedResults,
      });
    } catch (error) {
      if (!overrides.size || !existing) throw error;
      // Preserve this athlete's last corrected state while retaining the new
      // provider values for review; other athletes can still update.
      await kv.put(`${prefix}:correction-conflict`, JSON.stringify(error instanceof Error ? error.message : 'Provider readings conflict with manual corrections.'));
      continue;
    }
    if (overrides.size) await kv.delete(`${prefix}:correction-conflict`);
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
    await Promise.all([
      kv.put(auditKey(input.providerEventUuid, contestUuid, participant.participantUid), JSON.stringify(audit)),
      kv.put(`${prefix}:official`, JSON.stringify(audit.officialResults)),
      kv.put(`${prefix}:passages`, JSON.stringify(audit.passages)),
      kv.put(`${prefix}:decisions`, JSON.stringify(audit.decisions)),
    ]);
    try {
      await dispatchMobileTimingNotifications({
        kv,
        eventId: input.eventId,
        previousAudit: existing,
        audit,
      });
    } catch (error) {
      // A push-provider outage must never block official timing ingestion.
      console.warn("[push] split notification delivery failed", error);
    }
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
  if (!hubConfig) throw new Error("Feibot-imported timing configuration is unavailable for this event.");
  if (integration.providerEventUuid !== input.configuration.eventUuid) {
    throw new Error("Raw reads do not belong to the configured Feibot event.");
  }
  const configuration: TimingEngineConfiguration = {
    ...input.configuration,
    // Never trust a caller-supplied logical sequence. Feibot-imported splits,
    // physical mappings, pass numbers and final-split designation are the
    // event authority.
    sequence: authoritativeFeibotTimingSequence(hubConfig, input.configuration.contestUuid),
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
    try {
      await dispatchMobileTimingNotifications({
        kv,
        eventId: input.eventId,
        previousAudit,
        audit,
      });
    } catch (error) {
      console.warn("[push] direct-read notification delivery failed", error);
    }
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

/**
 * Advance configured cutoff states without requiring a new RFID/provider read.
 * The recurring event Durable Object invokes this through the live-sync flow,
 * so CUTOFF_PENDING and DNF transitions continue when no browser is open.
 */
export async function reevaluateEventTimingCutoffs(input: {
  eventId: string;
  now?: string;
}): Promise<{ checked: number; changed: number; published: boolean }> {
  const now = input.now ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(now))) throw new Error("Cutoff sweep requires a valid timestamp.");
  const [settings, hubConfig, event, participantIndex, canonical] = await Promise.all([
    getEventPlatformSettings(input.eventId),
    getLiveTrackingHubConfig(input.eventId),
    getEventBySlug(input.eventId, { includeUnpublished: true }),
    getCanonicalParticipantIndex(input.eventId),
    getCanonicalLiveEvent(input.eventId),
  ]);
  const integration = settings?.timingIntegration;
  if (!event || !hubConfig || !integration?.enabled || !integration.providerEventUuid || !hubConfig.start.strictFinalCutoff) {
    return { checked: 0, changed: 0, published: false };
  }
  const audits = await listEventTimingAudits(integration.providerEventUuid);
  const mappedContests = new Set(hubConfig.contestMappings.map((mapping) => mapping.providerContestUuid).filter(Boolean));
  const eligible = mappedContests.size ? audits.filter((audit) => mappedContests.has(audit.contestUuid)) : audits;
  const kv = await getKv();
  const changedAudits: AthleteTimingAudit[] = [];
  for (const audit of eligible) {
    if (!audit.officialResults.length || ["FINISHED", "DNF", "DNS", "DNQ", "DSQ", "OTL"].includes(audit.state)) continue;
    let sequence: TimingEngineConfiguration["sequence"];
    try {
      sequence = authoritativeFeibotTimingSequence(hubConfig, audit.contestUuid, { requireAssignedReaders: false });
    } catch (error) {
      console.error(JSON.stringify({
        type: "automatic_cutoff_configuration_invalid",
        eventId: input.eventId,
        contestUuid: audit.contestUuid,
        participantUuid: audit.participantUuid,
        error: error instanceof Error ? error.message : String(error),
      }));
      continue;
    }
    const start = audit.officialResults.find((result) => result.timingPointType === "START");
    if (!start) continue;
    const configuration: TimingEngineConfiguration = {
      eventUuid: audit.eventUuid,
      contestUuid: audit.contestUuid,
      timingResultSource: audit.timingResultSource,
      resultTimeMode: integration.resultTimeMode,
      gunStartTimestamp: hubConfig.start.gunStartAt || start.gunStartTimestamp,
      startWindowOpenTimestamp: hubConfig.start.startWindowOpenAt || start.gunStartTimestamp,
      startWindowCloseTimestamp: hubConfig.start.startWindowCloseAt,
      eventEndTimestamp: hubConfig.start.eventEndAt,
      passageGapMs: integration.passageGapMs,
      readerDetectionTimeoutMs: integration.readerDetectionTimeoutMs,
      minimumFinishGapMs: Math.max(0, hubConfig.start.minimumFinishGapSeconds) * 1_000,
      sequence,
    };
    const waveStartTime = participantIndex?.rows.find((row) =>
      row.participantUuid === audit.participantUuid || row.sourceParticipantUid === audit.participantUuid,
    )?.waveStartTime;
    const next = enforceConfiguredCutoffs({
      audit,
      previousAudit: audit,
      configuration,
      hubConfig,
      now,
      ticketDefinitions: event.ticketDefinitions,
      waveStartTime,
    });
    const previousState = JSON.stringify({
      state: audit.state,
      statusReason: audit.statusReason,
      statusSource: audit.statusSource,
      statusResolvedAt: audit.statusResolvedAt,
      failedCheckpoint: audit.failedCheckpoint,
      cutoffDeadline: audit.cutoffDeadline,
      cutoffReconcileAt: audit.cutoffReconcileAt,
    });
    const nextState = JSON.stringify({
      state: next.state,
      statusReason: next.statusReason,
      statusSource: next.statusSource,
      statusResolvedAt: next.statusResolvedAt,
      failedCheckpoint: next.failedCheckpoint,
      cutoffDeadline: next.cutoffDeadline,
      cutoffReconcileAt: next.cutoffReconcileAt,
    });
    if (previousState === nextState) continue;
    await kv.put(auditKey(next.eventUuid, next.contestUuid, next.participantUuid), JSON.stringify(next));
    try {
      await dispatchMobileTimingNotifications({
        kv,
        eventId: input.eventId,
        previousAudit: audit,
        audit: next,
      });
    } catch (error) {
      console.warn("[push] cutoff notification delivery failed", error);
    }
    changedAudits.push(next);
  }
  if (!changedAudits.length) return { checked: eligible.length, changed: 0, published: false };
  const changedIds = new Set(changedAudits.flatMap((audit) => [audit.participantUuid, audit.bib]).filter(Boolean));
  const rows = canonical?.participants.filter((participant) =>
    changedIds.has(participant.participantUid) || changedIds.has(participant.bib),
  ) ?? [];
  const published = rows.length > 0 && await publishIncrementalCanonicalParticipants({
    eventId: input.eventId,
    providerEventUuid: integration.providerEventUuid,
    rows: rows.map((participant) => ({ ...participant })),
    reason: "race_status_updated",
  });
  console.info(JSON.stringify({
    type: "automatic_cutoff_sweep_completed",
    eventId: input.eventId,
    checked: eligible.length,
    changed: changedAudits.length,
    published,
    evaluatedAt: now,
  }));
  return { checked: eligible.length, changed: changedAudits.length, published };
}
