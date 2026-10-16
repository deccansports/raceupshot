"use client";

import type { RaceEvent } from "@/lib/types";
import { eventEditorDate, eventEditorTime } from "@/lib/event-editor-values";
import { BookOpen, CalendarDays, Crop, Eye, FileText, ImageIcon, Map, MapPin, Megaphone, Pencil, Radio, Rocket, RotateCcw, Save, Trash2, UploadCloud, X, ZoomIn, ZoomOut } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { ChangeEvent, useMemo, useState } from "react";
import { CategoryForm } from "./category-form";
import { cropEventImage, EventForm, type EventFormData } from "./event-form";
import { WaiverParameterPicker } from "./waiver-parameter-picker";
import { appendWaiverTemplateParameter, waiverTemplateSrcDoc } from "@/lib/waiver-template";
import { WaiverParameterMappingEditor } from "./waiver-parameter-mapping-editor";

interface ManagedEvent extends EventFormData {
  id: string;
  status: "draft" | "upcoming" | "live" | "completed" | "official" | "provisional" | "archived";
  logoSourceData?: string;
  bannerSourceData?: string;
  logoCropHorizontal?: number;
  logoCropVertical?: number;
  logoCropZoom?: number;
  bannerCropHorizontal?: number;
  bannerCropVertical?: number;
  bannerCropZoom?: number;
  guidebookName?: string;
  endsAt?: string;
}

interface EventConflict {
  id: string;
  name: string;
  slug: string;
  status: ManagedEvent["status"];
}

class EventRequestError extends Error {
  conflict?: EventConflict;

  constructor(message: string, conflict?: EventConflict) {
    super(message);
    this.name = "EventRequestError";
    this.conflict = conflict;
  }
}

function toManagedEvent(event: RaceEvent): ManagedEvent {
  return {
  id: event.id,
  name: event.name,
  slug: event.slug,
  sport: event.sport,
  date: eventEditorDate(event.dateIso),
  startTime: eventEditorTime(event.startTime, event.dateIso),
  endsAt: event.endsAt,
  city: event.city,
  venue: event.venue,
  venueAddress: event.venueAddress ?? "",
  organizerAddress: event.organizerAddress ?? "",
  jurisdiction: event.jurisdiction ?? "",
  organizer: event.organizer ?? "",
  companyDescription: event.companyDescription ?? "",
  contactEmail: event.contactEmail ?? "",
  contactPhone: event.contactPhone ?? "",
  websiteUrl: event.websiteUrl ?? "",
  registrationUrl: event.registrationUrl ?? "",
  knowMoreUrl: event.knowMoreUrl ?? "",
  broadcastUrl: event.broadcastUrl ?? "",
  rulesUrl: event.rulesUrl ?? "",
  rulesHtml: event.rulesHtml ?? "",
  waiverHtml: event.waiverHtml ?? "",
  waiverVersion: event.waiverVersion ?? "",
  waiverPolicy: event.waiverPolicy ?? {
    consolidatedWaiverEnabled: false, allowMultipleRegistrationsPerParticipant: true, allowDuplicateEmailAddresses: true,
    waiverCoverage: "PER_REGISTRATION", requireSeparateWaiverForDifferentEvents: true, requireSeparateWaiverForDifferentDisciplines: false,
    allowCheckInBeforeScheduledSession: false, allowCheckInAll: false, requireGuardianSignatureForMinors: true,
  },
  waiverParameterMappings: event.waiverParameterMappings ?? [],
  athleteGuidebookUrl: event.athleteGuidebookUrl ?? "",
  athleteGuidebookData: "",
  latitude: event.latitude ?? "",
  longitude: event.longitude ?? "",
  description: event.description,
  status: event.status,
  logoData: event.logoUrl,
  bannerData: event.bannerUrl,
  categories: event.categories,
  ticketDefinitions: event.ticketDefinitions ?? [],
  };
}

