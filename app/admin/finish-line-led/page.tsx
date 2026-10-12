import { AdminLayout } from "@/components/admin-layout";
import { FinishLineLedAdmin } from "@/components/finish-line-led-admin";
import { getEvents } from "@/lib/raceupshot-repository";

export const dynamic = "force-dynamic";

export default async function AdminFinishLineLedPage() {
  const events = await getEvents({ includeUnpublished: true });
  return (
    <AdminLayout>
      <main className="admin-content">
        <FinishLineLedAdmin events={events.map((event) => ({
          id: event.id,
          name: event.name,
          date: event.date,
          location: event.location,
        }))} />
      </main>
    </AdminLayout>
  );
}
