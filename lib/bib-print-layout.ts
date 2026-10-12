export type PrintPaperPreset = "A5" | "A4_SINGLE_A5" | "A4" | "12X18" | "12X8" | "STICKER_4X2";
export type PrintTemplateType = "BIB" | "STICKER";
export type PrintGenderScope = "ALL" | "MALE" | "FEMALE";
export const PRINT_FONT_FAMILIES = [
  "Arial, sans-serif",
  "Poppins, sans-serif",
  "\"Monument Extended\", \"Arial Black\", sans-serif",
  "\"PF Monumenta Pro\", Georgia, serif",
  "Georgia, serif",
  "Verdana, sans-serif",
  "Times New Roman, serif",
] as const;
export type PrintElementKind =
  | "BIB_NUMBER" | "PARTICIPANT_NAME" | "FIRST_NAME" | "LAST_NAME"
  | "RACE_CATEGORY" | "SUBCATEGORY" | "GENDER" | "AGE_GROUP" | "GENDER_AGE_GROUP"
  | "CLUB_NAME" | "COUNTRY_FLAG" | "TSHIRT_SIZE" | "EMERGENCY_CONTACT"
  | "TIMING_CHIP" | "ATHLETE_BAND_CODE" | "PARTICIPANT_QR" | "ATHLETE_BAND_QR"
  | "BARCODE" | "STATIC_TEXT" | "STATIC_IMAGE"
  | "RECTANGLE" | "ELLIPSE" | "LINE";

export interface PrintTemplateElement {
  id: string;
  kind: PrintElementKind;
  x: number; y: number; width: number; height: number; rotation: number;
  fontFamily: string; fontSize: number; fontWeight: number;
  italic: boolean; underline: boolean; textCase: "NONE" | "UPPER" | "LOWER";
  color: string; align: "left" | "center" | "right";
  verticalAlign: "top" | "middle" | "bottom";
  letterSpacing: number; imageFit: "contain" | "cover" | "fill";
  lineHeight?: number;
  fillColor?: string; strokeColor?: string; strokeWidth?: number; cornerRadius?: number;
  text?: string; imageDataUrl?: string;
}

export interface PrintTemplate {
  id: string;
  eventId: string;
  ticketId: string;
  subcategoryId: string | null;
  genderScope: PrintGenderScope;
  templateType: PrintTemplateType;
  active: boolean;
  version: number;
  name: string;
  paperPreset: PrintPaperPreset;
  backgroundDataUrl: string | null;
  elements: PrintTemplateElement[];
  createdAt: string;
  updatedAt: string;
}

export interface PrintParticipant {
  eventId: string;
  participantId: string;
  bookingId: string | null;
  ticketId: string;
  ticketName: string;
  subcategoryId: string | null;
  bibNumber: string;
  name: string;
  gender: string;
  ageGroup: string;
  club: string;
  country: string;
  tshirtSize: string;
  emergencyContact: string;
  chipCode: string;
  athleteBandCode: string;
  registrationStatus: string;
  active: boolean;
}

export interface PrintTemplateLayout {
  paperPreset: PrintPaperPreset;
  pageWidthMm: number; pageHeightMm: number;
  itemWidthMm: number; itemHeightMm: number;
  itemsPerPage: number;
  marginTopMm: number; marginRightMm: number; marginBottomMm: number; marginLeftMm: number;
  gapMm: number; cutLine: boolean;
  columns: number; rows: number;
}

export const TWELVE_BY_EIGHTEEN_FOUR_A5_LAYOUT: Readonly<PrintTemplateLayout> = Object.freeze({
  paperPreset: "12X18", pageWidthMm: 457.2, pageHeightMm: 304.8,
  itemWidthMm: 210, itemHeightMm: 148.5, itemsPerPage: 4,
  marginTopMm: 0, marginRightMm: 37.2, marginBottomMm: 7.8, marginLeftMm: 0,
  gapMm: 0, cutLine: true, columns: 2, rows: 2,
});

/** @deprecated Compatibility alias for callers compiled against the former preset name. */
export const TWELVE_BY_EIGHT_FOUR_BIB_LAYOUT = TWELVE_BY_EIGHTEEN_FOUR_A5_LAYOUT;

