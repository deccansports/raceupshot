"use client";

import type { StoredCertificateTemplate } from "@/lib/certificate-storage";
import type { Athlete, RaceEvent } from "@/lib/types";
import { BadgeCheck, FileBadge2, RefreshCw, ShieldX } from "lucide-react";
import { CertificateDesigner } from "./certificate-designer";

export function CertificateAdmin({
  events,
  athletes,
  templates,
}: {
  events: RaceEvent[];
  athletes: Athlete[];
  templates: StoredCertificateTemplate[];
}) {
  const eligible = athletes.filter((athlete) => athlete.status.toLowerCase() === "finished");
  const issued = eligible.filter((athlete) => athlete.verificationCode && athlete.certificateUrl);
  return (
    <>
      <div className="admin-kpis">
        <article className="kpi-card"><FileBadge2 /><span>ELIGIBLE FINISHERS</span><strong>{eligible.length.toLocaleString()}</strong><small>Real finished results</small></article>
        <article className="kpi-card"><BadgeCheck /><span>CERTIFICATES ISSUED</span><strong>{issued.length.toLocaleString()}</strong><small>Verification code + URL stored</small></article>
        <article className="kpi-card"><RefreshCw /><span>TEMPLATES</span><strong>{templates.length.toLocaleString()}</strong><small>Category templates in KV</small></article>
        <article className="kpi-card"><ShieldX /><span>REVOKED</span><strong>—</strong><small>No revocation index configured</small></article>
      </div>
      <section className="admin-card" style={{ marginTop: 16 }}>
        <div className="admin-card-head"><h2>Certificate publication status</h2><span className="status-pill">Worker data</span></div>
        <p style={{ color: "var(--muted)", lineHeight: 1.7 }}>
          Download buttons appear on public results only when a result record contains both a verification code and a certificate URL. No certificate is fabricated in the frontend.
        </p>
      </section>
      <div style={{ marginTop: 16 }}><CertificateDesigner events={events} initialTemplates={templates} /></div>
    </>
  );
}
