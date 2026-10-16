"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Cable, CheckCircle2, Clipboard, Cpu, Database, Download, History, RadioTower, RefreshCw, Search, Settings2, ShieldCheck, Tags, Unplug, WifiOff, Zap } from "lucide-react";
import { generateEpcSequence, validateEpc, type EpcSequenceInput } from "@/lib/rfid-encoder-core";
import { Ru5600LocalBridgeAdapter } from "@/lib/ru5600-local-bridge";

type Tab = "dashboard" | "read" | "write" | "bulk" | "inventory" | "history" | "settings";
type Chip = { id: string; epc: string; tid?: string; epcLength: number; status: string; firstEncodedAt: string; lastEncodedAt: string; lastVerifiedAt: string; readerId: string; operatorId: string; notes: string };
type Transaction = { id: string; readerId: string; operatorId: string; originalEpc: string; requestedEpc: string; verifiedEpc: string; tid?: string; operation: string; startedAt: string; completedAt?: string; status: string; errorDetails?: string };
type Job = { id: string; name: string; status: string; plannedEpcs: string[]; completed: number; failed: number; createdAt: string; createdBy: string };
type DisplayRead = { epc: string; tid?: string; rssi?: number; antenna?: number; firstDetected: string; lastDetected: string; readCount: number };
type Overview = {
  counts: { chips: number; available: number; draftJobs: number; verifiedWrites: number; failedWrites: number };
  chips: Chip[]; jobs: Job[]; transactions: Transaction[];
  adapter: { model: string; status: string; connected: boolean; simulation: boolean; sdkAuditStatus: string; message: string };
  permissions: string[];
};

const tabs: Array<{ id: Tab; label: string; icon: typeof Cpu }> = [
  { id: "dashboard", label: "Dashboard", icon: Cpu }, { id: "read", label: "Read Chip", icon: RadioTower },
  { id: "write", label: "Write Chip", icon: Zap }, { id: "bulk", label: "Bulk Encoding", icon: Tags },
  { id: "inventory", label: "Chip Inventory", icon: Database }, { id: "history", label: "Encoding History", icon: History },
  { id: "settings", label: "Reader Settings", icon: Settings2 },
];

const initialSequence: EpcSequenceInput = { prefix: "3008", startingSequence: "1", digits: 8, increment: 1, total: 10, epcLength: 12 };

