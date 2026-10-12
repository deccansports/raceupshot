export type RaceTimingStatus =
  | "not_started"
  | "in_progress"
  | "completed"
  | "missing_data"
  | "invalid"
  | "dnf"
  | "dns"
  | "dnq"
  | "disqualified";

export type RaceLegConfig = {
  id: string;
  name: string;
  type: string;
  order: number;
  distanceKm?: number | null;
  startSplitKey: string;
  finishSplitKey: string;
};

export type RaceSplitConfig = {
  key: string;
  name: string;
  legId: string;
  distanceInLegKm?: number | null;
  order: number;
  providerIds?: string[];
  aliases?: string[];
  passRule?: "first" | "last" | "official";
};

export type NormalizedTimingRead = {
  splitKey: string;
  splitName: string;
  elapsedSeconds: number | null;
  timeOfDay: string | null;
  timestamp: string | null;
  source: "feibot" | "manual" | "final";
  status: "valid" | "missing" | "estimated" | "invalid";
  raw: Record<string, unknown>;
};

export type RaceSectionRow = {
  key: string;
  name: string;
  splitDurationSeconds: number | null;
  /** Elapsed time within this leg. This is intentionally not race cumulative time. */
  legElapsedSeconds: number | null;
  overallElapsedSeconds: number | null;
  timeOfDay: string | null;
  metric: string | null;
  rank?: string | null;
  /** Athlete-facing distance inside the current sport leg. */
  distanceInLegKm?: number | null;
  cumulativeDistanceKm?: number | null;
  status: NormalizedTimingRead["status"];
};

export type AthleteRaceSection = {
  type: "leg" | "transition";
  id: string;
  title: string;
  shortLabel?: string;
  legType?: string;
  status: RaceTimingStatus;
  durationSeconds: number | null;
  /** Accepted timestamp of the boundary that opened an active transition. */
  startedAt?: string;
  averageMetric: string | null;
  fromSplitKey?: string;
  toSplitKey?: string;
  rows: RaceSectionRow[];
};

export type AthleteRaceTiming = {
  overallTimeSeconds: number | null;
  sections: AthleteRaceSection[];
  warnings: string[];
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

export function normalizeTimingKey(value: unknown): string {
  return text(value)
    .toLowerCase()
    .replace(/[\\/]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "_");
}

const SPLIT_ALIASES: Record<string, string[]> = {
  swim_finish: ["swim_end", "swim_out", "swim_exit"],
  bike_start: ["cycle_start"],
  bike_finish: ["cycle_finish", "cycle_end"],
  run_start: ["running_start"],
  finish: ["run_finish", "race_finish", "finish_line"],
};

function seconds(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const candidate = text(value);
  if (!candidate) return null;
  if (/^\d+(?:\.\d+)?$/.test(candidate)) return Number(candidate);
  const parts = candidate.split(":").map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some(Number.isNaN))
    return null;
  const [hours, minutes, secs] =
    parts.length === 3 ? parts : [0, parts[0], parts[1]];
  return hours * 3600 + minutes * 60 + secs;
}

function timestampSeconds(value: unknown): number | null {
  const candidate = text(value);
  if (!candidate) return null;
  const parsed = Date.parse(candidate);
  return Number.isFinite(parsed) ? parsed / 1000 : null;
}

function readPriority(read: Record<string, unknown>): number {
  const source = normalizeTimingKey(
    read.source ?? read.readSource ?? read.validationStatus,
  );
  if (/official|final|validated/.test(source)) return 3;
  if (/manual|corrected/.test(source)) return 2;
  return 1;
}

function readIdentityValues(read: Record<string, unknown>): string[] {
  return [
    read.splitKey,
    read.splitUuid,
    read.timingPointId,
    read.timingPointUuid,
    read.providerId,
    read.providerCode,
    read.id,
    read.splitName,
    read.name,
    read.label,
    read.checkpoint,
    read.timingPoint,
  ]
    .map(normalizeTimingKey)
    .filter(Boolean);
}

function configuredIdentityValues(split: RaceSplitConfig): string[] {
  const canonical = normalizeTimingKey(split.key);
  return [
    canonical,
    normalizeTimingKey(split.name),
    ...(split.providerIds ?? []).map(normalizeTimingKey),
    ...(split.aliases ?? []).map(normalizeTimingKey),
    ...(SPLIT_ALIASES[canonical] ?? []),
  ].filter(Boolean);
}

