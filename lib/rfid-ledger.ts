import { validateEpc } from './rfid-encoder-core';
import type { RfidChipRecord, RfidEncodingJobRecord, RfidEncodingTransactionRecord } from './rfid-encoder-repository';

export type LedgerTransaction = RfidEncodingTransactionRecord & { expiresAtMs?: number; jobId?: string };
export type LedgerJob = RfidEncodingJobRecord & { completedEpcs?: string[] };
export type RfidLedger = { chips: RfidChipRecord[]; jobs: LedgerJob[]; transactions: LedgerTransaction[] };
export type RfidCommand =
  | { action: 'read'; epc: string; pc: string; tid: string; readerId: string }
  | { action: 'reserve'; originalEpc: string; originalPc: string; requestedEpc: string; tid: string; readerId: string; jobId?: string }
  | { action: 'settle' | 'review'; transactionId: string; epc?: string; pc?: string; tid?: string; attested: boolean; error?: string }
  | { action: 'create-job'; job: LedgerJob }
  | { action: 'job-state'; jobId: string; status: 'ACTIVE' | 'PAUSED' | 'STOPPED' }
  | { action: 'chip-status'; chipId: string; status: RfidChipRecord['status']; notes: string };
export const emptyRfidLedger = (): RfidLedger => ({ chips: [], jobs: [], transactions: [] });
const unresolved = (row: LedgerTransaction) => !['VERIFIED', 'FAILED'].includes(row.status);
const busyChip = (chip: RfidChipRecord) => Boolean(chip.assignedEventId || chip.assignedParticipantId || ['ASSIGNED', 'IN_USE', 'DAMAGED', 'RETIRED'].includes(chip.status));
function wordEpc(value: string) { const epc = validateEpc(value); if (epc.length % 4) throw new Error('EPC must contain complete 16-bit words.'); return epc; }
export function expectedStoredPc(originalPc: string, requestedEpc: string) {
  if (!/^[0-9A-F]{4}$/.test(originalPc)) throw new Error('A complete Stored PC word is required.');
  const epc = wordEpc(requestedEpc);
  const first = Number.parseInt(originalPc.slice(0, 2), 16);
  const words = epc.length / 4;
  if (words < 1 || words > 31) throw new Error('Stored PC supports 1–31 EPC words.');
  return `${(((words & 0x1f) << 3) | (first & 0x07)).toString(16).padStart(2, '0')}${originalPc.slice(2)}`.toUpperCase();
}

