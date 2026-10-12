import type { LiveParticipant } from "@/packages/contracts/src";

const RACING_STATUSES = new Set([
  "STARTED",
  "SWIMMING",
  "T1",
  "CYCLING",
  "T2",
  "RUNNING",
  "FINISHED",
]);

function durationSeconds(value: string | undefined): number | null {
  if (!value) return null;
  const parts = value.trim().split(":").map(Number);
  if (!parts.length || parts.some((part) => !Number.isFinite(part) || part < 0)) return null;
  return parts.reduce((seconds, part) => seconds * 60 + part, 0);
}

function splitElapsedMilliseconds(
  split: LiveParticipant["splits"][number],
): number | null {
  const direct = split.officialTimeMs ?? split.chipTimeMs ?? split.gunTimeMs;
  if (direct !== undefined && Number.isFinite(direct) && direct >= 0) return direct;
  const seconds = durationSeconds(split.cumulativeTime);
  return seconds === null ? null : seconds * 1_000;
}

/** Adds a provisional rank to every accepted checkpoint independently. */
export function decorateLiveSplitRanks(
  participants: LiveParticipant[],
): LiveParticipant[] {
  const ranks = new Map<string, number>();
  const buckets = new Map<string, Array<{ participantUid: string; elapsed: number }>>();
  for (const participant of participants) {
    for (const split of participant.splits) {
      const elapsed = splitElapsedMilliseconds(split);
      if (elapsed === null) continue;
      const splitKey = split.splitId?.trim().toLowerCase() || split.name.trim().toLowerCase();
      const key = `${participant.contestId || "__event__"}:${splitKey}`;
      const rows = buckets.get(key) ?? [];
      rows.push({ participantUid: participant.participantUid, elapsed });
      buckets.set(key, rows);
    }
  }
  for (const [key, rows] of buckets) {
    rows
      .sort((left, right) => left.elapsed - right.elapsed || left.participantUid.localeCompare(right.participantUid))
      .forEach((row, index) => ranks.set(`${key}:${row.participantUid}`, index + 1));
  }
  return participants.map((participant) => ({
    ...participant,
    splits: participant.splits.map((split) => {
      const splitKey = split.splitId?.trim().toLowerCase() || split.name.trim().toLowerCase();
      const rankAtSplit = ranks.get(`${participant.contestId || "__event__"}:${splitKey}:${participant.participantUid}`);
      return rankAtSplit === undefined ? split : { ...split, rankAtSplit };
    }),
  }));
}

export type ConfiguredFinishSplit = { id: string; name: string; order: number; isFinalRaceSplit?: boolean };

export function configuredLogicalFinishSplit(
  configuredSplits: ConfiguredFinishSplit[],
): ConfiguredFinishSplit | undefined {
  const ordered = [...configuredSplits].sort((left, right) => left.order - right.order);
  const explicit = ordered.filter((split) => split.isFinalRaceSplit === true);
  if (explicit.length === 1 && explicit[0]?.id === ordered.at(-1)?.id) return explicit[0];
  if (explicit.length > 0) return undefined;
  // Backward compatibility for saved configurations created before the
  // explicit final-logical-split field existed.
  return ordered.at(-1);
}

export function acceptedConfiguredTerminalSplit(
  participant: LiveParticipant,
  configuredSplits: ConfiguredFinishSplit[],
): LiveParticipant["splits"][number] | undefined {
  const terminal = configuredLogicalFinishSplit(configuredSplits);
  if (!terminal) return undefined;
  return participant.splits.find((split) => {
    const matches = split.splitId === terminal.id
      || (Boolean(split.name?.trim())
        && Boolean(terminal.name?.trim())
        && split.name.trim().toLowerCase() === terminal.name.trim().toLowerCase());
    if (!matches) return false;
    const status = String(split.status ?? "").trim().toUpperCase();
    if (["PENDING", "MISSING", "INVALID", "REJECTED"].includes(status)) return false;
    return split.officialTimeMs !== undefined
      || split.chipTimeMs !== undefined
      || split.gunTimeMs !== undefined
      || split.sectionTimeMs !== undefined
      || Boolean(split.cumulativeTime);
  });
}

