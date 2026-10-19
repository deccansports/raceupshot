import { parseRfidIdentifier } from "./rfid-encoder-core";

export interface RfidReaderAssignmentValue {
  chipCode: string;
  fullEpc: string;
}

function readerValues(input: string): string[] {
  const raw = input.trim();
  let values: string[] = [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    const rows = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object"
        ? ["reads", "tags", "data"].map((key) => (parsed as Record<string, unknown>)[key]).find(Array.isArray) || [parsed]
        : [raw];
    values = rows.map((row) => {
      if (typeof row === "string") return row;
      if (!row || typeof row !== "object") return "";
      const record = row as Record<string, unknown>;
      return String(record.fullEpc ?? record.epc ?? record.chip ?? record.value ?? "");
    });
  } catch {
    values = raw.split(/[\r\n,;|\t]+/);
  }
  return [...new Set(values.map((value) => value.trim().replace(/\s+/g, "").toUpperCase()).filter(Boolean))];
}

export function isReaderLikeEpc(input: string): boolean {
  const values = readerValues(input);
  return values.length === 1 && /^[0-9A-F]{16,}$/.test(values[0]);
}

export function timingChipCodeForDisplay(input: string): string {
  const value = input.trim().replace(/\s+/g, "").toUpperCase();
  if (!/^[0-9A-F]{16,}$/.test(value)) return value;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 5 ? digits.slice(-5) : value;
}

/**
 * Timing readers expose a complete EPC, while race operations use the final
 * five printed decimal digits as the chip code. Keep the complete read for
 * audit metadata, but never require an inventory record to derive the code.
 */
export function rfidReaderAssignmentValue(input: string): RfidReaderAssignmentValue {
  const values = readerValues(input);
  if (values.length !== 1) throw new Error("Multiple RFID tags detected. Keep exactly one timing chip near the reader and scan again.");
  const parsed = parseRfidIdentifier(values[0] || input);
  const fullEpc = (parsed.candidates[0] || parsed.value || values[0] || input).trim().replace(/\s+/g, "").toUpperCase();
  const decimalDigits = fullEpc.replace(/\D/g, "");
  if (decimalDigits.length < 5) throw new Error("USB RFID reader value must contain at least five digits.");
  return { chipCode: decimalDigits.slice(-5), fullEpc };
}
