import { AdminLayout } from "@/components/admin-layout";
import { PublishResults } from "@/components/publish-results";
import { getEvents, getResults } from "@/lib/raceupshot-repository";

export const dynamic = "force-dynamic";

export default async function ResultsAdminPage() {
  const events = await getEvents({ includeUnpublished: true });
  const sets = await Promise.all(events.map((event) => getResults(event.slug)));
  const resultSets = Object.fromEntries(sets.filter((set) => set.event).map((set) => [set.event!.slug, set.athletes]));
  return <AdminLayout><main className="admin-content"><div className="admin-title"><div><h1>Result publishing</h1><p>Review race integrity from the records currently stored in Workers KV.</p></div></div><PublishResults events={events} resultSets={resultSets} /></main></AdminLayout>;
}
