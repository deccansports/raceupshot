export type ResultSheetRow = Record<string, unknown>;

const preferredCategoryHeaders = [
  "ticket name",
  "ticket category",
  "race cat",
  "race category",
  "contest name",
  "contest",
  "event cat",
  "event category",
  "distance",
  "category",
  "race",
];

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9.]+/g, " ").trim();
}

function categoryIdentity(value: string): string {
  return normalized(value)
    .replace(/\bkilomet(?:er|re)s?\b|\bkms?\b|\bk\b/g, " km ")
    .replace(/\bmet(?:er|re)s?\b|\bmtrs?\b/g, " m ")
    .replace(/(\d)\s+(km|m)\b/g, "$1$2")
    .replace(/\b(race|ticket|category|event)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function distinctiveTokens(value: string): string[] {
  const generic = new Set(["bergman", "triathlon", "kids", "the", "and"]);
  return categoryIdentity(value).split(" ").filter((token) => token && !generic.has(token));
}

export function suggestResultCategory(source: string, targets: string[]): string {
  if (targets.length === 1) return targets[0] ?? "";
  const sourceIdentity = categoryIdentity(source);
  if (!sourceIdentity) return "";

  const exact = targets.find((target) => categoryIdentity(target) === sourceIdentity);
  if (exact) return exact;

  const contained = targets.filter((target) => {
    const targetIdentity = categoryIdentity(target);
    return sourceIdentity.length >= 3
      && (targetIdentity.includes(sourceIdentity) || sourceIdentity.includes(targetIdentity));
  });
  if (contained.length === 1) return contained[0];

  const sourceTokens = new Set(distinctiveTokens(source));
  if (!sourceTokens.size) return "";

  // Combined event tickets (for example one Swimathon ticket containing
  // 500m, 1km, 2km and 4km) must accept each row-level distance category.
  // A Jaccard score penalizes the combined ticket for its additional valid
  // distances, so check unambiguous token containment before fuzzy scoring.
  const tokenContained = targets.filter((target) => {
    const targetTokens = new Set(distinctiveTokens(target));
    return [...sourceTokens].every((token) => targetTokens.has(token));
  });
  if (tokenContained.length === 1) return tokenContained[0];

  const ranked = targets.map((target) => {
    const targetTokens = new Set(distinctiveTokens(target));
    const common = [...sourceTokens].filter((token) => targetTokens.has(token)).length;
    const union = new Set([...sourceTokens, ...targetTokens]).size;
    return { target, score: common / Math.max(union, 1) };
  }).sort((left, right) => right.score - left.score);
  const best = ranked[0];
  const runnerUp = ranked[1];
  return best && best.score >= 0.5 && best.score - (runnerUp?.score ?? 0) >= 0.2
    ? best.target
    : "";
}

export function resultCategorySourceValues(rows: ResultSheetRow[], column: string): string[] {
  return [...new Set(rows.map((row) => String(row[column] ?? "").trim()))]
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

export interface ResultCategorySourceGroup {
  id: string;
  label: string;
  sources: string[];
  count: number;
}

export function resultCategorySourceGroups(
  rows: ResultSheetRow[],
  column: string,
): ResultCategorySourceGroup[] {
  const groups = new Map<string, ResultCategorySourceGroup>();
  for (const row of rows) {
    const source = String(row[column] ?? "").trim();
    const id = categoryIdentity(source) || "__blank";
    const current = groups.get(id);
    if (current) {
      current.count += 1;
      if (!current.sources.includes(source)) current.sources.push(source);
      continue;
    }
    groups.set(id, {
      id,
      label: source,
      sources: [source],
      count: 1,
    });
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      sources: group.sources.sort((left, right) => left.localeCompare(right, undefined, { numeric: true })),
    }))
    .sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true }));
}

export function buildResultCategoryMappings(
  rows: ResultSheetRow[],
  column: string,
  targets: string[],
): Record<string, string> {
  return Object.fromEntries(
    resultCategorySourceValues(rows, column)
      .map((source) => [source, suggestResultCategory(source, targets)]),
  );
}

function categoryColumnPriority(header: string): number {
  if (header === "__sheet") return preferredCategoryHeaders.length + 1;
  const identity = normalized(header);
  const exactIndex = preferredCategoryHeaders.indexOf(identity);
  if (exactIndex >= 0) return exactIndex;
  return preferredCategoryHeaders.length;
}

function candidateCategoryColumns(headers: string[]): string[] {
  const likely = headers.filter((header) => {
    if (header === "__sheet") return true;
    const identity = normalized(header);
    return preferredCategoryHeaders.includes(identity)
      || /ticket|category|contest|distance|race/.test(identity);
  });
  return likely.sort((left, right) => categoryColumnPriority(left) - categoryColumnPriority(right));
}

export interface InferredResultCategoryMapping {
  column: string;
  mappings: Record<string, string>;
  mappedRows: number;
  unmatchedRows: number;
}

export function inferResultCategoryMapping(
  rows: ResultSheetRow[],
  headers: string[],
  targets: string[],
): InferredResultCategoryMapping {
  const candidates = candidateCategoryColumns(headers);
  const fallback = headers.includes("__sheet") ? "__sheet" : (headers[0] ?? "");
  const ranked = candidates.map((column) => {
    const mappings = buildResultCategoryMappings(rows, column, targets);
    const mappedRows = rows.filter((row) => Boolean(mappings[String(row[column] ?? "").trim()])).length;
    return { column, mappings, mappedRows, unmatchedRows: rows.length - mappedRows };
  }).sort((left, right) => {
    if (right.mappedRows !== left.mappedRows) return right.mappedRows - left.mappedRows;
    return categoryColumnPriority(left.column) - categoryColumnPriority(right.column);
  });

  return ranked[0] ?? {
    column: fallback,
    mappings: buildResultCategoryMappings(rows, fallback, targets),
    mappedRows: 0,
    unmatchedRows: rows.length,
  };
}
