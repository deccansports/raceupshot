import { afterEach, describe, expect, it, vi } from "vitest";
import type { KVNamespace } from "@cloudflare/workers-types";

const { getCloudflareContextMock } = vi.hoisted(() => ({ getCloudflareContextMock: vi.fn() }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: getCloudflareContextMock }));

import { listVolunteers } from "@/lib/volunteer-management";

describe("listVolunteers remote KV reads", () => {
  afterEach(() => vi.clearAllMocks());

  it("bounds profile read fan-out while returning every profile", async () => {
    const ids = Array.from({ length: 13 }, (_, index) => `volunteer-${index}`);
    let activeReads = 0;
    let maximumActiveReads = 0;
    const profiles = new Map(ids.map((id) => [id, {
      id,
      name: id,
      email: `${id}@raceupshot.com`,
      mobile: "",
      status: "ACTIVE" as const,
      assignments: [],
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
      lastActiveAt: null,
    }]));
    const kv = {
      get: vi.fn(async <T>(key: string) => {
        if (key === "raceupshot:volunteer:profiles:index") return ids as T;
        activeReads += 1;
        maximumActiveReads = Math.max(maximumActiveReads, activeReads);
        await new Promise((resolve) => setTimeout(resolve, 2));
        activeReads -= 1;
        const id = decodeURIComponent(key.slice(key.lastIndexOf(":profile:") + ":profile:".length));
        return profiles.get(id) as T | undefined;
      }),
    } as unknown as KVNamespace;
    getCloudflareContextMock.mockResolvedValue({ env: { RACEUPSHOT: kv } });

    const result = await listVolunteers();

    expect(result).toHaveLength(ids.length);
    expect(maximumActiveReads).toBeLessThanOrEqual(4);
    expect(maximumActiveReads).toBe(4);
  });
});
