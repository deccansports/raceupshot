"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Cable, CheckCircle2, Clipboard, Cpu, RadioTower, RefreshCw, Settings2, ShieldCheck, Unplug, WifiOff, Zap } from "lucide-react";
import { DEFAULT_RFID_DETECTION_CONFIG, nextSequentialEpc, validateEpc, validateRfidDetectionConfig, type RfidDetectionConfig } from "@/lib/rfid-encoder-core";
import { Ru5600LocalBridgeAdapter } from "@/lib/ru5600-local-bridge";
import { Ru5600SignedBridgeAdapter } from "@/lib/ru5600-signed-bridge";

type Tab = "read" | "write" | "settings";
type DisplayRead = { epc: string; tid?: string; pc?: string; rssi?: number; antenna?: number; firstDetected: string; lastDetected: string; readCount: number };
type ApiEnvelope<T> = { ok: boolean; data?: T; error?: string };

async function rfidAdminPost<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/admin/rfid/write", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  const result = await response.json() as ApiEnvelope<T>;
  if (!response.ok || !result.ok || !result.data) throw new Error(result.error || `RFID backend returned HTTP ${response.status}.`);
  return result.data;
}

const tabs: Array<{ id: Tab; label: string; icon: typeof Cpu }> = [
  { id: "read", label: "Read Chip", icon: RadioTower },
  { id: "write", label: "Write Chip", icon: Zap },
  { id: "settings", label: "Reader Settings", icon: Settings2 },
];

