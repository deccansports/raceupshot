import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { PlatformEventLeaderboard } from "@/components/platform-event-leaderboard";
import { getPlatformEvent } from "@/lib/platform-repository";
import { Radio } from "lucide-react";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function EventLeaderboardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = await getPlatformEvent(slug);
  if (!event) notFound();
  return (
    <>
      <SiteHeader />
      <main>
        <section className="inner-hero"><div className="shell"><span className="status-pill status-live"><Radio /> PRIVACY-FILTERED</span><h1>{event.name} leaderboard</h1><p>Live and published rankings from the shared Race Upshot API.</p></div></section>
        <section className="page-section shell">
          <PlatformEventLeaderboard eventId={event.eventId} eventSlug={slug} />
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
