import type { AthleteRaceTiming } from "./raceSections";

const normalizedWords = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

export function transitionDurationForStage(
  raceTiming: AthleteRaceTiming | undefined,
  stage: string,
): number | null {
  const key = stage.trim().toLowerCase();
  if (key !== "t1" && key !== "t2") return null;

  const transitions = raceTiming?.sections.filter(
    (section) => section.type === "transition",
  ) ?? [];
  const explicitlyNamed = transitions.find(
    (section) =>
      normalizedWords(
        `${section.shortLabel ?? ""} ${section.id} ${section.title}`,
      ).includes(key),
  );
  // Older/canonical providers can publish generic transition names while
  // preserving course order. T1 is the first transition and T2 the second.
  const transition = explicitlyNamed ?? transitions[key === "t1" ? 0 : 1];
  const rowDuration = transition?.rows
    .flatMap((row) => [row.splitDurationSeconds, row.legElapsedSeconds])
    .find((value): value is number => value != null && Number.isFinite(value));
  const duration = transition?.durationSeconds ?? rowDuration;
  return duration != null && Number.isFinite(duration)
    ? Math.max(0, duration)
    : null;
}

export function liveTransitionElapsedSeconds(
  raceTiming: AthleteRaceTiming | undefined,
  stage: string,
  nowMs = Date.now(),
): number | null {
  const key = stage.trim().toLowerCase();
  if (key !== "t1" && key !== "t2") return null;
  const transitions =
    raceTiming?.sections.filter((section) => section.type === "transition") ?? [];
  const explicitlyNamed = transitions.find((section) =>
    normalizedWords(
      `${section.shortLabel ?? ""} ${section.id} ${section.title}`,
    ).includes(key),
  );
  const transition = explicitlyNamed ?? transitions[key === "t1" ? 0 : 1];
  if (transition?.status !== "in_progress" || !transition.startedAt) return null;
  const startedAtMs = Date.parse(transition.startedAt);
  if (!Number.isFinite(startedAtMs)) return null;
  return Math.max(0, Math.floor((nowMs - startedAtMs) / 1_000));
}

type TransitionTimelineRow = {
  segment?: string;
  name?: string;
  splitLabel?: string;
  splitTimeLabel?: string;
  state?: string;
};

export function transitionTimeLabelForStage(
  timeline: TransitionTimelineRow[],
  stage: string,
): string | null {
  const key = stage.trim().toUpperCase();
  const boundary = key === "T1" ? "BIKESTART" : key === "T2" ? "RUNSTART" : "";
  if (!boundary) return null;
  const match = [...timeline].reverse().find((row) => {
    if (row.state === "upcoming") return false;
    const identity = `${row.segment ?? ""} ${row.name ?? ""} ${row.splitLabel ?? ""}`
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
    return identity.includes(boundary);
  });
  const value = match?.splitTimeLabel?.trim();
  return value && !["--:--", "—"].includes(value) ? value : null;
}