const A5: Readonly<PrintTemplateLayout> = Object.freeze({
  paperPreset: "A5", pageWidthMm: 148.5, pageHeightMm: 210,
  itemWidthMm: 210, itemHeightMm: 148.5, itemsPerPage: 1,
  marginTopMm: 0, marginRightMm: 0, marginBottomMm: 0, marginLeftMm: 0,
  gapMm: 0, cutLine: false, columns: 1, rows: 1,
});

const A4: Readonly<PrintTemplateLayout> = Object.freeze({
  paperPreset: "A4", pageWidthMm: 210, pageHeightMm: 297,
  itemWidthMm: 202, itemHeightMm: 142.5, itemsPerPage: 2,
  marginTopMm: 4, marginRightMm: 4, marginBottomMm: 4, marginLeftMm: 4,
  gapMm: 4, cutLine: true, columns: 1, rows: 2,
});

const A4_SINGLE_A5: Readonly<PrintTemplateLayout> = Object.freeze({
  paperPreset: "A4_SINGLE_A5", pageWidthMm: 210, pageHeightMm: 297,
  itemWidthMm: 210, itemHeightMm: 148.5, itemsPerPage: 1,
  marginTopMm: 74.25, marginRightMm: 0, marginBottomMm: 74.25, marginLeftMm: 0,
  gapMm: 0, cutLine: false, columns: 1, rows: 1,
});

const STICKER_4X2: Readonly<PrintTemplateLayout> = Object.freeze({
  paperPreset: "STICKER_4X2", pageWidthMm: 101.6, pageHeightMm: 50.8,
  itemWidthMm: 101.6, itemHeightMm: 50.8, itemsPerPage: 1,
  marginTopMm: 0, marginRightMm: 0, marginBottomMm: 0, marginLeftMm: 0,
  gapMm: 0, cutLine: false, columns: 1, rows: 1,
});

export function fixedPrintLayout(preset: PrintPaperPreset, type: PrintTemplateType): PrintTemplateLayout {
  if (type === "STICKER") return { ...STICKER_4X2 };
  return { ...(preset === "12X18" || preset === "12X8" ? TWELVE_BY_EIGHTEEN_FOUR_A5_LAYOUT : preset === "A4" ? A4 : preset === "A4_SINGLE_A5" ? A4_SINGLE_A5 : A5) };
}

export function printPages(participants: PrintParticipant[], layout: PrintTemplateLayout): Array<Array<PrintParticipant | null>> {
  const pages: Array<Array<PrintParticipant | null>> = [];
  for (let index = 0; index < participants.length; index += layout.itemsPerPage) {
    const page: Array<PrintParticipant | null> = participants.slice(index, index + layout.itemsPerPage);
    while (page.length < layout.itemsPerPage) page.push(null);
    pages.push(page);
  }
  return pages;
}

const naturalBib = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
export function sortParticipantsByBib<T extends Pick<PrintParticipant, "bibNumber" | "participantId">>(rows: T[]): T[] {
  return [...rows].sort((left, right) => naturalBib.compare(left.bibNumber, right.bibNumber) || left.participantId.localeCompare(right.participantId));
}

const INACTIVE_STATUS = /cancel|refund|defer|inactive|delete|transfer(?:red)?[ _-]?out|withdraw/i;
export function isPrintableParticipant(participant: PrintParticipant): boolean {
  return participant.active && Boolean(participant.participantId && participant.bibNumber && participant.ticketId)
    && !INACTIVE_STATUS.test(participant.registrationStatus);
}

export function matchesPrintGender(gender: string, scope: PrintGenderScope): boolean {
  if (scope === "ALL") return true;
  const normalized = gender.trim().toUpperCase();
  return scope === "MALE" ? ["M", "MALE", "MAN", "MEN"].includes(normalized) : ["F", "FEMALE", "WOMAN", "WOMEN"].includes(normalized);
}

