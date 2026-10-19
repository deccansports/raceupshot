import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  list: vi.fn(),
  athlete: vi.fn(),
}));

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: async () => ({
    env: { RACEUPSHOT: { get: mocks.get, put: mocks.put, delete: mocks.delete, list: mocks.list } },
  }),
}));
vi.mock("../lib/athlete-request-auth", () => ({ requireAthleteRequest: mocks.athlete }));

import {
  deleteMobileWatchlistItem,
  listMobileWatchlist,
  registerMobilePushDevice,
  saveMobileWatchlistItem,
} from "../lib/mobile-watchlist";

describe("authenticated mobile watchlist storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.athlete.mockResolvedValue({ uid: "athlete-account-1" });
    mocks.list.mockResolvedValue({ keys: [] });
    mocks.put.mockResolvedValue(undefined);
    mocks.delete.mockResolvedValue(undefined);
  });

  it("stores watchlist records under the authenticated account, not a public device owner", async () => {
    const request = new Request("https://raceupshot.com/api/watchlist", { headers: { authorization: "Bearer test" } });
    await saveMobileWatchlistItem(request, {
      id: "event-1:runner-1",
      eventId: "event-1",
      athleteId: "runner-1",
      label: "Runner",
      deviceId: "device-12345678",
      athlete: { bib: "1001", name: "Runner" },
    });
    expect(mocks.athlete).toHaveBeenCalledWith(request);
    expect(mocks.put.mock.calls[0][0]).toContain("account%3Aathlete-account-1");
    expect(mocks.put.mock.calls[0][0]).not.toContain("device%3A");
    expect(JSON.parse(mocks.put.mock.calls[0][1])).toMatchObject({ eventId: "event-1", athleteId: "runner-1" });
  });

  it("lists and deletes only within the authenticated account namespace", async () => {
    const request = new Request("https://raceupshot.com/api/watchlist", { headers: { authorization: "Bearer test" } });
    mocks.list.mockResolvedValue({ keys: [{ name: "stored-row" }] });
    mocks.get.mockResolvedValue({ id: "event-1:runner-1", eventId: "event-1", athleteId: "runner-1" });
    await expect(listMobileWatchlist(request)).resolves.toHaveLength(1);
    expect(mocks.list.mock.calls[0][0].prefix).toContain("account%3Aathlete-account-1");
    await deleteMobileWatchlistItem(request, "event-1:runner-1");
    expect(mocks.delete.mock.calls[0][0]).toContain("account%3Aathlete-account-1");
  });

  it("registers a validated Expo token against the authenticated account", async () => {
    const request = new Request("https://raceupshot.com/api/mobile/push/register", { headers: { authorization: "Bearer test" } });
    await expect(registerMobilePushDevice(request, {
      deviceId: "device-12345678",
      expoPushToken: "ExponentPushToken[valid-token]",
      platform: "ios",
      appVersion: "1.0.0",
    })).resolves.toMatchObject({ registered: true });
    expect(mocks.put.mock.calls[0][0]).toContain("account%3Aathlete-account-1");
  });

  it("rejects malformed device and push identifiers", async () => {
    const request = new Request("https://raceupshot.com/api/watchlist", { headers: { authorization: "Bearer test" } });
    await expect(saveMobileWatchlistItem(request, { eventId: "event", athleteId: "athlete", deviceId: "x" })).rejects.toThrow("device ID");
    await expect(registerMobilePushDevice(request, { deviceId: "device-12345678", expoPushToken: "not-a-token" })).rejects.toThrow("push token");
  });
});
