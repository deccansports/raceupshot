export interface BibPrintAuditRecord {
  id?: string;
  eventId: string;
  participantId: string;
  templateId: string;
  templateType: "BIB" | "STICKER";
  printedBy: string;
  printType?: "ORIGINAL" | "REPRINT";
  reprintReason?: string | null;
  printedAt?: string;
  [key: string]: unknown;
}

export function appendBibPrintAudits(
  existing: BibPrintAuditRecord[], incoming: BibPrintAuditRecord[], reason: string,
  now: string, createId: () => string,
): { records: BibPrintAuditRecord[]; created: BibPrintAuditRecord[] } {
  if (!incoming.length || incoming.length > 500) throw new Error("A valid print batch is required.");
  const previous = new Set(existing.map((record) => `${record.templateType}:${record.participantId}`));
  const seen = new Set<string>();
  const eventId = incoming[0].eventId;
  const created = incoming.map((record) => {
    const id = record.participantId?.trim();
    if (!id || seen.has(id) || !record.eventId || record.eventId !== eventId || !record.templateId || !record.printedBy || !["BIB", "STICKER"].includes(record.templateType)) throw new Error("Invalid or duplicate participant in print batch.");
    seen.add(id);
    const reprint = previous.has(`${record.templateType}:${id}`);
    if (reprint && reason.trim().length < 5) throw new Error("A reprint reason of at least five characters is required.");
    return { ...record, id: createId(), printType: reprint ? "REPRINT" as const : "ORIGINAL" as const, reprintReason: reprint ? reason.trim() : null, printedAt: now };
  });
  return { records: [...existing, ...created], created };
}
