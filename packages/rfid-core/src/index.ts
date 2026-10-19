export type RfidConnectionState = "DISCONNECTED" | "CONNECTING" | "CONNECTED" | "ERROR";
export type RfidTransactionStatus = "PENDING" | "WRITING" | "VERIFICATION_PENDING" | "VERIFIED" | "FAILED" | "UNKNOWN_OUTCOME";
export type RfidChipStatus = "AVAILABLE" | "ASSIGNED" | "IN_USE" | "RETURNED" | "DAMAGED" | "RETIRED";
export type EpcNumberEncoding = "DECIMAL_DIGITS" | "BCD" | "ASCII" | "HEX_INTEGER";
export type LeadingZeroPolicy = "PAD" | "PRESERVE" | "REJECT";

export interface RfidTagRead {
  epc: string;
  tid?: string;
  /** Stored-bank Protocol Control word read from word 1. */
  pc?: string;
  rssi?: number;
  antenna?: number;
  readAt: string;
}

export type RfidPresenceState = "OUT_OF_RANGE" | "IN_RANGE" | "EXIT_DETECTED";
export type RfidRawReadDecision = "ACCEPTED_ENTRY" | "DUPLICATE_IN_RANGE" | "RSSI_REJECTED" | "ANTENNA_REJECTED" | "REENTRY_DISABLED";

export interface RfidDetectionConfig {
  rfPowerDbm: number | null;
  antennaIds: number[];
  targetRangeCm: number;
  absenceTimeoutMs: number;
  singleReadPerEntry: boolean;
  reentryDetection: boolean;
  suppressDuplicateInventory: boolean;
  rssiThreshold: number | null;
  presenceMonitoring: boolean;
  physicallyCalibrated: boolean;
  calibrationMethod: "UNVERIFIED" | "RF_POWER" | "NEAR_FIELD_ANTENNA" | "SHIELDING" | "COMBINED";
  calibrationNotes: string;
}

export interface RfidRawInventoryEvent {
  kind: "RAW_INVENTORY";
  identity: string;
  read: RfidTagRead;
  observedAt: string;
  decision: RfidRawReadDecision;
}

export interface RfidAcceptedScanEvent {
  kind: "ACCEPTED_SCAN";
  identity: string;
  read: RfidTagRead;
  acceptedAt: string;
  entryNumber: number;
}

export interface RfidPresenceTransition {
  kind: "PRESENCE_TRANSITION";
  identity: string;
  from: RfidPresenceState;
  to: RfidPresenceState;
  occurredAt: string;
  reason: "ENTRY_DETECTED" | "ABSENCE_TIMEOUT";
}

export interface RfidInventoryFrameResult {
  raw: RfidRawInventoryEvent[];
  accepted: RfidAcceptedScanEvent[];
  transitions: RfidPresenceTransition[];
}

export interface RfidInventoryOptions {
  detectionConfig?: Partial<RfidDetectionConfig>;
  onRawRead?: (event: RfidRawInventoryEvent) => void;
  onAcceptedScan?: (event: RfidAcceptedScanEvent) => void;
  onPresenceTransition?: (event: RfidPresenceTransition) => void;
}

export interface RfidReaderConfigurationResult {
  config: RfidDetectionConfig;
  rfPowerApplied: boolean;
  antennaSelectionApplied: boolean;
  rssiFilterApplied: boolean;
  hardwareRangeGuaranteed: false;
  warnings: string[];
}

export const DEFAULT_RFID_DETECTION_CONFIG: RfidDetectionConfig = {
  rfPowerDbm: null,
  antennaIds: [],
  targetRangeCm: 15.24,
  absenceTimeoutMs: 1_000,
  singleReadPerEntry: true,
  reentryDetection: true,
  suppressDuplicateInventory: true,
  rssiThreshold: null,
  presenceMonitoring: true,
  physicallyCalibrated: false,
  calibrationMethod: "UNVERIFIED",
  calibrationNotes: "",
};

