export type StartTimingPresentationInput = {
  officialTimingMode?: unknown;
  status?: unknown;
  gunStartAt?: unknown;
  chipStartAt?: unknown;
  officialStartAt?: unknown;
  hasAcceptedStart?: boolean | null;
  eventTimezone?: unknown;
};

export type StartTimingPresentation = {
  officialTimingMode: "GUN" | "CHIP" | "WAVE";
  canonicalStatus: string;
  waitingForChipStart: boolean;
  hasAcceptedStart: boolean;
  statusLabel: string;
  gunStartAt?: number;
  chipStartAt?: number;
  officialStartAt?: number;
  gunStartLabel?: string;
  chipStartLabel?: string;
  officialStartLabel?: string;
  helperText?: string;
  showRaceClock: boolean;
  showCutoffClock: boolean;
};

function timestampMillis(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value < 10_000_000_000 ? value * 1_000 : value;
  }
  if (typeof value !== "string" || !value.trim()) return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric < 10_000_000_000 ? numeric * 1_000 : numeric;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function supportedTimezone(value: unknown): string | undefined {
  const timezone = String(value ?? "").trim();
  if (!timezone) return undefined;
  try {
    new Intl.DateTimeFormat("en-IN", { timeZone: timezone }).format(0);
    return timezone;
  } catch {
    return undefined;
  }
}

/** Formats timing timestamps for athletes without exposing provider ISO text. */
export function formatAthleteFacingTimestamp(
  value: unknown,
  eventTimezone?: unknown,
  includeDate = false,
): string | undefined {
  const timestamp = timestampMillis(value);
  if (timestamp == null) return undefined;
  const timeZone = supportedTimezone(eventTimezone);
  const options: Intl.DateTimeFormatOptions = {
    ...(timeZone ? { timeZone } : {}),
    ...(includeDate ? { day: "numeric", month: "short" } : {}),
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  };
  if (!includeDate) options.second = "2-digit";
  return new Intl.DateTimeFormat("en-IN", options).format(timestamp);
}

function timingMode(value: unknown): "GUN" | "CHIP" | "WAVE" {
  const mode = String(value ?? "")
    .trim()
    .toUpperCase();
  return mode === "CHIP" || mode === "WAVE" ? mode : "GUN";
}

export function resolveStartTimingPresentation(
  input: StartTimingPresentationInput,
): StartTimingPresentation {
  const mode = timingMode(input.officialTimingMode);
  const canonicalStatus = String(input.status ?? "")
    .trim()
    .toUpperCase();
  const gunStartAt = timestampMillis(input.gunStartAt);
  const suppliedChipStartAt = timestampMillis(input.chipStartAt);
  const suppliedOfficialStartAt = timestampMillis(input.officialStartAt);
  const terminal = ["DNS", "DNF", "DNQ", "DSQ", "FINISHED"].includes(
    canonicalStatus,
  );
  const hasAcceptedStart =
    input.hasAcceptedStart === true ||
    (input.hasAcceptedStart !== false &&
      (mode === "CHIP"
        ? suppliedChipStartAt != null
        : suppliedOfficialStartAt != null));

  // In CHIP mode the athlete clock can only be anchored by accepted START
  // evidence. A contest gun baseline is deliberately never promoted here.
  const chipStartAt =
    mode === "CHIP"
      ? hasAcceptedStart
        ? (suppliedChipStartAt ?? suppliedOfficialStartAt)
        : undefined
      : suppliedChipStartAt;
  const officialStartAt = !hasAcceptedStart
    ? undefined
    : mode === "CHIP"
      ? chipStartAt
      : mode === "GUN"
        // Gun timing is measured from the contest gun, even when the athlete's
        // accepted START passage is later. Using the passage here silently
        // turns gun time into chip time and makes Live Elapsed too short.
        ? (gunStartAt ?? suppliedOfficialStartAt)
        : suppliedOfficialStartAt ?? gunStartAt;
  const waitingForChipStart =
    mode === "CHIP" &&
    !hasAcceptedStart &&
    !terminal &&
    (canonicalStatus === "WAITING_CHIP_START" || !canonicalStatus);
  const showRaceClock = hasAcceptedStart && !terminal;

  return {
    officialTimingMode: mode,
    canonicalStatus,
    waitingForChipStart,
    hasAcceptedStart,
    statusLabel: waitingForChipStart ? "WAITING TO START" : canonicalStatus,
    gunStartAt,
    chipStartAt,
    officialStartAt,
    gunStartLabel: formatAthleteFacingTimestamp(
      gunStartAt,
      input.eventTimezone,
    ),
    chipStartLabel: formatAthleteFacingTimestamp(
      chipStartAt,
      input.eventTimezone,
    ),
    officialStartLabel: formatAthleteFacingTimestamp(
      officialStartAt,
      input.eventTimezone,
    ),
    helperText: waitingForChipStart
      ? "Your race time starts when you cross START."
      : undefined,
    showRaceClock,
    showCutoffClock: showRaceClock,
  };
}
