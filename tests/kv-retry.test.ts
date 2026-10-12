import { describe, expect, it, vi } from "vitest";
import { isTransientKvError, retryTransientKvOperation } from "../lib/kv-retry";

describe("remote KV transient retry", () => {
  it("retries Cloudflare remote-binding connection failures", async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error("Network connection lost."))
      .mockRejectedValueOnce(new Error("internal error; reference = example"))
      .mockResolvedValue("stored");
    await expect(retryTransientKvOperation(operation)).resolves.toBe("stored");
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("retries the local remote-binding proxy socket failure used by next dev", async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockRejectedValueOnce(new Error("connect EADDRNOTAVAIL 127.0.0.1:53549 - Local (0.0.0.0:0)"))
      .mockResolvedValue(["event-1"]);
    await expect(retryTransientKvOperation(operation)).resolves.toEqual(["event-1"]);
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("does not retry application errors", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("Event not found."));
    await expect(retryTransientKvOperation(operation)).rejects.toThrow("Event not found.");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("uses all bounded attempts before surfacing a persistent transport failure", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("fetch failed"));
    await expect(retryTransientKvOperation(operation, 2)).rejects.toThrow("fetch failed");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("recognizes and retries the Cloudflare KV HTTP 500 binding error", async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error("KV GET failed: 500 Internal Server Error"))
      .mockResolvedValue(["event-1"]);
    await expect(retryTransientKvOperation(operation, 2)).resolves.toEqual(["event-1"]);
    expect(operation).toHaveBeenCalledTimes(2);
    expect(isTransientKvError(new Error("KV GET failed: 500 Internal Server Error"))).toBe(true);
  });
});
