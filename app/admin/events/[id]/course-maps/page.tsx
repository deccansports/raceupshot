import { AdminLayout } from "@/components/admin-layout";
import { CourseMapsAdmin } from "@/components/course-maps-admin";
import { getAdminEventCourseMaps } from "@/lib/course-maps";
import { getEventBySlug } from "@/lib/raceupshot-repository";
import { ArrowLeft, Map } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function EventCourseMapsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [event, collection] = await Promise.all([
    getEventBySlug(id, { includeUnpublished: true }),
    getAdminEventCourseMaps(id),
  ]);
  if (!event || !collection) notFound();
  return (
    <AdminLayout>
      <main className="admin-content">
        <div className="admin-title platform-admin-title">
          <div>
            <Link href="/admin/events-registration?tab=event_info#managed-events" className="admin-back-link"><ArrowLeft /> Events & registration</Link>
            <h1>Course Maps</h1>
            <p>{event.name} · ticket-specific GPX/KML routes, combined courses and custom overlays.</p>
          </div>
          <span className="status-pill"><Map /> {collection.maps.length} maps</span>
        </div>
        <CourseMapsAdmin eventId={event.id} eventName={event.name} sport={event.sport} categories={event.categories} tickets={event.ticketDefinitions} initialCollection={collection} />
      </main>
    </AdminLayout>
  );
}
