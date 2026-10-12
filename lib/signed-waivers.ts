import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { KVNamespace, R2Bucket } from "@cloudflare/workers-types";
import puppeteer, { type BrowserWorker } from "@cloudflare/puppeteer";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { Buffer } from "node:buffer";
import sanitizeHtml from "sanitize-html";
import type { FirebaseAthleteIdentity } from "./firebase-auth-server";
import { sendBergtecnoEmail, textToEmailHtml } from "./bergtecno-email";
import { dispatchCounterNotifications, readCounterTemplate } from "./counter-notifications";
import { signedWaiverConfirmationEmail } from "./waiver-confirmation-email";
import { getAdminParticipantRoster } from "./participant-chip-assignments";
import { updateParticipantRosterRegistration, updateParticipantRosterRegistrations, type ParticipantRosterRow } from "./participant-roster-import";
import { getEventBySlug, getEvents } from "./raceupshot-repository";
import type { VolunteerOperationLog } from "./volunteer-management";
import { renderWaiverTemplate, type WaiverParameterMapping } from "./waiver-template";
import { eventDocumentSrcDoc } from "./event-document";

const PREFIX = "raceupshot:waivers";
const OTP_SECONDS = 5 * 60;
const MAX_ATTEMPTS = 5;

type JsonRecord = Record<string, unknown>;

interface WaiverOtpRecord {
  eventId: string;
  participantId: string;
  athleteUid: string;
  email: string;
  signatureName: string;
  codeHash: string;
  createdAt: number;
  expiresAt: number;
  attempts: number;
}

export interface AthleteWaiverSummary {
  eventId: string;
  eventSlug: string;
  eventName: string;
  eventDate: string;
  eventLocation: string;
  participantId: string;
  bib: string;
  category: string;
  waiverVersion: string;
  signedAt: string | null;
  signatureName: string | null;
  documentUrl: string | null;
  relayTeam: RelayWaiverTeam | null;
}

export interface RelayWaiverTeam {
  bib: string;
  name: string;
  size: 2 | 3;
  completed: boolean;
  completedMembers: number;
  members: Array<{
    participantId: string;
    name: string;
    email: string;
    role: string;
    memberNumber: number;
    signedAt: string | null;
    completed: boolean;
  }>;
}

function value(row: JsonRecord, ...keys: string[]): string {
  for (const key of keys) {
    const candidate = row[key];
    if (candidate !== undefined && candidate !== null && String(candidate).trim()) return String(candidate).trim();
  }
  return "";
}

function participantId(row: JsonRecord): string {
  return value(row, "participantUid", "participantUuid", "participant_uuid", "providerParticipantUuid", "uuid", "id");
}

function relayWaiverTeam(row: JsonRecord, rows: JsonRecord[]): RelayWaiverTeam | null {
  if (value(row, "participationMode", "contestParticipationType").toUpperCase() !== "RELAY") return null;
  const teamId = value(row, "relayTeamId");
  const teamBib = value(row, "bib", "bibNumber", "bib_number");
  const members = rows.filter((candidate) => value(candidate, "participationMode", "contestParticipationType").toUpperCase() === "RELAY"
    && (teamId ? value(candidate, "relayTeamId") === teamId : value(candidate, "bib", "bibNumber", "bib_number") === teamBib))
    .map((member) => {
      const signedAt = value(member, "waiverSignedAt", "waiverVerifiedAt") || null;
      return {
        participantId: participantId(member),
        name: value(member, "fullName", "name", "athleteName") || "Athlete",
        email: value(member, "email", "emailAddress", "athleteEmail"),
        role: value(member, "relayMemberRole"),
        memberNumber: Number(value(member, "relayMemberNumber")) || 0,
        signedAt,
        completed: Boolean(signedAt),
      };
    }).sort((left, right) => left.memberNumber - right.memberNumber);
  const configuredSize = Number(value(row, "relayTeamSize"));
  const size = configuredSize === 3 ? 3 : 2;
  const completedMembers = members.filter((member) => member.completed).length;
  return {
    bib: teamBib,
    name: value(row, "relayTeamName") || `Relay Team ${teamBib}`,
    size,
    completed: members.length === size && completedMembers === size,
    completedMembers,
    members,
  };
}

function relayRosterHtml(team: RelayWaiverTeam | null): string {
  if (!team) return "";
  const members = team.members.map((member) => `<li><strong>${escapePdfHtml(member.name)}</strong>${member.role ? ` — ${escapePdfHtml(member.role)}` : ""}<br><span>${escapePdfHtml(member.email)}</span></li>`).join("");
  return `<section class="raceupshot-relay-team"><h2>RELAY TEAM WAIVER</h2><p><strong>Team Bib:</strong> ${escapePdfHtml(team.bib)}<br><strong>Team Name:</strong> ${escapePdfHtml(team.name)}<br><strong>Registered Athletes:</strong> ${team.members.length} of ${team.size}</p><ol>${members}</ol><p>Each registered athlete must acknowledge and sign this waiver individually.</p></section>`;
}

