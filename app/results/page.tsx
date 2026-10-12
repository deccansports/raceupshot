import { EventCard } from "@/components/event-card";
import { SearchPanel } from "@/components/search-panel";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getEvents } from "@/lib/raceupshot-repository";

export const dynamic = "force-dynamic";

export default async function ResultsPage() {
  const resultEvents = (await getEvents()).filter((event) => event.hasResults);
  return (
    <>
      <SiteHeader />
      <main>
        <section className="inner-hero">
          <div className="shell">
            <span className="eyebrow blue">VERIFIED RACE RESULTS</span>
            <h1>Find your finish.</h1>
            <p>Search by athlete name, bib number, or event. Live and official results are clearly marked.</p>
            <div className="page-search"><SearchPanel dark /></div>
          </div>
        </section>
        <section className="page-section shell">
          <div className="section-heading"><div><span className="eyebrow">RECENTLY PUBLISHED</span><h2>Latest results.</h2></div></div>
          <div className="events-grid">{resultEvents.map((event) => <EventCard event={event} key={event.slug} />)}</div>
          {!resultEvents.length && <p className="admin-empty">No published result sets are available.</p>}
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
