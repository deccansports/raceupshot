import type { LiveParticipant, PublicEvent } from "@/packages/contracts/src";
import {
  Activity, Clock3, Flag, Gauge, MapPin, Medal, Radio, Route, ShieldCheck,
  Timer, Trophy,
} from "lucide-react";
import { formatDurationMs } from "@/packages/timing-core/src";

export function LiveAthleteDetail({ event, athlete, stale }: { event: PublicEvent; athlete: LiveParticipant; stale: boolean }) {
  return (
    <main className="page-section shell live-athlete-detail">
      <div className={`freshness-banner ${stale ? "stale" : "fresh"}`}>
        <Radio /><span><b>{stale ? "Timing data may be delayed" : "Live timing connected"}</b><small>{athlete.lastUpdatedAt ? `Source update ${new Date(athlete.lastUpdatedAt).toLocaleString("en-IN")}` : "No provider update time was supplied."}</small></span>
      </div>
      <section className="live-athlete-identity">
        <span>{athlete.initials}</span>
        <div>
          <small>{event.name} · {athlete.visibility}</small>
          <h1>{athlete.displayName}</h1>
          <p>Bib {athlete.bib || "—"} · {athlete.contestName || "Open category"} {athlete.country ? `· ${athlete.country}` : ""}</p>
        </div>
        <strong><Radio /> {athlete.raceStatus.replaceAll("_", " ")}</strong>
      </section>
      <section className="live-athlete-metrics">
        <span><Timer /><small>ELAPSED</small><strong>{athlete.elapsedTime || athlete.cumulativeTime || "—"}</strong></span>
        <span><Activity /><small>CURRENT LEG</small><strong>{athlete.currentLeg || "—"}</strong></span>
        <span><MapPin /><small>LATEST CONFIRMED POINT</small><strong>{athlete.latestTimingPoint || "Waiting for read"}</strong></span>
        <span><Gauge /><small>PROGRESS</small><strong>{athlete.progressPercent !== undefined ? `${athlete.progressPercent.toFixed(1)}%` : "—"}</strong></span>
        <span><Trophy /><small>OVERALL</small><strong>{athlete.overallRank ? `#${athlete.overallRank}` : "—"}</strong></span>
        <span><Medal /><small>AGE GROUP</small><strong>{athlete.ageGroupRank ? `#${athlete.ageGroupRank}` : "—"}</strong></span>
      </section>
      <div className="result-layout">
        <section className="result-card">
          <h2><Route /> Split timeline</h2>
          <div className="live-split-timeline">
            {athlete.splits.map((split, index) => (
              <div key={`${split.splitId || split.name || "split"}:${split.readerTimestamp || split.timestamp || index}:${index}`}>
                <i>{index + 1}</i>
                <span><b>{split.name}</b><small>{split.distanceKm !== undefined ? `${split.distanceKm} km` : split.status || "Timing point"}</small></span>
                <span><small>CHIP TIME</small><strong>{split.chipTimeMs !== undefined ? formatDurationMs(split.chipTimeMs) : split.cumulativeTime || "—"}</strong></span>
                <span><small>GUN TIME</small><strong>{split.gunTimeMs !== undefined ? formatDurationMs(split.gunTimeMs) : "—"}</strong></span>
                <span><small>TIME OF DAY · SOURCE</small><strong>{split.readerTimestamp ? new Date(split.readerTimestamp).toLocaleTimeString("en-IN", { hour12: false }) : "—"} · {split.source || "—"}</strong></span>
              </div>
            ))}
            {!athlete.splits.length && <p className="admin-empty">No split reads have been published for this athlete.</p>}
          </div>
        </section>
        <aside>
          <div className="result-card">
            <h2><Flag /> Position information</h2>
            <div className="estimated-position-card">
              <MapPin />
              <b>Last Confirmed Timing Point</b>
              <strong>{athlete.latestTimingPoint || "No confirmed timing point"}</strong>
              <p>Race Upshot does not display an exact GPS location unless a real GPS source is connected.</p>
            </div>
          </div>
          <div className="result-card">
            <h2><ShieldCheck /> Privacy applied</h2>
            <p className="privacy-public-note">This payload was filtered by the Worker before rendering. Private athletes return a not-found response; anonymous athletes contain no full identity.</p>
          </div>
          <div className="result-card">
            <h2><Clock3 /> Estimated finish</h2>
            <strong className="public-estimate">{athlete.estimatedFinishAt ? new Date(athlete.estimatedFinishAt).toLocaleTimeString("en-IN") : "Not available"}</strong>
          </div>
        </aside>
      </div>
    </main>
  );
}