/** Resolves finish status and event-scoped ranks from the saved terminal row. */
export function resolveConfiguredFinishers(
  participants: LiveParticipant[],
  configuredSplits: ConfiguredFinishSplit[],
  options: { preserveDnf?: boolean; decorateRanks?: boolean } = {},
): LiveParticipant[] {
  const promoted = participants.map((participant) => {
    if (["CUTOFF_PENDING", "DNS", "DNQ", "DSQ", "OTL"].includes(participant.raceStatus)) return participant;
    if (participant.raceStatus === "DNF" && options.preserveDnf !== false) return participant;
    const terminal = acceptedConfiguredTerminalSplit(participant, configuredSplits);
    if (!terminal) return participant;
    const officialElapsedMs = splitElapsedMilliseconds(terminal);
    const officialElapsed = officialElapsedMs === null
      ? participant.elapsedTime
      : [Math.floor(officialElapsedMs / 3_600_000), Math.floor(officialElapsedMs % 3_600_000 / 60_000), Math.floor(officialElapsedMs % 60_000 / 1_000)]
          .map((part) => String(part).padStart(2, "0"))
          .join(":") + `.${String(Math.floor(officialElapsedMs % 1_000)).padStart(3, "0")}`;
    return {
      ...participant,
      raceStatus: "FINISHED" as const,
      resultStatus: "FINISHED",
      progressPercent: 100,
      elapsedTime: officialElapsed,
      cumulativeTime: terminal.cumulativeTime || officialElapsed,
      latestTimingPoint: terminal.name,
      latestSplitTime: terminal.splitTime || participant.latestSplitTime,
    };
  });
  // Targeted athlete endpoints must stay O(1). Their canonical records already
  // contain the latest event-scoped ranks, so do not recompute ranks from a
  // one-athlete array (which would incorrectly turn every rank into #1).
  if (options.decorateRanks === false) return promoted;
  const decorated = decorateLiveParticipantRanks(decorateLiveSplitRanks(promoted));
  const finalByUid = new Map<string, LiveParticipant>();
  const contests = new Map<string, LiveParticipant[]>();
  for (const participant of decorated) {
    if (participant.raceStatus !== "FINISHED") continue;
    const rows = contests.get(participant.contestId || "__event__") ?? [];
    rows.push(participant);
    contests.set(participant.contestId || "__event__", rows);
  }
  for (const rows of contests.values()) {
    rows.sort((left, right) =>
      (durationSeconds(left.elapsedTime ?? left.cumulativeTime) ?? Number.MAX_SAFE_INTEGER)
      - (durationSeconds(right.elapsedTime ?? right.cumulativeTime) ?? Number.MAX_SAFE_INTEGER)
      || bibTie(left, right));
    const genderTotals = new Map<string, number>();
    const ageTotals = new Map<string, number>();
    rows.forEach((row) => {
      const gender = row.gender?.trim().toLowerCase();
      const age = row.ageGroup?.trim().toLowerCase();
      if (gender) genderTotals.set(gender, (genderTotals.get(gender) ?? 0) + 1);
      if (age) ageTotals.set(age, (ageTotals.get(age) ?? 0) + 1);
    });
    const genderRanks = new Map<string, number>();
    const ageRanks = new Map<string, number>();
    rows.forEach((row, index) => {
      const gender = row.gender?.trim().toLowerCase();
      const age = row.ageGroup?.trim().toLowerCase();
      const genderRank = gender ? (genderRanks.get(gender) ?? 0) + 1 : undefined;
      const ageGroupRank = age ? (ageRanks.get(age) ?? 0) + 1 : undefined;
      if (gender && genderRank) genderRanks.set(gender, genderRank);
      if (age && ageGroupRank) ageRanks.set(age, ageGroupRank);
      finalByUid.set(row.participantUid, {
        ...row,
        overallRank: index + 1,
        overallRankTotal: rows.length,
        genderRank,
        genderRankTotal: gender ? genderTotals.get(gender) : undefined,
        ageGroupRank,
        ageGroupRankTotal: age ? ageTotals.get(age) : undefined,
      });
    });
  }
  return decorated.map((participant) => finalByUid.get(participant.participantUid) ?? participant);
}

