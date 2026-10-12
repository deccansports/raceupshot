import { EventCard } from "@/components/event-card";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getEvents } from "@/lib/raceupshot-repository";

export const dynamic = "force-dynamic";

export default async function LivePage() {
  const live = (await getEvents()).filter((event) => event.status === "live");
  return (
    <>
      <SiteHeader />
      <main>
        <section className="inner-hero"><div className="shell"><span className="eyebrow blue">LIVE RACE NETWORK</span><h1>On course, now.</h1><p>Follow leaders, timing reads, and athlete progress as races unfold.</p></div></section>
        <section className="page-section shell"><div className="events-grid">{live.map((event) => <EventCard key={event.slug} event={event} />)}</div>{!live.length && <p className="admin-empty">No event is marked live in Worker storage.</p>}</section>
      </main>
      <SiteFooter />
    </>
  );
}
