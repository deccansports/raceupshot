import { describe, expect, it } from "vitest";
import { normalizeRaceFlowPassages, raceFlowIssues, reorderContestSplits } from "../lib/race-flow-editor";
import type { HubLeg, HubSplit } from "../lib/live-tracking-hub-config";

const legs: HubLeg[] = [{ id: "swim", name: "Swim", type: "SWIM", order: 0, distanceKm: 1.5 }];
const start: HubSplit = { id: "start", name: "Start", legId: "swim", order: 0, distanceKm: 0, timingPointId: "mat", passage: 1, cutoffSeconds: null, providerContestUuid: "A" };
const finish: HubSplit = { ...start, id: "finish", name: "Finish", order: 1, distanceKm: 1.5, passage: 2, isFinalRaceSplit: true };

describe("race flow editing", () => {
  it("accepts separate passages on a shared mat", () => {
    expect(raceFlowIssues([start, finish], legs, ["mat"])).toEqual([]);
    expect(raceFlowIssues([start, { ...finish, passage: 1 }], legs, ["mat"]).join()).toContain("already used");
  });
  it("automatically repairs duplicate shared-mat passages in race order", () => {
    const repaired = normalizeRaceFlowPassages([start, { ...finish, passage: 1 }]);
    expect(repaired.map((split) => split.passage)).toEqual([1, 2]);
    expect(raceFlowIssues(repaired, legs, ["mat"])).toEqual([]);
    const reordered = reorderContestSplits(repaired, "A", ["finish", "start"]);
    expect(reordered.map((split) => split.passage)).toEqual([2, 1]);
  });
  it("retains unmapped and other-contest rows when reordering", () => {
    const orphan = { ...start, id: "unmapped", legId: "missing" };
    const other = { ...finish, id: "other", providerContestUuid: "B" };
    const result = reorderContestSplits([start, finish, orphan, other], "A", ["finish", "start", "start"]);
    expect(result).toHaveLength(4);
    expect(result[3]).toBe(other);
    expect(result[2].id).toBe("unmapped");
    expect(result[0].order).toBe(1);
  });
  it("rejects backward distances, unmapped mats, and premature finish", () => {
    expect(raceFlowIssues([start, { ...finish, distanceKm: -1 }], legs, ["mat"]).join()).toContain("cumulative KM");
    expect(raceFlowIssues([start, finish], legs, []).join()).toContain("physical timing point");
    expect(raceFlowIssues([{ ...start, isFinalRaceSplit: true }, { ...finish, isFinalRaceSplit: false }], legs, ["mat"]).join()).toContain("last logical split");
  });
});
