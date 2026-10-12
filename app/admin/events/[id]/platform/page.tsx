import { AdminLayout } from "@/components/admin-layout";
import { EventPlatformSettingsAdmin } from "@/components/event-platform-settings";
import {
  createDefaultFeibotIntegration,
  getEventPlatformSettings,
} from "@/lib/platform-repository";
import { getFeibotAdminConnection } from "@/lib/feibot-integration";
import { getLiveBroadcastConfig } from "@/lib/live-broadcast";
import { getEventBySlug } from "@/lib/raceupshot-repository";
import { ArrowLeft, Radio } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function EventPlatformPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = await getEventBySlug(id, { includeUnpublished: true });
  if (!event) notFound();
  const [settings, feibotConnection, broadcast] = await Promise.all([
    getEventPlatformSettings(id),
    getFeibotAdminConnection(id),
    getLiveBroadcastConfig(id),
  ]);
  if (!settings || !broadcast) notFound();
  return (
    <AdminLayout>
      <main className="admin-content">
        <div className="admin-title platform-admin-title">
          <div>
            <Link href="/admin/events-registration?tab=event_info#managed-events" className="admin-back-link"><ArrowLeft /> Events & registration</Link>
            <h1>Live & mobile platform</h1>
            <p>{event.name} · shared settings for web, APIs and the Race Upshot mobile app.</p>
          </div>
          <span className="status-pill"><Radio /> {event.status}</span>
        </div>
        <EventPlatformSettingsAdmin
          eventName={event.name}
          initialSettings={settings}
          defaultIntegration={createDefaultFeibotIntegration(event.id)}
          initialFeibotConnection={feibotConnection}
          initialBroadcast={broadcast}
          compactLiveTracking
        />
      </main>
    </AdminLayout>
  );
}
