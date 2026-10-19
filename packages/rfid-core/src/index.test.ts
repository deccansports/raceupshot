import { describe, expect, it } from "vitest";
import { decodeChipNumber, encodeChipNumber, generateProfileSequence, parseRfidIdentifier, RfidPresenceTracker, validateRfidDetectionConfig, type EpcProfile, type RfidTagRead } from "./index";

const profile: EpcProfile = {
  id: "verified", name: "Verified decimal profile", epcLength: 24, prefix: "000020",
  chipNumberPosition: 14, chipNumberLength: 10, numberEncoding: "DECIMAL_DIGITS",
  leadingZeroPolicy: "PAD", sequenceIncrement: 1, maximumChipNumber: "9999999999", verified: true, active: true,
};

describe("RFID EPC profiles", () => {
  it("round-trips a human-readable chip number without converting the whole EPC", () => {
    const epc = encodeChipNumber("10001", profile);
    expect(epc).toBe("000020000000000000010001");
    expect(decodeChipNumber(epc, profile)).toMatchObject({ matched: true, chipNumber: "10001" });
  });

  it("reports unknown formats and creates reversible sequences", () => {
    expect(decodeChipNumber("300800000001", profile).error).toBe("UNKNOWN_EPC_FORMAT");
    expect(generateProfileSequence(profile, "10001", 3).map((row) => row.chipNumber)).toEqual(["10001", "10002", "10003"]);
  });

  it("classifies plain, JSON and URL assignment payloads", () => {
    expect(parseRfidIdentifier("10001")).toMatchObject({ kind: "CHIP_NUMBER", value: "10001" });
    expect(parseRfidIdentifier('{"fullEpc":"300800000001"}').candidates).toContain("300800000001");
    expect(parseRfidIdentifier("https://chips.example.test/scan?inventoryId=rfid-123").candidates).toContain("RFID-123");
  });
});

const tag = (epc: string, readAt: string, rssi = -30, antenna = 1, tid?: string): RfidTagRead => ({ epc, tid, rssi, antenna, readAt });

describe("RFID presence detection", () => {
  it("accepts one entry and suppresses continuous inventory for any duration", () => {
    const tracker = new RfidPresenceTracker({ absenceTimeoutMs: 1_000 });
    expect(tracker.processFrame([tag("300800000001", "2026-10-17T00:00:00.000Z")], 0).accepted).toHaveLength(1);
    let lastDecision = "";
    for (let now = 500; now <= 300_000; now += 500) {
      const frame = tracker.processFrame([tag("300800000001", new Date(now).toISOString())], now);
      expect(frame.accepted).toHaveLength(0);
      lastDecision = frame.raw[0].decision;
    }
    expect(lastDecision).toBe("DUPLICATE_IN_RANGE");
  });

  it("requires a confirmed absence before accepting re-entry", () => {
    const tracker = new RfidPresenceTracker({ absenceTimeoutMs: 1_000 });
    tracker.processFrame([tag("300800000001", "2026-10-17T00:00:00.000Z")], 0);
    expect(tracker.processFrame([], 999).transitions).toHaveLength(0);
    const exit = tracker.processFrame([], 1_000);
    expect(exit.transitions[0]).toMatchObject({ from: "IN_RANGE", to: "EXIT_DETECTED", reason: "ABSENCE_TIMEOUT" });
    const reentry = tracker.processFrame([tag("300800000001", "2026-10-17T00:00:01.100Z")], 1_100);
    expect(reentry.accepted[0]).toMatchObject({ entryNumber: 2, identity: "EPC:300800000001" });
  });

  it("uses TID identity and filters disallowed antennas and weak RSSI", () => {
    const tracker = new RfidPresenceTracker({ antennaIds: [2], rssiThreshold: -45 });
    const rejectedAntenna = tracker.processFrame([tag("300800000001", "", -30, 1, "E2000017221101441890ABCD")], 0);
    expect(rejectedAntenna.raw[0].decision).toBe("ANTENNA_REJECTED");
    const rejectedRssi = tracker.processFrame([tag("300800000001", "", -60, 2, "E2000017221101441890ABCD")], 1);
    expect(rejectedRssi.raw[0].decision).toBe("RSSI_REJECTED");
    const accepted = tracker.processFrame([tag("300800000001", "", -40, 2, "E2000017221101441890ABCD")], 2);
    expect(accepted.accepted[0].identity).toBe("TID:E2000017221101441890ABCD");
  });

  it("preserves raw inventory while accepting one copy of a repeated tag", () => {
    const tracker = new RfidPresenceTracker();
    const result = tracker.processFrame([
      tag("300800000001", "", -50), tag("300800000001", "", -25), tag("300800000001", "", -35),
    ], 0);
    expect(result.raw).toHaveLength(3);
    expect(result.accepted).toHaveLength(1);
    expect(result.raw.map((event) => event.decision)).toEqual(["ACCEPTED_ENTRY", "DUPLICATE_IN_RANGE", "DUPLICATE_IN_RANGE"]);
  });

  it("requires physical calibration evidence before marking a six-inch profile calibrated", () => {
    expect(() => validateRfidDetectionConfig({ physicallyCalibrated: true })).toThrow(/calibration method/i);
    expect(validateRfidDetectionConfig({
      targetRangeCm: 15.24, physicallyCalibrated: true, calibrationMethod: "NEAR_FIELD_ANTENNA",
      calibrationNotes: "Bench tested with representative race tags at 15.24 cm.",
    }).physicallyCalibrated).toBe(true);
  });
});
