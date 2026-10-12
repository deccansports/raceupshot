import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn(), list: vi.fn() }));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: async () => ({ env: { RACEUPSHOT: { get: mocks.get, list: mocks.list } } }),
}));

import { getCmsSiteSettings, getEvents, getHomepageSliderConfig } from "../lib/raceupshot-repository";

describe("public event discovery resilience", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockResolvedValue({ keys: [], list_complete: true, cursor: "" });
  });

  it("uses an empty cold fallback, then serves the last good public list after a KV failure", async () => {
    mocks.get.mockRejectedValue(new Error("KV GET failed: 500 Internal Server Error"));
    await expect(getEvents()).resolves.toEqual([]);

    mocks.get.mockImplementation(async (key: string) => {
      if (key === "raceupshot:events:index") return ["event-1"];
      if (key === "raceupshot:event:event-1") return {
        id: "event-1", slug: "event-one", name: "Event One", status: "upcoming",
        date: "2026-10-25", sport: "Triathlon", location: "Udupi", categories: ["Olympic"],
      };
      return null;
    });
    await expect(getEvents()).resolves.toEqual([expect.objectContaining({ id: "event-1", name: "Event One" })]);

    mocks.get.mockRejectedValue(new Error("KV GET failed: 500 Internal Server Error"));
    await expect(getEvents()).resolves.toEqual([expect.objectContaining({ id: "event-1", name: "Event One" })]);
  }, 15_000);

  it("does not conceal persistent transient KV failures from admin discovery", async () => {
    mocks.get.mockRejectedValue(new Error("KV GET failed: 500 Internal Server Error"));
    await expect(getEvents({ includeUnpublished: true })).rejects.toThrow("KV GET failed: 500 Internal Server Error");
  }, 15_000);

  it("uses safe public defaults for homepage CMS reads during a cold KV outage", async () => {
    mocks.get.mockRejectedValue(new Error("KV GET failed: 500 Internal Server Error"));
    await expect(getHomepageSliderConfig({ publicFallback: true })).resolves.toEqual({ enabled: true, slides: [] });
    await expect(getCmsSiteSettings({ publicFallback: true })).resolves.toMatchObject({
      footer: { email: "info@raceupshot.com" },
    });
  }, 15_000);
});
