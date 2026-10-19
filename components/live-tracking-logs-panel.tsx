"use client";

import type { FeibotOperationName, FeibotOperationsDashboard } from "@/lib/feibot-integration";
import { MAX_FEIBOT_RESULT_FETCH_SECONDS, MIN_FEIBOT_RESULT_FETCH_SECONDS, normalizedFeibotResultFetchSeconds } from "@/lib/feibot-auto-fetch";
import type { AdminLiveParticipantDetail } from "@/lib/platform-repository";
import { Activity, AlertTriangle, Check, Database, Eye, Flag, MapPin, Medal, Pencil, Play, RefreshCw, Route, Save, ScrollText, Search, Square, Timer, Trash2, Trophy, UserRound, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { TimingDecisionDebugAdmin } from "./timing-decision-debug-admin";
import { TimingCorrectionsAdmin } from './timing-corrections-admin';

interface LogsEvent {
  id: string;
  name: string;
  eventUuid: string;
}

interface Props {
  event: LogsEvent;
  dashboard: FeibotOperationsDashboard;
  busy: string;
  run: (action: FeibotOperationName) => Promise<unknown>;
  refresh: () => Promise<unknown>;
  resetCanonical: () => Promise<void>;
  viewCanonical: () => Promise<void>;
}

const pageSizes = [15, 30, 60, 120] as const;

function displayTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function displayDurationMilliseconds(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value) || value < 0) return "—";
  const totalSeconds = Math.floor(value / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor(totalSeconds % 3_600 / 60);
  const seconds = totalSeconds % 60;
  const milliseconds = Math.floor(value % 1_000);
  return `${String(hours).padStart(2,"0")}:${String(minutes).padStart(2,"0")}:${String(seconds).padStart(2,"0")}.${String(milliseconds).padStart(3,"0")}`;
}

function hasConfirmedFinish(
  participant: FeibotOperationsDashboard["participants"][number],
) {
  return participant.status.trim().toUpperCase() === "FINISHED"
    && Boolean(participant.finishTime);
}