export function selectPrintParticipants(input: {
  roster: PrintParticipant[]; eventId: string; ticketId: string; subcategoryId: string | null;
  mode: "ALL" | "RANGE" | "SELECTED" | "NOT_PRINTED" | "REPRINT";
  selectedIds?: string[]; minBib?: string; maxBib?: string; previouslyPrintedIds?: Set<string>;
}): PrintParticipant[] {
  const ids = new Set(input.selectedIds ?? []);
  const printed = input.previouslyPrintedIds ?? new Set<string>();
  if (["SELECTED", "NOT_PRINTED", "REPRINT"].includes(input.mode) && ids.size === 0) throw new Error("Select participant checkboxes before creating the PDF.");
  const filtered = input.roster.filter((row) => {
    if (row.eventId !== input.eventId || row.ticketId !== input.ticketId || row.subcategoryId !== input.subcategoryId || !isPrintableParticipant(row)) return false;
    if (["SELECTED", "NOT_PRINTED", "REPRINT"].includes(input.mode) && !ids.has(row.participantId)) return false;
    if (input.mode === "NOT_PRINTED" && printed.has(row.participantId)) return false;
    if (input.mode === "REPRINT" && !printed.has(row.participantId)) return false;
    if (input.mode === "RANGE") {
      const bib = Number(row.bibNumber);
      const min = Number(input.minBib);
      const max = Number(input.maxBib);
      return Number.isFinite(bib) && Number.isFinite(min) && Number.isFinite(max) && bib >= min && bib <= max;
    }
    return true;
  });
  if (ids.size && ["SELECTED", "NOT_PRINTED", "REPRINT"].includes(input.mode)) {
    const resolved = new Set(filtered.map((row) => row.participantId));
    if ([...ids].some((id) => !resolved.has(id))) throw new Error("A selected participant changed, became ineligible, or is outside this event/category. Refresh the roster.");
  }
  return sortParticipantsByBib(filtered);
}

export function defaultPrintTemplate(eventId: string, ticketId: string, type: PrintTemplateType, now = new Date().toISOString()): PrintTemplate {
  const bib = type === "BIB";
  const element = (id: string, kind: PrintElementKind, x: number, y: number, width: number, height: number, fontSize: number): PrintTemplateElement => ({
    id, kind, x, y, width, height, rotation: 0, fontFamily: "Arial, sans-serif", fontSize,
    fontWeight: kind === "BIB_NUMBER" ? 800 : 600, italic: false, underline: false,
    textCase: "NONE", color: "#111827", align: "center", verticalAlign: "middle", letterSpacing: 0, imageFit: "contain",
  });
  return {
    id: crypto.randomUUID(), eventId, ticketId, subcategoryId: null, genderScope: "ALL",
    templateType: type, active: true, version: 1, name: bib ? "Standard BIB" : "Standard sticker",
    paperPreset: bib ? "12X18" : "STICKER_4X2", backgroundDataUrl: null,
    elements: bib
      ? [element("bib", "BIB_NUMBER", 5, 20, 90, 47, 88), element("name", "PARTICIPANT_NAME", 6, 68, 88, 14, 28), element("category", "RACE_CATEGORY", 6, 84, 88, 10, 17)]
      : [element("bib", "BIB_NUMBER", 5, 9, 90, 50, 52), element("name", "PARTICIPANT_NAME", 5, 62, 90, 23, 20)],
    createdAt: now, updatedAt: now,
  };
}

/** Repair the known oversized Standard BIB box created by the former unconstrained canvas drag behavior. */
export function repairStandardA5Template(template: PrintTemplate): PrintTemplate {
  if (template.templateType !== "BIB" || template.name.trim().toLowerCase() !== "standard bib") return template;
  const bib = template.elements.find((element) => element.kind === "BIB_NUMBER");
  const matchesDamagedGeometry = Boolean(bib && bib.x > 30 && bib.y > 45 && bib.width < 75 && bib.height > 40);
  if (!bib || !matchesDamagedGeometry) return template;
  return {
    ...template,
    elements: template.elements.map((element) => element.id === bib.id
      ? { ...element, x: 5, y: 58, width: 90, height: 26, rotation: 0, align: "center", verticalAlign: "middle" }
      : element),
  };
}

