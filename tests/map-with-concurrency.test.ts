import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "@/lib/map-with-concurrency";

describe("mapWithConcurrency", () => {
  it("preserves input order while limiting in-flight reads", async () => {
    let active = 0;
    let maximumActive = 0;
    const results = await mapWithConcurrency([0, 1, 2, 3, 4, 5, 6], 3, async (value) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return value * 2;
    });
    expect(results).toEqual([0, 2, 4, 6, 8, 10, 12]);
    expect(maximumActive).toBe(3);
  });

  it("handles empty inputs without invoking the mapper", async () => {
    const mapper = async () => { throw new Error("should not run"); };
    await expect(mapWithConcurrency([], 4, mapper)).resolves.toEqual([]);
  });
});