function bibTie(left: LiveParticipant, right: LiveParticipant): number {
  const leftNumber = Number(left.bib);
  const rightNumber = Number(right.bib);
  const numeric = (Number.isFinite(leftNumber) ? leftNumber : Number.MAX_SAFE_INTEGER)
    - (Number.isFinite(rightNumber) ? rightNumber : Number.MAX_SAFE_INTEGER);
  return numeric || left.bib.localeCompare(right.bib) || left.participantUid.localeCompare(right.participantUid);
}

function compareLivePosition(left: LiveParticipant, right: LiveParticipant): number {
  const leftFinished = left.raceStatus === "FINISHED";
  const rightFinished = right.raceStatus === "FINISHED";
  if (leftFinished !== rightFinished) return leftFinished ? -1 : 1;

  if (leftFinished) {
    const elapsed = (durationSeconds(left.elapsedTime ?? left.cumulativeTime) ?? Number.MAX_SAFE_INTEGER)
      - (durationSeconds(right.elapsedTime ?? right.cumulativeTime) ?? Number.MAX_SAFE_INTEGER);
    return elapsed || bibTie(left, right);
  }

  const progress = (right.progressPercent ?? 0) - (left.progressPercent ?? 0);
  if (progress) return progress;
  const distance = (right.distanceCompletedKm ?? 0) - (left.distanceCompletedKm ?? 0);
  if (distance) return distance;
  const splits = right.splits.length - left.splits.length;
  if (splits) return splits;
  const elapsed = (durationSeconds(left.elapsedTime ?? left.cumulativeTime) ?? Number.MAX_SAFE_INTEGER)
    - (durationSeconds(right.elapsedTime ?? right.cumulativeTime) ?? Number.MAX_SAFE_INTEGER);
  return elapsed || bibTie(left, right);
}

/**
 * Produces a live ordering from canonical race state when the timing provider
 * has not published result ranks yet. This is intentionally separate from
 * final-result ranking: it only includes athletes with a confirmed race state.
 */
export function rankLiveLeaderboardParticipants(participants: LiveParticipant[]): LiveParticipant[] {
  const ranked = participants
    .filter((participant) => RACING_STATUSES.has(participant.raceStatus) || participant.splits.length > 0)
    .sort(compareLivePosition)
    .map((participant, index) => ({ ...participant, overallRank: index + 1 }));

  const genderRanks = new Map<string, number>();
  const ageGroupRanks = new Map<string, number>();
  return ranked.map((participant) => {
    const genderKey = participant.gender?.trim().toLowerCase();
    const ageGroupKey = participant.ageGroup?.trim().toLowerCase();
    const genderRank = genderKey ? (genderRanks.get(genderKey) ?? 0) + 1 : undefined;
    const ageGroupRank = ageGroupKey ? (ageGroupRanks.get(ageGroupKey) ?? 0) + 1 : undefined;
    if (genderKey && genderRank) genderRanks.set(genderKey, genderRank);
    if (ageGroupKey && ageGroupRank) ageGroupRanks.set(ageGroupKey, ageGroupRank);
    return { ...participant, genderRank, ageGroupRank };
  });
}

/** Adds provisional live ranks without dropping registered/not-started athletes. */
export function decorateLiveParticipantRanks(participants: LiveParticipant[]): LiveParticipant[] {
  const rankedByUid = new Map(
    rankLiveLeaderboardParticipants(participants).map((participant) => [participant.participantUid, participant]),
  );
  return participants.map((participant) => rankedByUid.get(participant.participantUid) ?? participant);
}
