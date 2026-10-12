export const LEADERBOARD_PAGE_SIZE = 50;

const DASH = "—";

function normalized(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function shouldAnimateAthleteName(
  measuredNameWidth: number,
  availableNameWidth: number,
): boolean {
  return measuredNameWidth > availableNameWidth + 1;
}

export function athleteIdentityLines(input: {
  name: string;
  club?: string;
  bib?: string;
  flag?: string;
}): { name: string; club?: string; bib: string } {
  const club = String(input.club ?? "").trim();
  const usableClub = club && !/^n\/?a$/i.test(club) ? club : undefined;
  return {
    name: input.name,
    club: usableClub,
    bib: `Bib ${input.bib || "—"}${input.flag ? ` · ${input.flag}` : ""}`,
  };
}

export function paceForLeaderboardSplit(
  splitLabel: unknown,
  candidateMetric: unknown,
): string {
  const split = normalized(splitLabel);
  const metric = String(candidateMetric ?? "").trim();
  if (!metric || metric === DASH || metric === "-") return DASH;

  if (
    split === "t1" ||
    split === "t2" ||
    split.includes("transition") ||
    split.endsWith(" start") ||
    split === "start"
  ) {
    return DASH;
  }
  if (split.includes("swim finish")) {
    return /\/\s*100\s*m\b|per\s*100\s*m\b/i.test(metric) ? metric : DASH;
  }
  if (split.includes("bike finish") || split.includes("cycle finish")) {
    return /\bkm\s*\/\s*h\b|\bkmh\b|\bkph\b/i.test(metric) ? metric : DASH;
  }
  if (split.includes("run finish")) {
    return /\/\s*km\b|per\s*km\b/i.test(metric) && !/100\s*m/i.test(metric)
      ? metric
      : DASH;
  }
  if (split === "finish" || split === "overall finish" || split === "race finish") {
    return /\/\s*km\b|\/\s*100\s*m\b|per\s*km\b|per\s*100\s*m\b|\bkm\s*\/\s*h\b|\bkmh\b|\bkph\b/i.test(metric)
      ? metric
      : DASH;
  }
  return DASH;
}

export function paginateLeaderboard<T>(
  rows: readonly T[],
  requestedPage: number,
  pageSize = LEADERBOARD_PAGE_SIZE,
): { rows: T[]; page: number; pageCount: number; start: number; end: number } {
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const pageCount = Math.max(1, Math.ceil(rows.length / safePageSize));
  const page = Math.max(0, Math.min(pageCount - 1, Math.floor(requestedPage)));
  const startIndex = page * safePageSize;
  return {
    rows: rows.slice(startIndex, startIndex + safePageSize),
    page,
    pageCount,
    start: rows.length === 0 ? 0 : startIndex + 1,
    end: Math.min(rows.length, startIndex + safePageSize),
  };
}

export function transitionDurationSeconds(
  startBoundarySeconds: number | null | undefined,
  endBoundarySeconds: number | null | undefined,
): number | null {
  if (
    !Number.isFinite(startBoundarySeconds) ||
    !Number.isFinite(endBoundarySeconds) ||
    Number(endBoundarySeconds) < Number(startBoundarySeconds)
  ) {
    return null;
  }
  return Number(endBoundarySeconds) - Number(startBoundarySeconds);
}
