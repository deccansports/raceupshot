import { AdminLayout } from "@/components/admin-layout";
import { getEvents } from "@/lib/raceupshot-repository";
import { Activity, Database, ShieldCheck } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminSystemHealthPage() {
  const events = await getEvents({ includeUnpublished: true });
  return (
    <AdminLayout>
      <main className="admin-content">
        <div className="admin-title"><div><h1>System health</h1><p>Current application and Worker storage status.</p></div></div>
        <div className="admin-stat-grid">
          <div className="admin-stat"><Activity /><span>APPLICATION</span><strong>Healthy</strong><small>Next.js Worker responding</small></div>
          <div className="admin-stat"><Database /><span>RACEUPSHOT KV</span><strong>Bound</strong><small>{events.length} event{events.length === 1 ? "" : "s"} readable</small></div>
          <div className="admin-stat"><ShieldCheck /><span>ADMIN SESSION</span><strong>Verified</strong><small>Protected route access active</small></div>
        </div>
      </main>
    </AdminLayout>
  );
}
