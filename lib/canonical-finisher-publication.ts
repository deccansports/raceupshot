import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { KVNamespace } from "@cloudflare/workers-types";
import type { LiveParticipant } from "@/packages/contracts/src";
import { resultLegTimes, type ResultLeg } from "./finisher-result-template";
import { acceptedConfiguredTerminalSplit, resolveConfiguredFinishers } from "./live-leaderboard";
import { getLiveTrackingHubConfig, type LiveTrackingHubConfig } from "./live-tracking-hub-config";
import { applyParticipantRegistrationEnrichment } from "./participant-roster-import";

type JsonRecord = Record<string, unknown>;

function durationSeconds(value: string | null | undefined): number | null {
  if (!value || !/^\d+:\d{2}:\d{2}(?:\.\d+)?$/.test(value)) return null;
  const [hours, minutes, seconds] = value.split(":").map(Number);
  const total = hours * 3_600 + minutes * 60 + seconds;
  return Number.isFinite(total) && total > 0 ? total : null;
}

function text(row: JsonRecord, ...keys: string[]): string {
  return keys.map((key) => row[key]).find((value) => value !== null && value !== undefined && String(value).trim())?.toString().trim() ?? "";
}

function configuredSequence(config: LiveTrackingHubConfig, participant: LiveParticipant) {
  const contestId = participant.contestId?.trim();
  const scoped = config.splits.filter((split) => !split.providerContestUuid || !contestId || split.providerContestUuid === contestId);
  return [...(scoped.length ? scoped : config.splits)].sort((left, right) => left.order - right.order);
}

function canonicalTriathlonLegTimes(participant: LiveParticipant): ResultLeg[] | null {
  const normalized = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  const byName = new Map(participant.splits.map((split) => [normalized(split.name), split]));
  const elapsed = (name: string) => {
    const split = byName.get(normalized(name));
    const milliseconds = split?.officialTimeMs ?? split?.chipTimeMs;
    return Number.isFinite(milliseconds) && milliseconds! >= 0 ? milliseconds! / 1_000 : null;
  };
  const swimStart = elapsed("Swim Start");
  const swimFinish = elapsed("Swim Finish");
  const bikeStart = elapsed("Bike Start");
  const bikeFinish = elapsed("Bike Finish");
  const runStart = elapsed("Run Start");
  const raceFinish = elapsed("Race Finish") ?? elapsed("Finish");
  if ([swimStart, swimFinish, bikeStart, bikeFinish, runStart, raceFinish].some((value) => value === null)) return null;
  const rows: ResultLeg[] = [
    { name: "SWIM", time: swimFinish! - swimStart! },
    { name: "T1", time: bikeStart! - swimFinish! },
    { name: "BIKE", time: bikeFinish! - bikeStart! },
    { name: "T2", time: runStart! - bikeFinish! },
    { name: "RUN", time: raceFinish! - runStart! },
  ];
  return rows.every((row) => Number.isFinite(row.time) && row.time > 0) ? rows : null;
}

