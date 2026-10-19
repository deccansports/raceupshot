import { describe, expect, it } from "vitest";
import { resolveChipReturn } from "../lib/chip-return";

describe("timing chip return", () => {
  it("accepts the assigned printed chip scanned by camera", () => {
    expect(resolveChipReturn({ assignedChipCode: "10865", scannedChipCode: "10865", method: "CAMERA" })).toMatchObject({ returnedChipCode: "10865", chipReturnStatus: "RETURNED", chipReturnMethod: "CAMERA" });
  });

  it("accepts the assigned five-digit chip entered manually", () => {
    expect(resolveChipReturn({ assignedChipCode: "29289", scannedChipCode: "29289", method: "MANUAL" })).toMatchObject({ returnedChipCode: "29289", chipReturnStatus: "RETURNED", chipReturnMethod: "MANUAL" });
  });

  it("resolves a reader EPC to the same final five printed digits", () => {
    expect(resolveChipReturn({ assignedChipCode: "19858", scannedChipCode: "000000000000000000001042A000000019858", method: "RFID" })).toMatchObject({ returnedChipCode: "19858", chipReturnStatus: "RETURNED", chipReturnMethod: "RFID" });
  });

  it("blocks a mismatched chip", () => {
    expect(() => resolveChipReturn({ assignedChipCode: "10865", scannedChipCode: "10728", method: "CAMERA" })).toThrow(/Chip mismatch/);
  });

  it("records no-chip checkout without falsely returning the chip", () => {
    expect(resolveChipReturn({ assignedChipCode: "10865", method: "OVERRIDE", reason: "Chip Lost" })).toEqual({ assignedChipCode: "10865", returnedChipCode: null, chipReturnStatus: "NOT_RETURNED", chipReturnMethod: "OVERRIDE", chipReturnReason: "Chip Lost", returnedChipFullEpc: null });
  });

  it("uses no-chip-assigned when the athlete never had a timing chip", () => {
    expect(resolveChipReturn({ assignedChipCode: "", method: "OVERRIDE", reason: "Chip Lost" })).toMatchObject({ chipReturnStatus: "NO_CHIP_ASSIGNED", chipReturnReason: null });
  });

  it("requires a reason for an override", () => {
    expect(() => resolveChipReturn({ assignedChipCode: "10865", method: "OVERRIDE" })).toThrow(/Select a reason/);
  });
});