function selectDuplicateRead(
  rows: Record<string, unknown>[],
  passRule: RaceSplitConfig["passRule"],
): Record<string, unknown> | null {
  if (rows.length === 0) return null;
  const ranked = [...rows].sort((a, b) => {
    const priority = readPriority(b) - readPriority(a);
    if (priority !== 0) return priority;
    const aTime =
      seconds(a.elapsedSeconds ?? a.cumulativeElapsedSeconds ?? a.time) ??
      timestampSeconds(a.timestamp ?? a.readTimestamp) ??
      0;
    const bTime =
      seconds(b.elapsedSeconds ?? b.cumulativeElapsedSeconds ?? b.time) ??
      timestampSeconds(b.timestamp ?? b.readTimestamp) ??
      0;
    return passRule === "last" ? bTime - aTime : aTime - bTime;
  });
  return ranked[0];
}

export function normalizeTimingReads(
  configuredSplits: RaceSplitConfig[],
  rawReads: unknown[],
): Map<string, NormalizedTimingRead> {
  const reads = rawReads.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item),
  );
  const result = new Map<string, NormalizedTimingRead>();
  for (const split of configuredSplits) {
    const identities = new Set(configuredIdentityValues(split));
    const exactProviderIds = new Set(
      (split.providerIds ?? []).map(normalizeTimingKey).filter(Boolean),
    );
    const matches = reads.filter((read) => {
      const values = readIdentityValues(read);
      if (values.some((value) => exactProviderIds.has(value))) return true;
      return values.some((value) => identities.has(value));
    });
    const selected = selectDuplicateRead(matches, split.passRule);
    if (!selected) continue;
    const timestamp = text(
      selected.timestamp ??
        selected.providerTimestamp ??
        selected.readTimestamp ??
        selected.absoluteTimestamp,
    );
    const elapsed = seconds(
      selected.elapsedSeconds ??
        selected.cumulativeElapsedSeconds ??
        selected.cumulativeTimeSeconds ??
        selected.raceTimeSeconds ??
        selected.time,
    );
    const timeOfDay = text(
      selected.timeOfDay ?? selected.clockTime ?? selected.timeOfDayLabel,
    );
    const sourceKey = normalizeTimingKey(
      selected.source ?? selected.readSource ?? selected.validationStatus,
    );
    result.set(split.key, {
      splitKey: split.key,
      splitName: split.name,
      elapsedSeconds:
        elapsed ?? timestampSeconds(timestamp) ?? seconds(timeOfDay),
      timeOfDay: timeOfDay || null,
      timestamp: timestamp || null,
      source: /official|final|validated/.test(sourceKey)
        ? "final"
        : /manual|corrected/.test(sourceKey)
          ? "manual"
          : "feibot",
      status: elapsed != null || timestamp ? "valid" : "invalid",
      raw: selected,
    });
  }
  return result;
}

function durationBetween(
  start: NormalizedTimingRead | undefined,
  finish: NormalizedTimingRead | undefined,
): number | null {
  if (start?.elapsedSeconds == null || finish?.elapsedSeconds == null)
    return null;
  const duration = finish.elapsedSeconds - start.elapsedSeconds;
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
}

function metricForSegment(
  legType: string,
  secondsValue: number | null,
  distanceKm: number | null,
): string | null {
  if (
    secondsValue == null ||
    secondsValue <= 0 ||
    distanceKm == null ||
    distanceKm <= 0
  )
    return null;
  const type = normalizeTimingKey(legType);
  if (type.includes("swim")) {
    const pace = secondsValue / (distanceKm * 10);
    return `${formatDuration(pace)} /100m`;
  }
  if (type.includes("bike") || type.includes("cycle")) {
    return `${(distanceKm / (secondsValue / 3600)).toFixed(2)} km/h`;
  }
  if (type.includes("run")) {
    return `${formatDuration(secondsValue / distanceKm)} min/km`;
  }
  return null;
}

