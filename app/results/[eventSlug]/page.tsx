import { PlatformResultsLoader } from "@/components/platform-results-loader";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { StatusPill } from "@/components/status-pill";
import { getEventBySlug } from "@/lib/raceupshot-repository";
import { notFound } from "next/navigation";

export default async function EventResults({ params }: { params: Promise<{ eventSlug: string }> }) {
  const { eventSlug } = await params;
  const event = await getEventBySlug(eventSlug);
  if (!event) notFound();
  return (
    <>
      <SiteHeader />
      <main>
        <section className="inner-hero">
          <div className="shell">
            <StatusPill status="official" />
            <h1 style={{ marginTop: 18 }}>{event.name}</h1>
            <p>{event.date} · {event.location} · {event.participants.toLocaleString()} stored results</p>
          </div>
        </section>
        <section className="page-section shell">
          <PlatformResultsLoader event={event} />
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
