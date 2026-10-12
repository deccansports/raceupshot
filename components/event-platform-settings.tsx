"use client";

import type {
  AthleteVisibility,
  EventPlatformSettings,
  FeibotIntegrationConfig,
  LiveBroadcastChannel,
  LiveBroadcastConfig,
  LiveTrackingSettings,
  MobileEventSettings,
} from "@/packages/contracts/src";
import type { FeibotAdminConnection } from "@/lib/feibot-integration";
import {
  Activity, AlertTriangle, CheckCircle2, Database, Link2,
  KeyRound, LockKeyhole, Plus, Radio, RefreshCw, Save, ShieldCheck,
  Smartphone, TimerReset, Trash2, Trophy, Users, Video,
} from "lucide-react";
import { useState } from "react";

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="platform-toggle-row">
      <span><b>{label}</b><small>{description}</small></span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <i aria-hidden />
    </label>
  );
}

function isoForInput(value: string | null): string {
  return value ? value.slice(0, 16) : "";
}

function inputToIso(value: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function EventPlatformSettingsAdmin({
  eventName,
  initialSettings,
  defaultIntegration,
  initialFeibotConnection,
  initialBroadcast,
  compactLiveTracking = false,
}: {
  eventName: string;
  initialSettings: EventPlatformSettings;
  defaultIntegration: FeibotIntegrationConfig;
  initialFeibotConnection: FeibotAdminConnection;
  initialBroadcast: LiveBroadcastConfig;
  /** Live Tracking Hub keeps broadcast and mobile settings in their own top-level sections. */
  compactLiveTracking?: boolean;
}) {
  const [settings, setSettings] = useState(initialSettings);
  const [broadcast, setBroadcast] = useState(initialBroadcast);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [connection, setConnection] = useState(initialFeibotConnection);
  const [accessKey, setAccessKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [connecting, setConnecting] = useState(false);

  function updateLive<K extends keyof LiveTrackingSettings>(key: K, value: LiveTrackingSettings[K]) {
    setSettings((current) => ({ ...current, live: { ...current.live, [key]: value } }));
  }

  function updateMobile<K extends keyof MobileEventSettings>(key: K, value: MobileEventSettings[K]) {
    setSettings((current) => ({ ...current, mobile: { ...current.mobile, [key]: value } }));
  }

  function updateIntegration<K extends keyof FeibotIntegrationConfig>(key: K, value: FeibotIntegrationConfig[K]) {
    setSettings((current) => ({
      ...current,
      timingIntegration: { ...(current.timingIntegration ?? defaultIntegration), [key]: value },
    }));
  }

  function updateBroadcast<K extends keyof LiveBroadcastConfig>(key: K, value: LiveBroadcastConfig[K]) {
    setBroadcast((current) => ({ ...current, [key]: value }));
  }

  function updateChannel<K extends keyof LiveBroadcastChannel>(channelId: string, key: K, value: LiveBroadcastChannel[K]) {
    setBroadcast((current) => ({
      ...current,
      channels: current.channels.map((channel) => channel.channelId === channelId ? { ...channel, [key]: value } : channel),
    }));
  }

  function addChannel() {
    const channelId = crypto.randomUUID();
    setBroadcast((current) => ({
      ...current,
      activeChannelId: current.activeChannelId ?? channelId,
      channels: [...current.channels, {
        channelId,
        name: `Camera ${current.channels.length + 1}`,
        type: "HLS",
        playbackUrl: "",
        enabled: true,
        displayOrder: current.channels.length,
      }],
    }));
  }

  function removeChannel(channelId: string) {
    setBroadcast((current) => {
      const channels = current.channels.filter((channel) => channel.channelId !== channelId);
      return {
        ...current,
        channels,
        activeChannelId: current.activeChannelId === channelId
          ? channels.find((channel) => channel.enabled)?.channelId ?? null
          : current.activeChannelId,
      };
    });
  }

  async function save() {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const payload = { ...settings, updatedAt: new Date().toISOString() };
      const [settingsResponse, broadcastResponse] = await Promise.all([
        fetch(`/api/v1/admin/events/${encodeURIComponent(settings.eventId)}/settings`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        }),
        fetch(`/api/v1/admin/events/${encodeURIComponent(settings.eventId)}/broadcast`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...broadcast, updatedAt: new Date().toISOString() }),
        }),
      ]);
      const result = await settingsResponse.json() as {
        success?: boolean;
        data?: EventPlatformSettings;
        error?: { message?: string } | string;
      };
      const broadcastResult = await broadcastResponse.json() as {
        success?: boolean;
        data?: LiveBroadcastConfig;
        error?: { message?: string } | string;
      };
      if (!settingsResponse.ok || !result.success || !result.data) {
        const message = typeof result.error === "string" ? result.error : result.error?.message;
        throw new Error(message || "Unable to save platform settings");
      }
      if (!broadcastResponse.ok || !broadcastResult.success || !broadcastResult.data) {
        const message = typeof broadcastResult.error === "string" ? broadcastResult.error : broadcastResult.error?.message;
        throw new Error(message || "Unable to save broadcast settings");
      }
      setSettings(result.data);
      setBroadcast(broadcastResult.data);
      setMessage("Web, mobile, broadcast, privacy and timing-integration settings saved to RACEUPSHOT KV.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save settings");
    } finally {
      setSaving(false);
    }
  }

  async function connectFeibot(refreshOnly = false) {
    setConnecting(true);
    setMessage("");
    setError("");
    try {
      const integration = settings.timingIntegration ?? defaultIntegration;
      const response = await fetch(`/api/v1/admin/events/${encodeURIComponent(settings.eventId)}/feibot`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(refreshOnly ? {} : {
          accessKey,
          secretKey,
          baseUrl: integration.baseUrl,
          eventUuid: integration.providerEventUuid,
        }),
      });
      const result = await response.json() as {
        success?: boolean;
        data?: FeibotAdminConnection;
        error?: { message?: string } | string;
      };
      if (!response.ok || !result.success || !result.data) {
        const apiMessage = typeof result.error === "string" ? result.error : result.error?.message;
        throw new Error(apiMessage || "Unable to connect to Feibot.");
      }
      setConnection(result.data);
      window.dispatchEvent(new CustomEvent("raceupshot:categories-synced", {
        detail: { categories: result.data.contests.map((contest) => contest.name) },
      }));
      setAccessKey("");
      setSecretKey("");
      setSettings((current) => ({
        ...current,
        timingIntegration: {
          ...(current.timingIntegration ?? defaultIntegration),
          enabled: true,
          baseUrl: result.data!.baseUrl,
          providerEventUuid: result.data!.eventUuid,
          status: result.data!.status === "CONNECTED" ? "READY" : "PARTIAL_FAILURE",
          lastTestedAt: result.data!.lastConnectedAt,
          lastSuccessfulSyncAt: result.data!.lastConnectedAt,
          updatedAt: result.data!.lastConnectedAt ?? new Date().toISOString(),
        },
      }));
      setMessage(
        result.data.status === "CONNECTED"
          ? result.data.canonicalBuild?.completeBuildValid
            ? `Feibot connected. Canonical live version ${result.data.canonicalBuild.version} is complete and is now shared by web and mobile.`
            : "Feibot connected. Event, contests, participants, live data, results and leaderboards were checked and saved."
          : "Feibot connected, but one or more optional data feeds are unavailable. See the connection details below.",
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to connect to Feibot.");
    } finally {
      setConnecting(false);
    }
  }

  const integration = settings.timingIntegration;

  return (
    <div className={`platform-settings-stack ${compactLiveTracking ? "compact-live-tracking-settings" : ""}`}>
      {message && <div className="success-banner"><CheckCircle2 /> {message}</div>}
      {error && <div className="success-banner cms-error-banner"><AlertTriangle /> {error}</div>}

      <section className="admin-card">
        <div className="admin-card-head">
          <div><h2><Radio /> Public live tracking</h2><p>Backend-enforced event visibility and live-data features.</p></div>
          <span className={`status-pill ${settings.live.liveTrackingEnabled ? "status-live" : ""}`}>
            {settings.live.liveTrackingEnabled ? "Enabled" : "Disabled"}
          </span>
        </div>
        <div className="platform-toggle-grid">
          <Toggle label="Live tracking" description="Enable the live timing lifecycle for this event." checked={settings.live.liveTrackingEnabled} onChange={(value) => updateLive("liveTrackingEnabled", value)} />
          <Toggle label="Public tracking" description="Allow anonymous public access to live data." checked={settings.live.publicLiveTrackingEnabled} onChange={(value) => updateLive("publicLiveTrackingEnabled", value)} />
          <Toggle label="Login-only tracking" description="Reserve live tracking for authenticated athletes." checked={settings.live.loginOnlyTracking} onChange={(value) => updateLive("loginOnlyTracking", value)} />
          <Toggle label="Athlete search" description="Allow searches by public name or exact bib." checked={settings.live.athleteSearchEnabled} onChange={(value) => updateLive("athleteSearchEnabled", value)} />
          <Toggle label="Leaderboard" description="Publish privacy-filtered live rankings." checked={settings.live.leaderboardEnabled} onChange={(value) => updateLive("leaderboardEnabled", value)} />
          <Toggle label="Split timeline" description="Show timing points and split times." checked={settings.live.splitsEnabled} onChange={(value) => updateLive("splitsEnabled", value)} />
          <Toggle label="Course map" description="Publish the course and confirmed timing locations." checked={settings.live.liveMapEnabled} onChange={(value) => updateLive("liveMapEnabled", value)} />
          <Toggle label="Estimated position" description="Allow clearly labelled chip-based position estimates." checked={settings.live.estimatedPositionEnabled} onChange={(value) => updateLive("estimatedPositionEnabled", value)} />
          <Toggle label="Watchlists" description="Allow public users to follow visible athletes." checked={settings.live.watchlistEnabled} onChange={(value) => updateLive("watchlistEnabled", value)} />
          <Toggle label="Sharing" description="Allow public tracking links for visible athletes." checked={settings.live.sharingEnabled} onChange={(value) => updateLive("sharingEnabled", value)} />
          <Toggle label="Provisional leaderboard" description="Display rankings before official publication." checked={settings.live.provisionalLeaderboard} onChange={(value) => updateLive("provisionalLeaderboard", value)} />
          <Toggle label="Results during race" description="Show completed results while the event remains live." checked={settings.live.resultsVisibleDuringRace} onChange={(value) => updateLive("resultsVisibleDuringRace", value)} />
        </div>
        <div className="form-grid platform-settings-fields">
          <div className="field">
            <label>Default athlete visibility</label>
            <select value={settings.live.defaultAthleteVisibility} onChange={(event) => updateLive("defaultAthleteVisibility", event.target.value as AthleteVisibility)}>
              <option value="PUBLIC">Public</option>
              <option value="ANONYMOUS">Anonymous</option>
              <option value="PRIVATE">Private</option>
            </select>
          </div>
          <div className="field">
            <label>Force event visibility</label>
            <select value={settings.live.forceVisibility ?? ""} onChange={(event) => updateLive("forceVisibility", (event.target.value || null) as AthleteVisibility | null)}>
              <option value="">Use athlete preference</option>
              <option value="PUBLIC">Force public</option>
              <option value="ANONYMOUS">Force anonymous</option>
              <option value="PRIVATE">Force private</option>
            </select>
          </div>
          <div className="field"><label>Tracking starts</label><input type="datetime-local" value={isoForInput(settings.live.liveTrackingStartAt)} onChange={(event) => updateLive("liveTrackingStartAt", inputToIso(event.target.value))} /></div>
          <div className="field"><label>Tracking ends</label><input type="datetime-local" value={isoForInput(settings.live.liveTrackingEndAt)} onChange={(event) => updateLive("liveTrackingEndAt", inputToIso(event.target.value))} /></div>
        </div>
        <div className="privacy-resolution-note">
          <ShieldCheck />
          <span><b>Privacy resolution runs in the API.</b><small>Event policy → forced visibility → admin override → athlete preference → event default. Private athletes are removed before the response leaves the Worker.</small></span>
        </div>
      </section>

      <section className="admin-card">
        <div className="admin-card-head">
          <div><h2><Video /> Live broadcast</h2><p>Publish event-scoped video channels to the web portal and mobile API.</p></div>
          <span className={`status-pill ${broadcast.status === "LIVE" ? "status-live" : ""}`}>{broadcast.status}</span>
        </div>
        <div className="platform-toggle-grid">
          <Toggle label="Enable broadcast" description="Make the broadcast configuration active for this event." checked={broadcast.enabled} onChange={(value) => updateBroadcast("enabled", value)} />
          <Toggle label="Public broadcast" description="Allow web and mobile clients to fetch and play enabled channels." checked={broadcast.publicEnabled} onChange={(value) => updateBroadcast("publicEnabled", value)} />
        </div>
        <div className="form-grid platform-settings-fields">
          <div className="field"><label>Broadcast status</label><select value={broadcast.status} onChange={(event) => updateBroadcast("status", event.target.value as LiveBroadcastConfig["status"])}><option value="OFFLINE">Offline</option><option value="SCHEDULED">Scheduled</option><option value="LIVE">Live</option><option value="ENDED">Ended / replay</option></select></div>
          <div className="field"><label>Active channel</label><select value={broadcast.activeChannelId ?? ""} onChange={(event) => updateBroadcast("activeChannelId", event.target.value || null)}><option value="">Automatic first enabled channel</option>{broadcast.channels.map((channel) => <option key={channel.channelId} value={channel.channelId}>{channel.name}</option>)}</select></div>
          <div className="field"><label>Broadcast title</label><input value={broadcast.title} onChange={(event) => updateBroadcast("title", event.target.value)} /></div>
          <div className="field"><label>Subtitle</label><input value={broadcast.subtitle} onChange={(event) => updateBroadcast("subtitle", event.target.value)} /></div>
          <div className="field full"><label>Status message</label><textarea rows={3} value={broadcast.message} onChange={(event) => updateBroadcast("message", event.target.value)} /></div>
          <div className="field full"><label>Default poster URL</label><input type="url" value={broadcast.posterUrl ?? ""} onChange={(event) => updateBroadcast("posterUrl", event.target.value || undefined)} placeholder="https://…" /></div>
        </div>
        <div className="broadcast-channel-admin">
          <div className="admin-card-head">
            <div><h3>Broadcast channels</h3><p>Cloudflare HLS, direct video, YouTube, iframe or external camera feeds.</p></div>
            <button type="button" className="button" onClick={addChannel}><Plus /> Add channel</button>
          </div>
          {broadcast.channels.map((channel, index) => (
            <div className="broadcast-channel-row" key={channel.channelId}>
              <div className="form-grid platform-settings-fields">
                <div className="field"><label>Channel name</label><input value={channel.name} onChange={(event) => updateChannel(channel.channelId, "name", event.target.value)} /></div>
                <div className="field"><label>Channel type</label><select value={channel.type} onChange={(event) => updateChannel(channel.channelId, "type", event.target.value as LiveBroadcastChannel["type"])}><option value="HLS">Cloudflare / HLS</option><option value="VIDEO">Direct video</option><option value="YOUTUBE">YouTube</option><option value="IFRAME">Iframe player</option><option value="EXTERNAL">External link</option></select></div>
                <div className="field full"><label>Playback URL</label><input type="url" value={channel.playbackUrl} onChange={(event) => updateChannel(channel.channelId, "playbackUrl", event.target.value)} placeholder="https://…/manifest/video.m3u8" /></div>
                <div className="field"><label>Display order</label><input type="number" min="0" value={channel.displayOrder} onChange={(event) => updateChannel(channel.channelId, "displayOrder", Number(event.target.value) || index)} /></div>
                <div className="field"><label>Channel poster URL</label><input type="url" value={channel.posterUrl ?? ""} onChange={(event) => updateChannel(channel.channelId, "posterUrl", event.target.value || undefined)} placeholder="https://…" /></div>
              </div>
              <div className="broadcast-channel-actions">
                <Toggle label="Enabled" description="Expose this channel to public clients." checked={channel.enabled} onChange={(value) => updateChannel(channel.channelId, "enabled", value)} />
                <button type="button" className="button cms-danger-button" onClick={() => removeChannel(channel.channelId)}><Trash2 /> Remove</button>
              </div>
            </div>
          ))}
          {!broadcast.channels.length && <div className="admin-empty">Add a channel to publish live or replay video.</div>}
        </div>
      </section>

      <section className="admin-card">
        <div className="admin-card-head">
          <div><h2><Smartphone /> Mobile app settings</h2><p>Control how {eventName} appears in the Race Upshot iOS and Android app.</p></div>
          <span className="status-pill">{settings.mobile.mobilePublished ? "Published in app" : "Hidden from app"}</span>
        </div>
        <div className="platform-toggle-grid">
          <Toggle label="Publish in app" description="Include the event in mobile API responses." checked={settings.mobile.mobilePublished} onChange={(value) => updateMobile("mobilePublished", value)} />
          <Toggle label="Featured event" description="Make this eligible for the mobile home hero." checked={settings.mobile.mobileFeatured} onChange={(value) => updateMobile("mobileFeatured", value)} />
          <Toggle label="Athlete search" description="Show athlete search inside the event." checked={settings.mobile.athleteSearchEnabled} onChange={(value) => updateMobile("athleteSearchEnabled", value)} />
          <Toggle label="Leaderboard" description="Show the leaderboard tab in mobile." checked={settings.mobile.leaderboardEnabled} onChange={(value) => updateMobile("leaderboardEnabled", value)} />
          <Toggle label="Course map" description="Show stored GPX/course data when available." checked={settings.mobile.courseMapEnabled} onChange={(value) => updateMobile("courseMapEnabled", value)} />
          <Toggle label="Watchlist" description="Allow users to follow public athletes." checked={settings.mobile.watchlistEnabled} onChange={(value) => updateMobile("watchlistEnabled", value)} />
          <Toggle label="Notifications" description="Enable event notification preferences." checked={settings.mobile.notificationsEnabled} onChange={(value) => updateMobile("notificationsEnabled", value)} />
          <Toggle label="Results" description="Expose published results in mobile." checked={settings.mobile.resultsEnabled} onChange={(value) => updateMobile("resultsEnabled", value)} />
          <Toggle label="Certificates" description="Display certificate actions for eligible results." checked={settings.mobile.certificatesEnabled} onChange={(value) => updateMobile("certificatesEnabled", value)} />
          <Toggle label="Announcements" description="Display active event announcement strips." checked={settings.mobile.announcementsEnabled} onChange={(value) => updateMobile("announcementsEnabled", value)} />
        </div>
        <div className="form-grid platform-settings-fields">
          <div className="field"><label>Mobile section</label><select value={settings.mobile.mobileSection} onChange={(event) => updateMobile("mobileSection", event.target.value as MobileEventSettings["mobileSection"])}><option value="AUTO">Automatic from event status</option><option value="UPCOMING">Upcoming</option><option value="LIVE">Live</option><option value="PAST">Past</option></select></div>
          <div className="field"><label>Display order</label><input type="number" min="0" value={settings.mobile.displayOrder} onChange={(event) => updateMobile("displayOrder", Number(event.target.value) || 0)} /></div>
          <div className="field full"><label>Deep-link slug</label><div className="input-with-prefix"><span>raceupshot://events/</span><input value={settings.mobile.deepLinkSlug} onChange={(event) => updateMobile("deepLinkSlug", event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} /></div></div>
        </div>
      </section>

      <section className="admin-card">
        <div className="admin-card-head">
          <div><h2><Database /> Timing integration · Feibot</h2><p>Add the Feibot key, verify the event UUID, and inspect every cloud data feed.</p></div>
          <button className={`cms-toggle ${integration?.enabled ? "active" : ""}`} onClick={() => {
            if (integration) updateIntegration("enabled", !integration.enabled);
            else setSettings((current) => ({ ...current, timingIntegration: { ...defaultIntegration, enabled: true } }));
          }}><i /> {integration?.enabled ? "Enabled" : "Not configured"}</button>
        </div>
        {integration ? (
          <>
            <div className="integration-security-note">
              <LockKeyhole />
              <span><b>Credentials remain server-side.</b><small>The Secret Key is accepted only by the protected admin API. Public web, mobile, and event APIs never return it.</small></span>
            </div>
            <div className="form-grid platform-settings-fields">
              <div className="field"><label>Feibot base URL</label><input type="url" value={integration.baseUrl} onChange={(event) => updateIntegration("baseUrl", event.target.value)} /></div>
              <div className="field"><label>Feibot event UUID</label><input value={integration.providerEventUuid} onChange={(event) => updateIntegration("providerEventUuid", event.target.value)} /></div>
              <div className="field"><label>Access Key</label><input type="password" autoComplete="off" value={accessKey} onChange={(event) => setAccessKey(event.target.value)} placeholder={connection.accessKeyMasked || "fbwb_event_…"} /></div>
              <div className="field"><label>Secret Key</label><input type="password" autoComplete="new-password" value={secretKey} onChange={(event) => setSecretKey(event.target.value)} placeholder={connection.configured ? "Saved securely · enter only to replace" : "Enter Feibot Secret Key"} /></div>
              <div className="field"><label>Connection state</label><input value={connection.status.replaceAll("_", " ")} readOnly /></div>
              <div className="field"><label>Participant sync · seconds</label><input type="number" min="60" value={integration.participantSyncIntervalSeconds} onChange={(event) => updateIntegration("participantSyncIntervalSeconds", Number(event.target.value))} /></div>
              <div className="field"><label>Realtime sync · seconds</label><input type="number" min="5" value={integration.realtimeSyncIntervalSeconds} onChange={(event) => updateIntegration("realtimeSyncIntervalSeconds", Number(event.target.value))} /></div>
              <div className="field"><label>Leaderboard sync · seconds</label><input type="number" min="5" value={integration.leaderboardSyncIntervalSeconds} onChange={(event) => updateIntegration("leaderboardSyncIntervalSeconds", Number(event.target.value))} /></div>
              <div className="field"><label>Result sync · seconds</label><input type="number" min="15" value={integration.resultSyncIntervalSeconds} onChange={(event) => updateIntegration("resultSyncIntervalSeconds", Number(event.target.value))} /></div>
              <div className="field"><label>Timing result source</label><select value={integration.timingResultSource} onChange={(event) => updateIntegration("timingResultSource", event.target.value as FeibotIntegrationConfig["timingResultSource"])}><option value="FEIBOT_PROCESSED">Trust Feibot processed results</option><option value="RACE_UPSHOT_ENGINE">Race Upshot raw RFID engine</option></select></div>
              <div className="field"><label>Official result time</label><select value={integration.resultTimeMode} onChange={(event) => updateIntegration("resultTimeMode", event.target.value as FeibotIntegrationConfig["resultTimeMode"])}><option value="CHIP">Chip time</option><option value="GUN">Gun time</option></select></div>
              <div className="field"><label>Passage gap · milliseconds</label><input type="number" min="1000" max="60000" step="500" value={integration.passageGapMs} onChange={(event) => updateIntegration("passageGapMs", Number(event.target.value))} /></div>
            </div>
            <div className="feibot-connect-actions">
              <button className="button button-primary" type="button" disabled={connecting || (!connection.configured && (!accessKey || !secretKey || !integration.providerEventUuid))} onClick={() => void connectFeibot(false)}>
                <KeyRound /> {connecting ? "Connecting…" : connection.configured ? "Replace key & connect" : "Save key & connect"}
              </button>
              {connection.configured && <button className="button" type="button" disabled={connecting} onClick={() => void connectFeibot(true)}><RefreshCw /> Refresh cloud data</button>}
            </div>

            <div className={`feibot-connection-summary ${connection.connected ? "connected" : ""}`}>
              <div>
                <span className="eyebrow">FEIBOT CONNECTION</span>
                <h3>{connection.connected ? connection.eventName || eventName : "Not connected"}</h3>
                <p>{connection.eventUuid ? `Event UUID ${connection.eventUuid}` : "Add an event UUID and credentials to verify the cloud connection."}</p>
                {connection.canonicalBuild && <p>Canonical version {connection.canonicalBuild.version} · {connection.canonicalBuild.completeBuildValid ? "complete" : "not ready"}</p>}
              </div>
              <span className={`status-pill ${connection.connected ? "status-live" : ""}`}>{connection.status.replaceAll("_", " ")}</span>
            </div>

            {connection.connected && (
              <>
                <div className="feibot-data-kpis">
                  <span><Database /><small>Contests</small><strong>{connection.counts.contests}</strong></span>
                  <span><Users /><small>Participants</small><strong>{connection.counts.participants}</strong></span>
                  <span><TimerReset /><small>Live records</small><strong>{connection.counts.liveRecords}</strong></span>
                  <span><CheckCircle2 /><small>Results</small><strong>{connection.counts.results}</strong></span>
                  <span><Trophy /><small>Leaderboard rows</small><strong>{connection.counts.leaderboardRows}</strong></span>
                </div>
                {!!connection.contests.length && (
                  <div className="feibot-contests">
                    <b>Contests from Feibot</b>
                    <div>{connection.contests.map((contest) => <span key={contest.uuid}><strong>{contest.name}</strong><small>{contest.uuid}</small></span>)}</div>
                  </div>
                )}
                <div className="feibot-endpoint-grid">
                  {Object.entries(connection.endpoints).map(([name, endpoint]) => (
                    <span key={name} className={endpoint.ok ? "ok" : "failed"}>
                      {endpoint.ok ? <CheckCircle2 /> : <AlertTriangle />}
                      <b>{name.replace(/([A-Z])/g, " $1")}</b>
                      <small>{endpoint.count} records · {endpoint.message}</small>
                    </span>
                  ))}
                </div>
              </>
            )}
            <div className="platform-toggle-grid compact">
              <Toggle label="Participants" description="Normalize participant and bib records." checked={integration.syncParticipants} onChange={(value) => updateIntegration("syncParticipants", value)} />
              <Toggle label="Contests" description="Fetch and map provider contests." checked={integration.syncContests} onChange={(value) => updateIntegration("syncContests", value)} />
              <Toggle label="Timing points" description="Fetch timing point definitions." checked={integration.syncTimingPoints} onChange={(value) => updateIntegration("syncTimingPoints", value)} />
              <Toggle label="Realtime" description="Fetch live status and splits." checked={integration.syncRealtime} onChange={(value) => updateIntegration("syncRealtime", value)} />
              <Toggle label="Leaderboards" description="Fetch privacy-filterable rankings." checked={integration.syncLeaderboards} onChange={(value) => updateIntegration("syncLeaderboards", value)} />
              <Toggle label="Results" description="Fetch finish and result states." checked={integration.syncResults} onChange={(value) => updateIntegration("syncResults", value)} />
              <Toggle label="Enable for web" description="Allow normalized data on web APIs." checked={integration.enabledForWeb} onChange={(value) => updateIntegration("enabledForWeb", value)} />
              <Toggle label="Enable for mobile" description="Allow normalized data on mobile APIs." checked={integration.enabledForMobile} onChange={(value) => updateIntegration("enabledForMobile", value)} />
            </div>
            <div className="integration-endpoint">
              <Link2 /><span><b>Correct data flow</b><small>Feibot → trusted Worker sync → normalized KV/D1 → versioned Race Upshot API → web and mobile.</small></span>
            </div>
          </>
        ) : (
          <div className="admin-empty">Enable Feibot to configure the event UUID, server-side secret reference and isolated synchronization modules.</div>
        )}
      </section>

      <div className="platform-save-bar">
        <span><Activity /> Changes create an audit entry and affect both web and mobile API consumers.</span>
        <button className="button button-primary" disabled={saving} onClick={() => void save()}><Save /> {saving ? "Saving…" : "Save platform settings"}</button>
      </div>
    </div>
  );
}
