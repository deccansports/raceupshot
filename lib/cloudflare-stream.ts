import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { KVNamespace } from "@cloudflare/workers-types";

type JsonRecord = Record<string, unknown>;

export interface CloudflareStreamInput {
  uid: string;
  name: string;
  eventId: string;
  enabled: boolean;
  status: string;
  recordingMode: "automatic" | "off";
  preferLowLatency: boolean;
  created: string;
  modified: string;
  rtmpsUrl?: string;
  streamKey?: string;
  srtUrl?: string;
  srtStreamId?: string;
  srtPassphrase?: string;
  webRtcUrl?: string;
  playbackUrl?: string;
  previewUrl?: string;
  activeVideoUid?: string;
  viewerCount: number;
  cameraType: string;
  locationMode: "fixed" | "mobile";
  assignedLocation: string;
  latitude?: number;
  longitude?: number;
  coverageRadius?: number;
  priority: number;
}

export interface CloudflareStreamVideo {
  uid: string;
  name: string;
  description: string;
  status: string;
  created: string;
  modified: string;
  duration: number;
  size: number;
  thumbnail?: string;
  preview?: string;
  hlsUrl?: string;
  dashUrl?: string;
  liveInputId?: string;
  readyToStream: boolean;
  scheduledDeletion?: string;
}

export interface CloudflareStreamDashboard {
  configured: boolean;
  accountId: string;
  message: string;
  inputs: CloudflareStreamInput[];
  videos: CloudflareStreamVideo[];
  layout: "single" | "2" | "4" | "9" | "auto";
  totals: {
    liveCameras: number;
    nonLiveStates: number;
    currentViewers: number | null;
    averageLatencyMs: number | null;
    eventStatus: "Live" | "Standby" | "Not configured";
  };
}

export interface CloudflareStreamDiagnostics {
  input: CloudflareStreamInput;
  checkedAt: string;
  playback: {
    source: "Live Input" | "Recorded Video";
    status: "Ready" | "Waiting";
    playbackUrl: string;
    livePlayback: "Ready" | "Pending";
    recording: "Ready" | "Pending";
    replay: "Ready" | "Pending";
    recordingVideoUid?: string;
    associatedToLiveInput: boolean;
    message: string;
  };
  health: {
    cloudflareStatus: string;
    connection: "Online" | "Offline" | "Disabled";
    signalPercent: number;
    bitrateKbps: number;
    fps: number;
    protocol: "RTMPS";
    recording: "On" | "Off";
    viewers: number;
    durationSeconds: number;
    connectionQuality: "Live" | "Offline" | "Disabled";
    lastConnected?: string;
    lastDisconnected?: string;
  };
  obs: {
    overall: "Pass" | "Fail";
    failingStage?: string;
    stages: Array<{
      name: string;
      status: "Pass" | "Fail" | "Waiting";
      message: string;
    }>;
  };
}

export interface CloudflareStreamProvisioning {
  version: "1.0.0";
  provider: "cloudflare_stream";
  cameraName: string;
  liveInputUid: string;
  rtmpsServer: string;
  encryptedStreamKey: string;
  configurationVersion: "broadcast.provisioning.v1";
  timestamp: string;
}

const SESSION_PREFIX = "raceupshot:broadcast:session:";

interface CloudflareCredentials {
  accountId: string;
  token: string;
}

interface CloudflareResponse<T> {
  success?: boolean;
  result?: T;
  total?: number;
  errors?: Array<{ message?: string }>;
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

async function provisioningSecret(): Promise<string> {
  const { env } = await getCloudflareContext({ async: true });
  const secret = env.STREAM_PROVISIONING_SECRET
    || env.ADMIN_SESSION_SECRET
    || process.env.STREAM_PROVISIONING_SECRET
    || process.env.ADMIN_SESSION_SECRET
    || "";
  if (!secret) {
    throw new Error("Set STREAM_PROVISIONING_SECRET or ADMIN_SESSION_SECRET before generating camera provisioning.");
  }
  return secret;
}

async function encryptProvisioningValue(value: string): Promise<string> {
  const secret = await provisioningSecret();
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  const key = await crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(value));
  return `enc:v1:${base64Url(iv)}:${base64Url(new Uint8Array(encrypted))}`;
}

