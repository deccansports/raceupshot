import { describe, expect, it } from "vitest";
import { defaultPrintTemplate, fixedPrintLayout, matchesPrintGender, printPages, renderPrintHtml, repairStandardA5Template, selectPrintParticipants, sortParticipantsByBib, TWELVE_BY_EIGHTEEN_FOUR_A5_LAYOUT, type PrintParticipant } from "../lib/bib-print-layout";
import { fourUpBibPlacement } from "../lib/bib-print-pdf";

const athlete = (bib: string, overrides: Partial<PrintParticipant> = {}): PrintParticipant => ({
  eventId: "event-1", participantId: `participant-${bib}`, bookingId: null, ticketId: "olympic", ticketName: "Olympic", subcategoryId: null,
  bibNumber: bib, name: `Athlete ${bib}`, gender: "male", ageGroup: "Under 30", club: "", country: "IN", tshirtSize: "M",
  emergencyContact: "", chipCode: "", athleteBandCode: "", registrationStatus: "confirmed", active: true, ...overrides,
});

describe("BIB print layout", () => {
  it("keeps four landscape A5 BIBs at the top-left of an 18 × 12-inch sheet", () => {
    expect(TWELVE_BY_EIGHTEEN_FOUR_A5_LAYOUT).toMatchObject({ pageWidthMm: 457.2, pageHeightMm: 304.8, itemWidthMm: 210, itemHeightMm: 148.5, itemsPerPage: 4, columns: 2, rows: 2, marginTopMm: 0, marginRightMm: 37.2, marginBottomMm: 7.8, marginLeftMm: 0, gapMm: 0 });
    expect(fixedPrintLayout("12X18", "BIB")).toEqual(TWELVE_BY_EIGHTEEN_FOUR_A5_LAYOUT);
    expect(fixedPrintLayout("12X8", "BIB")).toEqual(TWELVE_BY_EIGHTEEN_FOUR_A5_LAYOUT);
  });
  it("puts four BIBs on one page and five on two pages with three white blanks", () => {
    const layout = fixedPrintLayout("12X18", "BIB");
    const rows = ["1", "2", "3", "4", "5"].map((bib) => athlete(bib));
    expect(printPages(rows.slice(0, 4), layout)).toHaveLength(1);
    expect(printPages(rows, layout).map((page) => page.map((row) => row?.bibNumber ?? null))).toEqual([["1", "2", "3", "4"], ["5", null, null, null]]);
  });
  it("places each flattened landscape A5 BIB without consuming the spare sheet margins", () => {
    expect([0, 1, 2, 3].map(fourUpBibPlacement)).toEqual([
      { xMm: 0, yMm: 0 }, { xMm: 210, yMm: 0 },
      { xMm: 0, yMm: 148.5 }, { xMm: 210, yMm: 148.5 },
    ]);
    expect(() => fourUpBibPlacement(4)).toThrow(/exactly four/);
  });
  it("renders the exact page rule, 2 × 2 grid, centre cut guides, and row-major BIB order", () => {
    const html = renderPrintHtml({ template: defaultPrintTemplate("event-1", "olympic", "BIB"), participants: ["1", "2", "3", "4", "5"].map((bib) => athlete(bib)) });
    expect(html).toContain("@page { size: 457.2mm 304.8mm; margin: 0; }");
    expect(html).toContain("grid-template-columns:repeat(2, 210mm)");
    expect(html).toContain("grid-template-rows:repeat(2, 148.5mm)");
    expect(html).toContain(".print-page.four-up > .print-item:nth-child(1) { left:0; top:0; }");
    expect(html).toContain(".print-page.four-up > .print-item:nth-child(2) { left:210mm; top:0; }");
    expect(html).toContain(".print-page.four-up > .print-item:nth-child(3) { left:0; top:148.5mm; }");
    expect(html).toContain(".print-page.four-up > .print-item:nth-child(4) { left:210mm; top:148.5mm; }");
    expect(html).toContain(".cut-guide.vertical { left:210mm; top:0mm; height:297mm;");
    expect(html).toContain(".cut-guide.horizontal { top:148.5mm; left:0mm; width:420mm;");
    expect(html).toContain('class="cut-guide vertical"');
    expect(html).toContain('class="cut-guide horizontal"');
    expect((html.match(/class="print-page four-up"/g) ?? [])).toHaveLength(2);
    expect((html.match(/class="print-item blank"/g) ?? [])).toHaveLength(3);
    expect([...html.matchAll(/data-participant-id="([^"]+)"/g)].map((match) => match[1])).toEqual(["participant-1", "participant-2", "participant-3", "participant-4", "participant-5"]);
  });
  it("sorts BIBs naturally and excludes inactive and cross-scope records", () => {
    const roster = [athlete("A10"), athlete("10"), athlete("A2"), athlete("2"), athlete("20", { registrationStatus: "refunded" }), athlete("21", { registrationStatus: "transferred-out" }), athlete("22", { registrationStatus: "cancelled" }), athlete("23", { eventId: "other" }), athlete("24", { ticketId: "other" }), athlete("25", { subcategoryId: "other" })];
    expect(sortParticipantsByBib(roster.slice(0, 4)).map((row) => row.bibNumber)).toEqual(["2", "10", "A2", "A10"]);
    expect(selectPrintParticipants({ roster, eventId: "event-1", ticketId: "olympic", subcategoryId: null, mode: "ALL" }).map((row) => row.bibNumber)).toEqual(["2", "10", "A2", "A10"]);
  });
  it("requires explicit selection for selected, not-printed, and reprint modes", () => {
    const roster = [athlete("1")];
    for (const mode of ["SELECTED", "NOT_PRINTED", "REPRINT"] as const) expect(() => selectPrintParticipants({ roster, eventId: "event-1", ticketId: "olympic", subcategoryId: null, mode })).toThrow(/Select participant checkboxes/);
    expect(() => selectPrintParticipants({ roster, eventId: "event-1", ticketId: "olympic", subcategoryId: null, mode: "SELECTED", selectedIds: ["missing"] })).toThrow(/changed/);
  });
  it("supports rotated A5, centred A4 single-BIB and A4 two-BIB printing", () => {
    expect(fixedPrintLayout("A5", "BIB")).toMatchObject({ pageWidthMm: 148.5, pageHeightMm: 210, itemWidthMm: 210, itemHeightMm: 148.5, itemsPerPage: 1, columns: 1, rows: 1 });
    expect(fixedPrintLayout("A4_SINGLE_A5", "BIB")).toMatchObject({ pageWidthMm: 210, pageHeightMm: 297, itemWidthMm: 210, itemHeightMm: 148.5, itemsPerPage: 1, marginTopMm: 74.25, marginBottomMm: 74.25 });
    expect(fixedPrintLayout("A4", "BIB")).toMatchObject({ pageWidthMm: 210, pageHeightMm: 297, itemWidthMm: 202, itemHeightMm: 142.5, itemsPerPage: 2, marginTopMm: 4, marginRightMm: 4, marginBottomMm: 4, marginLeftMm: 4, columns: 1, rows: 2 });
    expect(fixedPrintLayout("STICKER_4X2", "STICKER")).toMatchObject({ pageWidthMm: 101.6, pageHeightMm: 50.8, itemsPerPage: 1 });
  });
  it("escapes participant text and rejects unsafe background images", () => {
    const template = defaultPrintTemplate("event-1", "olympic", "BIB");
    const html = renderPrintHtml({ template, participants: [athlete("1", { name: '<script>alert("x")</script>' })] });
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain('<script>alert("x")</script>');
    expect(() => renderPrintHtml({ template: { ...template, backgroundDataUrl: "javascript:alert(1)" }, participants: [athlete("1")] })).toThrow(/PNG/);
  });
  it("embeds a large template background only once instead of repeating it for every BIB", () => {
    const template = { ...defaultPrintTemplate("event-1", "olympic", "BIB"), backgroundDataUrl: `data:image/png;base64,${"A".repeat(2_000)}` };
    const html = renderPrintHtml({ template, participants: [athlete("1"), athlete("2"), athlete("3"), athlete("4")] });
    expect(html.match(/data:image\/png;base64/g)).toHaveLength(1);
    expect(html).toContain("background-size:cover");
    expect(html).not.toContain("print-background");
  });
  it("repairs the oversized Standard BIB field produced by the former unconstrained A5 canvas", () => {
    const template = defaultPrintTemplate("event-1", "olympic", "BIB");
    template.elements[0] = { ...template.elements[0], x: 35.526, y: 50.678, width: 65.725, height: 45.021 };
    const repaired = repairStandardA5Template(template);
    expect(repaired.elements[0]).toMatchObject({ x: 5, y: 58, width: 90, height: 26, rotation: 0, align: "center", verticalAlign: "middle" });
    expect(repaired.elements[0].x + repaired.elements[0].width).toBeLessThanOrEqual(100);
    expect(repaired.elements[0].y + repaired.elements[0].height).toBeLessThanOrEqual(100);
  });
  it("accepts both full and abbreviated gender values in scoped templates", () => {
    expect(matchesPrintGender("M", "MALE")).toBe(true);
    expect(matchesPrintGender("female", "FEMALE")).toBe(true);
    expect(matchesPrintGender("F", "MALE")).toBe(false);
  });
  it("prints shape layers and preserves bold weight, text alignment, and line spacing", () => {
    const template = defaultPrintTemplate("event-1", "olympic", "BIB");
    const name = template.elements.find((element) => element.kind === "PARTICIPANT_NAME")!;
    name.fontWeight = 800;
    name.align = "right";
    name.verticalAlign = "bottom";
    name.letterSpacing = 2;
    name.lineHeight = 1.4;
    template.elements.unshift({ ...name, id: "shape", kind: "RECTANGLE", x: 12, y: 12, width: 40, height: 20, fillColor: "#ff0000", strokeColor: "#000000", strokeWidth: 3, cornerRadius: 10 });
    const html = renderPrintHtml({ template, participants: [athlete("1")] });
    expect(html).toContain('class="print-element print-shape"');
    expect(html).toContain("background:#ff0000;border:3px solid #000000;border-radius:10%");
    expect(html).toContain("font-weight:800");
    expect(html).toContain("text-align:right");
    expect(html).toContain("letter-spacing:2px;line-height:1.4;justify-content:flex-end");
    template.elements[0] = { ...template.elements[0], kind: "ELLIPSE" };
    expect(renderPrintHtml({ template, participants: [athlete("1")] })).toContain("border-radius:50%");
    template.elements[0] = { ...template.elements[0], kind: "LINE" };
    expect(renderPrintHtml({ template, participants: [athlete("1")] })).toContain("height:0;border-top:3px solid #000000");
  });
});
