import { describe, expect, it } from "vitest";
import { liveBroadcastConfigSchema } from "../packages/contracts/src/schemas";

const validConfig = {
  eventId: "event-1",
  enabled: true,
  publicEnabled: true,
  status: "LIVE" as const,
  title: "Official live broadcast",
  subtitle: "Race Upshot event coverage",
  message: "Watch the race live.",
  activeChannelId: "main",
  channels: [{
    channelId: "main",
    name: "Main feed",
    type: "HLS" as const,
    playbackUrl: "https://media.example.test/live/master.m3u8",
    enabled: true,
    displayOrder: 0,
  }],
  athleteOverlay: {
    enabled: true,
    timingPointId: "finish-approach",
    timingPointName: "Finish Approach",
    message: "FINISHING SOON",
    displaySeconds: 10,
    recentWindowSeconds: 90,
    maxAthletes: 1,
  },
  startedAt: "2026-07-28T05:30:00.000Z",
  endedAt: null,
  updatedAt: "2026-07-28T05:30:00.000Z",
};

describe("live broadcast contracts", () => {
  it("accepts an event-scoped HLS broadcast", () => {
    expect(liveBroadcastConfigSchema.safeParse(validConfig).success).toBe(true);
  });

  it("rejects an active channel that is not configured", () => {
    const result = liveBroadcastConfigSchema.safeParse({
      ...validConfig,
      activeChannelId: "missing",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["activeChannelId"]);
  });

  it("rejects an invalid playback URL", () => {
    const result = liveBroadcastConfigSchema.safeParse({
      ...validConfig,
      channels: [{ ...validConfig.channels[0], playbackUrl: "not-a-url" }],
    });
    expect(result.success).toBe(false);
  });

  it("preserves an incomplete external URL in a disabled draft", () => {
    const result = liveBroadcastConfigSchema.safeParse({
      ...validConfig,
      activeChannelId: null,
      channels: [{ ...validConfig.channels[0], playbackUrl: "youtube-link-pending", enabled: false }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts an incomplete channel as a disabled draft", () => {
    const result = liveBroadcastConfigSchema.safeParse({
      ...validConfig,
      activeChannelId: null,
      channels: [{ ...validConfig.channels[0], playbackUrl: "", enabled: false }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an enabled draft without a playback URL", () => {
    const result = liveBroadcastConfigSchema.safeParse({
      ...validConfig,
      channels: [{ ...validConfig.channels[0], playbackUrl: "", enabled: true }],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toContain("playbackUrl");
  });

  it("supports multiple ordered broadcast channels", () => {
    const result = liveBroadcastConfigSchema.safeParse({
      ...validConfig,
      channels: [
        validConfig.channels[0],
        {
          channelId: "finish",
          name: "Finish line",
          type: "YOUTUBE",
          playbackUrl: "https://www.youtube.com/watch?v=live-stream",
          enabled: true,
          displayOrder: 1,
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});