async function credentials(): Promise<CloudflareCredentials | null> {
  const { env } = await getCloudflareContext({ async: true });
  const accountId = env.CLOUDFLARE_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID || "";
  const token = env.CLOUDFLARE_STREAM_API_TOKEN
    || env.CLOUDFLARE_API_TOKEN
    || env.KV_TOKEN
    || process.env.CLOUDFLARE_STREAM_API_TOKEN
    || process.env.CLOUDFLARE_API_TOKEN
    || process.env.KV_TOKEN
    || "";
  return accountId && token ? { accountId, token } : null;
}

async function missingCredentialsMessage(): Promise<string> {
  const { env } = await getCloudflareContext({ async: true });
  const accountId = env.CLOUDFLARE_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID || "";
  if (!accountId) {
    return "CLOUDFLARE_ACCOUNT_ID is missing. Add the account identifier to .env.local or .dev.vars, then restart the server.";
  }
  return "A Cloudflare API token with Stream Read and Stream Write is missing. Configure CLOUDFLARE_STREAM_API_TOKEN (or the existing KV_TOKEN when it has Stream permissions), then restart.";
}

function rejectedCredentialsMessage(message: string): string {
  return `Cloudflare rejected the configured Stream API token: ${message} Replace CLOUDFLARE_STREAM_API_TOKEN with a token that has Stream Read and Stream Write for this account.`;
}

async function kv(): Promise<KVNamespace | null> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return env.RACEUPSHOT as KVNamespace;
  } catch {
    return null;
  }
}

async function cloudflareRequest<T>(
  auth: CloudflareCredentials,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(auth.accountId)}/stream${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${auth.token}`,
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (response.status === 204) return undefined as T;
  const payload = await response.json() as CloudflareResponse<T>;
  if (!response.ok || payload.success === false) {
    throw new Error(payload.errors?.map((error) => error.message).filter(Boolean).join("; ") || `Cloudflare Stream request failed (${response.status}).`);
  }
  return payload.result as T;
}

function normalizeVideo(value: unknown): CloudflareStreamVideo {
  const video = record(value);
  const meta = record(video.meta);
  const status = record(video.status);
  const playback = record(video.playback);
  return {
    uid: text(video.uid),
    name: text(meta.name) || text(video.uid) || "Untitled video",
    description: text(meta.description),
    status: text(status.state) || "unknown",
    created: text(video.created) || text(video.uploaded),
    modified: text(video.modified),
    duration: number(video.duration),
    size: number(video.size),
    thumbnail: text(video.thumbnail) || undefined,
    preview: text(video.preview) || undefined,
    hlsUrl: text(playback.hls) || undefined,
    dashUrl: text(playback.dash) || undefined,
    liveInputId: text(video.liveInput) || undefined,
    readyToStream: video.readyToStream === true,
    scheduledDeletion: text(video.scheduledDeletion) || undefined,
  };
}

function numericMeta(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeInput(value: unknown, videos: CloudflareStreamVideo[], includeSecret = false): CloudflareStreamInput {
  const input = record(value);
  const meta = record(input.meta);
  const recording = record(input.recording);
  const rtmps = record(input.rtmps);
  const srt = record(input.srt);
  const webRtc = record(input.webRTC);
  const activeVideo = videos.find((video) => video.liveInputId === text(input.uid) && video.status === "live-inprogress");
  return {
    uid: text(input.uid),
    name: text(meta.name) || "Camera",
    eventId: text(meta.eventId),
    enabled: input.enabled !== false,
    status: activeVideo ? "connected" : text(input.status) || "standby",
    recordingMode: recording.mode === "automatic" ? "automatic" : "off",
    preferLowLatency: input.preferLowLatency === true,
    created: text(input.created),
    modified: text(input.modified),
    rtmpsUrl: text(rtmps.url) || undefined,
    streamKey: includeSecret ? text(rtmps.streamKey) || undefined : undefined,
    srtUrl: text(srt.url) || undefined,
    srtStreamId: text(srt.streamId) || undefined,
    srtPassphrase: text(srt.passphrase) || undefined,
    webRtcUrl: text(webRtc.url) || undefined,
    playbackUrl: activeVideo?.hlsUrl,
    previewUrl: activeVideo?.preview,
    activeVideoUid: activeVideo?.uid,
    viewerCount: 0,
    cameraType: text(meta.cameraType) || "custom",
    locationMode: text(meta.locationMode) === "mobile" ? "mobile" : "fixed",
    assignedLocation: text(meta.assignedLocation),
    latitude: numericMeta(meta.latitude),
    longitude: numericMeta(meta.longitude),
    coverageRadius: numericMeta(meta.coverageRadius),
    priority: numericMeta(meta.priority) ?? 0,
  };
}

async function listVideos(auth: CloudflareCredentials): Promise<CloudflareStreamVideo[]> {
  const result = await cloudflareRequest<unknown[]>(auth, "?limit=1000&include_counts=true");
  return (Array.isArray(result) ? result : []).map(normalizeVideo);
}

async function listInputs(auth: CloudflareCredentials, videos: CloudflareStreamVideo[]): Promise<CloudflareStreamInput[]> {
  const result = await cloudflareRequest<unknown>(auth, "/live_inputs?include_counts=true");
  const rows = Array.isArray(result) ? result : Array.isArray(record(result).liveInputs) ? record(result).liveInputs as unknown[] : [];
  return Promise.all(rows.map(async (input) => {
    const uid = text(record(input).uid);
    if (!uid) return normalizeInput(input, videos);
    try {
      const details = await cloudflareRequest<unknown>(auth, `/live_inputs/${encodeURIComponent(uid)}`);
      return normalizeInput(details, videos);
    } catch {
      return normalizeInput(input, videos);
    }
  }));
}

async function liveViewerCount(input: CloudflareStreamInput): Promise<number> {
  if (!input.playbackUrl || input.status !== "connected") return 0;
  try {
    const playback = new URL(input.playbackUrl);
    const response = await fetch(`${playback.protocol}//${playback.host}/${encodeURIComponent(input.uid)}/views`, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return 0;
    const payload = await response.json() as { liveViewers?: number };
    return typeof payload.liveViewers === "number" && Number.isFinite(payload.liveViewers) ? payload.liveViewers : 0;
  } catch {
    return 0;
  }
}

