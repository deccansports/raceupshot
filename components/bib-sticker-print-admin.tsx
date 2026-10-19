"use client";

import { BIB_PRINT_FONT_CSS, MONTSERRAT_EXTRABOLD } from "@/lib/bib-print-fonts";
/* eslint-disable @next/next/no-img-element -- print-template artwork is an admin-uploaded data URL, not a Next image asset. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RaceEvent } from "@/lib/types";
import { bibPrintCategoryOptions } from "@/lib/bib-print-category-options";
import { downloadPrintDocumentPdf } from "@/lib/bib-print-pdf";
import { fitTextBoxToContent, printPreviewScale } from "@/lib/bib-print-preview";
import { fixedPrintLayout, matchesPrintGender, PRINT_DATA_ELEMENT_KINDS, PRINT_FONT_FAMILIES, printElementText, selectPrintParticipants, type PrintElementKind, type PrintParticipant, type PrintTemplate, type PrintTemplateElement } from "@/lib/bib-print-layout";

type Audit = {
  id?: string; participantId: string; bibNumber?: string; categoryId?: string;
  templateType: string; printType: string; printedAt: string;
  printedBy?: string; printedByName?: string; source?: string; reprintReason?: string | null;
};
type PrintData = { event: { id: string; name: string }; participants: PrintParticipant[]; templates: PrintTemplate[]; audits: Audit[] };
type Mode = "ALL" | "RANGE" | "SELECTED" | "NOT_PRINTED" | "REPRINT";
type PrintBatch = { templateId: string; mode: Mode; selectedIds: string[]; minBib: string; maxBib: string; templateSnapshot?: PrintTemplate };
const fields: PrintElementKind[] = [...PRINT_DATA_ELEMENT_KINDS, "STATIC_TEXT", "STATIC_IMAGE"];
const shapes: PrintElementKind[] = ["RECTANGLE", "ELLIPSE", "LINE"];
const bibShortcuts: ReadonlyArray<readonly [PrintElementKind, string]> = [
  ["BIB_NUMBER", "BIB"], ["PARTICIPANT_NAME", "Name"], ["RELAY_TEAM_NAME", "Team Name"], ["CLUB_NAME", "Club Name"],
  ["TSHIRT_SIZE", "T-Shirt Size"], ["EMERGENCY_CONTACT", "Emergency Contact Number"],
  ["GENDER_AGE_GROUP", "Gender + Age Group"], ["COUNTRY_FLAG", "Country Flag"],
  ["ATHLETE_BAND_QR", "Athlete Band QR"],
];
const fontWeights = [[400, "Regular"], [500, "Medium"], [600, "Semi bold"], [700, "Bold"], [800, "Extra bold"], [900, "Black"]] as const;
const fieldLabels: Partial<Record<PrintElementKind, string>> = {
  BIB_NUMBER: "BIB number", PARTICIPANT_ID: "Participant ID", REGISTRATION_ID: "Registration ID",
  RELAY_TEAM_NAME: "Relay team name", RELAY_TEAM_SIZE: "Relay team size", RELAY_MEMBER_NUMBER: "Relay member number",
  RELAY_MEMBER_ROLE: "Relay member role", SESSION_ID: "Session ID", DATE_OF_BIRTH: "Date of birth (DOB)",
  TSHIRT_SIZE: "T-shirt size", COUNTRY_FLAG: "Country flag", BEL_SEASON: "BEL season", BEL_RECOGNITION: "BEL recognition",
  PARTICIPANT_QR: "Participant QR", ATHLETE_BAND_QR: "Athlete band QR", IDENTITY_PROOF: "Identity proof",
};
const label = (kind: string) => fieldLabels[kind as PrintElementKind] ?? kind.replaceAll("_", " ").toLowerCase().replace(/^./, (char) => char.toUpperCase());
const responseError = async (response: Response, fallback: string): Promise<Error> => {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("application/json")) {
    const payload = await response.json().catch(() => null) as { error?: string; requestId?: string } | null;
    if (payload?.error) return new Error(`${payload.error}${payload.requestId ? ` (Request ${payload.requestId})` : ""}`);
  }
  const text = await response.text().catch(() => "");
  const title = text.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
  return new Error(`${title || fallback} (HTTP ${response.status}${response.headers.get("cf-ray") ? ` · Ray ${response.headers.get("cf-ray")}` : ""})`);
};
const responseData = async <T,>(response: Response): Promise<T> => {
  if (!response.ok) throw await responseError(response, "Server request failed");
  const json = await response.json().catch(() => null) as { ok: boolean; data?: T; error?: string } | null;
  if (!json?.ok || !json.data) throw new Error(json?.error || `The server returned an invalid response (HTTP ${response.status}).`);
  return json.data;
};

export function BibStickerPrintAdmin({ events }: { events: RaceEvent[] }) {
  const [eventId, setEventId] = useState(events[0]?.id ?? "");
  const [data, setData] = useState<PrintData | null>(null);
  const [template, setTemplate] = useState<PrintTemplate | null>(null);
  const [type, setType] = useState<"BIB" | "STICKER">("BIB");
  const [ticketId, setTicketId] = useState("");
  const [subcategoryId, setSubcategoryId] = useState<string | null>(null);
  const [duplicateTicketId, setDuplicateTicketId] = useState("");
  const [previewIndex, setPreviewIndex] = useState(0);
  const [selectedElementId, setSelectedElementId] = useState("");
  const [mode, setMode] = useState<Mode>("SELECTED");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [minBib, setMinBib] = useState(""); const [maxBib, setMaxBib] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(""); const [error, setError] = useState(""); const [success, setSuccess] = useState("");
  const [downloaded, setDownloaded] = useState(false);
  const [exportProgress, setExportProgress] = useState("");
  const [batchHash, setBatchHash] = useState("");
  const [generatedBatch, setGeneratedBatch] = useState<PrintBatch | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [canvasWidth, setCanvasWidth] = useState(0);
  const [drag, setDrag] = useState<{ id: string; mode: "move" | "resize"; x: number; y: number; startX: number; startY: number; startW: number; startH: number } | null>(null);
  const endpoint = `/api/v1/admin/events/${encodeURIComponent(eventId)}/print`;
  const load = useCallback(async () => {
    if (!eventId) return;
    setBusy("Loading roster and templates…"); setError("");
    try { const next = await responseData<PrintData>(await fetch(endpoint, { cache: "no-store" })); setData(next); setTemplate(null); setSelectedIds([]); setTicketId(""); setSubcategoryId(null); setDuplicateTicketId(""); setPreviewIndex(0); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load print data."); setData(null); }
    finally { setBusy(""); }
  }, [endpoint, eventId]);
  useEffect(() => { queueMicrotask(() => { void load(); }); }, [load]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => setCanvasWidth(canvas.clientWidth));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [template?.id, template?.paperPreset]);
  const tickets = useMemo(() => {
    const event = events.find((item) => item.id === eventId);
    return bibPrintCategoryOptions(event, data?.participants ?? []);
  }, [data, eventId, events]);
  const subcategories = useMemo(() => [...new Set((data?.participants ?? []).filter((row) => row.ticketId === ticketId).map((row) => row.subcategoryId))], [data, ticketId]);
  const availableTemplates = (data?.templates ?? []).filter((item) => item.ticketId === ticketId && item.subcategoryId === subcategoryId && item.templateType === type);
  const printed = useMemo(() => new Set((data?.audits ?? []).filter((item) => item.templateType === type).map((item) => item.participantId)), [data, type]);
  const scopedRows = (data?.participants ?? []).filter((row) => row.ticketId === ticketId && row.subcategoryId === subcategoryId && row.bibNumber && row.active && !/cancel|refund|defer|inactive|delete|transfer(?:red)?[ _-]?out|withdraw/i.test(row.registrationStatus));
  let selected: PrintParticipant[] = []; let selectionError = "";
  try {
    if (template && data) selected = selectPrintParticipants({ roster: data.participants, eventId: data.event.id, ticketId: template.ticketId, subcategoryId: template.subcategoryId, mode, selectedIds, minBib, maxBib, previouslyPrintedIds: printed }).filter((row) => matchesPrintGender(row.gender, template.genderScope));
  } catch (cause) { selectionError = cause instanceof Error ? cause.message : "Invalid selection."; }
  const layout = template ? fixedPrintLayout(template.paperPreset, template.templateType) : null;
  const previewMaxWidth = layout ? Math.min(760, 700 * layout.itemWidthMm / layout.itemHeightMm) : 760;
  const previewScale = layout ? printPreviewScale(canvasWidth, layout.itemWidthMm) : 1;
  const pages = layout ? Math.ceil(selected.length / layout.itemsPerPage) : 0;
  const selectedElement = template?.elements.find((item) => item.id === selectedElementId);
  const visibleRows = template ? scopedRows.filter((row) => matchesPrintGender(row.gender, template.genderScope)) : scopedRows;
  const selectableRows = visibleRows.filter((row) => mode === "NOT_PRINTED" ? !printed.has(row.participantId) : mode === "REPRINT" ? printed.has(row.participantId) : true);
  const example = visibleRows[previewIndex] ?? visibleRows[0];
  const persistedTemplate = template ? data?.templates.find((item) => item.id === template.id) : null;
  const templateNeedsSave = Boolean(template && (!persistedTemplate || JSON.stringify(persistedTemplate) !== JSON.stringify(template)));
  const canGenerate = Boolean(template && data && selected.length > 0 && !busy);
  const canPreview = Boolean(template && data && example && !busy);

  const post = async <T,>(body: unknown): Promise<T> => responseData<T>(await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  const updateTemplate = (changes: Partial<PrintTemplate>) => setTemplate((current) => current ? { ...current, ...changes } : current);
  const updateElement = (id: string, changes: Partial<PrintTemplateElement>) => setTemplate((current) => current ? { ...current, elements: current.elements.map((item) => {
    if (item.id !== id) return item;
    const next = { ...item, ...changes };
    next.width = Math.min(100, Math.max(1, next.width));
    next.height = Math.min(100, Math.max(1, next.height));
    next.x = Math.min(100 - next.width, Math.max(0, next.x));
    next.y = Math.min(100 - next.height, Math.max(0, next.y));
    return next;
  }) } : current);
  const run = async (name: string, action: () => Promise<void>) => { setBusy(name); setError(""); setSuccess(""); try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Print action failed."); } finally { setBusy(""); } };
  const chooseFile = (file: File | undefined, target: "background" | "element") => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 2_000_000) { setError("Use a PNG, JPEG or WebP image under 2 MB."); return; }
    const reader = new FileReader(); reader.onload = () => { const url = String(reader.result ?? ""); if (target === "background") updateTemplate({ backgroundDataUrl: url }); else if (selectedElement) updateElement(selectedElement.id, { imageDataUrl: url }); }; reader.readAsDataURL(file);
  };
  const createTemplate = () => void run("Creating template…", async () => { const result = await post<{ template: PrintTemplate }>({ action: "new", ticketId, type }); setTemplate({ ...result.template, subcategoryId }); setSelectedElementId(""); setDownloaded(false); });
  const saveTemplate = () => void run("Saving template…", async () => { if (!template) throw new Error("Create or select a template first."); const result = await post<{ template: PrintTemplate }>({ action: "save", template }); setTemplate(result.template); setData((current) => current ? { ...current, templates: [...current.templates.filter((item) => item.id !== result.template.id), result.template] } : current); setSuccess(`Saved template v${result.template.version}.`); setDownloaded(false); });
  const persistTemplateForOutput = async (): Promise<PrintTemplate> => {
    if (!template) throw new Error("Create or select a template first.");
    if (!templateNeedsSave) return template;
    const result = await post<{ template: PrintTemplate }>({ action: "save", template });
    setTemplate(result.template);
    setData((current) => current ? { ...current, templates: [...current.templates.filter((item) => item.id !== result.template.id), result.template] } : current);
    return result.template;
  };
  const duplicateTemplate = () => void run("Duplicating template…", async () => {
    if (!template || !duplicateTicketId) throw new Error("Choose a destination category.");
    const result = await post<{ template: PrintTemplate }>({ action: "duplicate", sourceTemplateId: template.id, targetTicketId: duplicateTicketId, targetSubcategoryId: null });
    setData((current) => current ? { ...current, templates: [...current.templates.filter((item) => item.id !== result.template.id), result.template] } : current);
    setTicketId(duplicateTicketId); setSubcategoryId(null); setTemplate(result.template); setDuplicateTicketId(""); setSelectedIds([]); setPreviewIndex(0);
    setSuccess(`Duplicated as ${result.template.name}.`);
  });
  const deliverServerPdf = async (action: "pdf" | "single-pdf" | "four-up-pdf", batch: PrintBatch, purpose: "preview" | "download", popup: Window | null, fallbackFileName: string, expectedPages: number): Promise<string> => {
    setExportProgress("Browser capture unavailable. Creating the PDF securely on the server…");
    const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, batch }) });
    if (!response.ok) throw await responseError(response, "Server PDF fallback failed");
    if (!response.headers.get("content-type")?.toLowerCase().includes("application/pdf")) throw new Error("The server PDF fallback returned an invalid document.");
    const physicalPages = Number(response.headers.get("x-physical-pages"));
    if (!physicalPages || physicalPages !== expectedPages) throw new Error("The fallback PDF page count does not match the selected print items.");
    const url = URL.createObjectURL(new Blob([await response.arrayBuffer()], { type: "application/pdf" }));
    if (purpose === "preview") {
      if (!popup || popup.closed) { URL.revokeObjectURL(url); throw new Error("The PDF preview window was closed. Allow popups and try again."); }
      popup.location.replace(url); popup.focus(); window.setTimeout(() => URL.revokeObjectURL(url), 10 * 60_000);
    } else {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] || fallbackFileName;
      anchor.style.display = "none"; document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
    return response.headers.get("x-print-batch-hash") ?? "";
  };
  const downloadSingleBib = () => void run("Creating single A5 BIB…", async () => {
    if (!template || template.templateType !== "BIB" || !example) throw new Error("Choose a BIB template and participant first.");
    const outputTemplate = await persistTemplateForOutput();
    const singleBatch: PrintBatch = { templateId: outputTemplate.id, mode: "SELECTED", selectedIds: [example.participantId], minBib: "", maxBib: "", templateSnapshot: outputTemplate };
    const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "single-print", batch: singleBatch }) });
    if (!response.ok) throw await responseError(response, "Single BIB export failed");
    const html = await response.text();
    if (!response.headers.get("content-type")?.toLowerCase().includes("text/html") || !/^\s*<!doctype html>/i.test(html)) throw new Error("The server did not return a valid A5 print document.");
    let fallback = false;
    try {
      await downloadPrintDocumentPdf({ html, fileName: `Race_Upshot_BIB_${example.bibNumber}`, pageWidthMm: 148.5, pageHeightMm: 210 });
    } catch {
      fallback = true;
      await deliverServerPdf("single-pdf", singleBatch, "download", null, `Race_Upshot_BIB_${example.bibNumber}.pdf`, 1);
    }
    setSuccess(`Downloaded BIB ${example.bibNumber} as one portrait A5 PDF${fallback ? " using the compatible server renderer" : ""}.`);
  });
  const makePdf = (purpose: "preview" | "download" | "print", forceFourUp = false) => void run("Creating PDF…", async () => {
    if (!template || !data) throw new Error("Choose a template first.");
    if (purpose === "preview" && !example) throw new Error("Choose a participant to preview.");
    if (purpose !== "preview" && !selected.length) throw new Error(selectionError || "Select at least one participant.");
    const popup = purpose === "download" ? null : window.open("", "_blank");
    if (purpose !== "download" && !popup) throw new Error("Popup blocked. Allow popups to preview or print the PDF.");
    try {
      const outputTemplate = await persistTemplateForOutput();
      const targetBatch: PrintBatch = purpose === "preview"
        ? { templateId: outputTemplate.id, mode: "SELECTED", selectedIds: [example!.participantId], minBib: "", maxBib: "", templateSnapshot: outputTemplate }
        : { templateId: outputTemplate.id, mode, selectedIds, minBib, maxBib, templateSnapshot: outputTemplate };
      const targetSelected = selectPrintParticipants({ roster: data.participants, eventId: data.event.id, ticketId: outputTemplate.ticketId, subcategoryId: outputTemplate.subcategoryId, mode: targetBatch.mode, selectedIds: targetBatch.selectedIds, minBib: targetBatch.minBib, maxBib: targetBatch.maxBib, previouslyPrintedIds: printed }).filter((row) => matchesPrintGender(row.gender, outputTemplate.genderScope));
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: forceFourUp ? "four-up-print" : "print", batch: targetBatch }) });
      if (!response.ok) throw await responseError(response, "Print preparation failed");
      const html = await response.text();
      if (!response.headers.get("content-type")?.toLowerCase().includes("text/html") || !/^\s*<!doctype html>/i.test(html)) throw new Error("The server did not return a valid print document.");
      setBatchHash(response.headers.get("x-print-batch-hash") ?? "");
      setGeneratedBatch(targetBatch);
      if (purpose === "print") {
        popup!.document.open();
        popup!.document.write(html);
        popup!.document.close();
        await Promise.race([popup!.document.fonts.ready, new Promise<void>((resolve) => setTimeout(resolve, 8_000))]);
        await Promise.all([...popup!.document.images].map((image) => image.complete ? Promise.resolve() : new Promise<void>((resolve) => { image.onload = () => resolve(); image.onerror = () => resolve(); })));
        popup!.focus();
        popup!.print();
        setDownloaded(true);
        setSuccess("Print dialog opened. Use 100% / Actual Size with no scaling, then confirm only after the paper has printed.");
        return;
      }
      const outputLayout = fixedPrintLayout(forceFourUp ? "12X18" : outputTemplate.paperPreset, outputTemplate.templateType);
      const targetPages = Math.ceil(targetSelected.length / outputLayout.itemsPerPage);
      const expectedPages = Number(response.headers.get("x-physical-pages"));
      if (!expectedPages || expectedPages !== targetPages) throw new Error("The generated page count does not match the selected print items. Nothing was downloaded.");
      setExportProgress(`Rendering 0 of ${targetPages} pages…`);
      const fileName = `${data.event.name}_${outputTemplate.name}_${targetSelected.length}_${forceFourUp ? "4-Up_Bibs" : outputTemplate.templateType === "BIB" ? "Bibs" : "Stickers"}`;
      let fallback = false;
      try {
        await downloadPrintDocumentPdf({
          html, fileName,
          pageWidthMm: outputLayout.pageWidthMm,
          pageHeightMm: outputLayout.pageHeightMm,
          outputMode: purpose === "preview" ? "open" : "download",
          targetWindow: popup,
          onProgress: (completed, total) => setExportProgress(`Rendering ${completed} of ${total} pages…`),
        });
      } catch {
        fallback = true;
        const fallbackHash = await deliverServerPdf(forceFourUp ? "four-up-pdf" : "pdf", targetBatch, purpose, popup, `${fileName}.pdf`, targetPages);
        if (fallbackHash) setBatchHash(fallbackHash);
      }
      setExportProgress("");
      if (purpose === "download") {
        setDownloaded(true);
        setSuccess(`Downloaded all ${targetSelected.length} items on ${targetPages} physical page${targetPages === 1 ? "" : "s"}${forceFourUp ? " at four landscape A5 BIBs per 18 × 12 sheet" : ""}${fallback ? " using the compatible server renderer" : ""}. Confirm printing only after the paper has printed.`);
      } else {
        setSuccess(`Opened a ${targetPages}-page PDF preview${fallback ? " using the compatible server renderer" : ""}.`);
      }
    } catch (cause) { popup?.close(); throw cause; }
    finally { setExportProgress(""); }
  });
  const confirmPrinted = () => void run("Recording print…", async () => {
    if (!downloaded) throw new Error("Generate the PDF before confirming a physical print.");
    if (!generatedBatch) throw new Error("The generated print batch is no longer available. Download the PDF again.");
    if (selected.some((row) => printed.has(row.participantId)) && reason.trim().length < 5) throw new Error("Enter a reprint reason of at least five characters.");
    await post({ action: "audit", batch: generatedBatch, batchHash, reprintReason: reason, sessionId: crypto.randomUUID() });
    setDownloaded(false); setReason(""); await load(); setSuccess("Print confirmed and added to the append-only audit.");
  });
  const onCanvasPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag || !canvasRef.current) return;
    const bounds = canvasRef.current.getBoundingClientRect(); const dx = (event.clientX - drag.x) / bounds.width * 100; const dy = (event.clientY - drag.y) / bounds.height * 100;
    if (drag.mode === "move") updateElement(drag.id, { x: Math.min(100 - drag.startW, Math.max(0, drag.startX + dx)), y: Math.min(100 - drag.startH, Math.max(0, drag.startY + dy)) });
    else updateElement(drag.id, { width: Math.min(100 - drag.startX, Math.max(1, drag.startW + dx)), height: Math.min(100 - drag.startY, Math.max(1, drag.startH + dy)) });
  };
  const numeric = (element: PrintTemplateElement, name: keyof Pick<PrintTemplateElement, "x" | "y" | "width" | "height" | "rotation" | "fontSize" | "letterSpacing" | "lineHeight" | "strokeWidth" | "cornerRadius">, min: number, max: number, step = 0.1) => <label key={name}>{label(name)}<input type="number" min={min} max={max} step={step} value={element[name] ?? ""} onChange={(event) => updateElement(element.id, { [name]: Number(event.target.value) })} /></label>;
  const addElement = (kind: PrintElementKind) => {
    if (!template) return;
    const shape = shapes.includes(kind);
    const element: PrintTemplateElement = { id: crypto.randomUUID(), kind, x: shape ? 25 : 10, y: shape ? 35 : 10, width: shape ? 50 : 80, height: kind === "LINE" ? 8 : shape ? 30 : 16, rotation: 0, fontFamily: "Arial, sans-serif", fontSize: 24, fontWeight: 600, italic: false, underline: false, textCase: "NONE", color: "#111827", align: "center", verticalAlign: "middle", letterSpacing: 0, lineHeight: 1.05, imageFit: "contain", text: kind === "STATIC_TEXT" ? "Your text" : undefined, fillColor: "#ffffff", strokeColor: "#111827", strokeWidth: 2, cornerRadius: 0 };
    updateTemplate({ elements: [...template.elements, element] });
    setSelectedElementId(element.id);
  };
  const addOrSelectField = (kind: PrintElementKind) => {
    const existing = template?.elements.find((element) => element.kind === kind);
    if (existing) { setSelectedElementId(existing.id); return; }
    addElement(kind);
  };
  const fitSelectedText = () => {
    if (!selectedElement || !layout || shapes.includes(selectedElement.kind) || selectedElement.kind === "STATIC_IMAGE") return;
    const text = example ? printElementText(selectedElement, example) : selectedElement.text || label(selectedElement.kind);
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return;
    context.font = `${selectedElement.italic ? "italic " : ""}${selectedElement.fontWeight} ${selectedElement.fontSize}px ${selectedElement.fontFamily}`;
    const lines = text.split("\n");
    const textWidth = Math.max(0, ...lines.map((line) => context.measureText(line).width + Math.max(0, line.length - 1) * selectedElement.letterSpacing));
    updateElement(selectedElement.id, fitTextBoxToContent(selectedElement, textWidth, lines.length, layout.itemWidthMm, layout.itemHeightMm));
  };
  const setEdgeSpacing = (edge: "left" | "right" | "top" | "bottom", raw: number) => {
    if (!selectedElement || !Number.isFinite(raw)) return;
    const value = Math.max(0, Math.min(99, raw));
    const right = 100 - selectedElement.x - selectedElement.width;
    const bottom = 100 - selectedElement.y - selectedElement.height;
    if (edge === "left") updateElement(selectedElement.id, { x: value, width: Math.min(100, Math.max(1, 100 - value - right)) });
    if (edge === "right") updateElement(selectedElement.id, { width: Math.min(100, Math.max(1, 100 - selectedElement.x - value)) });
    if (edge === "top") updateElement(selectedElement.id, { y: value, height: Math.min(100, Math.max(1, 100 - value - bottom)) });
    if (edge === "bottom") updateElement(selectedElement.id, { height: Math.min(100, Math.max(1, 100 - selectedElement.y - value)) });
  };

  return <div className="bib-print-admin">
    <style>{BIB_PRINT_FONT_CSS}</style>
    <section className="admin-card"><div className="admin-card-head"><div><h2>BIB & Sticker Print</h2><p>Design event-scoped templates, create print-ready PDFs, and record completed physical prints.</p></div></div>
      {error && <div className="error-banner" role="alert">{error}</div>}{success && <div className="success-banner" role="status">{success}</div>}
      <div className="bib-print-type-tabs" role="tablist" aria-label="Print type">
        <button type="button" role="tab" aria-selected={type === "BIB"} className={type === "BIB" ? "active" : ""} onClick={() => { setType("BIB"); setTemplate(null); setSelectedIds([]); setPreviewIndex(0); }}>BIB Printing</button>
        <button type="button" role="tab" aria-selected={type === "STICKER"} className={type === "STICKER" ? "active" : ""} onClick={() => { setType("STICKER"); setTemplate(null); setSelectedIds([]); setPreviewIndex(0); }}>Sticker Printing</button>
      </div>
      <div className="bib-print-controls">
        <label>Event<select value={eventId} onChange={(event) => setEventId(event.target.value)}><option value="">Select event</option>{events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}</select></label>
        <label>Race category / ticket<select value={ticketId} onChange={(event) => { setTicketId(event.target.value); setSubcategoryId(null); setTemplate(null); setSelectedIds([]); setPreviewIndex(0); }}><option value="">Select category</option>{tickets.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        {subcategories.length > 1 && <label>Subcategory<select value={subcategoryId ?? ""} onChange={(event) => { setSubcategoryId(event.target.value || null); setTemplate(null); setPreviewIndex(0); }}><option value="">None</option>{subcategories.filter(Boolean).map((id) => <option key={id} value={id!}>{id}</option>)}</select></label>}
        <label>Saved template<select value={template?.id ?? ""} onChange={(event) => { setTemplate(availableTemplates.find((item) => item.id === event.target.value) ?? null); setSelectedElementId(""); setDownloaded(false); setPreviewIndex(0); }}><option value="">Select saved template</option>{availableTemplates.map((item) => <option key={item.id} value={item.id}>{item.name} · v{item.version} · {item.genderScope}</option>)}</select></label>
      </div>
      <div className="bib-print-actions"><button className="button button-primary" disabled={!ticketId || !!busy} onClick={createTemplate}>Create template</button><button className="button" disabled={!template || !!busy} onClick={saveTemplate}>Save template</button><label className="bib-print-duplicate">Duplicate design to<select value={duplicateTicketId} onChange={(event) => setDuplicateTicketId(event.target.value)}><option value="">Select category</option>{tickets.filter(([id]) => id !== ticketId).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label><button className="button" disabled={!template || !duplicateTicketId || !!busy} onClick={duplicateTemplate}>Duplicate template</button><button className="button" disabled={!!busy} onClick={() => void load()}>Refresh roster</button></div>
      {busy && <p role="status">{busy}</p>}
    </section>
    {template && <section className="admin-card"><h3>Template designer</h3><div className="bib-print-controls">
      <label>Name<input value={template.name} maxLength={100} onChange={(event) => updateTemplate({ name: event.target.value })} /></label>
      <label>Gender scope<select value={template.genderScope} onChange={(event) => updateTemplate({ genderScope: event.target.value as PrintTemplate["genderScope"] })}><option value="ALL">All / Unisex</option><option value="MALE">Male</option><option value="FEMALE">Female</option></select></label>
      <label>Paper<select value={template.paperPreset} onChange={(event) => updateTemplate({ paperPreset: event.target.value as PrintTemplate["paperPreset"] })} disabled={type === "STICKER"}>{type === "STICKER" ? <option value="STICKER_4X2">4 × 2 in sticker</option> : <><option value="A5">A5 Portrait Paper · 1 Rotated A5 BIB</option><option value="A4_SINGLE_A5">A4 Sheet · 1 Centred A5 BIB</option><option value="A4">A4 Portrait · 2 BIBs</option><option value="12X18">18 × 12 in Landscape · 4 A5 BIBs</option></>}</select></label>
      <label>Active<select value={template.active ? "yes" : "no"} onChange={(event) => updateTemplate({ active: event.target.value === "yes" })}><option value="yes">Yes</option><option value="no">No</option></select></label>
      <label>Background<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => chooseFile(event.target.files?.[0], "background")} /></label>
    </div>
      <p className="bib-print-note">The canvas is one {type === "BIB" && template.paperPreset === "12X18" ? "portrait A5 BIB" : "print item"}. Drag to move, use the corner handle to resize, and double-click to rotate 90°. Every field is constrained inside the A5 block. PDF printing uses the physical dimensions shown below.</p>
      {type === "BIB" && <div className="bib-print-shortcuts" aria-label="Quick add BIB fields">{bibShortcuts.map(([kind, shortcutLabel]) => { const exists = template.elements.some((element) => element.kind === kind); return <button type="button" key={kind} className={exists ? "is-added" : ""} onClick={() => addOrSelectField(kind)}><span>+</span>{shortcutLabel}</button>; })}</div>}
      <div className="bib-print-designer"><div ref={canvasRef} className="bib-print-canvas" style={{ aspectRatio: `${layout?.itemWidthMm}/${layout?.itemHeightMm}`, maxWidth: `${previewMaxWidth}px`, backgroundImage: template.backgroundDataUrl ? `url(${template.backgroundDataUrl})` : undefined }} onPointerMove={onCanvasPointerMove} onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)}>
        {template.elements.map((element) => <div key={element.id} className={`bib-print-canvas-element${selectedElementId === element.id ? " selected" : ""}`} title="Double-click to rotate 90°" style={{ left: `${element.x}%`, top: `${element.y}%`, width: `${element.width}%`, height: `${element.height}%`, transform: `rotate(${element.rotation}deg)`, color: element.color, fontFamily: element.fontFamily, fontWeight: element.fontWeight, fontStyle: element.italic ? "italic" : "normal", textDecoration: element.underline ? "underline" : "none", textAlign: element.align, justifyContent: element.verticalAlign === "top" ? "flex-start" : element.verticalAlign === "bottom" ? "flex-end" : "center", letterSpacing: `${element.letterSpacing * previewScale}px`, lineHeight: element.lineHeight ?? 1.05, fontSize: `${element.fontSize * previewScale}px` }} onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); setDrag(null); setSelectedElementId(element.id); updateElement(element.id, { rotation: element.rotation >= 270 ? 0 : element.rotation + 90 }); }} onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setSelectedElementId(element.id); setDrag({ id: element.id, mode: "move", x: event.clientX, y: event.clientY, startX: element.x, startY: element.y, startW: element.width, startH: element.height }); }}>
          {shapes.includes(element.kind) ? <span className="bib-print-shape" style={element.kind === "LINE" ? { height: 0, borderTop: `${Math.max(1, element.strokeWidth ?? 1)}px solid ${element.strokeColor ?? "#111827"}` } : { background: element.fillColor ?? "#ffffff", border: `${element.strokeWidth ?? 1}px solid ${element.strokeColor ?? "#111827"}`, borderRadius: element.kind === "ELLIPSE" ? "50%" : `${element.cornerRadius ?? 0}%` }} /> : element.kind === "STATIC_IMAGE" ? element.imageDataUrl ? <img src={element.imageDataUrl} alt="Template art" style={{ objectFit: element.imageFit }} /> : "Image" : element.kind.includes("QR") ? "▦ QR" : element.kind === "BARCODE" ? "▥ Barcode" : <span className="bib-print-text">{example ? printElementText(element, example) : label(element.kind)}</span>}<span className="bib-print-resize" onPointerDown={(event) => { event.stopPropagation(); event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setSelectedElementId(element.id); setDrag({ id: element.id, mode: "resize", x: event.clientX, y: event.clientY, startX: element.x, startY: element.y, startW: element.width, startH: element.height }); }} />
        </div>)}
      </div><div className="bib-print-editor"><label>Add field<select defaultValue="" onChange={(event) => { const kind = event.target.value as PrintElementKind; if (!kind) return; addElement(kind); event.target.value = ""; }}><option value="">Choose field…</option>{fields.map((field) => <option key={field} value={field}>{label(field)}</option>)}</select></label>
        <label>Add shape<select defaultValue="" onChange={(event) => { const kind = event.target.value as PrintElementKind; if (!kind) return; addElement(kind); event.target.value = ""; }}><option value="">Choose shape…</option><option value="RECTANGLE">Rectangle</option><option value="ELLIPSE">Ellipse / circle</option><option value="LINE">Line</option></select></label>
        {selectedElement && <><h4>{label(selectedElement.kind)}</h4><div className="bib-print-element-controls">{numeric(selectedElement, "x", -100, 100)}{numeric(selectedElement, "y", -100, 100)}{numeric(selectedElement, "width", 1, 100)}{numeric(selectedElement, "height", 1, 100)}{numeric(selectedElement, "rotation", -360, 360)}
          {shapes.includes(selectedElement.kind) ? <><label>Fill color<input type="color" value={selectedElement.fillColor ?? "#ffffff"} onChange={(event) => updateElement(selectedElement.id, { fillColor: event.target.value })} /></label><label>Outline color<input type="color" value={selectedElement.strokeColor ?? "#111827"} onChange={(event) => updateElement(selectedElement.id, { strokeColor: event.target.value })} /></label>{numeric(selectedElement, "strokeWidth", 0, 30)}{selectedElement.kind === "RECTANGLE" && numeric(selectedElement, "cornerRadius", 0, 100)}</> : <>
          {numeric(selectedElement, "fontSize", 1, 600)}<label>Font weight<select value={selectedElement.fontWeight} onChange={(event) => updateElement(selectedElement.id, { fontWeight: Number(event.target.value) })}>{!fontWeights.some(([weight]) => weight === selectedElement.fontWeight) && <option value={selectedElement.fontWeight}>{selectedElement.fontWeight} · Custom</option>}{fontWeights.map(([weight, name]) => <option key={weight} value={weight}>{name} · {weight}</option>)}</select></label>{numeric(selectedElement, "letterSpacing", -30, 30)}{numeric(selectedElement, "lineHeight", 0.5, 3, 0.05)}
          <label>Font<select value={selectedElement.fontFamily} onChange={(event) => updateElement(selectedElement.id, { fontFamily: event.target.value, ...(event.target.value === MONTSERRAT_EXTRABOLD ? { fontWeight: 800 } : {}) })}>{PRINT_FONT_FAMILIES.map((font) => <option key={font} value={font}>{font === MONTSERRAT_EXTRABOLD ? "Montserrat ExtraBold" : font.startsWith("\"Monument Extended") ? "Monument Extended" : font.startsWith("\"PF Monumenta Pro") ? "Monumenta Pro" : font.split(",")[0]}</option>)}</select></label><label>Color<input type="color" value={selectedElement.color} onChange={(event) => updateElement(selectedElement.id, { color: event.target.value })} /></label>
          <label>Text case<select value={selectedElement.textCase} onChange={(event) => updateElement(selectedElement.id, { textCase: event.target.value as PrintTemplateElement["textCase"] })}><option>NONE</option><option>UPPER</option><option>LOWER</option></select></label>
          <label>Horizontal<select value={selectedElement.align} onChange={(event) => updateElement(selectedElement.id, { align: event.target.value as PrintTemplateElement["align"] })}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label><label>Vertical<select value={selectedElement.verticalAlign} onChange={(event) => updateElement(selectedElement.id, { verticalAlign: event.target.value as PrintTemplateElement["verticalAlign"] })}><option value="top">Top</option><option value="middle">Middle</option><option value="bottom">Bottom</option></select></label>
          <label><input type="checkbox" checked={selectedElement.italic} onChange={(event) => updateElement(selectedElement.id, { italic: event.target.checked })} /> Italic</label><label><input type="checkbox" checked={selectedElement.underline} onChange={(event) => updateElement(selectedElement.id, { underline: event.target.checked })} /> Underline</label></>}
          {selectedElement.kind === "STATIC_TEXT" && <label>Text<input value={selectedElement.text ?? ""} onChange={(event) => updateElement(selectedElement.id, { text: event.target.value })} /></label>}
          {selectedElement.kind === "STATIC_IMAGE" && <><label>Image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => chooseFile(event.target.files?.[0], "element")} /></label><label>Image fit<select value={selectedElement.imageFit} onChange={(event) => updateElement(selectedElement.id, { imageFit: event.target.value as PrintTemplateElement["imageFit"] })}><option>contain</option><option>cover</option><option>fill</option></select></label></>}
        </div>{!shapes.includes(selectedElement.kind) && selectedElement.kind !== "STATIC_IMAGE" && <button className="button" onClick={fitSelectedText}>Fit Box to Content</button>}
        <div className="bib-print-align-panel"><strong>Align to BIB</strong><div className="bib-print-align-grid"><button className="button" onClick={() => updateElement(selectedElement.id, { x: 0, align: "left" })}>Left</button><button className="button" onClick={() => updateElement(selectedElement.id, { x: (100 - selectedElement.width) / 2, align: "center" })}>Centre</button><button className="button" onClick={() => updateElement(selectedElement.id, { x: 100 - selectedElement.width, align: "right" })}>Right</button><button className="button" onClick={() => updateElement(selectedElement.id, { y: 0, verticalAlign: "top" })}>Top</button><button className="button" onClick={() => updateElement(selectedElement.id, { y: (100 - selectedElement.height) / 2, verticalAlign: "middle" })}>Middle</button><button className="button" onClick={() => updateElement(selectedElement.id, { y: 100 - selectedElement.height, verticalAlign: "bottom" })}>Bottom</button></div></div>
        <div className="bib-print-align-panel"><strong>Edge Spacing (%)</strong><div className="bib-print-element-controls">{(["left", "right", "top", "bottom"] as const).map((edge) => <label key={edge}>{label(edge)}<input type="number" step="0.1" min="0" max="99" value={Number((edge === "left" ? selectedElement.x : edge === "right" ? 100 - selectedElement.x - selectedElement.width : edge === "top" ? selectedElement.y : 100 - selectedElement.y - selectedElement.height).toFixed(1))} onChange={(event) => setEdgeSpacing(edge, Number(event.target.value))} /></label>)}</div></div>
        <div className="bib-print-shape-actions"><button className="button" onClick={() => { const copy = { ...selectedElement, id: crypto.randomUUID(), x: Math.min(100 - selectedElement.width, selectedElement.x + 4), y: Math.min(100 - selectedElement.height, selectedElement.y + 4) }; updateTemplate({ elements: [...template.elements, copy] }); setSelectedElementId(copy.id); }}>Duplicate</button><button className="button" onClick={() => updateTemplate({ elements: [...template.elements.filter((item) => item.id !== selectedElement.id), selectedElement] })}>Bring to front</button><button className="button" onClick={() => updateTemplate({ elements: [selectedElement, ...template.elements.filter((item) => item.id !== selectedElement.id)] })}>Send to back</button></div><button className="button" onClick={() => { updateTemplate({ elements: template.elements.filter((item) => item.id !== selectedElement.id) }); setSelectedElementId(""); }}>Remove element</button></>}
      </div></div>
      <div className="bib-print-preview-nav"><button type="button" className="button" disabled={previewIndex <= 0} onClick={() => setPreviewIndex((index) => Math.max(0, index - 1))}>Previous participant</button><label>Preview participant<select value={example?.participantId ?? ""} onChange={(event) => setPreviewIndex(Math.max(0, visibleRows.findIndex((row) => row.participantId === event.target.value)))}><option value="">No participants</option>{visibleRows.map((row) => <option key={row.participantId} value={row.participantId}>{row.bibNumber} · {row.relayTeamName ? `${row.relayTeamName} · ` : ""}{row.name}</option>)}</select></label>{type === "BIB" && <button type="button" className="button" disabled={!example || !!busy} onClick={downloadSingleBib}>Download single A5 BIB PDF</button>}<button type="button" className="button" disabled={!visibleRows.length || previewIndex >= visibleRows.length - 1} onClick={() => setPreviewIndex((index) => Math.min(visibleRows.length - 1, index + 1))}>Next participant</button></div>
    </section>}
    {template && <section className="admin-card"><h3>Batch print</h3><div className="bib-print-controls"><label>Selection mode<select value={mode} onChange={(event) => { setMode(event.target.value as Mode); setDownloaded(false); }}><option value="ALL">All active participants</option><option value="RANGE">Numeric BIB range</option><option value="SELECTED">Selected participants</option><option value="NOT_PRINTED">Not previously printed (select checkboxes)</option><option value="REPRINT">Previously printed / reprint (select checkboxes)</option></select></label>{mode === "RANGE" && <><label>From BIB<input value={minBib} onChange={(event) => setMinBib(event.target.value)} /></label><label>To BIB<input value={maxBib} onChange={(event) => setMaxBib(event.target.value)} /></label></>}</div>
      <div className="bib-print-selection-bar"><span>{selectedIds.length} selected</span><button className="button" type="button" onClick={() => setSelectedIds(selectableRows.map((row) => row.participantId))}>Select all shown</button><button className="button" type="button" onClick={() => setSelectedIds([])}>Clear</button></div>
      <div className="bib-print-roster"><table><thead><tr><th>Select</th><th>BIB</th><th>Team</th><th>Athlete</th><th>Category</th><th>Gender</th><th>Print history</th></tr></thead><tbody>{selectableRows.map((row) => <tr key={row.participantId}><td><input type="checkbox" checked={selectedIds.includes(row.participantId)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...new Set([...current, row.participantId])] : current.filter((id) => id !== row.participantId))} /></td><td>{row.bibNumber}</td><td>{row.relayTeamName || "—"}</td><td>{row.name}</td><td>{row.ticketName}</td><td>{row.gender}</td><td>{printed.has(row.participantId) ? "Printed" : "Not printed"}</td></tr>)}</tbody></table></div>
      <div className="bib-print-summary"><span>Participants <strong>{selected.length}</strong></span><span>{type === "BIB" ? "BIBs" : "Stickers"} <strong>{selected.length}</strong></span><span>Paper <strong>{template.paperPreset === "12X18" ? "18 × 12 in Landscape" : template.paperPreset === "A4_SINGLE_A5" ? "A4 · 1 centred A5" : template.paperPreset === "A4" ? "A4 · 2 BIBs" : template.paperPreset === "STICKER_4X2" ? "4 × 2 in" : "A5 Portrait"}</strong></span><span>{type === "BIB" ? "BIBs" : "Stickers"} per page <strong>{layout?.itemsPerPage}</strong></span><span>Physical pages <strong>{pages}</strong></span></div>
      {template.paperPreset === "12X18" && <p className="bib-print-note">Four landscape A5 BIBs are aligned to the 18 × 12 inch sheet’s top-left in a 2 × 2 grid. Unused space remains on the right and bottom. Print at 100% / Actual Size with no scaling.</p>}
      {template.paperPreset === "A5" && <p className="bib-print-note">The full-size landscape A5 BIB is rotated onto one portrait A5 printer sheet without scaling.</p>}
      {template.paperPreset === "A4_SINGLE_A5" && <p className="bib-print-note">One exact landscape A5 BIB is centred on portrait A4 paper. Print at 100% / Actual Size with no scaling.</p>}
      {template.paperPreset === "A4" && <p className="bib-print-note">Two BIBs are arranged vertically on portrait A4 paper with a cut guide.</p>}
      {templateNeedsSave && <p className="bib-print-note">Pending template edits will be saved automatically when you preview, download, or print.</p>}
      {selectionError && <p className="error-banner">{selectionError}</p>}
      <div className="bib-print-actions" aria-busy={!!busy}><button type="button" className="button" disabled={!canPreview} onClick={() => makePdf("preview")}>Preview current participant</button>{type === "BIB" && <button type="button" className="button" disabled={!canGenerate} onClick={() => makePdf("download", true)}>Download 18×12 · 4 A5 BIBs</button>}<button type="button" className="button button-primary" disabled={!canGenerate} onClick={() => makePdf("download")}>Download Flattened PDF</button><button type="button" className="button" disabled={!canGenerate} onClick={() => makePdf("print")}>Print</button></div>
      {busy && <p className="bib-print-note" role="status">{busy} Keep this tab open.</p>}
      {exportProgress && <p className="bib-print-note" role="status">{exportProgress}</p>}
      {downloaded && <div className="bib-print-confirm"><p>Only confirm after the physical paper has printed successfully. Downloading or previewing alone is not a print.</p>{selected.some((row) => printed.has(row.participantId)) && <label>Reprint reason<input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why is this BIB being reprinted?" /></label>}<button className="button button-primary" disabled={!!busy} onClick={confirmPrinted}>Confirm printed & record audit</button></div>}
    </section>}
    {data && <section className="admin-card"><div className="admin-card-head"><div><h3>Print history</h3><p>Append-only original and reprint records for this event.</p></div><span className="status-pill">{data.audits.filter((audit) => (!ticketId || audit.categoryId === ticketId) && audit.templateType === type).length} records</span></div><div className="bib-print-roster bib-print-history"><table><thead><tr><th>BIB</th><th>Output</th><th>Type</th><th>Printed at</th><th>Printed by</th><th>Reason</th></tr></thead><tbody>{data.audits.filter((audit) => (!ticketId || audit.categoryId === ticketId) && audit.templateType === type).slice().reverse().slice(0, 500).map((audit, index) => <tr key={audit.id ?? `${audit.participantId}-${audit.printedAt}-${index}`}><td>{audit.bibNumber || "—"}</td><td>{audit.templateType}</td><td><span className="status-pill">{audit.printType}</span></td><td>{audit.printedAt ? new Date(audit.printedAt).toLocaleString() : "—"}</td><td>{audit.printedByName || audit.printedBy || "—"}</td><td>{audit.reprintReason || "—"}</td></tr>)}</tbody></table></div></section>}
  </div>;
}