export function validateRfidDetectionConfig(input: Partial<RfidDetectionConfig> = {}): RfidDetectionConfig {
  const config = { ...DEFAULT_RFID_DETECTION_CONFIG, ...input };
  if (config.rfPowerDbm !== null && (!Number.isFinite(config.rfPowerDbm) || config.rfPowerDbm < -30 || config.rfPowerDbm > 36)) throw new Error("RF power must be between -30 and 36 dBm.");
  if (!Number.isFinite(config.targetRangeCm) || config.targetRangeCm <= 0 || config.targetRangeCm > 15.24) throw new Error("Detection-zone target must be greater than zero and no more than 15.24 cm (6 inches).");
  if (!Number.isInteger(config.absenceTimeoutMs) || config.absenceTimeoutMs < 100 || config.absenceTimeoutMs > 60_000) throw new Error("Chip absence timeout must be between 100 and 60,000 milliseconds.");
  if (config.rssiThreshold !== null && (!Number.isFinite(config.rssiThreshold) || config.rssiThreshold < -120 || config.rssiThreshold > 0)) throw new Error("RSSI threshold must be between -120 and 0 dBm.");
  const antennaIds = [...new Set(config.antennaIds.map(Number))];
  if (antennaIds.some((antenna) => !Number.isInteger(antenna) || antenna < 1 || antenna > 64)) throw new Error("Antenna IDs must be whole numbers from 1 to 64.");
  if (config.physicallyCalibrated && (config.calibrationMethod === "UNVERIFIED" || config.calibrationNotes.trim().length < 10)) throw new Error("A physically calibrated profile requires a calibration method and test notes.");
  return { ...config, antennaIds, calibrationNotes: config.calibrationNotes.trim() };
}

function readIdentity(read: RfidTagRead): string {
  const tid = read.tid ? normalizeEpc(read.tid) : "";
  return tid ? `TID:${tid}` : `EPC:${normalizeEpc(read.epc)}`;
}

/** Converts noisy inventory frames into one accepted scan per confirmed zone entry. */
export class RfidPresenceTracker {
  private readonly present = new Map<string, { lastSeenAtMs: number; entryNumber: number }>();
  private readonly acceptedIdentities = new Set<string>();
  private readonly entryCounts = new Map<string, number>();
  private config: RfidDetectionConfig;

  constructor(config: Partial<RfidDetectionConfig> = {}) { this.config = validateRfidDetectionConfig(config); }

  configure(config: Partial<RfidDetectionConfig>) {
    this.config = validateRfidDetectionConfig({ ...this.config, ...config });
    return this.config;
  }

  reset() { this.present.clear(); this.acceptedIdentities.clear(); this.entryCounts.clear(); }

  state(identity: string): RfidPresenceState { return this.present.has(identity) ? "IN_RANGE" : "OUT_OF_RANGE"; }

  processFrame(reads: RfidTagRead[], observedAtMs = Date.now(), sampleComplete = true): RfidInventoryFrameResult {
    if (!Number.isFinite(observedAtMs)) throw new Error("Inventory observation time is invalid.");
    const observedAt = new Date(observedAtMs).toISOString();
    const raw: RfidRawInventoryEvent[] = [];
    const accepted: RfidAcceptedScanEvent[] = [];
    const transitions: RfidPresenceTransition[] = [];

    for (const [identity, entry] of this.present) {
      // A partial/failed reader sample is not evidence that a tag left the
      // antenna. Only a completed empty sample may advance absence state.
      if (!sampleComplete) continue;
      if (observedAtMs - entry.lastSeenAtMs < this.config.absenceTimeoutMs) continue;
      transitions.push({ kind: "PRESENCE_TRANSITION", identity, from: "IN_RANGE", to: "EXIT_DETECTED", occurredAt: observedAt, reason: "ABSENCE_TIMEOUT" });
      this.present.delete(identity);
    }

    for (const input of reads) {
      const read = { ...input, epc: normalizeEpc(input.epc), tid: input.tid ? normalizeEpc(input.tid) : undefined };
      const identity = readIdentity(read);
      let decision: RfidRawReadDecision;
      if (this.config.antennaIds.length && (read.antenna === undefined || !this.config.antennaIds.includes(read.antenna))) decision = "ANTENNA_REJECTED";
      else if (this.config.rssiThreshold !== null && (read.rssi === undefined || read.rssi < this.config.rssiThreshold)) decision = "RSSI_REJECTED";
      else {
        const existing = this.present.get(identity);
        if (!this.config.presenceMonitoring) {
          const entryNumber = (this.entryCounts.get(identity) ?? 0) + 1;
          this.entryCounts.set(identity, entryNumber);
          decision = "ACCEPTED_ENTRY";
          accepted.push({ kind: "ACCEPTED_SCAN", identity, read, acceptedAt: observedAt, entryNumber });
        } else if (existing && this.config.singleReadPerEntry) {
          existing.lastSeenAtMs = observedAtMs;
          decision = "DUPLICATE_IN_RANGE";
        } else if (!existing && !this.config.reentryDetection && this.acceptedIdentities.has(identity)) decision = "REENTRY_DISABLED";
        else {
          const entryNumber = (this.entryCounts.get(identity) ?? 0) + 1;
          this.present.set(identity, { lastSeenAtMs: observedAtMs, entryNumber });
          this.entryCounts.set(identity, entryNumber);
          this.acceptedIdentities.add(identity);
          decision = "ACCEPTED_ENTRY";
          const scan = { kind: "ACCEPTED_SCAN", identity, read, acceptedAt: observedAt, entryNumber } as const;
          accepted.push(scan);
          if (!existing) transitions.push({ kind: "PRESENCE_TRANSITION", identity, from: "OUT_OF_RANGE", to: "IN_RANGE", occurredAt: observedAt, reason: "ENTRY_DETECTED" });
        }
      }
      raw.push({ kind: "RAW_INVENTORY", identity, read, observedAt, decision });
    }
    return { raw, accepted, transitions };
  }
}

