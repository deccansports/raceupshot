import { AdminLayout } from "@/components/admin-layout";
import { CampaignCommunicationsManager } from "@/components/campaign-communications-manager";
import { listCommunicationCampaigns } from "@/lib/communication-campaigns";
import { getEvents } from "@/lib/raceupshot-repository";
import { listWhatsAppCampaigns } from "@/lib/whatsapp-campaigns";

export const dynamic = "force-dynamic";

export default async function AdminCommunicationsPage({ searchParams }: { searchParams: Promise<{ eventId?: string }> }) {
  const [{ eventId = "" }, events, campaigns, whatsAppCampaigns] = await Promise.all([
    searchParams,
    getEvents({ includeUnpublished: true }),
    listCommunicationCampaigns(),
    listWhatsAppCampaigns(),
  ]);
  return (
    <AdminLayout>
      <main className="admin-content">
        <div className="admin-title"><div><h1>Communications</h1><p>Send event updates and promotional messages to a precisely filtered audience.</p></div></div>
        <CampaignCommunicationsManager events={events} initialCampaigns={campaigns} initialWhatsAppCampaigns={whatsAppCampaigns} initialEventId={eventId} />
      </main>
    </AdminLayout>
  );
}
