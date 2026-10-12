"use client";

import type { AuditEntry } from "@/lib/types";
import { Download, Search, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";

export function AuditLog({ entries }: { entries: AuditEntry[] }) {
  const [query, setQuery] = useState("");
  const [action, setAction] = useState("All actions");
  const filtered = useMemo(() => entries.filter((entry) => {
    const matchesQuery = `${entry.actor} ${entry.action} ${entry.entity}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (action === "All actions" || entry.action.includes(action));
  }), [query, action, entries]);

  return (
    <section className="admin-card">
      <div className="audit-filters">
        <label><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search user, action or entity" /></label>
        <select value={action} onChange={(event) => setAction(event.target.value)}><option>All actions</option><option>RESULT</option><option>IMPORT</option><option>ROLE</option><option>CERTIFICATE</option></select>
        <button className="button button-secondary"><Download /> Export CSV</button>
      </div>
      <div className="audit-integrity"><ShieldCheck /> Append-only audit history · before/after values, IP address and user agent retained server-side</div>
      <table className="leaderboard audit-table">
        <thead><tr><th>TIME</th><th>ACTOR</th><th>ACTION</th><th>ENTITY</th><th>IP ADDRESS</th><th>INTEGRITY</th></tr></thead>
        <tbody>{filtered.map((entry) => <tr key={entry.id}>
          <td className="time">{entry.time}</td><td><b>{entry.actor}</b></td><td><span className={`status-pill ${entry.severity === "warning" ? "status-provisional" : entry.severity === "critical" ? "status-upcoming" : "status-official"}`}>{entry.action}</span></td><td>{entry.entity}</td><td className="time">{entry.ip}</td><td><ShieldCheck size={15} color="#4b941d" /></td>
        </tr>)}</tbody>
      </table>
      {!filtered.length && <p style={{ color: "var(--muted)", textAlign: "center", padding: 30 }}>No audit entries match these filters.</p>}
    </section>
  );
}
