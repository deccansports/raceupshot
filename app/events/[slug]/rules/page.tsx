import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { eventDocumentSrcDoc } from "@/lib/event-document";
import { getEventBySlug } from "@/lib/raceupshot-repository";
import { ArrowLeft, BookOpen } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function EventRulesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event?.rulesHtml) notFound();
  const rulesDocument = eventDocumentSrcDoc(event.rulesHtml);

  return (
    <>
      <SiteHeader />
      <main className="event-rules-page">
        <section className="event-rules-hero">
          <div className="shell">
            <Link className="event-rules-back" href={`/events/${encodeURIComponent(event.slug)}`}><ArrowLeft /> Back to event</Link>
            <span className="eyebrow"><BookOpen /> OFFICIAL EVENT DOCUMENT</span>
            <h1>Rules &amp; Regulations</h1>
            <p>{event.name} · {event.date} · {event.location}</p>
          </div>
        </section>
        <section className="shell event-rules-shell">
          <iframe
            className="event-rules-document"
            title={`${event.name} rules and regulations`}
            sandbox=""
            srcDoc={rulesDocument}
          />
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
