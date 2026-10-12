import { AdminLayout } from "@/components/admin-layout";
import { CertificateAdmin } from "@/components/certificate-admin";
import { getCertificateTemplates, getEvents, getResults } from "@/lib/raceupshot-repository";

export const dynamic = "force-dynamic";

export default async function CertificatesAdminPage() {
  const events = await getEvents({ includeUnpublished: true });
  const [templates, resultSets] = await Promise.all([
    getCertificateTemplates(),
    Promise.all(events.filter((event) => event.hasResults).map((event) => getResults(event.slug))),
  ]);
  return (
    <AdminLayout>
      <main className="admin-content">
        <div className="admin-title"><div><h1>Certificates</h1><p>Generate verified certificates only after official result publication.</p></div></div>
        <CertificateAdmin events={events} athletes={resultSets.flatMap((set) => set.athletes)} templates={templates} />
      </main>
    </AdminLayout>
  );
}
