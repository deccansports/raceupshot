"use client";

import type { HomepageSlide, RaceEvent } from "@/lib/types";
import { ArrowDown, ArrowUp, ImageIcon, Pencil, PlusCircle, Save, Trash2, UploadCloud, X } from "lucide-react";
import Image from "next/image";
import { ChangeEvent, useState } from "react";

function blankSlide(event?: RaceEvent): HomepageSlide {
  if (!event) {
    return {
      id: `slide-${crypto.randomUUID()}`,
      eventName: "Race Upshot",
      image: "/race-upshot-hero.png",
      headline: "Every second. Accounted for.",
      description: "Race Upshot uses a world-class timing system to connect athletes with live race progress, trusted results and finish-line certainty.",
      primaryLabel: "Login as athlete",
      primaryUrl: "/athlete/login",
      secondaryLabel: "Explore events",
      secondaryUrl: "/events",
      enabled: true,
      order: 1,
    };
  }
  return {
    id: `slide-${crypto.randomUUID()}`,
    eventId: event.id,
    eventSlug: event.slug,
    eventName: event.name,
    image: event.bannerUrl || "/race-upshot-hero.png",
    headline: event.name,
    description: event.description,
    primaryLabel: event.registrationUrl ? "Register now" : "View event",
    primaryUrl: event.registrationUrl || `/events/${event.slug}`,
    secondaryLabel: "Know more",
    secondaryUrl: event.knowMoreUrl || `/events/${event.slug}`,
    enabled: true,
    order: 1,
  };
}

