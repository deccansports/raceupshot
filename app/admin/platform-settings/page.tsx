import { AdminLayout } from "@/components/admin-layout";
import { Settings } from "lucide-react";

export const dynamic = "force-dynamic";

export default function AdminSettingsPage() {
  return (
    <AdminLayout>
      <main className="admin-content">
        <div className="admin-title"><div><h1>Settings</h1><p>Platform-wide administrative configuration.</p></div></div>
        <section className="admin-card">
          <div className="admin-card-head"><h2><Settings /> Race Upshot platform</h2><span className="status-pill">Production</span></div>
          <div className="metric-grid">
            <div><span>ADMIN ACCOUNT</span><strong>info@raceupshot.com</strong></div>
            <div><span>STORAGE</span><strong>RACEUPSHOT KV</strong></div>
            <div><span>DEPLOYMENT</span><strong>Cloudflare Worker</strong></div>
          </div>
        </section>
      </main>
    </AdminLayout>
  );
}
