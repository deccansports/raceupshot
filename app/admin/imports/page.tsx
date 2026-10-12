import { AdminLayout } from "@/components/admin-layout";
import { ImportFlow } from "@/components/import-flow";
import { getEvents } from "@/lib/raceupshot-repository";

export const dynamic = "force-dynamic";

export default async function ImportsPage() {
  const events = await getEvents({ includeUnpublished: true });
  return <AdminLayout><main className="admin-content"><div className="admin-title"><div><h1>Participant import</h1><p>Upload an event roster and link each athlete’s chip code and athlete band to their BIB for volunteer scanning.</p></div></div><ImportFlow events={events} /></main></AdminLayout>;
}
