type SharedTimingModule = typeof import("@race-technology/timing-calculations");

export const SHARED_TIMING_PACKAGE_VERSION = "0.1.0";
export const SHARED_TIMING_CORE_COMMIT_SHA = "1f1edde24d506d7d3b2bdbb31cdec56636e6a675";
export const SHARED_TIMING_CORE_SOURCE_CHECKSUM = "c80da1af302ebe5c7b9cbbe88635ff492132a7e49e880e84d2cecbc12c417156";
export const SHARED_TIMING_PACKAGE_ARTIFACT_CHECKSUM = "49146d45436f48e9699ae0cd7876d5d8694add7c71b5da50cd9faccbde8fac30";

export type TimingShadowOperation = "timestamp" | "start_configuration" | "start_resolution" | "start_read" | "start_passage" | "read_selection" | "durations";
export type TimingShadowDifferenceCategory = "INPUT_MAPPING_DIFFERENCE" | "OUTPUT_MAPPING_DIFFERENCE" | "TIMESTAMP_NORMALIZATION_DIFFERENCE" | "START_RESOLUTION_DIFFERENCE" | "READ_SELECTION_DIFFERENCE" | "SPLIT_CALCULATION_DIFFERENCE" | "PACE_CALCULATION_DIFFERENCE" | "SHARED_CORE_EXCEPTION" | "UNKNOWN";

export interface TimingParityRecord {
  product: "RACE_UPSHOT";
  packageVersion: string;
  sharedCoreCommitSha: string;
  sharedCoreSourceChecksum: string;
  operation: TimingShadowOperation;
  match: boolean;
  existingResultHash: string;
  sharedResultHash: string;
  differenceCategory: TimingShadowDifferenceCategory | null;
  timestamp: string;
  eventScope?: string;
  traceId?: string;
}

type Loader = () => Promise<SharedTimingModule>;
type Sink = (record: TimingParityRecord) => void | Promise<void>;
const MAX_RECORDS = 200;
const records: TimingParityRecord[] = [];
const pending = new Set<Promise<void>>();
let testMode: "off" | "shadow" | null = null;
let loader: Loader = () => import("@race-technology/timing-calculations");
let sink: Sink | null = null;

function mode(): "off" | "shadow" {
  if (testMode) return testMode;
  return typeof process !== "undefined" && process.env.SHARED_TIMING_CALCULATIONS_MODE === "shadow" ? "shadow" : "off";
}

function clean(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, clean(item)]));
  return value;
}

function serialized(value: unknown): string { return JSON.stringify(clean(value)); }
function hash(value: unknown): string {
  const text = serialized(value); let state = 0xcbf29ce484222325n;
  for (let index = 0; index < text.length; index += 1) { state ^= BigInt(text.charCodeAt(index)); state = BigInt.asUintN(64, state * 0x100000001b3n); }
  return state.toString(16).padStart(16, "0");
}

function emit(record: TimingParityRecord): void {
  records.push(record); if (records.length > MAX_RECORDS) records.splice(0, records.length - MAX_RECORDS);
  if (sink) { try { const result = sink(record); if (result && typeof (result as Promise<void>).catch === "function") void (result as Promise<void>).catch(() => undefined); } catch { /* telemetry is non-authoritative */ } }
}

function schedule<T>(args: {
  operation: TimingShadowOperation;
  input: unknown;
  authoritative: T;
  calculate: (shared: SharedTimingModule, input: any) => unknown;
  normalize?: (value: any) => unknown;
  classify: (existing: unknown, shared: unknown) => TimingShadowDifferenceCategory;
  eventScope?: string;
  traceId?: string;
}): T {
  if (mode() !== "shadow") return args.authoritative;
  const normalize = args.normalize ?? clean;
  const existing = normalize(args.authoritative);
  const task = Promise.resolve().then(loader).then((shared) => args.calculate(shared, args.input)).then((value) => {
    const shared = normalize(value); const match = serialized(existing) === serialized(shared);
    emit({ product: "RACE_UPSHOT", packageVersion: SHARED_TIMING_PACKAGE_VERSION, sharedCoreCommitSha: SHARED_TIMING_CORE_COMMIT_SHA, sharedCoreSourceChecksum: SHARED_TIMING_CORE_SOURCE_CHECKSUM, operation: args.operation, match, existingResultHash: hash(existing), sharedResultHash: hash(shared), differenceCategory: match ? null : args.classify(existing, shared), timestamp: new Date().toISOString(), ...(args.eventScope ? { eventScope: args.eventScope } : {}), ...(args.traceId ? { traceId: args.traceId } : {}) });
  }).catch(() => {
    emit({ product: "RACE_UPSHOT", packageVersion: SHARED_TIMING_PACKAGE_VERSION, sharedCoreCommitSha: SHARED_TIMING_CORE_COMMIT_SHA, sharedCoreSourceChecksum: SHARED_TIMING_CORE_SOURCE_CHECKSUM, operation: args.operation, match: false, existingResultHash: hash(existing), sharedResultHash: hash("SHARED_CORE_EXCEPTION"), differenceCategory: "SHARED_CORE_EXCEPTION", timestamp: new Date().toISOString(), ...(args.eventScope ? { eventScope: args.eventScope } : {}), ...(args.traceId ? { traceId: args.traceId } : {}) });
  });
  pending.add(task); void task.finally(() => pending.delete(task));
  return args.authoritative;
}

