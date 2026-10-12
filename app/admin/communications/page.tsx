import { AdminLayout } from "@/components/admin-layout";
import { CommunicationsManager } from "@/components/communications-manager";
import { listCommunicationCampaigns } from "@/lib/communication-campaigns";
import { getEvents } from "@/lib/raceupshot-repository";

export const dynamic = "force-dynamic";

export default async function AdminCommunicationsPage({ searchParams }: { searchParams: Promise<{ eventId?: string }> }) {
  const [{ eventId = "" }, events, campaigns] = await Promise.all([
    searchParams,
    getEvents({ includeUnpublished: true }),
    listCommunicationCampaigns(),
  ]);
  return (
    <AdminLayout>
      <main className="admin-content">
        <div className="admin-title"><div><h1>Communications</h1><p>Send event updates and promotional messages to a precisely filtered audience.</p></div></div>
        <CommunicationsManager events={events} initialCampaigns={campaigns} initialEventId={eventId} />
      </main>
    </AdminLayout>
  );
}
