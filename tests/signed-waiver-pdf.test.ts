import { readFileSync, writeFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { createWaiverPdf, waiverPdfBlocks } from "../lib/signed-waivers";

describe("signed waiver PDF", () => {
  it("turns styled waiver HTML into semantic text blocks without leaking CSS", () => {
    const blocks = waiverPdfBlocks("<style>.secret{color:red}</style><h1>Agreement</h1><h2>Risk</h2><p>Read carefully.</p><ul><li>Wear safety equipment.</li></ul>");
    expect(blocks).toEqual([
      { kind: "title", text: "Agreement" },
      { kind: "heading", text: "Risk" },
      { kind: "paragraph", text: "Read carefully." },
      { kind: "list", text: "Wear safety equipment." },
    ]);
  });

  it("creates properly sized, paginated A4 pages for a long waiver", async () => {
    const repeatedSections = Array.from({ length: 55 }, (_, index) => `<h2>${index + 1}. Safety section</h2><p>${"Athlete safety and event participation terms. ".repeat(12)}</p>`).join("");
    const bytes = await createWaiverPdf({
      waiverHtml: repeatedSections,
      waiverVersion: "TEST-v1",
      auditId: "audit-test",
      signedAt: "2026-10-09T07:30:00.000Z",
      signatureName: "Test Athlete",
      athleteEmail: "athlete@example.com",
      eventName: "Test Triathlon",
      eventDate: "9 October 2026",
      eventLocation: "Pune, Maharashtra, India",
      bib: "1001",
      category: "Olympic Triathlon",
    });
    const pdf = await PDFDocument.load(bytes);
    if (process.env.WRITE_WAIVER_PREVIEW === "1") writeFileSync("output/pdf/signed-waiver-a4-layout-preview.pdf", bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(1);
    pdf.getPages().forEach((page) => {
      expect(page.getWidth()).toBeCloseTo(595.28, 1);
      expect(page.getHeight()).toBeCloseTo(841.89, 1);
    });
  });

  it("uses only the jurisdiction variable in the supplied sporty template", () => {
    const template = readFileSync(new URL("../docs/waiver-templates/sporty-indemnity-waiver.html", import.meta.url), "utf8");
    expect(template).toContain("{{jurisdiction}}");
    expect(template).not.toMatch(/Kolhapur|Maharashtra/);
  });
});
