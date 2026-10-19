export type CourseKind = "swim" | "bike" | "run" | "duathlon" | "triathlon" | "unknown";

function normalized(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
}

export function resolveCourseKind(...values: unknown[]): CourseKind {
  const sources = values.map(normalized).filter(Boolean);
  for (const source of sources) {
    if (/\bduathlon\b/.test(source)) return "duathlon";
    if (/\btriathlon\b/.test(source)) return "triathlon";
    if (/\b(swimathon|swimming)\b/.test(source)) return "swim";
    if (/\b(marathon|half marathon|ultra marathon|running)\b/.test(source)) return "run";
    if (/\b(cycling|cycling race|bike race)\b/.test(source)) return "bike";
  }
  const source = sources.join(" ");
  if (/\bduathlon\b/.test(source)) return "duathlon";
  if (/\btriathlon\b/.test(source)) return "triathlon";
  if (/\b(swimathon|swimming|swim)\b/.test(source) && !/\b(bike|cycle|run)\b/.test(source)) {
    return "swim";
  }
  if (/\b(cycling|cycling race|bike race|bike)\b/.test(source) && !/\b(swim|run)\b/.test(source)) {
    return "bike";
  }
  if (/\b(marathon|half marathon|ultra marathon|running|run)\b/.test(source) && !/\b(swim|bike|cycle)\b/.test(source)) {
    return "run";
  }
  // Missing metadata is not evidence of a triathlon. Callers render a neutral
  // race flow until the mapped ticket or canonical contest is available.
  return "unknown";
}

export function courseStageLabels(kind: CourseKind): string[] {
  if (kind === "swim") return ["SWIM", "FINISH"];
  if (kind === "bike") return ["BIKE", "FINISH"];
  if (kind === "run") return ["RUN", "FINISH"];
  if (kind === "duathlon") return ["RUN1", "BIKE", "RUN2", "FINISH"];
  if (kind === "triathlon") return ["SWIM", "T1", "BIKE", "T2", "RUN", "FINISH"];
  return ["RACE", "FINISH"];
}
