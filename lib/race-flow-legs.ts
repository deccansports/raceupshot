import type { HubLeg, HubSplit, LiveTrackingHubConfig } from "./live-tracking-hub-config";
import { normalizeRaceFlowPassages } from "./race-flow-editor";

/** Feibot sometimes returns one generic leg for a triathlon despite sport-specific splits. */
export function expandFeibotSportLegs(legs: HubLeg[], splits: HubSplit[]) {
  if (!legs.length) return { legs, splits };
  const ordered = [...splits].sort((a, b) => a.order - b.order);
  const sportOf = (split: HubSplit) => {
    const label = `${split.importedName ?? ""} ${split.name}`.toUpperCase();
    if (/\bSWIM\b/.test(label)) return "SWIM" as const;
    if (/\bBIKE\b|\bCYCLE\b/.test(label)) return "BIKE" as const;
    if (/\bRUN\b/.test(label)) return "RUN" as const;
    return null;
  };
  const sports = ordered.map(sportOf);
  const firstSwim = sports.indexOf("SWIM");
  const firstBike = sports.indexOf("BIKE");
  const firstRun = sports.indexOf("RUN");
  if (firstSwim < 0 || firstBike <= firstSwim || firstRun <= firstBike) return { legs, splits };
  // Explicitly named checkpoints must remain in course order; otherwise keep Feibot's leg.
  if (sports.some((sport, index) => sport === "SWIM" && index >= firstBike || sport === "BIKE" && (index < firstBike || index >= firstRun) || sport === "RUN" && index < firstRun)) return { legs, splits };
  const populatedLegs = legs.filter((leg) => splits.some((split) => split.legId === leg.id));
  if (populatedLegs.length !== 1 || !legs.every((leg) => leg.type === "RUN" || leg.type === "OTHER")) return { legs, splits };
  const source = populatedLegs[0];
  const unused = legs.filter((leg) => leg.id !== source.id);
  const swimId = unused[0]?.id ?? `${source.id}-swim`;
  const bikeId = unused[1]?.id ?? `${source.id}-bike`;
  const legDistance = (start: number, finish: number) => {
    const from = ordered[start]?.distanceKm;
    const to = ordered[finish]?.distanceKm;
    return typeof from === "number" && typeof to === "number" && to >= from ? to - from : null;
  };
  const expanded: HubLeg[] = [
    { ...source, id: swimId, name: "Swim", type: "SWIM", order: 0, distanceKm: legDistance(firstSwim, firstBike - 1), cutoffSeconds: null },
    { ...source, id: bikeId, name: "Bike", type: "BIKE", order: 1, distanceKm: legDistance(firstBike, firstRun - 1), cutoffSeconds: null },
    { ...source, name: "Run", type: "RUN", order: 2, distanceKm: legDistance(firstRun, ordered.length - 1) },
  ];
  const mapped = splits.map((split) => {
    const index = ordered.findIndex((row) => row.id === split.id);
    const legId = index < firstBike ? expanded[0].id : index < firstRun ? expanded[1].id : expanded[2].id;
    return { ...split, legId };
  });
  return { legs: expanded, splits: mapped };
}

export function normalizeHubRaceFlowConfig(config: LiveTrackingHubConfig): LiveTrackingHubConfig {
  const repairedSplits = normalizeRaceFlowPassages(config.splits);
  if (repairedSplits !== config.splits) config = { ...config, splits: repairedSplits };
  // Automatic legacy repairs assume one race. Never use one contest's final
  // split or maximum distance to rewrite another contest's leg mappings.
  if (new Set(config.splits.map(split => split.providerContestUuid ?? "")).size > 1) return config;
  const flow = expandFeibotSportLegs(config.legs, config.splits);
  const orderedLegs = [...flow.legs].sort((left, right) => left.order - right.order);
  const sportLegs = orderedLegs.filter((leg) => leg.type === "SWIM" || leg.type === "BIKE" || leg.type === "RUN");
  const hasTriathlonFlow = ["SWIM", "BIKE", "RUN"].every((type) => sportLegs.some((leg) => leg.type === type));
  if (!hasTriathlonFlow) return flow.legs === config.legs ? config : { ...config, legs: flow.legs, splits: flow.splits };

  const lastSportLeg = sportLegs.at(-1);
  const splits = flow.splits.map((split) => split.isFinalRaceSplit === true && lastSportLeg && split.legId !== lastSportLeg.id
    ? { ...split, legId: lastSportLeg.id }
    : split);
  const cumulativeFinishKm = splits.reduce<number | null>((maximum, split) => typeof split.distanceKm === "number"
    ? Math.max(maximum ?? split.distanceKm, split.distanceKm)
    : maximum, null);
  const duplicatedFinishDistance = cumulativeFinishKm != null && sportLegs.filter((leg) => leg.distanceKm === cumulativeFinishKm).length >= 2;
  let legs = flow.legs;
  if (duplicatedFinishDistance) {
    legs = flow.legs.map((leg) => {
      if (leg.type === "TRANSITION") return { ...leg, distanceKm: null };
      const distances = splits
        .filter((split) => split.legId === leg.id && typeof split.distanceKm === "number")
        .map((split) => split.distanceKm as number);
      return distances.length >= 2
        ? { ...leg, distanceKm: Math.max(...distances) - Math.min(...distances) }
        : leg;
    });
  }
  const changed = legs !== config.legs || splits.some((split, index) => split !== config.splits[index]);
  return changed ? { ...config, legs, splits } : config;
}
