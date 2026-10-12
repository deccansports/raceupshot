import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getPublicResultParticipant, liveParticipantToAthlete } from "@/lib/platform-repository";
import { getEventBySlug } from "@/lib/raceupshot-repository";
import { Activity, Award, BadgeCheck, Download, Flag, Gauge, Medal, Printer, Share2, ShieldCheck, Timer, Trophy, UserRound } from "lucide-react";
import { notFound } from "next/navigation";

export default async function AthleteResult({ params }: { params: Promise<{ eventSlug: string; participantId: string }> }) {
  const { eventSlug, participantId } = await params;
  const [event, read] = await Promise.all([
    getEventBySlug(eventSlug),
    getPublicResultParticipant(eventSlug, participantId),
  ]);
  if (!event) notFound();
  if (!read) notFound();
  const athlete = liveParticipantToAthlete(read.data, event);
  const initials = athlete.name.split(" ").map((part) => part[0]).join("");
  return (
    <>
      <SiteHeader />
      <main className="athlete-result-page">
        <section className="athlete-hero">
          <div className="shell athlete-title">
            <div className="athlete-identity">
              <div className="athlete-avatar">{initials}</div>
              <div><span className="status-pill status-official"><BadgeCheck size={11} /> Stored result</span><h1>{athlete.name}</h1><p>Bib {athlete.bib} · {athlete.category || athlete.ageGroup} · {event.name}</p></div>
            </div>
            <div className="result-time"><span>FINISH TIME</span><strong>{athlete.finishTime}</strong></div>
          </div>
        </section>
        <section className="page-section shell">
          <div className="result-layout">
            <div>
              <div className="result-card">
                <h2><Trophy /> Race ranking</h2>
                <div className="ranks">
                  <div className="rank-tile rank-overall"><Trophy /><span>OVERALL</span><strong>{athlete.rank > 0 ? `#${athlete.rank}` : "—"}</strong></div>
                  <div className="rank-tile rank-gender"><Medal /><span>GENDER</span><strong>{athlete.genderRank > 0 ? `#${athlete.genderRank}` : "—"}</strong></div>
                  <div className="rank-tile rank-age"><Award /><span>AGE GROUP</span><strong>{athlete.ageRank > 0 ? `#${athlete.ageRank}` : "—"}</strong></div>
                </div>
              </div>
              <div className="result-card">
                <h2><Activity /> Race splits</h2>
                <div className="split-timeline">
                  {athlete.splits.map((split) => <div className="split-row" key={split.label}><i className="split-dot" /><b>{split.label}</b><strong className="split-time">{split.time}</strong></div>)}
                </div>
                {!athlete.splits.length && <p className="admin-empty">No split times are stored for this result.</p>}
              </div>
            </div>
            <aside>
              <div className="result-card">
                <h2><Flag /> Result details</h2>
                <div className="metric-grid">
                  <div><Flag /><span>STATUS</span><strong>{athlete.status}</strong></div>
                  <div><UserRound /><span>GENDER</span><strong>{athlete.gender || "—"}</strong></div>
                  <div><Award /><span>AGE GROUP</span><strong>{athlete.ageGroup || "—"}</strong></div>
                  <div className="metric-wide"><Medal /><span>CATEGORY</span><strong>{athlete.category || "—"}</strong></div>
                  <div><Timer /><span>LAST SPLIT</span><strong>{athlete.lastSplit || "—"}</strong></div>
                  <div><Gauge /><span>PACE</span><strong>{athlete.pace || "—"}</strong></div>
                </div>
              </div>
              <div className="result-card">
                <h2><ShieldCheck /> Verified achievement</h2>
                <p className="verified-result-note"><ShieldCheck /> <span>This result is loaded directly from the event&apos;s published Worker record.</span></p>
                {athlete.certificateUrl && <a href={athlete.certificateUrl} className="button button-primary" style={{ width: "100%", marginBottom: 9 }}><Download /> View certificate</a>}
                <button className="button button-secondary" style={{ width: "100%", marginBottom: 9 }}><Share2 /> Share result</button>
                <button className="button" style={{ width: "100%", border: "1px solid var(--line)" }}><Printer /> Print</button>
              </div>
            </aside>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
