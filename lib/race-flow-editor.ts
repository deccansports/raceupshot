import type { HubSplit, HubLeg } from "./live-tracking-hub-config";

/**
 * Passage numbers are transport metadata, not athlete-facing race-flow
 * presentation. Feibot occasionally omits them (so every row becomes 1) or
 * returns the same value for repeated uses of a physical mat. Number every
 * repeated use within its contest by configured split order.
 */
export function normalizeRaceFlowPassages(splits: HubSplit[]): HubSplit[] {
  const repaired = new Map<string, number>();
  const scopes = new Map<string, HubSplit[]>();
  for (const split of splits) {
    const scope = typeof split.providerContestUuid === "string"
      ? split.providerContestUuid.trim() || "__event__"
      : "__event__";
    scopes.set(scope, [...(scopes.get(scope) ?? []), split]);
  }

  for (const rows of scopes.values()) {
    const byPoint = new Map<string, HubSplit[]>();
    for (const split of [...rows].sort((left, right) => left.order - right.order)) {
      if (!split.timingPointId) continue;
      byPoint.set(split.timingPointId, [...(byPoint.get(split.timingPointId) ?? []), split]);
    }
    for (const pointRows of byPoint.values()) {
      if (pointRows.length < 2) continue;
      pointRows.forEach((split, index) => {
        if (split.passage !== index + 1) repaired.set(split.id, index + 1);
      });
    }
  }

  return repaired.size
    ? splits.map((split) => repaired.has(split.id) ? { ...split, passage: repaired.get(split.id)! } : split)
    : splits;
}

export function reorderContestSplits(all: HubSplit[], scope: string, ids: string[], move?: { id: string; legId: string }) {
  const scoped = all.filter(s => (s.providerContestUuid ?? "") === scope);
  const byId = new Map(scoped.map(s => [s.id, s]));
  const unique = [...new Set(ids)].filter(id => byId.has(id));
  // Never discard unmapped rows, or touch another contest.
  for (const row of scoped) if (!unique.includes(row.id)) unique.push(row.id);
  const changed = new Map(unique.map((id, order) => {
    const row = byId.get(id)!;
    return [id, { ...row, order, ...(move?.id === id ? { legId: move.legId } : {}) }];
  }));
  return normalizeRaceFlowPassages(all.map(row => (row.providerContestUuid ?? "") === scope ? changed.get(row.id)! : row));
}

export function raceFlowIssues(splits: HubSplit[], legs: HubLeg[], pointIds: string[]) {
  const errors: string[] = [];
  const scopes = new Set(splits.map(s => s.providerContestUuid ?? ""));
  for (const scope of scopes) {
    const rows = splits.filter(s => (s.providerContestUuid ?? "") === scope).sort((a,b) => a.order-b.order);
    const passages = new Set<string>();
    const orders = new Set<number>();
    let previousKm = 0;
    let previousLegOrder = -Infinity;
    for (const row of rows) {
      const prefix = `${row.name} (${scope || "event-wide"})`;
      const leg = legs.find(l => l.id === row.legId);
      if (!leg) errors.push(`${prefix}: choose a sport leg.`);
      else {
        if (leg.order < previousLegOrder) errors.push(`${prefix}: leg sequence moves backwards.`);
        previousLegOrder = leg.order;
      }
      if (!row.timingPointId || !pointIds.includes(row.timingPointId)) errors.push(`${prefix}: choose a physical timing point.`);
      if (!Number.isInteger(row.passage) || row.passage < 1) errors.push(`${prefix}: passage must be a positive whole number.`);
      const key = JSON.stringify([row.timingPointId, row.passage]);
      if (row.timingPointId && passages.has(key)) errors.push(`${prefix}: timing point and passage already used in this contest.`);
      passages.add(key);
      if (orders.has(row.order)) errors.push(`${prefix}: duplicate sequence number; reorder the splits.`);
      orders.add(row.order);
      if (row.distanceKm == null || !Number.isFinite(row.distanceKm) || row.distanceKm < previousKm) errors.push(`${prefix}: set cumulative KM at or beyond the previous split.`);
      else previousKm = row.distanceKm;
    }
    const finishes = rows.filter(r => r.isFinalRaceSplit);
    if (finishes.length !== 1 || finishes[0]?.id !== rows.at(-1)?.id) errors.push(`${scope || "Event-wide"}: explicitly mark the last logical split as the final race finish.`);
  }
  return errors;
}