export function RfidEncoderAdmin() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [query, setQuery] = useState("");
  const [currentEpc, setCurrentEpc] = useState("");
  const [newEpc, setNewEpc] = useState("");
  const [sequence, setSequence] = useState<EpcSequenceInput>(initialSequence);
  const [jobName, setJobName] = useState("");
  const [savingJob, setSavingJob] = useState(false);
  const [bridgeUrl, setBridgeUrl] = useState("http://127.0.0.1:8765");
  const [bridgeToken, setBridgeToken] = useState("");
  const [readerConnected, setReaderConnected] = useState(false);
  const [readerInfo, setReaderInfo] = useState<{ id: string; serialNumber?: string; firmwareVersion?: string; hardwareVersion?: string } | null>(null);
  const [readerBusy, setReaderBusy] = useState(false);
  const [continuousReading, setContinuousReading] = useState(false);
  const [reads, setReads] = useState<DisplayRead[]>([]);
  const adapterRef = useRef<Ru5600LocalBridgeAdapter | null>(null);
  const [capabilities] = useState(() => {
    if (typeof navigator === "undefined") return { webHid: false, webUsb: false, webSerial: false, online: true, os: "Unknown" };
    const browser = navigator as Navigator & { hid?: unknown; usb?: unknown; serial?: unknown; userAgentData?: { platform?: string } };
    return { webHid: Boolean(browser.hid), webUsb: Boolean(browser.usb), webSerial: Boolean(browser.serial), online: navigator.onLine, os: browser.userAgentData?.platform || navigator.platform || "Unknown" };
  });

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/rfid/overview", { cache: "no-store" });
      const body = await response.json() as { ok: boolean; data?: Overview; error?: string };
      if (!response.ok || !body.ok || !body.data) throw new Error(body.error || "RFID data could not be loaded.");
      setOverview(body.data);
    } catch (error) { setNotice({ type: "error", text: error instanceof Error ? error.message : "RFID data could not be loaded." }); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setBridgeUrl(sessionStorage.getItem("raceupshot:ru5600:bridge-url") || "http://127.0.0.1:8765");
      setBridgeToken(sessionStorage.getItem("raceupshot:ru5600:bridge-token") || "");
      void load();
    }, 0);
    return () => { window.clearTimeout(timer); void adapterRef.current?.disconnect().catch(() => undefined); };
  }, []);

  const preview = useMemo(() => {
    try { return { values: generateEpcSequence(sequence), error: "" }; }
    catch (error) { return { values: [] as string[], error: error instanceof Error ? error.message : "Invalid sequence." }; }
  }, [sequence]);
  const inventory = useMemo(() => (overview?.chips || []).filter((chip) => `${chip.id} ${chip.epc} ${chip.tid || ""} ${chip.status}`.toLowerCase().includes(query.toLowerCase())), [overview, query]);
  const history = useMemo(() => (overview?.transactions || []).filter((row) => `${row.id} ${row.originalEpc} ${row.requestedEpc} ${row.verifiedEpc} ${row.tid || ""} ${row.status}`.toLowerCase().includes(query.toLowerCase())), [overview, query]);

  function storeBridgeSettings(url: string, token: string) {
    setBridgeUrl(url); setBridgeToken(token);
    sessionStorage.setItem("raceupshot:ru5600:bridge-url", url);
    sessionStorage.setItem("raceupshot:ru5600:bridge-token", token);
  }
  async function connectReader() {
    if (bridgeToken.trim().length < 24) { setTab("settings"); return setNotice({ type: "error", text: "Enter the local bridge token in Reader Settings before connecting." }); }
    setReaderBusy(true); setNotice(null);
    try {
      const adapter = new Ru5600LocalBridgeAdapter(bridgeUrl, bridgeToken.trim());
      const devices = await adapter.listDevices();
      if (!devices.length) throw new Error("The local bridge is running, but the SDK found no RU5600 USB reader.");
      const info = await adapter.connect();
      adapterRef.current = adapter; setReaderConnected(true); setReaderInfo(info); setNotice({ type: "success", text: `Physical reader connected${info.serialNumber ? ` · ${info.serialNumber}` : ""}.` });
    } catch (error) { setReaderConnected(false); setReaderInfo(null); setNotice({ type: "error", text: error instanceof Error ? error.message : "Reader connection failed." }); }
    finally { setReaderBusy(false); }
  }
  async function disconnectReader() {
    setReaderBusy(true);
    try { await adapterRef.current?.disconnect(); setReaderConnected(false); setReaderInfo(null); setContinuousReading(false); setNotice({ type: "success", text: "Reader disconnected." }); }
    catch (error) { setNotice({ type: "error", text: error instanceof Error ? error.message : "Reader disconnect failed." }); }
    finally { setReaderBusy(false); }
  }
  function mergeRead(read: { epc: string; tid?: string; rssi?: number; antenna?: number; readAt: string }) {
    setReads((current) => {
      const existing = current.find((item) => item.epc === read.epc);
      if (!existing) return [{ ...read, firstDetected: read.readAt, lastDetected: read.readAt, readCount: 1 }, ...current];
      return current.map((item) => item.epc === read.epc ? { ...item, tid: read.tid || item.tid, rssi: read.rssi, antenna: read.antenna, lastDetected: read.readAt, readCount: item.readCount + 1 } : item);
    });
  }
  async function readOnce() {
    setReaderBusy(true); setNotice(null);
    try { const detected = await adapterRef.current!.readOnce(); detected.forEach(mergeRead); setNotice({ type: detected.length ? "success" : "error", text: detected.length ? `${detected.length} unique chip reading received.` : "No chip detected." }); }
    catch (error) { setNotice({ type: "error", text: error instanceof Error ? error.message : "RFID read failed." }); }
    finally { setReaderBusy(false); }
  }
  async function startReading() {
    try { await adapterRef.current!.startInventory(mergeRead); setContinuousReading(true); setNotice({ type: "success", text: "Continuous inventory started." }); }
    catch (error) { setNotice({ type: "error", text: error instanceof Error ? error.message : "Continuous inventory could not start." }); }
  }
  async function stopReading() {
    try { await adapterRef.current!.stopInventory(); setContinuousReading(false); setNotice({ type: "success", text: "Continuous inventory stopped." }); }
    catch (error) { setNotice({ type: "error", text: error instanceof Error ? error.message : "Continuous inventory could not stop." }); }
  }
  async function writeEpc() {
    try { validateEpc(currentEpc); validateEpc(newEpc); } catch (error) { return setNotice({ type: "error", text: error instanceof Error ? error.message : "Invalid EPC." }); }
    if ((overview?.chips || []).some((chip) => chip.epc === newEpc && chip.epc !== currentEpc)) return setNotice({ type: "error", text: `EPC ${newEpc} already exists in chip inventory.` });
    if (!window.confirm(`Overwrite EPC ${currentEpc} with ${newEpc}? Exactly one chip must be near the reader.`)) return;
    setReaderBusy(true); setNotice(null);
    try {
      const result = await adapterRef.current!.writeEpc(currentEpc, newEpc);
      const response = await fetch("/api/admin/rfid/transactions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...result, readerId: adapterRef.current!.info.id }) });
      const body = await response.json() as { ok: boolean; data?: Transaction; error?: string };
      if (!response.ok || !body.ok || !body.data) throw new Error(body.error || "The bridge result could not be stored.");
      if (body.data.status !== "VERIFIED") throw new Error(body.data.errorDetails || "Write outcome requires physical reconciliation.");
      setCurrentEpc(newEpc); setNewEpc(""); setNotice({ type: "success", text: `CHIP ENCODED SUCCESSFULLY · ${body.data.verifiedEpc}` }); await load();
    } catch (error) { setNotice({ type: "error", text: error instanceof Error ? error.message : "ENCODING FAILED" }); }
    finally { setReaderBusy(false); }
  }
  async function saveDraftJob() {
    if (preview.error) return setNotice({ type: "error", text: preview.error });
    setSavingJob(true); setNotice(null);
    try {
      const response = await fetch("/api/admin/rfid/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...sequence, name: jobName }) });
      const body = await response.json() as { ok: boolean; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error || "Draft job could not be saved.");
      setNotice({ type: "success", text: "Bulk EPC plan saved as a draft. Physical encoding remains disabled until the RU5600 adapter is validated." });
      await load();
    } catch (error) { setNotice({ type: "error", text: error instanceof Error ? error.message : "Draft job could not be saved." }); }
    finally { setSavingJob(false); }
  }
  function copy(value: string) { void navigator.clipboard.writeText(value); setNotice({ type: "success", text: "Copied to clipboard." }); }

  const connected = readerConnected;
  return (
    <section className="rfid-admin">
      <header className="rfid-reader-bar">
        <div className="rfid-reader-state"><span className={connected ? "connected" : "disconnected"} /><div><strong>{overview?.adapter.model || "INVETON RU5600"}</strong><small>{connected ? `Connected${readerInfo?.serialNumber ? ` · ${readerInfo.serialNumber}` : ""}` : "Disconnected · local bridge"}</small></div></div>
        <div className="rfid-reader-meta"><span><b>OS</b>{capabilities.os}</span><span><b>Transport</b>{connected ? "Authenticated local HID bridge" : "Not connected"}</span><span><b>Firmware</b>{readerInfo?.firmwareVersion || "—"}</span></div>
        <div className="rfid-reader-actions"><button className="button button-primary" type="button" disabled={connected || readerBusy} onClick={() => void connectReader()}><Cable /> {readerBusy ? "Connecting…" : "Connect Reader"}</button><button className="button" type="button" disabled={!connected || readerBusy} onClick={() => void disconnectReader()}><Unplug /> Disconnect</button><button className="button" type="button" disabled={connected || readerBusy} onClick={() => void connectReader()}><RefreshCw /> Detect Devices</button></div>
      </header>

      <div className="rfid-blocker" role="status">{connected ? <CheckCircle2 /> : <AlertTriangle />}<div><strong>{connected ? "Physical RU5600 session established" : "Start and pair the authenticated local bridge"}</strong><p>{connected ? "SWHidApi accepted the connection. Writes still require exactly one chip and an exact read-back before Race Upshot records success." : overview?.adapter.message || "SDK V3.2 is audited and uses native SWHidApi libraries through a loopback bridge."}</p></div><span>{connected ? "HARDWARE" : "BRIDGE"}</span></div>
      {notice && <div className={`rfid-notice ${notice.type}`}><span>{notice.type === "success" ? <CheckCircle2 /> : <AlertTriangle />}{notice.text}</span><button type="button" onClick={() => setNotice(null)}>×</button></div>}

      <nav className="rfid-tabs" aria-label="RFID encoder sections">{tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={tab === id ? "active" : ""} onClick={() => { setTab(id); setQuery(""); }}><Icon />{label}</button>)}</nav>

      {loading && <div className="rfid-empty"><RefreshCw className="spin" /> Loading RFID workspace…</div>}
      {!loading && tab === "dashboard" && <Dashboard overview={overview} setTab={setTab} />}
      {!loading && tab === "read" && <section className="rfid-panel"><PanelTitle icon={RadioTower} title="Read RFID chip" subtitle="Single-read and continuous inventory use the vendor SWHidApi adapter." /><div className="rfid-action-row"><button className="button button-primary" disabled={!connected || continuousReading} onClick={() => void startReading()}>START READING</button><button className="button" disabled={!connected || !continuousReading} onClick={() => void stopReading()}>STOP READING</button><button className="button" disabled={!connected || continuousReading || readerBusy} onClick={() => void readOnce()}>READ ONCE</button><button className="button" onClick={() => setReads([])}>CLEAR RESULTS</button></div>{reads.length ? <div className="rfid-table"><table><thead><tr><th>EPC</th><th>TID</th><th>Length</th><th>RSSI</th><th>Antenna</th><th>Reads</th><th>First detected</th><th>Last detected</th></tr></thead><tbody>{reads.map((read) => <tr key={read.epc}><td><button className="rfid-copy" onClick={() => copy(read.epc)}>{read.epc}<Clipboard /></button></td><td><code>{read.tid || "—"}</code></td><td>{read.epc.length} hex</td><td>{read.rssi ?? "—"}</td><td>{read.antenna ?? "—"}</td><td>{read.readCount}</td><td>{formatDate(read.firstDetected)}</td><td>{formatDate(read.lastDetected)}</td></tr>)}</tbody></table></div> : <Empty icon={connected ? RadioTower : WifiOff} title={connected ? "Ready to read" : "Reader disconnected"} text="Repeated EPC reads are grouped while preserving their actual read count." />}</section>}
      {!loading && tab === "write" && <section className="rfid-panel"><PanelTitle icon={Zap} title="Write RFID chip" subtitle="Every successful write requires an exact SWHidApi inventory read-back match before it is committed." /><div className="rfid-form-grid"><label>Current EPC<input value={currentEpc} onChange={(e) => setCurrentEpc(e.target.value.toUpperCase())} placeholder="Read the target chip first" /></label><label>New EPC<input value={newEpc} onChange={(e) => setNewEpc(e.target.value.toUpperCase())} placeholder="Uppercase hexadecimal" /></label><label>EPC format<input readOnly value="Exact even-length hexadecimal; no silent truncation" /></label><label>Encoding mode<select><option>Manual EPC</option><option>Auto-generated EPC</option><option>Sequential EPC</option></select></label></div><div className="rfid-validation">{(() => { try { return newEpc ? `Valid EPC · ${validateEpc(newEpc).length} hex characters` : "Enter a new EPC to validate it."; } catch (e) { return e instanceof Error ? e.message : "Invalid EPC"; } })()}</div><div className="rfid-action-row"><button className="button" disabled={!connected || readerBusy} onClick={async () => { try { const detected = await adapterRef.current!.readOnce(); if (detected.length !== 1) throw new Error(`Exactly one chip is required; detected ${detected.length}.`); setCurrentEpc(detected[0].epc); mergeRead(detected[0]); } catch (error) { setNotice({ type: "error", text: error instanceof Error ? error.message : "Read failed." }); } }}>READ TARGET CHIP</button><button className="button button-primary" disabled={!connected || !currentEpc || !newEpc || readerBusy} onClick={() => void writeEpc()}>WRITE & VERIFY EPC</button></div><p className="rfid-safety"><ShieldCheck /> The operator must confirm an overwrite, exactly one tag must be present, duplicate EPCs are rejected, and success is impossible without read-back verification.</p></section>}
      {!loading && tab === "bulk" && <BulkPanel sequence={sequence} setSequence={setSequence} preview={preview} jobName={jobName} setJobName={setJobName} jobs={overview?.jobs || []} connected={connected} saving={savingJob} onSave={() => void saveDraftJob()} />}
      {!loading && tab === "inventory" && <section className="rfid-panel"><PanelTitle icon={Database} title="Chip inventory" subtitle="Permanent, race-independent inventory contains verified chips only." /><TableToolbar query={query} setQuery={setQuery} exportHref="/api/admin/rfid/export?kind=inventory" /><div className="rfid-table"><table><thead><tr><th>Chip ID</th><th>EPC</th><th>TID</th><th>Length</th><th>Status</th><th>Last verified</th><th>Reader / operator</th></tr></thead><tbody>{inventory.map((chip) => <tr key={chip.id}><td><code>{chip.id}</code></td><td><button className="rfid-copy" onClick={() => copy(chip.epc)}>{chip.epc}<Clipboard /></button></td><td><code>{chip.tid || "—"}</code></td><td>{chip.epcLength}</td><td><span className="rfid-pill">{chip.status}</span></td><td>{formatDate(chip.lastVerifiedAt)}</td><td>{chip.readerId}<small>{chip.operatorId}</small></td></tr>)}</tbody></table>{!inventory.length && <Empty icon={Database} title="No verified chips" text="A chip is added only after a physical write has been read back and verified." />}</div></section>}
      {!loading && tab === "history" && <section className="rfid-panel"><PanelTitle icon={History} title="Encoding history" subtitle="Append-only audit records retain verified, failed, and unknown-outcome operations." /><TableToolbar query={query} setQuery={setQuery} exportHref="/api/admin/rfid/export?kind=history" /><div className="rfid-table"><table><thead><tr><th>Transaction</th><th>Operation</th><th>Original EPC</th><th>Requested / verified</th><th>TID</th><th>Status</th><th>Started</th><th>Operator</th></tr></thead><tbody>{history.map((row) => <tr key={row.id}><td><code>{row.id}</code></td><td>{row.operation}</td><td><code>{row.originalEpc || "—"}</code></td><td><code>{row.requestedEpc || "—"}</code><small>{row.verifiedEpc || "Not verified"}</small></td><td><code>{row.tid || "—"}</code></td><td><span className="rfid-pill">{row.status}</span></td><td>{formatDate(row.startedAt)}</td><td>{row.operatorId}</td></tr>)}</tbody></table>{!history.length && <Empty icon={History} title="No encoding transactions" text="Physical operations have not been attempted." />}</div></section>}
      {!loading && tab === "settings" && <SettingsPanel capabilities={capabilities} bridgeUrl={bridgeUrl} bridgeToken={bridgeToken} onSave={storeBridgeSettings} />}
    </section>
  );
}

