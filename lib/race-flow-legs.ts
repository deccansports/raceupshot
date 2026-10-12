import type { HubLeg, HubSplit, LiveTrackingHubConfig } from "./live-tracking-hub-config";

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
  const flow = expandFeibotSportLegs(config.legs, config.splits);
  return flow.legs === config.legs ? config : { ...config, legs: flow.legs, splits: flow.splits };
}
