import { randomBytes } from "node:crypto";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { DurableObjectStub } from "@cloudflare/workers-types";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import { getAuthenticatedAdminEmail } from "@/lib/admin-auth";
import { expectedStoredPc, type LedgerTransaction, type RfidCommand, type RfidLedger } from "@/lib/rfid-ledger";
import { rfidSignature, verifyRfidSignature } from "@/lib/rfid-signing";
import { validateEpc, type RfidTagRead } from "@/lib/rfid-encoder-core";

export const dynamic = "force-dynamic";
const text = (value: unknown, max = 200) => String(value ?? "").trim().slice(0, max);

async function context() {
  const operatorId = await getAuthenticatedAdminEmail();
  if (!operatorId) throw new Error("AUTH:Admin authentication required.");
  const { env } = await getCloudflareContext({ async: true });
  const secret = env.RACEUPSHOT_RFID_SIGNING_SECRET || "";
  if (secret.length < 32) throw new Error("CONFIG:RFID signing is not configured on the backend.");
  const coordinator = env.RFID_WRITE_COORDINATOR.getByName("global-epc-tid-reservations") as DurableObjectStub & {
    command(input: { command: RfidCommand; operatorId: string; now?: number; id?: string }): Promise<LedgerTransaction>;
    snapshot(): Promise<RfidLedger>;
  };
  return { operatorId, secret, coordinator };
}

function physical(value: unknown): RfidTagRead {
  const read = value as RfidTagRead;
  const epc = validateEpc(read?.epc || "");
  const tid = text(read?.tid, 24).toUpperCase();
  const pc = text(read?.pc, 4).toUpperCase();
  if (!/^[0-9A-F]{24}$/.test(tid) || !/^[0-9A-F]{4}$/.test(pc)) throw new Error("A fresh complete EPC, Stored PC and 12-byte TID read is required.");
  if ((Number.parseInt(pc.slice(0, 2), 16) >> 3) !== epc.length / 4) throw new Error("Stored PC does not match the scanned EPC length.");
  return { ...read, epc, tid, pc };
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = text(body.action, 30);
    const { operatorId, secret, coordinator } = await context();
    if (action === "preflight") {
      const nonce = randomBytes(16).toString("hex").toUpperCase();
      const expiresAtMs = Date.now() + 60_000;
      return apiSuccess({ nonce, expiresAtMs, signature: rfidSignature(secret, `PREFLIGHT|${nonce}|${expiresAtMs}`) }, { headers: { "cache-control": "no-store" } });
    }
    if (action === "read-audit") {
      const before = physical(body.before);
      const result = await coordinator.command({ command: { action: "read", epc: before.epc, pc: before.pc!, tid: before.tid!, readerId: text(body.readerId, 180) } satisfies RfidCommand, operatorId });
      return apiSuccess(result, { headers: { "cache-control": "no-store" } });
    }
    if (action === "reserve") {
      const before = physical(body.before);
      const requestedEpc = validateEpc(text(body.requestedEpc, 84));
      const transactionId = crypto.randomUUID();
      const reservation = await coordinator.command({ command: { action: "reserve", originalEpc: before.epc, originalPc: before.pc!, requestedEpc, tid: before.tid!, readerId: text(body.readerId, 180) } satisfies RfidCommand, operatorId, id: transactionId });
      const expiresAtMs = Number(reservation.expiresAtMs);
      const signature = rfidSignature(secret, `WRITE|${transactionId}|${before.epc}|${before.tid}|${requestedEpc}|${expiresAtMs}`);
      return apiSuccess({ transactionId, expiresAtMs, signature, expectedPc: expectedStoredPc(before.pc!, requestedEpc) }, { status: 201, headers: { "cache-control": "no-store" } });
    }
    if (action === "settle" || action === "review") {
      const actual = physical(body.actual);
      const transactionId = text(body.transactionId, 100);
      const attestation = body.attestation;
      const kind = action === "settle" ? "WRITE" : "REVIEW";
      const attested = verifyRfidSignature(secret, `${kind}|${transactionId}|${actual.epc}|${actual.tid}|${actual.pc}`, attestation);
      const command: RfidCommand = { action: action === "settle" ? "settle" : "review", transactionId, epc: actual.epc, pc: actual.pc, tid: actual.tid, attested, error: text(body.error, 1000) || undefined };
      const result = await coordinator.command({ command, operatorId });
      return apiSuccess(result, { headers: { "cache-control": "no-store" } });
    }
    return apiFailure("Unknown RFID write action.", 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "RFID operation failed.";
    const status = message.startsWith("AUTH:") ? 401 : /conflict|already|unresolved|reserved/i.test(message) ? 409 : /CONFIG:/.test(message) ? 503 : 400;
    return apiFailure(message.replace(/^(AUTH|CONFIG):/, ""), status);
  }
}