function Dashboard({ overview, setTab }: { overview: Overview | null; setTab: (tab: Tab) => void }) {
  const counts = overview?.counts || { chips: 0, available: 0, draftJobs: 0, verifiedWrites: 0, failedWrites: 0 };
  return <><div className="rfid-stat-grid"><Stat label="Inventory" value={counts.chips} detail={`${counts.available} available`} icon={Database} /><Stat label="Verified writes" value={counts.verifiedWrites} detail="Read-back confirmed" icon={CheckCircle2} /><Stat label="Draft jobs" value={counts.draftJobs} detail="Awaiting reader" icon={Tags} /><Stat label="Failed / unknown" value={counts.failedWrites} detail="Requires reconciliation" icon={AlertTriangle} /></div><div className="rfid-dashboard-grid"><section className="rfid-panel"><PanelTitle icon={Zap} title="Encoding workflow" subtitle="The hardware boundary is isolated from Race Upshot timing and check-in." /><ol className="rfid-steps"><li><b>1</b><span><strong>Connect and identify reader</strong><small>Establish a real device session and operation lock.</small></span></li><li><b>2</b><span><strong>Read exactly one physical chip</strong><small>Capture full EPC and TID without truncation.</small></span></li><li><b>3</b><span><strong>Write and read back</strong><small>Never commit inventory before exact verification.</small></span></li><li><b>4</b><span><strong>Audit and export</strong><small>Preserve outcomes, including interrupted unknown writes.</small></span></li></ol></section><section className="rfid-panel"><PanelTitle icon={ShieldCheck} title="Quick actions" subtitle="Safe planning remains available while hardware is gated." /><div className="rfid-quick-actions"><button onClick={() => setTab("bulk")}><Tags /><span><strong>Plan EPC range</strong><small>Preview and reserve a draft sequence</small></span></button><button onClick={() => setTab("inventory")}><Database /><span><strong>Open inventory</strong><small>Search race-independent chip records</small></span></button><button onClick={() => setTab("settings")}><Settings2 /><span><strong>Compatibility status</strong><small>Review adapter and browser support</small></span></button></div></section></div></>;
}

