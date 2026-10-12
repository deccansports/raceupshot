import { requireAdmin } from "@/lib/admin-guard";
import { getAuthenticatedAdminEmail } from "@/lib/admin-auth";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import { auditRequest, generatePrintDocumentHtml, generatePrintPdf, listPrintTemplates, newPrintTemplate, printRoster, resolvePrintBatch, savePrintTemplate, type PrintBatchRequest } from "@/lib/bib-print-server";
import { fixedPrintLayout, type PrintTemplate } from "@/lib/bib-print-layout";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const denied = await requireAdmin(); if (denied) return denied;
  try {
    const { eventId } = await params;
    const roster = await printRoster(eventId);
    const [templates, audits] = await Promise.all([listPrintTemplates(roster.event.id), auditRequest(roster.event.id, "audits", "GET")]);
    return apiSuccess({ ...roster, templates, audits: audits.records ?? [] }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return apiFailure(error instanceof Error ? error.message : "Unable to load print data.", 400); }
}

export async function POST(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const denied = await requireAdmin(); if (denied) return denied;
  try {
    const { eventId } = await params;
    const body = await request.json() as { action?: string; ticketId?: string; type?: "BIB" | "STICKER"; template?: PrintTemplate; batch?: PrintBatchRequest; batchHash?: string; reprintReason?: string; sessionId?: string };
    if (body.action === "new") {
      if (!body.ticketId || !["BIB", "STICKER"].includes(body.type ?? "")) return apiFailure("Select an event, category and print type.", 400);
      return apiSuccess({ template: await newPrintTemplate(eventId, body.ticketId, body.type!) }, { headers: { "cache-control": "private, no-store" } });
    }
    if (body.action === "save") {
      if (!body.template) return apiFailure("Template is required.", 400);
      const roster = await printRoster(eventId);
      return apiSuccess({ template: await savePrintTemplate(roster.event.id, body.template) }, { headers: { "cache-control": "private, no-store" } });
    }
    if ((body.action === "pdf" || body.action === "print" || body.action === "audit") && body.batch) {
      const { event, template, participants } = await resolvePrintBatch(eventId, body.batch);
      const signatureInput = JSON.stringify({ eventId: event.id, templateId: template.id, version: template.version, ids: participants.map((item) => item.participantId) });
      const batchHash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(signatureInput)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      if (body.action === "pdf") {
        const bytes = await generatePrintPdf(template, participants);
        const safeName = `${event.name}_${template.name}_${participants.length}_${template.templateType === "BIB" ? "Bibs" : "Stickers"}`.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 120);
        return new Response(bytes as BodyInit, { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${safeName}.pdf"`, "cache-control": "private, no-store", "x-print-batch-hash": batchHash, "x-physical-pages": String(Math.ceil(participants.length / fixedPrintLayout(template.paperPreset, template.templateType).itemsPerPage)) } });
      }
      if (body.action === "print") {
        return new Response(generatePrintDocumentHtml(template, participants), { headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
          "x-print-batch-hash": batchHash,
          "x-physical-pages": String(Math.ceil(participants.length / fixedPrintLayout(template.paperPreset, template.templateType).itemsPerPage)),
        } });
      }
      if (!body.batchHash || body.batchHash !== batchHash) return apiFailure("The roster or template changed since the PDF was created. Generate a fresh PDF before confirming printing.", 409);
      const email = await getAuthenticatedAdminEmail();
      if (!email) return apiFailure("Admin session expired.", 401);
      const printId = crypto.randomUUID();
      const records = participants.map((participant) => ({
        printId, eventId: event.id, participantId: participant.participantId, bookingId: participant.bookingId,
        bibNumber: participant.bibNumber, categoryId: participant.ticketId, subcategoryId: participant.subcategoryId,
        templateId: template.id, templateVersion: template.version, templateType: template.templateType,
        printedBy: email, printedByName: email, source: "ADMIN", sessionId: String(body.sessionId ?? "").slice(0, 100),
        userAgent: String(request.headers.get("user-agent") ?? "").slice(0, 500),
      }));
      const result = await auditRequest(event.id, "audits", "POST", { records, reprintReason: body.reprintReason });
      return apiSuccess({ created: result.created }, { headers: { "cache-control": "private, no-store" } });
    }
    return apiFailure("Unsupported print action.", 400);
  } catch (error) {
    console.error(JSON.stringify({ message: "BIB/sticker print request failed", error: error instanceof Error ? error.message : String(error) }));
    return apiFailure(error instanceof Error ? error.message : "Print request failed.", 400);
  }
}
