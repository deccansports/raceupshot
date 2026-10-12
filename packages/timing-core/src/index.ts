import type {
  AthleteVisibility,
  EventLifecycleStatus,
  LiveParticipant,
  RaceStatus,
} from "../../contracts/src";

export * from "./feibot-passage-engine";

type ProviderRecord = Record<string, unknown>;

function value(record: ProviderRecord, ...keys: string[]): string {
  for (const key of keys) {
    const candidate = record[key];
    if (candidate !== undefined && candidate !== null && String(candidate).trim()) return String(candidate).trim();
  }
  return "";
}

function finiteNumber(record: ProviderRecord, ...keys: string[]): number | undefined {
  const raw = value(record, ...keys);
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function durationSeconds(input: unknown): number | undefined {
  if (typeof input === "number" && Number.isFinite(input) && input >= 0) return input;
  const text = String(input ?? "").trim();
  if (!text) return undefined;
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const parsed = Number(text);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  }
  const parts = text.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return undefined;
  if (parts.length === 3) return Math.max(0, (parts[0] * 3600) + (parts[1] * 60) + parts[2]);
  if (parts.length === 2) return Math.max(0, (parts[0] * 60) + parts[1]);
  return undefined;
}

function millisecondsSeconds(input: unknown): number | undefined {
  const parsed = Number(input);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed / 1_000 : undefined;
}