export interface RfidReaderInfo {
  id: string;
  model: string;
  serialNumber?: string;
  firmwareVersion?: string;
  transport: "WEB_HID" | "WEB_USB" | "WEB_SERIAL" | "LOCAL_BRIDGE" | "NETWORK_BRIDGE" | "MOCK" | "UNAVAILABLE";
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
  startInventory(onRead: (read: RfidTagRead) => void, options?: RfidInventoryOptions): Promise<void>;
  stopInventory(): Promise<void>;
  configureDetection?(config: Partial<RfidDetectionConfig>): Promise<RfidReaderConfigurationResult>;
  writeEpc(currentEpc: string, requestedEpc: string): Promise<RfidWriteResult>;
}

export interface EpcProfile {
  id: string;
  name: string;
  epcLength: number;
  prefix: string;
  chipNumberPosition: number;
  chipNumberLength: number;
  numberEncoding: EpcNumberEncoding;
  leadingZeroPolicy: LeadingZeroPolicy;
  sequenceIncrement: number;
  maximumChipNumber: string;
  verified: boolean;
  active: boolean;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface DecodedChipNumber {
  matched: boolean;
  chipNumber: string | null;
  fullEpc: string;
  profileId: string;
  error?: "UNKNOWN_EPC_FORMAT";
}

export interface RfidIdentifierPayload {
  kind: "FULL_EPC" | "CHIP_NUMBER" | "INVENTORY_ID" | "UNKNOWN";
  value: string;
  candidates: string[];
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

export function parseRfidIdentifier(input: string): RfidIdentifierPayload {
  const raw = input.trim();
  const candidates: string[] = [];
  const add = (value: unknown) => {
    const text = typeof value === "string" ? textValue(value) : "";
    if (text && !candidates.includes(text)) candidates.push(text);
  };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const key of ["fullEpc", "epc", "chipNumber", "chip", "inventoryId", "chipInventoryId", "id"]) add(parsed[key]);
  } catch { /* Plain values and URL payloads are handled below. */ }
  try {
    const url = new URL(raw);
    for (const key of ["fullEpc", "epc", "chipNumber", "chip", "inventoryId", "id"]) add(url.searchParams.get(key));
    add(decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) || ""));
  } catch { /* Not a URL. */ }
  add(raw);
  const value = candidates[0] || "";
  const normalized = value.replace(/\s+/g, "").toUpperCase();
  const kind = /^\d+$/.test(normalized) ? "CHIP_NUMBER"
    : /^[0-9A-F]+$/.test(normalized) && normalized.length >= 16 && normalized.length % 2 === 0 ? "FULL_EPC"
      : /^(RFID|CHIP)[-_:]/i.test(value) || /^[0-9a-f-]{32,}$/i.test(value) ? "INVENTORY_ID" : "UNKNOWN";
  return { kind, value: normalized || value, candidates: candidates.map((candidate) => candidate.replace(/\s+/g, "").toUpperCase()) };
}

