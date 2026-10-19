export type LiveCutoffConfiguration = {
  mode?: string;
  overall?: string;
  swim?: string;
  bike?: string;
  run?: string;
};

export type LiveCutoffDetail = {
  header?: { status?: string };
  raceStartedAt?: number;
  raceProgress?: { legLabel?: string };
  cutoffs?: { label: string; value: string }[];
  timeline?: {
    segment?: string;
    name?: string;
    splitLabel?: string;
    elapsedTimeLabel?: string;
    timeLabel?: string;
  }[];
};

function durationSeconds(value: unknown): number | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (raw.includes(":")) {
    const parts = raw.split(":").map(Number);
    if (parts.length < 2 || parts.length > 3 || parts.some(Number.isNaN)) {
      return null;
    }
    const [hours, minutes, seconds] =
      parts.length === 3 ? parts : [0, parts[0], parts[1]];
    return hours * 3600 + minutes * 60 + seconds;
  }
  const hours = Number(raw.match(/(\d+(?:\.\d+)?)\s*h/)?.[1] ?? 0);
  const minutes = Number(raw.match(/(\d+(?:\.\d+)?)\s*m/)?.[1] ?? 0);
  const seconds = Number(raw.match(/(\d+(?:\.\d+)?)\s*s/)?.[1] ?? 0);
  if (hours || minutes || seconds) return hours * 3600 + minutes * 60 + seconds;
  const numeric = Number(raw.replace(/\s*(?:minutes?|mins?|cutoff)\s*/g, ""));
  // Bare configured cutoff values are minutes throughout the event settings.
  return Number.isFinite(numeric) && numeric >= 0 ? numeric * 60 : null;
}

function normalized(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function activeLeg(value: unknown): "swim" | "bike" | "run" | null {
  const label = normalized(value);
  if (/\bswim\b/.test(label)) return "swim";
  if (/\b(?:bike|cycle)\b/.test(label)) return "bike";
  if (/\brun\b/.test(label)) return "run";
  return null;
}

/**
 * True only while a live athlete has passed a configured cutoff but the
 * backend has not yet published the next official split or terminal result.
 */
export function isLiveTimingAwaitingCutoffUpdate({
  detail,
  cutoffs,
  nowMs,
  elapsedSeconds,
}: {
  detail?: LiveCutoffDetail;
  cutoffs?: LiveCutoffConfiguration;
  nowMs: number;
  elapsedSeconds?: number | null;
}): boolean {
  if (normalized(detail?.header?.status) !== "live") return false;

  const raceElapsed =
    elapsedSeconds != null && Number.isFinite(elapsedSeconds)
      ? Math.max(0, elapsedSeconds)
      : detail?.raceStartedAt != null && Number.isFinite(detail.raceStartedAt)
        ? Math.max(0, (nowMs - detail.raceStartedAt) / 1_000)
        : null;
  if (raceElapsed == null) return false;

  const rows = detail?.cutoffs ?? [];
  const overallSeconds =
    durationSeconds(cutoffs?.overall) ??
    durationSeconds(
      rows.find((row) => {
        const label = normalized(row.label);
        return /\boverall\b/.test(label) || /^finish\s+cutoff$/.test(label);
      })?.value,
    );
  if (overallSeconds != null && raceElapsed > overallSeconds) return true;

  const leg = activeLeg(detail?.raceProgress?.legLabel);
  if (!leg) return false;
  const aliases =
    leg === "bike"
      ? /\b(?:bike|cycle)\b/i
      : new RegExp(`\\b${leg}\\b`, "i");
  const legSeconds =
    durationSeconds(cutoffs?.[leg]) ??
    durationSeconds(
      rows.find(
        (row) =>
          !/\boverall\b/i.test(row.label) &&
          aliases.test(row.label),
      )?.value,
    );
  if (legSeconds == null) return false;

  const mode = normalized(cutoffs?.mode);
  if (!mode.includes("leg") && !mode.includes("segment")) {
    return raceElapsed > legSeconds;
  }

  if (leg === "swim") return raceElapsed > legSeconds;
  const startRow = (detail?.timeline ?? []).find((row) => {
    const identity = normalized(`${row.segment} ${row.name} ${row.splitLabel}`);
    return aliases.test(identity) && /\bstart\b/.test(identity);
  });
  const legStartElapsed = durationSeconds(
    startRow?.elapsedTimeLabel || startRow?.timeLabel,
  );
  // A leg-relative cutoff is unsafe to infer until its official start split is
  // known. Continue showing the last official state instead of inventing zero.
  if (legStartElapsed == null) return false;
  return raceElapsed - legStartElapsed > legSeconds;
}
