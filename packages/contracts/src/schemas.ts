import { z } from "zod";
import {
  COURSE_MAP_TYPES,
  EVENT_LIFECYCLE_STATUSES,
  LIVE_BROADCAST_CHANNEL_TYPES,
  LIVE_BROADCAST_STATUSES,
  RACE_STATUSES,
} from "./index";

export const athleteVisibilitySchema = z.enum(["PUBLIC", "ANONYMOUS", "PRIVATE"]);
export const eventLifecycleStatusSchema = z.enum(EVENT_LIFECYCLE_STATUSES);
export const raceStatusSchema = z.enum(RACE_STATUSES);

export const liveTrackingSettingsSchema = z.object({
  liveTrackingEnabled: z.boolean(),
  publicLiveTrackingEnabled: z.boolean(),
  loginOnlyTracking: z.boolean(),
  athleteSearchEnabled: z.boolean(),
  leaderboardEnabled: z.boolean(),
  liveMapEnabled: z.boolean(),
  splitsEnabled: z.boolean(),
  estimatedPositionEnabled: z.boolean(),
  watchlistEnabled: z.boolean(),
  sharingEnabled: z.boolean(),
  anonymousTrackingAllowed: z.boolean(),
  privateTrackingAllowed: z.boolean(),
  defaultAthleteVisibility: athleteVisibilitySchema,
  forceVisibility: athleteVisibilitySchema.nullable(),
  resultsVisibleDuringRace: z.boolean(),
  provisionalLeaderboard: z.boolean(),
  liveTrackingStartAt: z.string().datetime().nullable(),
  liveTrackingEndAt: z.string().datetime().nullable(),
});

export const mobileEventSettingsSchema = z.object({
  mobilePublished: z.boolean(),
  mobileFeatured: z.boolean(),
  mobileSection: z.enum(["AUTO", "UPCOMING", "LIVE", "PAST"]),
  athleteSearchEnabled: z.boolean(),
  leaderboardEnabled: z.boolean(),
  courseMapEnabled: z.boolean(),
  watchlistEnabled: z.boolean(),
  notificationsEnabled: z.boolean(),
  resultsEnabled: z.boolean(),
  certificatesEnabled: z.boolean(),
  announcementsEnabled: z.boolean(),
  displayOrder: z.number().int().min(0),
  deepLinkSlug: z.string().regex(/^[a-z0-9-]+$/),
});

export const feibotIntegrationSchema = z.object({
  provider: z.literal("FEIBOT"),
  enabled: z.boolean(),
  baseUrl: z.string().url().refine((value) => value.startsWith("https://"), "Feibot base URL must use HTTPS"),
  accountReference: z.string().min(1).max(100),
  providerEventUuid: z.string().min(1).max(100),
  contestMappings: z.array(z.object({
    contestId: z.string().min(1),
    providerContestUuid: z.string().min(1),
  })).max(100),
  syncParticipants: z.boolean(),
  syncContests: z.boolean(),
  syncTimingPoints: z.boolean(),
  syncRealtime: z.boolean(),
  syncLeaderboards: z.boolean(),
  syncResults: z.boolean(),
  participantSyncIntervalSeconds: z.number().int().min(60).max(86400),
  realtimeSyncIntervalSeconds: z.number().int().min(5).max(3600),
  leaderboardSyncIntervalSeconds: z.number().int().min(5).max(3600),
  resultSyncIntervalSeconds: z.number().int().min(15).max(86400),
  enabledForWeb: z.boolean(),
  enabledForMobile: z.boolean(),
  timingResultSource: z.enum(["FEIBOT_PROCESSED", "RACE_UPSHOT_ENGINE"]).default("FEIBOT_PROCESSED"),
  resultTimeMode: z.enum(["CHIP", "GUN"]).default("CHIP"),
  passageGapMs: z.number().int().min(1_000).max(60_000).default(5_000),
  readerDetectionTimeoutMs: z.record(z.string(), z.number().int().min(1_000).max(300_000)).default({}),
  status: z.enum([
    "NOT_CONFIGURED", "CONNECTED", "INITIAL_SYNC", "READY", "LIVE_SYNC",
    "PAUSED", "RATE_LIMITED", "AUTH_ERROR", "PARTIAL_FAILURE", "FAILED",
    "COMPLETED",
  ]),
  lastTestedAt: z.string().datetime().nullable(),
  lastSuccessfulSyncAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
});

