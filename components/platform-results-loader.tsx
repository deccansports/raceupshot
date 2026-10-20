"use client";

import { resultPace } from "@/lib/result-pace";
import type { Athlete, RaceEvent } from "@/lib/types";
import type { ApiEnvelope, LiveParticipant } from "@/packages/contracts/src";
import { AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";
import { ResultsLeaderboardPanel } from "./results-leaderboard-panel";

function toAthlete(participant: LiveParticipant, event: RaceEvent): Athlete {
  const anonymous = participant.visibility === "ANONYMOUS" && !participant.bib;
  return {
    id: participant.participantUid,
    athleteUid: participant.athleteUid,
    name: anonymous ? "Anonymous Athlete" : participant.displayName,
    bib: anonymous ? "" : participant.bib,
    gender: anonymous ? "" : participant.gender || "",
    ageGroup: participant.ageGroup || "",
    club: anonymous ? "" : participant.club || "",
    city: "",
    country: anonymous ? "" : participant.country || "",
    category: participant.contestName,
    rank: participant.overallRank || 0,
    genderRank: participant.genderRank || 0,
    ageRank: participant.ageGroupRank || 0,
    finishTime: participant.elapsedTime || participant.cumulativeTime || "",
    pace: resultPace(participant),
    status: participant.raceStatus.replaceAll("_", " "),
    lastSplit: participant.latestTimingPoint || participant.splits.at(-1)?.name || "",
    eventId: event.id,
    eventSlug: event.slug,
    eventName: event.name,
    splits: participant.splits.map((split) => ({ label: split.name, time: split.splitTime })),
    certificateUrl: anonymous ? undefined : participant.certificateUrl,
    visibility: participant.visibility,
  };
}

export function PlatformResultsLoader({ event }: { event: RaceEvent }) {
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [resultSource, setResultSource] = useState<"raceupshot" | "timing-provider" | "published-results">("raceupshot");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const load = async (token?: string) => {
      const response = await fetch(`/api/v1/events/${encodeURIComponent(event.id)}/results`, {
        cache: "no-store",
        headers: token ? { authorization: `Bearer ${token}` } : undefined,
      });
      const payload = await response.json() as ApiEnvelope<LiveParticipant[]> & { error?: { message?: string } };
      if (!response.ok || !payload.success) throw new Error(payload.error?.message || "Results are unavailable.");
      if (active) {
        setAthletes(payload.data.map((participant) => toAthlete(participant, event)));
        setResultSource(payload.meta.source);
      }
    };
    void (async () => {
      try {
        // Do not make every visitor wait for Firebase hydration before showing
        // public results. Signed-in athletes get a privacy-aware refresh once
        // the existing session becomes available.
        await load();
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "Results are unavailable.");
      } finally {
        if (active) setLoading(false);
      }

      try {
        // Firebase's web SDK contains dynamic code paths that cannot be
        // evaluated inside the Cloudflare Worker runtime. Load it only after
        // this client component has mounted in the browser.
        const { firebaseAuth } = await import("@/lib/firebase-client");
        await firebaseAuth.authStateReady();
        const token = await firebaseAuth.currentUser?.getIdToken();
        if (token) await load(token);
      } catch {
        // Keep the already-rendered public result set if an optional signed-in
        // privacy refresh cannot be completed.
      }
    })();
    return () => { active = false; };
  }, [event]);

  if (loading) return <div className="results-loading" role="status"><span className="auth-spinner" /><strong>Loading results…</strong></div>;
  if (error) return <div className="freshness-banner stale"><AlertTriangle /><span><b>Results unavailable</b><small>{error}</small></span></div>;
  return <>
    {resultSource !== "published-results" && (
      <div className="freshness-banner stale" role="status">
        <AlertTriangle />
        <span><b>Provisional results</b><small>These results come from canonical race timing and may change. Uploaded verified results will replace them automatically.</small></span>
      </div>
    )}
    <ResultsLeaderboardPanel eventSlug={event.slug} categories={event.categories} athletes={athletes} />
  </>;
}
