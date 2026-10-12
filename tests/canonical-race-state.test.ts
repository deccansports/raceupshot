import { describe, expect, test } from "vitest";
import { resolveCanonicalRaceState } from "../apps/mobile/src/features/tracking/timing/canonicalRaceState";

const row = (name: string, status: string) => ({ name, status });

describe("canonical athlete race state", () => {
  test("has one lifecycle outcome for header, progress, split flow and prediction", () => {
    const cases = [
      [{ sections: [{ status: "not_started", rows: [row("Start", "missing")] }] }, "NOT_STARTED", false],
      [{ sections: [{ status: "in_progress", rows: [row("Start", "valid"), row("Finish", "missing")] }] }, "IN_PROGRESS", true],
      [{ sections: [{ status: "in_progress", rows: [row("Start", "valid"), row("Run 5K", "valid"), row("Finish", "missing")] }] }, "IN_PROGRESS", true],
      [{ sections: [{ status: "completed", rows: [row("Start", "valid"), row("Finish", "valid")] }] }, "FINISHED", false],
    ] as const;
    for (const [input, expectedStatus, expectedPrediction] of cases) {
      const state = resolveCanonicalRaceState(input);
      // These athlete-facing surfaces read this single state; none may derive
      // a lifecycle from roster or provider metadata independently.
      const headerStatus = state.status;
      const progressStatus = state.status;
      const splitFlowStatus = state.status;
      expect(state.status).toBe(expectedStatus);
      expect(headerStatus).toBe(progressStatus);
      expect(progressStatus).toBe(splitFlowStatus);
      expect(state.showPrediction).toBe(expectedPrediction);
    }
  });

  test("an accepted Finish always wins over stale NOT_STARTED metadata", () => {
    const state = resolveCanonicalRaceState({
      resultStatus: "NOT_STARTED",
      sections: [{ status: "in_progress", rows: [row("Start", "valid"), row("Finish", "valid")] }],
    });
    expect(state.status).toBe("FINISHED");
    expect(state.hasConfirmedFinish).toBe(true);
    expect(state.showPrediction).toBe(false);
  });

  test("does not show a live prediction before Start", () => {
    const state = resolveCanonicalRaceState({
      resultStatus: "UNKNOWN",
      sections: [{ status: "not_started", rows: [row("Start", "missing"), row("Finish", "missing")] }],
    });
    expect(state.status).toBe("NOT_STARTED");
    expect(state.showPrediction).toBe(false);
  });

  test("intermediate Swim/Bike Finish rows never complete a triathlon", () => {
    const state = resolveCanonicalRaceState({
      resultStatus: "FINISHED",
      sections: [
        { status: "completed", rows: [row("Swim Start", "valid"), row("Swim Finish", "valid")] },
        { status: "in_progress", rows: [] },
        { status: "not_started", rows: [row("Bike Start", "missing"), row("Bike Finish", "missing")] },
        { status: "not_started", rows: [] },
        { status: "not_started", rows: [row("Run Start", "missing"), row("Run Finish", "missing")] },
      ],
    });
    expect(state.status).toBe("IN_PROGRESS");
    expect(state.hasConfirmedFinish).toBe(false);
  });
});