export function HomepageSliderAdmin({
  events,
  initialSlides,
  initialEnabled,
}: {
  events: RaceEvent[];
  initialSlides: HomepageSlide[];
  initialEnabled: boolean;
}) {
  const [slides, setSlides] = useState(initialSlides);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [editing, setEditing] = useState<HomepageSlide | null>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  function selectEvent(slug: string) {
    if (!editing) return;
    if (!slug) {
      setEditing({
        ...editing,
        eventId: undefined,
        eventSlug: undefined,
        eventName: "Race Upshot",
        headline: "Every second. Accounted for.",
        description: "Race Upshot uses a world-class timing system to connect athletes with live race progress, trusted results and finish-line certainty.",
        primaryLabel: "Login as athlete",
        primaryUrl: "/athlete/login",
        secondaryLabel: "Explore events",
        secondaryUrl: "/events",
      });
      return;
    }
    const event = events.find((item) => item.slug === slug);
    if (!event) return;
    setEditing({
      ...editing,
      eventId: event.id,
      eventSlug: event.slug,
      eventName: event.name,
      headline: editing.headline || event.name,
      description: editing.description || event.description,
      primaryLabel: event.registrationUrl ? "Register now" : "View event",
      primaryUrl: event.registrationUrl || `/events/${event.slug}`,
      secondaryLabel: "Know more",
      secondaryUrl: event.knowMoreUrl || `/events/${event.slug}`,
    });
  }

  function uploadImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !editing) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 1_500_000) {
      setMessage("Use a JPG, PNG or WebP image below 1.5 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setEditing((current) => current ? { ...current, image: String(reader.result), imageName: file.name } : null);
    reader.readAsDataURL(file);
  }

  async function persist(nextSlides: HomepageSlide[], nextEnabled = enabled) {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/homepage-slider", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: nextEnabled, slides: nextSlides.map((slide, index) => ({ ...slide, order: index + 1 })) }),
      });
      const payload = await response.json() as { ok: boolean; data?: { enabled: boolean; slides: HomepageSlide[] }; error?: string };
      if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error || "Unable to save slider");
      setSlides(payload.data.slides);
      setEnabled(payload.data.enabled);
      setMessage("Homepage slider saved to RACEUPSHOT KV.");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Unable to save slider");
    } finally {
      setSaving(false);
    }
  }

  async function saveSlide() {
    if (!editing) return;
    const exists = slides.some((slide) => slide.id === editing.id);
    const next = exists ? slides.map((slide) => slide.id === editing.id ? editing : slide) : [...slides, editing];
    await persist(next);
    setEditing(null);
  }

  async function removeSlide(id: string) {
    if (!window.confirm("Remove this homepage slide from Worker storage?")) return;
    await persist(slides.filter((slide) => slide.id !== id));
  }

  async function moveSlide(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= slides.length) return;
    const next = [...slides];
    [next[index], next[target]] = [next[target], next[index]];
    await persist(next);
  }

  return (
    <section className="cms-panel">
      <div className="cms-panel-title">
        <div><ImageIcon /><span><h2>Homepage Slider</h2><p>Slides are loaded from and saved to the production Worker namespace.</p></span></div>
        <button className={`cms-toggle ${enabled ? "active" : ""}`} disabled={saving} onClick={() => void persist(slides, !enabled)}><i /> {enabled ? "Enabled" : "Disabled"}</button>
      </div>
      {message && <div className="success-banner">{message}</div>}
      {editing ? (
        <div className="slider-editor">
          <div className="slider-editor-image">
            <Image src={editing.image} alt="Slide preview" fill sizes="500px" />
            <label><UploadCloud /> Replace image<input type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadImage} /></label>
          </div>
          <div className="form-grid">
            <div className="field full"><label>Mapped event · optional</label><select value={editing.eventSlug ?? ""} onChange={(event) => selectEvent(event.target.value)}><option value="">Race Upshot information · no event</option>{events.map((event) => <option key={event.id} value={event.slug}>{event.name}</option>)}</select></div>
            <div className="field full"><label>Headline</label><input value={editing.headline} onChange={(event) => setEditing({ ...editing, headline: event.target.value })} /></div>
            <div className="field full"><label>Description</label><textarea value={editing.description} onChange={(event) => setEditing({ ...editing, description: event.target.value })} /></div>
            <div className="field"><label>Primary button</label><input value={editing.primaryLabel ?? ""} onChange={(event) => setEditing({ ...editing, primaryLabel: event.target.value })} /></div>
            <div className="field"><label>Primary URL</label><input value={editing.primaryUrl ?? ""} onChange={(event) => setEditing({ ...editing, primaryUrl: event.target.value })} /></div>
            <div className="field"><label>Secondary button</label><input value={editing.secondaryLabel ?? ""} onChange={(event) => setEditing({ ...editing, secondaryLabel: event.target.value })} /></div>
            <div className="field"><label>Secondary URL</label><input value={editing.secondaryUrl ?? ""} onChange={(event) => setEditing({ ...editing, secondaryUrl: event.target.value })} /></div>
          </div>
          <div className="form-actions"><button className="button" onClick={() => setEditing(null)}><X /> Cancel</button><button className="button button-primary" disabled={saving} onClick={() => void saveSlide()}><Save /> Save slide</button></div>
        </div>
      ) : (
        <>
          <div className="homepage-slide-list">
            {slides.map((slide, index) => (
              <article className="cms-slide-card" key={slide.id}>
                <div className="cms-slide-image"><Image src={slide.image} alt={`${slide.eventName} homepage slide`} fill sizes="420px" /></div>
                <div><span className="cms-badge published">Slide {String(index + 1).padStart(2, "0")}</span><h3>{slide.headline}</h3><p><b>{slide.eventName}</b> · {slide.description}</p><code>{slide.primaryUrl}</code></div>
                <div className="slider-row-controls">
                  <div className="cms-order"><button onClick={() => void moveSlide(index, -1)} disabled={saving || index === 0}><ArrowUp /></button><button onClick={() => void moveSlide(index, 1)} disabled={saving || index === slides.length - 1}><ArrowDown /></button></div>
                  <div className="cms-row-actions"><button onClick={() => setEditing({ ...slide })}><Pencil /> Edit</button><button className="delete" onClick={() => void removeSlide(slide.id)}><Trash2 /> Remove</button></div>
                </div>
              </article>
            ))}
          </div>
          {!slides.length && <p className="admin-empty">No homepage slides are stored.</p>}
          <button className="cms-upload-wide" onClick={() => setEditing(blankSlide())}><PlusCircle /><span><b>Add homepage slide</b><small>Event mapping is optional. Unmapped slides promote Race Upshot and athlete login.</small></span></button>
        </>
      )}
    </section>
  );
}
