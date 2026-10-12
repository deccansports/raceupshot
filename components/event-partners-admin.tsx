"use client";
/* eslint-disable @next/next/no-img-element */

import type { EventPartner, RaceEvent } from "@/lib/types";
import { ArrowDown, ArrowUp, Handshake, LoaderCircle, Plus, Save, Trash2, UploadCloud } from "lucide-react";
import { useEffect, useState } from "react";

type PartnersResponse = { ok: boolean; data?: { sponsors: EventPartner[] }; error?: string };

const emptyPartner = (): EventPartner => ({ id: crypto.randomUUID(), name: "", logoUrl: "", website: "", type: "Official Partner", order: 0 });

export function EventPartnersAdmin({ events }: { events: RaceEvent[] }) {
  const [eventId, setEventId] = useState(events[0]?.id ?? "");
  const [partners, setPartners] = useState<EventPartner[]>([]);
  const [loading, setLoading] = useState(Boolean(events[0]));
  const [saving, setSaving] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!eventId) return;
    const controller = new AbortController();
    fetch(`/api/events/${encodeURIComponent(eventId)}/sponsors`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as PartnersResponse;
        if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error || "Unable to load partners");
        setPartners(payload.data.sponsors);
      })
      .catch((reason) => { if (reason.name !== "AbortError") setError(reason instanceof Error ? reason.message : "Unable to load partners"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [eventId]);

  function updatePartner(id: string, patch: Partial<EventPartner>) {
    setPartners((current) => current.map((partner) => partner.id === id ? { ...partner, ...patch } : partner));
  }

  function reorder(id: string, direction: -1 | 1) {
    setPartners((current) => {
      const index = current.findIndex((partner) => partner.id === id);
      const destination = index + direction;
      if (index < 0 || destination < 0 || destination >= current.length) return current;
      const next = [...current];
      [next[index], next[destination]] = [next[destination], next[index]];
      return next.map((partner, order) => ({ ...partner, order }));
    });
  }

  async function uploadLogo(id: string, file: File | undefined) {
    if (!file || !eventId) return;
    setUploadingId(id); setError("");
    try {
      const form = new FormData();
      form.append("logo", file);
      const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/sponsors/logo`, { method: "POST", body: form });
      const payload = await response.json() as { ok: boolean; data?: { logoUrl: string }; error?: string };
      if (!response.ok || !payload.ok || !payload.data?.logoUrl) throw new Error(payload.error || "Unable to upload logo");
      updatePartner(id, { logoUrl: payload.data.logoUrl });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to upload logo");
    } finally { setUploadingId(null); }
  }

  async function save() {
    if (!eventId) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const sponsors = partners.map((partner, order) => ({ ...partner, name: partner.name.trim(), logoUrl: partner.logoUrl.trim(), website: partner.website?.trim() || "", type: partner.type?.trim() || "", order }));
      const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/sponsors`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ sponsors }) });
      const payload = await response.json() as PartnersResponse;
      if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error || "Unable to save partners");
      setPartners(payload.data.sponsors);
      setMessage(`${payload.data.sponsors.length} partner${payload.data.sponsors.length === 1 ? "" : "s"} saved. They are now available in the Race Upshot app.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save partners");
    } finally { setSaving(false); }
  }

  if (!events.length) return <section className="admin-card"><h2>Partners</h2><p className="admin-empty">Create an event before adding its partners.</p></section>;

  return <section className="admin-card partners-admin">
    <div className="admin-card-head"><div><h2><Handshake /> Event partners</h2><p>Manage the official supporters displayed in the Race Upshot event Partners screen.</p></div><span className="status-pill">{partners.length} partners</span></div>
    <div className="field partners-event-select"><label htmlFor="partners-event">Event</label><select id="partners-event" value={eventId} onChange={(event) => { setEventId(event.target.value); setLoading(true); setError(""); setMessage(""); }}>{events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}</select></div>
    {error && <p className="field-error">{error}</p>}
    {message && <div className="success-banner">{message}</div>}
    {loading ? <p className="admin-empty">Loading partners…</p> : <>
      <div className="partners-editor-list">
        {partners.map((partner, index) => <div className="partner-editor-row" key={partner.id}>
          <div className="partner-logo-preview">{partner.logoUrl ? <img src={partner.logoUrl} alt="" /> : <Handshake />}</div>
          <div className="field"><label>Partner name</label><input value={partner.name} onChange={(event) => updatePartner(partner.id, { name: event.target.value })} placeholder="Partner name" /></div>
          <div className="field"><label>Type</label><input value={partner.type ?? ""} onChange={(event) => updatePartner(partner.id, { type: event.target.value })} placeholder="Official Partner" /></div>
          <div className="field"><label>Logo URL</label><input type="url" value={partner.logoUrl} onChange={(event) => updatePartner(partner.id, { logoUrl: event.target.value })} placeholder="https://…" /><label className="partner-upload-button"><input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" disabled={uploadingId === partner.id} onChange={(event) => void uploadLogo(partner.id, event.target.files?.[0])} />{uploadingId === partner.id ? <><LoaderCircle className="spinning" /> Uploading…</> : <><UploadCloud /> Upload logo</>}</label></div>
          <div className="field"><label>Website (optional)</label><input type="url" value={partner.website ?? ""} onChange={(event) => updatePartner(partner.id, { website: event.target.value })} placeholder="https://…" /></div>
          <div className="partner-row-actions"><button type="button" aria-label={`Move ${partner.name || "partner"} up`} disabled={index === 0} onClick={() => reorder(partner.id, -1)}><ArrowUp /></button><button type="button" aria-label={`Move ${partner.name || "partner"} down`} disabled={index === partners.length - 1} onClick={() => reorder(partner.id, 1)}><ArrowDown /></button><button type="button" aria-label={`Remove ${partner.name || "partner"}`} className="danger" onClick={() => setPartners((current) => current.filter((item) => item.id !== partner.id).map((item, order) => ({ ...item, order })))}><Trash2 /></button></div>
        </div>)}
      </div>
      <div className="form-actions partners-actions"><button type="button" className="button button-secondary" onClick={() => setPartners((current) => [...current, { ...emptyPartner(), order: current.length }])}><Plus /> Add partner</button><button type="button" className="button button-primary" disabled={saving} onClick={() => void save()}><Save /> {saving ? "Saving…" : "Save partners"}</button></div>
    </>}
  </section>;
}
