import { Ru5600LocalBridgeAdapter, type Ru5600BridgeDevice } from './ru5600-local-bridge';
import { DEFAULT_RFID_DETECTION_CONFIG, RfidPresenceTracker, validateEpc, validateRfidDetectionConfig, type RfidDetectionConfig, type RfidInventoryOptions, type RfidReaderConfigurationResult, type RfidTagRead, type RfidWriteResult } from './rfid-encoder-core';

export type SignedReaderStatus = {
  state: 'CONNECTED' | 'DISCONNECTED' | 'ERROR'; availableReaders: number;
  model?: string; firmware?: string; operatingSystem?: string;
  canReadEpc?: boolean; canWriteEpc?: boolean; error?: string;
};
export type RfidWritePermit = { transactionId: string; expiresAtMs: number; signature: string };

/** BERGMAN bridge protocol adapted to Race Upshot, with an isolated port and pairing. */
export class Ru5600SignedBridgeAdapter extends Ru5600LocalBridgeAdapter {
  private active = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private reading = false;
  private generation = 0;
  private signedDetectionConfig = DEFAULT_RFID_DETECTION_CONFIG;
  private signedPresenceTracker = new RfidPresenceTracker(this.signedDetectionConfig);
  status: SignedReaderStatus | null = null;

  constructor(private readonly url: string, private readonly pairingToken: string) {
    super(url, pairingToken);
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('Use a loopback bridge origin on this computer.');
  }
  static async pair(url: string, code: string) {
    const adapter = new Ru5600SignedBridgeAdapter(url, '');
    const result = await adapter.call<{ token: string }>('/pair', { code });
    if (!/^[a-f0-9]{64}$/.test(result.token)) throw new Error('Bridge returned an invalid pairing token.');
    const verified = new Ru5600SignedBridgeAdapter(url, result.token);
    await verified.refreshStatus();
    return result.token;
  }
  static async automaticPair(url: string, onGenerated?: (generated: { code: string; expiresAt: string }) => void) {
    const adapter = new Ru5600SignedBridgeAdapter(url, '');
    const generated = await adapter.call<{ code: string; expiresAt: string }>('/pair-code', {});
    if (!/^[A-Za-z0-9_-]{24}$/.test(generated.code || '') || new Date(generated.expiresAt).getTime() <= Date.now()) throw new Error('Bridge returned an invalid automatic pairing code.');
    onGenerated?.(generated);
    const token = await Ru5600SignedBridgeAdapter.pair(url, generated.code);
    return { ...generated, token };
  }
  async refreshStatus() {
    try {
      this.status = await this.call<SignedReaderStatus>('/status');
      this.active = this.status.state === 'CONNECTED' && this.status.availableReaders === 1;
      if (!this.active) await this.stopInventory();
      return this.status;
    } catch (error) { this.active = false; await this.stopInventory(); throw error; }
  }
  async listDevices(): Promise<Ru5600BridgeDevice[]> {
    const status = await this.refreshStatus();
    return Array.from({ length: Math.min(Math.max(status.availableReaders || 0, 0), 10) }, (_, index) => ({ index, sdkInfo: status.model || 'RU5600', available: true }));
  }
  async connect() {
    this.status = await this.call<SignedReaderStatus>('/connect', {});
    this.active = this.status.state === 'CONNECTED' && this.status.availableReaders === 1;
    if (!this.active) throw new Error(this.status.error || 'Connect exactly one reader.');
    this.info = { id: `ru5600-signed:${this.status.operatingSystem || 'local'}`, model: this.status.model || 'INVETON RU5600', firmwareVersion: this.status.firmware, transport: 'LOCAL_BRIDGE', simulation: false };
    return this.info;
  }
  isConnected() { return this.active; }
  async disconnect() { this.active = false; await this.stopInventory(); }
  async unpair() { await this.call('/unpair', {}); await this.disconnect(); }
  async readOnce(): Promise<RfidTagRead[]> {
    if (!this.active) throw new Error('Reader disconnected.');
    if (this.reading) throw new Error('Reader is busy.');
    this.reading = true;
    try {
      const result = await this.call<{ tags: RfidTagRead[]; sampleComplete?: boolean; rawResponses?: number }>('/read', {});
      if (!Array.isArray(result.tags)) throw new Error('Malformed bridge scan.');
      return result.tags.map(tag => {
        const epc = validateEpc(tag.epc);
        if (!tag.tid || !/^[0-9A-F]{24}$/.test(tag.tid)) throw new Error('Bridge scan returned an invalid 12-byte TID.');
        if (!tag.pc || !/^[0-9A-F]{4}$/.test(tag.pc)) throw new Error('Bridge scan returned an invalid Stored PC word.');
        return { ...tag, epc, tid: tag.tid, pc: tag.pc };
      });
    } finally { this.reading = false; }
  }
  async configureDetection(config: Partial<RfidDetectionConfig>): Promise<RfidReaderConfigurationResult> {
    this.signedDetectionConfig = validateRfidDetectionConfig({ ...this.signedDetectionConfig, ...config });
    this.signedPresenceTracker = new RfidPresenceTracker(this.signedDetectionConfig);
    if (!this.active) return {
      config: this.signedDetectionConfig, rfPowerApplied: false, antennaSelectionApplied: false,
      rssiFilterApplied: this.signedDetectionConfig.rssiThreshold !== null, hardwareRangeGuaranteed: false,
      warnings: ['Connect the reader to apply and verify its detection profile.'],
    };
    return this.call<RfidReaderConfigurationResult>('/configuration', this.signedDetectionConfig);
  }
  async startInventory(onRead: (read: RfidTagRead) => void, options: RfidInventoryOptions = {}) {
    if (!this.active) throw new Error('Reader disconnected.');
    await this.stopInventory();
    if (options.detectionConfig) await this.configureDetection(options.detectionConfig);
    this.signedPresenceTracker.reset();
    const generation = this.generation;
    const poll = async () => {
      if (generation !== this.generation || !this.active) return;
      try {
        const tags = await this.readOnce();
        if (generation === this.generation) {
          const frame = this.signedPresenceTracker.processFrame(tags, Date.now(), true);
          frame.raw.forEach((event) => options.onRawRead?.(event));
          frame.transitions.forEach((event) => options.onPresenceTransition?.(event));
          frame.accepted.forEach((event) => { options.onAcceptedScan?.(event); onRead(event.read); });
        }
      } catch { /* Failed/incomplete samples never prove physical absence. */ }
      if (generation === this.generation && this.active) this.timer = setTimeout(() => void poll(), 500);
    };
    void poll();
  }
  async stopInventory() { this.generation++; if (this.timer) clearTimeout(this.timer); this.timer = null; }
  async writeEpc(): Promise<RfidWriteResult> {
    throw new Error('Signed encoding requires the Race Upshot reservation backend. No hardware write was attempted.');
  }
  async writeWithPermit(before: RfidTagRead, requestedEpc: string, permit: RfidWritePermit) {
    if (!this.active || !this.status?.canWriteEpc) throw new Error('Reader writing has not been enabled after physical validation.');
    if (this.reading) throw new Error('Reader is busy.');
    await this.stopInventory();
    const epc = validateEpc(requestedEpc);
    if (!before.tid || !before.pc || permit.expiresAtMs <= Date.now()) throw new Error('A fresh EPC, Stored PC, 12-byte TID and valid cloud permit are required.');
    return this.call<{ after: RfidTagRead; attestation: string }>('/write', { currentEpc: before.epc, tid: before.tid, newEpc: epc, ...permit }, 90_000);
  }
  async checkSigning(preflight: { nonce: string; expiresAtMs: number; signature: string }) { return this.call<{ verified: true }>('/check-signing', preflight); }
  async review(transactionId: string) { return this.call<{ actual: RfidTagRead; attestation: string }>('/review', { transactionId }); }
  private async call<T = Record<string, unknown>>(path: string, body?: object, timeout = 45_000): Promise<T> {
    const response = await fetch(`${this.url.replace(/\/$/, '')}${path}`, {
      method: body ? 'POST' : 'GET', mode: 'cors', cache: 'no-store', signal: AbortSignal.timeout(timeout),
      headers: { 'X-RFID-Bridge-Key': this.pairingToken, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Local bridge returned HTTP ${response.status}.`);
    return result as T;
  }
}