function belongsToAthlete(row: JsonRecord, athlete: FirebaseAthleteIdentity): boolean {
  const email = athlete.emailVerified ? (athlete.email || "").trim().toLowerCase() : "";
  const rowEmail = value(row, "email", "emailAddress", "athleteEmail", "participantEmail", "registrationEmail").toLowerCase();
  if (email && rowEmail === email) return true;
  const ids = ["athleteUid", "accountUid", "firebaseUid", "firebaseUserUid", "userUid", "userId"]
    .map((key) => value(row, key)).filter(Boolean);
  return ids.includes(athlete.uid);
}

async function bindings(): Promise<{ kv: KVNamespace; media: R2Bucket; secret: string; browser?: BrowserWorker }> {
  const { env } = await getCloudflareContext({ async: true });
  if (!env.RACEUPSHOT) throw new Error("RACEUPSHOT KV binding is unavailable.");
  if (!env.EVENT_MEDIA) throw new Error("EVENT_MEDIA R2 binding is unavailable.");
  const secret = env.ATHLETE_SESSION_SECRET || env.ADMIN_SESSION_SECRET || "";
  if (!secret) throw new Error("Athlete waiver signing is not configured.");
  return { kv: env.RACEUPSHOT, media: env.EVENT_MEDIA, secret, browser: env.BROWSER };
}

async function sha256(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : Uint8Array.from(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmac(valueToSign: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(valueToSign));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function secureCode(): string {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return String(values[0] % 1_000_000).padStart(6, "0");
}

function safeSegment(valueToEncode: string): string {
  return encodeURIComponent(valueToEncode).replaceAll("%", "_");
}

async function otpKey(eventId: string, participantIdValue: string, athleteUid: string): Promise<string> {
  return `${PREFIX}:otp:${await sha256(`${eventId}:${participantIdValue}:${athleteUid}`)}`;
}

async function exactRegistration(eventIdOrSlug: string, athlete: FirebaseAthleteIdentity, requestedParticipantId?: string) {
  if (!athlete.emailVerified) throw new Error("Verify your email before signing a waiver.");
  const roster = await getAdminParticipantRoster(eventIdOrSlug);
  if (!roster) throw new Error("Event not found.");
  const owned = roster.rows.filter((row) => belongsToAthlete(row, athlete));
  const row = requestedParticipantId
    ? owned.find((candidate) => participantId(candidate) === requestedParticipantId)
    : owned.length === 1 ? owned[0] : null;
  if (!row) throw new Error(owned.length > 1
    ? "Choose the exact event registration before signing."
    : "No matching participant registration was found for this athlete account.");
  return { roster, row, participantId: participantId(row) };
}

type WaiverPdfBlock = { kind: "title" | "heading" | "subheading" | "paragraph" | "list"; text: string };

function decodedPdfText(valueToDecode: string): string {
  return valueToDecode
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\r/g, "");
}

export function waiverPdfBlocks(html: string): WaiverPdfBlock[] {
  const marked = html
    .replace(/<(head|style|script)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<h1\b[^>]*>/gi, "\n[[TITLE]]").replace(/<\/h1\s*>/gi, "\n")
    .replace(/<h2\b[^>]*>/gi, "\n[[HEADING]]").replace(/<\/h2\s*>/gi, "\n")
    .replace(/<h[3-6]\b[^>]*>/gi, "\n[[SUBHEADING]]").replace(/<\/h[3-6]\s*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n[[LIST]]").replace(/<\/li\s*>/gi, "\n")
    .replace(/<\/(p|div|tr|section|article|header|footer)\s*>/gi, "\n");
  const text = decodedPdfText(sanitizeHtml(marked, { allowedTags: [], allowedAttributes: {} }))
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ");
  return text.split("\n").map((line) => line.trim()).filter(Boolean).map((line): WaiverPdfBlock => {
    if (line.startsWith("[[TITLE]]")) return { kind: "title", text: line.slice(9).trim() };
    if (line.startsWith("[[HEADING]]")) return { kind: "heading", text: line.slice(11).trim() };
    if (line.startsWith("[[SUBHEADING]]")) return { kind: "subheading", text: line.slice(14).trim() };
    if (line.startsWith("[[LIST]]")) return { kind: "list", text: line.slice(8).trim() };
    return { kind: "paragraph", text: line };
  }).filter((block) => Boolean(block.text));
}

function ascii(valueToClean: string): string {
  return valueToClean.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "?");
}

function wrap(text: string, maxWidth: number, width: (value: string) => number): string[] {
  const output: string[] = [];
  for (const paragraph of ascii(text).split("\n")) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!words.length) { output.push(""); continue; }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && width(candidate) > maxWidth) { output.push(line); line = word; }
      else line = candidate;
    }
    if (line) output.push(line);
  }
  return output;
}

