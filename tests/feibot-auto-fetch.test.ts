import { describe, expect, it } from "vitest";
import {
  MAX_FEIBOT_RESULT_FETCH_SECONDS,
  MIN_FEIBOT_RESULT_FETCH_SECONDS,
  normalizedFeibotResultFetchSeconds,
} from "@/lib/feibot-auto-fetch";

describe("Feibot result auto-fetch interval", () => {
  it("enforces the 30-second provider minimum", () => {
    expect(normalizedFeibotResultFetchSeconds(1)).toBe(MIN_FEIBOT_RESULT_FETCH_SECONDS);
    expect(normalizedFeibotResultFetchSeconds(29.7)).toBe(MIN_FEIBOT_RESULT_FETCH_SECONDS);
    expect(normalizedFeibotResultFetchSeconds(Number.NaN)).toBe(MIN_FEIBOT_RESULT_FETCH_SECONDS);
  });

  it("keeps an admin-selected valid interval", () => {
    expect(normalizedFeibotResultFetchSeconds(90)).toBe(90);
    expect(normalizedFeibotResultFetchSeconds(120.4)).toBe(120);
  });

  it("caps the interval at one hour", () => {
    expect(normalizedFeibotResultFetchSeconds(9_999)).toBe(MAX_FEIBOT_RESULT_FETCH_SECONDS);
  });
});