export const eventPlatformSettingsSchema = z.object({
  eventId: z.string().min(1),
  live: liveTrackingSettingsSchema,
  mobile: mobileEventSettingsSchema,
  timingIntegration: feibotIntegrationSchema.nullable(),
  updatedAt: z.string().datetime(),
});

export const liveBroadcastChannelSchema = z.object({
  channelId: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(150),
  type: z.enum(LIVE_BROADCAST_CHANNEL_TYPES),
  playbackUrl: z.string().trim().max(2_048),
  enabled: z.boolean(),
  displayOrder: z.number().int().min(0).max(10_000),
  posterUrl: z.string().url().optional(),
  description: z.string().trim().max(500).optional(),
  category: z.string().trim().max(80).optional(),
  featured: z.boolean().optional(),
}).superRefine((channel, context) => {
  let playable = false;
  try {
    const url = new URL(channel.playbackUrl);
    playable = url.protocol === "https:" || url.protocol === "http:";
  } catch {
    playable = false;
  }
  if (channel.enabled && !playable) {
    context.addIssue({
      code: "custom",
      path: ["playbackUrl"],
      message: "Add a valid HTTP or HTTPS playback URL before enabling this channel.",
    });
  }
});

export const broadcastAthleteOverlaySchema = z.object({
  enabled: z.boolean(),
  timingPointId: z.string().trim().max(150),
  timingPointName: z.string().trim().max(180),
  message: z.string().trim().min(1).max(80),
  displaySeconds: z.number().int().min(3).max(60),
  recentWindowSeconds: z.number().int().min(10).max(600),
  maxAthletes: z.number().int().min(1).max(5),
}).superRefine((overlay, context) => {
  if (overlay.enabled && !overlay.timingPointName) {
    context.addIssue({
      code: "custom",
      path: ["timingPointName"],
      message: "Choose the timing mat used for the athlete overlay.",
    });
  }
});

export const liveBroadcastConfigSchema = z.object({
  eventId: z.string().trim().min(1).max(150),
  enabled: z.boolean(),
  publicEnabled: z.boolean(),
  status: z.enum(LIVE_BROADCAST_STATUSES),
  title: z.string().trim().min(1).max(180),
  subtitle: z.string().trim().max(250),
  message: z.string().trim().max(1_000),
  activeChannelId: z.string().trim().max(100).nullable(),
  channels: z.array(liveBroadcastChannelSchema).max(20),
  athleteOverlay: broadcastAthleteOverlaySchema,
  posterUrl: z.string().url().optional(),
  startedAt: z.string().datetime().nullable(),
  endedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
}).superRefine((value, context) => {
  if (value.activeChannelId && !value.channels.some((channel) => channel.channelId === value.activeChannelId)) {
    context.addIssue({ code: "custom", path: ["activeChannelId"], message: "Choose an available broadcast channel." });
  }
});

export const coursePointSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  elevation: z.number().optional(),
});

export const eventCourseMapSchema = z.object({
  mapId: z.string().min(1).max(100),
  eventId: z.string().min(1).max(150),
  category: z.string().trim().min(1).max(150),
  mapName: z.string().trim().min(1).max(150),
  mapType: z.enum(COURSE_MAP_TYPES),
  customType: z.string().trim().max(100).optional(),
  fileName: z.string().trim().min(1).max(255),
  gpxUrl: z.string().trim().url().max(2_048).optional(),
  gpxData: z.string().max(4_000_000).optional(),
  points: z.array(coursePointSchema).min(2).max(20_000),
  distanceKm: z.number().min(0).max(100_000).nullable().optional(),
  description: z.string().trim().max(5_000).optional(),
  cutoffSeconds: z.number().int().min(0).max(31_536_000).nullable().optional(),
  routeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  visibility: z.object({
    web: z.boolean(),
    mobile: z.boolean(),
    public: z.boolean(),
  }),
  displayOrder: z.number().int().min(0).max(10_000),
  updatedAt: z.string().datetime(),
}).superRefine((value, context) => {
  if (value.mapType === "CUSTOM" && !value.customType?.trim()) {
    context.addIssue({ code: "custom", path: ["customType"], message: "Enter a custom map type." });
  }
});

export const eventCourseCollectionInputSchema = z.object({
  maps: z.array(eventCourseMapSchema).max(50),
});
