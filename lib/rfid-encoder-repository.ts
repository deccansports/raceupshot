import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { KVNamespace } from "@cloudflare/workers-types";
import { generateEpcSequence, type EpcSequenceInput, type RfidChipStatus, type RfidTransactionStatus } from "./rfid-encoder-core";
import { withTransientKvRetry } from "./kv-retry";

const PREFIX = "raceupshot:rfid";
const CHIP_INDEX = `${PREFIX}:chips:index`;
const JOB_INDEX = `${PREFIX}:jobs:index`;
const TRANSACTION_INDEX = `${PREFIX}:transactions:index`;

export interface RfidChipRecord {
  id: string; epc: string; tid?: string; epcLength: number; status: RfidChipStatus;
  firstEncodedAt: string; lastEncodedAt: string; lastVerifiedAt: string;
  readerId: string; operatorId: string; notes: string;
}
export interface RfidEncodingTransactionRecord {
  id: string; readerId: string; operatorId: string; originalEpc: string; requestedEpc: string;
  verifiedEpc: string; tid?: string; operation: "READ" | "WRITE" | "VERIFY" | "BULK_WRITE";
  startedAt: string; completedAt?: string; sdkResponse?: string; verificationResult?: string;
  errorDetails?: string; status: RfidTransactionStatus;
}
export interface RfidEncodingJobRecord {
  id: string; name: string; status: "DRAFT" | "ACTIVE" | "PAUSED" | "STOPPED" | "COMPLETED";
  config: EpcSequenceInput; plannedEpcs: string[]; completed: number; failed: number;
  createdAt: string; updatedAt: string; createdBy: string;
}
async function kv(): Promise<KVNamespace> {
  const { env } = await getCloudflareContext({ async: true });
  if (!env.RACEUPSHOT) throw new Error("RACEUPSHOT KV binding is unavailable.");
  return withTransientKvRetry(env.RACEUPSHOT);
}
async function listRecords<T>(store: KVNamespace, indexKey: string, key: (id: string) => string, limit = 500): Promise<T[]> {
  const ids = (await store.get<string[]>(indexKey, "json") ?? []).slice(0, limit);
  const records = await Promise.all(ids.map((id) => store.get<T>(key(id), "json")));
  return records.filter((value) => value !== null) as T[];
}
async function prependIndex(store: KVNamespace, indexKey: string, id: string, limit = 10_000) {
  const ids = await store.get<string[]>(indexKey, "json") ?? [];
  await store.put(indexKey, JSON.stringify([id, ...ids.filter((value) => value !== id)].slice(0, limit)));
}

export async function listRfidChips(limit = 500) { const store = await kv(); return listRecords<RfidChipRecord>(store, CHIP_INDEX, (id) => `${PREFIX}:chip:${id}`, limit); }
export async function listRfidTransactions(limit = 500) { const store = await kv(); return listRecords<RfidEncodingTransactionRecord>(store, TRANSACTION_INDEX, (id) => `${PREFIX}:transaction:${id}`, limit); }
export async function listRfidJobs(limit = 100) { const store = await kv(); return listRecords<RfidEncodingJobRecord>(store, JOB_INDEX, (id) => `${PREFIX}:job:${id}`, limit); }

