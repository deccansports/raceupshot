import { AdminLayout } from "@/components/admin-layout";
import { DashboardChart } from "@/components/dashboard-chart";
import { getAuditEntries, getEvents } from "@/lib/raceupshot-repository";
import { Activity, BadgeCheck, CalendarDays, CircleCheck, Medal, Radio, Users, Zap } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const events = await getEvents({ includeUnpublished: true });
  const indexedResults = events.reduce((total, event) => total + event.participants, 0);
  const eventsWithResults = events.filter((event) => event.hasResults).length;
  const audits = await getAuditEntries(12);
  const kpis = [
    [CalendarDays, "Total events", events.length.toLocaleString(), `${events.filter((event) => event.status === "draft").length} drafts`],
    [Radio, "Live events", String(events.filter((event) => event.status === "live").length).padStart(2, "0"), "Worker status"],
    [Users, "Indexed results", indexedResults.toLocaleString(), "Result index records"],
    [Medal, "Result sets", eventsWithResults.toLocaleString(), "Events with published results"],
  ] as const;
  const monthly = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(2026, index, 1);
    const month = new Intl.DateTimeFormat("en", { month: "short" }).format(date);
    const participants = events
      .filter((event) => new Date(event.dateIso).getMonth() === index)
      .reduce((total, event) => total + event.participants, 0);
    return { month, participants };
  });
  return (
    <AdminLayout>
      <main className="admin-content">
        <div className="admin-title">
          <div><h1>Control centre</h1><p>{new Intl.DateTimeFormat("en-IN", { dateStyle: "full", timeZone: "Asia/Kolkata" }).format(new Date())} · Worker operations overview</p></div>
          <Link href="/admin/events-registration?tab=event_info" className="button button-primary">+ Create event</Link>
        </div>
        <div className="admin-kpis">
          {kpis.map(([Icon, label, value, note]) => <article className="kpi-card" key={label}><Icon /><span>{label}</span><strong>{value}</strong><small>{note}</small></article>)}
        </div>
        <section className="admin-card admin-system-card">
          <div className="admin-card-head"><h2>Timing infrastructure</h2><span className="status-pill status-official"><i className="pulse-dot" /> Admin only</span></div>
          <div className="timing-system">
            <div className="system-head"><span>LIVE SYSTEM</span><b><i /> ALL SERVICES OPERATIONAL</b></div>
            <div className="system-line">
              <div><Radio /><span>RFID READERS<small>12 connected</small></span></div>
              <i />
              <div><Zap /><span>EDGE PROCESSING<small>34 ms latency</small></span></div>
              <i />
              <div><BadgeCheck /><span>RESULT ENGINE<small>Verified</small></span></div>
            </div>
            <div className="system-console">
              <span>WORKER</span><b>BOUND</b><strong>RACEUPSHOT</strong><span>EVENTS</span><em>{events.length}</em>
              <span>RESULTS</span><b>INDEXED</b><strong>{indexedResults}</strong><span>STORAGE</span><em>KV</em>
              <span>PUBLIC</span><b>SYNC</b><strong>EDGE</strong><span>STATUS</span><em>OK</em>
            </div>
          </div>
        </section>
        <div className="admin-grid">
          <section className="admin-card">
            <div className="admin-card-head"><h2>Participants by event month</h2><span className="status-pill">2026</span></div>
            <DashboardChart data={monthly} />
          </section>
          <section className="admin-card">
            <div className="admin-card-head"><h2>Live operations</h2><span className="status-pill status-live"><i className="pulse-dot" /> Live</span></div>
            <div className="metric-grid">
              <div><span>EVENT RECORDS</span><strong>{events.length}</strong></div><div><span>RESULT RECORDS</span><strong>{indexedResults}</strong></div>
              <div><span>AUDIT RECORDS</span><strong>{audits.length}</strong></div><div><span>KV BINDING</span><strong>RACEUPSHOT</strong></div>
            </div>
            <Link href="/live" className="button button-secondary" style={{ width: "100%", marginTop: 25 }}>Open live control</Link>
          </section>
          <section className="admin-card">
            <div className="admin-card-head"><h2>Recent activity</h2><span className="updated"><Activity size={12} /> AUDIT STREAM</span></div>
            <div className="activity-list">
              {audits.slice(0, 4).map((entry) => <div className="activity-item" key={entry.id}><i className="activity-icon"><CircleCheck /></i><b>{entry.action} · {entry.entity}</b><span>{entry.time}</span></div>)}
              {!audits.length && <p className="admin-empty">No audit records are stored.</p>}
            </div>
          </section>
          <section className="admin-card">
            <div className="admin-card-head"><h2>System health</h2><span className="status-pill status-official">Healthy</span></div>
            <div className="activity-list">
              {["Next.js Worker API", "RACEUPSHOT KV", "Static assets"].map((item) => <div className="activity-item" key={item}><i className="activity-icon"><CircleCheck /></i><b>{item}</b><span>CONNECTED</span></div>)}
            </div>
          </section>
        </div>
      </main>
    </AdminLayout>
  );
}