function escapePdfHtml(valueToEscape: string): string {
  return valueToEscape.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] || character);
}

async function createBrowserWaiverPdf(input: Parameters<typeof createWaiverPdf>[0] & { browser: BrowserWorker }): Promise<Uint8Array> {
  const verification = `<section class="raceupshot-signature-record">
    <h2>${escapePdfHtml(input.verificationHeading || "ELECTRONIC SIGNATURE")}</h2>
    <p><strong>${escapePdfHtml(input.identityLabel || "Signed by")}:</strong> ${escapePdfHtml(input.signatureName)}</p>
    <p><strong>Verified at:</strong> ${escapePdfHtml(new Date(input.signedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }))} IST</p>
    <p><strong>Identity verification:</strong> ${escapePdfHtml(input.identityVerification || "six-digit email OTP confirmed")}</p>
    <p><strong>Audit ID:</strong> ${escapePdfHtml(input.auditId)}</p>
  </section>`;
  const printStyles = `<style>
    @page{size:A4;margin:12mm}
    html,body{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
    img,svg{max-width:100%;height:auto}
    .raceupshot-signature-record{break-inside:avoid;page-break-inside:avoid;margin-top:28px;padding:18px 20px;border:1px solid #cbd5e1;border-left:5px solid #00a651;border-radius:8px;background:#f8fafc;color:#0f172a;font:12px/1.55 Arial,sans-serif}
    .raceupshot-signature-record h2{margin:0 0 10px;color:#006b3c;font-size:16px}
    .raceupshot-signature-record p{margin:4px 0}
  </style>`;
  let html = eventDocumentSrcDoc(input.waiverHtml);
  html = /<\/head\s*>/i.test(html) ? html.replace(/<\/head\s*>/i, `${printStyles}</head>`) : `${printStyles}${html}`;
  html = /<\/body\s*>/i.test(html) ? html.replace(/<\/body\s*>/i, `${verification}</body>`) : `${html}${verification}`;

  const browser = await puppeteer.launch(input.browser);
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);
    const pdf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
    return Uint8Array.from(pdf);
  } finally {
    await browser.close();
  }
}