export function canonicalFinisherResultRecord(
  participant: LiveParticipant,
  config: LiveTrackingHubConfig,
  contact: JsonRecord = {},
): JsonRecord | null {
  const sequence = configuredSequence(config, participant);
  const resolved = resolveConfiguredFinishers([participant], sequence, { preserveDnf: true, decorateRanks: false })[0];
  if (!resolved || resolved.raceStatus !== "FINISHED") return null;
  const terminal = acceptedConfiguredTerminalSplit(resolved, sequence);
  const overallTime = durationSeconds(resolved.elapsedTime);
  if (!terminal || overallTime === null || !(terminal.readerTimestamp || terminal.timestamp)) return null;
  const mappedContest = config.contestMappings.find((mapping) => mapping.providerContestUuid === resolved.contestId);
  const category = mappedContest?.contestId.trim() || resolved.contestName?.trim();
  const contestId = mappedContest?.contestId.trim() || resolved.contestId || category;
  if (!category || !resolved.participantUid.trim() || !resolved.bib.trim()) return null;
  const finishAt = terminal.readerTimestamp || terminal.timestamp || "";
  return {
    id: `canonical-${resolved.participantUid}`,
    notificationSourceId: resolved.participantUid,
    participantUid: resolved.participantUid,
    participantUuid: resolved.participantUid,
    bib: resolved.bib,
    "Bib Number": resolved.bib,
    name: resolved.fullName || resolved.displayName,
    Name: resolved.fullName || resolved.displayName,
    email: text(contact, "email", "emailAddress").toLowerCase(),
    mobile: text(contact, "mobile", "phone", "mobileNumber"),
    category,
    Category: category,
    contestName: category,
    contestId,
    ticketId: contestId,
    providerContestUuid: resolved.contestId || null,
    providerContestName: resolved.contestName || null,
    status: "FINISHED",
    raceStatus: "FINISHED",
    published: true,
    provisional: false,
    overallTime,
    chipTime: overallTime,
    gunTime: Number.isFinite(terminal.gunTimeMs) ? terminal.gunTimeMs! / 1_000 : null,
    finishTime: resolved.elapsedTime,
    finishTimeOfDay: finishAt,
    gender: resolved.gender || "",
    ageGroup: resolved.ageGroup || "",
    overallRank: resolved.overallRank ?? null,
    genderRank: resolved.genderRank ?? null,
    categoryRank: resolved.ageGroupRank ?? null,
    legTimes: canonicalTriathlonLegTimes(resolved) ?? resultLegTimes(config.legs, sequence, resolved.splits),
    splits: resolved.splits.map((split) => ({
      id: split.splitId,
      name: split.name,
      time: Number.isFinite(split.officialTimeMs ?? split.chipTimeMs) ? (split.officialTimeMs ?? split.chipTimeMs)! / 1_000 : null,
      officialTimeMs: split.officialTimeMs ?? split.chipTimeMs ?? null,
      timestamp: split.timestamp,
      readerTimestamp: split.readerTimestamp,
    })),
    source: "CANONICAL_FEIBOT",
    importedAt: new Date().toISOString(),
  };
}

/** Publishes only confirmed canonical finishers into the notification result index. */
export async function publishCanonicalFinisherResults(eventId: string, participants: LiveParticipant[]): Promise<number> {
  const config = await getLiveTrackingHubConfig(eventId);
  if (!config) return 0;
  const { env } = await getCloudflareContext({ async: true });
  const kv = env.RACEUPSHOT as KVNamespace | undefined;
  if (!kv) throw new Error("Result storage is unavailable.");
  const enriched = await applyParticipantRegistrationEnrichment(kv, eventId, participants as unknown as JsonRecord[]);
  const records = participants.flatMap((participant, index) => {
    const record = canonicalFinisherResultRecord(participant, config, enriched[index] ?? {});
    return record ? [record] : [];
  });
  if (!records.length) return 0;
  const indexKey = `raceupshot:event:${eventId}:results:index`;
  const existingIds = await kv.get<string[]>(indexKey, "json") ?? [];
  const ids = records.map((record) => String(record.id));
  const eventKey = `raceupshot:event:${eventId}`;
  const event = await kv.get<JsonRecord>(eventKey, "json");
  await Promise.all([
    ...records.map((record) => kv.put(`raceupshot:event:${eventId}:result:${record.id}`, JSON.stringify(record))),
    kv.put(indexKey, JSON.stringify([...new Set([...existingIds, ...ids])])),
    ...(event ? [kv.put(eventKey, JSON.stringify({ ...event, hasResults: true, updatedAt: new Date().toISOString() }))] : []),
  ]);
  return records.length;
}

/** Idempotent repair path used by tracing so already-finished canonical rows appear without another provider fetch. */
export async function reconcileCanonicalFinisherResults(eventId: string): Promise<number> {
  const { getCanonicalLiveEvent } = await import("./canonical-live-tracking");
  const canonical = await getCanonicalLiveEvent(eventId);
  return canonical ? publishCanonicalFinisherResults(eventId, canonical.participants) : 0;
}
