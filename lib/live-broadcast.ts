import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { KVNamespace } from "@cloudflare/workers-types";
import type {
  BroadcastAthleteOverlayConfig,
  LiveBroadcastChannel,
  LiveBroadcastChannelType,
  LiveBroadcastConfig,
  LiveBroadcastPublicData,
  LiveBroadcastStatus,
} from "@/packages/contracts/src";
import { getPublicLiveParticipants } from "./platform-repository";
import { getEventBySlug } from "./raceupshot-repository";
import type { RaceEvent } from "./types";

const PREFIX = "raceupshot";

const DEFAULT_ATHLETE_OVERLAY: BroadcastAthleteOverlayConfig = {
  enabled: false,
  timingPointId: "",
  timingPointName: "",
  message: "FINISHING SOON",
  displaySeconds: 10,
  recentWindowSeconds: 90,
  maxAthletes: 1,
};

async function getKv(): Promise<KVNamespace> {
  const { env } = await getCloudflareContext({ async: true });
  if (!env.RACEUPSHOT) throw new Error("RACEUPSHOT KV binding is unavailable.");
  return env.RACEUPSHOT;
}

function broadcastKey(eventId: string): string {
  return `${PREFIX}:event:${eventId}:broadcast`;
}

function validUrl(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function inferChannelType(url: string): LiveBroadcastChannelType {
  if (/\.m3u8(?:$|[?#])/i.test(url)) return "HLS";
  if (/\.(?:mp4|webm|mov)(?:$|[?#])/i.test(url)) return "VIDEO";
  if (/youtu(?:\.be|be\.com)/i.test(url)) return "YOUTUBE";
  return "EXTERNAL";
}

function defaultChannel(event: RaceEvent): LiveBroadcastChannel[] {
  const playbackUrl = validUrl(event.broadcastUrl);
  if (!playbackUrl) return [];
  return [{
    channelId: "main",
    name: "Main broadcast",
    type: inferChannelType(playbackUrl),
    playbackUrl,
    enabled: true,
    displayOrder: 0,
  }];
}

export function defaultLiveBroadcastConfig(event: RaceEvent): LiveBroadcastConfig {
  const channels = defaultChannel(event);
  const posterUrl = validUrl(event.bannerUrl);
  return {
    eventId: event.id,
    enabled: channels.length > 0,
    publicEnabled: channels.length > 0,
    status: event.status === "live" && channels.length ? "LIVE" : channels.length ? "SCHEDULED" : "OFFLINE",
    title: `${event.name} Live Broadcast`,
    subtitle: event.location,
    message: channels.length ? "The event broadcast will appear here when the stream is live." : "Broadcast details have not been published.",
    activeChannelId: channels[0]?.channelId ?? null,
    channels,
    athleteOverlay: DEFAULT_ATHLETE_OVERLAY,
    ...(posterUrl ? { posterUrl } : {}),
    startedAt: null,
    endedAt: null,
    updatedAt: event.dateIso || new Date(0).toISOString(),
  };
}

function sanitizeChannel(channel: LiveBroadcastChannel, index: number): LiveBroadcastChannel | null {
  const rawPlaybackUrl = String(channel.playbackUrl ?? "").trim();
  const playbackUrl = validUrl(rawPlaybackUrl);
  const posterUrl = validUrl(channel.posterUrl);
  return {
    channelId: String(channel.channelId || `channel-${index + 1}`).trim().slice(0, 100),
    name: String(channel.name || `Channel ${index + 1}`).trim().slice(0, 150),
    type: channel.type,
    playbackUrl: playbackUrl || rawPlaybackUrl.slice(0, 2_048),
    enabled: Boolean(playbackUrl) && channel.enabled !== false,
    displayOrder: Number.isFinite(channel.displayOrder) ? Math.max(0, Math.round(channel.displayOrder)) : index,
    ...(posterUrl ? { posterUrl } : {}),
    ...(channel.description?.trim() ? { description: channel.description.trim().slice(0, 500) } : {}),
    ...(channel.category?.trim() ? { category: channel.category.trim().slice(0, 80) } : {}),
    ...(channel.featured ? { featured: true } : {}),
  };
}

function mergeConfig(event: RaceEvent, stored: Partial<LiveBroadcastConfig> | null): LiveBroadcastConfig {
  const defaults = defaultLiveBroadcastConfig(event);
  const channels = (stored?.channels ?? defaults.channels)
    .map(sanitizeChannel)
    .filter((channel): channel is LiveBroadcastChannel => Boolean(channel))
    .sort((a, b) => a.displayOrder - b.displayOrder);
  const activeChannelId = stored?.activeChannelId && channels.some((channel) => channel.channelId === stored.activeChannelId)
    ? stored.activeChannelId
    : channels.find((channel) => channel.enabled)?.channelId ?? null;
  const posterUrl = validUrl(stored?.posterUrl) || defaults.posterUrl;
  return {
    ...defaults,
    ...stored,
    eventId: event.id,
    enabled: stored?.enabled ?? defaults.enabled,
    publicEnabled: stored?.publicEnabled ?? defaults.publicEnabled,
    status: (stored?.status ?? defaults.status) as LiveBroadcastStatus,
    title: String(stored?.title || defaults.title).trim(),
    subtitle: String(stored?.subtitle ?? defaults.subtitle).trim(),
    message: String(stored?.message ?? defaults.message).trim(),
    activeChannelId,
    channels,
    athleteOverlay: {
      ...DEFAULT_ATHLETE_OVERLAY,
      ...(stored?.athleteOverlay ?? {}),
    },
    ...(posterUrl ? { posterUrl } : {}),
    startedAt: stored?.startedAt ?? null,
    endedAt: stored?.endedAt ?? null,
    updatedAt: stored?.updatedAt ?? defaults.updatedAt,
  };
}

export async function getLiveBroadcastConfig(eventIdOrSlug: string): Promise<LiveBroadcastConfig | null> {
  const event = await getEventBySlug(eventIdOrSlug, { includeUnpublished: true });
  if (!event) return null;
  return getLiveBroadcastConfigForEvent(event);
}

export async function getLiveBroadcastConfigForEvent(event: RaceEvent): Promise<LiveBroadcastConfig> {
  const kv = await getKv();
  const stored = await kv.get<Partial<LiveBroadcastConfig>>(broadcastKey(event.id), "json");
  return mergeConfig(event, stored);
}

export async function saveLiveBroadcastConfig(eventId: string, input: LiveBroadcastConfig): Promise<LiveBroadcastConfig> {
  const event = await getEventBySlug(eventId, { includeUnpublished: true });
  if (!event) throw new Error("Event not found.");
  const kv = await getKv();
  const config = mergeConfig(event, { ...input, eventId: event.id, updatedAt: new Date().toISOString() });
  const auditId = crypto.randomUUID();
  await Promise.all([
    kv.put(broadcastKey(event.id), JSON.stringify(config)),
    kv.put(`${PREFIX}:timing:audit:${auditId}`, JSON.stringify({
      id: auditId,
      action: "LIVE_BROADCAST_UPDATED",
      entity: event.name,
      eventId: event.id,
      actor: "Race Upshot admin",
      createdAt: config.updatedAt,
    })),
  ]);
  return config;
}

export async function getPublicLiveBroadcast(eventIdOrSlug: string): Promise<LiveBroadcastPublicData | null> {
  const event = await getEventBySlug(eventIdOrSlug);
  if (!event) return null;
  const config = await getLiveBroadcastConfig(event.id);
  if (!config) return null;
  const isPublicEnabled = config.enabled && config.publicEnabled;
  const channels = isPublicEnabled ? config.channels.filter((channel) => channel.enabled && Boolean(validUrl(channel.playbackUrl))) : [];
  const activeChannel = channels.find((channel) => channel.channelId === config.activeChannelId) ?? channels[0] ?? null;
  return {
    eventId: event.id,
    eventSlug: event.slug,
    eventName: event.name,
    enabled: isPublicEnabled,
    status: isPublicEnabled ? config.status : "OFFLINE",
    title: config.title,
    subtitle: config.subtitle,
    message: config.message,
    activeChannel,
    channels,
    athleteOverlay: config.athleteOverlay,
    posterUrl: activeChannel?.posterUrl || config.posterUrl,
    startedAt: config.startedAt,
    endedAt: config.endedAt,
    updatedAt: config.updatedAt,
  };
}

export interface BroadcastTimingPointOption {
  id: string;
  name: string;
}

export async function getBroadcastTimingPoints(eventIdOrSlug: string): Promise<BroadcastTimingPointOption[]> {
  const read = await getPublicLiveParticipants(eventIdOrSlug);
  if (!read) return [];
  const points = new Map<string, BroadcastTimingPointOption>();
  for (const participant of read.data) {
    for (const split of participant.splits) {
      const id = split.splitId.trim();
      const name = split.name.trim();
      if (!id && !name) continue;
      const key = (id || name).toLowerCase();
      if (!points.has(key)) points.set(key, { id: id || name, name: name || id });
    }
  }
  return [...points.values()].sort((a, b) => a.name.localeCompare(b.name));
}
