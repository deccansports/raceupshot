"use client";

import type { ApiEnvelope, AthleteVisibility, LiveParticipant, PublicEvent } from "@/packages/contracts/src";
import { Eye, EyeOff, RefreshCw, Search, ShieldQuestion, UserRoundCog } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

interface VisibilityRow {
  participant: LiveParticipant;
  override: AthleteVisibility | null;
}

interface VisibilityData {
  event: PublicEvent;
  rows: VisibilityRow[];
}

const options: Array<{ value: AthleteVisibility | null; label: string }> = [
  { value: null, label: "Athlete setting" },
  { value: "PUBLIC", label: "Public" },
  { value: "ANONYMOUS", label: "Anonymous" },
  { value: "PRIVATE", label: "Hidden" },
];

export function LiveTimingVisibilityAdmin({ events }: { events: Array<{ id: string; name: string }> }) {
  const [eventId, setEventId] = useState(events[0]?.id || "");
  const [rows, setRows] = useState<VisibilityRow[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(Boolean(eventId));
  const [savingUid, setSavingUid] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/v1/admin/events/${encodeURIComponent(eventId)}/participants/visibility`,
        { cache: "no-store" },
      );
      const payload = await response.json() as ApiEnvelope<VisibilityData> & { error?: { message?: string } };
      if (!response.ok || !payload.success) throw new Error(payload.error?.message || "Unable to load event athletes.");
      setRows(payload.data.rows);
    } catch (reason) {
      setRows([]);
      setError(reason instanceof Error ? reason.message : "Unable to load event athletes.");
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  const visibleRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return rows;
    return rows.filter(({ participant }) =>
      participant.displayName.toLowerCase().includes(normalized)
      || participant.bib.toLowerCase() === normalized);
  }, [query, rows]);

  async function updateVisibility(row: VisibilityRow, visibility: AthleteVisibility | null) {
    setSavingUid(row.participant.participantUid);
    setMessage("");
    setError("");
    try {
      const response = await fetch(
        `/api/v1/admin/events/${encodeURIComponent(eventId)}/participants/visibility`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ participantUid: row.participant.participantUid, visibility }),
        },
      );
      const payload = await response.json() as ApiEnvelope<VisibilityRow> & { error?: { message?: string } };
      if (!response.ok || !payload.success) throw new Error(payload.error?.message || "Unable to update athlete visibility.");
      setRows((current) => current.map((item) =>
        item.participant.participantUid === row.participant.participantUid ? payload.data : item));
      setMessage(
        visibility === "PRIVATE"
          ? `${row.participant.displayName} is hidden from public live tracking.`
          : visibility === null
            ? `${row.participant.displayName} now follows their account visibility setting.`
            : `${row.participant.displayName} is ${visibility.toLowerCase()} in public live tracking.`,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update athlete visibility.");
    } finally {
      setSavingUid("");
    }
  }

  return (
    <section className="admin-card live-visibility-admin">
      <div className="admin-card-head">
        <div><h2><UserRoundCog /> Athlete visibility</h2><p>Show, anonymize or hide an individual athlete from public web and mobile tracking.</p></div>
        <span className="status-pill">{rows.length.toLocaleString()} athletes</span>
      </div>
      {message && <div className="success-banner">{message}</div>}
      {error && <div className="success-banner cms-error-banner">{error}</div>}
      <div className="live-visibility-toolbar">
        <div className="field">
          <label>Event</label>
          <select value={eventId} onChange={(event) => { setEventId(event.target.value); setQuery(""); setMessage(""); }}>
            {!events.length && <option value="">No events available</option>}
            {events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}
          </select>
        </div>
        <label className="live-visibility-search"><Search /><input placeholder="Search athlete name or exact bib…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <button className="button" type="button" disabled={loading || !eventId} onClick={() => void load()}><RefreshCw /> Refresh</button>
      </div>
      {loading ? <div className="admin-empty">Loading participants from the event timing feed…</div> : (
        <div className="live-visibility-list">
          {visibleRows.map((row) => {
            const hidden = row.override === "PRIVATE";
            return (
              <article key={row.participant.participantUid}>
                <span className={`live-visibility-icon ${hidden ? "hidden" : ""}`}>{hidden ? <EyeOff /> : <Eye />}</span>
                <div>
                  <strong>{row.participant.displayName}</strong>
                  <small>BIB {row.participant.bib || "—"} · {row.participant.contestName || "Open category"} · Source: {row.participant.visibility.toLowerCase()}</small>
                </div>
                <label>
                  <span>PUBLIC VISIBILITY</span>
                  <select
                    value={row.override ?? ""}
                    disabled={savingUid === row.participant.participantUid}
                    onChange={(event) => void updateVisibility(row, (event.target.value || null) as AthleteVisibility | null)}
                  >
                    {options.map((option) => <option key={option.value ?? "DEFAULT"} value={option.value ?? ""}>{option.label}</option>)}
                  </select>
                </label>
              </article>
            );
          })}
          {!visibleRows.length && (
            <div className="admin-empty">
              <ShieldQuestion />
              {query ? "No participant matches this search." : "No participants have been synchronized for this event yet."}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
