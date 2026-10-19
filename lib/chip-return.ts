import { isReaderLikeEpc, rfidReaderAssignmentValue } from "./rfid-reader-assignment";

export const CHIP_RETURN_REASONS = [
  "Chip Lost",
  "Chip Damaged",
  "Chip Not Available",
  "Chip Already Collected",
  "Other",
] as const;

export type ChipReturnReason = (typeof CHIP_RETURN_REASONS)[number];
export type ChipReturnMethod = "CAMERA" | "RFID" | "MANUAL" | "OVERRIDE" | "NO_CHIP_ASSIGNED";
export type ChipReturnStatus = "PENDING_RETURN" | "RETURNED" | "NOT_RETURNED" | "NO_CHIP_ASSIGNED";

export interface ChipReturnResolution {
  assignedChipCode: string | null;
  returnedChipCode: string | null;
  chipReturnStatus: ChipReturnStatus;
  chipReturnMethod: ChipReturnMethod;
  chipReturnReason: string | null;
  returnedChipFullEpc: string | null;
}

export function normalizeChipCode(value: string, method: ChipReturnMethod): { chipCode: string; fullEpc: string | null } {
  const raw = value.trim();
  if (!raw) return { chipCode: "", fullEpc: null };
  if (method === "RFID" || isReaderLikeEpc(raw)) {
    const resolved = rfidReaderAssignmentValue(raw);
    return { chipCode: resolved.chipCode.toUpperCase(), fullEpc: resolved.fullEpc };
  }
  return { chipCode: raw.replace(/\s+/g, "").toUpperCase(), fullEpc: null };
}

export function resolveChipReturn(input: {
  assignedChipCode?: string | null;
  scannedChipCode?: string | null;
  method?: ChipReturnMethod | null;
  reason?: string | null;
}): ChipReturnResolution {
  const assigned = (input.assignedChipCode ?? "").trim().replace(/\s+/g, "").toUpperCase();
  if (!assigned) {
    return { assignedChipCode: null, returnedChipCode: null, chipReturnStatus: "NO_CHIP_ASSIGNED", chipReturnMethod: "NO_CHIP_ASSIGNED", chipReturnReason: null, returnedChipFullEpc: null };
  }
  if (input.method === "OVERRIDE") {
    const reason = (input.reason ?? "").trim();
    if (!reason) throw new Error("Select a reason before completing checkout without the chip.");
    return { assignedChipCode: assigned, returnedChipCode: null, chipReturnStatus: "NOT_RETURNED", chipReturnMethod: "OVERRIDE", chipReturnReason: reason, returnedChipFullEpc: null };
  }
  if (input.method !== "CAMERA" && input.method !== "RFID" && input.method !== "MANUAL") throw new Error("Scan or enter the assigned chip, or select No Chip to Return.");
  const scanned = normalizeChipCode(input.scannedChipCode ?? "", input.method);
  if (!scanned.chipCode) throw new Error("Scan the timing chip before completing bike checkout.");
  if (scanned.chipCode !== assigned) throw new Error(`Chip mismatch. Assigned chip ${assigned}; scanned chip ${scanned.chipCode}.`);
  return { assignedChipCode: assigned, returnedChipCode: scanned.chipCode, chipReturnStatus: "RETURNED", chipReturnMethod: input.method, chipReturnReason: null, returnedChipFullEpc: scanned.fullEpc };
}
