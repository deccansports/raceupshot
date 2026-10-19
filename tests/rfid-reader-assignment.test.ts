import { describe, expect, it } from "vitest";
import { isReaderLikeEpc, rfidReaderAssignmentValue, timingChipCodeForDisplay } from "../lib/rfid-reader-assignment";

describe("RFID reader timing-chip assignment", () => {
  it("includes the final digit of a completed 10411 scan", () => {
    const epc = "000000000000000000010411";
    expect(rfidReaderAssignmentValue(epc).chipCode).toBe("10411");
    expect(timingChipCodeForDisplay(epc)).toBe("10411");
  });
  it("assigns only the last five decimal digits from a full EPC", () => {
    expect(rfidReaderAssignmentValue("E2003412012345678900")).toEqual({
      chipCode: "78900",
      fullEpc: "E2003412012345678900",
    });
  });

  it("preserves leading zeroes in the five-digit timing-chip code", () => {
    expect(rfidReaderAssignmentValue("300800000001").chipCode).toBe("00001");
  });

  it("supports structured reader payloads without inventory data", () => {
    expect(rfidReaderAssignmentValue('{"fullEpc":"300800010042"}')).toEqual({
      chipCode: "10042",
      fullEpc: "300800010042",
    });
  });

  it("rejects reader values that do not contain five decimal digits", () => {
    expect(() => rfidReaderAssignmentValue("E200ABCD")).toThrow(/at least five digits/i);
  });

  it("rejects a batch containing more than one unique tag", () => {
    expect(() => rfidReaderAssignmentValue("300800000001\n300800019858")).toThrow(/multiple RFID tags/i);
  });

  it("allows repeated reads of the same physical tag", () => {
    expect(rfidReaderAssignmentValue("300800019858\n300800019858").chipCode).toBe("19858");
  });

  it("detects keyboard-style EPC input and corrects legacy display values", () => {
    const epc = "00000000000000000001042A000000019858";
    expect(isReaderLikeEpc(epc)).toBe(true);
    expect(timingChipCodeForDisplay(epc)).toBe("19858");
    expect(timingChipCodeForDisplay("10001")).toBe("10001");
  });
});