export function RfidEncoderAdmin() {
  const [tab, setTab] = useState<Tab>("read");
  const [notice, setNotice] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [currentEpc, setCurrentEpc] = useState("");
  const [selectedTid, setSelectedTid] = useState("");
  const [selectedPc, setSelectedPc] = useState("");
  const [reviewTransactionId, setReviewTransactionId] = useState("");
  const [newEpc, setNewEpc] = useState("");
  const [epcHexLength, setEpcHexLength] = useState(24);
  const [sequential, setSequential] = useState(false);
  const [bridgeUrl, setBridgeUrl] = useState("http://127.0.0.1:8766");
  const [bridgeToken, setBridgeToken] = useState("");
  const [bridgeKind, setBridgeKind] = useState<"SIGNED" | "LEGACY">("SIGNED");
  const [readerConnected, setReaderConnected] = useState(false);
  const [readerInfo, setReaderInfo] = useState<{ id: string; serialNumber?: string; firmwareVersion?: string; hardwareVersion?: string } | null>(null);
  const [readerBusy, setReaderBusy] = useState(false);
  const [continuousReading, setContinuousReading] = useState(false);
  const [reads, setReads] = useState<DisplayRead[]>([]);
  const [rawInventoryCount, setRawInventoryCount] = useState(0);
  const [suppressedInventoryCount, setSuppressedInventoryCount] = useState(0);
  const [confirmedExitCount, setConfirmedExitCount] = useState(0);
  const [awaitingRemovalTid, setAwaitingRemovalTid] = useState<string | null>(null);
  const [encodeOutcome, setEncodeOutcome] = useState<"IDLE" | "VERIFIED" | "WRITE FAILED" | "VERIFICATION FAILED" | "UNKNOWN OUTCOME">("IDLE");
  const [detectionConfig, setDetectionConfig] = useState<RfidDetectionConfig>(DEFAULT_RFID_DETECTION_CONFIG);
  const adapterRef = useRef<Ru5600LocalBridgeAdapter | null>(null);
  const [capabilities] = useState(() => {
    if (typeof navigator === "undefined") return { webHid: false, webUsb: false, webSerial: false, online: true, os: "Unknown" };
    const browser = navigator as Navigator & { hid?: unknown; usb?: unknown; serial?: unknown; userAgentData?: { platform?: string } };
    return { webHid: Boolean(browser.hid), webUsb: Boolean(browser.usb), webSerial: Boolean(browser.serial), online: navigator.onLine, os: browser.userAgentData?.platform || navigator.platform || "Unknown" };
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setBridgeUrl(sessionStorage.getItem("raceupshot:ru5600:bridge-url") || "http://127.0.0.1:8766");
      setBridgeKind(sessionStorage.getItem("raceupshot:ru5600:bridge-kind") === "LEGACY" ? "LEGACY" : "SIGNED");
      setBridgeToken(localStorage.getItem("raceupshot-rfid-local-pair-token") || sessionStorage.getItem("raceupshot:ru5600:bridge-token") || "");
      try {
        const saved = JSON.parse(sessionStorage.getItem("raceupshot:ru5600:detection-config") || "{}") as Partial<RfidDetectionConfig>;
        setDetectionConfig(validateRfidDetectionConfig(saved));
      } catch { setDetectionConfig(DEFAULT_RFID_DETECTION_CONFIG); }
    }, 0);
    return () => { window.clearTimeout(timer); void adapterRef.current?.disconnect().catch(() => undefined); };
  }, []);

  const proposedEpc = useMemo(() => ({
    value: newEpc,
    error: newEpc && !/^(?:[0-9A-F]{4}){1,21}$/.test(newEpc)
      ? "Replacement EPC must contain 4–84 hexadecimal characters in complete 16-bit words."
      : "",
  }), [newEpc]);
  const writePrerequisite = reviewTransactionId ? "Resolve the pending physical review before another write."
    : !readerConnected ? "Connect the physical reader."
      : !currentEpc || !selectedTid || !selectedPc ? "Read one target chip to capture EPC, Stored PC and TID."
        : !newEpc ? "Enter or prepare a replacement EPC."
          : proposedEpc.error || (readerBusy ? "Wait for the current reader operation to finish." : awaitingRemovalTid ? "Remove the verified chip and present the next chip." : "Ready for explicit confirmation and guarded write.");

  function storeBridgeSettings(url: string, token: string, kind: "SIGNED" | "LEGACY") {
    void adapterRef.current?.disconnect(); adapterRef.current = null; setReaderConnected(false); setReaderInfo(null); setReads([]); setCurrentEpc(""); setSelectedTid(""); setSelectedPc(""); setContinuousReading(false);
    setBridgeKind(kind); sessionStorage.setItem("raceupshot:ru5600:bridge-kind", kind);
    setBridgeUrl(url); setBridgeToken(token);
    sessionStorage.setItem("raceupshot:ru5600:bridge-url", url);
    sessionStorage.setItem("raceupshot:ru5600:bridge-token", token);
    if (kind === "SIGNED") localStorage.setItem("raceupshot-rfid-local-pair-token", token);
  }

  async function storeDetectionConfig(next: RfidDetectionConfig) {
    const validated = validateRfidDetectionConfig(next);
    setDetectionConfig(validated);
    sessionStorage.setItem("raceupshot:ru5600:detection-config", JSON.stringify(validated));
    if (!adapterRef.current) {
      setNotice({ type: "success", text: "Detection profile saved for this browser session. Connect the reader to apply supported controls." });
      return;
    }
    const result = await adapterRef.current.configureDetection?.(validated);
    setNotice({ type: result?.warnings.length ? "error" : "success", text: result?.warnings.join(" ") || "Detection profile applied." });
  }
  async function connectReader() {
    if (bridgeToken.trim().length < 24) { setTab("settings"); return setNotice({ type: "error", text: "Enter the local bridge token in Reader Settings before connecting." }); }
    setReaderBusy(true); setNotice(null);
    try {
      const adapter = bridgeKind === "SIGNED" ? new Ru5600SignedBridgeAdapter(bridgeUrl, bridgeToken.trim()) : new Ru5600LocalBridgeAdapter(bridgeUrl, bridgeToken.trim());
      const devices = await adapter.listDevices();
      if (!devices.length) throw new Error("The local bridge is running, but the SDK found no RU5600 USB reader.");
      const info = await adapter.connect();
      adapterRef.current = adapter;
      const configured = await adapter.configureDetection?.(detectionConfig);
      setReaderConnected(true); setReaderInfo(info); setNotice({ type: configured?.warnings.length ? "error" : "success", text: configured?.warnings.join(" ") || `Physical reader connected${info.serialNumber ? ` · ${info.serialNumber}` : ""}.` });
    } catch (error) { setReaderConnected(false); setReaderInfo(null); setNotice({ type: "error", text: error instanceof Error ? error.message : "Reader connection failed." }); }
    finally { setReaderBusy(false); }
  }
  async function disconnectReader() {
    setReaderBusy(true);
    try { await adapterRef.current?.disconnect(); setReaderConnected(false); setReaderInfo(null); setContinuousReading(false); setNotice({ type: "success", text: "Reader disconnected." }); }
    catch (error) { setNotice({ type: "error", text: error instanceof Error ? error.message : "Reader disconnect failed." }); }
    finally { setReaderBusy(false); }
  }
  function mergeRead(read: { epc: string; tid?: string; pc?: string; rssi?: number; antenna?: number; readAt: string }) {
    setReads((current) => {
      const existing = current.find((item) => item.epc === read.epc);
      if (!existing) return [{ ...read, firstDetected: read.readAt, lastDetected: read.readAt, readCount: 1 }, ...current];
      return current.map((item) => item.epc === read.epc ? { ...item, tid: read.tid || item.tid, pc: read.pc || item.pc, rssi: read.rssi, antenna: read.antenna, lastDetected: read.readAt, readCount: item.readCount + 1 } : item);
    });
  }
  async function readOnce() {
    setReaderBusy(true); setNotice(null);
    try { const detected = await adapterRef.current!.readOnce(); detected.forEach(mergeRead); setNotice({ type: detected.length ? "success" : "error", text: detected.length ? `${detected.length} unique chip reading received.` : "No chip detected." }); }
    catch (error) { setNotice({ type: "error", text: error instanceof Error ? error.message : "RFID read failed." }); }
    finally { setReaderBusy(false); }
  }
  async function startReading() {
    try {
      setRawInventoryCount(0); setSuppressedInventoryCount(0); setConfirmedExitCount(0);
      await adapterRef.current!.startInventory(mergeRead, {
        detectionConfig,
        onRawRead: (event) => { setRawInventoryCount((value) => value + 1); if (event.decision !== "ACCEPTED_ENTRY") setSuppressedInventoryCount((value) => value + 1); },
        onPresenceTransition: (event) => { if (event.reason === "ABSENCE_TIMEOUT") setConfirmedExitCount((value) => value + 1); },
      });
      setContinuousReading(true); setNotice({ type: "success", text: "Presence monitoring started. Repeated reader responses are separated from accepted entry scans." });
    }
    catch (error) { setNotice({ type: "error", text: error instanceof Error ? error.message : "Continuous reading could not start." }); }
  }
  async function stopReading() {
    try { await adapterRef.current!.stopInventory(); setContinuousReading(false); setNotice({ type: "success", text: "Continuous reading stopped." }); }
    catch (error) { setNotice({ type: "error", text: error instanceof Error ? error.message : "Continuous reading could not stop." }); }
  }
  async function writeEpc() {
    const targetEpc = proposedEpc.value;
    try { validateEpc(currentEpc); validateEpc(targetEpc); } catch (error) { return setNotice({ type: "error", text: error instanceof Error ? error.message : "Invalid EPC." }); }
    if (!/^(?:[0-9A-F]{4}){1,21}$/.test(targetEpc)) return setNotice({ type: "error", text: "Replacement EPC must be 2–42 bytes in complete 16-bit words." });
    if (!window.confirm(`Overwrite EPC ${currentEpc} with ${targetEpc}? Exactly one chip must be near the reader.`)) return;
    setReaderBusy(true); setNotice(null);
    let reservationCreated = false;
    try {
      if (bridgeKind === "SIGNED") {
        const adapter = adapterRef.current;
        if (!(adapter instanceof Ru5600SignedBridgeAdapter)) throw new Error("Connect the Race Upshot signed bridge first.");
        await adapter.stopInventory(); setContinuousReading(false);
        const detected = await adapter.readOnce();
        if (detected.length !== 1) throw new Error(`Exactly one chip is required; detected ${detected.length}.`);
        const before = detected[0];
        if (!before.tid || !before.pc) throw new Error("A complete TID and Stored PC read are required before writing.");
        if (awaitingRemovalTid === before.tid) throw new Error("Remove the encoded chip and present a different chip before the next write.");
        if (before.epc !== currentEpc) throw new Error("The live chip EPC changed. Read the target again before writing.");
        const preflight = await rfidAdminPost<{ nonce: string; expiresAtMs: number; signature: string }>({ action: "preflight" });
        await adapter.checkSigning(preflight);
        const permit = await rfidAdminPost<{ transactionId: string; expiresAtMs: number; signature: string; expectedPc: string }>({ action: "reserve", before, requestedEpc: targetEpc, readerId: adapter.info.id });
        reservationCreated = true;
        setReviewTransactionId(permit.transactionId);
        const result = await adapter.writeWithPermit(before, targetEpc, permit);
        const settled = await rfidAdminPost<{ status: string }>({ action: "settle", transactionId: permit.transactionId, actual: result.after, attestation: result.attestation });
        if (settled.status !== "VERIFIED" || result.after.epc !== targetEpc || result.after.tid !== before.tid || result.after.pc !== permit.expectedPc) throw new Error("VERIFICATION FAILED: same-TID EPC and Stored PC read-back did not match.");
        setReviewTransactionId(""); setEncodeOutcome("VERIFIED"); setAwaitingRemovalTid(before.tid); setCurrentEpc(targetEpc); setSelectedTid(before.tid); setSelectedPc(result.after.pc || ""); setNewEpc(sequential ? nextSequentialEpc(targetEpc) : "");
        setNotice({ type: "success", text: `VERIFIED · ${targetEpc} read back on the same physical TID. Remove this chip before continuing.` });
        return;
      }
      const result = await adapterRef.current!.writeEpc(currentEpc, targetEpc);
      if (result.status !== "VERIFIED" || result.verifiedEpc !== targetEpc) throw new Error(result.error || "Physical write was not verified.");
      setEncodeOutcome("VERIFIED"); setCurrentEpc(targetEpc); setNewEpc(""); setNotice({ type: "success", text: `VERIFIED · ${targetEpc}` });
    } catch (error) { setEncodeOutcome(reservationCreated ? "UNKNOWN OUTCOME" : "WRITE FAILED"); setNotice({ type: "error", text: `${error instanceof Error ? error.message : "ENCODING FAILED"}${reservationCreated ? " Scan the same physical tag to review before another write." : ""}` }); }
    finally { setReaderBusy(false); }
  }
  async function reviewWrite() {
    const adapter = adapterRef.current;
    if (!(adapter instanceof Ru5600SignedBridgeAdapter) || !reviewTransactionId) return;
    setReaderBusy(true); setNotice(null);
    try {
      const result = await adapter.review(reviewTransactionId);
      const reviewed = await rfidAdminPost<{ status: string; verificationResult?: string }>({ action: "review", transactionId: reviewTransactionId, actual: result.actual, attestation: result.attestation });
      if (reviewed.status === "UNKNOWN_OUTCOME") throw new Error("REVIEW REQUIRED: the same tag is still in a partial or unexpected state.");
      setReviewTransactionId(""); setCurrentEpc(result.actual.epc); setSelectedTid(result.actual.tid || ""); setSelectedPc(result.actual.pc || "");
      setEncodeOutcome(reviewed.status === "VERIFIED" ? "VERIFIED" : "WRITE FAILED");
      setNotice({ type: reviewed.status === "VERIFIED" ? "success" : "error", text: reviewed.verificationResult || reviewed.status });
    } catch (error) { setNotice({ type: "error", text: error instanceof Error ? error.message : "Physical review failed." }); }
    finally { setReaderBusy(false); }
  }
  function copy(value: string) { void navigator.clipboard.writeText(value); setNotice({ type: "success", text: "Copied to clipboard." }); }

  useEffect(() => {
    if (!readerConnected || bridgeKind !== "SIGNED") return;
    let cancelled = false, checking = false;
    const timer = setInterval(async () => {
      if (readerBusy || continuousReading || checking) return;
      const adapter = adapterRef.current;
      if (!(adapter instanceof Ru5600SignedBridgeAdapter)) return;
      checking = true;
      try {
        const status = await adapter.refreshStatus();
        if (!cancelled && status.state !== "CONNECTED") throw new Error(status.error || "Reader disconnected.");
      } catch {
        if (!cancelled) { setReaderConnected(false); setReaderInfo(null); setCurrentEpc(""); setSelectedTid(""); setSelectedPc(""); setReads([]); setContinuousReading(false); setNotice({ type: "error", text: "Reader connection lost. Reconnect and scan the chip again." }); }
      } finally { checking = false; }
    }, 3000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [readerConnected, bridgeKind, readerBusy, continuousReading]);

  const connected = readerConnected;
  return (
    <section className="rfid-admin">
      <header className="rfid-reader-bar">
        <div className="rfid-reader-state"><span className={connected ? "connected" : "disconnected"} /><div><strong>INVETON RU5600</strong><small>{connected ? `Connected${readerInfo?.serialNumber ? ` · ${readerInfo.serialNumber}` : ""}` : "Disconnected · local bridge"}</small></div></div>
        <div className="rfid-reader-meta"><span><b>OS</b>{capabilities.os}</span><span><b>Transport</b>{connected ? "Authenticated local HID bridge" : "Not connected"}</span><span><b>Firmware</b>{readerInfo?.firmwareVersion || "—"}</span></div>
        <div className="rfid-reader-actions"><button className="button button-primary" type="button" disabled={connected || readerBusy} onClick={() => void connectReader()}><Cable /> {readerBusy ? "Connecting…" : "Connect Reader"}</button><button className="button" type="button" disabled={!connected || readerBusy} onClick={() => void disconnectReader()}><Unplug /> Disconnect</button><button className="button" type="button" disabled={connected || readerBusy} onClick={() => void connectReader()}><RefreshCw /> Detect Devices</button></div>
      </header>

      <div className="rfid-blocker" role="status">{connected ? <CheckCircle2 /> : <AlertTriangle />}<div><strong>{connected ? "Physical RU5600 session established" : "Start and pair the authenticated local bridge"}</strong><p>{connected ? "RFID read/write runs locally. Race Upshot reports success only after the same physical tag is read back." : "Connect the Race Upshot local bridge."}</p></div><span>{connected ? "HARDWARE" : "BRIDGE"}</span></div>
      {notice && <div className={`rfid-notice ${notice.type}`}><span>{notice.type === "success" ? <CheckCircle2 /> : <AlertTriangle />}{notice.text}</span><button type="button" onClick={() => setNotice(null)}>×</button></div>}

      <nav className="rfid-tabs" aria-label="RFID encoder sections">{tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={tab === id ? "active" : ""} onClick={() => setTab(id)}><Icon />{label}</button>)}</nav>

      {tab === "read" && <section className="rfid-panel"><PanelTitle icon={RadioTower} title="Read RFID chip" subtitle="Reader responses are converted into one accepted event per confirmed zone entry." /><div className="rfid-action-row"><button className="button button-primary" disabled={!connected || continuousReading} onClick={() => void startReading()}>START PRESENCE MONITORING</button><button className="button" disabled={!connected || !continuousReading} onClick={() => void stopReading()}>STOP READING</button><button className="button" disabled={!connected || continuousReading || readerBusy} onClick={() => void readOnce()}>READ ONCE</button><button className="button" onClick={() => { setReads([]); setRawInventoryCount(0); setSuppressedInventoryCount(0); setConfirmedExitCount(0); }}>CLEAR RESULTS</button></div><div className="rfid-preview"><div><strong>{rawInventoryCount}</strong><span>reader responses</span></div><div><strong>{reads.reduce((total, read) => total + read.readCount, 0)}</strong><span>accepted entries</span></div><div><strong>{suppressedInventoryCount}</strong><span>suppressed repeats</span></div><div><strong>{confirmedExitCount}</strong><span>confirmed exits</span></div></div>{reads.length ? <div className="rfid-table"><table><thead><tr><th>Full EPC</th><th>Stored PC</th><th>TID</th><th>Length</th><th>RSSI</th><th>Antenna</th><th>Accepted entries</th><th>Last accepted</th></tr></thead><tbody>{reads.map((read) => <tr key={`${read.tid || "epc"}:${read.epc}`}><td><button className="rfid-copy" onClick={() => copy(read.epc)}>{read.epc}<Clipboard /></button></td><td><code>{read.pc || "—"}</code></td><td><code>{read.tid || "—"}</code></td><td>{read.epc.length / 2} bytes</td><td>{read.rssi ?? "—"}</td><td>{read.antenna ?? "—"}</td><td>{read.readCount}</td><td>{formatDate(read.lastDetected)}</td></tr>)}</tbody></table></div> : <Empty icon={connected ? RadioTower : WifiOff} title={connected ? "Ready to read" : "Reader disconnected"} text="A chip is accepted once, remains IN_RANGE while reader responses continue, and becomes eligible again only after the configured absence timeout." />}</section>}
      {tab === "write" && <section className="rfid-panel">
        <PanelTitle icon={Zap} title="Write RFID chip" subtitle="Read one chip, enter its replacement EPC, then verify the same physical tag." />
        <div className="rfid-form-grid">
          <label>Current EPC<input readOnly value={currentEpc} placeholder="Read the target chip first" /></label>
          <label>Physical TID<input readOnly value={selectedTid} placeholder="Captured from reader" /></label>
          <label>Stored PC<input readOnly value={selectedPc} placeholder="Captured from reader" /></label>
          <label>New EPC<input value={newEpc} onChange={(event) => setNewEpc(event.target.value.replace(/\s+/g, "").toUpperCase())} placeholder="Enter replacement hexadecimal EPC" /></label>
          <label>EPC length<select value={epcHexLength} onChange={(event) => setEpcHexLength(Number(event.target.value))}>{Array.from({ length: 21 }, (_, index) => (index + 1) * 4).map((length) => <option key={length} value={length}>{length} hex · {length / 2} bytes</option>)}</select></label>
          <label><input type="checkbox" checked={sequential} onChange={(event) => setSequential(event.target.checked)} /> Prepare the next EPC after a verified write</label>
        </div>
        <div className="rfid-validation">{proposedEpc.error || (proposedEpc.value ? `Replacement EPC · ${proposedEpc.value} · ${proposedEpc.value.length / 2} bytes` : "Read one target chip, then enter a 2–42-byte whole-word EPC. Length changes are guarded by Stored PC verification.")}</div>
        <div className="rfid-action-row">
          <button className="button" disabled={!connected || readerBusy || Boolean(reviewTransactionId)} onClick={async () => { try { const detected = await adapterRef.current!.readOnce(); if (detected.length === 0) { setAwaitingRemovalTid(null); setCurrentEpc(""); setSelectedTid(""); setSelectedPc(""); throw new Error("No chip detected. The previous chip is now cleared."); } if (detected.length !== 1) throw new Error(`Exactly one chip is required; detected ${detected.length}.`); if (!detected[0].tid || !detected[0].pc) throw new Error("Complete EPC, Stored PC and TID are required."); if (awaitingRemovalTid === detected[0].tid) throw new Error("Remove the previously encoded chip before continuing."); setCurrentEpc(detected[0].epc); setSelectedTid(detected[0].tid); setSelectedPc(detected[0].pc); mergeRead(detected[0]); await rfidAdminPost({ action: "read-audit", before: detected[0], readerId: adapterRef.current!.info.id }); setNotice({ type: "success", text: "Fresh EPC, Stored PC and TID captured." }); } catch (error) { setNotice({ type: "error", text: error instanceof Error ? error.message : "Read failed." }); } }}>READ TARGET CHIP</button>
          <button className="button button-primary" disabled={!connected || !currentEpc || !selectedTid || !selectedPc || !proposedEpc.value || Boolean(proposedEpc.error) || readerBusy || Boolean(awaitingRemovalTid) || Boolean(reviewTransactionId)} onClick={() => void writeEpc()}>WRITE &amp; VERIFY EPC</button>
          {reviewTransactionId && <button className="button button-primary" disabled={!connected || readerBusy} onClick={() => void reviewWrite()}>SCAN SAME TAG TO REVIEW</button>}
          <button className="button" disabled={readerBusy} onClick={() => setNewEpc("0".repeat(epcHexLength))}>PREPARE ZERO EPC</button>
          <button className="button" disabled={readerBusy || Boolean(reviewTransactionId)} onClick={() => { setCurrentEpc(""); setSelectedTid(""); setSelectedPc(""); setAwaitingRemovalTid(null); setEncodeOutcome("IDLE"); }}>CLEAR / NEXT CHIP</button>
        </div>
        {encodeOutcome !== "IDLE" && <div className="rfid-validation"><strong>{encodeOutcome}</strong></div>}
        <div className="rfid-validation"><strong>Write prerequisite:</strong> {writePrerequisite}</div>
        <p className="rfid-safety"><ShieldCheck /> USB access stays on this computer. Race Upshot records the admin, reservation, signed result and review state; it never writes without a short-lived cloud permit and explicit confirmation.</p>
      </section>}
      {tab === "settings" && <><AutomaticPairPanel bridgeUrl={bridgeUrl} bridgeToken={bridgeToken} onPaired={(token) => storeBridgeSettings(bridgeUrl, token, "SIGNED")} onRevoked={() => { localStorage.removeItem("raceupshot-rfid-local-pair-token"); storeBridgeSettings(bridgeUrl, "", "SIGNED"); }} /><SettingsPanel capabilities={capabilities} bridgeUrl={bridgeUrl} bridgeToken={bridgeToken} bridgeKind={bridgeKind} onSave={storeBridgeSettings} detectionConfig={detectionConfig} onSaveDetection={storeDetectionConfig} /></>}
    </section>
  );
}