export function printElementText(element: PrintTemplateElement, participant: PrintParticipant): string {
  const names = participant.name.trim().split(/\s+/);
  const countryCode = participant.country.trim().toUpperCase();
  const countryFlag = /^[A-Z]{2}$/.test(countryCode) ? [...countryCode].map((character) => String.fromCodePoint(character.charCodeAt(0) + 127397)).join("") : participant.country;
  const values: Partial<Record<PrintElementKind, string>> = {
    BIB_NUMBER: participant.bibNumber, PARTICIPANT_NAME: participant.name,
    FIRST_NAME: names[0] ?? "", LAST_NAME: names.slice(1).join(" "),
    RACE_CATEGORY: participant.ticketName || participant.ticketId, SUBCATEGORY: participant.subcategoryId ?? "",
    GENDER: participant.gender, AGE_GROUP: participant.ageGroup,
    GENDER_AGE_GROUP: [participant.gender, participant.ageGroup].filter(Boolean).join(" · "),
    CLUB_NAME: participant.club, COUNTRY_FLAG: countryFlag,
    TSHIRT_SIZE: participant.tshirtSize, EMERGENCY_CONTACT: participant.emergencyContact,
    TIMING_CHIP: participant.chipCode, ATHLETE_BAND_CODE: participant.athleteBandCode,
    PARTICIPANT_QR: participant.participantId, ATHLETE_BAND_QR: participant.athleteBandCode,
    BARCODE: participant.bibNumber, STATIC_TEXT: element.text ?? "",
  };
  const raw = values[element.kind] ?? "";
  return element.textCase === "UPPER" ? raw.toUpperCase() : element.textCase === "LOWER" ? raw.toLowerCase() : raw;
}

export function escapePrintHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export function validatedPrintImage(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value) || value.length > 2_800_000) throw new Error("Use a PNG, JPEG, or WebP image under 2 MB.");
  return value;
}