export async function createWaiverPdf(input: {
  waiverHtml: string;
  waiverVersion: string;
  auditId: string;
  signedAt: string;
  signatureName: string;
  athleteEmail: string;
  eventName: string;
  eventDate: string;
  eventLocation: string;
  bib: string;
  category: string;
  documentTitle?: string;
  verificationHeading?: string;
  identityLabel?: string;
  identityVerification?: string;
  browser?: BrowserWorker;
}): Promise<Uint8Array> {
  if (input.browser) {
    try {
      return await createBrowserWaiverPdf({ ...input, browser: input.browser });
    } catch (error) {
      console.error(JSON.stringify({
        type: "styled_waiver_pdf_render_failed",
        eventName: input.eventName,
        auditId: input.auditId,
        error: error instanceof Error ? error.message : "Unknown browser rendering failure",
      }));
    }
  }
  const document = await PDFDocument.create();
  document.setTitle(`${input.documentTitle || "Signed waiver"} - ${input.eventName} - BIB ${input.bib}`);
  document.setAuthor("Race Upshot");
  document.setSubject(`Waiver ${input.waiverVersion || "current"}; audit ${input.auditId}`);
  document.setCreationDate(new Date(input.signedAt));
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const pageSize: [number, number] = [595.28, 841.89];
  const margin = 50;
  const footerHeight = 24;
  const contentWidth = pageSize[0] - margin * 2;
  let page = document.addPage(pageSize);
  let y = pageSize[1] - margin;
  const addContinuationPage = () => {
    page = document.addPage(pageSize);
    y = pageSize[1] - margin;
    page.drawText("RACE UPSHOT  /  SIGNED WAIVER", { x: margin, y, size: 8, font: bold, color: rgb(0.05, 0.48, 0.28) });
    page.drawLine({ start: { x: margin, y: y - 8 }, end: { x: pageSize[0] - margin, y: y - 8 }, thickness: 0.75, color: rgb(0.82, 0.88, 0.85) });
    y -= 28;
  };
  const ensureSpace = (height: number) => {
    if (y - height < margin + footerHeight) addContinuationPage();
  };
  const addLine = (line: string, options: { size?: number; font?: typeof regular; color?: ReturnType<typeof rgb>; gap?: number; indent?: number } = {}) => {
    const size = options.size ?? 10;
    ensureSpace(options.gap ?? size + 5);
    page.drawText(ascii(line), { x: margin + (options.indent ?? 0), y, size, font: options.font ?? regular, color: options.color ?? rgb(0.08, 0.12, 0.16) });
    y -= options.gap ?? size + 5;
  };
  const addWrapped = (text: string, options: { size?: number; font?: typeof regular; color?: ReturnType<typeof rgb>; lineHeight?: number; before?: number; after?: number; indent?: number; keepWithNext?: boolean } = {}) => {
    const size = options.size ?? 9.5;
    const font = options.font ?? regular;
    const lineHeight = options.lineHeight ?? 13.5;
    const indent = options.indent ?? 0;
    const lines = wrap(text, contentWidth - indent, (candidate) => font.widthOfTextAtSize(candidate, size));
    if (options.keepWithNext) ensureSpace((options.before ?? 0) + lineHeight * Math.min(Math.max(lines.length, 1) + 2, 4));
    y -= options.before ?? 0;
    lines.forEach((line) => addLine(line, { size, font, color: options.color, gap: lineHeight, indent }));
    y -= options.after ?? 0;
  };
  addLine("RACE UPSHOT", { size: 11, font: bold, color: rgb(0, 0.55, 0.35), gap: 22 });
  addLine(input.documentTitle || "SIGNED WAIVER & INDEMNITY DECLARATION", { size: 17, font: bold, gap: 25 });
  [
    ["Event", input.eventName], ["Event date", input.eventDate || "Not recorded"],
    ["Location", input.eventLocation || "Not recorded"], ["Athlete", input.signatureName],
    ["Email", input.athleteEmail], ["BIB", input.bib || "Not assigned"],
    ["Category", input.category || "Not recorded"], ["Waiver version", input.waiverVersion || "Current"],
  ].forEach(([label, fieldValue]) => addLine(`${label}: ${fieldValue}`, { font: bold, gap: 16 }));
  y -= 12;
  const blocks = waiverPdfBlocks(input.waiverHtml);
  for (const block of blocks.length ? blocks : [{ kind: "paragraph" as const, text: "No waiver text was configured." }]) {
    if (block.kind === "title") addWrapped(block.text, { size: 15, font: bold, color: rgb(0.02, 0.39, 0.25), lineHeight: 19, before: 8, after: 9, keepWithNext: true });
    else if (block.kind === "heading") addWrapped(block.text, { size: 11.5, font: bold, color: rgb(0.03, 0.24, 0.34), lineHeight: 15, before: 10, after: 5, keepWithNext: true });
    else if (block.kind === "subheading") addWrapped(block.text, { size: 10.25, font: bold, color: rgb(0.08, 0.12, 0.16), lineHeight: 14, before: 7, after: 3, keepWithNext: true });
    else if (block.kind === "list") addWrapped(`- ${block.text}`, { size: 9.25, lineHeight: 13, after: 3, indent: 12 });
    else addWrapped(block.text, { size: 9.25, lineHeight: 13, after: 7 });
  }
  ensureSpace(120);
  y -= 12;
  addLine(input.verificationHeading || "ELECTRONIC SIGNATURE", { size: 12, font: bold, gap: 20 });
  addLine(`${input.identityLabel || "Signed by"}: ${input.signatureName}`, { size: 11, font: bold });
  addLine(`Verified at: ${new Date(input.signedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`);
  addLine(`Identity verification: ${input.identityVerification || "six-digit email OTP confirmed"}`);
  addLine(`Audit ID: ${input.auditId}`);
  const pages = document.getPages();
  pages.forEach((pdfPage, index) => {
    const footer = `Race Upshot  |  Audit ${input.auditId}  |  Page ${index + 1} of ${pages.length}`;
    pdfPage.drawLine({ start: { x: margin, y: 38 }, end: { x: pageSize[0] - margin, y: 38 }, thickness: 0.6, color: rgb(0.84, 0.87, 0.89) });
    pdfPage.drawText(footer, { x: margin, y: 24, size: 7.5, font: regular, color: rgb(0.38, 0.45, 0.49) });
  });
  return document.save({ useObjectStreams: false });
}

