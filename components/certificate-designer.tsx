"use client";

import {
  AlignCenter, CheckCircle2, FileImage, GripVertical, Plus, QrCode,
  Save, TestTube2, Trash2, UploadCloud,
} from "lucide-react";
import {
  certificateTemplateId, type StoredCertificateElement, type StoredCertificateTemplate,
} from "@/lib/certificate-storage";
import type { RaceEvent } from "@/lib/types";
import Image from "next/image";
import { ChangeEvent, PointerEvent, useRef, useState } from "react";

interface TemplateAsset {
  name: string;
  type: string;
  data: string;
}

type CertificateElement = StoredCertificateElement;

const variables = [
  ["athlete_name", "Athlete name", "{{athlete_name}}"],
  ["bib_number", "Bib number", "{{bib_number}}"],
  ["event_name", "Event name", "{{event_name}}"],
  ["category", "Category", "{{category}}"],
  ["distance", "Distance", "{{distance}}"],
  ["finish_time", "Finish time", "{{finish_time}}"],
  ["overall_rank", "Overall rank", "{{overall_rank}}"],
  ["gender_rank", "Gender rank", "{{gender_rank}}"],
  ["age_group_rank", "Age-group rank", "{{age_group_rank}}"],
  ["event_date", "Event date", "{{event_date}}"],
  ["verification_code", "Verification code", "{{verification_code}}"],
  ["qr_code", "QR code", "QR"],
  ["swim_time", "Swim time", "{{swim_time}}"],
  ["t1_time", "T1 time", "{{t1_time}}"],
  ["bike_time", "Bike time", "{{bike_time}}"],
  ["t2_time", "T2 time", "{{t2_time}}"],
  ["run_time", "Run time", "{{run_time}}"],
] as const;

const initialElements: CertificateElement[] = [
  { id: "element-athlete", variable: "athlete_name", label: "Athlete name", sample: "{{athlete_name}}", x: 50, y: 39, fontSize: 42, color: "#07111f", weight: "700" },
  { id: "element-category", variable: "category", label: "Category", sample: "{{category}}", x: 50, y: 51, fontSize: 20, color: "#1b6cff", weight: "700" },
  { id: "element-time", variable: "finish_time", label: "Finish time", sample: "{{finish_time}}", x: 50, y: 64, fontSize: 30, color: "#07111f", weight: "700" },
];

function clamp(value: number) {
  return Math.max(2, Math.min(98, value));
}

