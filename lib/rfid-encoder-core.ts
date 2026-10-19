import { normalizeEpc, validateEpc, type RfidReaderAdapter, type RfidReaderInfo, type RfidTagRead, type RfidWriteResult } from "@race-technology/rfid-core";

export * from "@race-technology/rfid-core";

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
