import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { KVNamespace } from "@cloudflare/workers-types";
import { decodeChipNumber, generateProfileSequence, normalizeEpc, parseRfidIdentifier, validateEpcProfile, type EpcProfile, type RfidChipStatus, type RfidTransactionStatus } from "./rfid-encoder-core";
import { withTransientKvRetry } from "./kv-retry";

const PREFIX = "raceupshot:rfid";
const CHIP_INDEX = `${PREFIX}:chips:index`;
const JOB_INDEX = `${PREFIX}:jobs:index`;
const TRANSACTION_INDEX = `${PREFIX}:transactions:index`;
const PROFILE_INDEX = `${PREFIX}:profiles:index`;

export interface RfidChipRecord {
  id: string; epc: string; tid?: string; epcLength: number; status: RfidChipStatus;
  chipNumber?: string; epcProfileId?: string;
  firstEncodedAt: string; lastEncodedAt: string; lastVerifiedAt: string;
  readerId: string; operatorId: string; notes: string;
  assignedEventId?: string; assignedParticipantId?: string; assignedBib?: string;
}
export interface RfidEncodingTransactionRecord {
  id: string; readerId: string; operatorId: string; originalEpc: string; requestedEpc: string;
  verifiedEpc: string; tid?: string; operation: "READ" | "WRITE" | "VERIFY" | "BULK_WRITE";
  startedAt: string; completedAt?: string; sdkResponse?: string; verificationResult?: string;
  errorDetails?: string; status: RfidTransactionStatus;
}
export interface RfidEncodingJobRecord {
  id: string; name: string; status: "DRAFT" | "ACTIVE" | "PAUSED" | "STOPPED" | "COMPLETED";
  config: { epcProfileId: string; startingChipNumber: string; total: number }; plannedEpcs: string[]; plannedChipNumbers: string[]; completed: number; failed: number;
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
export async function listRfidProfiles(limit = 100) { const store = await kv(); return listRecords<EpcProfile>(store, PROFILE_INDEX, (id) => `${PREFIX}:profile:${id}`, limit); }

export async function saveRfidProfile(input: EpcProfile, operatorId: string): Promise<EpcProfile> {
  const store = await kv();
  const now = new Date().toISOString();
  const existing = input.id ? await store.get<EpcProfile>(`${PREFIX}:profile:${input.id}`, "json") : null;
  const profile = validateEpcProfile({
    ...input,
    id: input.id || crypto.randomUUID(),
    name: input.name.trim(),
    prefix: normalizeEpc(input.prefix),
    notes: `${input.notes || ""}`.trim(),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  });
  if (profile.name.length < 3) throw new Error("Profile name must contain at least 3 characters.");
  if (profile.verified && !profile.notes) throw new Error("Record the physical chip samples used to verify this EPC profile before enabling it.");
  const profiles = await listRecords<EpcProfile>(store, PROFILE_INDEX, (id) => `${PREFIX}:profile:${id}`, 100);
  const duplicateName = profiles.find((row) => row.id !== profile.id && row.name.toLowerCase() === profile.name.toLowerCase());
  if (duplicateName) throw new Error("An EPC profile with this name already exists.");
  await store.put(`${PREFIX}:profile:${profile.id}`, JSON.stringify({ ...profile, notes: profile.notes ? `${profile.notes}\nLast changed by ${operatorId}` : `Last changed by ${operatorId}` }));
  await prependIndex(store, PROFILE_INDEX, profile.id, 100);
  return profile;
}

export async function findRfidInventoryChip(identifier: string): Promise<RfidChipRecord | null> {
  const payload = parseRfidIdentifier(identifier);
  const values = new Set(payload.candidates);
  if (!values.size) throw new Error("Scan or enter a chip identifier.");
  const chips = await listRfidChips(10_000);
  const matches = chips.filter((chip) => [chip.id, chip.epc, chip.chipNumber].some((value) => value && values.has(value.toUpperCase())));
  if (!matches.length) return null;
  if (matches.length > 1) throw new Error("Multiple inventory records match this chip number. Use the complete EPC or inventory ID.");
  if (["DAMAGED", "RETIRED"].includes(matches[0].status)) throw new Error(`Chip ${matches[0].chipNumber || matches[0].epc} is ${matches[0].status.toLowerCase()} and cannot be assigned.`);
  return matches[0];
}

export async function resolveRfidInventoryChip(identifier: string): Promise<RfidChipRecord> {
  const chip = await findRfidInventoryChip(identifier);
  if (!chip) throw new Error("Chip is not present in verified RFID inventory. Ask an authorized operator to read and verify it first.");
  return chip;
}

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
    const profiles = await listRecords<EpcProfile>(store, PROFILE_INDEX, (id) => `${PREFIX}:profile:${id}`, 100);
    const decoded = profiles.filter((profile) => profile.active && profile.verified).map((profile) => ({ profile, result: decodeChipNumber(transaction.verifiedEpc, profile) })).find((item) => item.result.matched);
    const chip: RfidChipRecord = {
      id: physicalChip?.id || crypto.randomUUID(), epc: transaction.verifiedEpc, tid: transaction.tid || physicalChip?.tid,
      epcLength: transaction.verifiedEpc.length, status: physicalChip?.status || "AVAILABLE",
      chipNumber: decoded?.result.chipNumber || physicalChip?.chipNumber,
      epcProfileId: decoded?.profile.id || physicalChip?.epcProfileId,
      firstEncodedAt: physicalChip?.firstEncodedAt || timestamp, lastEncodedAt: timestamp, lastVerifiedAt: timestamp,
      readerId: transaction.readerId, operatorId: transaction.operatorId, notes: physicalChip?.notes || "",
    };
    await store.put(`${PREFIX}:chip:${chip.id}`, JSON.stringify(chip));
    await prependIndex(store, CHIP_INDEX, chip.id);
  }
  return transaction;
}

