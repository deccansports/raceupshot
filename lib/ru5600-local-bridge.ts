import { DEFAULT_RFID_DETECTION_CONFIG, normalizeEpc, RfidPresenceTracker, validateRfidDetectionConfig, type RfidDetectionConfig, type RfidInventoryOptions, type RfidReaderAdapter, type RfidReaderConfigurationResult, type RfidReaderInfo, type RfidTagRead, type RfidWriteResult } from "./rfid-encoder-core";

type BridgeEnvelope<T> = { ok: boolean; data?: T; error?: string };
export type Ru5600BridgeDevice = { index: number; sdkInfo: string; available: boolean };
export type Ru5600BridgeReaderDetails = RfidReaderInfo & { hardwareVersion?: string };

export class Ru5600LocalBridgeAdapter implements RfidReaderAdapter {
  info: Ru5600BridgeReaderDetails = { id: "ru5600-local-bridge", model: "INVETON RU5600", transport: "LOCAL_BRIDGE", simulation: false };
  private connected = false;
  private polling: ReturnType<typeof setInterval> | null = null;
  private detectionConfig = DEFAULT_RFID_DETECTION_CONFIG;
  private presenceTracker = new RfidPresenceTracker(this.detectionConfig);

  constructor(private readonly baseUrl: string, private readonly token: string, private readonly deviceIndex = 0) {}

  isConnected() { return this.connected; }

  async listDevices(): Promise<Ru5600BridgeDevice[]> { return this.request<Ru5600BridgeDevice[]>("/v1/devices"); }

  async connect(): Promise<RfidReaderInfo> {
    const details = await this.request<{ index: number; model: string; serialNumber: string; firmwareVersion: string; hardwareVersion: string }>("/v1/connect", { index: this.deviceIndex });
    this.connected = true;
    this.info = { id: details.serialNumber ? `ru5600:${details.serialNumber}` : `ru5600:index:${details.index}`, model: details.model, serialNumber: details.serialNumber, firmwareVersion: details.firmwareVersion, hardwareVersion: details.hardwareVersion, transport: "LOCAL_BRIDGE", simulation: false };
    return this.info;
  }

  async disconnect(): Promise<void> {
    await this.stopInventory().catch(() => undefined);
    await this.request("/v1/disconnect", {});
    this.connected = false;
  }

  async readOnce(): Promise<RfidTagRead[]> {
    this.requireConnected();
    const result = await this.request<{ tags: RfidTagRead[] }>("/v1/read-once", {});
    return result.tags.map(normalizeRead);
  }

  async configureDetection(config: Partial<RfidDetectionConfig>): Promise<RfidReaderConfigurationResult> {
    this.detectionConfig = validateRfidDetectionConfig({ ...this.detectionConfig, ...config });
    this.presenceTracker = new RfidPresenceTracker(this.detectionConfig);
    if (!this.connected) return softwareConfigurationResult(this.detectionConfig);
    try { return await this.request<RfidReaderConfigurationResult>("/v1/configuration", { ...this.detectionConfig }); }
    catch { return softwareConfigurationResult(this.detectionConfig); }
  }

  async startInventory(onRead: (read: RfidTagRead) => void, options: RfidInventoryOptions = {}): Promise<void> {
    this.requireConnected();
    if (this.polling !== null) return;
    if (options.detectionConfig) await this.configureDetection(options.detectionConfig);
    this.presenceTracker.reset();
    await this.request("/v1/inventory/start", {});
    const poll = async () => {
      try {
        const reads = await this.request<RfidTagRead[]>("/v1/inventory/poll");
        const frame = this.presenceTracker.processFrame(reads.map(normalizeRead));
        frame.raw.forEach((event) => options.onRawRead?.(event));
        frame.transitions.forEach((event) => options.onPresenceTransition?.(event));
        frame.accepted.forEach((event) => { options.onAcceptedScan?.(event); onRead(event.read); });
      } catch {
        const frame = this.presenceTracker.processFrame([]);
        frame.transitions.forEach((event) => options.onPresenceTransition?.(event));
        /* Connection state is reconciled by the next explicit action. */
      }
    };
    this.polling = globalThis.setInterval(() => void poll(), 500);
    await poll();
  }

  async stopInventory(): Promise<void> {
    if (this.polling !== null) { globalThis.clearInterval(this.polling); this.polling = null; }
    if (this.connected) await this.request("/v1/inventory/stop", {});
  }

  async writeEpc(currentEpc: string, requestedEpc: string): Promise<RfidWriteResult & { transactionId?: string; originalEpc?: string; startedAt?: string; completedAt?: string; verificationResult?: string }> {
    this.requireConnected();
    return this.request("/v1/write-epc", { currentEpc: normalizeEpc(currentEpc), requestedEpc: normalizeEpc(requestedEpc) });
  }

  private requireConnected() { if (!this.connected) throw new Error("Reader disconnected."); }

  private async request<T = Record<string, unknown>>(path: string, body?: Record<string, unknown>): Promise<T> {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
        method: body === undefined ? "GET" : "POST", mode: "cors", cache: "no-store", signal: controller.signal,
        headers: { Authorization: `Bearer ${this.token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const payload = await response.json() as BridgeEnvelope<T>;
      if (!response.ok || !payload.ok || payload.data === undefined) throw new Error(payload.error || `Local bridge returned HTTP ${response.status}.`);
      return payload.data;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw new Error("The local RU5600 bridge did not respond within 12 seconds.");
      throw error;
    } finally { globalThis.clearTimeout(timeout); }
  }
}
function softwareConfigurationResult(config: RfidDetectionConfig): RfidReaderConfigurationResult {
  return {
    config, rfPowerApplied: false, antennaSelectionApplied: false, rssiFilterApplied: config.rssiThreshold !== null,
    hardwareRangeGuaranteed: false,
    warnings: ["The audited RU5600 SDK does not expose a verified RF-power command. Enforce the 15.24 cm target with a calibrated near-field antenna and/or shielding."],
  };
}
function normalizeRead(read: RfidTagRead): RfidTagRead {
  return { ...read, epc: normalizeEpc(read.epc), tid: read.tid ? normalizeEpc(read.tid) : undefined };
}