export async function createVolunteerWaiverCheckInRecord(input: {
  event: {
    id: string; name: string; date: string; location: string; waiverHtml: string;
    waiverVersion?: string; waiverParameterMappings?: WaiverParameterMapping[];
    organizer?: string; companyDescription?: string; organizerAddress?: string; jurisdiction?: string;
  };
  participant: {
    id: string; name: string; email: string | null; mobile: string | null; address: string | null;
    emergencyContact: string | null; bib: string; category: string;
    participantId?: string;
    relayTeam?: RelayWaiverTeam | null;
  };
  registrations?: Array<{ registrationId: string; bib: string; category: string; sessionName?: string | null }>;
  waiverId?: string;
  verifiedAt: string;
  volunteerId: string;
  volunteerName: string;
  signerName?: string;
  signerRelationship?: string;
  origin: string;
}): Promise<{
  participant: ParticipantRosterRow;
  documentUrl: string;
  documentHash: string;
  waiverId: string;
  emailAttachment: { filename: string; contentType: string; data: string };
}> {
  const { event, participant } = input;
  const email = participant.email?.trim().toLowerCase() || "";
  if (!email) throw new Error("A verified athlete email is required to create the waiver check-in record.");
  const { kv, media, secret, browser } = await bindings();
  const auditId = input.waiverId?.trim() || crypto.randomUUID();
  const registrations = input.registrations?.length
    ? input.registrations
    : [{ registrationId: participant.id, bib: participant.bib, category: participant.category, sessionName: null }];
  const profileParticipantId = participant.participantId?.trim() || participant.id;
  const signerName = input.signerName?.trim() || participant.name;
  const signerRelationship = input.signerRelationship?.trim() || "SELF";
  const coverageHtml = `<section class="raceupshot-waiver-coverage"><h2>COVERED REGISTRATIONS</h2><p><strong>Participant ID:</strong> ${escapePdfHtml(profileParticipantId)}</p><ol>${registrations.map((registration) => `<li><strong>${escapePdfHtml(registration.category || "Registration")}</strong>${registration.sessionName ? ` — ${escapePdfHtml(registration.sessionName)}` : ""}<br>Registration ID: ${escapePdfHtml(registration.registrationId)} · BIB: ${escapePdfHtml(registration.bib || "—")}</li>`).join("")}</ol></section>`;
  const verifiedDate = new Date(input.verifiedAt);
  const renderedWaiver = coverageHtml + relayRosterHtml(participant.relayTeam || null) + renderWaiverTemplate(event.waiverHtml, {
    name: participant.name,
    email,
    mobile: participant.mobile || "",
    address: participant.address || "",
    emergency_contact: participant.emergencyContact || "",
    event_name: event.name,
    race_category: participant.category,
    event_date: event.date,
    bib_number: participant.bib,
    signed_at: input.verifiedAt,
    waiver_id: auditId,
    waiver_version: event.waiverVersion || "",
    signature_name: signerName,
    day: new Intl.DateTimeFormat("en-IN", { day: "numeric", timeZone: "Asia/Kolkata" }).format(verifiedDate),
    date: new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "Asia/Kolkata" }).format(verifiedDate),
    organizer_name: event.organizer || "Race Upshot",
    company_description: event.companyDescription || event.organizer || "Event organiser",
    organizer_address: event.organizerAddress || "",
    country: "India",
    jurisdiction: event.jurisdiction || "",
  }, event.waiverParameterMappings || []);
  const pdf = await createWaiverPdf({
    waiverHtml: renderedWaiver,
    waiverVersion: event.waiverVersion || "",
    auditId,
    signedAt: input.verifiedAt,
    signatureName: signerName,
    athleteEmail: email,
    eventName: event.name,
    eventDate: event.date,
    eventLocation: event.location,
    bib: participant.bib,
    category: registrations.map((registration) => [registration.category, registration.sessionName].filter(Boolean).join(" · ")).join("; "),
    documentTitle: "SIGNED CONSOLIDATED WAIVER RECORD",
    verificationHeading: "OTP VERIFICATION RECORD",
    identityLabel: "Verified athlete",
    identityVerification: `six-digit email OTP confirmed; signer relationship ${signerRelationship}; witnessed by assigned volunteer ${input.volunteerName}`,
    browser,
  });
  const documentHash = await sha256(pdf);
  const objectKey = `signed-waivers/${safeSegment(event.id)}/${safeSegment(profileParticipantId)}/${auditId}.pdf`;
  await media.put(objectKey, pdf, {
    httpMetadata: { contentType: "application/pdf", cacheControl: "private, no-store" },
    customMetadata: { eventId: event.id, participantId: profileParticipantId, auditId, signedAt: input.verifiedAt, sha256: documentHash },
  });
  const url = await documentUrl(input.origin, objectKey, secret);
  let updatedRows: ParticipantRosterRow[];
  try {
    const patch = {
        waiverStatus: "OTP_VERIFIED",
        waiverSignedAt: input.verifiedAt,
        waiverVerifiedAt: input.verifiedAt,
        waiverResetAt: null,
        waiverResetBy: null,
        waiverVersion: event.waiverVersion || "",
        waiverSignatureName: signerName,
        signatureName: signerName,
        waiverSignerRelationship: signerRelationship,
        waiverDocumentKey: objectKey,
        waiverDocumentUrl: url,
        waiverDocumentSha256: documentHash,
        waiverAuditId: auditId,
        waiverCoveredRegistrationIds: registrations.map((registration) => registration.registrationId),
      } satisfies ParticipantRosterRow;
    updatedRows = input.registrations?.length
      ? await updateParticipantRosterRegistrations({ kv, eventId: event.id, registrationIds: registrations.map((registration) => registration.registrationId), patch })
      : [await updateParticipantRosterRegistration({ kv, eventId: event.id, participantId: participant.id, patch })];
  } catch (error) {
    await media.delete(objectKey);
    throw error;
  }
  await kv.put(`${PREFIX}:audit:${auditId}`, JSON.stringify({
    schemaVersion: 1,
    auditId,
    eventId: event.id,
    participantId: profileParticipantId,
    registrationIds: registrations.map((registration) => registration.registrationId),
    athleteEmail: email,
    signatureName: signerName,
    signerRelationship,
    waiverVersion: event.waiverVersion || "",
    signedAt: input.verifiedAt,
    documentKey: objectKey,
    documentSha256: documentHash,
    identityMethod: "EMAIL_OTP_VOLUNTEER_ASSISTED",
    verifiedByVolunteerId: input.volunteerId,
    verifiedByVolunteerName: input.volunteerName,
    evidenceHash: await hmac(`${event.id}:${profileParticipantId}:${input.volunteerId}:${input.verifiedAt}`, secret),
  }));
  return {
    participant: updatedRows[0],
    documentUrl: url,
    documentHash,
    waiverId: auditId,
    emailAttachment: { filename: "waiver-check-in-record.pdf", contentType: "application/pdf", data: Buffer.from(pdf).toString("base64") },
  };
}