export async function createRfidDraftJob(input: { epcProfileId: string; startingChipNumber: string; total: number; name: string; createdBy: string }): Promise<RfidEncodingJobRecord> {
  const store = await kv();
  const profile = await store.get<EpcProfile>(`${PREFIX}:profile:${input.epcProfileId}`, "json");
  if (!profile || !profile.active || !profile.verified) throw new Error("Select an active, physically verified EPC profile.");
  const planned = generateProfileSequence(profile, input.startingChipNumber, input.total);
  const plannedEpcs = planned.map((row) => row.epc);
  const chips = await listRecords<RfidChipRecord>(store, CHIP_INDEX, (id) => `${PREFIX}:chip:${id}`, 10_000);
  const assigned = new Set(chips.map((chip) => chip.epc));
  const duplicate = plannedEpcs.find((epc) => assigned.has(epc));
  if (duplicate) throw new Error(`EPC ${duplicate} already exists in chip inventory.`);
  const now = new Date().toISOString();
  const job: RfidEncodingJobRecord = {
    id: crypto.randomUUID(), name: input.name.trim() || `RFID job ${now.slice(0, 10)}`, status: "DRAFT",
    config: { epcProfileId: profile.id, startingChipNumber: input.startingChipNumber, total: input.total },
    plannedEpcs, plannedChipNumbers: planned.map((row) => row.chipNumber), completed: 0, failed: 0, createdAt: now, updatedAt: now, createdBy: input.createdBy,
  };
  await store.put(`${PREFIX}:job:${job.id}`, JSON.stringify(job));
  await prependIndex(store, JOB_INDEX, job.id);
  return job;
}

export async function getRfidOverview() {
  const [chips, jobs, transactions, profiles] = await Promise.all([listRfidChips(10_000), listRfidJobs(100), listRfidTransactions(1000), listRfidProfiles(100)]);
  return {
    counts: {
      chips: chips.length,
      available: chips.filter((chip) => chip.status === "AVAILABLE").length,
      draftJobs: jobs.filter((job) => job.status === "DRAFT").length,
      verifiedWrites: transactions.filter((row) => row.status === "VERIFIED").length,
      failedWrites: transactions.filter((row) => row.status === "FAILED" || row.status === "UNKNOWN_OUTCOME").length,
    },
    chips, jobs, transactions, profiles,
  };
}