const read = (value: any) => value ? { status: value.status ?? null, source: value.source ?? null, timestamp: value.timestamp ?? value.occurredAt ?? null, elapsedSeconds: value.elapsedSeconds ?? null, overallElapsedSeconds: value.overallElapsedSeconds ?? null, passNumber: value.passNumber ?? null } : null;
const startState = (value: any) => value ? { officialStartTime: value.officialStartTime ?? null, chipStartDetectionTime: value.chipStartDetectionTime ?? null, startTimeSource: value.startTimeSource ?? null, startTimeLocked: value.startTimeLocked ?? false, acceptedReadId: value.acceptedReadId ?? null, startPassageId: value.startPassageId ?? null, startReadCount: value.startReadCount ?? 0, startStatus: value.startStatus ?? null, startInferenceSource: value.startInferenceSource ?? null } : null;
const startDecision = (value: any) => value ? { status: value.status, reason: value.reason, permittedStartTime: value.permittedStartTime ?? null, state: startState(value.state), canonicalRead: read(value.canonicalRead) } : null;
const startPassageDecision = (value: any) => value ? { ...startDecision(value), rawStatus: value.rawStatus, usedForTiming: value.usedForTiming, passage: value.passage ? { first: value.passage.passageFirstTimestamp, last: value.passage.passageLastTimestamp, readCount: value.passage.readCount, status: value.passage.passageStatus, usedForTiming: value.passage.usedForTiming } : null } : null;
const config = (value: any) => value ? { mode: value.mode, gunStartTime: value.gunStartTime ?? null, dedupWindowSeconds: value.dedupWindowSeconds, validWindowMinutes: value.validWindowMinutes, dnsGraceMinutes: value.dnsGraceMinutes, strictFinalCutoff: value.strictFinalCutoff, startWindowOpenTime: value.startWindowOpenTime ?? null, startWindowCloseTime: value.startWindowCloseTime ?? null, passageGapSeconds: value.passageGapSeconds, timingReorderBufferMs: value.timingReorderBufferMs, minimumFinishGapSeconds: value.minimumFinishGapSeconds, requireMandatorySplitsBeforeFinish: value.requireMandatorySplitsBeforeFinish } : null;
const duration = (value: any) => value ? { swimSeconds: value.swimSeconds ?? null, t1Seconds: value.t1Seconds ?? null, bikeSeconds: value.bikeSeconds ?? null, t2Seconds: value.t2Seconds ?? null, runSeconds: value.runSeconds ?? null, overallSeconds: value.overallSeconds ?? null, averageSwimPaceSecondsPer100m: value.averageSwimPaceSecondsPer100m ?? null, averageBikeSpeedKmh: value.averageBikeSpeedKmh ?? null, averageRunPaceSecondsPerKm: value.averageRunPaceSecondsPerKm ?? null, averageRacePaceSecondsPerKm: value.averageRacePaceSecondsPerKm ?? null } : null;

export const shadowNormalizeTimestampUtc = <T>(input: { value: unknown; providerTimezone?: string }, authoritative: T): T => schedule({ operation: "timestamp", input, authoritative, calculate: (shared, row) => shared.normalizeTimestampUtc(row.value, row.providerTimezone), classify: () => "TIMESTAMP_NORMALIZATION_DIFFERENCE" });
export const shadowNormalizeStartConfiguration = <T>(input: unknown, authoritative: T): T => schedule({ operation: "start_configuration", input, authoritative, calculate: (shared, row) => shared.normalizeStartConfiguration(row), normalize: config, classify: () => "OUTPUT_MAPPING_DIFFERENCE" });
export const shadowResolveOfficialAthleteStart = <T>(input: unknown, authoritative: T): T => schedule({ operation: "start_resolution", input, authoritative, calculate: (shared, row) => shared.resolveOfficialAthleteStart(row), classify: () => "START_RESOLUTION_DIFFERENCE" });
export const shadowProcessStartTimingRead = <T>(input: unknown, authoritative: T): T => schedule({ operation: "start_read", input, authoritative, calculate: (shared, row) => shared.processStartTimingRead(row), normalize: startDecision, classify: () => "START_RESOLUTION_DIFFERENCE" });
export const shadowProcessStartPassageRead = <T>(input: unknown, authoritative: T): T => schedule({ operation: "start_passage", input, authoritative, calculate: (shared, row) => shared.processStartPassageRead(row), normalize: startPassageDecision, classify: () => "READ_SELECTION_DIFFERENCE" });
export const shadowSelectTimingRead = <T>(input: { existing: unknown; candidate: unknown; split: unknown }, authoritative: T): T => schedule({ operation: "read_selection", input, authoritative, calculate: (shared, row) => shared.selectTimingRead(row.existing, row.candidate, row.split), normalize: read, classify: () => "READ_SELECTION_DIFFERENCE" });
export const shadowCalculateDurations = <T>(input: { reads: unknown; contest: unknown }, authoritative: T): T => schedule({ operation: "durations", input, authoritative, calculate: (shared, row) => shared.calculateDurations(row.reads, row.contest), normalize: duration, classify: (existing: any, shared: any) => ["swimSeconds", "t1Seconds", "bikeSeconds", "t2Seconds", "runSeconds", "overallSeconds"].every((key) => existing?.[key] === shared?.[key]) ? "PACE_CALCULATION_DIFFERENCE" : "SPLIT_CALCULATION_DIFFERENCE" });

export function getTimingParityTelemetry(): readonly TimingParityRecord[] { return [...records]; }
export function clearTimingParityTelemetry(): void { records.length = 0; }
export async function flushTimingShadowWork(): Promise<void> { await Promise.all([...pending]); }
export function configureTimingShadowForTests(overrides: { mode?: "off" | "shadow" | null; loader?: Loader; sink?: Sink | null }): void { if (overrides.mode !== undefined) testMode = overrides.mode; if (overrides.loader) loader = overrides.loader; if (overrides.sink !== undefined) sink = overrides.sink; }
export function resetTimingShadowForTests(): void { testMode = null; loader = () => import("@race-technology/timing-calculations"); sink = null; records.length = 0; }
