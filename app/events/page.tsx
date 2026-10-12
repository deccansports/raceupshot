import { EventsDirectory } from "@/components/events-directory";
import { SearchPanel } from "@/components/search-panel";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getEvents } from "@/lib/raceupshot-repository";

export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const events = await getEvents();
  return (
    <>
      <SiteHeader />
      <main>
        <section className="inner-hero">
          <div className="shell">
            <span className="eyebrow blue">THE RACE CALENDAR</span>
            <h1>Find your next start line.</h1>
            <p>Explore upcoming events, follow live races, and revisit official results from across the Race Upshot network.</p>
            <div className="page-search"><SearchPanel dark eventsOnly /></div>
          </div>
        </section>
        <section className="page-section shell"><EventsDirectory events={events} /></section>
      </main>
      <SiteFooter />
    </>
  );
}
