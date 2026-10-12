"use client";

import type { StoredCertificateTemplate } from "@/lib/certificate-storage";
import type { Athlete, RaceEvent } from "@/lib/types";
import { BadgeDollarSign, BookOpen, FileBadge2, FileSpreadsheet, Handshake, Info, Printer, Trophy, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { CertificateAdmin } from "./certificate-admin";
import { EventManager } from "./event-manager";
import { EventPartnersAdmin } from "./event-partners-admin";
import { ParticipantManagementAdmin } from "./participant-management-admin";
import { PublishResults } from "./publish-results";
import { SponsorManagementAdmin } from "./sponsor-management-admin";
import { BibStickerPrintAdmin } from "./bib-sticker-print-admin";

const tabs = [
  ["overview", "Overview", BookOpen], ["event_info", "Event Info", Info], ["participants", "Participants", Users],
  ["results", "Results", Trophy], ["partners", "Partners", Handshake], ["sponsors", "Sponsors", BadgeDollarSign], ["certificates", "Certificates", FileBadge2], ["bib_print", "BIB & Sticker Print", Printer], ["imports", "Bulk Upload", FileSpreadsheet],
] as const;
type Tab = typeof tabs[number][0];

export function EventsRegistrationHub({ events, results, templates, initialTab = "overview", loadWarning = "" }: { events: RaceEvent[]; results: Record<string, Athlete[]>; templates: StoredCertificateTemplate[]; initialTab?: Tab; loadWarning?: string }) {
  const router = useRouter();
  const tab = initialTab;
  const athletes = Object.values(results).flat();
  const finished = athletes.filter((athlete) => athlete.status.toLowerCase() === "finished");
  return <div className="events-registration-hub">
    <div className="admin-title"><div><h1>Events & Registration</h1><p>Create events, manage registration destinations, partners, participants, official results and certificates.</p></div></div>
    <div className="registration-tabs" role="tablist">{tabs.map(([id,label,Icon]) => <button key={id} type="button" role="tab" className={tab === id ? "active" : ""} aria-selected={tab === id} onClick={() => router.replace(`/admin/events-registration?tab=${id}`)}><Icon /> {label}</button>)}</div>
    {loadWarning && <div className="error-banner">{loadWarning}</div>}
    {tab === "overview" && <><div className="admin-kpis"><article className="kpi-card"><BookOpen /><span>EVENTS</span><strong>{events.length}</strong><small>All Worker records</small></article><article className="kpi-card"><Users /><span>PARTICIPANTS</span><strong>{events.reduce((sum,event) => sum + event.participants, 0)}</strong><small>Event totals</small></article><article className="kpi-card"><Trophy /><span>RESULT ROWS</span><strong>{athletes.length}</strong><small>Published in KV</small></article><article className="kpi-card"><FileBadge2 /><span>FINISHERS</span><strong>{finished.length}</strong><small>Certificate eligible</small></article></div><section className="admin-card hub-overview-list"><div className="admin-card-head"><h2>Event overview</h2><span className="status-pill">{events.length} events</span></div><div className="managed-event-list">{events.map((event) => <article className="managed-event-row" key={event.id}><div className="event-list-code">{event.shortCode}</div><div className="event-list-copy"><div><h3>{event.name}</h3><span className="status-pill">{event.status}</span></div><p>{event.date} · {event.location} · {event.participants} participants</p><small>{event.registrationUrl ? `Registration: ${event.registrationUrl}` : "Registration URL not configured"}</small></div></article>)}</div></section></>}
    {tab === "event_info" && <EventManager initialEvents={events} />}
    {tab === "participants" && <ParticipantManagementAdmin events={events} />}
    {tab === "results" && <PublishResults events={events} resultSets={results} />}
    {tab === "partners" && <EventPartnersAdmin events={events} />}
    {tab === "sponsors" && <SponsorManagementAdmin events={events} />}
    {tab === "certificates" && <CertificateAdmin events={events} athletes={athletes} templates={templates} />}
    {tab === "bib_print" && <BibStickerPrintAdmin events={events} />}
    {tab === "imports" && <><div className="success-banner"><FileSpreadsheet /> Result CSV/XLSX files are validated, category-mapped and written through the authenticated Worker endpoint.</div><PublishResults events={events} resultSets={results} /></>}
  </div>;
}
