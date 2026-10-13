import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const admin = readFileSync(new URL("../components/bib-sticker-print-admin.tsx", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/v1/admin/events/[eventId]/print/route.ts", import.meta.url), "utf8");
const server = readFileSync(new URL("../lib/bib-print-server.ts", import.meta.url), "utf8");
const pdf = readFileSync(new URL("../lib/bib-print-pdf.ts", import.meta.url), "utf8");

describe("BERGMAN-inspired BIB and sticker operator workflow", () => {
  it("keeps BIB and sticker printing as separate operator tabs", () => {
    expect(admin).toContain("BIB Printing");
    expect(admin).toContain("Sticker Printing");
    expect(admin).toContain('role="tablist"');
  });

  it("supports participant preview, single A5 export, bulk selection and print history", () => {
    expect(admin).toContain("Preview participant");
    expect(admin).toContain("Download single A5 BIB PDF");
    expect(admin).toContain("Download 18×12 · 4 A5 BIBs");
    expect(admin).toContain("Select all shown");
    expect(admin).toContain("Print history");
    expect(route).toContain('body.action === "single-print"');
    expect(admin).toContain('action: "single-print"');
    expect(route).toContain('body.action === "four-up-print"');
  });

  it("duplicates saved templates on the server into a validated event category", () => {
    expect(admin).toContain('action: "duplicate"');
    expect(route).toContain('body.action === "duplicate"');
    expect(server).toContain("export async function duplicatePrintTemplate");
    expect(server).toContain("Destination category is not configured for this event.");
  });

  it("flattens downloadable pages in the browser instead of exhausting the Worker", () => {
    expect(admin).toContain("downloadPrintDocumentPdf");
    expect(admin).toContain('forceFourUp ? "four-up-print" : "print"');
    expect(pdf).toContain('import("html-to-image")');
    expect(pdf).toContain('import("jspdf")');
    expect(pdf).toContain("PDF_RASTER_DPI = 300");
    expect(pdf).toContain("cloneWithComputedStyles");
    expect(admin).toContain("deliverServerPdf");
    expect(route).toContain('body.action === "four-up-pdf"');
  });

  it("enables every output action from the visible batch and auto-saves pending edits", () => {
    expect(admin).toContain("const canGenerate = Boolean(template && data && selected.length > 0 && !busy)");
    expect(admin).toContain("persistTemplateForOutput");
    expect(admin).toContain("Pending template edits will be saved automatically");
    expect(admin).not.toContain("!allEligible.length");
    expect(admin).not.toContain('purpose === "download" ? "ALL" : mode');
  });

  it("renders the exact saved template snapshot instead of a briefly stale KV version", () => {
    expect(admin).toContain("templateSnapshot: outputTemplate");
    expect(server).toContain("request.templateSnapshot");
    expect(server).toContain("assertValidTemplateInput(roster.event.id, snapshot)");
  });
});
