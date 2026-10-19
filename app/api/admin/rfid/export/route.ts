import { requireAdmin } from "@/lib/admin-guard";
import { listRfidChips, listRfidTransactions } from "@/lib/rfid-encoder-repository";

function cell(value: unknown) { return `"${String(value ?? "").replace(/"/g, '""')}"`; }

export async function GET(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const kind = new URL(request.url).searchParams.get("kind") === "history" ? "history" : "inventory";
  let rows: unknown[][];
  if (kind === "history") {
    const data = await listRfidTransactions(10_000);
    rows = [["Transaction ID", "Reader ID", "Operator", "Original EPC", "Requested EPC", "Verified EPC", "TID", "Operation", "Started", "Completed", "Status", "SDK Response", "Verification", "Error"], ...data.map((row) => [row.id, row.readerId, row.operatorId, row.originalEpc, row.requestedEpc, row.verifiedEpc, row.tid, row.operation, row.startedAt, row.completedAt, row.status, row.sdkResponse, row.verificationResult, row.errorDetails])];
  } else {
    const data = await listRfidChips(10_000);
    rows = [["Chip Inventory ID", "Chip Number", "Full EPC", "TID", "EPC Length", "EPC Profile", "Status", "Assigned Event", "Assigned BIB", "First Encoded", "Last Encoded", "Last Verified", "Reader", "Operator", "Notes"], ...data.map((row) => [row.id, row.chipNumber, row.epc, row.tid, row.epcLength, row.epcProfileId, row.status, row.assignedEventId, row.assignedBib, row.firstEncodedAt, row.lastEncodedAt, row.lastVerifiedAt, row.readerId, row.operatorId, row.notes])];
  }
  return new Response(rows.map((row) => row.map(cell).join(",")).join("\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="rfid-${kind}.csv"`, "cache-control": "no-store" } });
}
