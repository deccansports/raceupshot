import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { KVNamespace } from "@cloudflare/workers-types";
import puppeteer from "@cloudflare/puppeteer";
import * as bwipjs from "@bwip-js/generic";
import { getAdminParticipantRoster } from "./participant-chip-assignments";
import { getEventBySlug } from "./raceupshot-repository";
import { eventTicketDefinitions } from "./event-ticket-definition";
import { defaultPrintTemplate, fixedPrintLayout, matchesPrintGender, PRINT_FONT_FAMILIES, printElementText, renderPrintHtml, repairStandardA5Template, selectPrintParticipants, validatedPrintImage, type PrintParticipant, type PrintTemplate, type PrintTemplateElement } from "./bib-print-layout";

type JsonRecord = Record<string, unknown>;
const elementKinds = new Set(["BIB_NUMBER", "PARTICIPANT_NAME", "FIRST_NAME", "LAST_NAME", "RACE_CATEGORY", "SUBCATEGORY", "GENDER", "AGE_GROUP", "GENDER_AGE_GROUP", "CLUB_NAME", "COUNTRY_FLAG", "TSHIRT_SIZE", "EMERGENCY_CONTACT", "TIMING_CHIP", "ATHLETE_BAND_CODE", "PARTICIPANT_QR", "ATHLETE_BAND_QR", "BARCODE", "STATIC_TEXT", "STATIC_IMAGE", "RECTANGLE", "ELLIPSE", "LINE"]);
const key = (eventId: string) => `raceupshot:print:event:${encodeURIComponent(eventId)}:templates:v1`;
const value = (row: JsonRecord, ...names: string[]) => names.map((name) => row[name]).find((item) => item !== null && item !== undefined && String(item).trim())?.toString().trim() ?? "";

export function normalizePrintRoster(eventId: string, rows: JsonRecord[]): PrintParticipant[] {
  return rows.filter((row) => !value(row, "eventId", "event_id") || value(row, "eventId", "event_id") === eventId).map((row) => ({
    eventId,
    participantId: value(row, "participantUid", "participantUuid", "participant_uuid", "id"),
    bookingId: value(row, "bookingId", "booking_id") || null,
    ticketId: value(row, "ticketId", "ticket_id", "contestId"),
    ticketName: value(row, "ticketName", "contestName", "category"),
    subcategoryId: value(row, "subcategoryId", "subCategoryId", "ageGroupId") || null,
    bibNumber: value(row, "bib", "bibNumber", "bib_number"),
    name: value(row, "nameOnBib", "fullName", "name", "displayName"), gender: value(row, "gender"),
    ageGroup: value(row, "ageGroup", "age_group"), club: value(row, "club", "clubName"),
    country: value(row, "country", "countryCode"), tshirtSize: value(row, "tshirtSize", "tShirtSize"),
    emergencyContact: value(row, "emergencyContact", "emergencyPhone"),
    chipCode: value(row, "chipCode", "chip_code"), athleteBandCode: value(row, "athleteBandCode", "athlete_band_code"),
    registrationStatus: value(row, "registrationStatus", "bookingStatus", "participantStatus"),
    active: row.active !== false && row.isActive !== false,
  })).filter((row) => Boolean(row.participantId));
}

async function kv(): Promise<KVNamespace> {
  const { env } = await getCloudflareContext({ async: true });
  if (!env.RACEUPSHOT) throw new Error("Print template storage is unavailable.");
  return env.RACEUPSHOT;
}

export async function printRoster(eventIdOrSlug: string) {
  const roster = await getAdminParticipantRoster(eventIdOrSlug);
  if (!roster) throw new Error("Event not found.");
  return { event: roster.event, participants: normalizePrintRoster(roster.event.id, roster.rows) };
}

export async function listPrintTemplates(eventId: string): Promise<PrintTemplate[]> {
  const templates = (await (await kv()).get<PrintTemplate[]>(key(eventId), "json")) ?? [];
  return templates.map((template) => repairStandardA5Template({
    ...template,
    // Upgrade the former four-up identifier when old templates are loaded.
    paperPreset: fixedPrintLayout(template.paperPreset, template.templateType).paperPreset,
  }));
}

async function configuredTicketIds(eventId: string): Promise<Set<string>> {
  const event = await getEventBySlug(eventId, { includeUnpublished: true });
  if (!event) throw new Error("Event not found.");
  return new Set([...(event.tickets ?? []).map((ticket) => ticket.id), ...eventTicketDefinitions(event.ticketDefinitions, event.categories).map((ticket) => ticket.id)]);
}

