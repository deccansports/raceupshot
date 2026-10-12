"use client";

import type { AthleteTimingAudit } from "@/packages/timing-core/src";
import { formatDurationMs } from "@/packages/timing-core/src";
import { AlertTriangle, CheckCircle2, RefreshCw, Search, TimerReset } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

interface TimingDebugEvent {
  id: string;
  name: string;
  eventUuid: string;
}

function clock(timestamp: string | null | undefined): string {
  if (!timestamp) return "—";
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleTimeString([], { hour12: false, fractionalSecondDigits: 3 });
}

export function TimingDecisionDebugAdmin({ events, embedded = false }: { events: TimingDebugEvent[]; embedded?: boolean }) {
  const [eventId, setEventId] = useState(events[0]?.id ?? "");
  const [audits, setAudits] = useState<AthleteTimingAudit[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const selectedEvent = events.find((event) => event.id === eventId);
  const selectedEventUuid = selectedEvent?.eventUuid ?? "";

  const load = useCallback(async () => {
    if (!selectedEventUuid) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/v1/admin/events/${encodeURIComponent(eventId)}/timing?eventUuid=${encodeURIComponent(selectedEventUuid)}`,
        { cache: "no-store" },
      );
      const payload = await response.json() as { success?: boolean; data?: AthleteTimingAudit[]; error?: { message?: string } };
      if (!response.ok || !payload.success) throw new Error(payload.error?.message || "Unable to load timing decisions.");
      const rows = payload.data ?? [];
      setAudits(rows);
      setSelectedKey((current) => current || (rows[0] ? `${rows[0].contestUuid}:${rows[0].participantUuid}` : ""));
    } catch (reason) {
      setAudits([]);
      setError(reason instanceof Error ? reason.message : "Unable to load timing decisions.");
    } finally {
      setLoading(false);
    }
  }, [eventId, selectedEventUuid]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return audits;
    return audits.filter((audit) => [audit.bib, audit.chipCode, audit.participantUuid].some((value) => value.toLowerCase().includes(normalized)));
  }, [audits, query]);
  const selected = audits.find((audit) => `${audit.contestUuid}:${audit.participantUuid}` === selectedKey) ?? visible[0];
  const officialRows = useMemo(() => visible.flatMap((audit) => audit.officialResults.map((result) => {
    const decision = result.passageId ? audit.decisions.find((candidate) => candidate.passageId === result.passageId) : null;
    return { audit, result, decision };
  })), [visible]);

  return (
    <section className={`${embedded ? "hub-logs-section hub-timing-audit" : "admin-card"} live-visibility-admin`}>
      <div className="admin-card-head hub-audit-head">
        <div><h3><TimerReset /> Timing decision audit</h3><p>Every stored START decision and valid Feibot processed split, including the resolved chip, canonical split, timing point, and passage. Processed results remain separate from diagnostic raw antenna reads.</p></div>
      </div>
      {error && <div className="success-banner cms-error-banner"><AlertTriangle /> {error}</div>}
      <div className="live-visibility-toolbar hub-audit-toolbar">
        <div className="field"><label>Event</label><select value={eventId} onChange={(event) => { setEventId(event.target.value); setSelectedKey(""); }}>
          {events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}
        </select></div>
        <label className="live-visibility-search"><Search /><input placeholder="Search bib, chip or participant UUID…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <button className="button" type="button" disabled={loading || !selectedEventUuid} onClick={() => void load()}><RefreshCw /> Refresh</button>
      </div>
      {!selectedEventUuid && <div className="admin-empty">Connect this event to Feibot before reading raw timing audits.</div>}
      {embedded && <div className="table-wrap hub-decision-table" tabIndex={0} aria-label="Scrollable timing decision audit table"><table><colgroup><col className="hub-audit-col-time"/><col className="hub-audit-col-bib"/><col className="hub-audit-col-chip"/><col className="hub-audit-col-split"/><col className="hub-audit-col-point"/><col className="hub-audit-col-reads"/><col className="hub-audit-col-decision"/><col className="hub-audit-col-reason"/><col className="hub-audit-col-start"/><col className="hub-audit-col-start"/><col className="hub-audit-col-source"/></colgroup><thead><tr><th>Result time</th><th>Bib</th><th>Chip</th><th>Canonical split</th><th>Timing point</th><th>Reads</th><th>Decision</th><th>Reason</th><th>Gun baseline</th><th>Athlete start</th><th>Source</th></tr></thead><tbody>
        {officialRows.map(({ audit, result, decision }) => <tr key={`${audit.participantUuid}:${result.timingPointKey}:${result.readerTimestamp}`}><td className="hub-audit-mono">{clock(result.readerTimestamp)}</td><td><b className="hub-audit-bib">{audit.bib || "—"}</b></td><td><code className="hub-audit-chip">{audit.chipCode || "—"}</code></td><td className="hub-audit-split"><b>{result.timingPointName}</b><small>{result.timingPointKey}</small></td><td><code>{result.timingPointUuid || "—"}</code></td><td className="hub-audit-reads">{result.readCount}</td><td><span className={`status-pill ${decision?.decision === "ACCEPTED" || result.status === "PROVISIONAL" ? "status-live" : ""}`}>{decision?.decision || result.status}</span></td><td className="hub-audit-reason">{decision?.reason || result.overrideWarning || "Accepted official timing result"}</td><td className="hub-audit-mono">{clock(result.gunStartTimestamp)}</td><td className="hub-audit-mono">{clock(result.chipStartTimestamp)}</td><td><span className="hub-audit-source">{result.source}</span></td></tr>)}
        {!officialRows.length && <tr><td colSpan={11}><div className="admin-empty">No timing decisions recorded yet.</div></td></tr>}
      </tbody></table></div>}
      {!!visible.length && <details className="hub-raw-diagnostics" open={!embedded}><summary>Raw timing diagnostics</summary><div className="field"><label>Athlete</label><select value={selectedKey} onChange={(event) => setSelectedKey(event.target.value)}>
        {visible.map((audit) => <option key={`${audit.contestUuid}:${audit.participantUuid}`} value={`${audit.contestUuid}:${audit.participantUuid}`}>BIB {audit.bib || "—"} · {audit.chipCode} · {audit.state}</option>)}
      </select></div>
      {selected ? (
        <div className="platform-settings-stack">
          <div className="feibot-data-kpis">
            <span><small>RAW READS</small><strong>{selected.rawReads.length}</strong></span>
            <span><small>PASSAGES</small><strong>{selected.passages.length}</strong></span>
            <span><small>ACCEPTED</small><strong>{selected.decisions.filter((decision) => decision.decision === "ACCEPTED").length}</strong></span>
            <span><small>OFFICIAL</small><strong>{selected.officialResults.length}</strong></span>
          </div>
          <div className="integration-security-note"><CheckCircle2 /><span><b>{selected.timingResultSource.replaceAll("_", " ")}</b><small>State: {selected.state.replaceAll("_", " ")} · raw reads remain stored even when rejected.</small></span></div>
          <div className="table-wrap"><table><thead><tr><th>Raw reader time</th><th>Reader / antenna</th><th>RSSI</th><th>Transport</th><th>Passage</th><th>Decision</th></tr></thead><tbody>
            {selected.rawReads.map((read) => {
              const passage = selected.passages.find((candidate) => candidate.rawReadIds.includes(read.readId));
              const decision = passage ? selected.decisions.find((candidate) => candidate.passageId === passage.passageId) : null;
              const rejected = selected.rejectedRawReads.find((candidate) => candidate.readId === read.readId);
              return <tr key={read.readId}><td>{clock(read.readerTimestamp)}</td><td>{read.readerUuid} / {read.antennaId || "—"}</td><td>{read.rssi ?? "—"}</td><td>{read.source}</td><td>{passage ? `${passage.passageId} · ${passage.readCount} reads` : "—"}</td><td>{decision?.decision || rejected?.reason || "GROUPED"}</td></tr>;
            })}
          </tbody></table></div>
          <div className="table-wrap"><table><thead><tr><th>Grouped passage</th><th>Reader / point</th><th>First timestamp</th><th>Last timestamp</th><th>Reads</th><th>Sequence decision</th></tr></thead><tbody>
            {selected.passages.map((passage) => {
              const decision = selected.decisions.find((candidate) => candidate.passageId === passage.passageId);
              return <tr key={passage.passageId}><td><b>{passage.passageId}</b></td><td>{passage.readerUuid} / {passage.timingPointUuid}</td><td>{clock(passage.firstTimestamp)}</td><td>{clock(passage.lastTimestamp)}</td><td>{passage.readCount}</td><td><b>{decision?.decision ?? "—"}</b><small>{decision?.resolvedTimingPointKey ? `Accepted as ${decision.resolvedTimingPointKey}` : decision?.reason ?? "—"}</small></td></tr>;
            })}
          </tbody></table></div>
          <div className="table-wrap"><table><thead><tr><th>Official point</th><th>Source</th><th>Time of day</th><th>Gun time</th><th>Chip time</th><th>Section time</th><th>Reads</th></tr></thead><tbody>
            {selected.officialResults.map((result) => <tr key={result.timingPointKey}><td><b>{result.timingPointName}</b><small>{result.timingPointKey}</small></td><td><span className={`status-pill ${result.source === "AUTO" ? "status-live" : ""}`}>{result.source}</span>{result.overrideWarning && <small><AlertTriangle /> {result.overrideWarning}</small>}</td><td>{clock(result.readerTimestamp)}</td><td>{formatDurationMs(result.gunTimeMs)}</td><td>{formatDurationMs(result.chipTimeMs)}</td><td>{formatDurationMs(result.sectionTimeMs)}</td><td>{result.readCount}</td></tr>)}
          </tbody></table></div>
          {!!selected.manualOverrides.length && <div className="table-wrap"><table><thead><tr><th>Manual override</th><th>Source</th><th>Reader time</th><th>Authorized admin</th><th>Reason</th><th>Applied</th></tr></thead><tbody>
            {selected.manualOverrides.map((override) => <tr key={override.overrideId}><td><b>{override.timingPointKey}</b><small>{override.overrideId}</small></td><td><span className="status-pill"><AlertTriangle /> {override.source}</span></td><td>{clock(override.readerTimestamp)}</td><td>{override.authorizedBy}</td><td>{override.reason}</td><td>{clock(override.appliedAt)}</td></tr>)}
          </tbody></table></div>}
        </div>
      ) : !loading && selectedEventUuid ? <div className="admin-empty">No raw timing audits have been processed for this event.</div> : null}</details>}
    </section>
  );
}
