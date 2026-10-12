import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PDFDocument } from "pdf-lib";
import { defaultPrintTemplate, renderPrintHtml, type PrintParticipant } from "../lib/bib-print-layout";

const run = promisify(execFile);
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const visual = process.env.BIB_VISUAL_VERIFY === "1";
describe.skipIf(!visual)("local Chrome BIB PDF visual fixtures", () => {
  it("generates exact physical 4-, 5-, and 24-BIB PDF samples", async () => {
    const folder = await mkdtemp(join(tmpdir(), "raceupshot-bib-visual-"));
    for (const count of [4, 5, 24]) {
      const participants: PrintParticipant[] = Array.from({ length: count }, (_, index) => ({
        eventId: "visual-event", participantId: `participant-${index + 1}`, bookingId: null, ticketId: "olympic", ticketName: "Olympic Triathlon", subcategoryId: null,
        bibNumber: String(index + 1), name: `Athlete ${index + 1}`, gender: "male", ageGroup: "Under 30", club: "", country: "IN", tshirtSize: "M",
        emergencyContact: "", chipCode: "", athleteBandCode: "", registrationStatus: "confirmed", active: true,
      }));
      const htmlFile = join(folder, `bib-${count}.html`);
      const pdfFile = join(folder, `bib-${count}.pdf`);
      await writeFile(htmlFile, renderPrintHtml({ template: defaultPrintTemplate("visual-event", "olympic", "BIB"), participants }));
      await run(chrome, ["--headless", "--disable-gpu", "--no-sandbox", "--disable-extensions", "--no-pdf-header-footer", `--print-to-pdf=${pdfFile}`, `file://${htmlFile}`], { timeout: 60_000 });
      const pdf = await PDFDocument.load(await readFile(pdfFile));
      expect(pdf.getPageCount()).toBe(Math.ceil(count / 4));
      for (const page of pdf.getPages()) {
        expect(page.getWidth()).toBeCloseTo(864, 0); // 12 × 72 pt
        expect(page.getHeight()).toBeCloseTo(1296, 0); // 18 × 72 pt
      }
      if (count === 5) {
        const lastPage = await PDFDocument.create();
        const [copied] = await lastPage.copyPages(pdf, [1]);
        lastPage.addPage(copied);
        await writeFile(join(folder, "bib-5-last-page.pdf"), await lastPage.save());
      }
    }
    const sample: PrintParticipant = {
      eventId: "visual-event", participantId: "single", bookingId: null, ticketId: "olympic", ticketName: "Olympic Triathlon", subcategoryId: null,
      bibNumber: "1001", name: "Sample Athlete", gender: "female", ageGroup: "Under 30", club: "", country: "IN", tshirtSize: "M",
      emergencyContact: "", chipCode: "", athleteBandCode: "", registrationStatus: "confirmed", active: true,
    };
    for (const preset of ["A5", "A4", "STICKER_4X2"] as const) {
      const template = defaultPrintTemplate("visual-event", "olympic", preset === "STICKER_4X2" ? "STICKER" : "BIB");
      template.paperPreset = preset;
      const htmlFile = join(folder, `${preset}.html`);
      const pdfFile = join(folder, `${preset}.pdf`);
      await writeFile(htmlFile, renderPrintHtml({ template, participants: [sample] }));
      await run(chrome, ["--headless", "--disable-gpu", "--no-sandbox", "--disable-extensions", "--no-pdf-header-footer", `--print-to-pdf=${pdfFile}`, `file://${htmlFile}`], { timeout: 60_000 });
      const pdf = await PDFDocument.load(await readFile(pdfFile));
      expect(pdf.getPageCount()).toBe(1);
      const [width, height] = preset === "A5" ? [148.5, 210] : preset === "A4" ? [210, 297] : [101.6, 50.8];
      expect(pdf.getPage(0).getWidth()).toBeCloseTo(width * 72 / 25.4, 0);
      expect(pdf.getPage(0).getHeight()).toBeCloseTo(height * 72 / 25.4, 0);
    }
    // The folder is retained so its PDFs can be rendered and inspected manually.
    process.stdout.write(`BIB visual PDF fixtures: ${folder}\n`);
  }, 180_000);
});