function textValue(value: string): string {
  try { return decodeURIComponent(value.trim()); }
  catch { return value.trim(); }
}

export function validateEpc(value: string, expectedHexLength?: number): string {
  const epc = normalizeEpc(value);
  if (!epc) throw new Error("EPC is required.");
  if (!/^[0-9A-F]+$/.test(epc)) throw new Error("EPC must contain hexadecimal characters only (0-9, A-F).");
  if (epc.length < 4 || epc.length > 84 || epc.length % 4 !== 0) throw new Error("EPC must contain 4–84 hexadecimal characters in complete 16-bit words (2–42 bytes).");
  if (expectedHexLength !== undefined && epc.length !== expectedHexLength) throw new Error(`EPC must be exactly ${expectedHexLength} hexadecimal characters. Received ${epc.length}.`);
  return epc;
}

export function validateEpcProfile(profile: EpcProfile): EpcProfile {
  const prefix = normalizeEpc(profile.prefix);
  if (prefix && !/^[0-9A-F]+$/.test(prefix)) throw new Error("EPC profile prefix must be hexadecimal.");
  if (!Number.isInteger(profile.epcLength) || profile.epcLength < 2 || profile.epcLength > 128 || profile.epcLength % 2 !== 0) throw new Error("EPC profile length must be an even number from 2 to 128 hexadecimal characters.");
  if (prefix.length > profile.epcLength) throw new Error("EPC profile prefix is longer than the EPC.");
  if (!Number.isInteger(profile.chipNumberPosition) || profile.chipNumberPosition < prefix.length) throw new Error("Chip number position must start after the configured prefix.");
  if (!Number.isInteger(profile.chipNumberLength) || profile.chipNumberLength < 1 || profile.chipNumberPosition + profile.chipNumberLength > profile.epcLength) throw new Error("Chip number field must fit inside the EPC.");
  if (profile.numberEncoding === "ASCII" && profile.chipNumberLength % 2 !== 0) throw new Error("ASCII chip number fields must contain an even number of hexadecimal characters.");
  if (!Number.isInteger(profile.sequenceIncrement) || profile.sequenceIncrement < 1) throw new Error("Sequence increment must be a positive whole number.");
  if (!/^\d+$/.test(profile.maximumChipNumber) || BigInt(profile.maximumChipNumber) < 1n) throw new Error("Maximum chip number must contain decimal digits.");
  return { ...profile, prefix };
}

function encodeField(chipNumber: string, profile: EpcProfile): string {
  if (!/^\d+$/.test(chipNumber)) throw new Error("Chip number must contain decimal digits only.");
  const canonical = BigInt(chipNumber).toString();
  if (BigInt(canonical) > BigInt(profile.maximumChipNumber)) throw new Error(`Chip number exceeds profile maximum ${profile.maximumChipNumber}.`);
  if (profile.leadingZeroPolicy === "REJECT" && chipNumber.length > 1 && chipNumber.startsWith("0")) throw new Error("This EPC profile rejects leading zeros in chip numbers.");
  if (profile.numberEncoding === "ASCII") {
    const width = profile.chipNumberLength / 2;
    const value = profile.leadingZeroPolicy === "PAD" ? canonical.padStart(width, "0") : chipNumber;
    if (value.length !== width) throw new Error(`Chip number must occupy exactly ${width} ASCII characters.`);
    return [...value].map((character) => character.charCodeAt(0).toString(16).padStart(2, "0")).join("").toUpperCase();
  }
  if (profile.numberEncoding === "HEX_INTEGER") {
    const encoded = BigInt(canonical).toString(16).toUpperCase();
    if (encoded.length > profile.chipNumberLength) throw new Error("Chip number does not fit the configured hexadecimal field.");
    return encoded.padStart(profile.chipNumberLength, "0");
  }
  const value = profile.leadingZeroPolicy === "PAD" ? canonical.padStart(profile.chipNumberLength, "0") : chipNumber;
  if (value.length !== profile.chipNumberLength) throw new Error(`Chip number must occupy exactly ${profile.chipNumberLength} decimal digits.`);
  return value;
}

