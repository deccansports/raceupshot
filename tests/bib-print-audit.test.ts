import { describe, expect, it } from "vitest";
import { appendBibPrintAudits, type BibPrintAuditRecord } from "../lib/bib-print-audit";

const row = (participantId: string, templateType: "BIB" | "STICKER" = "BIB"): BibPrintAuditRecord => ({ eventId: "event-1", participantId, templateId: "template-1", templateType, printedBy: "admin@example.com", bibNumber: "1001" });

describe("BIB and sticker print audit", () => {
  it("keeps preview outside the audit path; original and reprint append without overwriting", () => {
    const original = appendBibPrintAudits([], [row("participant-1")], "", "2026-10-12T00:00:00.000Z", () => "audit-1");
    expect(original.created[0]).toMatchObject({ id: "audit-1", printType: "ORIGINAL", reprintReason: null });
    expect(original.records).toHaveLength(1);
    const reprint = appendBibPrintAudits(original.records, [row("participant-1")], "Damaged paper", "2026-10-12T00:10:00.000Z", () => "audit-2");
    expect(reprint.records).toHaveLength(2);
    expect(reprint.records[0]).toEqual(original.records[0]);
    expect(reprint.created[0]).toMatchObject({ id: "audit-2", printType: "REPRINT", reprintReason: "Damaged paper" });
  });
  it("requires a reason for repeat prints but identifies by participant ID and print type", () => {
    const first = appendBibPrintAudits([], [row("participant-1")], "", "now", () => "1");
    expect(() => appendBibPrintAudits(first.records, [row("participant-1")], "", "later", () => "2")).toThrow(/reason/);
    expect(appendBibPrintAudits(first.records, [row("participant-2")], "", "later", () => "2").created[0].printType).toBe("ORIGINAL");
    expect(appendBibPrintAudits(first.records, [row("participant-1", "STICKER")], "", "later", () => "2").created[0].printType).toBe("ORIGINAL");
  });
  it("rejects duplicate participants and mixed events in one atomic batch", () => {
    expect(() => appendBibPrintAudits([], [row("a"), row("a")], "", "now", () => "1")).toThrow(/duplicate/);
    expect(() => appendBibPrintAudits([], [row("a"), { ...row("b"), eventId: "other" }], "", "now", () => "1")).toThrow(/duplicate/);
  });
});
