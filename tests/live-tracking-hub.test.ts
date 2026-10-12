import { describe, expect, it } from "vitest";
import { defaultLiveTrackingHubConfig } from "@/lib/live-tracking-hub-config";
import { liveTrackingHubConfigSchema } from "@/lib/live-tracking-hub-schema";
import { buildFeibotConnectionId, chooseFeibotConnectionId, chooseFeibotCredentialSource, feibotImportedDataKeys, mappedFeibotGunStart, mergeImportedFeibotSplits, parseFeibotTimingRules, reconcileFeibotContestMappings, resolveFeibotContestGunStart, startWindowFromFeibotGun } from "@/lib/feibot-integration";
import { expandFeibotSportLegs, normalizeHubRaceFlowConfig } from "@/lib/race-flow-legs";

const validConfig = {
  contestMappings: [{ contestId: "Olympic", providerContestUuid: "provider-olympic" }],
  start: {
    startWindowOpenAt: "2026-08-30T00:25:00.000Z",
    gunStartAt: "2026-08-30T00:30:00.000Z",
    startWindowCloseAt: "2026-08-30T00:40:00.000Z",
    eventEndAt: "2026-08-30T06:30:00.000Z",
  },
  legs: [{ id: "run", name: "Run", type: "RUN" as const, order: 0, distanceKm: 10 }],
  timingPoints: [
    { id: "start", name: "Start Arch", type: "START" as const, order: 0, readerUuids: ["reader-start"] },
    { id: "finish", name: "Finish Arch", type: "FINISH" as const, order: 1, readerUuids: ["reader-finish"] },
  ],
  splits: [{ id: "finish-split", name: "Finish", legId: "run", order: 0, distanceKm: 10, timingPointId: "finish", passage: 1, cutoffSeconds: 21_600, isFinalRaceSplit: true }],
  notifications: { enabled: true, finishersEnabled: true, templateName: "Official result" },
};