export function EventManager({ initialEvents }: { initialEvents: RaceEvent[] }) {
  const [events, setEvents] = useState<ManagedEvent[]>(initialEvents.map(toManagedEvent));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ManagedEvent | null>(null);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState<EventConflict | null>(null);
  const [slugSuggestion, setSlugSuggestion] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [selectedPastEventId, setSelectedPastEventId] = useState("");
  const draftEvents = useMemo(() => events.filter((event) => event.status === "draft"), [events]);
  const pastEvents = useMemo(() => events
    .filter((event) => ["completed", "official", "provisional", "archived"].includes(event.status))
    .sort((left, right) => right.date.localeCompare(left.date)), [events]);
  const upcomingEvents = useMemo(() => events
    .filter((event) => !pastEvents.some((past) => past.id === event.id))
    .sort((left, right) => left.date.localeCompare(right.date)), [events, pastEvents]);
  const selectedPastEvent = pastEvents.find((event) => event.id === selectedPastEventId);
  const visibleEvents = selectedPastEvent ? [...upcomingEvents, selectedPastEvent] : upcomingEvents;
  const availableSlug = useMemo(() => {
    if (!conflict) return "";
    const used = new Set(events.map((event) => event.slug.trim().toLowerCase()));
    let suffix = 2;
    let candidate = `${conflict.slug}-${suffix}`;
    while (used.has(candidate)) {
      suffix += 1;
      candidate = `${conflict.slug}-${suffix}`;
    }
    return candidate;
  }, [conflict, events]);

  async function request<T>(url: string, init: RequestInit): Promise<T> {
    const response = await fetch(url, { ...init, headers: { "content-type": "application/json", ...init.headers } });
    const payload = await response.json() as { ok: boolean; data?: T; error?: string; conflict?: EventConflict };
    if (!response.ok || !payload.ok || payload.data === undefined) throw new EventRequestError(payload.error || "Worker request failed", payload.conflict);
    return payload.data;
  }

  async function addEvent(data: EventFormData) {
    setSaving(true);
    setError("");
    setConflict(null);
    try {
      const event = await request<RaceEvent>("/api/admin/events", { method: "POST", body: JSON.stringify(data) });
      setEvents((current) => [toManagedEvent(event), ...current]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create event");
      setConflict(reason instanceof EventRequestError ? reason.conflict ?? null : null);
      throw reason;
    } finally {
      setSaving(false);
    }
    window.setTimeout(() => document.getElementById("managed-events")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  function startEditing(event: ManagedEvent) {
    setEditingId(event.id);
    setDraft({
      ...event,
      logoSourceData: event.logoData,
      bannerSourceData: event.bannerData,
      logoCropHorizontal: 50,
      logoCropVertical: 50,
      logoCropZoom: 1,
      bannerCropHorizontal: 50,
      bannerCropVertical: 50,
      bannerCropZoom: 1,
    });
  }

  async function saveEditing() {
    if (!draft) return;
    setSaving(true);
    setError("");
    setConflict(null);
    try {
      const payload: ManagedEvent = { ...draft };
      if (draft.logoSourceData) {
        payload.logoData = await cropEventImage({
          source: draft.logoSourceData,
          width: 800,
          height: 800,
          horizontal: draft.logoCropHorizontal ?? 50,
          vertical: draft.logoCropVertical ?? 50,
          zoom: draft.logoCropZoom ?? 1,
          format: "image/png",
        });
      }
      if (draft.bannerSourceData) {
        payload.bannerData = await cropEventImage({
          source: draft.bannerSourceData,
          width: 1600,
          height: 600,
          horizontal: draft.bannerCropHorizontal ?? 50,
          vertical: draft.bannerCropVertical ?? 50,
          zoom: draft.bannerCropZoom ?? 1,
          format: "image/jpeg",
        });
      }
      const updated = await request<RaceEvent>(`/api/admin/events/${encodeURIComponent(draft.id)}`, { method: "PATCH", body: JSON.stringify(payload) });
      setEvents((current) => current.map((event) => event.id === draft.id ? toManagedEvent(updated) : event));
      setMessage(
        `“${updated.name}” saved. Rules: ${updated.rulesHtml || updated.rulesUrl ? "published" : "not published"} · Waiver: ${updated.waiverHtml ? "configured" : "not configured"} · Athlete guidebook: ${updated.athleteGuidebookUrl ? "published" : "not published"}.`,
      );
      setEditingId(null);
      setDraft(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update event");
      setConflict(reason instanceof EventRequestError ? reason.conflict ?? null : null);
    } finally {
      setSaving(false);
    }
  }

  async function removeEvent(event: ManagedEvent) {
    if (!window.confirm(`Permanently delete “${event.name}” and its results, course maps, live settings and event data? This cannot be undone.`)) return;
    setSaving(true);
    try {
      await request<{ deleted: boolean }>(`/api/admin/events/${encodeURIComponent(event.id)}`, { method: "DELETE" });
      setEvents((current) => current.filter((item) => item.id !== event.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to delete event");
    } finally {
      setSaving(false);
    }
  }

  async function publishManagedEvent(event: ManagedEvent) {
    if (!window.confirm(`Publish “${event.name}” on the public Events page?`)) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const published = await request<RaceEvent>(`/api/admin/events/${encodeURIComponent(event.id)}`, {
        method: "POST",
        body: JSON.stringify({ action: "publish" }),
      });
      setEvents((current) => current.map((item) => item.id === event.id ? toManagedEvent(published) : item));
      setMessage(`“${published.name}” is published and available on the public event page.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to publish event");
    } finally {
      setSaving(false);
    }
  }

  function updateImage(event: ChangeEvent<HTMLInputElement>, type: "logo" | "banner") {
    const file = event.target.files?.[0];
    if (!file || !draft) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      window.alert("Use a PNG, JPG or WebP image.");
      return;
    }
    const maximum = type === "logo" ? 800_000 : 1_500_000;
    if (file.size > maximum) {
      window.alert(`${type === "logo" ? "Logo" : "Banner"} is too large.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setDraft((current) => current ? {
      ...current,
      [`${type}Name`]: file.name,
      [`${type}Data`]: String(reader.result),
      [`${type}SourceData`]: String(reader.result),
      [`${type}CropHorizontal`]: 50,
      [`${type}CropVertical`]: 50,
      [`${type}CropZoom`]: 1,
    } : current);
    reader.readAsDataURL(file);
  }

  function updateGuidebook(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !draft) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      window.alert("Use a PDF athlete guidebook.");
      return;
    }
    if (file.size > 5_000_000) {
      window.alert("Athlete guidebook must be smaller than 5 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setDraft((current) => current ? {
      ...current,
      guidebookName: file.name,
      athleteGuidebookData: String(reader.result),
      athleteGuidebookUrl: "",
    } : current);
    reader.onerror = () => window.alert("The athlete guidebook could not be read.");
    reader.readAsDataURL(file);
  }

  function updateImageCrop(type: "logo" | "banner", values: { horizontal?: number; vertical?: number; zoom?: number }) {
    setDraft((current) => {
      if (!current) return current;
      if (type === "logo") {
        return {
          ...current,
          logoCropHorizontal: values.horizontal ?? current.logoCropHorizontal,
          logoCropVertical: values.vertical ?? current.logoCropVertical,
          logoCropZoom: values.zoom ?? current.logoCropZoom,
        };
      }
      return {
        ...current,
        bannerCropHorizontal: values.horizontal ?? current.bannerCropHorizontal,
        bannerCropVertical: values.vertical ?? current.bannerCropVertical,
        bannerCropZoom: values.zoom ?? current.bannerCropZoom,
      };
    });
  }

  function imageCropControls(type: "logo" | "banner") {
    if (!draft) return null;
    const horizontal = type === "logo" ? draft.logoCropHorizontal ?? 50 : draft.bannerCropHorizontal ?? 50;
    const vertical = type === "logo" ? draft.logoCropVertical ?? 50 : draft.bannerCropVertical ?? 50;
    const zoom = type === "logo" ? draft.logoCropZoom ?? 1 : draft.bannerCropZoom ?? 1;
    return (
      <div className="banner-crop-controls">
        <div className="banner-crop-title"><span><Crop /> {type === "logo" ? "Logo crop, position and zoom" : "Banner crop, position and zoom"}</span><small>{type === "logo" ? "Recommended 800 × 800 px · square" : "Recommended 1600 × 600 px · 8:3"}</small></div>
        <label><span>Horizontal</span><input type="range" min="0" max="100" value={horizontal} onChange={(event) => updateImageCrop(type, { horizontal: Number(event.target.value) })} /></label>
        <label><span>Vertical</span><input type="range" min="0" max="100" value={vertical} onChange={(event) => updateImageCrop(type, { vertical: Number(event.target.value) })} /></label>
        <label className="crop-zoom-row">
          <span>Zoom</span>
          <button type="button" aria-label={`Zoom out ${type}`} onClick={() => updateImageCrop(type, { zoom: Math.max(1, zoom - 0.1) })}><ZoomOut /></button>
          <input type="range" min="100" max="250" value={Math.round(zoom * 100)} onChange={(event) => updateImageCrop(type, { zoom: Number(event.target.value) / 100 })} />
          <button type="button" aria-label={`Zoom in ${type}`} onClick={() => updateImageCrop(type, { zoom: Math.min(2.5, zoom + 0.1) })}><ZoomIn /></button>
        </label>
        <button type="button" className="crop-reset-button" onClick={() => updateImageCrop(type, { horizontal: 50, vertical: 50, zoom: 1 })}><RotateCcw /> Fit full image · {Math.round(zoom * 100)}%</button>
      </div>
    );
  }

  return (
    <>
      <section className="admin-card managed-events" id="managed-events">
        <div className="admin-card-head">
          <div><h2>Created events</h2><p>{draftEvents.length} draft event{draftEvents.length === 1 ? "" : "s"} in RACEUPSHOT KV</p></div>
          <span className="status-pill">{events.length} total</span>
        </div>
        {pastEvents.length > 0 && <div className="managed-event-filter">
          <label htmlFor="past-event-select"><span>Past events</span><select id="past-event-select" value={selectedPastEventId} onChange={(event) => setSelectedPastEventId(event.target.value)}><option value="">Select a past event</option>{pastEvents.map((event) => <option value={event.id} key={event.id}>{event.name} · {event.date}</option>)}</select></label>
          <small>{upcomingEvents.length} upcoming · {pastEvents.length} past</small>
        </div>}
        {error && <div className="success-banner event-conflict-banner" style={{ background: "#fff0f0", color: "#9d2525" }}>
          <span>{error}</span>
          {conflict && (
            <div className="event-conflict-actions">
              {events.some((event) => event.id === conflict.id) && (
              <button className="button" onClick={() => {
                const existing = events.find((event) => event.id === conflict.id);
                if (existing) {
                  startEditing(existing);
                  window.setTimeout(() => document.getElementById(`event-${existing.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 20);
                }
              }}><Pencil /> Edit “{conflict.name}”</button>
              )}
              <button className="button" onClick={() => {
                setSlugSuggestion(availableSlug);
                document.getElementById("create-event-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
                window.setTimeout(() => document.getElementById("new-event-slug")?.focus(), 250);
              }}>Use “{availableSlug}”</button>
            </div>
          )}
        </div>}
        {message && <div className="success-banner">{message}</div>}
        {!events.length ? <p className="admin-empty">No events are stored in the Worker namespace.</p> : (
          <div className="managed-event-list">
            {visibleEvents.map((event) => {
              const editing = editingId === event.id && draft;
              return (
                <article className="managed-event-row" id={`event-${event.id}`} key={event.id}>
                  {editing ? (
                    <div className="event-edit-panel">
                      <div className="event-edit-media">
                        <label className="event-edit-image logo">
                          {draft.logoData ? <Image
                            src={draft.logoSourceData ?? draft.logoData}
                            alt="Event logo preview"
                            fill
                            sizes="220px"
                            style={{
                              objectFit: "contain",
                              objectPosition: `${draft.logoCropHorizontal ?? 50}% ${draft.logoCropVertical ?? 50}%`,
                              transform: `scale(${draft.logoCropZoom ?? 1})`,
                              transformOrigin: `${draft.logoCropHorizontal ?? 50}% ${draft.logoCropVertical ?? 50}%`,
                            }}
                          /> : <><ImageIcon /><span>Logo</span></>}
                          <input className="event-file-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => updateImage(event, "logo")} />
                        </label>
                        <label className="event-edit-image banner">
                          {draft.bannerData ? <Image
                            src={draft.bannerSourceData ?? draft.bannerData}
                            alt="Event banner preview"
                            fill
                            sizes="700px"
                            style={{
                              objectFit: "contain",
                              objectPosition: `${draft.bannerCropHorizontal ?? 50}% ${draft.bannerCropVertical ?? 50}%`,
                              transform: `scale(${draft.bannerCropZoom ?? 1})`,
                              transformOrigin: `${draft.bannerCropHorizontal ?? 50}% ${draft.bannerCropVertical ?? 50}%`,
                            }}
                          /> : <><UploadCloud /><span>Upload banner</span></>}
                          <input className="event-file-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => updateImage(event, "banner")} />
                        </label>
                      </div>
                      <div className="event-edit-crop-grid">
                        {draft.logoData && imageCropControls("logo")}
                        {draft.bannerData && imageCropControls("banner")}
                      </div>
                      <section className="event-fields-section"><h3>Event details</h3><div className="form-grid event-edit-fields">
                        <div className="field"><label>Event name</label><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></div>
                        <div className="field"><label>Event slug</label><input value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value })} /></div>
                        <div className="field"><label>Sport</label><select value={draft.sport} onChange={(e) => setDraft({ ...draft, sport: e.target.value })}><option>Running</option><option>Triathlon</option><option>Cycling</option><option>Swimming</option></select></div>
                        <div className="field"><label>Event date</label><input type="date" value={draft.date.includes("-") ? draft.date : ""} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></div>
                        <div className="field"><label>Start time</label><input type="time" value={draft.startTime} onChange={(e) => setDraft({ ...draft, startTime: e.target.value })} /></div>
                        <div className="field"><label>Jurisdiction</label><input placeholder="Country, state or governing jurisdiction" value={draft.jurisdiction} onChange={(e) => setDraft({ ...draft, jurisdiction: e.target.value })} /></div>
                        <div className="field full"><label>Description</label><textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></div>
                      </div></section>
                      <section className="event-fields-section"><h3>Venue details</h3><div className="form-grid event-edit-fields">
                        <div className="field"><label>City</label><input value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })} /></div>
                        <div className="field"><label>Venue</label><input value={draft.venue} onChange={(e) => setDraft({ ...draft, venue: e.target.value })} /></div>
                        <div className="field full"><label>Event venue address</label><textarea rows={2} placeholder="Full address of the event venue" value={draft.venueAddress} onChange={(e) => setDraft({ ...draft, venueAddress: e.target.value })} /></div>
                        <div className="field"><label>Latitude</label><input value={draft.latitude} onChange={(e) => setDraft({ ...draft, latitude: e.target.value })} /></div>
                        <div className="field"><label>Longitude</label><input value={draft.longitude} onChange={(e) => setDraft({ ...draft, longitude: e.target.value })} /></div>
                      </div></section>
                      <section className="event-fields-section"><h3>Organizer details</h3><div className="form-grid event-edit-fields">
                        <div className="field"><label>Organizer</label><input value={draft.organizer} onChange={(e) => setDraft({ ...draft, organizer: e.target.value })} /></div>
                        <div className="field full"><label>Company description</label><textarea rows={3} placeholder="Brief legal or business description of the organizing company" value={draft.companyDescription} onChange={(e) => setDraft({ ...draft, companyDescription: e.target.value })} /></div>
                        <div className="field"><label>Contact email</label><input type="email" value={draft.contactEmail} onChange={(e) => setDraft({ ...draft, contactEmail: e.target.value })} /></div>
                        <div className="field"><label>Contact phone</label><input value={draft.contactPhone} onChange={(e) => setDraft({ ...draft, contactPhone: e.target.value })} /></div>
                        <div className="field full"><label>Organizer address</label><textarea rows={2} placeholder="Registered or mailing address of the organizer" value={draft.organizerAddress} onChange={(e) => setDraft({ ...draft, organizerAddress: e.target.value })} /></div>
                      </div></section>
                      <section className="event-fields-section"><h3>Event links</h3><div className="form-grid event-edit-fields">
                        <div className="field"><label>Event website</label><input value={draft.websiteUrl} onChange={(e) => setDraft({ ...draft, websiteUrl: e.target.value })} /></div>
                        <div className="field"><label>Registration URL</label><input value={draft.registrationUrl} onChange={(e) => setDraft({ ...draft, registrationUrl: e.target.value })} /></div>
                        <div className="field"><label>Know more URL</label><input value={draft.knowMoreUrl} onChange={(e) => setDraft({ ...draft, knowMoreUrl: e.target.value })} /></div>
                        <div className="field"><label>Live broadcast URL</label><input value={draft.broadcastUrl} onChange={(e) => setDraft({ ...draft, broadcastUrl: e.target.value })} /></div>
                      </div></section>
                      <div className="event-document-section compact">
                        <div className="event-document-heading"><BookOpen /><div><h3>Rules &amp; athlete resources</h3><p>These documents appear on the public website and mobile event screen.</p></div></div>
                        <div className="event-document-grid">
                          <div className="event-rules-editor">
                            <div className="field"><label>Rules &amp; regulations · HTML/Text</label><textarea className="rules-html-input" rows={10} value={draft.rulesHtml} onChange={(event) => setDraft({ ...draft, rulesHtml: event.target.value })} /></div>
                            <div className="field"><label>External rules URL · optional fallback</label><input type="url" value={draft.rulesUrl} onChange={(event) => setDraft({ ...draft, rulesUrl: event.target.value })} /></div>
                          </div>
                          <div className="event-rules-preview">
                            <div className="event-document-subhead"><FileText /><span><b>Rules preview</b><small>Sanitized public rendering</small></span></div>
                            {draft.rulesHtml
                              ? <iframe title="Rules preview" sandbox="" srcDoc={draft.rulesHtml} />
                              : <div className="admin-empty">Add rules content to preview it.</div>}
                          </div>
                        </div>
                        <div className="guidebook-upload-grid">
                          <label className={`guidebook-upload ${draft.athleteGuidebookData ? "uploaded" : ""}`}>
                            <UploadCloud />
                            <span><b>{draft.guidebookName || (draft.athleteGuidebookUrl.includes("/media/guidebook") ? "Uploaded athlete guidebook" : "Upload athlete guidebook")}</b><small>PDF only · maximum 5 MB</small></span>
                            <input type="file" accept="application/pdf,.pdf" onChange={updateGuidebook} />
                            {draft.athleteGuidebookData && <button type="button" aria-label="Remove selected guidebook" onClick={(event) => { event.preventDefault(); setDraft({ ...draft, athleteGuidebookData: "", guidebookName: undefined }); }}><X /></button>}
                          </label>
                          <div className="field"><label>Or athlete guidebook URL</label><input type="url" disabled={Boolean(draft.athleteGuidebookData)} value={draft.athleteGuidebookUrl} onChange={(event) => setDraft({ ...draft, athleteGuidebookUrl: event.target.value })} /><small>Upload a replacement PDF or enter a public PDF/web URL.</small></div>
                        </div>
                        <div className="event-document-grid event-waiver-grid">
                          <div className="event-rules-editor">
                            <div className="field"><label>Waiver template · HTML/CSS/Text · optional</label><textarea className="rules-html-input" rows={16} value={draft.waiverHtml} placeholder={'<h2>Waiver & Indemnity Declaration</h2>\n<p>I, <strong>{{name}}</strong>, confirm that…</p>'} onChange={(event) => setDraft({ ...draft, waiverHtml: event.target.value })} /><small>Paste HTML, CSS or mixed formatted text. Both {"{{params.name}}"} and aliases such as {"{{name}}"} are accepted. Unsafe active content is removed when saved.</small></div>
                            <WaiverParameterPicker onInsert={(token) => setDraft({ ...draft, waiverHtml: appendWaiverTemplateParameter(draft.waiverHtml, token) })} />
                            <div className="field"><label>Map waiver parameters for this event</label><WaiverParameterMappingEditor template={draft.waiverHtml} mappings={draft.waiverParameterMappings ?? []} onChange={(waiverParameterMappings) => setDraft({ ...draft, waiverParameterMappings })} /><small>These mappings apply only to this event’s waiver.</small></div>
                            <div className="field"><label>Waiver version · optional</label><input value={draft.waiverVersion} placeholder="e.g. OZAR-2026-v1" onChange={(event) => setDraft({ ...draft, waiverVersion: event.target.value })} /><small>Change the version whenever the legal wording changes.</small></div>
                            <fieldset className="field full"><legend>Registration, waiver and check-in policy</legend>
                              <label><input type="checkbox" checked={draft.waiverPolicy.consolidatedWaiverEnabled} onChange={(event) => setDraft({ ...draft, waiverPolicy: { ...draft.waiverPolicy, consolidatedWaiverEnabled: event.target.checked } })} /> Enable consolidated waiver</label>
                              <label><input type="checkbox" checked={draft.waiverPolicy.allowMultipleRegistrationsPerParticipant} onChange={(event) => setDraft({ ...draft, waiverPolicy: { ...draft.waiverPolicy, allowMultipleRegistrationsPerParticipant: event.target.checked } })} /> Allow multiple registrations per participant</label>
                              <label><input type="checkbox" checked readOnly /> Allow duplicate email addresses (always enabled)</label>
                              <label>Waiver coverage<select value={draft.waiverPolicy.waiverCoverage} onChange={(event) => setDraft({ ...draft, waiverPolicy: { ...draft.waiverPolicy, waiverCoverage: event.target.value as typeof draft.waiverPolicy.waiverCoverage } })}><option value="PER_REGISTRATION">Per registration</option><option value="PER_EVENT_EDITION">Per event edition</option><option value="MULTIPLE_SELECTED_REGISTRATIONS">Multiple selected registrations</option></select></label>
                              <label><input type="checkbox" checked={draft.waiverPolicy.requireSeparateWaiverForDifferentEvents} onChange={(event) => setDraft({ ...draft, waiverPolicy: { ...draft.waiverPolicy, requireSeparateWaiverForDifferentEvents: event.target.checked } })} /> Separate waiver for different events</label>
                              <label><input type="checkbox" checked={draft.waiverPolicy.requireSeparateWaiverForDifferentDisciplines} onChange={(event) => setDraft({ ...draft, waiverPolicy: { ...draft.waiverPolicy, requireSeparateWaiverForDifferentDisciplines: event.target.checked } })} /> Separate waiver for different disciplines</label>
                              <label><input type="checkbox" checked={draft.waiverPolicy.allowCheckInBeforeScheduledSession} onChange={(event) => setDraft({ ...draft, waiverPolicy: { ...draft.waiverPolicy, allowCheckInBeforeScheduledSession: event.target.checked } })} /> Allow check-in before scheduled session</label>
                              <label><input type="checkbox" checked={draft.waiverPolicy.allowCheckInAll} onChange={(event) => setDraft({ ...draft, waiverPolicy: { ...draft.waiverPolicy, allowCheckInAll: event.target.checked } })} /> Allow check-in all</label>
                              <label><input type="checkbox" checked={draft.waiverPolicy.requireGuardianSignatureForMinors} onChange={(event) => setDraft({ ...draft, waiverPolicy: { ...draft.waiverPolicy, requireGuardianSignatureForMinors: event.target.checked } })} /> Require guardian signature for minors</label>
                            </fieldset>
                          </div>
                          <div className="event-rules-preview waiver-preview">
                            <div className="event-document-subhead"><FileText /><span><b>Waiver preview</b><small>Sanitized stored rendering</small></span></div>
                            {draft.waiverHtml
                              ? <iframe title="Waiver preview" sandbox="" srcDoc={waiverTemplateSrcDoc(draft.waiverHtml, {
                                name: "Participant Name", email: "participant@example.com", phone: draft.contactPhone || "+91 90000 00000",
                                address: "Participant address", emergency_number: "+91 90000 00001", eventname: draft.name || "Event Name",
                                category: draft.categories[0] || "Race Category", eventdate: draft.date || "Event Date",
                                day: draft.date ? String(new Date(`${draft.date}T00:00:00`).getDate()) : "DD", date: draft.date || "Event Date",
                                organizer_name: draft.organizer || "Organiser Name", company_description: draft.companyDescription || "Company description",
                                organizer_address: draft.organizerAddress || "Organiser address", country: "India",
                                jurisdiction: draft.jurisdiction || "Event jurisdiction",
                                waiver_version: draft.waiverVersion || "Current version", signature_name: "Participant Name",
                              }, draft.waiverParameterMappings || [])} />
                              : <div className="admin-empty">Add waiver content to preview it.</div>}
                          </div>
                        </div>
                      </div>
                      <CategoryForm categories={draft.categories} onChange={(categories) => setDraft((current) => current ? { ...current, categories } : current)} ticketDefinitions={draft.ticketDefinitions} onTicketDefinitionsChange={(ticketDefinitions) => setDraft((current) => current ? { ...current, ticketDefinitions } : current)} compact />
                      <div className="event-row-actions">
                        <button className="button" onClick={() => { setEditingId(null); setDraft(null); }}><X /> Cancel</button>
                        <button className="button button-primary" disabled={saving} onClick={() => void saveEditing()}><Save /> {saving ? "Saving…" : "Save changes"}</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="event-list-code">
                        {event.logoData ? <Image src={event.logoData} alt="" fill sizes="45px" /> : event.name.split(" ").map((word) => word[0]).slice(0, 3).join("")}
                      </div>
                      <div className="event-list-copy">
                        <div><h3>{event.name}</h3><span className={`status-pill status-${event.status === "draft" || event.status === "archived" ? "upcoming" : event.status}`}>{event.status}</span></div>
                        <p><CalendarDays /> {event.date} <MapPin /> {event.city} · {event.sport}</p>
                        <small>/{event.slug}</small>
                      </div>
                      <div className="event-row-actions">
                        <button className="button button-secondary" onClick={() => startEditing(event)}><Pencil /> Edit</button>
                        <Link className="button" href={event.status === "draft" ? `/admin/events/${encodeURIComponent(event.id)}/preview` : `/events/${encodeURIComponent(event.slug)}`}><Eye /> View event</Link>
                        {event.status === "draft" && <button className="button button-primary" disabled={saving} onClick={() => void publishManagedEvent(event)}><Rocket /> {saving ? "Publishing…" : "Publish event"}</button>}
                        <Link className="button" href={`/admin/events/${encodeURIComponent(event.id)}/course-maps`}><Map /> Course maps</Link>
                        <Link className="button" href={`/admin/events/${encodeURIComponent(event.id)}/platform`}><Radio /> Live & mobile</Link>
                        <Link className="button" href={`/admin/communications?eventId=${encodeURIComponent(event.id)}`}><Megaphone /> Communications</Link>
                        <button className="button button-danger" disabled={saving} onClick={() => void removeEvent(event)}><Trash2 /> Delete</button>
                      </div>
                    </>
                  )}
                </article>
              );
            })}
            {!visibleEvents.length && <p className="admin-empty">No upcoming events. Select a past event from the dropdown above.</p>}
          </div>
        )}
      </section>
      <div className="admin-section-divider"><span>CREATE ANOTHER EVENT</span></div>
      <EventForm onCreated={addEvent} disabled={saving} slugSuggestion={slugSuggestion} />
    </>
  );
}
