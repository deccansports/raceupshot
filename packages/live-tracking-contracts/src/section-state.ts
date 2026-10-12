export type ResolvedSectionStatus = 'not_started' | 'in_progress' | 'completed';

export type RaceSectionDefinition = {
  key: string;
  sectionType: 'leg' | 'transition';
  order: number;
  startSplitKey: string;
  finishSplitKey: string;
};

export type AcceptedSplitBoundary = {
  accepted: boolean;
  timestamp?: string | null;
  elapsedSeconds?: number | null;
};

export type ResolvedSection = RaceSectionDefinition & {
  status: ResolvedSectionStatus;
  activeSince: string | null;
  elapsedSeconds: number | null;
};

export type CurrentRaceSectionState = {
  sections: ResolvedSection[];
  currentSectionKey: string | null;
  currentSectionType: RaceSectionDefinition['sectionType'] | null;
  currentSectionStatus: ResolvedSectionStatus | 'finished';
  previousSectionKey: string | null;
  nextSectionKey: string | null;
  activeSince: string | null;
  elapsedSeconds: number | null;
  finished: boolean;
};

function epochSeconds(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed / 1000 : null;
}

function boundaryDuration(
  start: AcceptedSplitBoundary | undefined,
  finish: AcceptedSplitBoundary | undefined,
  nowSeconds: number,
): number | null {
  if (!start?.accepted) return null;
  const startElapsed = Number(start.elapsedSeconds);
  const finishElapsed = Number(finish?.elapsedSeconds);
  if (finish?.accepted && Number.isFinite(startElapsed) && Number.isFinite(finishElapsed)) {
    return Math.max(0, finishElapsed - startElapsed);
  }
  const startEpoch = epochSeconds(start.timestamp);
  const finishEpoch = epochSeconds(finish?.timestamp);
  if (finish?.accepted && startEpoch !== null && finishEpoch !== null) {
    return Math.max(0, finishEpoch - startEpoch);
  }
  return startEpoch === null ? null : Math.max(0, nowSeconds - startEpoch);
}

/**
 * Resolves official race-section state from configured order and accepted split
 * boundaries. Distance and prediction never participate in this decision.
 */
export function resolveCurrentRaceSection(
  definitions: RaceSectionDefinition[],
  boundaries: Record<string, AcceptedSplitBoundary | undefined>,
  now: string | number | Date = new Date(),
): CurrentRaceSectionState {
  const parsedNow = now instanceof Date
    ? now.getTime() / 1000
    : typeof now === 'number'
      ? (now > 1_000_000_000_000 ? now / 1000 : now)
      : Date.parse(now) / 1000;
  const nowSeconds = Number.isFinite(parsedNow) ? parsedNow : Date.now() / 1000;
  const ordered = [...definitions].sort((left, right) => left.order - right.order);
  const sections = ordered.map<ResolvedSection>((definition) => {
    const start = boundaries[definition.startSplitKey];
    const finish = boundaries[definition.finishSplitKey];
    const status: ResolvedSectionStatus = start?.accepted && finish?.accepted
      ? 'completed'
      : start?.accepted
        ? 'in_progress'
        : 'not_started';
    return {
      ...definition,
      status,
      activeSince: status === 'in_progress' ? start?.timestamp ?? null : null,
      elapsedSeconds: status === 'not_started'
        ? null
        : boundaryDuration(start, finish, nowSeconds),
    };
  });
  const currentIndex = sections.findIndex((section) => section.status === 'in_progress');
  const finished = sections.length > 0 && sections.every((section) => section.status === 'completed');
  const current = currentIndex >= 0 ? sections[currentIndex] : null;
  const previous = currentIndex > 0
    ? sections[currentIndex - 1]
    : [...sections].reverse().find((section) => section.status === 'completed') ?? null;
  const next = currentIndex >= 0
    ? sections[currentIndex + 1] ?? null
    : sections.find((section) => section.status === 'not_started') ?? null;

  return {
    sections,
    currentSectionKey: current?.key ?? null,
    currentSectionType: current?.sectionType ?? null,
    currentSectionStatus: finished ? 'finished' : current?.status ?? 'not_started',
    previousSectionKey: previous?.key ?? null,
    nextSectionKey: next?.key ?? null,
    activeSince: current?.activeSince ?? null,
    elapsedSeconds: current?.elapsedSeconds ?? null,
    finished,
  };
}