export function LiveTrackingLogsPanel({ event, dashboard, busy, run, refresh, resetCanonical, viewCanonical }: Props) {
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [autoFetchResults, setAutoFetchResults] = useState(false);
  const [resultFetchSeconds, setResultFetchSeconds] = useState(MIN_FEIBOT_RESULT_FETCH_SECONDS);
  const [resultFetchDurationMinutes, setResultFetchDurationMinutes] = useState(0);
  const [nextResultFetchAt, setNextResultFetchAt] = useState<number | null>(null);
  const [resultFetchEndsAt, setResultFetchEndsAt] = useState<number | null>(null);
  const [resultFetchClock, setResultFetchClock] = useState(() => Date.now());
  const [participantQuery, setParticipantQuery] = useState("");
  const [participantPageSize, setParticipantPageSize] = useState<number>(15);
  const [participantPage, setParticipantPage] = useState(1);
  const [logQuery, setLogQuery] = useState("");
  const [logLevel, setLogLevel] = useState("ALL");
  const [logSource, setLogSource] = useState("ALL");
  const [logPageSize, setLogPageSize] = useState<number>(50);
  const [chipParticipantId, setChipParticipantId] = useState("");
  const [chipDraft, setChipDraft] = useState("");
  const [chipReason, setChipReason] = useState("");
  const [chipSaving, setChipSaving] = useState(false);
  const [chipError, setChipError] = useState("");
  const [chipMessage, setChipMessage] = useState("");
  const [athleteDetail, setAthleteDetail] = useState<AdminLiveParticipantDetail | null>(null);
  const [athleteLoading, setAthleteLoading] = useState(false);
  const [athleteError, setAthleteError] = useState("");
  const refreshRef = useRef(refresh);
  const runRef = useRef(run);
  const busyRef = useRef(busy);
  const autoFetchResultsRef = useRef(false);
  const resultFetchInFlightRef = useRef(false);

  useEffect(() => { refreshRef.current = refresh; }, [refresh]);
  useEffect(() => { runRef.current = run; }, [run]);
  useEffect(() => { busyRef.current = busy; }, [busy]);
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = window.setInterval(() => void refreshRef.current(), 15_000);
    return () => window.clearInterval(interval);
  }, [autoRefresh, event.id]);
  useEffect(() => {
    autoFetchResultsRef.current = false;
    resultFetchInFlightRef.current = false;
    setAutoFetchResults(false);
    setNextResultFetchAt(null);
    setResultFetchEndsAt(null);
  }, [event.id]);
  useEffect(() => {
    if (!autoFetchResults) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setResultFetchClock(now);
      if (resultFetchEndsAt && now >= resultFetchEndsAt) {
        autoFetchResultsRef.current = false;
        setAutoFetchResults(false);
        setNextResultFetchAt(null);
        setResultFetchEndsAt(null);
        return;
      }
      if (!nextResultFetchAt || now < nextResultFetchAt || busyRef.current || resultFetchInFlightRef.current) return;
      resultFetchInFlightRef.current = true;
      void runRef.current("FETCH_FEIBOT_RESULTS").finally(() => {
        resultFetchInFlightRef.current = false;
        if (autoFetchResultsRef.current) {
          setNextResultFetchAt(Date.now() + normalizedFeibotResultFetchSeconds(resultFetchSeconds) * 1_000);
        }
      });
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [autoFetchResults, nextResultFetchAt, resultFetchEndsAt, resultFetchSeconds]);

  function startResultAutoFetch() {
    const seconds = normalizedFeibotResultFetchSeconds(resultFetchSeconds);
    const now = Date.now();
    setResultFetchSeconds(seconds);
    setResultFetchClock(now);
    setNextResultFetchAt(now);
    setResultFetchEndsAt(resultFetchDurationMinutes > 0 ? now + resultFetchDurationMinutes * 60_000 : null);
    autoFetchResultsRef.current = true;
    setAutoFetchResults(true);
  }

  function stopResultAutoFetch() {
    autoFetchResultsRef.current = false;
    setAutoFetchResults(false);
    setNextResultFetchAt(null);
    setResultFetchEndsAt(null);
  }

  const participantRows = useMemo(() => {
    const query = participantQuery.trim().toLowerCase();
    if (!query) return dashboard.participants;
    return dashboard.participants.filter((participant) => [
      participant.bib,
      participant.name,
      participant.chipCode,
      participant.id,
    ].some((value) => value.toLowerCase().includes(query)));
  }, [dashboard.participants, participantQuery]);
  const participantPages = Math.max(1, Math.ceil(participantRows.length / participantPageSize));
  const safeParticipantPage = Math.min(participantPage, participantPages);
  const visibleParticipants = participantRows.slice((safeParticipantPage - 1) * participantPageSize, safeParticipantPage * participantPageSize);

  const sources = useMemo(() => [...new Set(dashboard.logs.map((log) => log.operation))].sort(), [dashboard.logs]);
  const logRows = useMemo(() => {
    const query = logQuery.trim().toLowerCase();
    return dashboard.logs.filter((log) => (
      (logLevel === "ALL" || log.status === logLevel)
      && (logSource === "ALL" || log.operation === logSource)
      && (!query || [log.operation, log.status, log.message].some((value) => value.toLowerCase().includes(query)))
    ));
  }, [dashboard.logs, logLevel, logQuery, logSource]);

  const started = dashboard.participants.filter((participant) => Boolean(participant.startTime) || /start|course|racing|progress/i.test(participant.status)).length;
  const finished = dashboard.participants.filter(hasConfirmedFinish).length;
  const success = dashboard.logs.filter((log) => log.status === "SUCCESS").length;
  const warnings = dashboard.logs.filter((log) => log.status === "WARNING").length;
  const errors = dashboard.logs.filter((log) => log.status === "ERROR").length;
  const rawBatches = dashboard.logs.filter((log) => log.operation === "FETCH_FEIBOT_READS").length;
  const chipParticipant = dashboard.participants.find((participant) => participant.id === chipParticipantId);

  function editChip(participant: FeibotOperationsDashboard["participants"][number]) {
    setChipParticipantId(participant.id);
    setChipDraft(participant.chipCode);
    setChipReason("");
    setChipError("");
    setChipMessage("");
  }

  function cancelChipEdit() {
    setChipParticipantId("");
    setChipDraft("");
    setChipReason("");
    setChipError("");
  }

  async function saveChip() {
    if (!chipParticipant) return;
    setChipSaving(true);
    setChipError("");
    setChipMessage("");
    try {
      const response = await fetch(`/api/v1/admin/events/${encodeURIComponent(event.id)}/participants/${encodeURIComponent(chipParticipant.id)}/chip`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chipCode: chipDraft, reason: chipReason }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string; data?: { assignment?: { previousChipCode: string; chipCode: string } } };
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Unable to replace chip code.");
      setChipMessage(`Chip changed from ${payload.data?.assignment?.previousChipCode || "unassigned"} to ${payload.data?.assignment?.chipCode || chipDraft}. The previous assignment remains in audit history.`);
      cancelChipEdit();
      await refresh();
    } catch (reason) {
      setChipError(reason instanceof Error ? reason.message : "Unable to replace chip code.");
    } finally {
      setChipSaving(false);
    }
  }

  async function openAthlete(participantId: string) {
    setAthleteLoading(true);
    setAthleteError("");
    try {
      const response = await fetch(`/api/v1/admin/events/${encodeURIComponent(event.id)}/participants/${encodeURIComponent(participantId)}/canonical`, { cache: "no-store" });
      const payload = await response.json() as { ok?: boolean; data?: AdminLiveParticipantDetail; error?: string };
      if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error || "Unable to load athlete details.");
      setAthleteDetail(payload.data);
    } catch (reason) {
      setAthleteError(reason instanceof Error ? reason.message : "Unable to load athlete details.");
    } finally {
      setAthleteLoading(false);
    }
  }

  return <section className="admin-card bergman-logs-panel">
    <div className="hub-logs-section hub-logs-overview">
      <div className="admin-card-head">
        <div><h2><ScrollText /> Live Tracking Logs <span className="hub-live-badge"><i /> Live</span></h2><p>Admin-only Feibot participant timing plus sanitized provider sync, canonical KV, and Worker activity. Provider secrets and raw payloads are never displayed.</p></div>
        <label className="hub-auto-refresh"><span>Auto refresh view</span><input type="checkbox" checked={autoRefresh} onChange={(change) => setAutoRefresh(change.target.checked)} /><i /></label>
      </div>
      <div className="hub-log-actions">
        <button className="button" disabled={Boolean(busy)} onClick={() => void run("FETCH_FEIBOT_READS")}><Activity /> Fetch Feibot Reads</button>
        <button className="button" disabled={Boolean(busy)} onClick={() => void run("FETCH_FEIBOT_RESULTS")}><Activity /> Fetch Feibot Result</button>
        <button className="button" disabled={Boolean(busy)} onClick={() => void run("IMPORT_TIMING_RULES")}><RefreshCw /> Refresh Timing Configuration</button>
        <button className="button" disabled={Boolean(busy)} onClick={() => void viewCanonical()}><Database /> View Canonical KV</button>
        <button className="button cms-danger-button" disabled={Boolean(busy)} onClick={() => void resetCanonical()}><Trash2 /> Clear Canonical Data</button>
        <button className="button" disabled={Boolean(busy)} onClick={() => void refresh()}><RefreshCw className={busy ? "spin" : ""} /> Refresh</button>
      </div>
      <div className={`hub-result-auto-fetch ${autoFetchResults ? "is-running" : ""}`}>
        <div className="hub-result-auto-fetch-copy"><span><Timer /><small>RACE-DAY RESULT FETCH</small></span><b>{autoFetchResults ? "Automatic Feibot result fetching is running" : "Automatically fetch Feibot results"}</b><p>Runs only while this admin page remains open. Every fetch uses the existing authenticated result import and canonical publication flow.</p></div>
        <label>Fetch every<div className="hub-result-auto-fetch-input"><input type="number" min={MIN_FEIBOT_RESULT_FETCH_SECONDS} max={MAX_FEIBOT_RESULT_FETCH_SECONDS} step={1} value={resultFetchSeconds} disabled={autoFetchResults} onChange={(change) => setResultFetchSeconds(Number(change.target.value))} onBlur={() => setResultFetchSeconds((value) => normalizedFeibotResultFetchSeconds(value))} /><span>seconds</span></div><small>Minimum 30 seconds · maximum 3600 seconds</small></label>
        <label>Stop after<select value={resultFetchDurationMinutes} disabled={autoFetchResults} onChange={(change) => setResultFetchDurationMinutes(Number(change.target.value))}><option value={0}>Admin stops it</option><option value={5}>5 minutes</option><option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={60}>1 hour</option><option value={120}>2 hours</option><option value={240}>4 hours</option></select><small>Optional safety duration</small></label>
        <div className="hub-result-auto-fetch-action">{autoFetchResults ? <><span className="hub-result-auto-fetch-status"><i />LIVE · {nextResultFetchAt ? `next fetch in ${Math.max(0, Math.ceil((nextResultFetchAt - resultFetchClock) / 1_000))}s` : "preparing"}{resultFetchEndsAt ? ` · stops ${new Date(resultFetchEndsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}</span><button type="button" className="button cms-danger-button" onClick={stopResultAutoFetch}><Square /> Stop auto-fetch</button></> : <button type="button" className="button button-primary" disabled={Boolean(busy)} onClick={startResultAutoFetch}><Play /> Start auto-fetch</button>}</div>
      </div>
      <div className="hub-log-scope">
        <span><small>Event</small><b>{event.name}</b></span>
        <span><small>Feibot scope</small><b>{event.eventUuid || "Not connected"}</b></span>
        <span><small>Updated</small><b>{displayTime(dashboard.connection.lastConnectedAt)}</b></span>
        <span><small>Canonical</small><b>{dashboard.manifest?.completeBuildValid ? "Complete" : "Unavailable"}</b></span>
      </div>
      <div className={`hub-live-sync-health ${dashboard.liveSync.lastError ? "has-error" : ""}`}><span><Activity/><small>AUTOMATIC FEIBOT SYNC</small><b>{dashboard.liveSync.lastSuccessAt ? `Last successful ${displayTime(dashboard.liveSync.lastSuccessAt)}` : "Waiting for first scheduled sync"}</b></span><span><small>LAST CHECK</small><b>{dashboard.liveSync.fetchedRows} rows · {dashboard.liveSync.publishedConnections} canonical publication{dashboard.liveSync.publishedConnections === 1 ? "" : "s"}</b></span>{dashboard.liveSync.rateLimitedUntil&&<span><small>PROVIDER COOLDOWN</small><b>Retry after {displayTime(dashboard.liveSync.rateLimitedUntil)} · existing canonical data preserved</b></span>}{dashboard.liveSync.lastWarning&&<span><small>LAST WARNING</small><b>{dashboard.liveSync.lastWarning}</b></span>}{dashboard.liveSync.lastError&&<span><small>LAST ERROR</small><b>{dashboard.liveSync.lastError}</b></span>}</div>
      <div className="hub-log-kpis">
        {[["Racers", dashboard.participants.length], ["Started", started], ["Finished", finished], ["Raw batches", rawBatches], ["Success", success], ["Warnings", warnings], ["Errors", errors], ["Visible", dashboard.participants.length]].map(([label, value]) => <span key={label}><strong>{value}</strong><small>{label}</small></span>)}
      </div>
    </div>

    <div className="hub-logs-section hub-racers-card">
      <div className="admin-card-head hub-racers-head"><div><h3>Participants racing</h3><p>Active canonical participants only: Feibot identity, canonical chip assignment, accepted start, and live split progress. Uploaded registration-roster rows are never listed here.</p></div><span className="status-pill status-live">CANONICAL ONLY</span></div>
      <div className="hub-table-toolbar hub-racer-search-row">
        <label className="hub-table-search"><Search /><input value={participantQuery} onChange={(change) => { setParticipantQuery(change.target.value); setParticipantPage(1); }} placeholder="Search bib, name, canonical UUID, chip…" /></label>
      </div>
      <div className="hub-table-meta"><p className="hub-table-count">Showing {visibleParticipants.length} of {participantRows.length} racers</p><div className="hub-row-size" aria-label="Rows shown">{pageSizes.map((size) => <button type="button" key={size} className={participantPageSize===size?"active":""} onClick={()=>{setParticipantPageSize(size);setParticipantPage(1);}}>{size}</button>)}<button type="button" className={participantPageSize===Math.max(1,participantRows.length)?"active":""} onClick={()=>{setParticipantPageSize(Math.max(1,participantRows.length));setParticipantPage(1);}}>Show all</button></div></div>
      {chipError && <div className="success-banner cms-error-banner"><AlertTriangle /> {chipError}</div>}
      {chipMessage && <div className="success-banner"><Check /> {chipMessage}</div>}
      {chipParticipant && <div className="hub-chip-editor"><div><small>RACE-DAY CHIP REPLACEMENT</small><b>{chipParticipant.name || "Athlete"} · BIB {chipParticipant.bib || "—"}</b><span>Current chip: <code>{chipParticipant.chipCode || "Unassigned"}</code></span></div><label>New chip code<input autoFocus value={chipDraft} onChange={(change) => setChipDraft(change.target.value)} placeholder="Enter replacement chip" /></label><label>Reason<input value={chipReason} onChange={(change) => setChipReason(change.target.value)} placeholder="Lost, damaged or reassigned" /></label><div className="form-actions"><button className="button button-primary" disabled={chipSaving || !chipDraft.trim() || chipReason.trim().length < 3 || chipDraft.trim().toLowerCase() === chipParticipant.chipCode.toLowerCase()} onClick={() => void saveChip()}><Save /> {chipSaving ? "Saving…" : "Save replacement"}</button><button className="button" disabled={chipSaving} onClick={cancelChipEdit}><X /> Cancel</button></div></div>}
      <div className="table-wrap hub-racers-scroll" tabIndex={0} aria-label="Scrollable participants racing table"><table className="hub-racers-table"><colgroup><col className="hub-col-bib"/><col className="hub-col-uuid"/><col className="hub-col-name"/><col className="hub-col-email"/><col className="hub-col-chip"/><col className="hub-col-provider"/><col className="hub-col-date"/><col className="hub-col-contest"/><col className="hub-col-age"/><col className="hub-col-gender"/><col className="hub-col-status"/><col className="hub-col-time"/><col className="hub-col-split"/><col className="hub-col-splits"/><col className="hub-col-state"/><col className="hub-col-evidence"/><col className="hub-col-evidence"/></colgroup><thead><tr><th>Bib</th><th>Participant UUID</th><th>Name</th><th>Email</th><th>Chip Code</th><th>Provider Event</th><th>Race Date</th><th>Contest</th><th>Age Group</th><th>Gender</th><th>Status</th><th>Chip Start Time</th><th>Current Split</th><th>Splits</th><th>Timing State</th><th>Start Evidence</th><th>Finish Evidence</th></tr></thead><tbody>
        {visibleParticipants.map((participant) => { const racing=Boolean(participant.startTime)||/start|course|racing|progress/i.test(participant.status); const participantFinished=hasConfirmedFinish(participant); return <tr key={`${participant.providerEventUuid || event.eventUuid}:${participant.id}:${participant.contest}:${participant.bib}`} className={participantFinished?"is-finished":racing?"is-racing":"is-registered"}><td><button type="button" className="hub-athlete-open hub-bib" onClick={()=>void openAthlete(participant.id)}>{participant.bib || "—"}</button></td><td><button type="button" className="hub-athlete-open hub-athlete-uuid" onClick={()=>void openAthlete(participant.id)}><code>{participant.id}</code></button></td><td><button type="button" className="hub-athlete-open hub-racer-name" onClick={()=>void openAthlete(participant.id)} title={participant.name || undefined}>{participant.name || "—"}<Eye /></button></td><td className="hub-truncate-cell" title={participant.email || undefined}>{participant.email || "—"}</td><td><div className="hub-chip-cell"><span><code>{participant.chipCode || "—"}</code>{participant.previousChipCode&&<small>Previously {participant.previousChipCode} · {displayTime(participant.chipChangedAt)}</small>}</span><button type="button" title={`Change chip for BIB ${participant.bib || "—"}`} aria-label={`Change chip for BIB ${participant.bib || "—"}`} onClick={() => editChip(participant)}><Pencil /></button></div></td><td className="hub-provider-cell"><b>{participant.providerEventName || "Feibot"}</b><code>{participant.providerEventUuid || event.eventUuid || "—"}</code></td><td>{participant.raceDate || "—"}</td><td className="hub-truncate-cell" title={participant.contest || undefined}>{participant.contest || "—"}</td><td>{participant.ageGroup || "—"}</td><td>{participant.gender || "—"}</td><td><span className={`hub-race-status ${participantFinished?"finished":racing?"racing":"registered"}`}>{participant.status}</span></td><td>{displayTime(participant.startTime)}</td><td>{participant.currentSplit || "—"}</td><td><div className="hub-split-badges">{participant.splits.map((split,index)=><span key={`${split.id || split.name || "split"}:${split.timestamp || index}:${index}`}>{split.name} ✓{split.time ? ` · ${split.time}` : ""}</span>)}{!participant.splits.length&&<em>No splits yet</em>}</div></td><td><span className={`hub-race-status ${participantFinished?"finished":racing?"racing":"registered"}`}>{participant.timingState}</span></td><td className="hub-evidence-cell"><small>Official</small><b>{displayTime(participant.startTime)}</b></td><td className="hub-evidence-cell"><small>{participantFinished?"Accepted":"Not finished"}</small><b>{displayTime(participantFinished?participant.finishTime:"")}</b></td></tr>})}
        {!visibleParticipants.length && <tr><td colSpan={17}><div className="admin-empty">No participants exist in the active canonical version. Use “Rebuild canonical” in View Canonical KV to fetch and publish the Feibot canonical roster.</div></td></tr>}
      </tbody></table></div>
      {participantPages > 1 && <div className="hub-table-pages"><button className="button" disabled={safeParticipantPage <= 1} onClick={() => setParticipantPage((page) => Math.max(1, page - 1))}>Previous</button><span>Page {safeParticipantPage} of {participantPages}</span><button className="button" disabled={safeParticipantPage >= participantPages} onClick={() => setParticipantPage((page) => Math.min(participantPages, page + 1))}>Next</button></div>}
    </div>
    {athleteLoading&&<div className="hub-athlete-loading"><Activity className="spin"/> Loading canonical athlete record…</div>}
    {athleteError&&<div className="success-banner cms-error-banner"><AlertTriangle/> {athleteError}</div>}
    {athleteDetail&&<AdminAthleteModal detail={athleteDetail} close={()=>setAthleteDetail(null)} updated={async()=>{ await openAthlete(athleteDetail.participant.participantUid); await refresh(); }}/>}

    <TimingDecisionDebugAdmin events={[event]} embedded />

    <div className="hub-logs-section">
      <div className="admin-card-head"><div><h2>Live tracking logs</h2><p>Provider, import, validation, reset and canonical operations for this event only.</p></div><button className="button cms-danger-button" disabled={Boolean(busy)} onClick={() => { if (confirm(`Clear live tracking logs for ${event.name}?`)) void run("CLEAR_LOGS"); }}><Trash2 /> Clear</button></div>
      <div className="hub-table-toolbar hub-log-filter-toolbar">
        <label className="hub-table-search"><Search /><input value={logQuery} onChange={(change) => setLogQuery(change.target.value)} placeholder="Search logs…" /></label>
        <select value={logLevel} onChange={(change) => setLogLevel(change.target.value)}><option value="ALL">All levels</option><option value="SUCCESS">Success</option><option value="WARNING">Warnings</option><option value="ERROR">Errors</option><option value="INFO">Info</option></select>
        <select value={logSource} onChange={(change) => setLogSource(change.target.value)}><option value="ALL">All sources</option>{sources.map((source) => <option key={source}>{source}</option>)}</select>
        <select value={logPageSize} onChange={(change) => setLogPageSize(Number(change.target.value))}><option value={15}>15 rows</option><option value={50}>50 rows</option><option value={100}>100 rows</option><option value={200}>200 rows</option><option value={500}>Show all</option></select>
      </div>
      <p className="hub-table-count">Showing first {Math.min(logRows.length, logPageSize)} of {logRows.length} logs</p>
      <div className="hub-log-table hub-filtered-log-table">{logRows.slice(0, logPageSize).map((log) => <div key={log.id}><span>{displayTime(log.createdAt)}</span><code>{log.operation}</code><b className={log.status.toLowerCase()}>{log.status}</b><span>{log.message}</span></div>)}{!logRows.length && <div className="admin-empty">No logs match the selected filters.</div>}</div>
    </div>
  </section>;
}

function AdminAthleteFacts({ rows }: { rows: Array<[string, string | number | null | undefined]> }) {
  return <div className="hub-athlete-facts">{rows.map(([label,value])=><span key={label}><small>{label}</small><b>{value===null||value===undefined||value===""?"—":value}</b></span>)}</div>;
}

function AdminAthleteModal({ detail, close, updated }: { detail: AdminLiveParticipantDetail; close: () => void; updated: () => Promise<void> }) {
  const athlete=detail.participant;
  const identity=detail.identity;
  const status=athlete.raceStatus.replaceAll("_"," ");
  return <div className="hub-athlete-modal-backdrop" role="presentation" onMouseDown={close}>
    <section className="hub-athlete-modal" role="dialog" aria-modal="true" aria-label={`${athlete.displayName} athlete details`} onMouseDown={event=>event.stopPropagation()}>
      <header><div className="hub-athlete-avatar">{athlete.initials||"RU"}</div><div><small>{detail.event.name} · CANONICAL ATHLETE</small><h2>{athlete.displayName} <em>· Bib {athlete.bib||"—"}</em></h2><p>Version-pinned participant identity, race state, rankings and split timeline.</p></div><span className={`hub-race-status ${/finish/.test(athlete.raceStatus)?"finished":/start|progress|racing/.test(athlete.raceStatus)?"racing":"registered"}`}>{status}</span><button className="hub-athlete-modal-close" onClick={close} aria-label="Close athlete details"><X/></button></header>
      <div className="hub-athlete-modal-scroll">
        <TimingCorrectionsAdmin key={athlete.participantUid} eventId={detail.event.id} participantId={athlete.participantUid} updated={updated}/>
        <div className="hub-athlete-metrics"><span><Timer/><small>ELAPSED</small><b>{athlete.elapsedTime||athlete.cumulativeTime||"—"}</b></span><span><MapPin/><small>CURRENT SPLIT</small><b>{identity.currentSplit||athlete.latestTimingPoint||"Waiting for read"}</b></span><span><Trophy/><small>OVERALL</small><b>{athlete.overallRank?`#${athlete.overallRank}`:"—"}</b></span><span><Medal/><small>AGE GROUP</small><b>{athlete.ageGroupRank?`#${athlete.ageGroupRank}`:"—"}</b></span></div>
        <div className="hub-athlete-detail-grid"><section><h3><UserRound/> Athlete identity</h3><AdminAthleteFacts rows={[["Name",athlete.displayName],["Bib",athlete.bib],["Chip code",identity.chipCode],["Contest",athlete.contestName],["Participant UUID",athlete.participantUid],["Provider participant UUID",identity.providerParticipantUuid],["Feibot event UUID",identity.providerEventUuid],["Contest UUID",identity.contestUuid],["Age group",athlete.ageGroup||"Not provided by Feibot"],["Gender",athlete.gender||"Not provided by Feibot"],["Date of birth",identity.dateOfBirth],["Club",athlete.club||"Not provided by Feibot"],["Country",athlete.country||"Not provided by Feibot"],["Tracking visibility",athlete.visibility],["Wave start",identity.waveStartTime?displayTime(identity.waveStartTime):"Not configured"],["Roster email",identity.email||"Not provided by Feibot"]]}/></section>
          <section><h3><Flag/> Race state</h3><AdminAthleteFacts rows={[["Status",status],["Status detail",identity.statusDetail],["Current leg",athlete.currentLeg],["Current split",identity.currentSplit||athlete.latestTimingPoint],["Official / chip start",displayTime(identity.acceptedStartTime)],["Finish",displayTime(identity.finishTime)],["Elapsed",athlete.elapsedTime||athlete.cumulativeTime],["Distance completed",athlete.distanceCompletedKm!==undefined?`${athlete.distanceCompletedKm.toFixed(2)} km`:null],["Official progress",athlete.progressPercent!==undefined?`${athlete.progressPercent.toFixed(1)}%`:null],["Estimated finish",displayTime(athlete.estimatedFinishAt)],["Overall rank",athlete.overallRank?`#${athlete.overallRank}`:null],["Gender rank",athlete.genderRank?`#${athlete.genderRank}`:null],["Age group rank",athlete.ageGroupRank?`#${athlete.ageGroupRank}`:null]]}/></section></div>
        <section className="hub-athlete-splits"><h3><Route/> Canonical split timeline</h3><p>Configured order from the active Race Upshot snapshot.</p><div className="hub-athlete-split-scroll"><table><thead><tr><th>Split</th><th>Status</th><th>Read time</th><th>Chip time</th><th>Gun time</th><th>Section</th><th>Pace / speed</th></tr></thead><tbody>{athlete.splits.map((split,index)=><tr key={`${split.splitId || split.name || "split"}:${split.readerTimestamp || split.timestamp || index}:${index}`}><td><b>{split.name}</b><code>{split.splitId}</code></td><td>{split.status||"—"}</td><td>{displayTime(split.readerTimestamp||split.timestamp)}</td><td>{split.cumulativeTime||split.splitTime||"—"}</td><td>{displayDurationMilliseconds(split.gunTimeMs)}</td><td>{displayDurationMilliseconds(split.sectionTimeMs)}</td><td>{split.paceOrSpeed||"—"}</td></tr>)}{!athlete.splits.length&&<tr><td colSpan={7}><div className="admin-empty">No split reads have been published for this athlete.</div></td></tr>}</tbody></table></div></section>
        <section className="hub-athlete-snapshot"><h3><Database/> Race Upshot match and snapshot</h3><AdminAthleteFacts rows={[["Build version",detail.canonical.buildVersion],["Snapshot updated",displayTime(detail.canonical.updatedAt)],["Course version",detail.canonical.courseVersion],["Timing version",detail.canonical.timingVersion],["Leaderboard version",detail.canonical.leaderboardVersion],["Timing source",athlete.timingSource]]}/></section>
      </div>
      <footer><button className="button" onClick={close}>Close</button></footer>
    </section>
  </div>;
}
