import { describe, expect, it } from "vitest";
import { timingProviderError, timingProviderOutcome } from "@/lib/timing-provider-response";

describe("timing provider response handling", () => {
  it("detects an RTRT error inside HTTP 200", () => {
    const error = timingProviderError({ error: {
      code: "4440",
      type: "rate_limit",
      msg: "Rate limit exceeded.",
      display: "Please allow more time between requests.",
      retryable: "1",
    } }, 200);

    expect(error).toMatchObject({
      code: "4440",
      type: "rate_limit",
      status: 429,
      retryable: true,
      outcome: "error",
      displayMessage: "Please allow more time between requests.",
    });
  });

  it("treats no changes as a successful polling sentinel", () => {
    expect(timingProviderOutcome({ error: {
      code: "2042",
      type: "no_changes",
      msg: "Checksums match.",
      retryable: "1",
    } }, 200)).toBe("not_modified");
  });

  it("treats no results as an empty response instead of corrupt data", () => {
    expect(timingProviderError({ error: {
      code: "2040",
      type: "no_results",
      msg: "No matching results.",
    } }, 200)).toMatchObject({ status: 404, outcome: "no_results", retryable: false });
  });

  it("maps authorization and service errors to semantic statuses", () => {
    expect(timingProviderError({ error: { code: "4010", type: "not_authorized" } }, 200)?.status).toBe(401);
    expect(timingProviderError({ error: { code: "5030", type: "service_unavailable", retryable: 1 } }, 200))
      .toMatchObject({ status: 503, retryable: true });
  });
});
