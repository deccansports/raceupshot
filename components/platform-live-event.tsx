"use client";

import type { ApiEnvelope, LiveParticipant, PublicEvent } from "@/packages/contracts/src";
import { firebaseAuth } from "@/lib/firebase-client";
import {
  AlertTriangle, CheckCircle2, Clock3, Eye, Radio, RefreshCw,
  Search, Star, Timer, Users,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useCanonicalChangeStream } from "./use-canonical-change-stream";

interface LiveSummary {
  event: PublicEvent;
  summary: {
    participantCount: number;
    onCourse: number;
    finished: number;
    lastUpdatedAt: string | null;
  };
}

function freshness(lastUpdatedAt: string | null): { label: string; stale: boolean } {
  if (!lastUpdatedAt) return { label: "Live source has not published an update time", stale: true };
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(lastUpdatedAt)) / 1000));
  if (seconds < 60) return { label: `Updated ${seconds} seconds ago`, stale: seconds > 30 };
  const minutes = Math.floor(seconds / 60);
  return { label: `Timing data is delayed. Last update was ${minutes} minute${minutes === 1 ? "" : "s"} ago.`, stale: true };
}

function readWatchlist(eventId: string): string[] {
  try {
    const value = window.localStorage.getItem(`raceupshot:watchlist:${eventId}`);
    return value ? JSON.parse(value) as string[] : [];
  } catch {
    return [];
  }
}

export function PlatformLiveEvent({ eventSlug }: { eventSlug: string }) {
  const [summary, setSummary] = useState<LiveSummary | null>(null);
  const [participants, setParticipants] = useState<LiveParticipant[]>([]);
  const [query, setQuery] = useState("");
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [meta, setMeta] = useState<ApiEnvelope<unknown>["meta"] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await firebaseAuth.authStateReady();
      const token = await firebaseAuth.currentUser?.getIdToken();
      const headers = token ? { authorization: `Bearer ${token}` } : undefined;
      const [liveResponse, participantResponse] = await Promise.all([
        fetch(`/api/v1/events/${encodeURIComponent(eventSlug)}/live`, { cache: "no-store" }),
        fetch(`/api/v1/events/${encodeURIComponent(eventSlug)}/participants`, { cache: "no-store", headers }),
      ]);
      const livePayload = await liveResponse.json() as ApiEnvelope<LiveSummary> & { error?: { message?: string } };
      const participantPayload = await participantResponse.json() as ApiEnvelope<LiveParticipant[]> & { error?: { message?: string } };
      if (!liveResponse.ok || !livePayload.success) throw new Error(livePayload.error?.message || "Live tracking is unavailable");
      if (!participantResponse.ok || !participantPayload.success) throw new Error(participantPayload.error?.message || "Athletes are unavailable");
      setSummary(livePayload.data);
      setParticipants(participantPayload.data);
      setMeta(participantPayload.meta);
      setWatchlist(readWatchlist(livePayload.data.event.eventId));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Live tracking is unavailable");
    } finally {
      setLoading(false);
    }
  }, [eventSlug]);

  useCanonicalChangeStream(summary?.event.eventId, load, load);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const interval = window.setInterval(() => void load(), 15_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [load]);

  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return participants;
    return participants.filter((participant) =>
      participant.displayName.toLowerCase().includes(normalized) ||
      participant.bib.toLowerCase() === normalized);
  }, [participants, query]);

  function toggleWatch(participantUid: string) {
    if (!summary) return;
    setWatchlist((current) => {
      const next = current.includes(participantUid)
        ? current.filter((id) => id !== participantUid)
        : [...current, participantUid];
      window.localStorage.setItem(`raceupshot:watchlist:${summary.event.eventId}`, JSON.stringify(next));
      return next;
    });
  }

  const fresh = freshness(meta?.lastUpdatedAt ?? null);

  return (
    <div className="platform-live-page">
      <section className="platform-live-hero">
        <div className="shell">
          <div className="platform-live-heading">
            <div>
              <span className="status-pill status-live"><Radio /> LIVE TRACKING</span>
              <h1>{summary?.event.name ?? "Race Upshot live"}</h1>
              <p>{summary?.event.location ?? "Loading event information…"}</p>
            </div>
            <button className="button platform-refresh" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} /> Refresh</button>
          </div>
          <div className="platform-live-kpis">
            <span><Users /><small>VISIBLE ATHLETES</small><strong>{summary?.summary.participantCount ?? 0}</strong></span>
            <span><Timer /><small>ON COURSE</small><strong>{summary?.summary.onCourse ?? 0}</strong></span>
            <span><CheckCircle2 /><small>FINISHED</small><strong>{summary?.summary.finished ?? 0}</strong></span>
            <span className={fresh.stale ? "stale" : ""}><Clock3 /><small>DATA FRESHNESS</small><strong>{fresh.stale ? "CHECK" : "LIVE"}</strong></span>
          </div>
        </div>
      </section>

      <main className="page-section shell platform-live-content">
        <div className={`freshness-banner ${fresh.stale ? "stale" : "fresh"}`}>
          {fresh.stale ? <AlertTriangle /> : <CheckCircle2 />}
          <span><b>{fresh.stale ? "Timing freshness warning" : "Timing feed current"}</b><small>{fresh.label}</small></span>
        </div>
        {error && <div className="freshness-banner stale"><AlertTriangle /><span><b>Live timing unavailable</b><small>{error}</small></span></div>}

        <div className="platform-live-toolbar">
          <label><Search /><input placeholder="Search public athlete or exact bib…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <div>
            <Link className="button" href={`/events/${eventSlug}/leaderboard`}>Leaderboard</Link>
            <span className="platform-watch-count"><Star /> {watchlist.length} watched</span>
          </div>
        </div>

        <div className="platform-athlete-grid">
          {visible.map((participant) => {
            const watched = watchlist.includes(participant.participantUid);
            return (
              <article className="platform-athlete-card" key={participant.participantUid}>
                <div className="platform-athlete-card-head">
                  <span className="platform-athlete-avatar">{participant.initials}</span>
                  <div><h2>{participant.displayName}</h2><p>BIB {participant.bib || "—"} · {participant.contestName || "Open category"}</p></div>
                  <button className={watched ? "watched" : ""} onClick={() => toggleWatch(participant.participantUid)} aria-label={watched ? "Remove from watchlist" : "Add to watchlist"}><Star /></button>
                </div>
                <div className="platform-athlete-progress">
                  <span><small>STATUS</small><b>{participant.raceStatus.replaceAll("_", " ")}</b></span>
                  <span><small>LATEST POINT</small><b>{participant.latestTimingPoint || participant.splits.at(-1)?.name || "Waiting for timing read"}</b></span>
                  <span><small>TIME</small><b className="mono">{participant.elapsedTime || participant.cumulativeTime || "—"}</b></span>
                </div>
                <div className="platform-athlete-card-actions">
                  <span>{participant.overallRank ? `Overall #${participant.overallRank}` : "Rank pending"}</span>
                  <Link href={`/events/${eventSlug}/athletes/${encodeURIComponent(participant.participantUid)}`}>Open live athlete <Eye /></Link>
                </div>
              </article>
            );
          })}
        </div>
        {!loading && !visible.length && <div className="admin-empty">No athlete or bib matches this search.</div>}
      </main>
    </div>
  );
}
