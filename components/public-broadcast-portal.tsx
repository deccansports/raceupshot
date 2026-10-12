"use client";

import type { BroadcastAthleteOverlayFeed } from "@/lib/broadcast-athlete-overlay";
import type { LiveBroadcastPublicData } from "@/packages/contracts/src";
import { ArrowLeft, Clock3, Copy, Radio, Share2, Timer, Video } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { LiveBroadcastPlayer } from "./live-broadcast-player";

function statusLabel(status: LiveBroadcastPublicData["status"]): string {
  if (status === "LIVE") return "LIVE NOW";
  if (status === "ENDED") return "REPLAY";
  if (status === "SCHEDULED") return "SCHEDULED";
  return "OFFLINE";
}

export function PublicBroadcastPortal({ broadcast }: { broadcast: LiveBroadcastPublicData }) {
  const [selectedId, setSelectedId] = useState(broadcast.activeChannel?.channelId ?? broadcast.channels[0]?.channelId ?? "");
  const [athleteOverlay, setAthleteOverlay] = useState<BroadcastAthleteOverlayFeed["athletes"]>([]);
  const overlaySignature = useRef("");
  const overlayTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selected = useMemo(
    () => broadcast.channels.find((channel) => channel.channelId === selectedId) ?? broadcast.activeChannel,
    [broadcast, selectedId],
  );
  const status = statusLabel(broadcast.status);

  useEffect(() => {
    if (!broadcast.athleteOverlay.enabled) return;
    let disposed = false;
    const refresh = async () => {
      try {
        const response = await fetch(`/api/v1/events/${encodeURIComponent(broadcast.eventId)}/broadcast/overlay`, { cache: "no-store" });
        const body = await response.json() as { success?: boolean; data?: BroadcastAthleteOverlayFeed };
        if (!response.ok || !body.success || !body.data?.enabled || !body.data.athletes.length || disposed) return;
        const signature = body.data.athletes.map((athlete) => `${athlete.participantUid}:${athlete.timingPointId}:${athlete.readAt || "read"}`).join("|");
        if (signature === overlaySignature.current) return;
        overlaySignature.current = signature;
        setAthleteOverlay(body.data.athletes);
        if (overlayTimeout.current) clearTimeout(overlayTimeout.current);
        overlayTimeout.current = setTimeout(() => setAthleteOverlay([]), body.data.displaySeconds * 1000);
      } catch {
        // Keep the video playing if timing data is temporarily unavailable.
      }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 2000);
    return () => {
      disposed = true;
      clearInterval(interval);
      if (overlayTimeout.current) clearTimeout(overlayTimeout.current);
    };
  }, [broadcast.athleteOverlay.enabled, broadcast.eventId]);

  async function share() {
    const url = window.location.href;
    if (navigator.share) await navigator.share({ title: broadcast.title, text: broadcast.subtitle, url });
    else await navigator.clipboard.writeText(url);
  }

  return (
    <main className="public-broadcast-page">
      <header className="public-broadcast-header">
        <div className="shell public-broadcast-header-inner">
          <div>
            <Link href={`/events/${broadcast.eventSlug}`} className="broadcast-back"><ArrowLeft /> Event details</Link>
            <span className={`broadcast-status broadcast-status-${broadcast.status.toLowerCase()}`}><Radio /> {status}</span>
            <h1>{broadcast.title}</h1>
            <p>{broadcast.subtitle}</p>
          </div>
          <div className="broadcast-header-actions">
            <button type="button" onClick={() => void navigator.clipboard.writeText(window.location.href)}><Copy /> Copy link</button>
            <button type="button" onClick={() => void share()}><Share2 /> Share</button>
          </div>
        </div>
      </header>
      <section className="shell public-broadcast-layout">
        <div className="public-broadcast-main">
          <div className="public-broadcast-player-stage">
            <LiveBroadcastPlayer channel={selected} posterUrl={broadcast.posterUrl} />
            {!!athleteOverlay.length && (
              <div className="broadcast-athlete-overlay" aria-live="polite">
                {athleteOverlay.map((athlete) => (
                  <article key={`${athlete.participantUid}-${athlete.readAt || athlete.timingPointId}`}>
                    <div><Timer /><span>{athlete.state === "FINISHING_NOW" ? "FINISHING NOW" : broadcast.athleteOverlay.message}</span></div>
                    <strong>{athlete.displayName}</strong>
                    <p>{athlete.bib ? `BIB ${athlete.bib}` : "ATHLETE"}{athlete.contestName ? ` · ${athlete.contestName}` : ""}</p>
                  </article>
                ))}
              </div>
            )}
          </div>
          <div className="broadcast-now-card">
            <div><span>NOW SHOWING</span><strong>{selected?.name || "Broadcast waiting"}</strong><small>{selected?.description || broadcast.message}</small></div>
            {broadcast.startedAt && <div className="broadcast-started"><Clock3 /><span>Started</span><strong>{new Date(broadcast.startedAt).toLocaleString()}</strong></div>}
          </div>
          {broadcast.channels.length > 1 && (
            <div className="broadcast-channel-grid">
              {broadcast.channels.map((channel) => (
                <button type="button" key={channel.channelId} className={channel.channelId === selected?.channelId ? "active" : ""} onClick={() => setSelectedId(channel.channelId)}>
                  <Video />
                  <span><strong>{channel.name}</strong><small>{channel.type}{channel.description ? ` · ${channel.description}` : ""}</small></span>
                  {channel.channelId === broadcast.activeChannel?.channelId && <i>ACTIVE</i>}
                </button>
              ))}
            </div>
          )}
        </div>
        <aside className="public-broadcast-aside">
          <div>
            <span>EVENT BROADCAST</span>
            <h2>{broadcast.eventName}</h2>
            <p>{broadcast.message || "Official Race Upshot live event coverage."}</p>
          </div>
          <div className="broadcast-info-row"><span>STATUS</span><strong>{status}</strong></div>
          <div className="broadcast-info-row"><span>CHANNELS</span><strong>{broadcast.channels.length}</strong></div>
          <div className="broadcast-info-row"><span>UPDATED</span><strong>{new Date(broadcast.updatedAt).toLocaleTimeString()}</strong></div>
          {!broadcast.enabled && <div className="broadcast-offline-note">This public broadcast is currently disabled.</div>}
        </aside>
      </section>
    </main>
  );
}