export function CertificateDesigner({ events, initialTemplates }: { events: RaceEvent[]; initialTemplates: StoredCertificateTemplate[] }) {
  const firstEvent = events[0];
  const firstCategory = firstEvent?.categories[0] || "Overall";
  const [eventSlug, setEventSlug] = useState(firstEvent?.slug ?? "");
  const [category, setCategory] = useState(firstCategory);
  const [asset, setAsset] = useState<TemplateAsset | null>(null);
  const [elements, setElements] = useState(initialElements);
  const [selectedId, setSelectedId] = useState(initialElements[0].id);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const canvasRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const selected = elements.find((element) => element.id === selectedId);

  const selectedEvent = events.find((event) => event.slug === eventSlug) ?? firstEvent;

  function uploadTemplate(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const allowed = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
    if (!allowed.includes(file.type)) {
      setMessage("Use a PNG, JPG, WebP or PDF template.");
      return;
    }
    if (file.size > 2_000_000) {
      setMessage("Template files must be smaller than 2 MB for Worker KV storage.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setAsset({ name: file.name, type: file.type, data: String(reader.result) });
      setMessage("Custom certificate background loaded.");
    };
    reader.readAsDataURL(file);
  }

  function addVariable(variable: typeof variables[number]) {
    const [key, label, sample] = variable;
    const existingCount = elements.filter((element) => element.variable === key).length;
    const id = `${key}-${crypto.randomUUID()}`;
    setElements((current) => [...current, {
      id,
      variable: key,
      label,
      sample,
      x: 50,
      y: 72 + Math.min(existingCount * 5, 15),
      fontSize: key === "qr_code" ? 28 : 16,
      color: "#07111f",
      weight: "700",
    }]);
    setSelectedId(id);
    setMessage("");
  }

  function moveElement(event: PointerEvent<HTMLDivElement>, id: string) {
    if (draggingId !== id || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = clamp(((event.clientX - rect.left) / rect.width) * 100);
    const y = clamp(((event.clientY - rect.top) / rect.height) * 100);
    setElements((current) => current.map((element) => element.id === id ? { ...element, x, y } : element));
  }

  function updateSelected(update: Partial<CertificateElement>) {
    setElements((current) => current.map((element) => element.id === selectedId ? { ...element, ...update } : element));
  }

  function removeSelected() {
    setElements((current) => current.filter((element) => element.id !== selectedId));
    setSelectedId("");
  }

  function loadCategoryTemplate(nextEvent: string, nextCategory: string) {
    const id = certificateTemplateId(nextEvent, nextCategory);
    const stored = initialTemplates.find((template) => certificateTemplateId(template.eventSlug, template.category) === id);
    const nextElements = stored?.elements ?? initialElements;
    setElements(nextElements);
    setSelectedId(nextElements[0]?.id ?? "");
    setAsset(stored?.artworkData && stored.artworkName && stored.artworkType ? {
      data: stored.artworkData,
      name: stored.artworkName,
      type: stored.artworkType,
    } : null);
    setMessage(stored ? `Loaded the saved ${nextCategory} certificate template.` : `No saved template for ${nextCategory}. Using the default layout.`);
  }

  function changeEvent(nextEvent: string) {
    const nextCategory = events.find((event) => event.slug === nextEvent)?.categories[0] || "Overall";
    setEventSlug(nextEvent);
    setCategory(nextCategory);
    loadCategoryTemplate(nextEvent, nextCategory);
  }

  function changeCategory(nextCategory: string) {
    setCategory(nextCategory);
    loadCategoryTemplate(eventSlug, nextCategory);
  }

  async function saveTemplate() {
    try {
      const response = await fetch("/api/admin/certificate-templates", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
        eventSlug,
        category,
        artworkName: asset?.name,
        artworkType: asset?.type,
        artworkData: asset?.data,
        elements,
        savedAt: new Date().toISOString(),
        }),
      });
      const payload = await response.json() as { ok: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Unable to save template");
      setMessage(`${selectedEvent?.name ?? eventSlug} · ${category} template saved to RACEUPSHOT KV.`);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "The artwork could not be saved.");
    }
  }

  return (
    <section className="admin-card certificate-designer">
      <div className="admin-card-head">
        <div><h2>Custom certificate designer</h2><p>Upload artwork, then drag dynamic fields into their print positions.</p></div>
        <div className="certificate-designer-actions">
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={uploadTemplate} className="sr-only" />
          <button className="button button-secondary" onClick={() => fileRef.current?.click()}><UploadCloud /> {asset ? "Replace artwork" : "Upload artwork"}</button>
          <button className="button" onClick={() => setMessage("Template preview uses dynamic variable tokens. A public certificate appears only after a result has a verification code.")}><TestTube2 /> Generate test</button>
          <button className="button button-primary" disabled={!eventSlug} onClick={() => void saveTemplate()}><Save /> Save template</button>
        </div>
      </div>
      {message && <div className="success-banner"><CheckCircle2 /> {message}</div>}
      <div className="certificate-template-scope">
        <div className="field">
          <label htmlFor="certificate-event">Event</label>
          <select id="certificate-event" value={eventSlug} onChange={(event) => changeEvent(event.target.value)}>
            {events.map((event) => <option value={event.slug} key={event.id}>{event.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="certificate-category">Certificate category</label>
          <select id="certificate-category" value={category} onChange={(event) => changeCategory(event.target.value)}>
            {(selectedEvent?.categories.length ? selectedEvent.categories : ["Overall"]).map((item) => <option key={item}>{item}</option>)}
          </select>
        </div>
        <div className="certificate-scope-note"><CheckCircle2 /><span><b>Category-specific template</b><small>Only eligible finishers in {category} will receive this design.</small></span></div>
      </div>
      <div className="certificate-designer-grid">
        <aside className="certificate-variable-panel">
          <h3>Dynamic variables</h3>
          <p>Add fields to the certificate, then drag them on the canvas.</p>
          <div className="certificate-variable-list">
            {variables.map((variable) => (
              <button key={variable[0]} onClick={() => addVariable(variable)}><Plus /><span><b>{variable[1]}</b><small>{`{{${variable[0]}}}`}</small></span></button>
            ))}
          </div>
        </aside>

        <div className="certificate-canvas-column">
          <div className="certificate-canvas-toolbar">
            <span><FileImage /> {asset?.name ?? "Race Upshot default template"}</span>
            <small>Drag fields to position · landscape A4</small>
          </div>
          <div className="certificate-design-canvas" ref={canvasRef}>
            {asset ? (
              asset.type === "application/pdf"
                ? <object data={asset.data} type="application/pdf" aria-label="Certificate PDF background" />
                : <div className="certificate-uploaded-art" role="img" aria-label="Custom certificate background" style={{ backgroundImage: `url("${asset.data}")` }} />
            ) : (
              <div className="certificate-default-art">
                <Image src="/Race Upshot logo.png" alt="Race Upshot" width={130} height={38} />
                <strong>OFFICIAL FINISHER CERTIFICATE</strong>
                <i />
                <small>{selectedEvent ? `${selectedEvent.date.toUpperCase()} · ${selectedEvent.city.toUpperCase()}` : "EVENT DETAILS"}</small>
              </div>
            )}
            {elements.map((element) => (
              <div
                key={element.id}
                className={`certificate-design-element ${selectedId === element.id ? "selected" : ""} ${element.variable === "qr_code" ? "qr" : ""}`}
                style={{ left: `${element.x}%`, top: `${element.y}%`, fontSize: element.fontSize, color: element.color, fontWeight: element.weight }}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setSelectedId(element.id);
                  setDraggingId(element.id);
                }}
                onPointerMove={(event) => moveElement(event, element.id)}
                onPointerUp={() => setDraggingId(null)}
              >
                <GripVertical />
                {element.variable === "qr_code" ? <QrCode /> : element.sample}
              </div>
            ))}
          </div>
        </div>

        <aside className="certificate-property-panel">
          <h3>Field properties</h3>
          {selected ? (
            <>
              <div className="selected-variable"><AlignCenter /><span><b>{selected.label}</b><small>{`{{${selected.variable}}}`}</small></span></div>
              <div className="field"><label>Sample value</label><input value={selected.sample} onChange={(event) => updateSelected({ sample: event.target.value })} /></div>
              <div className="field"><label>Font size · {selected.fontSize}px</label><input type="range" min="8" max="64" value={selected.fontSize} onChange={(event) => updateSelected({ fontSize: Number(event.target.value) })} /></div>
              <div className="field"><label>Text color</label><input type="color" value={selected.color} onChange={(event) => updateSelected({ color: event.target.value })} /></div>
              <div className="field"><label>Font weight</label><select value={selected.weight} onChange={(event) => updateSelected({ weight: event.target.value as "400" | "700" })}><option value="400">Regular</option><option value="700">Bold</option></select></div>
              <div className="certificate-position-grid"><div><span>X</span><b>{selected.x.toFixed(1)}%</b></div><div><span>Y</span><b>{selected.y.toFixed(1)}%</b></div></div>
              <button className="button button-danger" onClick={removeSelected}><Trash2 /> Remove field</button>
            </>
          ) : <p className="admin-empty">Select a field on the certificate to edit its properties.</p>}
        </aside>
      </div>
    </section>
  );
}
