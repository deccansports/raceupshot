"use client";
/* eslint-disable @next/next/no-img-element */

import type { EventPartner, RaceEvent } from "@/lib/types";
import { ArrowDown, ArrowUp, BadgeDollarSign, Copy, ImagePlus, LoaderCircle, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type SponsorsResponse = { ok: boolean; data?: { sponsors: EventPartner[] }; error?: string };
type SponsorDraft = { name: string; type: string; website: string; logoUrl: string };

const emptyDraft = (): SponsorDraft => ({ name: "", type: "", website: "", logoUrl: "" });

async function readSponsors(eventId: string, signal?: AbortSignal): Promise<EventPartner[]> {
  const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/sponsors`, { signal, cache: "no-store" });
  const payload = await response.json() as SponsorsResponse;
  if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error || "Unable to load sponsors");
  return payload.data.sponsors;
}

async function writeSponsors(eventId: string, sponsors: EventPartner[]): Promise<EventPartner[]> {
  const normalized = sponsors.map((sponsor, order) => ({
    ...sponsor,
    name: sponsor.name.trim(),
    type: sponsor.type?.trim() || "Official Partner",
    website: sponsor.website?.trim() || "",
    logoUrl: sponsor.logoUrl.trim(),
    order,
  }));
  const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/sponsors`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sponsors: normalized }),
  });
  const payload = await response.json() as SponsorsResponse;
  if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error || "Unable to save sponsors");
  return payload.data.sponsors;
}

