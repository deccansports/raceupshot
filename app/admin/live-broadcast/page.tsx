import { AdminLayout } from "@/components/admin-layout";
import { LiveBroadcastAdmin } from "@/components/live-broadcast-admin";
import {
  defaultLiveBroadcastConfig,
  getLiveBroadcastConfigForEvent,
} from "@/lib/live-broadcast";
import { orderBroadcastEvents } from "@/lib/broadcast-events";
import { getEvents } from "@/lib/raceupshot-repository";

export const dynamic = "force-dynamic";

async function loadBroadcastEvents() {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      getEvents({ includeUnpublished: true }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("The event store did not respond in time.")),
          8_000,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export default async function AdminLiveBroadcastPage() {
  let eventRows: Awaited<ReturnType<typeof getEvents>> = [];
  let loadError = "";
  try {
    eventRows = await loadBroadcastEvents();
  } catch (error) {
    console.error("[AdminLiveBroadcastPage] Event data unavailable:", error);
    loadError = "Event data is temporarily unavailable. Refresh this page to try again.";
  }

  const events = orderBroadcastEvents(eventRows);
  const broadcastRows = await Promise.all(events.map(async (event) => {
      try {
        return await getLiveBroadcastConfigForEvent(event);
      } catch {
        return defaultLiveBroadcastConfig(event);
      }
    }));

  return (
    <AdminLayout>
      <main className="admin-content">
        <LiveBroadcastAdmin
          events={events.map((event) => ({
            id: event.id,
            slug: event.slug,
            name: event.name,
            date: event.date,
            location: event.location,
            status: event.status,
          }))}
          initialBroadcasts={broadcastRows}
          loadError={loadError}
        />
      </main>
    </AdminLayout>
  );
}
