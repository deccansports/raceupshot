import { describe, expect, it } from "vitest";
import { athleteBand, finishLineChipTime, rollFinishers } from "@/components/finish-line-led-display";

describe("finish-line athlete group", () => {
  it("separates gender and age group for the LED display", () => {
    expect(athleteBand({ gender: "female", ageGroup: "under-30" })).toBe("F - UNDER 30");
    expect(athleteBand({ gender: "male", ageGroup: "under-30" })).toBe("M - UNDER 30");
  });

  it("does not add a separator when only one value exists", () => {
    expect(athleteBand({ gender: "", ageGroup: "40-44" })).toBe("40-44");
    expect(athleteBand({ gender: "", ageGroup: "" })).toBe("OPEN");
  });
});

describe("finish-line chip time", () => {
  it("shows hours, minutes and seconds without milliseconds", () => {
    expect(finishLineChipTime("03:09:52.000")).toBe("03:09:52");
    expect(finishLineChipTime("3:37:35.750")).toBe("03:37:35");
    expect(finishLineChipTime("02:49:54")).toBe("02:49:54");
  });

  it("preserves unavailable values", () => {
    expect(finishLineChipTime("—")).toBe("—");
  });
});

describe("rolling finishers", () => {
  it("puts each newly finished athlete above the existing athletes", () => {
    const previous = [{ id: "second", name: "Second" }, { id: "first", name: "First" }];
    const incoming = [{ id: "third", name: "Third" }, { id: "first", name: "First updated" }, { id: "second", name: "Second" }];
    const rolled = rollFinishers(previous, incoming);
    expect(rolled.newIds).toEqual(["third"]);
    expect(rolled.finishers.map((row) => row.id)).toEqual(["third", "second", "first"]);
    expect(rolled.finishers[2].name).toBe("First updated");
  });

  it("does not reshuffle athletes on a poll with no new finishers", () => {
    const previous = [{ id: "third" }, { id: "second" }, { id: "first" }];
    const incoming = [{ id: "first" }, { id: "second" }, { id: "third" }];
    expect(rollFinishers(previous, incoming)).toEqual({ finishers: previous, newIds: [] });
  });
});