async function getStoredLayout(eventId: string): Promise<CloudflareStreamDashboard["layout"]> {
  if (!eventId) return "auto";
  const binding = await kv();
  if (!binding) return "auto";
  const stored = await binding.get<{ layout?: CloudflareStreamDashboard["layout"] }>(`${SESSION_PREFIX}${eventId}`, "json");
  return stored?.layout && ["single", "2", "4", "9", "auto"].includes(stored.layout) ? stored.layout : "auto";
}

export async function saveCloudflareStreamLayout(eventId: string, layout: CloudflareStreamDashboard["layout"]): Promise<void> {
  const binding = await kv();
  if (!binding) throw new Error("RACEUPSHOT KV is not configured.");
  await binding.put(`${SESSION_PREFIX}${eventId}`, JSON.stringify({
    eventId,
    layout,
    updatedAt: new Date().toISOString(),
  }));
}

export async function getCloudflareStreamDashboard(eventId = ""): Promise<CloudflareStreamDashboard> {
  const auth = await credentials();
  const layout = await getStoredLayout(eventId);
  if (!auth) {
    return {
      configured: false,
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID || "",
      message: await missingCredentialsMessage(),
      inputs: [],
      videos: [],
      layout,
      totals: { liveCameras: 0, nonLiveStates: 0, currentViewers: 0, averageLatencyMs: 0, eventStatus: "Not configured" },
    };
  }
  let videos: CloudflareStreamVideo[];
  let allInputs: CloudflareStreamInput[];
  try {
    videos = await listVideos(auth);
    allInputs = await listInputs(auth, videos);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Authentication failed.";
    if (/auth|token|permission|forbidden|unauthor/i.test(message)) {
      return {
        configured: false,
        accountId: auth.accountId,
        message: rejectedCredentialsMessage(message),
        inputs: [],
        videos: [],
        layout,
        totals: { liveCameras: 0, nonLiveStates: 0, currentViewers: 0, averageLatencyMs: 0, eventStatus: "Not configured" },
      };
    }
    throw error;
  }
  const inputs = eventId ? allInputs.filter((input) => input.eventId === eventId) : allInputs;
  const liveCameras = inputs.filter((input) => input.status === "connected").length;
  const viewerCounts = await Promise.all(inputs.map(liveViewerCount));
  inputs.forEach((input, index) => {
    input.viewerCount = viewerCounts[index] ?? 0;
  });
  const currentViewers = viewerCounts.reduce((total, count) => total + count, 0);
  return {
    configured: true,
    accountId: auth.accountId,
    message: "Connected to Cloudflare Stream.",
    inputs,
    videos,
    layout,
    totals: {
      liveCameras,
      nonLiveStates: Math.max(0, inputs.length - liveCameras),
      currentViewers,
      averageLatencyMs: liveCameras ? null : 0,
      eventStatus: liveCameras ? "Live" : "Standby",
    },
  };
}