function validElement(element: PrintTemplateElement): boolean {
  const numbers = [element.x, element.y, element.width, element.height, element.rotation, element.fontSize, element.fontWeight, element.letterSpacing, element.lineHeight ?? 1.05, element.strokeWidth ?? 1, element.cornerRadius ?? 0];
  return Boolean(element.id && elementKinds.has(element.kind)) && numbers.every(Number.isFinite)
    && element.x >= -100 && element.y >= -100 && element.x <= 100 && element.y <= 100
    && element.width > 0 && element.width <= 100 && element.height > 0 && element.height <= 100
    && element.x + element.width >= 0 && element.y + element.height >= 0
    && Math.abs(element.rotation) <= 360 && element.fontSize > 0 && element.fontSize <= 600
    && element.fontWeight >= 100 && element.fontWeight <= 900 && Math.abs(element.letterSpacing) <= 30
    && (element.lineHeight ?? 1.05) >= 0.5 && (element.lineHeight ?? 1.05) <= 3
    && (element.strokeWidth ?? 1) >= 0 && (element.strokeWidth ?? 1) <= 30
    && (element.cornerRadius ?? 0) >= 0 && (element.cornerRadius ?? 0) <= 100
    && (!element.fillColor || /^#[0-9a-fA-F]{6}$/.test(element.fillColor))
    && (!element.strokeColor || /^#[0-9a-fA-F]{6}$/.test(element.strokeColor))
    && /^#[0-9a-fA-F]{6}$/.test(element.color)
    && PRINT_FONT_FAMILIES.includes(element.fontFamily as (typeof PRINT_FONT_FAMILIES)[number])
    && ["left", "center", "right"].includes(element.align)
    && ["top", "middle", "bottom"].includes(element.verticalAlign)
    && ["contain", "cover", "fill"].includes(element.imageFit)
    && ["NONE", "UPPER", "LOWER"].includes(element.textCase)
    && (!element.text || element.text.length <= 500)
    && (!element.imageDataUrl || Boolean(validatedPrintImage(element.imageDataUrl)));
}

export async function savePrintTemplate(eventId: string, input: PrintTemplate): Promise<PrintTemplate> {
  if (input.eventId !== eventId || !input.ticketId || !input.name?.trim() || input.name.length > 100) throw new Error("A valid event, category and template name are required.");
  if (!["BIB", "STICKER"].includes(input.templateType) || !["ALL", "MALE", "FEMALE"].includes(input.genderScope)) throw new Error("Invalid template scope.");
  if (input.templateType === "BIB" && !["A5", "A4_SINGLE_A5", "A4", "12X18", "12X8"].includes(input.paperPreset)) throw new Error("Invalid BIB paper preset.");
  if (input.templateType === "STICKER" && input.paperPreset !== "STICKER_4X2") throw new Error("Invalid sticker paper preset.");
  if (!Array.isArray(input.elements) || input.elements.length > 50 || !input.elements.every(validElement)) throw new Error("A design element is invalid or outside the canvas.");
  validatedPrintImage(input.backgroundDataUrl);
  if (JSON.stringify(input).length > 4_000_000) throw new Error("Template artwork is too large. Use smaller images.");
  const roster = await printRoster(eventId);
  const configured = await configuredTicketIds(roster.event.id);
  if (!configured.has(input.ticketId) && !roster.participants.some((row) => row.ticketId === input.ticketId)) throw new Error("Category is not configured for this event.");
  if (input.subcategoryId && !roster.participants.some((row) => row.ticketId === input.ticketId && row.subcategoryId === input.subcategoryId)) throw new Error("Subcategory is not present in this event roster.");
  const templates = await listPrintTemplates(roster.event.id);
  const existing = templates.find((item) => item.id === input.id);
  const now = new Date().toISOString();
  const saved: PrintTemplate = { ...input, eventId: roster.event.id, version: existing ? existing.version + 1 : 1, createdAt: existing?.createdAt ?? now, updatedAt: now, backgroundDataUrl: input.backgroundDataUrl ?? null, subcategoryId: input.subcategoryId ?? null, paperPreset: fixedPrintLayout(input.paperPreset, input.templateType).paperPreset };
  await (await kv()).put(key(roster.event.id), JSON.stringify([...templates.filter((item) => item.id !== saved.id), saved]));
  return saved;
}

export async function newPrintTemplate(eventId: string, ticketId: string, type: "BIB" | "STICKER") {
  const roster = await printRoster(eventId);
  const configured = await configuredTicketIds(roster.event.id);
  if (!configured.has(ticketId) && !roster.participants.some((row) => row.ticketId === ticketId)) throw new Error("Category not found in this event.");
  return defaultPrintTemplate(roster.event.id, ticketId, type);
}

export async function duplicatePrintTemplate(
  eventId: string,
  sourceTemplateId: string,
  targetTicketId: string,
  targetSubcategoryId: string | null = null,
): Promise<PrintTemplate> {
  const roster = await printRoster(eventId);
  const templates = await listPrintTemplates(roster.event.id);
  const source = templates.find((item) => item.id === sourceTemplateId);
  if (!source) throw new Error("The source print template was not found.");
  const configured = await configuredTicketIds(roster.event.id);
  if (!configured.has(targetTicketId) && !roster.participants.some((row) => row.ticketId === targetTicketId)) {
    throw new Error("Destination category is not configured for this event.");
  }
  if (targetSubcategoryId && !roster.participants.some((row) => row.ticketId === targetTicketId && row.subcategoryId === targetSubcategoryId)) {
    throw new Error("Destination subcategory is not present in this event roster.");
  }
  const now = new Date().toISOString();
  return savePrintTemplate(roster.event.id, {
    ...source,
    id: crypto.randomUUID(),
    ticketId: targetTicketId,
    subcategoryId: targetSubcategoryId,
    name: `${source.name} copy`,
    version: 1,
    createdAt: now,
    updatedAt: now,
  });
}

export async function auditRequest(eventId: string, path: string, method: "GET" | "POST", body?: unknown) {
  const { env } = await getCloudflareContext({ async: true });
  if (!env.VOLUNTEER_OPERATIONS) throw new Error("Print audit coordinator is unavailable.");
  const response = await env.VOLUNTEER_OPERATIONS.getByName(eventId).fetch(`https://volunteer-operations.internal/bib-print/${path}`, {
    method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json<{ ok: boolean; error?: string; records?: unknown[]; created?: unknown[] }>();
  if (!response.ok || !payload.ok) throw new Error(payload.error || "Print audit failed.");
  return payload;
}

export interface PrintBatchRequest {
  templateId: string; mode: "ALL" | "RANGE" | "SELECTED" | "NOT_PRINTED" | "REPRINT";
  selectedIds?: string[]; minBib?: string; maxBib?: string;
}

export async function resolvePrintBatch(eventId: string, request: PrintBatchRequest) {
  const roster = await printRoster(eventId);
  const template = (await listPrintTemplates(roster.event.id)).find((item) => item.id === request.templateId);
  if (!template || !template.active) throw new Error("Choose an active saved template.");
  const audits = await auditRequest(roster.event.id, "audits", "GET");
  const printed = new Set((audits.records ?? []).filter((row) => (row as { templateType?: string }).templateType === template.templateType).map((row) => (row as { participantId: string }).participantId));
  const participants = selectPrintParticipants({ roster: roster.participants, eventId: roster.event.id, ticketId: template.ticketId, subcategoryId: template.subcategoryId, mode: request.mode, selectedIds: request.selectedIds, minBib: request.minBib, maxBib: request.maxBib, previouslyPrintedIds: printed })
    .filter((row) => matchesPrintGender(row.gender, template.genderScope));
  if (!participants.length) throw new Error("No eligible participants match the selection.");
  if (new Set(participants.map((row) => row.participantId)).size !== participants.length) throw new Error("The registration roster has duplicate participant IDs. Resolve the roster before printing.");
  if (participants.length > 500) throw new Error("Limit a PDF batch to 500 participants.");
  if (template.elements.some((item) => item.kind === "ATHLETE_BAND_CODE" || item.kind === "ATHLETE_BAND_QR") && participants.some((row) => !row.athleteBandCode)) throw new Error("Assign athlete-band codes before generating this template.");
  return { event: roster.event, template, participants, audits: audits.records ?? [] };
}

export function generatePrintDocumentHtml(template: PrintTemplate, participants: PrintParticipant[]): string {
  const symbols: Record<string, string> = {};
  for (const participant of participants) for (const element of template.elements) {
    if (!["PARTICIPANT_QR", "ATHLETE_BAND_QR", "BARCODE"].includes(element.kind)) continue;
    const data = printElementText(element, participant);
    if (!data) continue;
    const lookup = `${element.kind}:${data}`;
    if (!symbols[lookup]) symbols[lookup] = bwipjs.toSVG({ bcid: element.kind === "BARCODE" ? "code128" : "qrcode", text: data, scale: 3, includetext: false });
  }
  return renderPrintHtml({ template, participants, symbolSvg: symbols });
}

export async function generatePrintPdf(template: PrintTemplate, participants: PrintParticipant[]): Promise<Uint8Array> {
  const html = generatePrintDocumentHtml(template, participants);
  const { env } = await getCloudflareContext({ async: true });
  if (!env.BROWSER) throw new Error("PDF browser binding is unavailable.");
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.evaluate(async () => {
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, 8_000));
      const assets = Promise.all([
        document.fonts.ready.then(() => undefined),
        Promise.all([...document.images].map((image) => image.complete ? Promise.resolve() : new Promise<void>((resolve) => { image.onload = () => resolve(); image.onerror = () => resolve(); }))).then(() => undefined),
      ]).then(() => undefined);
      await Promise.race([assets, timeout]);
    });
    return new Uint8Array(await page.pdf({ printBackground: true, preferCSSPageSize: true, timeout: 60_000 }));
  } finally { await browser.close(); }
}
