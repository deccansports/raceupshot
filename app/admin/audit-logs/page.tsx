import { AdminLayout } from "@/components/admin-layout";
import { AuditLog } from "@/components/audit-log";
import { getAuditEntries } from "@/lib/raceupshot-repository";

export const dynamic = "force-dynamic";

export default async function AuditLogsPage() {
  const entries = await getAuditEntries();
  return (
    <AdminLayout>
      <main className="admin-content">
        <div className="admin-title"><div><h1>Audit logs</h1><p>Trace every privileged change across events, imports, results, roles and certificates.</p></div></div>
        <AuditLog entries={entries} />
      </main>
    </AdminLayout>
  );
}
