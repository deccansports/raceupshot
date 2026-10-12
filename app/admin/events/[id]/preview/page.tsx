import { AdminLayout } from "@/components/admin-layout";
import { getEventBySlug } from "@/lib/raceupshot-repository";
import { ArrowLeft, CalendarDays, ExternalLink, MapPin } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function EventPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = await getEventBySlug(id, { includeUnpublished: true });
  if (!event) notFound();
  return (
    <AdminLayout>
      <main className="admin-content">
        <div className="admin-title">
          <div>
            <Link href="/admin/events-registration?tab=event_info#managed-events" className="admin-back-link"><ArrowLeft /> Events & registration</Link>
            <h1>Event preview</h1>
            <p>This protected preview is visible to administrators before publication.</p>
          </div>
          <span className="status-pill">{event.status}</span>
        </div>
        <section className="admin-card event-admin-preview">
          {event.bannerUrl && <div className="event-admin-preview-banner"><Image src={event.bannerUrl} alt="" fill sizes="1000px" unoptimized /></div>}
          <div className="event-admin-preview-head">
            {event.logoUrl && <Image src={event.logoUrl} alt="" width={80} height={80} unoptimized />}
            <div><span className="eyebrow">{event.sport}</span><h2>{event.name}</h2><p>{event.description}</p></div>
          </div>
          <div className="metric-grid">
            <div><span>DATE</span><strong><CalendarDays /> {event.date}</strong></div>
            <div><span>LOCATION</span><strong><MapPin /> {event.location}</strong></div>
            <div><span>CATEGORIES</span><strong>{event.categories.join(", ") || "Not configured"}</strong></div>
          </div>
          {event.status !== "draft" && <div className="form-actions"><Link className="button button-primary" href={`/events/${encodeURIComponent(event.slug)}`}><ExternalLink /> Open public event</Link></div>}
        </section>
      </main>
    </AdminLayout>
  );
}
