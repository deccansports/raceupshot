import { EventCard } from "@/components/event-card";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { groupLivePageEvents } from "@/lib/live-page-events";
import { getEvents } from "@/lib/raceupshot-repository";

export const dynamic = "force-dynamic";

export default async function LivePage() {
  const { live, past } = groupLivePageEvents(await getEvents());
  return (
    <>
      <SiteHeader />
      <main>
        <section className="inner-hero"><div className="shell"><span className="eyebrow blue">LIVE RACE NETWORK</span><h1>On course, now.</h1><p>Follow leaders, timing reads, and athlete progress as races unfold, or revisit a past event.</p></div></section>
        <section className="page-section shell">
          <div className="section-heading"><div><span className="eyebrow">LIVE NOW</span><h2>Events in motion.</h2></div></div>
          <div className="events-grid">{live.map((event) => <EventCard key={event.slug} event={event} />)}</div>
          {!live.length && <p className="admin-empty">No race is live right now. Past events remain available below.</p>}

          <div className="section-heading" style={{ marginTop: 70 }}><div><span className="eyebrow">PAST EVENTS</span><h2>Previous races.</h2></div></div>
          <div className="events-grid">{past.map((event) => <EventCard key={event.slug} event={event} />)}</div>
          {!past.length && <p className="admin-empty">No past events are available yet.</p>}
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