async function documentUrl(origin: string, key: string, secret: string): Promise<string> {
  const signature = await hmac(key, secret);
  const url = new URL("/api/v1/waivers/document", origin);
  url.searchParams.set("key", key);
  url.searchParams.set("signature", signature);
  return url.href;
}

export async function verifyWaiverDocumentAccess(key: string, signature: string): Promise<boolean> {
  if (!key.startsWith("signed-waivers/") || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const { secret } = await bindings();
  return safeEqual(signature, await hmac(key, secret));
}

export async function getWaiverDocument(key: string) {
  const { media } = await bindings();
  return media.get(key);
}

export async function listAthleteWaivers(athlete: FirebaseAthleteIdentity): Promise<AthleteWaiverSummary[]> {
  if (!athlete.emailVerified) return [];
  const events = await getEvents({ includeUnpublished: false });
  const records = await Promise.all(events.filter((event) => Boolean(event.waiverHtml)).map(async (event) => {
    const roster = await getAdminParticipantRoster(event.id);
    const rows = roster?.rows ?? [];
    return rows.filter((row) => belongsToAthlete(row, athlete)).map((row): AthleteWaiverSummary => ({
      eventId: event.id,
      eventSlug: event.slug,
      eventName: event.name,
      eventDate: event.date,
      eventLocation: event.location,
      participantId: participantId(row),
      bib: value(row, "bib", "bibNumber", "bib_number"),
      category: value(row, "category", "contestName", "ticketName"),
      waiverVersion: event.waiverVersion || "",
      signedAt: value(row, "waiverSignedAt", "waiverVerifiedAt") || null,
      signatureName: value(row, "waiverSignatureName", "signatureName") || null,
      documentUrl: value(row, "waiverDocumentUrl", "signedWaiverUrl", "waiverPdfUrl", "waiver_url") || null,
      relayTeam: relayWaiverTeam(row, rows),
    }));
  }));
  return records.flat();
}

export async function requestWaiverOtp(input: {
  athlete: FirebaseAthleteIdentity;
  eventId: string;
  participantId: string;
  signatureName: string;
}) {
  const event = await getEventBySlug(input.eventId, { includeUnpublished: false });
  if (!event?.waiverHtml) throw new Error("This event does not have a waiver available for signing.");
  const registration = await exactRegistration(event.id, input.athlete, input.participantId);
  const email = (input.athlete.email || "").trim().toLowerCase();
  if (!email) throw new Error("A verified email address is required.");
  const signatureName = input.signatureName.trim();
  if (signatureName.length < 2 || signatureName.length > 120) throw new Error("Enter the athlete's full legal name.");
  const { kv, secret } = await bindings();
  const key = await otpKey(event.id, registration.participantId, input.athlete.uid);
  const existing = await kv.get<WaiverOtpRecord>(key, "json");
  const now = Math.floor(Date.now() / 1000);
  if (existing && now - existing.createdAt < 60) throw new Error(`Please wait ${60 - (now - existing.createdAt)} seconds before requesting another OTP.`);
  const code = secureCode();
  const record: WaiverOtpRecord = {
    eventId: event.id, participantId: registration.participantId, athleteUid: input.athlete.uid,
    email, signatureName, codeHash: await sha256(`${email}:${code}:${secret}`),
    createdAt: now, expiresAt: now + OTP_SECONDS, attempts: 0,
  };
  await kv.put(key, JSON.stringify(record), { expirationTtl: OTP_SECONDS + 60 });
  const delivery = await sendBergtecnoEmail({
    recipientEmail: email,
    subject: `${code} is your ${event.name} waiver verification code`,
    html: textToEmailHtml(`Hello ${signatureName},\n\nUse OTP ${code} to electronically sign the ${event.name} waiver. This code expires in 5 minutes.\n\nIf you did not request this, do not share the code.`),
    singleAttempt: true,
  });
  if (!delivery.sent) { await kv.delete(key); throw new Error(delivery.error || "The waiver OTP email could not be sent."); }
  return { requested: true, participantId: registration.participantId, expiresInSeconds: OTP_SECONDS };
}

export async function verifyAndSignWaiver(input: {
  athlete: FirebaseAthleteIdentity;
  eventId: string;
  participantId: string;
  otp: string;
  origin: string;
  evidence: string;
}) {
  const event = await getEventBySlug(input.eventId, { includeUnpublished: false });
  if (!event?.waiverHtml) throw new Error("This event does not have a waiver available for signing.");
  const registration = await exactRegistration(event.id, input.athlete, input.participantId);
  const { kv, media, secret, browser } = await bindings();
  const key = await otpKey(event.id, registration.participantId, input.athlete.uid);
  const record = await kv.get<WaiverOtpRecord>(key, "json");
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!record || record.expiresAt <= nowSeconds || record.email !== input.athlete.email?.trim().toLowerCase()) {
    if (record) await kv.delete(key);
    throw new Error("This waiver OTP has expired. Request a new code.");
  }
  if (record.attempts >= MAX_ATTEMPTS) { await kv.delete(key); throw new Error("Too many incorrect attempts. Request a new waiver OTP."); }
  const supplied = await sha256(`${record.email}:${input.otp}:${secret}`);
  if (!safeEqual(supplied, record.codeHash)) {
    record.attempts += 1;
    await kv.put(key, JSON.stringify(record), { expirationTtl: Math.max(60, record.expiresAt - nowSeconds) });
    throw new Error("The waiver OTP is incorrect.");
  }

  const signedAt = new Date().toISOString();
  const auditId = crypto.randomUUID();
  const row = registration.row;
  const bib = value(row, "bib", "bibNumber", "bib_number");
  const category = value(row, "category", "contestName", "ticketName");
  const team = relayWaiverTeam(row, registration.roster.rows);
  const signedDate = new Date(signedAt);
  const renderedWaiver = relayRosterHtml(team) + renderWaiverTemplate(event.waiverHtml, {
    name: value(row, "fullName", "name", "athleteName") || record.signatureName,
    email: record.email,
    mobile: value(row, "mobile", "mobileNumber", "phone", "phoneNumber"),
    address: value(row, "address", "addressLine1", "streetAddress"),
    emergency_contact: value(row, "emergencyContact", "emergency_contact", "emergencyMobile", "emergencyPhone"),
    event_name: event.name,
    race_category: category,
    event_date: event.date,
    bib_number: bib,
    signed_at: signedAt,
    waiver_id: auditId,
    waiver_version: event.waiverVersion || "",
    signature_name: record.signatureName,
    day: new Intl.DateTimeFormat("en-IN", { day: "numeric", timeZone: "Asia/Kolkata" }).format(signedDate),
    date: new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "Asia/Kolkata" }).format(signedDate),
    organizer_name: event.organizer || "Race Upshot",
    company_description: event.companyDescription || event.organizer || "Event organiser",
    // Never substitute the event venue for the organiser's registered address.
    // Leave an unset organiser address unresolved so it is visible for correction.
    organizer_address: event.organizerAddress || "",
    country: "India",
    jurisdiction: event.jurisdiction || "",
    team_name: team?.name || "",
    team_bib: team?.bib || bib,
    team_members: team?.members.map((member) => `${member.name}${member.role ? ` - ${member.role}` : ""}`).join(", ") || "",
  }, event.waiverParameterMappings || []);
  const pdf = await createWaiverPdf({
    waiverHtml: renderedWaiver, waiverVersion: event.waiverVersion || "", auditId, signedAt,
    signatureName: record.signatureName, athleteEmail: record.email, eventName: event.name,
    eventDate: event.date, eventLocation: event.location, bib, category, browser,
  });
  const documentHash = await sha256(pdf);
  const objectKey = `signed-waivers/${safeSegment(event.id)}/${safeSegment(registration.participantId)}/${auditId}.pdf`;
  await media.put(objectKey, pdf, {
    httpMetadata: { contentType: "application/pdf", cacheControl: "private, no-store" },
    customMetadata: { eventId: event.id, participantId: registration.participantId, auditId, signedAt, sha256: documentHash },
  });
  const url = await documentUrl(input.origin, objectKey, secret);
  let updated: ParticipantRosterRow;
  try {
    updated = await updateParticipantRosterRegistration({
      kv, eventId: event.id, participantId: registration.participantId,
      patch: {
        waiverStatus: "SIGNED", waiverSignedAt: signedAt, waiverVerifiedAt: signedAt,
        waiverResetAt: null, waiverResetBy: null,
        waiverVersion: event.waiverVersion || "", waiverSignatureName: record.signatureName,
        signatureName: record.signatureName, waiverDocumentKey: objectKey,
        waiverDocumentUrl: url, waiverDocumentSha256: documentHash, waiverAuditId: auditId,
      },
    });
  } catch (error) {
    await media.delete(objectKey);
    throw error;
  }
  await Promise.all([
    kv.delete(key),
    kv.put(`${PREFIX}:audit:${auditId}`, JSON.stringify({
      schemaVersion: 1, auditId, eventId: event.id, participantId: registration.participantId,
      athleteUid: input.athlete.uid, athleteEmail: record.email, signatureName: record.signatureName,
      waiverVersion: event.waiverVersion || "", signedAt, documentKey: objectKey,
      documentSha256: documentHash, identityMethod: "EMAIL_OTP", evidenceHash: await hmac(input.evidence, secret),
    })),
  ]);

  const operation: VolunteerOperationLog = {
    id: auditId, eventId: event.id, eventName: event.name, participantUid: registration.participantId,
    bib, athleteName: value(row, "fullName", "name", "athleteName") || record.signatureName,
    volunteerId: "athlete-self-service", volunteerName: "Athlete self-service",
    action: "WAIVER_VERIFY", capturedAt: signedAt, status: "SIGNED",
  };
  const configured = await readCounterTemplate(event.id, "WAIVER_VERIFY");
  const usesBuiltInEmail = !configured.email.enabled;
  const deliveryTemplate = configured.email.enabled ? configured : {
    ...configured,
    email: {
      ...configured.email,
      enabled: true,
      mode: "CUSTOM" as const,
      subject: "Your signed {{event_name}} waiver",
      body: "Hello {{name}},\n\nYour waiver has been signed successfully for {{event_name}} (BIB {{bib}}). Your signed PDF is attached.",
      mappings: [
        { token: "name", variable: "name" as const },
        { token: "event_name", variable: "event_name" as const },
        { token: "bib", variable: "bib" as const },
      ],
      attachWaiver: true,
    },
    waiver: { urlField: "waiverDocumentUrl" as const, allowedOrigin: new URL(input.origin).origin },
  };
  deliveryTemplate.email.attachWaiver = true;
  deliveryTemplate.waiver = { urlField: "waiverDocumentUrl", allowedOrigin: new URL(input.origin).origin };
  let notificationProcessed = true;
  try {
    await dispatchCounterNotifications(operation, {
      participant: updated,
      template: deliveryTemplate,
      emailAttachment: { filename: "signed-waiver.pdf", contentType: "application/pdf", data: Buffer.from(pdf).toString("base64") },
      ...(usesBuiltInEmail ? { emailHtml: signedWaiverConfirmationEmail({
        athleteName: value(row, "fullName", "name", "athleteName") || record.signatureName,
        eventName: event.name,
        category,
        eventDate: event.date || "",
        bib,
        signedAt,
      }) } : {}),
    });
  } catch (error) {
    notificationProcessed = false;
    console.error(JSON.stringify({ type: "signed_waiver_notification_failed", auditId, eventId: event.id, error: error instanceof Error ? error.message : "Unknown notification failure" }));
  }
  return { eventId: event.id, participantId: registration.participantId, signedAt, signatureName: record.signatureName, waiverVersion: event.waiverVersion || "", documentUrl: url, auditId, notificationProcessed };
}