export function renderPrintHtml(input: { template: PrintTemplate; participants: PrintParticipant[]; symbolSvg?: Record<string, string> }): string {
  const { template } = input;
  const layout = fixedPrintLayout(template.paperPreset, template.templateType);
  const pages = printPages(input.participants, layout);
  const background = validatedPrintImage(template.backgroundDataUrl);
  const renderItem = (participant: PrintParticipant | null) => {
    if (!participant) return '<div class="print-item blank" aria-hidden="true"></div>';
    const elements = template.elements.map((element) => {
      const value = printElementText(element, participant);
      const font = PRINT_FONT_FAMILIES.includes(element.fontFamily as (typeof PRINT_FONT_FAMILIES)[number]) ? element.fontFamily : "Arial, sans-serif";
      const color = /^#[0-9a-fA-F]{6}$/.test(element.color) ? element.color : "#111827";
      const style = `left:${element.x}%;top:${element.y}%;width:${element.width}%;height:${element.height}%;transform:rotate(${element.rotation}deg);font-family:${font};font-size:${element.fontSize}px;font-weight:${element.fontWeight};font-style:${element.italic ? "italic" : "normal"};text-decoration:${element.underline ? "underline" : "none"};color:${color};text-align:${element.align};letter-spacing:${element.letterSpacing}px;line-height:${element.lineHeight ?? 1.05};justify-content:${element.verticalAlign === "top" ? "flex-start" : element.verticalAlign === "bottom" ? "flex-end" : "center"};`;
      if (["RECTANGLE", "ELLIPSE", "LINE"].includes(element.kind)) {
        const fill = /^#[0-9a-fA-F]{6}$/.test(element.fillColor ?? "") ? element.fillColor : "#ffffff";
        const stroke = /^#[0-9a-fA-F]{6}$/.test(element.strokeColor ?? "") ? element.strokeColor : "#111827";
        const strokeWidth = Math.min(30, Math.max(0, element.strokeWidth ?? 1));
        const radius = element.kind === "ELLIPSE" ? "50%" : `${Math.min(100, Math.max(0, element.cornerRadius ?? 0))}%`;
        const shape = element.kind === "LINE"
          ? `height:0;border-top:${Math.max(1, strokeWidth)}px solid ${stroke};`
          : `height:100%;background:${fill};border:${strokeWidth}px solid ${stroke};border-radius:${radius};`;
        return `<div class="print-element print-shape" style="${style}"><span style="display:block;width:100%;${shape}"></span></div>`;
      }
      if (element.kind === "STATIC_IMAGE") {
        const image = validatedPrintImage(element.imageDataUrl);
        return image ? `<div class="print-element" style="${style}"><img src="${image}" style="object-fit:${element.imageFit}" /></div>` : "";
      }
      if (["PARTICIPANT_QR", "ATHLETE_BAND_QR", "BARCODE"].includes(element.kind)) {
        const symbol = input.symbolSvg?.[`${element.kind}:${value}`] ?? "";
        return `<div class="print-element print-symbol" style="${style}">${symbol}</div>`;
      }
      return `<div class="print-element" style="${style}">${escapePrintHtml(value)}</div>`;
    }).join("");
    return `<div class="print-item" data-participant-id="${escapePrintHtml(participant.participantId)}">${elements}</div>`;
  };
  const fourUp = layout.paperPreset === "12X18";
  const rotateSingleBib = layout.paperPreset === "A5" || layout.paperPreset === "A4_SINGLE_A5";
  return `<!doctype html><html><head><meta charset="utf-8" /><style>
    @import url("https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900&display=swap");
    @page { size: ${layout.pageWidthMm}mm ${layout.pageHeightMm}mm; margin: 0; }
    * { box-sizing: border-box; } html,body { width:${layout.pageWidthMm}mm; margin:0; padding:0; background:white; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    .print-page { position:relative; width:${layout.pageWidthMm}mm; height:${layout.pageHeightMm}mm; padding:${layout.marginTopMm}mm ${layout.marginRightMm}mm ${layout.marginBottomMm}mm ${layout.marginLeftMm}mm; gap:${layout.gapMm}mm; background:white; overflow:hidden; break-after:page; page-break-after:always; display:grid; grid-template-columns:repeat(${layout.columns}, ${layout.itemWidthMm}mm); grid-template-rows:repeat(${layout.rows}, ${layout.itemHeightMm}mm); }
    .print-page.four-up { display:block; }
    .print-page.four-up > .print-item { position:absolute; width:${layout.itemWidthMm}mm; height:${layout.itemHeightMm}mm; }
    .print-page.four-up > .print-item:nth-child(1) { left:0; top:0; }
    .print-page.four-up > .print-item:nth-child(2) { left:${layout.itemWidthMm}mm; top:0; }
    .print-page.four-up > .print-item:nth-child(3) { left:0; top:${layout.itemHeightMm}mm; }
    .print-page.four-up > .print-item:nth-child(4) { left:${layout.itemWidthMm}mm; top:${layout.itemHeightMm}mm; }
    .print-page.rotated-single > .print-item { position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) rotate(-90deg);transform-origin:center; }
    .print-page:last-child { break-after:auto; page-break-after:auto; }
    .print-item { position:relative; width:${layout.itemWidthMm}mm; height:${layout.itemHeightMm}mm; overflow:hidden; background-color:white;${background ? `background-image:url("${background}");background-position:center;background-size:cover;background-repeat:no-repeat;` : ""} }
    .print-item.blank { background-image:none; }
    .print-element { position:absolute; display:flex; flex-direction:column; align-items:stretch; overflow:hidden; white-space:pre-wrap; }
    .print-element img,.print-symbol svg { display:block; width:100%; height:100%; }
    .cut-guide { position:absolute; z-index:10; pointer-events:none; opacity:.65; }
    .cut-guide.vertical { left:${fourUp ? layout.itemWidthMm : layout.marginLeftMm + layout.itemWidthMm}mm; top:${layout.marginTopMm}mm; height:${layout.itemHeightMm * layout.rows + layout.gapMm * Math.max(0, layout.rows - 1)}mm; border-left:.18mm dashed #777; }
    .cut-guide.horizontal { top:${fourUp ? layout.itemHeightMm : layout.pageHeightMm / 2}mm; left:${layout.marginLeftMm}mm; width:${layout.itemWidthMm * layout.columns + layout.gapMm * Math.max(0, layout.columns - 1)}mm; border-top:.18mm dashed #777; }
    </style></head><body>${pages.map((page, index) => `<div class="print-page${fourUp ? " four-up" : ""}${rotateSingleBib ? " rotated-single" : ""}" data-page="${index + 1}">${page.map(renderItem).join("")}${layout.cutLine && layout.columns === 2 ? '<i class="cut-guide vertical"></i>' : ""}${layout.cutLine && layout.rows === 2 ? '<i class="cut-guide horizontal"></i>' : ""}</div>`).join("")}</body></html>`;
}