export function formatDuration(value: number | null): string {
  if (value == null || !Number.isFinite(value) || value < 0) return "—";
  const total = Math.round(value);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secondsPart = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secondsPart).padStart(2, "0")}`;
}

function sectionStatus(
  start: NormalizedTimingRead | undefined,
  finish: NormalizedTimingRead | undefined,
  invalid: boolean,
): RaceTimingStatus {
  if (invalid) return "invalid";
  if (start && finish) return "completed";
  if (start) return "in_progress";
  return "not_started";
}

export function buildAthleteRaceSections(args: {
  legs: RaceLegConfig[];
  splits: RaceSplitConfig[];
  reads: unknown[];
  athleteStatus?: string | null;
}): AthleteRaceTiming {
  const legs = [...args.legs].sort((a, b) => a.order - b.order);
  const splits = [...args.splits].sort((a, b) => a.order - b.order);
  const reads = normalizeTimingReads(splits, args.reads);
  const warnings: string[] = [];
  const sections: AthleteRaceSection[] = [];
  const statusKey = normalizeTimingKey(args.athleteStatus);
  const terminalStatus: RaceTimingStatus | null = statusKey.includes("dns")
    ? "dns"
    : statusKey.includes("dnf")
      ? "dnf"
      : statusKey.includes("dnq")
        ? "dnq"
        : /disqualified|dsq|dq/.test(statusKey)
          ? "disqualified"
          : null;

  legs.forEach((leg, legIndex) => {
    const start = reads.get(leg.startSplitKey);
    const finish = reads.get(leg.finishSplitKey);
    const legDuration = durationBetween(start, finish);
    const invalid = Boolean(start && finish && legDuration == null);
    if (invalid) warnings.push(`${leg.name} finish is earlier than its start`);
    const legSplits = splits.filter((split) => split.legId === leg.id);
    let previousSplit = legSplits.find(
      (split) => split.key === leg.startSplitKey,
    );
    const rows = legSplits
      .filter((split) => legIndex === 0 || split.key !== leg.startSplitKey)
      .map((split) => {
        const read = reads.get(split.key);
        const previousRead = previousSplit
          ? reads.get(previousSplit.key)
          : undefined;
        const splitDuration = durationBetween(previousRead, read);
        const distance =
          split.distanceInLegKm != null &&
          previousSplit?.distanceInLegKm != null
            ? split.distanceInLegKm - previousSplit.distanceInLegKm
            : null;
        const row: RaceSectionRow = {
          key: split.key,
          name: split.name,
          splitDurationSeconds: splitDuration,
          legElapsedSeconds:
            start?.elapsedSeconds != null && read?.elapsedSeconds != null
              ? Math.max(0, read.elapsedSeconds - start.elapsedSeconds)
              : null,
          overallElapsedSeconds: read?.elapsedSeconds ?? null,
          timeOfDay: read?.timeOfDay ?? read?.timestamp ?? null,
          metric: metricForSegment(leg.type, splitDuration, distance),
          status: read?.status ?? "missing",
        };
        previousSplit = split;
        return row;
      });
    sections.push({
      type: "leg",
      id: leg.id,
      title: leg.name,
      legType: leg.type,
      status:
        terminalStatus === "dns"
          ? "dns"
          : sectionStatus(start, finish, invalid),
      durationSeconds: legDuration,
      averageMetric: metricForSegment(
        leg.type,
        legDuration,
        leg.distanceKm ?? null,
      ),
      rows,
    });

    const nextLeg = legs[legIndex + 1];
    if (!nextLeg) return;
    const nextStart = reads.get(nextLeg.startSplitKey);
    const transitionDuration = durationBetween(finish, nextStart);
    const transitionInvalid = Boolean(
      finish && nextStart && transitionDuration == null,
    );
    if (transitionInvalid)
      warnings.push(`T${legIndex + 1} has an invalid timing sequence`);
    sections.push({
      type: "transition",
      id: `transition-${legIndex + 1}`,
      title: `Transition ${legIndex + 1}`,
      shortLabel: `T${legIndex + 1}`,
      status:
        terminalStatus === "dns"
          ? "dns"
          : sectionStatus(finish, nextStart, transitionInvalid),
      durationSeconds: transitionDuration,
      averageMetric: null,
      fromSplitKey: leg.finishSplitKey,
      toSplitKey: nextLeg.startSplitKey,
      rows: [
        {
          key: nextLeg.startSplitKey,
          name:
            splits.find((split) => split.key === nextLeg.startSplitKey)?.name ??
            `${nextLeg.name} Start`,
          splitDurationSeconds: transitionDuration,
          legElapsedSeconds: transitionDuration,
          overallElapsedSeconds: nextStart?.elapsedSeconds ?? null,
          timeOfDay: nextStart?.timeOfDay ?? nextStart?.timestamp ?? null,
          metric: null,
          status: nextStart?.status ?? "missing",
        },
      ],
    });
  });

  const firstStart = legs[0] ? reads.get(legs[0].startSplitKey) : undefined;
  const finalFinish = legs.at(-1)
    ? reads.get(legs.at(-1)!.finishSplitKey)
    : undefined;
  const overallTimeSeconds = durationBetween(firstStart, finalFinish);
  if (firstStart && finalFinish && overallTimeSeconds == null)
    warnings.push("Overall finish is earlier than race start");
  return { overallTimeSeconds, sections, warnings };
}
