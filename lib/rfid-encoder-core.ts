export type RfidConnectionState = "DISCONNECTED" | "CONNECTING" | "CONNECTED" | "ERROR";
export type RfidTransactionStatus = "PENDING" | "WRITING" | "VERIFICATION_PENDING" | "VERIFIED" | "FAILED" | "UNKNOWN_OUTCOME";
export type RfidChipStatus = "AVAILABLE" | "ASSIGNED" | "IN_USE" | "RETURNED" | "DAMAGED" | "RETIRED";

export interface RfidTagRead {
  epc: string;
  tid?: string;
  rssi?: number;
  antenna?: number;
  readAt: string;
}
export interface RfidReaderInfo {
  id: string;
  model: string;
  serialNumber?: string;
  firmwareVersion?: string;
  transport: "WEB_HID" | "WEB_USB" | "WEB_SERIAL" | "LOCAL_BRIDGE" | "MOCK" | "UNAVAILABLE";
  simulation: boolean;
}

export interface RfidWriteResult {
  requestedEpc: string;
  verifiedEpc?: string;
  tid?: string;
  status: RfidTransactionStatus;
  sdkResponse?: string;
  error?: string;
}

export interface RfidReaderAdapter {
  readonly info: RfidReaderInfo;
  connect(): Promise<RfidReaderInfo>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  readOnce(): Promise<RfidTagRead[]>;
  startInventory(onRead: (read: RfidTagRead) => void): Promise<void>;
  stopInventory(): Promise<void>;
  writeEpc(currentEpc: string, requestedEpc: string): Promise<RfidWriteResult>;
}

export interface EpcSequenceInput {
  prefix: string;
  startingSequence: string;
  digits: number;
  increment: number;
  total: number;
  epcLength: number;
}

export function normalizeEpc(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

export function validateEpc(value: string, expectedHexLength?: number): string {
  const epc = normalizeEpc(value);
  if (!epc) throw new Error("EPC is required.");
  if (!/^[0-9A-F]+$/.test(epc)) throw new Error("EPC must contain uppercase hexadecimal characters only (0-9, A-F).");
  if (epc.length % 2 !== 0) throw new Error("EPC must contain an even number of hexadecimal characters.");
  if (expectedHexLength !== undefined && epc.length !== expectedHexLength) {
    throw new Error(`EPC must be exactly ${expectedHexLength} hexadecimal characters. Received ${epc.length}.`);
  }
  return epc;
}

export function generateEpcSequence(input: EpcSequenceInput): string[] {
  const prefix = normalizeEpc(input.prefix);
  if (prefix && !/^[0-9A-F]+$/.test(prefix)) throw new Error("EPC prefix must be hexadecimal.");
  if (!Number.isInteger(input.digits) || input.digits < 1 || input.digits > 64) throw new Error("Sequence digits must be between 1 and 64.");
  if (!Number.isInteger(input.increment) || input.increment < 1) throw new Error("Increment must be a positive whole number.");
  if (!Number.isInteger(input.total) || input.total < 1 || input.total > 10_000) throw new Error("Total chips must be between 1 and 10,000.");
  if (!Number.isInteger(input.epcLength) || input.epcLength < 2 || input.epcLength > 128 || input.epcLength % 2 !== 0) {
    throw new Error("EPC length must be an even number between 2 and 128 hexadecimal characters.");
  }
  const startRaw = input.startingSequence.trim();
  if (!/^[0-9]+$/.test(startRaw)) throw new Error("Starting sequence must contain decimal digits only.");
  if (startRaw.length > input.digits) throw new Error("Starting sequence is longer than the configured digit count.");

  const start = BigInt(startRaw);
  const increment = BigInt(input.increment);
  const max = (10n ** BigInt(input.digits)) - 1n;
  const values: string[] = [];
  for (let index = 0; index < input.total; index += 1) {
    const sequence = start + (BigInt(index) * increment);
    if (sequence > max) throw new Error("The sequence exceeds the configured digit count.");
    const epc = `${prefix}${sequence.toString().padStart(input.digits, "0")}`;
    values.push(validateEpc(epc, input.epcLength));
  }
  if (new Set(values).size !== values.length) throw new Error("The generated EPC range contains duplicates.");
  return values;
}

const SDK_UNAVAILABLE = "RU5600 hardware adapter unavailable. Supply and audit the INVETON RU5600 SDK before reader operations are enabled.";

export class UnavailableRu5600Adapter implements RfidReaderAdapter {
  readonly info: RfidReaderInfo = {
    id: "ru5600-unavailable",
    model: "INVETON RU5600",
    transport: "UNAVAILABLE",
    simulation: false,
  };
  connect(): Promise<RfidReaderInfo> { return Promise.reject(new Error(SDK_UNAVAILABLE)); }
  disconnect(): Promise<void> { return Promise.resolve(); }
  isConnected(): boolean { return false; }
  readOnce(): Promise<RfidTagRead[]> { return Promise.reject(new Error(SDK_UNAVAILABLE)); }
  startInventory(): Promise<void> { return Promise.reject(new Error(SDK_UNAVAILABLE)); }
  stopInventory(): Promise<void> { return Promise.resolve(); }
  writeEpc(): Promise<RfidWriteResult> { return Promise.reject(new Error(SDK_UNAVAILABLE)); }
}

/** Test-only adapter. Production code must never expose it as a physical reader. */
export class MockRu5600Adapter implements RfidReaderAdapter {
  readonly info: RfidReaderInfo = { id: "mock-ru5600", model: "RU5600 Simulation", transport: "MOCK", simulation: true };
  private connected = false;
  private reads: RfidTagRead[];
  constructor(reads: RfidTagRead[] = []) { this.reads = reads.map((read) => ({ ...read, epc: normalizeEpc(read.epc), tid: read.tid ? normalizeEpc(read.tid) : undefined })); }
  async connect() { this.connected = true; return this.info; }
  async disconnect() { this.connected = false; }
  isConnected() { return this.connected; }
  async readOnce() { this.assertConnected(); return this.reads.map((read) => ({ ...read })); }
  async startInventory(onRead: (read: RfidTagRead) => void) { this.assertConnected(); this.reads.forEach(onRead); }
  async stopInventory() { /* no-op in the test adapter */ }
  async writeEpc(currentEpc: string, requestedEpc: string): Promise<RfidWriteResult> {
    this.assertConnected();
    const current = normalizeEpc(currentEpc);
    const requested = validateEpc(requestedEpc);
    const target = this.reads.find((read) => read.epc === current);
    if (!target) return { requestedEpc: requested, status: "FAILED", error: "Tag not responding" };
    target.epc = requested;
    return { requestedEpc: requested, verifiedEpc: target.epc, tid: target.tid, status: target.epc === requested ? "VERIFIED" : "FAILED" };
  }
  private assertConnected() { if (!this.connected) throw new Error("Reader disconnected"); }
}
