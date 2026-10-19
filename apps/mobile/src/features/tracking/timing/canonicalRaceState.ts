export type CanonicalRaceStatus = "NOT_STARTED" | "IN_PROGRESS" | "FINISHED" | "STOPPED";

export type CanonicalRaceStateInput = {
  resultStatus?: string | null;
  terminalStatus?: string | null;
  sections?: ReadonlyArray<{
    status?: string | null;
    rows?: ReadonlyArray<{ name?: string | null; key?: string | null; status?: string | null; isRaceFinish?: boolean }>;
  }>;
  timeline?: ReadonlyArray<{
    name?: string | null;
    splitLabel?: string | null;
    state?: string | null;
    isRaceFinish?: boolean;
  }>;
};

export type CanonicalRaceState = {
  status: CanonicalRaceStatus;
  hasConfirmedFinish: boolean;
  hasConfirmedTimingRead: boolean;
  showPrediction: boolean;
};

function normalized(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function isConfirmed(value: unknown): boolean {
  return ["valid", "accepted", "completed", "official", "final", "fixed"].includes(normalized(value));
}

function isFinishName(value: unknown): boolean {
  return /(?:^|[_\s-])finish(?:$|[_\s-])|finish\s*line/i.test(String(value ?? ""));
}

/**
 * One lifecycle resolver for all athlete-facing surfaces. Canonical timing
 * evidence wins over roster, registration, and stale provider status fields.
 */
export function resolveCanonicalRaceState(input: CanonicalRaceStateInput): CanonicalRaceState {
  const sections = input.sections ?? [];
  const rows = sections.flatMap((section) => section.rows ?? []);
  const timeline = input.timeline ?? [];
  // Only the final configured checkpoint can complete the race. Looking for
  // any label containing "finish" promotes Swim Finish/Bike Finish too early.
  const finalConfiguredRow = rows.at(-1);
  const finalTimelineRow = timeline.at(-1);
  const finishedBySplit = Boolean(
    (finalConfiguredRow
      // Configured course rows must explicitly identify the one race finish.
      // Labels such as Swim Finish and Bike Finish are leg boundaries only.
      && finalConfiguredRow.isRaceFinish === true
      && isConfirmed(finalConfiguredRow.status))
    || (!finalConfiguredRow
      && finalTimelineRow
      && (finalTimelineRow.isRaceFinish === true || isFinishName(`${finalTimelineRow.name ?? ""} ${finalTimelineRow.splitLabel ?? ""}`))
      && isConfirmed(finalTimelineRow.state)),
  );
  // Result status is a compatibility fallback only when canonical course rows
  // are unavailable. With a configured flow, timing evidence owns lifecycle.
  const finishedByResult = rows.length === 0
    && timeline.length === 0
    && /finish|complete/.test(normalized(input.resultStatus));
  const terminal = [input.terminalStatus, input.resultStatus]
    .some(value => /^(?:CUTOFF_PENDING|NO FINISH TIME|DNF|DNS|DNQ|DSQ)\b/.test(normalized(value).toUpperCase()));
  const hasConfirmedFinish = !terminal && (finishedByResult || finishedBySplit);
  const hasConfirmedTimingRead =
    rows.some((row) => isConfirmed(row.status)) ||
    timeline.some((row) => isConfirmed(row.state));
  const status: CanonicalRaceStatus = terminal
    ? "STOPPED"
    : hasConfirmedFinish
    ? "FINISHED"
    : hasConfirmedTimingRead
      ? "IN_PROGRESS"
      : "NOT_STARTED";
  return {
    status,
    hasConfirmedFinish,
    hasConfirmedTimingRead,
    showPrediction: status === "IN_PROGRESS",
  };
}