/** Pure state transition. The coordinator commits all changed records atomically. */
export function applyRfidCommand(state: RfidLedger, command: RfidCommand, operatorId: string, now = Date.now(), id: string = crypto.randomUUID()) {
  const at = new Date(now).toISOString();
  if (command.action === 'read') {
    const epc = wordEpc(command.epc);
    if (!/^[0-9A-F]{24}$/.test(command.tid) || !/^[0-9A-F]{4}$/.test(command.pc)) throw new Error('A complete EPC, Stored PC and 12-byte TID are required.');
    const row: LedgerTransaction = { id, readerId: command.readerId, operatorId, originalEpc: epc, requestedEpc: epc, verifiedEpc: epc, tid: command.tid, operation: 'READ', status: 'VERIFIED', startedAt: at, completedAt: at, sdkResponse: JSON.stringify({ pc: command.pc }), verificationResult: 'PHYSICAL_EPC_PC_TID_READ' };
    state.transactions.unshift(row);
    return row;
  }
  if (command.action === 'reserve') {
    const originalEpc = wordEpc(command.originalEpc), requestedEpc = wordEpc(command.requestedEpc);
    if (!/^[0-9A-F]{8,128}$/.test(command.tid) || command.tid.length % 2) throw new Error('A live complete TID is required.');
    if (originalEpc === requestedEpc) throw new Error('Use a distinct replacement EPC.');
    if (!/^[0-9A-F]{4}$/.test(command.originalPc) || (Number.parseInt(command.originalPc.slice(0, 2), 16) >> 3) !== originalEpc.length / 4) throw new Error('Stored PC does not describe the scanned EPC length.');
    if (!command.readerId || command.readerId.length > 180) throw new Error('Reader identity is required.');
    const physical = state.chips.find(chip => chip.tid === command.tid);
    if (physical && (physical.epc !== originalEpc || busyChip(physical))) throw new Error('This chip is assigned, unavailable, or its stored EPC differs. Reconcile it before encoding.');
    if (state.chips.some(chip => chip.epc === requestedEpc || (chip.epc === originalEpc && chip.tid !== command.tid))) throw new Error('EPC is already owned by another inventory record.');
    if (state.transactions.some(row => unresolved(row) && (row.tid === command.tid || [row.originalEpc, row.requestedEpc].some(epc => epc === requestedEpc || epc === originalEpc)))) throw new Error('Chip or EPC has an unresolved write. Review that transaction first.');
    const job = command.jobId ? state.jobs.find(job => job.id === command.jobId) : undefined;
    if (command.jobId && (!job || job.status !== 'ACTIVE' || !job.plannedEpcs.includes(requestedEpc) || job.completedEpcs?.includes(requestedEpc))) throw new Error('Bulk job is not active or does not own this unfinished EPC.');
    if (state.jobs.some(job => job.id !== command.jobId && job.status !== 'STOPPED' && job.plannedEpcs.includes(requestedEpc))) throw new Error('EPC is reserved by another bulk job.');
    const expectedPc = expectedStoredPc(command.originalPc, requestedEpc);
    const transaction: LedgerTransaction = { id, readerId: command.readerId, operatorId, originalEpc, requestedEpc, tid: command.tid, verifiedEpc: '', operation: job ? 'BULK_WRITE' : 'WRITE', status: 'PENDING', startedAt: at, expiresAtMs: now + 120_000, jobId: job?.id, sdkResponse: JSON.stringify({ originalPc: command.originalPc, expectedPc }) };
    state.transactions.unshift(transaction);
    return transaction;
  }
  if (command.action === 'settle' || command.action === 'review') {
    const row = state.transactions.find(row => row.id === command.transactionId);
    if (!row) throw new Error('Unknown reserved transaction.');
    if (!unresolved(row)) return row; // Idempotent settlement; no downgrade or replay.
    if (command.action === 'review' && now <= (row.expiresAtMs || 0) + 90_000) throw new Error('Wait for the write permit and possible native operation to expire before reviewing.');
    const sameTag = command.attested && command.tid === row.tid;
    const pc = (() => { try { return JSON.parse(row.sdkResponse || '{}') as { originalPc?: string; expectedPc?: string }; } catch { return {}; } })();
    const verified = sameTag && command.epc === row.requestedEpc && command.pc === pc.expectedPc;
    const unchanged = command.action === 'review' && sameTag && command.epc === row.originalEpc && command.pc === pc.originalPc;
    const physical = state.chips.find(chip => chip.tid === row.tid);
    if (verified && state.chips.some(chip => chip.epc === row.requestedEpc && chip.id !== physical?.id)) throw new Error('Inventory EPC conflict requires reconciliation.');
    row.status = verified ? 'VERIFIED' : unchanged ? 'FAILED' : 'UNKNOWN_OUTCOME';
    row.completedAt = at;
    row.verifiedEpc = verified ? row.requestedEpc : '';
    row.errorDetails = verified ? undefined : unchanged ? 'Physical review confirmed the original EPC and PC; reservation released.' : (command.error || 'Signed same-TID EPC/PC read-back unavailable. Physical review required.').slice(0, 1000);
    row.verificationResult = verified ? 'VERIFIED:SAME_TID_EPC_PC' : unchanged ? 'UNWRITTEN_VERIFIED' : 'REVIEW_REQUIRED';
    if (verified) {
      const chip: RfidChipRecord = { ...physical, id: physical?.id || id, epc: row.requestedEpc, tid: row.tid, epcLength: row.requestedEpc.length, status: physical?.status || 'AVAILABLE', firstEncodedAt: physical?.firstEncodedAt || at, lastEncodedAt: at, lastVerifiedAt: at, readerId: row.readerId, operatorId, notes: physical?.notes || '', chipNumber: undefined, epcProfileId: undefined };
      state.chips = [chip, ...state.chips.filter(item => item.id !== chip.id)];
      const job = state.jobs.find(job => job.id === row.jobId);
      if (job) { job.completedEpcs = [...new Set([...(job.completedEpcs || []), row.requestedEpc])]; job.completed = job.completedEpcs.length; job.updatedAt = at; if (job.completed === job.plannedEpcs.length) job.status = 'COMPLETED'; }
    }
    return row;
  }
  if (command.action === 'create-job') {
    const job = command.job;
    const epcs = new Set(job.plannedEpcs.map(wordEpc));
    if (!epcs.size || epcs.size !== job.plannedEpcs.length || epcs.size > 10000) throw new Error('Invalid bulk EPC plan.');
    if (state.chips.some(chip => epcs.has(chip.epc)) || state.transactions.some(row => unresolved(row) && epcs.has(row.requestedEpc)) || state.jobs.some(row => row.status !== 'STOPPED' && row.plannedEpcs.some(epc => epcs.has(epc)))) throw new Error('Bulk range overlaps existing inventory or reservations.');
    state.jobs.unshift(job); return job;
  }
  if (command.action === 'job-state') {
    const job = state.jobs.find(job => job.id === command.jobId);
    if (!job || ['STOPPED', 'COMPLETED'].includes(job.status)) throw new Error('Job is missing or already closed.');
    if (!['ACTIVE', 'PAUSED', 'STOPPED'].includes(command.status)) throw new Error('Invalid job state.');
    job.status = command.status; job.updatedAt = at; return job;
  }
  if (command.action === 'chip-status') {
    const chip = state.chips.find(chip => chip.id === command.chipId);
    if (!chip) throw new Error('Inventory chip is missing.');
    if (!['AVAILABLE', 'RETURNED', 'DAMAGED', 'RETIRED'].includes(command.status) || chip.assignedEventId || chip.assignedParticipantId || ['ASSIGNED', 'IN_USE'].includes(chip.status)) throw new Error('Assigned chips must be managed through athlete assignment.');
    const before = chip.status; chip.status = command.status; chip.notes = command.notes.slice(0, 1000);
    state.transactions.unshift({ id, readerId: chip.readerId, operatorId, originalEpc: chip.epc, requestedEpc: chip.epc, verifiedEpc: '', tid: chip.tid, operation: 'VERIFY', startedAt: at, completedAt: at, status: 'VERIFIED', verificationResult: `INVENTORY_STATUS:${before}:${chip.status}` });
    return chip;
  }
  throw new Error('Unknown RFID command.');
}