export function SponsorManagementAdmin({ events }: { events: RaceEvent[] }) {
  const [eventId, setEventId] = useState(events[0]?.id ?? "");
  const [cloneEventId, setCloneEventId] = useState("");
  const [sponsors, setSponsors] = useState<EventPartner[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<SponsorDraft>(emptyDraft);
  const [loading, setLoading] = useState(Boolean(events.length));
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const cloneTargets = useMemo(() => events.filter((event) => event.id !== eventId), [eventId, events]);
  const effectiveCloneEventId = cloneTargets.some((event) => event.id === cloneEventId)
    ? cloneEventId
    : cloneTargets[0]?.id ?? "";

  useEffect(() => {
    if (!eventId) return;
    const controller = new AbortController();
    readSponsors(eventId, controller.signal)
      .then(setSponsors)
      .catch((reason) => { if (reason.name !== "AbortError") setError(reason instanceof Error ? reason.message : "Unable to load sponsors"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [eventId]);

  async function uploadDraftLogo(file?: File) {
    if (!file || !eventId) return;
    setUploading(true); setError("");
    try {
      const form = new FormData();
      form.append("logo", file);
      const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/sponsors/logo`, { method: "POST", body: form });
      const payload = await response.json() as { ok: boolean; data?: { logoUrl: string }; error?: string };
      if (!response.ok || !payload.ok || !payload.data?.logoUrl) throw new Error(payload.error || "Unable to upload logo");
      setDraft((current) => ({ ...current, logoUrl: payload.data!.logoUrl }));
      setMessage("Logo uploaded. Add the sponsor to save it.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to upload logo");
    } finally { setUploading(false); }
  }

  async function addSponsor() {
    if (!draft.name.trim()) return setError("Enter the sponsor name.");
    if (!draft.logoUrl.trim()) return setError("Upload a logo or enter its URL.");
    try { new URL(draft.logoUrl); } catch { return setError("Enter a valid logo URL."); }
    if (draft.website.trim()) {
      try { new URL(draft.website); } catch { return setError("Enter a valid website URL."); }
    }
    setBusy(true); setError(""); setMessage("");
    try {
      const next = [...sponsors, {
        id: crypto.randomUUID(),
        name: draft.name,
        type: draft.type || "Official Partner",
        website: draft.website,
        logoUrl: draft.logoUrl,
        order: sponsors.length,
      }];
      const saved = await writeSponsors(eventId, next);
      setSponsors(saved); setDraft(emptyDraft());
      setMessage(`${draft.name.trim()} added.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to add sponsor");
    } finally { setBusy(false); }
  }

  function moveSponsor(id: string, direction: -1 | 1) {
    setSponsors((current) => {
      const index = current.findIndex((sponsor) => sponsor.id === id);
      const destination = index + direction;
      if (index < 0 || destination < 0 || destination >= current.length) return current;
      const next = [...current];
      [next[index], next[destination]] = [next[destination], next[index]];
      return next.map((sponsor, order) => ({ ...sponsor, order }));
    });
    setMessage("Order changed. Select Save Order to publish it.");
  }

  async function saveOrder() {
    setBusy(true); setError(""); setMessage("");
    try {
      setSponsors(await writeSponsors(eventId, sponsors));
      setMessage("Sponsor order saved.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save sponsor order");
    } finally { setBusy(false); }
  }

  async function removeSponsor(sponsor: EventPartner) {
    if (!window.confirm(`Remove ${sponsor.name}?`)) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const saved = await writeSponsors(eventId, sponsors.filter((row) => row.id !== sponsor.id));
      setSponsors(saved);
      setSelected((current) => { const next = new Set(current); next.delete(sponsor.id); return next; });
      setMessage(`${sponsor.name} removed.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to remove sponsor");
    } finally { setBusy(false); }
  }

  async function cloneSelected() {
    const chosen = sponsors.filter((sponsor) => selected.has(sponsor.id));
    if (!chosen.length) return setError("Select at least one sponsor to clone.");
    if (!effectiveCloneEventId) return setError("Select a destination event.");
    setBusy(true); setError(""); setMessage("");
    try {
      const existing = await readSponsors(effectiveCloneEventId);
      const clones = chosen.map((sponsor, index) => ({ ...sponsor, id: crypto.randomUUID(), order: existing.length + index }));
      await writeSponsors(effectiveCloneEventId, [...existing, ...clones]);
      const target = events.find((event) => event.id === effectiveCloneEventId)?.name || "the selected event";
      setMessage(`${clones.length} sponsor${clones.length === 1 ? "" : "s"} cloned to ${target}.`);
      setSelected(new Set());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to clone sponsors");
    } finally { setBusy(false); }
  }

  if (!events.length) return <section className="admin-card"><h2>Sponsor Management</h2><p className="admin-empty">Create an event before adding sponsors.</p></section>;

  return <section className="admin-card sponsor-management">
    <div className="admin-card-head"><div><h2><BadgeDollarSign /> Sponsor Management</h2><p>Add, reorder, remove, and clone sponsors across events.</p></div><span className="status-pill">{sponsors.length} sponsors</span></div>
    <div className="field sponsor-event-select"><label htmlFor="sponsor-event">Select Event</label><select id="sponsor-event" value={eventId} onChange={(event) => { setLoading(true); setError(""); setMessage(""); setSelected(new Set()); setEventId(event.target.value); }}>{events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}</select></div>
    <div className="sponsor-add-grid">
      <div className="field"><label htmlFor="sponsor-name">Sponsor Name</label><input id="sponsor-name" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Sponsor Name" /></div>
      <div className="field"><label htmlFor="sponsor-type">Sponsor Type</label><input id="sponsor-type" value={draft.type} onChange={(event) => setDraft((current) => ({ ...current, type: event.target.value }))} placeholder="e.g. Title Sponsor" /></div>
      <div className="field"><label htmlFor="sponsor-website">Website URL</label><input id="sponsor-website" type="url" value={draft.website} onChange={(event) => setDraft((current) => ({ ...current, website: event.target.value }))} placeholder="Sponsor Website URL" /></div>
      <div className="field"><label htmlFor="sponsor-logo-url">Logo URL</label><input id="sponsor-logo-url" type="url" value={draft.logoUrl} onChange={(event) => setDraft((current) => ({ ...current, logoUrl: event.target.value }))} placeholder="Or Logo URL" /></div>
      <label className="sponsor-logo-upload"><input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" disabled={uploading || busy} onChange={(event) => void uploadDraftLogo(event.target.files?.[0])} />{uploading ? <LoaderCircle className="spinning" /> : <ImagePlus />} {uploading ? "Uploading…" : "Upload Logo"}</label>
      <button className="button button-primary" type="button" disabled={busy || uploading} onClick={() => void addSponsor()}><Plus /> Add Sponsor</button>
    </div>
    {error && <p className="field-error">{error}</p>}
    {message && <div className="success-banner">{message}</div>}
    {loading ? <p className="admin-empty">Loading sponsors…</p> : <>
      <div className="table-wrap sponsor-table-wrap"><table className="leaderboard sponsor-table"><thead><tr><th aria-label="Select sponsors" /><th>Logo</th><th>Name</th><th>Type</th><th>Order</th><th>Actions</th></tr></thead><tbody>{sponsors.map((sponsor, index) => <tr key={sponsor.id}>
        <td><input type="checkbox" aria-label={`Select ${sponsor.name}`} checked={selected.has(sponsor.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(sponsor.id); else next.delete(sponsor.id); return next; })} /></td>
        <td><div className="sponsor-table-logo">{sponsor.logoUrl ? <img src={sponsor.logoUrl} alt={`${sponsor.name} logo`} /> : <BadgeDollarSign />}</div></td>
        <td><b>{sponsor.name}</b>{sponsor.website && <a href={sponsor.website} target="_blank" rel="noreferrer">Visit website</a>}</td>
        <td>{sponsor.type || "Official Partner"}</td><td><b>{index + 1}</b></td>
        <td><div className="partner-row-actions"><button type="button" aria-label={`Move ${sponsor.name} up`} disabled={busy || index === 0} onClick={() => moveSponsor(sponsor.id, -1)}><ArrowUp /></button><button type="button" aria-label={`Move ${sponsor.name} down`} disabled={busy || index === sponsors.length - 1} onClick={() => moveSponsor(sponsor.id, 1)}><ArrowDown /></button><button type="button" className="danger" aria-label={`Remove ${sponsor.name}`} disabled={busy} onClick={() => void removeSponsor(sponsor)}><Trash2 /></button></div></td>
      </tr>)}{!sponsors.length && <tr><td colSpan={6} className="admin-empty">No sponsors have been added to this event.</td></tr>}</tbody></table></div>
      <div className="sponsor-footer-actions"><div className="field"><label htmlFor="clone-event">Clone selected to</label><select id="clone-event" value={effectiveCloneEventId} disabled={!cloneTargets.length || busy} onChange={(event) => setCloneEventId(event.target.value)}>{cloneTargets.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}</select></div><button className="button button-secondary" type="button" disabled={!selected.size || !effectiveCloneEventId || busy} onClick={() => void cloneSelected()}><Copy /> Clone Selected ({selected.size})</button><button className="button button-primary" type="button" disabled={busy} onClick={() => void saveOrder()}><Save /> {busy ? "Saving…" : "Save Order"}</button></div>
    </>}
  </section>;
}