function BulkPanel({ sequence, setSequence, preview, jobName, setJobName, jobs, connected, saving, onSave }: { sequence: EpcSequenceInput; setSequence: (value: EpcSequenceInput) => void; preview: { values: string[]; error: string }; jobName: string; setJobName: (value: string) => void; jobs: Job[]; connected: boolean; saving: boolean; onSave: () => void }) {
  const field = (key: keyof EpcSequenceInput, numeric = false) => (event: React.ChangeEvent<HTMLInputElement>) => setSequence({ ...sequence, [key]: numeric ? Number(event.target.value) : event.target.value });
  return <section className="rfid-panel"><PanelTitle icon={Tags} title="Bulk encoding" subtitle="Generate an explicit EPC plan. Numbers advance only after a verified physical write." /><div className="rfid-form-grid bulk"><label>Job name<input value={jobName} onChange={(e) => setJobName(e.target.value)} placeholder="Example: Timing chips batch 1" /></label><label>EPC prefix<input value={sequence.prefix} onChange={field("prefix")} /></label><label>Starting sequence<input value={sequence.startingSequence} onChange={field("startingSequence")} /></label><label>Sequence digits<input type="number" value={sequence.digits} onChange={field("digits", true)} /></label><label>Total chips<input type="number" value={sequence.total} onChange={field("total", true)} /></label><label>Increment<input type="number" value={sequence.increment} onChange={field("increment", true)} /></label><label>EPC length (hex characters)<input type="number" step="2" value={sequence.epcLength} onChange={field("epcLength", true)} /></label></div>{preview.error ? <p className="rfid-field-error">{preview.error}</p> : <div className="rfid-preview"><div><strong>{preview.values.length}</strong><span>unique EPCs</span></div><code>{preview.values[0]}</code><span>to</span><code>{preview.values.at(-1)}</code></div>}<div className="rfid-action-row"><button className="button button-primary" disabled={Boolean(preview.error) || saving} onClick={onSave}>{saving ? "Saving…" : "SAVE DRAFT PLAN"}</button><button className="button" disabled>START BULK ENCODING · HARDWARE VALIDATION REQUIRED</button><button className="button" disabled>PAUSE</button><button className="button" disabled>RESUME</button><button className="button" disabled>STOP</button></div>{connected && <p className="rfid-safety"><AlertTriangle /> Single-chip reads and verified writes are enabled. Automated sequence advancement remains locked until removal/replacement and TID behavior pass physical RU5600 tests.</p>}<div className="rfid-job-list"><h3>Recent jobs</h3>{jobs.map((job) => <article key={job.id}><div><strong>{job.name}</strong><small>{formatDate(job.createdAt)} · {job.createdBy}</small></div><span>{job.plannedEpcs.length} planned</span><span className="rfid-pill">{job.status}</span></article>)}{!jobs.length && <p>No EPC plans saved yet.</p>}</div></section>;
}