export async function recordRfidBridgeWrite(input: {
  transactionId: string; readerId: string; operatorId: string; originalEpc: string; requestedEpc: string;
  verifiedEpc?: string; tid?: string; startedAt: string; completedAt: string; sdkResponse?: string;
  verificationResult?: string; error?: string; status: RfidTransactionStatus;
}): Promise<RfidEncodingTransactionRecord> {
  const store = await kv();
  const chips = await listRecords<RfidChipRecord>(store, CHIP_INDEX, (id) => `${PREFIX}:chip:${id}`, 10_000);
  const physicalChip = input.tid
    ? chips.find((chip) => chip.tid === input.tid)
    : chips.find((chip) => chip.epc === input.originalEpc);
  const duplicate = input.verifiedEpc
    ? chips.find((chip) => chip.epc === input.verifiedEpc && chip.id !== physicalChip?.id)
    : undefined;
  const hasConflict = input.status === "VERIFIED" && Boolean(duplicate);
  const transaction: RfidEncodingTransactionRecord = {
    id: input.transactionId,
    readerId: input.readerId,
    operatorId: input.operatorId,
    originalEpc: input.originalEpc,
    requestedEpc: input.requestedEpc,
    verifiedEpc: input.verifiedEpc || "",
    tid: input.tid,
    operation: "WRITE",
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    sdkResponse: input.sdkResponse,
    verificationResult: hasConflict ? "CLOUD_DUPLICATE_CONFLICT" : input.verificationResult,
    errorDetails: hasConflict ? `Verified EPC conflicts with inventory chip ${duplicate?.id}. Physical reconciliation required.` : input.error,
    status: hasConflict ? "UNKNOWN_OUTCOME" : input.status,
  };
  await store.put(`${PREFIX}:transaction:${transaction.id}`, JSON.stringify(transaction));
  await prependIndex(store, TRANSACTION_INDEX, transaction.id);
  if (transaction.status === "VERIFIED" && transaction.verifiedEpc === transaction.requestedEpc) {
    const timestamp = transaction.completedAt || new Date().toISOString();
    const chip: RfidChipRecord = {
      id: physicalChip?.id || crypto.randomUUID(), epc: transaction.verifiedEpc, tid: transaction.tid || physicalChip?.tid,
      epcLength: transaction.verifiedEpc.length, status: physicalChip?.status || "AVAILABLE",
      firstEncodedAt: physicalChip?.firstEncodedAt || timestamp, lastEncodedAt: timestamp, lastVerifiedAt: timestamp,
      readerId: transaction.readerId, operatorId: transaction.operatorId, notes: physicalChip?.notes || "",
    };
    await store.put(`${PREFIX}:chip:${chip.id}`, JSON.stringify(chip));
    await prependIndex(store, CHIP_INDEX, chip.id);
  }
  return transaction;
}

export async function createRfidDraftJob(input: EpcSequenceInput & { name: string; createdBy: string }): Promise<RfidEncodingJobRecord> {
  const store = await kv();
  const plannedEpcs = generateEpcSequence(input);
  const chips = await listRecords<RfidChipRecord>(store, CHIP_INDEX, (id) => `${PREFIX}:chip:${id}`, 10_000);
  const assigned = new Set(chips.map((chip) => chip.epc));
  const duplicate = plannedEpcs.find((epc) => assigned.has(epc));
  if (duplicate) throw new Error(`EPC ${duplicate} already exists in chip inventory.`);
  const now = new Date().toISOString();
  const job: RfidEncodingJobRecord = {
    id: crypto.randomUUID(), name: input.name.trim() || `RFID job ${now.slice(0, 10)}`, status: "DRAFT",
    config: { prefix: input.prefix, startingSequence: input.startingSequence, digits: input.digits, increment: input.increment, total: input.total, epcLength: input.epcLength },
    plannedEpcs, completed: 0, failed: 0, createdAt: now, updatedAt: now, createdBy: input.createdBy,
  };
  await store.put(`${PREFIX}:job:${job.id}`, JSON.stringify(job));
  await prependIndex(store, JOB_INDEX, job.id);
  return job;
}

export async function getRfidOverview() {
  const [chips, jobs, transactions] = await Promise.all([listRfidChips(10_000), listRfidJobs(100), listRfidTransactions(1000)]);
  return {
    counts: {
      chips: chips.length,
      available: chips.filter((chip) => chip.status === "AVAILABLE").length,
      draftJobs: jobs.filter((job) => job.status === "DRAFT").length,
      verifiedWrites: transactions.filter((row) => row.status === "VERIFIED").length,
      failedWrites: transactions.filter((row) => row.status === "FAILED" || row.status === "UNKNOWN_OUTCOME").length,
    },
    chips, jobs, transactions,
  };
}