export async function createCloudflareLiveInput(input: {
  eventId: string;
  eventName: string;
  name: string;
  cameraType?: string;
  locationMode?: "fixed" | "mobile";
  assignedLocation?: string;
  latitude?: number;
  longitude?: number;
  coverageRadius?: number;
  priority?: number;
  recordingEnabled?: boolean;
}): Promise<CloudflareStreamInput> {
  const auth = await credentials();
  if (!auth) throw new Error("Cloudflare Stream is not configured.");
  const created = await cloudflareRequest<unknown>(auth, "/live_inputs", {
    method: "POST",
    body: JSON.stringify({
      enabled: true,
      meta: {
        name: input.name.trim(),
        eventId: input.eventId,
        eventName: input.eventName,
        cameraType: input.cameraType || "custom",
        locationMode: input.locationMode || "fixed",
        assignedLocation: input.assignedLocation || "",
        latitude: input.latitude ?? "",
        longitude: input.longitude ?? "",
        coverageRadius: input.coverageRadius ?? "",
        priority: input.priority ?? 0,
      },
      preferLowLatency: true,
      recording: {
        mode: input.recordingEnabled === false ? "off" : "automatic",
        requireSignedURLs: false,
        hideLiveViewerCount: false,
      },
    }),
  });
  return normalizeInput(created, [], true);
}

export async function getCloudflareLiveInput(inputId: string, includeSecret = false): Promise<CloudflareStreamInput> {
  const auth = await credentials();
  if (!auth) throw new Error("Cloudflare Stream is not configured.");
  const [raw, videos] = await Promise.all([
    cloudflareRequest<unknown>(auth, `/live_inputs/${encodeURIComponent(inputId)}`),
    listVideos(auth),
  ]);
  const input = normalizeInput(raw, videos, includeSecret);
  input.viewerCount = await liveViewerCount(input);
  return input;
}

export async function getCloudflareStreamDiagnostics(inputId: string): Promise<CloudflareStreamDiagnostics> {
  const auth = await credentials();
  if (!auth) throw new Error("Cloudflare Stream is not configured.");
  const [raw, videos] = await Promise.all([
    cloudflareRequest<unknown>(auth, `/live_inputs/${encodeURIComponent(inputId)}`),
    listVideos(auth),
  ]);
  const input = normalizeInput(raw, videos);
  input.viewerCount = await liveViewerCount(input);
  const recordings = videos
    .filter((video) => video.liveInputId === input.uid)
    .sort((a, b) => Date.parse(b.created || b.modified) - Date.parse(a.created || a.modified));
  const active = recordings.find((video) => video.status === "live-inprogress");
  const readyRecording = recordings.find((video) => video.readyToStream && Boolean(video.hlsUrl));
  const playbackUrl = active?.hlsUrl
    || readyRecording?.hlsUrl
    || `https://videodelivery.net/${encodeURIComponent(input.uid)}/manifest/video.m3u8`;
  let playbackReady = false;
  if (input.status === "connected" || readyRecording) {
    try {
      const response = await fetch(playbackUrl, {
        method: "GET",
        headers: { accept: "application/vnd.apple.mpegurl,application/x-mpegURL,*/*" },
        cache: "no-store",
      });
      playbackReady = response.ok;
    } catch {
      playbackReady = false;
    }
  }
  const connected = input.enabled && input.status === "connected";
  const recordingReady = Boolean(readyRecording);
  const stages: CloudflareStreamDiagnostics["obs"]["stages"] = [
    { name: "Cloudflare account", status: "Pass", message: "Cloudflare Stream API connection is authenticated." },
    { name: "Live input", status: input.uid ? "Pass" : "Fail", message: input.uid ? "Live Input exists." : "Live Input is missing." },
    { name: "Encoder input", status: !input.enabled ? "Fail" : connected ? "Pass" : "Waiting", message: !input.enabled ? "Live Input is disabled." : connected ? "Cloudflare is receiving the encoder." : "Waiting for GoPro or OBS to connect." },
    { name: "Playback", status: playbackReady ? "Pass" : connected ? "Fail" : "Waiting", message: playbackReady ? "HLS playback manifest is ready." : connected ? "Encoder is connected but playback is not ready." : "Playback starts after the encoder connects." },
    { name: "Recording", status: input.recordingMode === "off" ? "Waiting" : recordingReady ? "Pass" : "Waiting", message: input.recordingMode === "off" ? "Automatic recording is disabled." : recordingReady ? "A recording is ready." : "Recording will be available after streaming begins." },
  ];
  const failingStage = stages.find((stage) => stage.status === "Fail")?.name;
  return {
    input,
    checkedAt: new Date().toISOString(),
    playback: {
      source: active || connected ? "Live Input" : "Recorded Video",
      status: playbackReady ? "Ready" : "Waiting",
      playbackUrl,
      livePlayback: playbackReady && Boolean(active || connected) ? "Ready" : "Pending",
      recording: recordingReady ? "Ready" : "Pending",
      replay: recordingReady ? "Ready" : "Pending",
      recordingVideoUid: readyRecording?.uid,
      associatedToLiveInput: true,
      message: playbackReady ? "Playback is ready." : "Playback not ready yet.",
    },
    health: {
      cloudflareStatus: connected ? "live" : input.enabled ? "offline" : "disabled",
      connection: connected ? "Online" : input.enabled ? "Offline" : "Disabled",
      signalPercent: 0,
      bitrateKbps: 0,
      fps: 0,
      protocol: "RTMPS",
      recording: connected && input.recordingMode === "automatic" ? "On" : "Off",
      viewers: input.viewerCount,
      durationSeconds: active?.duration || 0,
      connectionQuality: connected ? "Live" : input.enabled ? "Offline" : "Disabled",
      lastConnected: connected ? input.modified || undefined : undefined,
      lastDisconnected: !connected && recordings.length ? recordings[0]?.modified || recordings[0]?.created : undefined,
    },
    obs: {
      overall: stages.every((stage) => stage.status === "Pass") ? "Pass" : "Fail",
      failingStage,
      stages,
    },
  };
}

