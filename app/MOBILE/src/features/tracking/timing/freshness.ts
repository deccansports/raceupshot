type UnknownRecord = Record<string, any>;

function records(value: unknown): UnknownRecord[] {
  if (!value || typeof value !== "object") return [];
  const root = value as UnknownRecord;
  return [
    root,
    root.data,
    root.athlete,
    root.participantLive,
    root.resolvedRaceState,
    root.data?.athlete,
    root.data?.participantLive,
    root.data?.resolvedRaceState,
    root.data?.athlete?.participantLive,
    root.data?.athlete?.resolvedRaceState,
    root.result,
    root.data?.result,
  ].filter((entry): entry is UnknownRecord =>
    Boolean(entry && typeof entry === "object"),
  );
}

export function hasCanonicalFinishEvidence(value: unknown): boolean {
  for (const record of records(value)) {
    const resolved =
      record.raceState?.resolved ?? record.resolvedRaceState ?? record;
    const status = String(
      resolved?.status ?? record.status ?? record.timingState ?? "",
    )
      .trim()
      .toUpperCase();
    const finishAccepted =
      resolved?.finalSplitAccepted === true ||
      Boolean(resolved?.finishAt ?? resolved?.finishTimeUtc) ||
      status === "FINISHED";
    const splitRows = [
      ...(Array.isArray(record.splits) ? record.splits : []),
      ...(Array.isArray(resolved?.splits) ? resolved.splits : []),
    ];
    const acceptedFinalSplit = splitRows.some((row: UnknownRecord) => {
      const key = String(
        row?.splitKey ?? row?.key ?? row?.name ?? "",
      ).toLowerCase();
      const splitStatus = String(
        row?.progressStatus ??
          row?.timingStatus ??
          row?.resultStatus ??
          row?.status ??
          "",
      )
        .trim()
        .toUpperCase();
      const accepted =
        row?.accepted === true ||
        row?.isAccepted === true ||
        ["ACCEPTED", "COMPLETED", "VALID", "FIXED", "OFFICIAL"].includes(
          splitStatus,
        );
      return (
        accepted &&
        /finish/.test(key) &&
        Boolean(
          row?.readAt ??
          row?.acceptedAt ??
          row?.absoluteTimestamp ??
          row?.timestamp ??
          row?.occurredAt,
        )
      );
    });
    if (
      finishAccepted &&
      (acceptedFinalSplit ||
        Boolean(resolved?.finishAt ?? resolved?.finishTimeUtc))
    )
      return true;
  }
  return false;
}

function acceptedSplitCount(value: unknown): number {
  let best = 0;
  for (const record of records(value)) {
    const candidates = [
      record.splits,
      record.completedSplits,
      record.raceState?.resolved?.splits,
    ];
    for (const rows of candidates) {
      if (!Array.isArray(rows)) continue;
      const count = rows.filter((row: UnknownRecord) => {
        const status = String(
          row?.progressStatus ??
            row?.timingStatus ??
            row?.resultStatus ??
            row?.status ??
            "",
        )
          .trim()
          .toUpperCase();
        const accepted =
          row?.accepted === true ||
          row?.isAccepted === true ||
          ["ACCEPTED", "COMPLETED", "VALID", "FIXED", "OFFICIAL"].includes(
            status,
          );
        return (
          accepted &&
          Boolean(
            row?.readAt ??
            row?.acceptedAt ??
            row?.absoluteTimestamp ??
            row?.timestamp ??
            row?.occurredAt,
          )
        );
      }).length;
      best = Math.max(best, count);
    }
  }
  return best;
}

function maximumNumber(value: unknown, keys: string[]): number | null {
  let result: number | null = null;
  for (const record of records(value)) {
    for (const key of keys) {
      const parsed = Number(record[key]);
      if (Number.isFinite(parsed))
        result = result === null ? parsed : Math.max(result, parsed);
    }
  }
  return result;
}

function maximumTimestamp(value: unknown): number | null {
  let result: number | null = null;
  for (const record of records(value)) {
    for (const key of ["updatedAt", "resultUpdatedAt", "lastOfficialReadAt"]) {
      const parsed = Date.parse(String(record[key] ?? ""));
      if (Number.isFinite(parsed))
        result = result === null ? parsed : Math.max(result, parsed);
    }
  }
  return result;
}

