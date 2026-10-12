import { describe, expect, it } from "vitest";

import {
  COUNTRIES,
  getCountryDisplayName,
  getCountryFlag,
  getCountryFlagFromValue,
  normalizeCountryCode,
} from "@/lib/countries";

describe("country normalization", () => {
  it("stores names and common imported aliases as ISO2 codes", () => {
    expect(normalizeCountryCode("India")).toBe("IN");
    expect(normalizeCountryCode("IND")).toBe("IN");
    expect(normalizeCountryCode("USA")).toBe("US");
    expect(normalizeCountryCode("United Kingdom")).toBe("GB");
    expect(normalizeCountryCode("uae")).toBe("AE");
  });

  it("generates regional-indicator flags from ISO2 codes", () => {
    expect(getCountryFlag("IN")).toBe("🇮🇳");
    expect(getCountryFlag("us")).toBe("🇺🇸");
    expect(getCountryFlagFromValue("Germany")).toBe("🇩🇪");
    expect(getCountryFlag("IND")).toBe("");
  });

  it("includes the supplied registration countries", () => {
    expect(COUNTRIES).toHaveLength(56);
    expect(getCountryDisplayName("NZ")).toBe("New Zealand");
    expect(getCountryDisplayName("VN")).toBe("Vietnam");
    expect(getCountryDisplayName("MA")).toBe("Morocco");
  });
});
