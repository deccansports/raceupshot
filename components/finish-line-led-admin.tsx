"use client";
/* eslint-disable @next/next/no-img-element */

import type { FinishLineLedConfig, FinishLineLedFeed, FinishLineLedLogo } from "@/lib/finish-line-led";
import { Copy, ExternalLink, ImagePlus, RefreshCw, Save, Tv, UploadCloud } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

interface LedEvent { id: string; name: string; date: string; location: string; }
type ApiResponse<T> = { ok?: boolean; success?: boolean; data?: T; error?: string | { message?: string } };

function errorMessage(body: ApiResponse<unknown>, fallback: string): string {
  return typeof body.error === "string" ? body.error : body.error?.message || fallback;
}

export function FinishLineLedAdmin({ events }: { events: LedEvent[] }) {
  const [eventId, setEventId] = useState(events[0]?.id || "");
  const [feed, setFeed] = useState<FinishLineLedFeed | null>(null);
  const [availableLogos, setAvailableLogos] = useState<FinishLineLedLogo[]>([]);
  const [config, setConfig] = useState<FinishLineLedConfig>({ logos: [], idleRotationSeconds: 6, finisherRotationSeconds: 8 });
  const [customName, setCustomName] = useState("");
  const [customUrl, setCustomUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const displayUrl = eventId ? `/finish-line-led/${encodeURIComponent(eventId)}` : "";

  const allLogos = useMemo(() => {
    const merged = new Map<string, FinishLineLedLogo>();
    [...availableLogos, ...config.logos].forEach((logo) => merged.set(logo.id, logo));
    return [...merged.values()];
  }, [availableLogos, config.logos]);

  const refresh = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    try {
      const [feedResponse, configResponse] = await Promise.all([
        fetch(`/api/public/finish-line-led/${encodeURIComponent(eventId)}`, { cache: "no-store" }),
        fetch(`/api/admin/finish-line-led/${encodeURIComponent(eventId)}`, { cache: "no-store" }),
      ]);
      const feedBody = await feedResponse.json() as ApiResponse<FinishLineLedFeed>;
      const configBody = await configResponse.json() as ApiResponse<{ availableLogos: FinishLineLedLogo[]; config: FinishLineLedConfig }>;
      if (!feedResponse.ok || !feedBody.data) throw new Error(errorMessage(feedBody, "Unable to load LED feed."));
      if (!configResponse.ok || !configBody.data) throw new Error(errorMessage(configBody, "Unable to load LED settings."));
      setFeed(feedBody.data);
      setAvailableLogos(configBody.data.availableLogos);
      setConfig(configBody.data.config);
      setMessage("");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Unable to load LED settings.");
    } finally { setLoading(false); }
  }, [eventId]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timeout);
  }, [refresh]);

  function toggleLogo(logo: FinishLineLedLogo) {
    setConfig((current) => ({ ...current, logos: current.logos.some((item) => item.id === logo.id) ? current.logos.filter((item) => item.id !== logo.id) : [...current.logos, logo] }));
  }

  function addCustomLogo(name = customName, logoUrl = customUrl) {
    const cleanName = name.trim();
    const cleanUrl = logoUrl.trim();
    if (!cleanName || !cleanUrl) return setMessage("Enter a sponsor name and logo URL.");
    const logo: FinishLineLedLogo = { id: `custom:${crypto.randomUUID()}`, name: cleanName, logoUrl: cleanUrl, kind: "SPONSOR" };
    setConfig((current) => ({ ...current, logos: [...current.logos, logo] }));
    setCustomName(""); setCustomUrl(""); setMessage("Logo added. Save LED settings to publish it.");
  }

  async function uploadLogo(file: File | undefined) {
    if (!file || !eventId) return;
    if (!customName.trim()) return setMessage("Enter the sponsor name before uploading its logo.");
    setUploading(true); setMessage("");
    try {
      const form = new FormData(); form.append("logo", file);
      const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/sponsors/logo`, { method: "POST", body: form });
      const body = await response.json() as ApiResponse<{ logoUrl: string }>;
      if (!response.ok || !body.data?.logoUrl) throw new Error(errorMessage(body, "Unable to upload logo."));
      addCustomLogo(customName, body.data.logoUrl);
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Unable to upload logo."); }
    finally { setUploading(false); }
  }

  async function save() {
    if (!eventId) return;
    setSaving(true); setMessage("");
    try {
      const response = await fetch(`/api/admin/finish-line-led/${encodeURIComponent(eventId)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(config) });
      const body = await response.json() as ApiResponse<{ config: FinishLineLedConfig }>;
      if (!response.ok || !body.data?.config) throw new Error(errorMessage(body, "Unable to save LED settings."));
      setConfig(body.data.config);
      setMessage("Finish Line LED settings published.");
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Unable to save LED settings."); }
    finally { setSaving(false); }
  }

  async function copyUrl() {
    await navigator.clipboard.writeText(new URL(displayUrl, window.location.origin).toString());
    setMessage("Finish Line LED link copied.");
  }

  return <>
    <div className="admin-title"><div><h1>Finish Line LED</h1><p>BERGMAN-style venue board with rotating event branding, sponsor logos and rolling live finishes.</p></div></div>
    <section className="admin-card finish-led-admin-card">
      <div className="admin-card-head"><div><h2><Tv /> Finish display</h2><p>Select the event, choose the logos shown before the first finisher, and open the LED display.</p></div><span className="status-pill">{feed?.finishers.length ?? 0} finishers</span></div>
      <div className="finish-led-admin-toolbar">
        <label>Event<select value={eventId} onChange={(event) => setEventId(event.target.value)}>{events.map((event) => <option value={event.id} key={event.id}>{event.name} · {event.date}</option>)}</select></label>
        <button className="button" type="button" disabled={!eventId || loading} onClick={() => void refresh()}><RefreshCw /> {loading ? "Refreshing…" : "Refresh"}</button>
        <button className="button" type="button" disabled={!displayUrl} onClick={() => void copyUrl()}><Copy /> Copy link</button>
        <a className="button button-primary" href={displayUrl || "#"} target="_blank" rel="noreferrer"><ExternalLink /> Open LED screen</a>
      </div>
      {message && <div className="finish-led-admin-message">{message}</div>}
      <div className="finish-led-admin-status">
        <div><span>EVENT</span><strong>{feed?.event.name || events.find((event) => event.id === eventId)?.name || "—"}</strong></div>
        <div><span>DISPLAY MODE</span><strong>{feed?.finishers.length ? "Rolling finishers" : "Event + sponsor rotation"}</strong></div>
        <div><span>LAST UPDATE</span><strong>{feed?.updatedAt ? new Date(feed.updatedAt).toLocaleString() : "Waiting for timing"}</strong></div>
      </div>

      <div className="finish-led-settings-grid">
        <div className="finish-led-logo-picker">
          <div className="finish-led-settings-head"><div><h3>LED logos</h3><p>Event logo comes from Event settings. Sponsor logos come from Partners, or add one here.</p></div><span>{config.logos.length} selected</span></div>
          <div className="finish-led-logo-list">
            {allLogos.map((logo) => <label key={logo.id} className={config.logos.some((item) => item.id === logo.id) ? "selected" : ""}><input type="checkbox" checked={config.logos.some((item) => item.id === logo.id)} onChange={() => toggleLogo(logo)} /><img src={logo.logoUrl} alt="" /><span><strong>{logo.name}</strong><small>{logo.kind === "EVENT" ? "Event logo" : "Sponsor logo"}</small></span></label>)}
            {!allLogos.length && <div className="admin-empty">No event or partner logos are configured yet. Add one below.</div>}
          </div>
          <div className="finish-led-custom-logo">
            <label>Sponsor / logo name<input value={customName} onChange={(event) => setCustomName(event.target.value)} placeholder="Sponsor name" /></label>
            <label>Logo URL<input value={customUrl} onChange={(event) => setCustomUrl(event.target.value)} placeholder="https://…" /></label>
            <button type="button" className="button" onClick={() => addCustomLogo()}><ImagePlus /> Add URL</button>
            <label className="button finish-led-upload"><input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" disabled={uploading} onChange={(event) => void uploadLogo(event.target.files?.[0])} /><UploadCloud /> {uploading ? "Uploading…" : "Upload logo"}</label>
          </div>
        </div>
        <div className="finish-led-rotation-settings">
          <h3>Rotation timing</h3>
          <label>Logo seconds<input type="number" min="3" max="30" value={config.idleRotationSeconds} onChange={(event) => setConfig((current) => ({ ...current, idleRotationSeconds: Number(event.target.value) }))} /></label>
          <label>Finisher page seconds<input type="number" min="3" max="30" value={config.finisherRotationSeconds} onChange={(event) => setConfig((current) => ({ ...current, finisherRotationSeconds: Number(event.target.value) }))} /></label>
          <button className="button button-primary" type="button" disabled={saving || !eventId} onClick={() => void save()}><Save /> {saving ? "Saving…" : "Save LED settings"}</button>
        </div>
      </div>

      <div className="finish-led-admin-preview">
        {feed?.finishers.length ? feed.finishers.slice(0, 10).map((finisher) => <article key={finisher.id}><span>{finisher.bib || "—"}</span><strong>{finisher.name}</strong><small>{finisher.gender?.slice(0, 1).toUpperCase()}{finisher.ageGroup || "Open"} · {finisher.country}</small><time>{finisher.finishTime}</time></article>) : <div className="admin-empty">Event and sponsor logos rotate full-screen with the elapsed clock until the first official finisher arrives.</div>}
      </div>
    </section>
  </>;
}