function formatDuration(seconds: number | undefined): string | undefined {
  if (seconds === undefined) return undefined;
  const milliseconds = Math.max(0, Math.round(seconds * 1_000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const wholeSeconds = Math.floor((milliseconds % 60_000) / 1_000);
  const millis = milliseconds % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function embeddedJson(input: unknown): unknown {
  let current = input;
  for (let depth = 0; depth < 3 && typeof current === "string"; depth += 1) {
    const text = current.replace(/^\uFEFF/, "").trim();
    if (!text.startsWith("{") && !text.startsWith("[")) break;
    try { current = JSON.parse(text); } catch { break; }
  }
  return current;
}

function calculatedSplitRows(record: ProviderRecord): ProviderRecord[] {
  const keys = ["splits", "SplitResults", "splitResults", "split_results", "SplitResult", "split_result", "timingPoints", "timing_points"];
  for (const key of keys) {
    const candidate = embeddedJson(record[key]);
    if (Array.isArray(candidate)) return candidate.filter((row): row is ProviderRecord => Boolean(row && typeof row === "object"));
  }
  return [];
}

function acceptedCalculatedSplit(record: ProviderRecord): boolean {
  const status = value(record, "Validity", "validity", "ResultStatus", "resultStatus", "status");
  return !/invalid|reversed|reverse|reject|disqual|error|missing|pending/i.test(status);
}

function explicitTimestamp(record: ProviderRecord): string | undefined {
  const raw = value(record, "absoluteTimestamp", "readAt", "acceptedAt", "timestamp", "detectedAt", "updatedAt");
  if (!raw || !/[T\s]\d{1,2}:\d{2}/.test(raw)) return undefined;
  const milliseconds = Date.parse(raw);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : undefined;
}

function legFromSplit(name: string): string | undefined {
  const normalized = name.trim().toUpperCase();
  if (normalized.includes("SWIM")) return "SWIM";
  if (normalized.includes("BIKE") || normalized.includes("CYCLE")) return "BIKE";
  if (normalized.includes("RUN")) return "RUN";
  return undefined;
}

/**
 * Feibot's calculated-results endpoint uses Workbench field names rather than
 * the participant-feed contract. Convert only accepted provider result rows
 * into the shared canonical participant shape before any KV publication.
 */
export function normalizeFeibotCalculatedResultParticipant(
  record: ProviderRecord,
  context: { eventId: string; contestId?: string; configuredSplitSequence?: string[] },
): LiveParticipant | null {
  const rawSplits = calculatedSplitRows(record);
  if (!rawSplits.length) return null;
  const aliases: ProviderRecord = {
    ...record,
    participantUid: value(record, "participantUid", "participantUuid", "participant_uuid", "providerParticipantUuid", "uuid", "id"),
    bib: value(record, "bib", "bibNumber", "bib_number", "Unsafe_ParticipantBib", "unsafe_participant_bib"),
    fullName: value(record, "fullName", "full_name", "name", "Unsafe_ParticipantName", "unsafe_participant_name", "ParticipantName"),
    contestId: context.contestId || value(record, "contestId", "contestUuid", "contest_uuid", "ContestUUID"),
    contestName: value(record, "contestName", "contest_name", "category", "Unsafe_ContestName", "unsafe_contest_name", "ContestName"),
    ageGroup: value(record, "ageGroup", "age_group", "ageGroupName", "Unsafe_AgeGroupName"),
  };
  let participant: LiveParticipant;
  try { participant = normalizeFeibotParticipant(aliases, context); } catch { return null; }
  let previousOfficialSeconds = 0;
  const splits = rawSplits.flatMap((split, index) => {
    if (!acceptedCalculatedSplit(split)) return [];
    const name = value(split, "Unsafe_SplitName", "unsafe_split_name", "splitName", "name", "label", "point") || `Split ${index + 1}`;
    const isStart = index === 0 && /(?:^|\s)start(?:\s|$)/i.test(name);
    const gunSeconds = durationSeconds(split.GunTimeFromStartFormated ?? split.gunTimeFromStartFormated ?? split.gun_time_from_start_formated ?? split.gunTime)
      ?? millisecondsSeconds(split.gunTimeMs);
    const chipSeconds = durationSeconds(split.ChipTimeFromStartFormated ?? split.chipTimeFromStartFormated ?? split.chip_time_from_start_formated ?? split.chipTime)
      ?? millisecondsSeconds(split.chipTimeMs);
    const sectionSeconds = durationSeconds(split.TimeSpanFormated ?? split.timeSpanFormated ?? split.time_span_formated ?? split.segmentTime)
      ?? millisecondsSeconds(split.sectionTimeMs);
    // Feibot emits 00:00:00 as a placeholder ChipTime when a calculated row
    // has no chip-start baseline. On downstream checkpoints that zero must not
    // override a real GunTime/TimeSpan; doing so published Swim Finish as
    // 00:00:00 for every athlete. Prefer a positive chip clock, then gun, and
    // finally accumulate the provider section duration.
    const officialSeconds = isStart
      ? chipSeconds ?? gunSeconds
      : chipSeconds != null && chipSeconds > 0
        ? chipSeconds
        : chipSeconds === 0 && sectionSeconds != null && sectionSeconds > 0
          ? previousOfficialSeconds + sectionSeconds
        : gunSeconds != null && gunSeconds > 0
          ? gunSeconds
          : sectionSeconds != null
            ? previousOfficialSeconds + sectionSeconds
            : chipSeconds ?? gunSeconds;
    if (officialSeconds === undefined && gunSeconds === undefined && sectionSeconds === undefined) return [];
    const timestamp = explicitTimestamp(split);
    const displaySectionSeconds = isStart
      ? chipSeconds ?? 0
      : sectionSeconds != null && sectionSeconds > 0
        ? sectionSeconds
        : officialSeconds == null
          ? undefined
          : Math.max(0, officialSeconds - previousOfficialSeconds);
    previousOfficialSeconds = officialSeconds ?? previousOfficialSeconds;
    return [{
      splitId: value(split, "splitId", "SplitUUID", "splitUuid", "split_uuid", "uuid", "id") || `split-${index + 1}`,
      name,
      splitTime: formatDuration(displaySectionSeconds) ?? "00:00:00.000",
      cumulativeTime: formatDuration(officialSeconds),
      status: value(split, "Validity", "validity", "ResultStatus", "resultStatus", "status") || "PROVISIONAL",
      timestamp,
      readerTimestamp: timestamp,
      gunTimeMs: gunSeconds === undefined ? undefined : Math.round(gunSeconds * 1_000),
      chipTimeMs: chipSeconds === undefined ? undefined : Math.round(chipSeconds * 1_000),
      sectionTimeMs: displaySectionSeconds === undefined ? undefined : Math.round(displaySectionSeconds * 1_000),
      officialTimeMs: officialSeconds === undefined ? undefined : Math.round(officialSeconds * 1_000),
      source: "FEIBOT_PROCESSED" as const,
    }];
  });
  if (!splits.length) return null;
  const latest = splits[splits.length - 1];
  const acceptedSplitIds = splits.map((split) => split.splitId);
  const configuredSequence = context.configuredSplitSequence ?? [];
  const completedConfiguredSequence = configuredSequence.length > 1
    && configuredSequence.every((splitId, index) => acceptedSplitIds[index] === splitId)
    && acceptedSplitIds.length === configuredSequence.length;
  // Provider labels such as "FINISH" and a provider-level FINISHED flag are
  // evidence, not proof of the configured race finish. The sequence engine or
  // a caller supplying the complete configured split order owns promotion.
  const raceStatus = completedConfiguredSequence ? "FINISHED" : "STARTED";
  return {
    ...participant,
    raceStatus,
    currentLeg: value(record, "currentLeg", "current_leg") || legFromSplit(latest.name),
    elapsedTime: latest.cumulativeTime,
    cumulativeTime: latest.cumulativeTime,
    latestTimingPoint: latest.name,
    latestSplitTime: latest.splitTime,
    overallRank: finiteNumber(record, "overallRank", "overall_rank", "OverallRank", "PlaceOverall"),
    genderRank: finiteNumber(record, "genderRank", "gender_rank", "GenderRank"),
    ageGroupRank: finiteNumber(record, "ageGroupRank", "age_group_rank", "AgeGroupRank"),
    splits,
    lastUpdatedAt: latest.timestamp || value(record, "lastUpdatedAt", "updatedAt", "sourceUpdatedAt") || undefined,
    timingSource: "FEIBOT_PROCESSED",
  };
}

export function normalizeRaceStatus(status: unknown): RaceStatus {
  const normalized = String(status ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  const aliases: Record<string, RaceStatus> = {
    NOTSTARTED: "NOT_STARTED",
    BIKE: "CYCLING",
    BIKING: "CYCLING",
    CYCLE: "CYCLING",
    RUN: "RUNNING",
    SWIM: "SWIMMING",
    DISQUALIFIED: "DSQ",
    DQ: "DSQ",
    DID_NOT_QUALIFY: "DNQ",
    NOT_QUALIFIED: "DNQ",
    OUT_OF_TIME_LIMIT: "OTL",
  };
  const resolved = aliases[normalized] ?? normalized;
  return [
    "NOT_STARTED", "STARTED", "SWIMMING", "T1", "CYCLING", "T2",
    "RUNNING", "CUTOFF_PENDING", "FINISHED", "DNF", "DNS", "DNQ", "DSQ", "OTL",
  ].includes(resolved) ? resolved as RaceStatus : "UNKNOWN";
}

export function normalizeEventStatus(status: unknown): EventLifecycleStatus {
  const normalized = String(status ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  const aliases: Record<string, EventLifecycleStatus> = {
    OFFICIAL: "RESULTS_OFFICIAL",
    PROVISIONAL: "RESULTS_PROVISIONAL",
    PUBLISHED: "UPCOMING",
  };
  const resolved = aliases[normalized] ?? normalized;
  return [
    "DRAFT", "UPCOMING", "REGISTRATION_OPEN", "REGISTRATION_CLOSED",
    "START_LIST_PUBLISHED", "LIVE", "PAUSED", "COMPLETED",
    "RESULTS_PROVISIONAL", "RESULTS_OFFICIAL", "ARCHIVED", "CANCELLED",
  ].includes(resolved) ? resolved as EventLifecycleStatus : "UPCOMING";
}

export function normalizeVisibility(valueToNormalize: unknown): AthleteVisibility {
  const normalized = String(valueToNormalize ?? "PUBLIC").trim().toUpperCase();
  return normalized === "PRIVATE" || normalized === "ANONYMOUS" ? normalized : "PUBLIC";
}

export function normalizeFeibotParticipant(
  record: ProviderRecord,
  context: { eventId: string; contestId?: string },
): LiveParticipant {
  const firstName = value(record, "firstName", "first_name", "firstname");
  const lastName = value(record, "lastName", "last_name", "lastname");
  const fullName = value(record, "fullName", "full_name", "name", "Unsafe_ParticipantName", "unsafe_participant_name", "ParticipantName") || [firstName, lastName].filter(Boolean).join(" ");
  const participantUid = value(record, "participantUid", "participantUuid", "uuid", "id", "participant_uuid", "providerParticipantUuid");
  if (!participantUid) throw new Error("Timing participant is missing a stable participant UID.");
  const bib = value(record, "bib", "bibNumber", "bib_number", "Unsafe_ParticipantBib", "unsafe_participant_bib");
  const providerRaceStatus = record.raceStatus ?? record.status;
  const initials = fullName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "RU";
  return {
    eventId: context.eventId,
    participantUid,
    athleteUid: value(record, "athleteUid", "athlete_uid") || undefined,
    bib,
    displayName: fullName || (bib ? `Athlete ${bib}` : "Race participant"),
    fullName: fullName || undefined,
    initials,
    contestId: context.contestId || value(record, "contestId", "contestUuid", "contest_uuid", "ContestUUID") || undefined,
    contestName: value(record, "contestName", "contest_name", "category", "Unsafe_ContestName", "unsafe_contest_name", "ContestName"),
    gender: value(record, "gender") || undefined,
    ageGroup: value(record, "ageGroup", "age_group", "ageGroupName", "age_group_name", "Unsafe_AgeGroupName") || undefined,
    country: value(record, "country", "countryCode", "country_code") || undefined,
    club: value(record, "club", "clubName", "club_name") || undefined,
    team: value(record, "team", "teamName") || undefined,
    visibility: normalizeVisibility(record.visibility ?? record.privacyStatus),
    raceStatus: providerRaceStatus == null || String(providerRaceStatus).trim() === ""
      ? "NOT_STARTED"
      : normalizeRaceStatus(providerRaceStatus),
    currentLeg: value(record, "currentLeg", "current_leg") || undefined,
    elapsedTime: value(record, "elapsedTime", "elapsed_time") || undefined,
    latestTimingPoint: value(record, "latestTimingPoint", "latest_timing_point") || undefined,
    latestSplitTime: value(record, "latestSplitTime", "latest_split_time") || undefined,
    estimatedFinishAt: value(record, "estimatedFinishAt", "estimated_finish_at") || undefined,
    overallRank: finiteNumber(record, "overallRank", "overall_rank"),
    genderRank: finiteNumber(record, "genderRank", "gender_rank"),
    ageGroupRank: finiteNumber(record, "ageGroupRank", "age_group_rank"),
    distanceCompletedKm: finiteNumber(record, "distanceCompletedKm", "distance_completed_km"),
    progressPercent: finiteNumber(record, "progressPercent", "progress_percent"),
    splits: [],
    lastUpdatedAt: value(record, "lastUpdatedAt", "updatedAt", "sourceUpdatedAt") || undefined,
    timingSource: "FEIBOT",
  };
}

export function participantMatchKeys(participant: {
  athleteUid?: string;
  participantUid?: string;
  registrationId?: string;
  verifiedEmailHash?: string;
  eventId: string;
  contestId?: string;
  bib?: string;
}): string[] {
  return [
    participant.athleteUid && `athlete:${participant.athleteUid}`,
    participant.participantUid && `participant:${participant.participantUid}`,
    participant.registrationId && `registration:${participant.registrationId}`,
    participant.verifiedEmailHash && `email:${participant.verifiedEmailHash}`,
    participant.contestId && participant.bib && `event-bib:${participant.eventId}:${participant.contestId}:${participant.bib}`,
  ].filter((key): key is string => Boolean(key));
}
