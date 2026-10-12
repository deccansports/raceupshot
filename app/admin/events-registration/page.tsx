import { AdminLayout } from "@/components/admin-layout";
import { EventsRegistrationHub } from "@/components/events-registration-hub";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { getCertificateTemplates, getEvents, getResults } from "@/lib/raceupshot-repository";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function EventsRegistrationPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const requestedTab = (await searchParams).tab;
  const validTabs = ["overview", "event_info", "participants", "results", "partners", "sponsors", "certificates", "bib_print", "imports"] as const;
  const initialTab = validTabs.find((tab) => tab === requestedTab) || "overview";
  if (!await isAdminAuthenticated()) redirect("/admin/login");
  let events;
  try {
    events = await getEvents({ includeUnpublished: true });
  } catch {
    return <AdminLayout><main className="admin-content"><section className="admin-card" role="alert">
      <div className="admin-card-head"><div><h1>Events are temporarily unavailable</h1><p>The event list could not be loaded from Cloudflare KV. Your event data has not been changed.</p></div></div>
      <form method="get" action="/admin/events-registration"><input type="hidden" name="tab" value={initialTab} /><button type="submit" className="button button-primary">Retry loading events</button></form>
    </section></main></AdminLayout>;
  }
  const needsResults = ["overview", "results", "certificates", "imports"].includes(initialTab);
  const needsTemplates = initialTab === "certificates";
  const [templateResult, resultRows] = await Promise.all([
    needsTemplates ? getCertificateTemplates().then((value) => ({ ok: true as const, value })).catch(() => ({ ok: false as const, value: [] })) : Promise.resolve({ ok: true as const, value: [] }),
    needsResults ? Promise.allSettled(events.map((event) => getResults(event.slug))) : Promise.resolve([]),
  ]);
  const results = Object.fromEntries(events.map((event, index) => {
    const result = resultRows[index];
    return [event.slug, result?.status === "fulfilled" ? result.value.athletes : []];
  }));
  const failedResultReads = resultRows.filter((result) => result.status === "rejected").length;
  const loadWarning = failedResultReads || !templateResult.ok
    ? `Some Cloudflare KV data could not be loaded (${failedResultReads} result set${failedResultReads === 1 ? "" : "s"}${!templateResult.ok ? ", certificate templates" : ""}). Refresh this tab after the local KV connection recovers.`
    : "";
  return <AdminLayout><main className="admin-content"><EventsRegistrationHub events={events} results={results} templates={templateResult.value} initialTab={initialTab} loadWarning={loadWarning} /></main></AdminLayout>;
}
