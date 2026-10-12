"use client";

import { CloudflareStreamCenter } from "@/components/cloudflare-stream-center";
import type { LiveBroadcastChannel, LiveBroadcastConfig } from "@/packages/contracts/src";
import { useState } from "react";

interface BroadcastEvent {
  id: string;
  slug: string;
  name: string;
  date: string;
  location: string;
  status: string;
}

export function LiveBroadcastAdmin({
  events,
  initialBroadcasts,
  loadError = "",
}: {
  events: BroadcastEvent[];
  initialBroadcasts: LiveBroadcastConfig[];
  loadError?: string;
}) {
  const [broadcasts, setBroadcasts] = useState<Record<string, LiveBroadcastConfig>>(
    Object.fromEntries(initialBroadcasts.map((broadcast) => [broadcast.eventId, broadcast])),
  );
  const [selectedEventId, setSelectedEventId] = useState(events[0]?.id ?? "");
  const [error, setError] = useState("");

  const event = events.find((item) => item.id === selectedEventId) ?? null;
  const broadcast = broadcasts[selectedEventId] ?? null;

  async function persist(next: LiveBroadcastConfig) {
    setError("");
    try {
      const payload = { ...next, updatedAt: new Date().toISOString() };
      const response = await fetch(`/api/v1/admin/events/${encodeURIComponent(next.eventId)}/broadcast`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json() as {
        success?: boolean;
        data?: LiveBroadcastConfig;
        error?: { message?: string } | string;
      };
      if (!response.ok || !result.success || !result.data) {
        const reason = typeof result.error === "string" ? result.error : result.error?.message;
        throw new Error(reason || "Unable to save live broadcast.");
      }
      setBroadcasts((current) => ({ ...current, [result.data!.eventId]: result.data! }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save live broadcast.");
    }
  }

  function publishPlayback(channel: LiveBroadcastChannel) {
    if (!broadcast) return;
    const existingIndex = broadcast.channels.findIndex((item) => item.channelId === channel.channelId);
    const normalized = {
      ...channel,
      enabled: true,
      displayOrder: existingIndex >= 0
        ? broadcast.channels[existingIndex].displayOrder
        : broadcast.channels.length,
    };
    const channels = existingIndex >= 0
      ? broadcast.channels.map((item) => item.channelId === channel.channelId ? normalized : item)
      : [...broadcast.channels, normalized];
    const next: LiveBroadcastConfig = {
      ...broadcast,
      enabled: true,
      publicEnabled: true,
      status: broadcast.status === "OFFLINE" ? "SCHEDULED" : broadcast.status,
      activeChannelId: channel.channelId,
      channels,
    };
    setBroadcasts((current) => ({ ...current, [selectedEventId]: next }));
    void persist(next);
  }

  function updatePublished(channel: LiveBroadcastChannel) {
    if (!broadcast) return;
    const channels = broadcast.channels.map((item) => item.channelId === channel.channelId ? channel : item);
    const next: LiveBroadcastConfig = {
      ...broadcast,
      channels,
      activeChannelId: channel.enabled
        ? broadcast.activeChannelId
        : broadcast.activeChannelId === channel.channelId
          ? channels.find((item) => item.enabled)?.channelId ?? null
          : broadcast.activeChannelId,
    };
    setBroadcasts((current) => ({ ...current, [selectedEventId]: next }));
    void persist(next);
  }

  function deletePublished(channelIds: string[]) {
    if (!broadcast) return;
    const selected = new Set(channelIds);
    const channels = broadcast.channels
      .filter((channel) => !selected.has(channel.channelId))
      .map((channel, index) => ({ ...channel, displayOrder: index }));
    const next: LiveBroadcastConfig = {
      ...broadcast,
      channels,
      activeChannelId: broadcast.activeChannelId && selected.has(broadcast.activeChannelId)
        ? channels.find((channel) => channel.enabled)?.channelId ?? null
        : broadcast.activeChannelId,
    };
    setBroadcasts((current) => ({ ...current, [selectedEventId]: next }));
    void persist(next);
  }

  if (!event || !broadcast) {
    return (
      <>
        <div className="admin-title">
          <div>
            <h1>Broadcast</h1>
            <p>Manage live cameras and event video.</p>
          </div>
        </div>
        <section className="admin-card">
          {loadError
            ? <div className="error-banner">{loadError}</div>
            : <div className="admin-empty">No events are available. Create an event before configuring broadcast cameras.</div>}
        </section>
      </>
    );
  }

  return (
    <div className="broadcast-control-room">
      {error && <div className="error-banner">{error}</div>}
      <CloudflareStreamCenter
        events={events}
        event={event}
        onSelectEvent={(eventId) => {
          setSelectedEventId(eventId);
          setError("");
        }}
        onPublishPlayback={publishPlayback}
        onUpdatePublished={updatePublished}
        publishedChannels={broadcast.channels}
        onDeletePublished={deletePublished}
      />
    </div>
  );
}
