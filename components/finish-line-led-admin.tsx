"use client";
/* eslint-disable @next/next/no-img-element */

import type { FinishLineLedConfig, FinishLineLedFeed, FinishLineLedLogo } from "@/lib/finish-line-led";
import { LED_FIELD_IDS, LED_FIELD_LABELS, ledGridColumns, normalizeLedFields, moveLedField, type LedField } from "@/lib/finish-line-led-fields";
import { latestVisibleFinishers, LedFinisherField } from "./finish-line-led-display";
import { resolveLedLogos } from "@/lib/finish-line-led-logos";
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
  const [draggedField, setDraggedField] = useState<LedField | null>(null);
  const selectedFields = normalizeLedFields(config.visibleFields);
  function moveField(field: LedField, target: LedField) {
    setConfig((current) => ({ ...current, visibleFields: moveLedField(normalizeLedFields(current.visibleFields), field, target) }));
  }
  const displayUrl = eventId ? `/finish-line-led/${encodeURIComponent(eventId)}` : "";

  const allLogos = useMemo(() => {
    const merged = new Map<string, FinishLineLedLogo>();
    [...config.logos, ...availableLogos].forEach((logo) => merged.set(logo.id, logo));
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
    setConfig((current) => ({ ...current, syncEventLogos: availableLogos.some((item) => item.id === logo.id) ? false : current.syncEventLogos, logos: current.logos.some((item) => item.id === logo.id) ? current.logos.filter((item) => item.id !== logo.id) : [...current.logos, logo] }));
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
          <div className="finish-led-settings-head"><div><h3>LED logos</h3><p>Uses this event’s logo and sponsors from Events &amp; Registration → Sponsors / Partners. No separate upload is needed.</p></div><span>{config.logos.length} selected</span></div>
          <label className="finish-led-logo-sync"><input type="checkbox" checked={config.syncEventLogos !== false} onChange={(event) => {
            const enabled = event.target.checked;
            setConfig((current) => ({ ...current, syncEventLogos: enabled, logos: enabled ? resolveLedLogos(availableLogos, current.logos) : current.logos }));
          }} />Automatically sync event and registration sponsor logos</label>
          <p className="finish-led-logo-help">New and updated logos follow the selected event. Selecting individual source logos switches to manual selection. Save LED settings to apply.</p>
          <div className="finish-led-logo-list">
            {allLogos.map((logo) => <label key={logo.id} className={config.logos.some((item) => item.id === logo.id) ? "selected" : ""}><input type="checkbox" checked={config.logos.some((item) => item.id === logo.id)} onChange={() => toggleLogo(logo)} /><img src={logo.logoUrl} alt="" /><span><strong>{logo.name}</strong><small>{logo.kind === "EVENT" ? "Event logo" : "Sponsor logo"}</small></span></label>)}
            {!allLogos.length && <div className="admin-empty">No logos are saved for this event yet. Add sponsors for this same event in <a href="/admin/events-registration?tab=sponsors">Events &amp; Registration → Sponsors</a>, then refresh here. You can also add a custom LED logo below.</div>}
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
          <p>Latest three finishers only. New arrivals roll in at the top; older finishers do not cycle back. Ranks are never displayed.</p>
          <fieldset className="finish-led-field-picker">
            <legend>Visible finisher fields</legend>
            {LED_FIELD_IDS.map((field) => {
              const selected = normalizeLedFields(config.visibleFields);
              return <label key={field}><input type="checkbox" checked={selected.includes(field)} disabled={selected.length === 1 && selected.includes(field)} onChange={() => setConfig((current) => {
                const fields = normalizeLedFields(current.visibleFields);
                return { ...current, visibleFields: fields.includes(field) ? fields.filter((item) => item !== field) : [...fields, field] };
              })} />{LED_FIELD_LABELS[field]}</label>;
            })}
          </fieldset>
          <div className="finish-led-field-order">
            <h3>Column order</h3>
            <p>Drag a field to reorder it, or use the arrows. Top to bottom becomes left to right on the LED screen. Save to publish this order.</p>
            <ol aria-label="LED column order">
              {selectedFields.map((field, index) => <li key={field}
                className={draggedField === field ? "dragging" : ""}
                onDragOver={(event) => { if (draggedField) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }}
                onDrop={(event) => { event.preventDefault(); if (draggedField) moveField(draggedField, field); setDraggedField(null); }}>
                <span className="finish-led-drag-handle" draggable
                  title={`Drag ${LED_FIELD_LABELS[field]}`}
                  onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", field); setDraggedField(field); }}
                  onDragEnd={() => setDraggedField(null)}>⠿</span>
                <span>{LED_FIELD_LABELS[field]}</span>
                <button type="button" aria-label={`Move ${LED_FIELD_LABELS[field]} left`} disabled={index === 0} onClick={() => moveField(field, selectedFields[index - 1])}>↑</button>
                <button type="button" aria-label={`Move ${LED_FIELD_LABELS[field]} right`} disabled={index === selectedFields.length - 1} onClick={() => moveField(field, selectedFields[index + 1])}>↓</button>
              </li>)}
            </ol>
          </div>
          <button className="button button-primary" type="button" disabled={saving || !eventId} onClick={() => void save()}><Save /> {saving ? "Saving…" : "Save LED settings"}</button>
        </div>
      </div>

      <div className="finish-led-admin-preview">
        {feed?.finishers.length ? latestVisibleFinishers(feed.finishers).map((finisher) => <article key={finisher.id} style={{ gridTemplateColumns: ledGridColumns(normalizeLedFields(config.visibleFields)) }}>{normalizeLedFields(config.visibleFields).map((field) => <LedFinisherField key={field} finisher={finisher} field={field} />)}</article>) : <div className="admin-empty">Event and sponsor logos rotate full-screen with the elapsed clock until the first official finisher arrives.</div>}
      </div>
    </section>
  </>;
}
