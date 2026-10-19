import { expect, it } from "vitest";
import { latestResettableTimingId } from "../lib/manual-timing-reset";
const stamp = (id: string) => ({ id, eventId: "event", volunteerId: "volunteer", action: "MANUAL_TIMING_CAPTURED" });
it("only permits the newest recorded stamp", () => {
  expect(latestResettableTimingId([stamp("new"), stamp("old")], "event", "volunteer")).toBe("new");
});
it("does not reopen old stamps after the latest is reset", () => {
  expect(latestResettableTimingId([{ ...stamp("reset"), action: "MANUAL_TIMING_RESET", reversesOperationId: "new" }, stamp("new"), stamp("old")], "event", "volunteer")).toBeNull();
});
it("isolates volunteers and events", () => {
  expect(latestResettableTimingId([stamp("new")], "other-event", "volunteer")).toBeNull();
  expect(latestResettableTimingId([stamp("new")], "event", "other-volunteer")).toBeNull();
});