describe("Live Tracking Hub configuration", () => {
  it("keeps sibling Feibot events in distinct connection scopes", () => {
    const triathlon = buildFeibotConnectionId("race-upshot-event", "2026-09-06", "6QTff6CR");
    const swimathon = buildFeibotConnectionId("race-upshot-event", "2026-09-05", "1xajVfM0");
    expect(triathlon).toBe("race-upshot-event:2026-09-06:6QTff6CR");
    expect(swimathon).toBe("race-upshot-event:2026-09-05:1xajVfM0");
    expect(triathlon).not.toBe(swimathon);
  });

  it("uses the active Feibot connection when a rebuild has no form input", () => {
    const connections = [
      { connectionId: "triathlon", eventUuid: "6QTff6CR" },
      { connectionId: "swimathon", eventUuid: "1xajVfM0" },
    ];
    expect(chooseFeibotConnectionId(connections, "swimathon")).toBe("swimathon");
    expect(chooseFeibotConnectionId(connections, "swimathon", { eventUuid: "6QTff6CR" })).toBe("triathlon");
    expect(chooseFeibotConnectionId(connections, "swimathon", { eventUuid: "unknown" })).toBeNull();
  });

  it("starts empty and event scoped", () => {
    expect(defaultLiveTrackingHubConfig("event-a")).toMatchObject({
      eventId: "event-a",
      contestMappings: [],
      legs: [],
      splits: [],
      timingPoints: [],
      updatedAt: null,
    });
  });

  it("accepts a complete race flow", () => {
    expect(liveTrackingHubConfigSchema.safeParse(validConfig).success).toBe(true);
  });

  it("rejects multiple logical finishes and ambiguous shared-mat passages", () => {
    const result = liveTrackingHubConfigSchema.safeParse({
      ...validConfig,
      splits: [
        { ...validConfig.splits[0], id: "bike-start", name: "Bike Start", order: 0 },
        { ...validConfig.splits[0], id: "race-finish", name: "Race Finish", order: 1 },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((issue) => issue.message)).toEqual(expect.arrayContaining([
      "Each race category must have exactly one final logical split.",
      "A physical timing point and passage number may map to only one logical split per category.",
    ]));
  });

  it("rejects cross-event or missing leg and timing-point references", () => {
    const result = liveTrackingHubConfigSchema.safeParse({
      ...validConfig,
      splits: [{ ...validConfig.splits[0], legId: "foreign-leg", timingPointId: "foreign-point" }],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((issue) => issue.message)).toEqual(expect.arrayContaining([
      "Split must reference a leg in this event.",
      "Split must reference a timing point in this event.",
    ]));
  });

  it("rejects duplicate reader assignments and invalid start windows", () => {
    const result = liveTrackingHubConfigSchema.safeParse({
      ...validConfig,
      start: { ...validConfig.start, startWindowOpenAt: "2026-08-30T00:35:00.000Z" },
      timingPoints: validConfig.timingPoints.map((point) => ({ ...point, readerUuids: ["same-reader"] })),
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((issue) => issue.message)).toEqual(expect.arrayContaining([
      "Reader UUID assignments must be unique: same-reader",
      "Start window must open before the gun start.",
    ]));
  });

  it("normalizes Feibot timing rules without replacing provider identities", () => {
    const rules = parseFeibotTimingRules({ data: {
      contests: [{ contest_uuid: "contest-1", contest_name: "10K", race_date: "2026-08-30" }],
      legs: [{ leg_uuid: "run-leg", leg_name: "RUN", distance_km: 10 }],
      timing_points: [{ timing_point_uuid: "point-start", timing_point_name: "Start", reader_uuids: ["reader-a"] }, { timing_point_uuid: "point-finish", timing_point_name: "Finish" }],
      splits: [{ split_uuid: "split-start", split_name: "Start", leg_uuid: "run-leg", timing_point_uuid: "point-start", split_index: 1, km: 0 }, { split_uuid: "split-finish", split_name: "Finish", leg_uuid: "run-leg", timing_point_uuid: "point-finish", split_index: 2, km: 10 }],
    }});
    expect(rules.contests).toEqual([expect.objectContaining({ uuid: "contest-1", name: "10K" })]);
    expect(rules.legs[0]).toMatchObject({ id: "run-leg", type: "RUN", distanceKm: 10 });
    expect(rules.splits.map((split) => split.id)).toEqual(["split-start", "split-finish"]);
    expect(rules.splits.map((split) => split.isFinalRaceSplit)).toEqual([false, true]);
    expect(rules.timingPoints.map((point) => point.id)).toEqual(["point-start", "point-finish"]);
  });

  it("shows Feibot triathlon splits as Swim, T1, Bike, T2, Run", () => {
    const names = ["SWIM START", "SWIM FINISH", "BIKE START", "BIKE 10 KM", "BIKE 20 KM", "BIKE FINISH", "RUN START", "RUN 5K", "RUN 10K", "FINISH"];
    const payload = { legs: [{ leg_uuid: "provider-leg", leg_name: "RUN" }], splits: names.map((name, index) => ({ split_uuid: `split-${index}`, split_name: name, leg_uuid: "provider-leg", split_index: index + 1 })) };
    const rules = parseFeibotTimingRules(payload);
    expect(rules.legs.map((leg) => leg.type)).toEqual(["SWIM", "BIKE", "RUN"]);
    expect(rules.legs[2].id).toBe("provider-leg");
    expect(rules.splits.map((split) => rules.legs.find((leg) => leg.id === split.legId)?.type)).toEqual([
      "SWIM", "SWIM", "BIKE", "BIKE", "BIKE", "BIKE", "RUN", "RUN", "RUN", "RUN",
    ]);
    const preview = expandFeibotSportLegs([rules.legs[2]], payload.splits.map((row, index) => ({ id: row.split_uuid, name: row.split_name, importedName: row.split_name, legId: "provider-leg", order: index, distanceKm: null, timingPointId: null, passage: 1, cutoffSeconds: null })));
    expect(preview.legs.map((leg) => leg.type)).toEqual(["SWIM", "BIKE", "RUN"]);
  });

  it("repairs five generic Feibot RUN legs with all ten splits in the first leg", () => {
    const names = ["SWIM START", "SWIM FINISH", "BIKE START", "BIKE 10 KM", "BIKE 20 KM", "BIKE FINISH", "RUN START", "RUN 5K", "RUN 10K", "FINISH"];
    const legs = Array.from({ length: 5 }, (_, index) => ({ id: `leg-${index}`, name: "RUN", type: "RUN" as const, order: index, distanceKm: 51.5 }));
    const distances = [0, 1.5, 1.5, 11.5, 21.5, 41.5, 41.5, 46.5, 51.5, 51.5];
    const splits = names.map((name, order) => ({ id: `split-${order}`, name, importedName: name, legId: "leg-0", order, distanceKm: distances[order], timingPointId: null, passage: 1, cutoffSeconds: null }));
    const config = normalizeHubRaceFlowConfig({ ...defaultLiveTrackingHubConfig("event-1"), legs, splits });
    expect(config.legs.map((leg) => leg.type)).toEqual(["SWIM", "BIKE", "RUN"]);
    expect(config.legs.map((leg) => leg.distanceKm)).toEqual([1.5, 40, 10]);
    expect(config.splits.map((split) => config.legs.find((leg) => leg.id === split.legId)?.type)).toEqual([
      "SWIM", "SWIM", "BIKE", "BIKE", "BIKE", "BIKE", "RUN", "RUN", "RUN", "RUN",
    ]);
    const imported = parseFeibotTimingRules({ legs: legs.map((leg) => ({ leg_uuid: leg.id, leg_name: leg.name })), splits: splits.map((split) => ({ split_uuid: split.id, split_name: split.name, leg_uuid: split.legId, split_index: split.order + 1 })) });
    expect(imported.legs.map((leg) => leg.type)).toEqual(["SWIM", "BIKE", "RUN"]);
  });

  it("honors sport names on separate Feibot legs", () => {
    const rules = parseFeibotTimingRules({
      legs: ["Swim", "Bike", "Run"].map((name, index) => ({ leg_uuid: `leg-${index}`, leg_name: name })),
      splits: ["SWIM START", "BIKE START", "RUN START"].map((name, index) => ({ split_uuid: `split-${index}`, split_name: name, leg_uuid: `leg-${index}` })),
    });
    expect(rules.legs.map((leg) => leg.type)).toEqual(["SWIM", "BIKE", "RUN"]);
    expect(rules.splits.map((split) => split.legId)).toEqual(["leg-0", "leg-1", "leg-2"]);
  });

  it("normalizes Feibot cloud timing rules with provider-cased fields", () => {
    const rules = parseFeibotTimingRules({
      event_uuid: "4teGxjmX",
      timing_rules: {
        contests: [{ ID: 1, UUID: "5JUm5wtI", Name: "Test 1", GunStartTimes: { default: "2026-08-26T14:00:00+05:30" } }],
        devices: [
          { UUID: "TVLZC34O", TimingPointUUID: "5cdao43D" },
          { UUID: "27ljhzWe", TimingPointUUID: "1r9sHwF6" },
        ],
        legs: [{ UUID: "56hk6B71", ContestUUID: "5JUm5wtI", Name: "Start Finish" }],
        timing_points: [
          { UUID: "5cdao43D", Name: "Start Finish" },
          { UUID: "1r9sHwF6", Name: "Split 1" },
        ],
        splits: [
          { UUID: "5Z6FmglY", ContestUUID: "5JUm5wtI", Name: "Start", DistanceFromStart: 0, TimingPointUUID: "5cdao43D", CalculatedTimingPointUsePassNum: 1, TypeOfSport: "Running" },
          { UUID: "kzz6MYAq", ContestUUID: "5JUm5wtI", Name: "Split 1", DistanceFromStart: 1, TimingPointUUID: "1r9sHwF6", CalculatedTimingPointUsePassNum: 1, TypeOfSport: "Running" },
          { UUID: "6CsFQEXk", ContestUUID: "5JUm5wtI", Name: "Finish", DistanceFromStart: 3, TimingPointUUID: "5cdao43D", CalculatedTimingPointUsePassNum: 2, TypeOfSport: "Running" },
        ],
      },
    });

    expect(rules.contests).toEqual([expect.objectContaining({
      uuid: "5JUm5wtI",
      name: "Test 1",
      gunStartAt: "2026-08-26T14:00:00+05:30",
    })]);
    expect(rules.legs).toEqual([expect.objectContaining({ id: "56hk6B71", type: "RUN", distanceKm: 3 })]);
    expect(rules.splits).toEqual([
      expect.objectContaining({ id: "5Z6FmglY", providerContestUuid: "5JUm5wtI", distanceKm: 0, timingPointId: "5cdao43D", passage: 1, isFinalRaceSplit: false }),
      expect.objectContaining({ id: "kzz6MYAq", providerContestUuid: "5JUm5wtI", distanceKm: 1, timingPointId: "1r9sHwF6", passage: 1, isFinalRaceSplit: false }),
      expect.objectContaining({ id: "6CsFQEXk", providerContestUuid: "5JUm5wtI", distanceKm: 3, timingPointId: "5cdao43D", passage: 2, isFinalRaceSplit: true }),
    ]);
    expect(rules.timingPoints).toEqual([
      expect.objectContaining({ id: "5cdao43D", readerUuids: ["TVLZC34O"], km: 0 }),
      expect.objectContaining({ id: "1r9sHwF6", readerUuids: ["27ljhzWe"], km: 1 }),
    ]);
    expect(liveTrackingHubConfigSchema.safeParse({
      ...validConfig,
      contestMappings: [{ contestId: "Test 1", providerContestUuid: "5JUm5wtI" }],
      legs: rules.legs,
      splits: rules.splits,
      timingPoints: rules.timingPoints,
    }).success).toBe(true);
  });

  it("repairs stale contest UUIDs by exact normalized Feibot contest name", () => {
    expect(reconcileFeibotContestMappings(
      [{ contestId: "Test 1", providerContestUuid: "contest-1" }],
      [{ uuid: "5JUm5wtI", name: "Test 1", raceDate: null, gunStartAt: "2026-08-26T14:30:00.000Z" }],
    )).toEqual([{ contestId: "Test 1", providerContestUuid: "5JUm5wtI" }]);
  });

  it("uses the mapped contest GunStartTimes.default instead of the first Feibot contest", () => {
    expect(mappedFeibotGunStart(
      [{ contestId: "Test 1", providerContestUuid: "test-1" }],
      [
        { uuid: "earlier-contest", name: "Earlier contest", raceDate: null, gunStartAt: "2026-08-28T11:00:00+05:30" },
        { uuid: "test-1", name: "Test 1", raceDate: null, gunStartAt: "2026-08-28T14:00:00+05:30" },
      ],
    )).toBe("2026-08-28T14:00:00+05:30");
  });

  it("resolves each athlete category to its own Feibot gun start", () => {
    const contests = [
      { uuid: "sprint", name: "Sprint Triathlon", raceDate: "2026-10-04", gunStartAt: "2026-10-04T07:00:00+05:30" },
      { uuid: "113", name: "Triathlon 113", raceDate: "2026-10-04", gunStartAt: "2026-10-04T06:00:00+05:30" },
    ];
    expect(resolveFeibotContestGunStart("Triathlon 113", [{ contestId: "Triathlon 113", providerContestUuid: "113" }], contests))
      .toEqual(contests[1]);
    expect(resolveFeibotContestGunStart("Sprint Triathlon", [], contests)).toEqual(contests[0]);
    expect(resolveFeibotContestGunStart("Olympic Triathlon", [], contests)).toBeNull();
  });

  it("anchors the permitted CHIP START window to the Feibot gun time", () => {
    const start = startWindowFromFeibotGun({
      ...defaultLiveTrackingHubConfig("event-1").start,
      validStartWindowMinutes: 30,
    }, "2026-08-28T11:00:00+05:30");

    expect(start.gunStartAt).toBe("2026-08-28T05:30:00.000Z");
    expect(start.startWindowOpenAt).toBe("2026-08-28T05:30:00.000Z");
    expect(start.startWindowCloseAt).toBe("2026-08-28T06:00:00.000Z");
  });

  it("does not replace a valid provider contest UUID or guess across different names", () => {
    const contests = [{ uuid: "5JUm5wtI", name: "Test 1", raceDate: null, gunStartAt: null }];
    expect(reconcileFeibotContestMappings(
      [
        { contestId: "Test 1", providerContestUuid: "5JUm5wtI" },
        { contestId: "10 K Marathon", providerContestUuid: "legacy-10k" },
      ],
      contests,
    )).toEqual([
      { contestId: "Test 1", providerContestUuid: "5JUm5wtI" },
      { contestId: "10 K Marathon", providerContestUuid: "legacy-10k" },
    ]);
  });

  it("removes stale provider splits after a rebuild while retaining admin-created splits", () => {
    const leg = { id: "run", name: "Run", type: "RUN" as const, order: 0, distanceKm: 3 };
    const point = { id: "finish-point", name: "Finish", type: "FINISH" as const, order: 0, readerUuids: [] };
    const imported = [
      { id: "start", name: "Start", importedName: "Start", legId: "run", order: 0, distanceKm: 0, timingPointId: null, passage: 1, cutoffSeconds: null, visible: true },
      { id: "finish", name: "Finish", importedName: "Finish", legId: "run", order: 1, distanceKm: 3, timingPointId: "finish-point", passage: 1, cutoffSeconds: null, visible: true },
    ];
    const saved = [
      imported[0],
      { ...imported[1], order: 2 },
      { id: "old-split-1", name: "Split 1", importedName: "Split 1", legId: "run", order: 1, distanceKm: 1, timingPointId: null, passage: 1, cutoffSeconds: null, visible: true },
      { id: "old-split-2", name: "Split 2", importedName: "Split 2", legId: "run", order: 3, distanceKm: 2, timingPointId: null, passage: 1, cutoffSeconds: null, visible: true },
      { id: "split-admin-checkpoint", name: "Manual checkpoint", importedName: null, legId: "run", order: 4, distanceKm: 2.5, timingPointId: null, passage: 1, cutoffSeconds: null, visible: true },
    ];
    expect(mergeImportedFeibotSplits(imported, saved, [leg], [point]).map((split) => [split.id, split.order])).toEqual([
      ["start", 0],
      ["finish", 1],
      ["split-admin-checkpoint", 2],
    ]);
  });

  it("targets imported projections for one event without touching credentials, configuration, maps or canonical versions", () => {
    const keys = feibotImportedDataKeys("event-a");
    expect(keys.length).toBeGreaterThan(10);
    expect(keys.every((key) => key.includes("event-a"))).toBe(true);
    expect(keys.some((key) => key.includes("event-b"))).toBe(false);
    expect(keys.some((key) => /credential|hub-config|course|canonical/i.test(key))).toBe(false);
  });

  it("uses an account key only when explicitly selected or no event key exists", () => {
    expect(chooseFeibotCredentialSource({ suppliedEventKey: false, storedSource: null, accountConfigured: true })).toBe("ACCOUNT");
    expect(chooseFeibotCredentialSource({ suppliedEventKey: true, storedSource: null, accountConfigured: true })).toBe("EVENT");
    expect(chooseFeibotCredentialSource({ requested: "ACCOUNT", suppliedEventKey: true, storedSource: "EVENT", accountConfigured: true })).toBe("ACCOUNT");
    expect(chooseFeibotCredentialSource({ suppliedEventKey: false, storedSource: "EVENT", accountConfigured: true })).toBe("EVENT");
  });
});