export function encodeChipNumber(chipNumber: string, rawProfile: EpcProfile): string {
  const profile = validateEpcProfile(rawProfile);
  if (!profile.verified) throw new Error("The selected EPC profile is not physically verified.");
  const field = encodeField(chipNumber.trim(), profile);
  const epc = `${profile.prefix}${"0".repeat(profile.epcLength - profile.prefix.length)}`.split("");
  epc.splice(profile.chipNumberPosition, profile.chipNumberLength, ...field);
  return validateEpc(epc.join(""), profile.epcLength);
}

export function decodeChipNumber(value: string, rawProfile: EpcProfile): DecodedChipNumber {
  const profile = validateEpcProfile(rawProfile);
  let epc: string;
  try { epc = validateEpc(value, profile.epcLength); }
  catch { return { matched: false, chipNumber: null, fullEpc: normalizeEpc(value), profileId: profile.id, error: "UNKNOWN_EPC_FORMAT" }; }
  if (!epc.startsWith(profile.prefix)) return { matched: false, chipNumber: null, fullEpc: epc, profileId: profile.id, error: "UNKNOWN_EPC_FORMAT" };
  const field = epc.slice(profile.chipNumberPosition, profile.chipNumberPosition + profile.chipNumberLength);
  let decoded = "";
  try {
    if (profile.numberEncoding === "ASCII") {
      decoded = field.match(/.{2}/g)?.map((byte) => String.fromCharCode(Number.parseInt(byte, 16))).join("") ?? "";
      if (!/^\d+$/.test(decoded)) throw new Error("not decimal ASCII");
    } else if (profile.numberEncoding === "HEX_INTEGER") decoded = BigInt(`0x${field}`).toString();
    else {
      if (!/^\d+$/.test(field)) throw new Error("not decimal digits");
      decoded = field;
    }
    const chipNumber = profile.leadingZeroPolicy === "PRESERVE" ? decoded : BigInt(decoded).toString();
    if (encodeChipNumber(chipNumber, { ...profile, verified: true }) !== epc) throw new Error("not reversible");
    return { matched: true, chipNumber, fullEpc: epc, profileId: profile.id };
  } catch {
    return { matched: false, chipNumber: null, fullEpc: epc, profileId: profile.id, error: "UNKNOWN_EPC_FORMAT" };
  }
}

export function generateProfileSequence(profile: EpcProfile, startingChipNumber: string, total: number): Array<{ chipNumber: string; epc: string }> {
  validateEpcProfile(profile);
  if (!Number.isInteger(total) || total < 1 || total > 10_000) throw new Error("Total chips must be between 1 and 10,000.");
  if (!/^\d+$/.test(startingChipNumber)) throw new Error("Starting chip number must contain decimal digits only.");
  const start = BigInt(startingChipNumber);
  return Array.from({ length: total }, (_, index) => {
    const chipNumber = (start + BigInt(index * profile.sequenceIncrement)).toString();
    return { chipNumber, epc: encodeChipNumber(chipNumber, profile) };
  });
}

/** Legacy explicit EPC generator retained for already saved Race Upshot draft jobs. */
export function generateEpcSequence(input: EpcSequenceInput): string[] {
  const explicitLength = normalizeEpc(input.prefix).length + input.digits;
  if (explicitLength !== input.epcLength) throw new Error(`EPC must be exactly ${input.epcLength} hexadecimal characters. Generated length would be ${explicitLength}.`);
  const profile: EpcProfile = {
    id: "legacy-explicit", name: "Legacy explicit EPC", epcLength: input.epcLength,
    prefix: input.prefix, chipNumberPosition: normalizeEpc(input.prefix).length, chipNumberLength: input.digits,
    numberEncoding: "DECIMAL_DIGITS", leadingZeroPolicy: "PAD", sequenceIncrement: input.increment,
    maximumChipNumber: "9".repeat(input.digits), verified: true, active: true,
  };
  return generateProfileSequence(profile, input.startingSequence.trim(), input.total).map((item) => item.epc);
}

/** Advances a full EPC without losing precision or leading zeroes. */
export function nextSequentialEpc(value: string): string {
  const epc = validateEpc(value);
  const next = BigInt(`0x${epc}`) + 1n;
  const encoded = next.toString(16).toUpperCase();
  if (encoded.length > epc.length) throw new Error("EPC sequence has reached its maximum value.");
  return encoded.padStart(epc.length, "0");
}
