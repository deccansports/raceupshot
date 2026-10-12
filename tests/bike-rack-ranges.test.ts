import { describe, expect, it } from "vitest";
import { assignedBikeRack, validateBikeRackRanges } from "@/lib/bike-rack-ranges";

describe("event bike rack ranges", () => {
  const ranges = [
    { id: "a", rackName: "RACK 1A", bibFrom: 1000, bibTo: 1099 },
    { id: "b", rackName: "RACK 1B", bibFrom: 1100, bibTo: 1199 },
  ];

  it("resolves exact numeric BIBs at both range boundaries", () => {
    expect(assignedBikeRack("1000", ranges)).toBe("RACK 1A");
    expect(assignedBikeRack("1099", ranges)).toBe("RACK 1A");
    expect(assignedBikeRack("1100", ranges)).toBe("RACK 1B");
    expect(assignedBikeRack("1200", ranges)).toBeNull();
    expect(assignedBikeRack("1001A", ranges)).toBeNull();
  });

  it("rejects overlapping or invalid ranges", () => {
    expect(() => validateBikeRackRanges([...ranges, { id: "c", rackName: "RACK 2", bibFrom: 1099, bibTo: 1200 }])).toThrow("overlap");
    expect(() => validateBikeRackRanges([{ id: "x", rackName: "RACK X", bibFrom: 200, bibTo: 100 }])).toThrow("valid positive");
  });
});