function SettingsPanel({ capabilities, bridgeUrl, bridgeToken, onSave }: { capabilities: { webHid: boolean; webUsb: boolean; webSerial: boolean; online: boolean; os: string }; bridgeUrl: string; bridgeToken: string; onSave: (url: string, token: string) => void }) {
  const [url, setUrl] = useState(bridgeUrl); const [token, setToken] = useState(bridgeToken);
  return <section className="rfid-panel"><PanelTitle icon={Settings2} title="Reader settings & compatibility" subtitle="Pair this authenticated admin session with the loopback SWHidApi hardware bridge." /><div className="rfid-form-grid"><label>Local bridge URL<input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="http://127.0.0.1:8765" /></label><label>Bridge bearer token<input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Same RU5600_BRIDGE_TOKEN used by bridge" autoComplete="off" /></label></div><div className="rfid-action-row"><button className="button button-primary" type="button" disabled={!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url) || token.length < 24} onClick={() => onSave(url, token)}>SAVE BRIDGE PAIRING</button></div><p className="rfid-safety"><ShieldCheck /> The token is retained in this browser tab session only and is never stored in Race Upshot KV or included in an audit record.</p><div className="rfid-compat-grid"><article><b>SDK audit</b><strong>SDK V3.2 audited</strong><p>USB HID VID 1A86 / PID E010. Verified API surface includes device enumeration, connect, inventory, EPC/TID reads, EPC writes and start/stop operations.</p></article><article><b>Native support</b><strong>Windows and Linux</strong><p>Windows x86/x64 DLLs and Linux x86/x64/ARM shared libraries are supplied. Physical validation is still required.</p></article><article><b>macOS</b><strong className="bad">Unsupported by supplied SDK</strong><p>No macOS dylib, Apple Silicon binary, native source, or raw HID command specification is supplied.</p></article><article><b>Browser interfaces</b><strong>{[capabilities.webHid && "WebHID", capabilities.webUsb && "WebUSB", capabilities.webSerial && "Web Serial"].filter(Boolean).join(" · ") || "None detected"}</strong><p>The device is HID, but raw report commands are hidden inside SWHidApi; direct WebHID is therefore not enabled.</p></article></div><div className="rfid-report"><h3>Hardware validation still required</h3><ul><li>Install the matching vendor SWHidApi library and Visual C++ 2008 runtime on the encoding computer.</li><li>Validate discovery, connection, inventory packet parsing, EPC write and exact read-back on the physical RU5600.</li><li>Test interruption recovery so post-write communication loss remains an unknown outcome.</li><li>Do not claim macOS support unless the vendor supplies a compatible library or documented HID protocol and physical tests pass.</li></ul></div></section>;
}

function PanelTitle({ icon: Icon, title, subtitle }: { icon: typeof Cpu; title: string; subtitle: string }) { return <div className="rfid-panel-title"><Icon /><div><h2>{title}</h2><p>{subtitle}</p></div></div>; }
function Stat({ label, value, detail, icon: Icon }: { label: string; value: number; detail: string; icon: typeof Cpu }) { return <article className="rfid-stat"><Icon /><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>; }
function Empty({ icon: Icon, title, text }: { icon: typeof Cpu; title: string; text: string }) { return <div className="rfid-empty"><Icon /><strong>{title}</strong><p>{text}</p></div>; }
function TableToolbar({ query, setQuery, exportHref }: { query: string; setQuery: (value: string) => void; exportHref: string }) { return <div className="rfid-table-toolbar"><label><Search /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search EPC, TID, ID or status…" /></label><a className="button" href={exportHref}><Download /> Export CSV</a></div>; }
function formatDate(value?: string) { if (!value) return "—"; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString(); }