function AutomaticPairPanel({ bridgeUrl, bridgeToken, onPaired, onRevoked }: { bridgeUrl: string; bridgeToken: string; onPaired: (token: string) => void; onRevoked: () => void }) {
  const [pairing, setPairing] = useState(false);
  const [code, setCode] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [message, setMessage] = useState("");
  const [availability, setAvailability] = useState<"CHECKING" | "RUNNING" | "BLOCKED" | "UNREACHABLE">("CHECKING");
  const browserPaired = /^[a-f0-9]{64}$/.test(bridgeToken);
  useEffect(() => {
    let stopped = false;
    async function check() {
      const abort = new AbortController();
      const timer = window.setTimeout(() => abort.abort(), 2500);
      try {
        const response = await fetch(`${bridgeUrl.replace(/\/$/, "")}/health`, { cache: "no-store", signal: abort.signal });
        if (!stopped) setAvailability(response.ok ? "RUNNING" : "BLOCKED");
      } catch {
        try {
          await fetch(`${bridgeUrl.replace(/\/$/, "")}/health`, { mode: "no-cors", cache: "no-store", signal: abort.signal });
          if (!stopped) setAvailability("BLOCKED");
        } catch { if (!stopped) setAvailability("UNREACHABLE"); }
      } finally { window.clearTimeout(timer); }
    }
    void check();
    const timer = window.setInterval(() => void check(), 5000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [bridgeUrl]);
  async function pair() {
    setPairing(true); setCode(""); setExpiresAt(""); setMessage("");
    try {
      const result = await Ru5600SignedBridgeAdapter.automaticPair(bridgeUrl, (generated) => { setCode(generated.code); setExpiresAt(generated.expiresAt); });
      onPaired(result.token);
      setMessage("A single-use code was generated locally and accepted automatically. This browser is now paired.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Automatic pairing failed."); }
    finally { setPairing(false); }
  }
  async function revoke() {
    setPairing(true); setMessage("");
    try { await new Ru5600SignedBridgeAdapter(bridgeUrl, bridgeToken).unpair(); onRevoked(); setMessage("Browser pairing revoked on this Mac."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Pairing could not be revoked."); }
    finally { setPairing(false); }
  }
  return <section className="rfid-panel"><PanelTitle icon={Cable} title="Automatic macOS pairing" subtitle="Generates a two-minute, origin-bound code on this Mac and verifies the returned token before success." />{browserPaired && <p className="rfid-validation"><strong>Browser paired.</strong> Reader connection and future pairing reuse are automatic.</p>}<div className="rfid-action-row"><button className="button button-primary" type="button" disabled={pairing || availability !== "RUNNING" || !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(bridgeUrl)} onClick={() => void pair()}>{pairing ? "PAIRING…" : browserPaired ? "RE-PAIR AUTOMATICALLY" : "GENERATE CODE & PAIR AUTOMATICALLY"}</button>{browserPaired && <button className="button" type="button" disabled={pairing} onClick={() => void revoke()}>REVOKE PAIRING</button>}</div>{code && <div className="rfid-validation"><span>Generated one-time code: </span><strong><code>{code}</code></strong><small>Accepted automatically{expiresAt ? ` · expires at ${new Date(expiresAt).toLocaleTimeString()}` : ""}</small></div>}{availability === "BLOCKED" && <p role="status">The bridge is running, but this Race Upshot origin is not allowed.</p>}{availability === "UNREACHABLE" && <p role="status">Start the Race Upshot RFID bridge on this Mac.</p>}{message && <p role="status">{message}</p>}<p className="rfid-safety"><ShieldCheck /> The permanent master code stays in macOS Keychain and is never displayed or sent to Race Upshot cloud APIs. This browser stores only a revocable local token.</p></section>;
}

function SettingsPanel({ capabilities, bridgeUrl, bridgeToken, bridgeKind, onSave, detectionConfig, onSaveDetection }: { capabilities: { webHid: boolean; webUsb: boolean; webSerial: boolean; online: boolean; os: string }; bridgeUrl: string; bridgeToken: string; bridgeKind: "SIGNED" | "LEGACY"; onSave: (url: string, token: string, kind: "SIGNED" | "LEGACY") => void; detectionConfig: RfidDetectionConfig; onSaveDetection: (config: RfidDetectionConfig) => Promise<void> }) {
  const [url, setUrl] = useState(bridgeUrl); const [token, setToken] = useState(bridgeToken);
  const [kind, setKind] = useState(bridgeKind);
  const [detection, setDetection] = useState(detectionConfig);
  const [savingDetection, setSavingDetection] = useState(false);
  const [detectionMessage, setDetectionMessage] = useState("");
  const [code, setCode] = useState("");
  const [pairing, setPairing] = useState(false);
  const [pairMessage, setPairMessage] = useState("");
  async function pair() {
    setPairing(true); setPairMessage("");
    try { const next = await Ru5600SignedBridgeAdapter.pair(url, code); setToken(next); setCode(""); onSave(url, next, "SIGNED"); setPairMessage("Browser paired. Connect the reader to begin scanning."); }
    catch (error) { setPairMessage(error instanceof Error ? error.message : "Pairing failed."); }
    finally { setPairing(false); }
  }
  const setDetectionValue = <K extends keyof RfidDetectionConfig>(key: K, value: RfidDetectionConfig[K]) => setDetection((current) => ({ ...current, [key]: value }));
  return <section className="rfid-panel"><PanelTitle icon={Settings2} title="Reader settings & compatibility" subtitle="Pair this browser with the local reader and calibrate its physical detection zone." /><div className="rfid-form-grid"><label>Bridge protocol<select value={kind} onChange={event => { const next = event.target.value as typeof kind; setKind(next); setUrl(next === "SIGNED" ? "http://127.0.0.1:8766" : "http://127.0.0.1:8765"); setToken(""); }}><option value="SIGNED">Race Upshot signed bridge · macOS / Windows</option><option value="LEGACY">Existing SWHidApi bridge · Windows / Linux</option></select></label>{kind === "SIGNED" && <label>macOS pairing code<input type="password" autoComplete="off" value={code} onChange={event => setCode(event.target.value)} /><button className="button" disabled={pairing || code.length < 24} onClick={() => void pair()}>{pairing ? "Pairing…" : "PAIR THIS BROWSER"}</button><small>Windows: enter the bridge key below instead.</small></label>}</div>{pairMessage && <p role="status">{pairMessage}</p>}<div className="rfid-form-grid"><label>Local bridge URL<input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="http://127.0.0.1:8765" /></label><label>Bridge bearer token<input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Pairing token or Windows bridge key" autoComplete="off" /></label></div><div className="rfid-action-row"><button className="button button-primary" type="button" disabled={!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url) || token.length < 24} onClick={() => onSave(url, token, kind)}>SAVE BRIDGE PAIRING</button></div><p className="rfid-safety"><ShieldCheck /> The signed macOS token is retained only in this browser&apos;s local storage and is never stored in Race Upshot KV or included in an audit record. Unpairing revokes it on this Mac.</p>
    <div className="rfid-report"><h3>Detection zone and entry-state configuration</h3><div className="rfid-form-grid bulk"><label>Target range (cm)<input type="number" min="1" max="15.24" step="0.01" value={detection.targetRangeCm} onChange={(event) => setDetectionValue("targetRangeCm", Number(event.target.value))} /><small>Maximum allowed target: 15.24 cm / 6 inches.</small></label><label>Desired RF power (dBm)<input type="number" min="-30" max="36" step="0.1" value={detection.rfPowerDbm ?? ""} onChange={(event) => setDetectionValue("rfPowerDbm", event.target.value === "" ? null : Number(event.target.value))} /><small>Applied only when a physically validated bridge command is available.</small></label><label>Allowed antenna IDs<input value={detection.antennaIds.join(",")} onChange={(event) => setDetectionValue("antennaIds", event.target.value.split(",").map((value) => Number(value.trim())).filter(Number.isFinite))} placeholder="Example: 1" /></label><label>Minimum RSSI (dBm)<input type="number" min="-120" max="0" value={detection.rssiThreshold ?? ""} onChange={(event) => setDetectionValue("rssiThreshold", event.target.value === "" ? null : Number(event.target.value))} placeholder="Disabled" /><small>Software filter only; it is not a distance measurement.</small></label><label>Confirmed absence timeout (ms)<input type="number" min="100" max="60000" step="100" value={detection.absenceTimeoutMs} onChange={(event) => setDetectionValue("absenceTimeoutMs", Number(event.target.value))} /></label><label>Calibration method<select value={detection.calibrationMethod} onChange={(event) => setDetectionValue("calibrationMethod", event.target.value as RfidDetectionConfig["calibrationMethod"])}><option value="UNVERIFIED">Not physically verified</option><option value="RF_POWER">RF power calibration</option><option value="NEAR_FIELD_ANTENNA">Near-field antenna</option><option value="SHIELDING">RF shielding</option><option value="COMBINED">Combined controls</option></select></label><label>Calibration evidence<textarea value={detection.calibrationNotes} onChange={(event) => setDetectionValue("calibrationNotes", event.target.value)} placeholder="Record test tags, measured distances, antenna, shielding and power setting." /></label><label><input type="checkbox" checked={detection.singleReadPerEntry} onChange={(event) => setDetectionValue("singleReadPerEntry", event.target.checked)} /> Single read per zone entry</label><label><input type="checkbox" checked={detection.reentryDetection} onChange={(event) => setDetectionValue("reentryDetection", event.target.checked)} /> Accept after confirmed exit and re-entry</label><label><input type="checkbox" checked={detection.suppressDuplicateInventory} onChange={(event) => setDetectionValue("suppressDuplicateInventory", event.target.checked)} /> Suppress duplicate reader responses</label><label><input type="checkbox" checked={detection.presenceMonitoring} onChange={(event) => setDetectionValue("presenceMonitoring", event.target.checked)} /> Real-time presence monitoring</label><label><input type="checkbox" checked={detection.physicallyCalibrated} onChange={(event) => setDetectionValue("physicallyCalibrated", event.target.checked)} /> Physical 6-inch test completed</label></div>{detectionMessage && <p role="status" className="rfid-field-error">{detectionMessage}</p>}<div className="rfid-action-row"><button className="button button-primary" disabled={savingDetection} onClick={async () => { setSavingDetection(true); setDetectionMessage(""); try { await onSaveDetection(detection); } catch (error) { setDetectionMessage(error instanceof Error ? error.message : "Detection profile could not be saved."); } finally { setSavingDetection(false); } }}>{savingDetection ? "APPLYING…" : "SAVE DETECTION PROFILE"}</button></div><p className="rfid-safety"><AlertTriangle /> RSSI and software filtering cannot guarantee a 6-inch radius. Do not mark this profile physically calibrated until representative chips have been bench-tested with the selected RF power, near-field antenna and/or shielding.</p></div>
    <div className="rfid-compat-grid"><article><b>SDK audit</b><strong>SDK V3.2 audited</strong><p>USB HID VID 1A86 / PID E010. Verified API surface includes device enumeration, connection, EPC/TID reads, EPC writes and start/stop operations.</p></article><article><b>Native support</b><strong>Windows and Linux</strong><p>Windows x86/x64 DLLs and Linux x86/x64/ARM shared libraries are supplied. Physical validation is still required.</p></article><article><b>macOS</b><strong>Native HID bridge source available</strong><p>The local adapter reads EPC, Stored PC and TID and supports guarded 2–42-byte whole-word EPC writes. Length changes update only the Stored PC word-count bits after the full EPC bank is confirmed on the same TID.</p></article><article><b>Browser interfaces</b><strong>{[capabilities.webHid && "WebHID", capabilities.webUsb && "WebUSB", capabilities.webSerial && "Web Serial"].filter(Boolean).join(" · ") || "None detected"}</strong><p>The device is HID, but raw report commands are hidden inside SWHidApi; direct WebHID is therefore not enabled.</p></article></div><div className="rfid-report"><h3>Hardware validation still required</h3><ul><li>Install the matching vendor SWHidApi library and Visual C++ 2008 runtime on the encoding computer.</li><li>Bench-test representative same-length and variable-length EPC writes before race-day use.</li><li>Measure accepted and rejected reads using representative chips at 2, 4, 6, 8 and 12 inches.</li><li>Use a near-field antenna or shielding when power and RSSI calibration cannot reliably isolate the six-inch zone.</li><li>Test confirmed exit, 1,000 ms absence and re-entry before race-day use.</li></ul></div></section>;
}

function PanelTitle({ icon: Icon, title, subtitle }: { icon: typeof Cpu; title: string; subtitle: string }) { return <div className="rfid-panel-title"><Icon /><div><h2>{title}</h2><p>{subtitle}</p></div></div>; }
function Empty({ icon: Icon, title, text }: { icon: typeof Cpu; title: string; text: string }) { return <div className="rfid-empty"><Icon /><strong>{title}</strong><p>{text}</p></div>; }
function formatDate(value?: string) { if (!value) return "—"; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString(); }
