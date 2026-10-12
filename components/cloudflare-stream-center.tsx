"use client";

import { LiveBroadcastPlayer } from "@/components/live-broadcast-player";
import type {
  CloudflareStreamDashboard,
  CloudflareStreamDiagnostics,
  CloudflareStreamInput,
  CloudflareStreamProvisioning,
  CloudflareStreamVideo,
} from "@/lib/cloudflare-stream";
import type { LiveBroadcastChannel } from "@/packages/contracts/src";
import {
  Activity, Check, Copy, Eye, Grid2X2, Grid3X3, KeyRound, MapPin, Monitor, Plus,
  ExternalLink, QrCode, Radio, RefreshCw, RotateCw, Search, Settings2, Star,
  Trash2, Video, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

interface BroadcastEventOption {
  id: string;
  slug: string;
  name: string;
  date: string;
}

const CAMERA_TYPES = [
  "finish", "swim", "swim_exit", "transition", "bike", "bike_turnaround",
  "run", "aid_station", "awards", "interview", "expo", "mobile", "drone",
  "motorcycle", "lead_vehicle", "custom",
] as const;

const COURSE_LOCATIONS = [
  "Start Line",
  "Finish Arch",
  "Swim Start",
  "Swim Exit",
  "Transition Area",
  "Bike Turnaround",
  "Run Turnaround",
  "Aid Station",
  "Awards Stage",
  "Expo Area",
  "Mobile / Roving",
] as const;

interface CameraDraft {
  name: string;
  cameraType: string;
  locationMode: "fixed" | "mobile";
  assignedLocation: string;
  latitude: string;
  longitude: string;
  coverageRadius: string;
  priority: string;
  recordingEnabled: boolean;
}

const EMPTY_CAMERA: CameraDraft = {
  name: "",
  cameraType: "custom",
  locationMode: "fixed",
  assignedLocation: "",
  latitude: "",
  longitude: "",
  coverageRadius: "",
  priority: "0",
  recordingEnabled: true,
};

async function streamAction<T>(body: unknown): Promise<T> {
  const response = await fetch("/api/admin/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json() as { ok?: boolean; data?: T; error?: string };
  if (!response.ok || !result.ok || result.data === undefined) throw new Error(result.error || "Cloudflare Stream action failed.");
  return result.data;
}

function cameraChannel(input: CloudflareStreamInput): LiveBroadcastChannel | null {
  return input.playbackUrl ? {
    channelId: `cloudflare-${input.uid}`,
    name: input.name,
    type: "HLS" as const,
    playbackUrl: input.playbackUrl,
    enabled: true,
    displayOrder: 0,
    description: `Cloudflare Stream Live Input ${input.uid}`,
  } : null;
}

function displayDate(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "—" : date.toLocaleString();
}

function goProUrl(server: string, key: string): string {
  return `${server.replace(/\/+$/, "")}/${key}`;
}

export function CloudflareStreamCenter({
  events,
  event,
  onSelectEvent,
  onPublishPlayback,
  onUpdatePublished,
  publishedChannels,
  onDeletePublished,
}: {
  events: BroadcastEventOption[];
  event: BroadcastEventOption;
  onSelectEvent: (eventId: string) => void;
  onPublishPlayback: (channel: LiveBroadcastChannel) => void;
  onUpdatePublished: (channel: LiveBroadcastChannel) => void;
  publishedChannels: LiveBroadcastChannel[];
  onDeletePublished: (channelIds: string[]) => void;
}) {
  const [dashboard, setDashboard] = useState<CloudflareStreamDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [newCameraOpen, setNewCameraOpen] = useState(false);
  const [advancedCameraOpen, setAdvancedCameraOpen] = useState(false);
  const [cameraDraft, setCameraDraft] = useState<CameraDraft>(EMPTY_CAMERA);
  const [layout, setLayout] = useState<1 | 2 | 4 | 9 | 0>(0);
  const [activeInputId, setActiveInputId] = useState("");
  const [revealedKey, setRevealedKey] = useState<{ inputId: string; key: string; expiresAt: number } | null>(null);
  const [healthMessage, setHealthMessage] = useState("");
  const [cameraDetails, setCameraDetails] = useState<CloudflareStreamDiagnostics | null>(null);
  const [cameraDetailsOpen, setCameraDetailsOpen] = useState(false);
  const [cameraDetailsLoading, setCameraDetailsLoading] = useState(false);
  const [provisioning, setProvisioning] = useState<CloudflareStreamProvisioning | null>(null);
  const [provisioningError, setProvisioningError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<CloudflareStreamVideo | null>(null);
  const [copied, setCopied] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [videoTitle, setVideoTitle] = useState("");
  const [videoDescription, setVideoDescription] = useState("");
  const [videoCategory, setVideoCategory] = useState("highlight");
  const [videoFeatured, setVideoFeatured] = useState(false);
  const [editingVideoId, setEditingVideoId] = useState("");
  const [publishedSearch, setPublishedSearch] = useState("");
  const [publishedCategory, setPublishedCategory] = useState("all");
  const [publishedSelected, setPublishedSelected] = useState<string[]>([]);

  const load = useCallback(async (background = false) => {
    if (!background) setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/stream?eventId=${encodeURIComponent(event.id)}`, { cache: "no-store" });
      const result = await response.json() as { ok?: boolean; data?: CloudflareStreamDashboard; error?: string };
      if (!response.ok || !result.ok || !result.data) throw new Error(result.error || "Unable to load Cloudflare Stream.");
      setDashboard(result.data);
      setLayout(result.data.layout === "single" ? 1 : result.data.layout === "2" ? 2 : result.data.layout === "4" ? 4 : result.data.layout === "9" ? 9 : 0);
      setSelectedIds([]);
      setSelectedVideo(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load Cloudflare Stream.");
    } finally {
      if (!background) setLoading(false);
    }
  }, [event.id]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!document.hidden) void load(true);
    }, dashboard?.totals.liveCameras ? 10000 : 5000);
    return () => window.clearInterval(interval);
  }, [dashboard?.totals.liveCameras, load]);

  useEffect(() => {
    if (!revealedKey) return;
    const timeout = window.setTimeout(() => setRevealedKey(null), Math.max(0, revealedKey.expiresAt - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [revealedKey]);

  const videos = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (dashboard?.videos ?? []).filter((video) => !query
      || `${video.name} ${video.uid} ${video.description}`.toLowerCase().includes(query));
  }, [dashboard?.videos, search]);
  const previewInputs = (dashboard?.inputs ?? []).filter((input) => input.playbackUrl);
  const previewLimit = layout || Math.min(9, Math.max(1, previewInputs.length));
  const categories = [...new Set(publishedChannels.map((channel) => channel.category || "other"))];
  const filteredPublished = publishedChannels.filter((channel) => {
    const matchesSearch = !publishedSearch.trim()
      || `${channel.name} ${channel.description || ""} ${channel.playbackUrl}`.toLowerCase().includes(publishedSearch.trim().toLowerCase());
    return matchesSearch && (publishedCategory === "all" || (channel.category || "other") === publishedCategory);
  });

  async function addCamera() {
    if (!cameraDraft.name.trim()) return;
    setWorking(true);
    setError("");
    try {
      const input = await streamAction<CloudflareStreamInput>({
        action: "create-input",
        eventId: event.id,
        eventName: event.name,
        name: cameraDraft.name,
        cameraType: cameraDraft.cameraType,
        locationMode: cameraDraft.locationMode,
        assignedLocation: cameraDraft.assignedLocation,
        latitude: cameraDraft.latitude ? Number(cameraDraft.latitude) : undefined,
        longitude: cameraDraft.longitude ? Number(cameraDraft.longitude) : undefined,
        coverageRadius: cameraDraft.coverageRadius ? Number(cameraDraft.coverageRadius) : undefined,
        priority: Number(cameraDraft.priority || 0),
        recordingEnabled: cameraDraft.recordingEnabled,
      });
      setMessage(`${input.name} created. Copy the RTMPS credentials into the camera or encoder.`);
      setCameraDraft(EMPTY_CAMERA);
      setAdvancedCameraOpen(false);
      setNewCameraOpen(false);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to add camera.");
    } finally {
      setWorking(false);
    }
  }

  async function testInput(input: CloudflareStreamInput) {
    setWorking(true);
    setHealthMessage("");
    try {
      const result = await streamAction<{ connectionState: string; message: string; diagnostics: CloudflareStreamDiagnostics }>({ action: "test-input", inputId: input.uid });
      setActiveInputId(input.uid);
      setHealthMessage(`${result.connectionState}: ${result.message}`);
      setCameraDetails(result.diagnostics);
      await load(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Connection test failed.");
    } finally {
      setWorking(false);
    }
  }

  const refreshCameraDetails = useCallback(async (inputId: string, background = false) => {
    if (!background) setCameraDetailsLoading(true);
    try {
      const details = await streamAction<CloudflareStreamDiagnostics>({ action: "camera-details", inputId });
      setCameraDetails(details);
      setActiveInputId(inputId);
    } catch (reason) {
      if (!background) setError(reason instanceof Error ? reason.message : "Unable to load camera details.");
    } finally {
      if (!background) setCameraDetailsLoading(false);
    }
  }, []);

  // Poll only while the admin is inspecting a camera.
  useEffect(() => {
    if (!cameraDetailsOpen || !activeInputId) return;
    const interval = window.setInterval(() => {
      if (!document.hidden) void refreshCameraDetails(activeInputId, true);
    }, 10000);
    return () => window.clearInterval(interval);
  }, [activeInputId, cameraDetailsOpen, refreshCameraDetails]);

  async function openCameraDetails(input: CloudflareStreamInput) {
    setActiveInputId(input.uid);
    setCameraDetailsOpen(true);
    setCameraDetails(null);
    setProvisioning(null);
    setProvisioningError("");
    await refreshCameraDetails(input.uid);
  }

  async function refreshProvisioning(inputId: string) {
    setWorking(true);
    setProvisioningError("");
    try {
      setProvisioning(await streamAction<CloudflareStreamProvisioning>({ action: "refresh-provisioning", inputId }));
    } catch (reason) {
      setProvisioningError(reason instanceof Error ? reason.message : "Unable to generate encrypted provisioning.");
    } finally {
      setWorking(false);
    }
  }

  async function validatePlayback(inputId: string) {
    setWorking(true);
    try {
      const details = await streamAction<CloudflareStreamDiagnostics>({ action: "validate-playback", inputId });
      setCameraDetails(details);
      setHealthMessage(details.playback.message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Playback validation failed.");
    } finally {
      setWorking(false);
    }
  }

  async function revealKey(input: CloudflareStreamInput) {
    if (!window.confirm("Reveal this sensitive stream key for 30 seconds?")) return;
    setWorking(true);
    try {
      const result = await streamAction<{ streamKey?: string; expiresInSeconds?: number }>({ action: "reveal-key", inputId: input.uid });
      if (!result.streamKey) throw new Error("Cloudflare did not return a stream key.");
      setActiveInputId(input.uid);
      setRevealedKey({
        inputId: input.uid,
        key: result.streamKey,
        expiresAt: Date.now() + (result.expiresInSeconds || 30) * 1000,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to reveal stream key.");
    } finally {
      setWorking(false);
    }
  }

  async function rotateKey(input: CloudflareStreamInput) {
    if (!window.confirm(`Rotate the stream key for “${input.name}”? The current encoder will disconnect and must be reprovisioned.`)) return;
    setWorking(true);
    try {
      const replacement = await streamAction<CloudflareStreamInput>({
        action: "rotate-key",
        inputId: input.uid,
        eventId: event.id,
        eventName: event.name,
        name: input.name,
        cameraType: input.cameraType,
        locationMode: input.locationMode,
        assignedLocation: input.assignedLocation,
        latitude: input.latitude,
        longitude: input.longitude,
        coverageRadius: input.coverageRadius,
        priority: input.priority,
        recordingEnabled: input.recordingMode === "automatic",
      });
      setMessage(`${input.name} stream key rotated. Reprovision the encoder with the new credentials.`);
      setActiveInputId(replacement.uid);
      if (replacement.streamKey) {
        setRevealedKey({ inputId: replacement.uid, key: replacement.streamKey, expiresAt: Date.now() + 30000 });
      }
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to rotate stream key.");
    } finally {
      setWorking(false);
    }
  }

  async function toggleInput(input: CloudflareStreamInput) {
    setWorking(true);
    try {
      await streamAction({ action: "update-input", inputId: input.uid, enabled: !input.enabled });
      setMessage(`${input.name} ${input.enabled ? "disabled" : "enabled"}.`);
      await load(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update camera.");
    } finally {
      setWorking(false);
    }
  }

  async function saveLayout(next: 1 | 2 | 4 | 9 | 0) {
    setLayout(next);
    const value = next === 1 ? "single" : next === 0 ? "auto" : String(next);
    try {
      await streamAction({ action: "save-layout", eventId: event.id, layout: value });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save multiview layout.");
    }
  }

  async function deleteInput(input: CloudflareStreamInput) {
    if (!window.confirm(`Delete Cloudflare Live Input “${input.name}”? Existing recordings are not deleted.`)) return;
    setWorking(true);
    try {
      await streamAction({ action: "delete-input", inputId: input.uid });
      setMessage(`${input.name} deleted.`);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to delete camera.");
    } finally {
      setWorking(false);
    }
  }

  async function deleteVideos() {
    if (!selectedIds.length || !window.confirm(`Delete ${selectedIds.length} selected Cloudflare video${selectedIds.length === 1 ? "" : "s"}? This cannot be undone.`)) return;
    setWorking(true);
    try {
      await streamAction({ action: "delete-videos", videoIds: selectedIds });
      setMessage(`${selectedIds.length} Cloudflare video${selectedIds.length === 1 ? "" : "s"} deleted.`);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to delete videos.");
    } finally {
      setWorking(false);
    }
  }

  async function copy(value: string, key: string) {
    await navigator.clipboard.writeText(value);
    setCopied(key);
    window.setTimeout(() => setCopied(""), 1500);
  }

  function addPublishedVideo() {
    const url = videoUrl.trim();
    const title = videoTitle.trim();
    if (!url || !title) return;
    let type: LiveBroadcastChannel["type"] = "EXTERNAL";
    if (/youtu(?:\.be|be\.com)/i.test(url)) type = "YOUTUBE";
    else if (/\.m3u8(?:$|[?#])/i.test(url)) type = "HLS";
    else if (/\.(?:mp4|webm|mov)(?:$|[?#])/i.test(url)) type = "VIDEO";
    const existing = publishedChannels.find((channel) => channel.channelId === editingVideoId);
    const next: LiveBroadcastChannel = {
      channelId: existing?.channelId || `library-${crypto.randomUUID()}`,
      name: title,
      type,
      playbackUrl: url,
      enabled: existing?.enabled ?? true,
      displayOrder: existing?.displayOrder ?? publishedChannels.length,
      description: videoDescription.trim() || undefined,
      category: videoCategory,
      featured: videoFeatured,
      posterUrl: existing?.posterUrl,
    };
    if (existing) onUpdatePublished(next);
    else onPublishPlayback(next);
    setVideoUrl("");
    setVideoTitle("");
    setVideoDescription("");
    setVideoFeatured(false);
    setEditingVideoId("");
  }

  function editPublishedVideo(channel: LiveBroadcastChannel) {
    setEditingVideoId(channel.channelId);
    setVideoUrl(channel.playbackUrl);
    setVideoTitle(channel.name);
    setVideoDescription(channel.description || "");
    setVideoCategory(channel.category || "other");
    setVideoFeatured(Boolean(channel.featured));
    document.querySelector(".published-video-form")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const totals = dashboard?.totals;
  return (
    <div className="stream-center">
      <section className="admin-card stream-command-bar">
        <div className="stream-command-copy">
          <h1>Broadcast</h1>
          <p>Manage event cameras, live previews and recordings.</p>
        </div>
        <div className="stream-command-actions">
          <select value={event.id} onChange={(changeEvent) => onSelectEvent(changeEvent.target.value)}>
            {events.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <button className="button" type="button" disabled={loading} onClick={() => void load()}><RefreshCw /> Refresh</button>
          <button
            className="button button-primary"
            type="button"
            disabled={working || !dashboard?.configured}
            title={!dashboard?.configured ? dashboard?.message || "Checking Cloudflare Stream connection…" : "Create a Cloudflare Stream Live Input"}
            onClick={() => setNewCameraOpen(true)}
          ><Plus /> Add Camera</button>
          <a className="button" target="_blank" rel="noreferrer" href={`/events/${encodeURIComponent(event.slug)}/broadcast`}>Open Public Live</a>
        </div>
      </section>

      {message && <div className="success-banner">{message}</div>}
      {error && <div className="error-banner">{error}</div>}
      {dashboard && !dashboard.configured && <div className="stream-setup-note"><Radio /><span><b>Cloudflare Stream connection required</b><small>{dashboard.message}</small></span></div>}

      {newCameraOpen && (
        <div className="stream-add-camera-backdrop" role="presentation" onMouseDown={() => setNewCameraOpen(false)}>
          <section className="stream-add-camera-dialog" role="dialog" aria-modal="true" aria-label="Add Camera" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div><h2>Add Camera</h2><p>Create a Cloudflare Live Input and attach it to a predefined course location or mobile camera.</p></div>
              <button type="button" aria-label="Close add camera" onClick={() => setNewCameraOpen(false)}><X /></button>
            </header>
            <div className="stream-add-camera-fields">
              <div className="field"><label>Camera Name</label><input autoFocus value={cameraDraft.name} onChange={(input) => setCameraDraft((current) => ({ ...current, name: input.target.value }))} placeholder="Finish Camera" /></div>
              <div className="field"><label>Camera Type</label><select value={cameraDraft.cameraType} onChange={(input) => setCameraDraft((current) => ({ ...current, cameraType: input.target.value }))}>{CAMERA_TYPES.map((type) => <option value={type} key={type}>{type.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())}</option>)}</select></div>
              <div className="field full"><label>Assign To Course Location</label><select value={cameraDraft.assignedLocation} onChange={(input) => setCameraDraft((current) => ({ ...current, assignedLocation: input.target.value, locationMode: input.target.value === "Mobile / Roving" ? "mobile" : "fixed" }))}><option value="">Select a course location</option>{COURSE_LOCATIONS.map((location) => <option value={location} key={location}>{location}</option>)}</select></div>
              <label className="stream-recording-toggle full"><input type="checkbox" checked={cameraDraft.recordingEnabled} onChange={(input) => setCameraDraft((current) => ({ ...current, recordingEnabled: input.target.checked }))} /><span><b>Recording Enabled</b><small>Store stream recordings automatically.</small></span></label>
              <button className="stream-advanced-camera-toggle" type="button" aria-expanded={advancedCameraOpen} onClick={() => setAdvancedCameraOpen((current) => !current)}><Settings2 /> Advanced Settings <span>{advancedCameraOpen ? "−" : "+"}</span></button>
              {advancedCameraOpen && (
                <div className="stream-advanced-camera-fields">
                  <div className="field"><label>Location Mode</label><select value={cameraDraft.locationMode} onChange={(input) => setCameraDraft((current) => ({ ...current, locationMode: input.target.value as "fixed" | "mobile" }))}><option value="fixed">Fixed</option><option value="mobile">Mobile</option></select></div>
                  <div className="field"><label>Latitude</label><input type="number" step="any" value={cameraDraft.latitude} onChange={(input) => setCameraDraft((current) => ({ ...current, latitude: input.target.value }))} placeholder="16.7050" /></div>
                  <div className="field"><label>Longitude</label><input type="number" step="any" value={cameraDraft.longitude} onChange={(input) => setCameraDraft((current) => ({ ...current, longitude: input.target.value }))} placeholder="74.2433" /></div>
                  <div className="field"><label>Coverage Radius (m)</label><input type="number" min="0" value={cameraDraft.coverageRadius} onChange={(input) => setCameraDraft((current) => ({ ...current, coverageRadius: input.target.value }))} placeholder="100" /></div>
                  <div className="field"><label>Priority</label><input type="number" min="0" value={cameraDraft.priority} onChange={(input) => setCameraDraft((current) => ({ ...current, priority: input.target.value }))} /></div>
                </div>
              )}
            </div>
            <footer>
              <button className="button" type="button" onClick={() => setNewCameraOpen(false)}>Cancel</button>
              <button className="button button-primary" type="button" disabled={working || !cameraDraft.name.trim()} onClick={() => void addCamera()}><Plus /> {working ? "Creating…" : "Create Camera"}</button>
            </footer>
          </section>
        </div>
      )}

      {cameraDetailsOpen && (
        <div className="stream-camera-dialog-backdrop" role="presentation" onMouseDown={() => setCameraDetailsOpen(false)}>
          <section className="stream-camera-dialog" role="dialog" aria-modal="true" aria-label="Camera details" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <span>Camera details</span>
                <h2>{cameraDetails?.input.name || "Loading camera…"}</h2>
                <p>Camera details, provisioning and Cloudflare runtime status.</p>
              </div>
              <button type="button" aria-label="Close camera details" onClick={() => setCameraDetailsOpen(false)}><X /></button>
            </header>

            {cameraDetailsLoading && !cameraDetails
              ? <div className="stream-camera-dialog-loading"><RefreshCw /> Loading Cloudflare camera status…</div>
              : cameraDetails && (
                <div className="stream-camera-dialog-body">
                  <section className="stream-camera-detail-section">
                    <div className="stream-camera-detail-heading"><div><h3>Camera Information</h3><p>Live Input identity and current operational state.</p></div><span className={cameraDetails.health.connection === "Online" ? "online" : ""}>{cameraDetails.health.connection}</span></div>
                    <dl className="stream-camera-facts">
                      <div><dt>Camera ID</dt><dd>{cameraDetails.input.uid}</dd></div>
                      <div><dt>Type</dt><dd>{cameraDetails.input.cameraType.replaceAll("_", " ")}</dd></div>
                      <div><dt>Status</dt><dd>{cameraDetails.health.connection}</dd></div>
                      <div><dt>Viewers</dt><dd>{cameraDetails.health.viewers}</dd></div>
                      <div><dt>Latency</dt><dd>—</dd></div>
                      <div><dt>Signal</dt><dd>{cameraDetails.health.connection === "Online" ? "Unavailable" : `${cameraDetails.health.signalPercent}%`}</dd></div>
                      <div><dt>Recording</dt><dd>{cameraDetails.input.recordingMode === "automatic" ? "Enabled" : "Disabled"}</dd></div>
                      <div><dt>Location</dt><dd>{cameraDetails.input.assignedLocation || "—"}</dd></div>
                      <div><dt>Provider</dt><dd>Cloudflare</dd></div>
                      <div><dt>Recording Mode</dt><dd>{cameraDetails.health.recording}</dd></div>
                      <div><dt>Last Connected</dt><dd>{displayDate(cameraDetails.health.lastConnected)}</dd></div>
                      <div><dt>Last Disconnected</dt><dd>{displayDate(cameraDetails.health.lastDisconnected)}</dd></div>
                      <div><dt>Last Health Check</dt><dd>{displayDate(cameraDetails.checkedAt)}</dd></div>
                    </dl>
                  </section>

                  <section className="stream-camera-detail-section">
                    <div className="stream-camera-detail-heading"><div><h3>Cloudflare Stream Provisioning</h3><p>RTMPS credentials for GoPro Quik, OBS and compatible encoders.</p></div><KeyRound /></div>
                    <dl className="stream-camera-facts stream-camera-facts-wide">
                      <div><dt>Live Input UID</dt><dd>{cameraDetails.input.uid}</dd></div>
                      <div><dt>Playback Source</dt><dd>{cameraDetails.playback.source}</dd></div>
                      <div><dt>Recording Video UID</dt><dd>{cameraDetails.playback.recordingVideoUid || "Pending"}</dd></div>
                      <div><dt>Live Playback</dt><dd>{cameraDetails.playback.livePlayback}</dd></div>
                      <div><dt>Recording</dt><dd>{cameraDetails.playback.recording}</dd></div>
                      <div><dt>Replay</dt><dd>{cameraDetails.playback.replay}</dd></div>
                    </dl>
                    <div className="stream-camera-credentials">
                      <label><span>RTMPS Server</span><code>{cameraDetails.input.rtmpsUrl || "Pending"}</code><button type="button" disabled={!cameraDetails.input.rtmpsUrl} onClick={() => void copy(cameraDetails.input.rtmpsUrl || "", "details-server")}>{copied === "details-server" ? <Check /> : <Copy />} Copy Server</button></label>
                      <label><span>Stream Key</span><code className={revealedKey?.inputId === cameraDetails.input.uid ? "stream-secret-revealed" : undefined}>{revealedKey?.inputId === cameraDetails.input.uid ? revealedKey.key : "Hidden until you click “Reveal Stream Key”"}</code><button type="button" disabled={revealedKey?.inputId !== cameraDetails.input.uid} onClick={() => void copy(revealedKey?.key || "", "details-key")}>{copied === "details-key" ? <Check /> : <Copy />} {copied === "details-key" ? "Full Key Copied" : "Copy Full Key"}</button></label>
                      <button className="button" type="button" disabled={!cameraDetails.input.rtmpsUrl || revealedKey?.inputId !== cameraDetails.input.uid} onClick={() => void copy(goProUrl(cameraDetails.input.rtmpsUrl || "", revealedKey?.key || ""), "details-gopro")}>{copied === "details-gopro" ? <Check /> : <Copy />} Copy GoPro URL</button>
                      <p>GoPro Quik may show only one field: <b>ENTER YOUR RTMP URL</b>. Use “Copy GoPro URL” for the server and key combined.</p>
                    </div>
                    <div className="stream-rtmp-debug">
                      <h4>RTMP Compatibility Investigation</h4>
                      {revealedKey?.inputId === cameraDetails.input.uid ? (
                        <>
                          <p>GoPro model: {cameraDetails.input.cameraType} · Protocol: rtmps · Port: 443</p>
                          <code>Server: {cameraDetails.input.rtmpsUrl || "—"}</code>
                          <code className="stream-secret-revealed">Combined URL: {goProUrl(cameraDetails.input.rtmpsUrl || "", revealedKey.key)}</code>
                          <small>Lengths: server {(cameraDetails.input.rtmpsUrl || "").length}, key {revealedKey.key.length}, combined {goProUrl(cameraDetails.input.rtmpsUrl || "", revealedKey.key).length}</small>
                        </>
                      ) : <p>Reveal the stream key first to run compatibility validation.</p>}
                    </div>
                  </section>

                  <section className="stream-camera-detail-section">
                    <div className="stream-camera-detail-heading"><div><h3>Stream Health</h3><p>Live Cloudflare diagnostics and connection status.</p></div><Activity /></div>
                    <dl className="stream-camera-facts">
                      <div><dt>Cloudflare Status</dt><dd>{cameraDetails.health.cloudflareStatus}</dd></div>
                      <div><dt>Connection</dt><dd>{cameraDetails.health.connection}</dd></div>
                      <div><dt>Signal</dt><dd>{cameraDetails.health.connection === "Online" ? "Unavailable" : `${cameraDetails.health.signalPercent}%`}</dd></div>
                      <div><dt>Current Bitrate</dt><dd>{cameraDetails.health.bitrateKbps ? `${cameraDetails.health.bitrateKbps} kbps` : "Unavailable"}</dd></div>
                      <div><dt>FPS</dt><dd>{cameraDetails.health.fps || "Unavailable"}</dd></div>
                      <div><dt>Protocol</dt><dd>{cameraDetails.health.protocol}</dd></div>
                      <div><dt>Recording</dt><dd>{cameraDetails.health.recording}</dd></div>
                      <div><dt>Viewers</dt><dd>{cameraDetails.health.viewers}</dd></div>
                      <div><dt>Duration</dt><dd>{cameraDetails.health.durationSeconds} s</dd></div>
                      <div><dt>Connection Quality</dt><dd>{cameraDetails.health.connectionQuality}</dd></div>
                    </dl>
                  </section>

                  <section className="stream-camera-detail-section">
                    <div className="stream-camera-detail-heading"><div><h3>Playback Validation</h3><p>Verifies live playback, recording and replay readiness.</p></div><span className={cameraDetails.playback.status === "Ready" ? "online" : ""}>{cameraDetails.playback.status}</span></div>
                    <div className="stream-playback-url"><span>Live Playback URL</span><code>{cameraDetails.playback.playbackUrl}</code><button type="button" onClick={() => void copy(cameraDetails.playback.playbackUrl, "details-playback")}>{copied === "details-playback" ? <Check /> : <Copy />}</button></div>
                    <dl className="stream-camera-facts">
                      <div><dt>Playback Source</dt><dd>{cameraDetails.playback.source}</dd></div>
                      <div><dt>Live Playback</dt><dd>{cameraDetails.playback.livePlayback}</dd></div>
                      <div><dt>Recording</dt><dd>{cameraDetails.playback.recording}</dd></div>
                      <div><dt>Replay</dt><dd>{cameraDetails.playback.replay}</dd></div>
                      <div><dt>Associated to Live Input</dt><dd>{cameraDetails.playback.associatedToLiveInput ? "Yes" : "No"}</dd></div>
                    </dl>
                    <p className="stream-camera-note">{cameraDetails.playback.message}</p>
                  </section>

                  <section className="stream-camera-detail-section">
                    <div className="stream-camera-detail-heading"><div><h3>OBS Test</h3><p>Exact stage-based readiness check for encoder and playback.</p></div><span className={cameraDetails.obs.overall === "Pass" ? "online" : ""}>{cameraDetails.obs.overall}</span></div>
                    <div className="stream-obs-stages">
                      {cameraDetails.obs.stages.map((stage) => <div key={stage.name}><span className={stage.status.toLowerCase()}>{stage.status}</span><strong>{stage.name}</strong><small>{stage.message}</small></div>)}
                    </div>
                    {cameraDetails.obs.failingStage && <p className="stream-camera-note">Failing stage: {cameraDetails.obs.failingStage}</p>}
                  </section>

                  <section className="stream-camera-detail-section">
                    <div className="stream-camera-detail-heading"><div><h3>QR Code Provisioning</h3><p>Versioned provisioning object with an encrypted key and no plaintext secret.</p></div><QrCode /></div>
                    {provisioning
                      ? <><span className="stream-camera-qr-label">Camera QR</span><pre className="stream-camera-qr">{JSON.stringify(provisioning)}</pre><button className="button" type="button" onClick={() => void copy(JSON.stringify(provisioning), "details-provisioning")}>{copied === "details-provisioning" ? <Check /> : <Copy />} Copy encrypted payload</button></>
                      : <div className="stream-camera-provisioning-empty">{provisioningError || "Generate the encrypted provisioning payload when the camera is ready to be configured."}</div>}
                    <div className="stream-gopro-guide">
                      <h4>Provisioning Guide (GoPro MAX)</h4>
                      <ol>
                        <li>Connect the GoPro MAX to Wi-Fi or a mobile hotspot.</li>
                        <li>Open GoPro Quik and select RTMP Streaming.</li>
                        <li>For one RTMP URL field, reveal the key and use “Copy GoPro URL”.</li>
                        <li>For separate fields, use the server and revealed Stream Key.</li>
                        <li>Select 1080p, tap Go Live, then validate playback here.</li>
                      </ol>
                    </div>
                  </section>

                  <section className="stream-camera-detail-section stream-camera-obs-setup">
                    <div><h3>OBS Test Mode</h3><p>Recommended: 1080p · 30 FPS · 4–6 Mbps</p></div>
                    <code>{cameraDetails.input.rtmpsUrl || "RTMPS server pending"}</code>
                    <code className={revealedKey?.inputId === cameraDetails.input.uid ? "stream-secret-revealed" : undefined}>{revealedKey?.inputId === cameraDetails.input.uid ? revealedKey.key : "Reveal stream key to test in OBS"}</code>
                  </section>

                  <footer className="stream-camera-dialog-actions">
                    <button className="button" type="button" disabled={working} onClick={() => void testInput(cameraDetails.input)}><Activity /> Test Connection</button>
                    <button className="button" type="button" disabled={working} onClick={() => void validatePlayback(cameraDetails.input.uid)}><Eye /> Validate Playback</button>
                    <button className="button" type="button" disabled={working} onClick={() => void refreshProvisioning(cameraDetails.input.uid)}><RefreshCw /> Refresh Provisioning</button>
                    <button className="button button-primary" type="button" disabled={working} onClick={() => void revealKey(cameraDetails.input)}><KeyRound /> Reveal Stream Key</button>
                    <button className="button" type="button" disabled={working} onClick={() => void rotateKey(cameraDetails.input)}><RotateCw /> Rotate Key</button>
                    <button className="button" type="button" disabled={working} onClick={() => void toggleInput(cameraDetails.input)}>{cameraDetails.input.enabled ? "Disable Camera" : "Enable Camera"}</button>
                    {cameraChannel(cameraDetails.input) && <button className="button button-primary" type="button" onClick={() => onPublishPlayback(cameraChannel(cameraDetails.input)!)}><Eye /> Publish</button>}
                    <button className="button button-danger" type="button" disabled={working} onClick={() => void deleteInput(cameraDetails.input)}><Trash2 /> Delete Input</button>
                  </footer>
                </div>
              )}
          </section>
        </div>
      )}

      <div className="stream-kpis">
        <div><span>Event</span><strong>{event.name}</strong></div>
        <div><span>Live Cameras</span><strong>{totals?.liveCameras ?? 0}</strong></div>
        <div><span>Non-Live States</span><strong>{totals?.nonLiveStates ?? 0}</strong></div>
        <div><span>Current Viewers</span><strong>{totals?.currentViewers ?? "—"}</strong></div>
        <div><span>Avg Latency</span><strong>{totals?.averageLatencyMs === null || totals?.averageLatencyMs === undefined ? "—" : `${totals.averageLatencyMs} ms`}</strong></div>
        <div><span>Event Status</span><strong>{totals?.eventStatus ?? (loading ? "Loading" : "Standby")}</strong></div>
      </div>

      <section className="admin-card stream-multiview">
        <div className="stream-section-heading"><div><h2>Multi View</h2><p>Switch between preview layouts for production operations.</p></div></div>
        <div className="stream-layout-buttons">
          {([
            [1, "Single View", Monitor],
            [2, "2 Cameras", Monitor],
            [4, "4 Cameras", Grid2X2],
            [9, "9 Cameras", Grid3X3],
            [0, "Auto", Monitor],
          ] as const).map(([value, label, Icon]) => <button type="button" key={label} className={layout === value ? "active" : ""} onClick={() => void saveLayout(value)}><Icon /> {label}</button>)}
        </div>
        {previewInputs.length ? (
          <div className={`stream-preview-grid stream-preview-${previewLimit}`}>
            {previewInputs.slice(0, previewLimit).map((input) => (
              <div className="stream-camera-preview" key={input.uid}>
                <LiveBroadcastPlayer channel={cameraChannel(input)} />
                <div><span><i /> LIVE</span><strong>{input.name}</strong><button type="button" onClick={() => onPublishPlayback(cameraChannel(input)!)}>Publish</button></div>
              </div>
            ))}
          </div>
        ) : <div className="stream-empty-preview"><Monitor /><strong>No live camera feeds</strong><span>Created inputs appear here when an encoder connects.</span></div>}

        {!!dashboard?.inputs.length && (
          <div className="stream-input-list">
            {dashboard.inputs.map((input) => (
              <article key={input.uid} className={activeInputId === input.uid ? "active" : ""}>
                <div className="stream-input-title"><span className={input.status === "connected" ? "live" : ""}><Radio /> {input.status}</span><strong>{input.name}</strong><small>{input.uid}</small></div>
                <div className="stream-input-meta">
                  <span>{input.cameraType.replaceAll("_", " ")}</span>
                  <span>{input.recordingMode === "automatic" ? "Recording on" : "Recording off"}</span>
                  <span>{input.viewerCount} viewer{input.viewerCount === 1 ? "" : "s"}</span>
                  {input.assignedLocation && <span><MapPin /> {input.assignedLocation}</span>}
                </div>
                <div className="stream-credentials">
                  <span><small>RTMPS URL</small><code>{input.rtmpsUrl || "Refresh to retrieve credentials"}</code>{input.rtmpsUrl && <button type="button" onClick={() => void copy(input.rtmpsUrl!, `${input.uid}-url`)}>{copied === `${input.uid}-url` ? <Check /> : <Copy />}</button>}</span>
                  <span><small>Stream key</small><code className={revealedKey?.inputId === input.uid ? "stream-secret-revealed" : undefined}>{revealedKey?.inputId === input.uid ? revealedKey.key : "••••••••••••••••••••"}</code>{revealedKey?.inputId === input.uid && <button type="button" title="Copy full Stream Key" aria-label={`Copy full Stream Key for ${input.name}`} onClick={() => void copy(revealedKey.key, `${input.uid}-key`)}>{copied === `${input.uid}-key` ? <Check /> : <Copy />}</button>}</span>
                </div>
                {activeInputId === input.uid && healthMessage && <div className="stream-health-message">{healthMessage}</div>}
                <div className="stream-input-actions">
                  <button className="button button-primary" type="button" disabled={working} onClick={() => void openCameraDetails(input)}><Settings2 /> Camera details</button>
                  {cameraChannel(input) && <button className="button button-primary" type="button" onClick={() => onPublishPlayback(cameraChannel(input)!)}><Eye /> Publish</button>}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="admin-card stream-library-section">
        <div className="stream-section-heading"><div><h2>Video Library</h2><p>Cloudflare Stream recordings and library management are available here.</p></div></div>
        <div className="stream-library-layout">
          <div>
            <div className="stream-library-toolbar-card">
              <div className="stream-library-title"><Video /><div><h3>Cloudflare Stream Library</h3><p>Fetch videos directly from the Cloudflare account, inspect items, and delete selected videos.</p></div></div>
              <div className="stream-library-toolbar">
                <label><Search /><input value={search} onChange={(input) => setSearch(input.target.value)} placeholder="Search Cloudflare videos by title or UID…" /></label>
                <button className="button" type="button" onClick={() => void load()}><RefreshCw /> Refresh Cloudflare</button>
                <button className="button" type="button" disabled={!videos.length} onClick={() => setSelectedIds(videos.map((video) => video.uid))}>Select all</button>
                <button className="button" type="button" disabled={!selectedIds.length} onClick={() => setSelectedIds([])}>Clear selection</button>
                <button className="button stream-delete-selected" type="button" disabled={!selectedIds.length || working} onClick={() => void deleteVideos()}><Trash2 /> Delete selected</button>
              </div>
              <div className="stream-library-count">{videos.length} loaded <b>{selectedIds.length} selected</b></div>
            </div>
            <div className="stream-video-grid">
              {videos.map((video) => {
                const selected = selectedIds.includes(video.uid);
                return (
                  <article key={video.uid} className={`${selectedVideo?.uid === video.uid ? "focused" : ""} ${selected ? "selected" : ""}`} onClick={() => setSelectedVideo(video)}>
                    <div className="stream-video-thumb" style={video.thumbnail ? { backgroundImage: `url("${video.thumbnail}")` } : undefined}><Video /></div>
                    <div><strong>{video.name}</strong><small>{video.status} · {video.duration ? `${Math.round(video.duration)} sec` : "duration pending"}</small><code>{video.uid}</code></div>
                    <input aria-label={`Select ${video.name}`} type="checkbox" checked={selected} onClick={(click) => click.stopPropagation()} onChange={() => setSelectedIds((current) => selected ? current.filter((id) => id !== video.uid) : [...current, video.uid])} />
                  </article>
                );
              })}
              {!loading && !videos.length && <div className="stream-library-empty">No Cloudflare videos loaded.</div>}
            </div>
          </div>
          <aside className="stream-selected-video">
            <h3>Selected Cloudflare video</h3>
            <p>Details for the video selected from the Cloudflare account.</p>
            {selectedVideo ? (
              <>
                {selectedVideo.hlsUrl
                  ? <LiveBroadcastPlayer channel={{ channelId: selectedVideo.uid, name: selectedVideo.name, type: "HLS", playbackUrl: selectedVideo.hlsUrl, enabled: true, displayOrder: 0 }} posterUrl={selectedVideo.thumbnail} />
                  : <div className="stream-selected-empty"><Video /><span>Video is not ready for playback.</span></div>}
                <dl><dt>Title</dt><dd>{selectedVideo.name}</dd><dt>Status</dt><dd>{selectedVideo.status}</dd><dt>UID</dt><dd>{selectedVideo.uid}</dd></dl>
                {selectedVideo.hlsUrl && <button className="button button-primary" type="button" onClick={() => onPublishPlayback({ channelId: `cloudflare-video-${selectedVideo.uid}`, name: selectedVideo.name, type: "HLS", playbackUrl: selectedVideo.hlsUrl!, enabled: true, displayOrder: 0, posterUrl: selectedVideo.thumbnail, description: selectedVideo.description || "Cloudflare Stream recording" })}><Eye /> Publish video</button>}
              </>
            ) : <div className="stream-selected-empty">Select a Cloudflare video to inspect details.</div>}
          </aside>
        </div>
      </section>

      <section className="admin-card stream-library-section">
        <div className="stream-section-heading"><div><h2>Published Video Library</h2><p>Manage YouTube links, replay videos and highlights published through the Race Upshot broadcast API.</p></div></div>
        <div className="published-video-form">
          <div className="field"><label>YouTube URL / video URL</label><input type="url" value={videoUrl} onChange={(input) => setVideoUrl(input.target.value)} placeholder="https://youtu.be/…" /></div>
          <div className="field"><label>Title</label><input value={videoTitle} onChange={(input) => setVideoTitle(input.target.value)} placeholder="Race highlight reel" /></div>
          <div className="field"><label>Description</label><input value={videoDescription} onChange={(input) => setVideoDescription(input.target.value)} placeholder="Short description" /></div>
          <div className="field"><label>Category</label><select value={videoCategory} onChange={(input) => setVideoCategory(input.target.value)}><option value="highlight">Highlight</option><option value="replay">Replay</option><option value="interview">Interview</option><option value="course">Course</option><option value="other">Other</option></select></div>
          <label className="published-featured"><input type="checkbox" checked={videoFeatured} onChange={(input) => setVideoFeatured(input.target.checked)} /> Featured</label>
          <button className="button button-primary" type="button" disabled={!videoUrl.trim() || !videoTitle.trim()} onClick={addPublishedVideo}>{editingVideoId ? <Settings2 /> : <Plus />} {editingVideoId ? "Save settings" : "Add Video"}</button>
          {editingVideoId && <button className="button" type="button" onClick={() => { setEditingVideoId(""); setVideoUrl(""); setVideoTitle(""); setVideoDescription(""); setVideoFeatured(false); }}>Cancel edit</button>}
        </div>
        <div className="published-video-toolbar">
          <label><Search /><input value={publishedSearch} onChange={(input) => setPublishedSearch(input.target.value)} placeholder="Search title, ID, description…" /></label>
          <select value={publishedCategory} onChange={(input) => setPublishedCategory(input.target.value)}><option value="all">All categories</option>{categories.map((category) => <option value={category} key={category}>{category}</option>)}</select>
          <button className="button" type="button" onClick={() => setPublishedSelected(filteredPublished.map((channel) => channel.channelId))}>Select all</button>
          <button className="button" type="button" disabled={!publishedSelected.length} onClick={() => setPublishedSelected([])}>Clear selection</button>
          <button className="button stream-delete-selected" type="button" disabled={!publishedSelected.length} onClick={() => {
            if (!window.confirm(`Delete ${publishedSelected.length} selected published video${publishedSelected.length === 1 ? "" : "s"}?`)) return;
            onDeletePublished(publishedSelected);
            setPublishedSelected([]);
          }}><Trash2 /> Delete selected</button>
        </div>
        <div className="stream-library-count">{filteredPublished.length} shown <b>{publishedSelected.length} selected</b></div>
        <div className="published-video-grid">
          {filteredPublished.map((channel) => {
            const selected = publishedSelected.includes(channel.channelId);
            return <article key={channel.channelId} className={selected ? "selected" : ""}>
              <input type="checkbox" checked={selected} onChange={() => setPublishedSelected((current) => selected ? current.filter((id) => id !== channel.channelId) : [...current, channel.channelId])} />
              <Video />
              <div><strong>{channel.name}</strong><small>{channel.category || "other"} · {channel.type}</small><code>{channel.playbackUrl}</code></div>
              {channel.featured && <span><Star /> Featured</span>}
              <div className="published-video-actions">
                <a href={channel.playbackUrl} target="_blank" rel="noreferrer"><ExternalLink /> View</a>
                <button type="button" onClick={() => editPublishedVideo(channel)}><Settings2 /> Settings</button>
                <button type="button" onClick={() => onUpdatePublished({ ...channel, enabled: !channel.enabled })}><Eye /> {channel.enabled ? "Unpublish" : "Publish"}</button>
                <button className="danger" type="button" onClick={() => {
                  if (window.confirm(`Delete “${channel.name}” from the published video library?`)) onDeletePublished([channel.channelId]);
                }}><Trash2 /> Delete</button>
              </div>
            </article>;
          })}
          {!filteredPublished.length && <div className="stream-library-empty">No videos match the current filters.</div>}
        </div>
      </section>
    </div>
  );
}
