"use client";

import { firebaseAuth } from "@/lib/firebase-client";
import type { ApiEnvelope, LiveParticipant } from "@/packages/contracts/src";
import { AlertTriangle, Clock3, Medal, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useCanonicalChangeStream } from "./use-canonical-change-stream";

export function PlatformEventLeaderboard({ eventId, eventSlug }: { eventId: string; eventSlug: string }) {
  const [rows, setRows] = useState<LiveParticipant[]>([]);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [stale, setStale] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await firebaseAuth.authStateReady();
      const token = await firebaseAuth.currentUser?.getIdToken();
      const response = await fetch(`/api/v1/events/${encodeURIComponent(eventId)}/leaderboards`, {
        cache: "no-store",
        headers: token ? { authorization: `Bearer ${token}` } : undefined,
      });
      const payload = await response.json() as ApiEnvelope<LiveParticipant[]> & { error?: { message?: string } };
      if (!response.ok || !payload.success) throw new Error(payload.error?.message || "Leaderboard is unavailable.");
      setRows(payload.data);
      setLastUpdatedAt(payload.meta?.lastUpdatedAt ?? null);
      setStale(payload.meta?.isStale ?? true);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Leaderboard is unavailable.");
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useCanonicalChangeStream(eventId, load, load);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 15_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [load]);

  return (
    <>
      <div className={`freshness-banner ${stale ? "stale" : "fresh"}`}>
        <Clock3 /><span><b>{stale ? "Ranking data may be delayed" : "Ranking data current"}</b><small>{lastUpdatedAt ? new Date(lastUpdatedAt).toLocaleString("en-IN") : "No live source timestamp was supplied."}</small></span>
        <button className="button" disabled={loading} onClick={() => void load()}><RefreshCw className={loading ? "animate-spin" : ""} /> Refresh</button>
      </div>
      {error && <div className="freshness-banner stale"><AlertTriangle /><span><b>Leaderboard unavailable</b><small>{error}</small></span></div>}
      <div className="cms-table-wrap">
        <table className="leaderboard">
          <thead><tr><th>Rank</th><th>Athlete</th><th>Bib</th><th>Contest</th><th>Status</th><th>Time</th><th>Action</th></tr></thead>
          <tbody>{rows.map((athlete) => {
            const anonymous = athlete.visibility === "ANONYMOUS" && !athlete.bib;
            return <tr key={athlete.participantUid}><td className="rank"><Medal /> {athlete.overallRank}</td><td><b>{anonymous ? "Anonymous Athlete" : athlete.displayName}</b><small>{anonymous ? "Identity hidden" : athlete.country || athlete.visibility}</small></td><td>{anonymous ? "—" : athlete.bib}</td><td>{athlete.contestName}</td><td>{athlete.raceStatus.replaceAll("_", " ")}</td><td className="time">{athlete.elapsedTime || athlete.cumulativeTime || "—"}</td><td>{anonymous ? "—" : <Link className="text-link" href={`/events/${eventSlug}/athletes/${athlete.participantUid}`}>View</Link>}</td></tr>;
          })}</tbody>
        </table>
      </div>
      {!loading && !rows.length && !error && <p className="admin-empty">No leaderboard records are available yet.</p>}
    </>
  );
}
