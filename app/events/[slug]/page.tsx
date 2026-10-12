import { SearchPanel } from "@/components/search-panel";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { StatusPill } from "@/components/status-pill";
import { PublicCourseMaps } from "@/components/public-course-maps";
import { getPublicEventCourseMaps } from "@/lib/course-maps";
import { getEventBySlug } from "@/lib/raceupshot-repository";
import { getPublicLiveBroadcast } from "@/lib/live-broadcast";
import { ArrowUpRight, BookOpen, CalendarDays, Clock3, FileText, MapPin, Radio, Users } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

export default async function EventDetail({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [event, course, broadcast] = await Promise.all([
    getEventBySlug(slug),
    getPublicEventCourseMaps(slug, { surface: "web" }),
    getPublicLiveBroadcast(slug),
  ]);
  if (!event) notFound();
  return (
    <>
      <SiteHeader />
      <main>
        <section className="inner-hero">
          <div className="shell">
            <StatusPill status={event.status} />
            <h1 style={{ marginTop: 18 }}>{event.name}</h1>
            <p>{event.description}</p>
            <div className="category-chips event-category-chips">{event.categories.map((c) => <span key={c}>{c}</span>)}</div>
          </div>
        </section>
        <section className="page-section shell">
          <div className="result-layout">
            <div>
              <div className="result-card">
                <h2>Event overview</h2>
                <div className="metric-grid">
                  <div><span>DATE</span><strong><CalendarDays size={15} /> {event.date}</strong></div>
                  <div><span>LOCATION</span><strong><MapPin size={15} /> {event.location}</strong></div>
                  <div><span>START TIME</span><strong><Clock3 size={15} /> {event.startTime || "To be announced"}</strong></div>
                  <div><span>ATHLETES</span><strong><Users size={15} /> {event.participants.toLocaleString()}</strong></div>
                </div>
              </div>
              {course && <PublicCourseMaps course={course} />}
              <div className="result-card">
                <h2>Course & timing</h2>
                <p style={{ color: "var(--muted)", lineHeight: 1.8 }}>Race Upshot timing points cover the start, all major discipline transitions, intermediate checkpoints, and the finish. Live reads are published after automated validation.</p>
                <div className="category-chips"><span>START</span><span>CHECKPOINT 1</span><span>HALFWAY</span><span>FINISH</span></div>
              </div>
            </div>
            <aside>
              <div className="result-card">
                <h2>Race actions</h2>
                {event.status === "live" || event.hasResults ? (
                  <Link href={event.status === "live" ? `/events/${event.slug}/live` : `/results/${event.slug}`} className="button button-primary" style={{ width: "100%", marginBottom: 10 }}>
                    {event.status === "live" ? "Open live results" : "View results"} <ArrowUpRight />
                  </Link>
                ) : (
                  <button className="button button-primary race-action-disabled" type="button" disabled title="Results will be available after they are uploaded." style={{ width: "100%", marginBottom: 10 }}>
                    View results
                  </button>
                )}
                <Link href={`/events/${event.slug}/athletes`} className="button" style={{ width: "100%", marginBottom: 10, border: "1px solid var(--line)" }}>Find live athlete <Users /></Link>
                <Link href={`/events/${event.slug}/leaderboard`} className="button" style={{ width: "100%", marginBottom: 10, border: "1px solid var(--line)" }}>Leaderboard <ArrowUpRight /></Link>
                {broadcast?.enabled ? (
                  <Link href={`/events/${event.slug}/broadcast`} className="button" style={{ width: "100%", marginBottom: 10, border: "1px solid var(--line)" }}>Live broadcast <Radio /></Link>
                ) : (
                  <button className="button race-action-disabled" type="button" disabled title="The event broadcast has not been published." style={{ width: "100%", marginBottom: 10 }}>Live broadcast</button>
                )}
                {(event.rulesHtml || event.rulesUrl) && (
                  event.rulesHtml
                    ? <Link href={`/events/${encodeURIComponent(event.slug)}/rules`} className="button" style={{ width: "100%", marginBottom: 10, border: "1px solid var(--line)" }}>Rules &amp; regulations <FileText /></Link>
                    : <a href={event.rulesUrl} target="_blank" rel="noreferrer" className="button" style={{ width: "100%", marginBottom: 10, border: "1px solid var(--line)" }}>Rules &amp; regulations <FileText /></a>
                )}
                {event.athleteGuidebookUrl && <a href={event.athleteGuidebookUrl} target="_blank" rel="noreferrer" className="button" style={{ width: "100%", marginBottom: 10, border: "1px solid var(--line)" }}>Athlete guidebook <BookOpen /></a>}
                <Link href="/contact" className="button button-secondary" style={{ width: "100%" }}>Event support</Link>
                {event.registrationUrl && <a href={event.registrationUrl} target="_blank" rel="noreferrer" className="button button-lime" style={{ width: "100%", marginTop: 10 }}>Register now <ArrowUpRight /></a>}
                {event.knowMoreUrl && event.knowMoreUrl !== `/events/${event.slug}` && <Link href={event.knowMoreUrl} className="button" style={{ width: "100%", marginTop: 10, border: "1px solid var(--line)" }}>Know more <ArrowUpRight /></Link>}
              </div>
              <div className="result-card">
                <h2>Find an athlete</h2>
                <SearchPanel />
              </div>
            </aside>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