function buildTimestamp(value: unknown): number | null {
  for (const record of records(value)) {
    for (const key of ["activeVersion", "buildVersion"]) {
      const raw = String(record[key] ?? "").trim();
      const prefix = raw.match(/^(\d{4}-\d{2}-\d{2}T\d{6}(?:\.\d+)?Z)/)?.[1];
      if (!prefix) continue;
      const normalized = prefix.replace(/T(\d{2})(\d{2})(\d{2})/, "T$1:$2:$3");
      const parsed = Date.parse(normalized);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function timingSemanticFingerprint(value: unknown): string {
  return JSON.stringify(
    records(value).map((record) => {
      const resolved =
        record.raceState?.resolved ?? record.resolvedRaceState ?? record;
      const location =
        record.liveLocation ??
        record.location ??
        resolved?.liveLocation ??
        resolved?.location;
      const splitRows = [
        ...(Array.isArray(record.splits) ? record.splits : []),
        ...(Array.isArray(resolved?.splits) ? resolved.splits : []),
      ];
      return {
        status: resolved?.status ?? record.status ?? record.timingState,
        timingVersion: record.timingVersion,
        finishAt:
          resolved?.finishAt ?? resolved?.finishTimeUtc ?? record.finishAt,
        distance:
          resolved?.distanceCompletedKm ??
          resolved?.estimatedDistanceKm ??
          record.distanceCompletedKm ??
          record.estimatedDistanceKm,
        location: location
          ? {
              lat: location.lat ?? location.latitude,
              lng: location.lng ?? location.longitude,
              at: location.at ?? location.updatedAt ?? location.timestamp,
            }
          : null,
        ranks:
          record.rankings ??
          resolved?.rankings ??
          record.ranks ??
          resolved?.ranks,
        splits: splitRows.map((row: UnknownRecord) => ({
          key: row.splitKey ?? row.key ?? row.id ?? row.name,
          status:
            row.progressStatus ??
            row.timingStatus ??
            row.resultStatus ??
            row.status,
          readAt:
            row.readAt ??
            row.acceptedAt ??
            row.absoluteTimestamp ??
            row.timestamp ??
            row.occurredAt,
          elapsed: row.elapsedSeconds ?? row.elapsedTime ?? row.time,
        })),
      };
    }),
  );
}

export function preferFreshestAthleteResponse<T>(
  current: T | undefined,
  incoming: T,
): T {
  if (!current) return incoming;
  if (
    hasCanonicalFinishEvidence(current) &&
    !hasCanonicalFinishEvidence(incoming)
  )
    return current;
  const currentBuild = buildTimestamp(current);
  const incomingBuild = buildTimestamp(incoming);
  if (
    currentBuild !== null &&
    incomingBuild !== null &&
    incomingBuild < currentBuild
  )
    return current;

  const currentTiming = maximumNumber(current, ["timingVersion"]);
  const incomingTiming = maximumNumber(incoming, ["timingVersion"]);
  if (
    currentTiming !== null &&
    incomingTiming !== null &&
    incomingTiming < currentTiming
  )
    return current;

  const currentAccepted = acceptedSplitCount(current);
  const incomingAccepted = acceptedSplitCount(incoming);
  const versionDidNotAdvance =
    incomingTiming === null ||
    currentTiming === null ||
    incomingTiming <= currentTiming;
  if (versionDidNotAdvance && incomingAccepted < currentAccepted)
    return current;

  // Feibot often republishes the same processed result with only a newer
  // envelope timestamp. Returning the existing object prevents a no-op query
  // from rebuilding every athlete card and the native map once per second.
  if (
    currentAccepted === incomingAccepted &&
    timingSemanticFingerprint(current) === timingSemanticFingerprint(incoming)
  ) {
    return current;
  }

  const currentUpdated = maximumTimestamp(current);
  const incomingUpdated = maximumTimestamp(incoming);
  if (
    incomingAccepted === currentAccepted &&
    currentUpdated !== null &&
    incomingUpdated !== null &&
    incomingUpdated < currentUpdated
  )
    return current;
  return incoming;
}