export async function getCloudflareStreamProvisioning(inputId: string): Promise<CloudflareStreamProvisioning> {
  const input = await getCloudflareLiveInput(inputId, true);
  if (!input.rtmpsUrl || !input.streamKey) {
    throw new Error("Cloudflare did not return complete RTMPS provisioning credentials.");
  }
  return {
    version: "1.0.0",
    provider: "cloudflare_stream",
    cameraName: input.name,
    liveInputUid: input.uid,
    rtmpsServer: input.rtmpsUrl,
    encryptedStreamKey: await encryptProvisioningValue(input.streamKey),
    configurationVersion: "broadcast.provisioning.v1",
    timestamp: new Date().toISOString(),
  };
}

export async function updateCloudflareLiveInput(inputId: string, patch: {
  enabled?: boolean;
  recordingEnabled?: boolean;
}): Promise<CloudflareStreamInput> {
  const auth = await credentials();
  if (!auth) throw new Error("Cloudflare Stream is not configured.");
  const body: JsonRecord = {};
  if (typeof patch.enabled === "boolean") body.enabled = patch.enabled;
  if (typeof patch.recordingEnabled === "boolean") {
    body.recording = {
      mode: patch.recordingEnabled ? "automatic" : "off",
      requireSignedURLs: false,
      hideLiveViewerCount: false,
      timeoutSeconds: 0,
    };
  }
  const updated = await cloudflareRequest<unknown>(auth, `/live_inputs/${encodeURIComponent(inputId)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return normalizeInput(updated, []);
}

export async function deleteCloudflareLiveInput(inputId: string): Promise<void> {
  const auth = await credentials();
  if (!auth) throw new Error("Cloudflare Stream is not configured.");
  await cloudflareRequest<void>(auth, `/live_inputs/${encodeURIComponent(inputId)}`, { method: "DELETE" });
}

export async function deleteCloudflareVideos(videoIds: string[]): Promise<number> {
  const auth = await credentials();
  if (!auth) throw new Error("Cloudflare Stream is not configured.");
  const ids = [...new Set(videoIds.map((id) => id.trim()).filter(Boolean))].slice(0, 100);
  await Promise.all(ids.map((id) => cloudflareRequest<void>(auth, `/${encodeURIComponent(id)}`, { method: "DELETE" })));
  return ids.length;
}
