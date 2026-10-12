"use client";

import { useEffect, useMemo, useState } from "react";
import { Bike, Download, Plus, Save, Search, Trash2 } from "lucide-react";
import type { VolunteerEventOption } from "@/lib/volunteer-management";
import type { BikeRackConfiguration } from "@/lib/bike-racks";
import { assignedBikeRack, type BikeRackRange } from "@/lib/bike-rack-ranges";

type RosterRow = { participant: { bib: string; displayName: string } };
type Envelope<T> = { ok?: boolean; data?: T; error?: string };

export function BikeRackingAdmin({ events }: { events: VolunteerEventOption[] }) {
  const [eventId, setEventId] = useState(events[0]?.id || "");
  const [ranges, setRanges] = useState<BikeRackRange[]>([]);
  const [savedRangeCount, setSavedRangeCount] = useState(0);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [searchBib, setSearchBib] = useState("");
  const [lookup, setLookup] = useState("");
  const [loading, setLoading] = useState(Boolean(events[0]?.id));
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const event = events.find((item) => item.id === eventId);

  useEffect(() => {
    if (!eventId) return;
    let active = true;
    Promise.all([
      fetch(`/api/v1/admin/events/${encodeURIComponent(eventId)}/bike-racks`, { cache: "no-store" }).then((response) => response.json() as Promise<Envelope<BikeRackConfiguration>>),
      fetch(`/api/v1/admin/events/${encodeURIComponent(eventId)}/participants`, { cache: "no-store" }).then((response) => response.json() as Promise<Envelope<{ rows: RosterRow[] }>>),
    ]).then(([config, participants]) => {
      if (!config.ok || !config.data) throw new Error(config.error || "Unable to load rack configuration.");
      if (!participants.ok || !participants.data) throw new Error(participants.error || "Unable to load event roster.");
      if (active) { setRanges(config.data.ranges); setSavedRangeCount(config.data.ranges.length); setRoster(participants.data.rows); }
    }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Unable to load bike racks."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [eventId]);

  const assigned = useMemo(() => roster.filter((row) => assignedBikeRack(row.participant.bib, ranges)).length, [roster, ranges]);
  const match = useMemo(() => lookup ? roster.find((row) => row.participant.bib.trim().toLowerCase() === lookup.trim().toLowerCase()) : undefined, [lookup, roster]);
  const matchRack = match ? assignedBikeRack(match.participant.bib, ranges) : null;

  function switchEvent(nextId: string) {
    if (dirty && !window.confirm("Discard unsaved rack changes?")) return;
    setLoading(true); setError(""); setMessage(""); setLookup(""); setSearchBib(""); setRanges([]); setSavedRangeCount(0); setRoster([]); setDirty(false);
    setEventId(nextId);
  }

  function update(index: number, field: "rackName" | "bibFrom" | "bibTo", value: string) {
    setRanges((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: field === "rackName" ? value : value === "" ? 0 : Number(value) } : row));
    setDirty(true); setMessage("");
  }

  async function save() {
    if (!eventId) return;
    if (!ranges.length && savedRangeCount && !window.confirm(`Remove all bike rack ranges for ${event?.name || "this event"}? Volunteers will see no assigned racks.`)) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/v1/admin/events/${encodeURIComponent(eventId)}/bike-racks`, {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ranges }),
      });
      const payload = await response.json() as Envelope<BikeRackConfiguration>;
      if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error || "Unable to save rack ranges.");
      setRanges(payload.data.ranges); setSavedRangeCount(payload.data.ranges.length); setDirty(false); setMessage(`Saved ${payload.data.ranges.length} rack ranges for ${event?.name || "this event"}.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save rack ranges."); }
    finally { setSaving(false); }
  }

  function download() {
    const lines = [["Rack", "BIB From", "BIB To"], ...ranges.map((row) => [row.rackName, String(row.bibFrom), String(row.bibTo)])];
    const csv = lines.map((line) => line.map((value) => `"${value.replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${event?.name || "event"}-bike-racks.csv`; anchor.click(); URL.revokeObjectURL(url);
  }

  return <section className="admin-card bike-racking-admin">
    <div className="admin-card-head"><div><h2><Bike /> Bike Racking Management</h2><p>Assign BIB ranges to racks. Volunteers see the rack when they search an athlete for bike check-in.</p></div></div>
    <div className="field bike-racking-event"><label>Event</label><select value={eventId} disabled={loading || saving} onChange={(change) => switchEvent(change.target.value)}>{events.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
    {loading ? <p className="admin-empty">Loading rack assignments and event roster…</p> : <>
      {error && <div className="error-banner" role="alert">{error}</div>}{message && <div className="success-banner" role="status">{message}</div>}
      <div className="bike-racking-stats"><article><b>{ranges.length}</b><span>Configured racks</span></article><article><b>{assigned}</b><span>Athletes with rack</span></article><article><b>{Math.max(0, roster.length - assigned)}</b><span>Without rack</span></article></div>
      <form className="bike-racking-find" onSubmit={(submit) => { submit.preventDefault(); setLookup(searchBib.trim()); }}><input value={searchBib} onChange={(change) => setSearchBib(change.target.value)} placeholder="Enter exact BIB to find rack…" /><button className="button button-primary" disabled={!searchBib.trim()}><Search /> Find Rack</button></form>
      {lookup && <div className="bike-racking-result" role="status">{match ? <><b>{match.participant.displayName} · BIB {match.participant.bib}</b><strong>{matchRack || "No rack assigned"}</strong>{dirty && <small>Unsaved preview — volunteers will see the last saved configuration.</small>}</> : <span>No uploaded participant has BIB {lookup} in this event.</span>}</div>}
      <div className="bike-racking-heading"><h3>Rack Configuration</h3><button className="button" type="button" onClick={() => { setRanges((current) => [...current, { id: crypto.randomUUID(), rackName: "", bibFrom: 0, bibTo: 0 }]); setDirty(true); }}><Plus /> Add Rack</button></div>
      <div className="bike-racking-rows">{ranges.map((row, index) => <div className="bike-racking-row" key={row.id}><label>Rack name / number<input value={row.rackName} onChange={(change) => update(index, "rackName", change.target.value)} placeholder="e.g. RACK 1A" /></label><label>BIB from<input type="number" min="1" value={row.bibFrom || ""} onChange={(change) => update(index, "bibFrom", change.target.value)} /></label><label>BIB to<input type="number" min="1" value={row.bibTo || ""} onChange={(change) => update(index, "bibTo", change.target.value)} /></label><button className="button button-danger" type="button" aria-label={`Remove rack ${row.rackName || index + 1}`} onClick={() => { setRanges((current) => current.filter((item) => item.id !== row.id)); setDirty(true); }}><Trash2 /></button></div>)}{!ranges.length && <p className="admin-empty">No racks configured for this event. Add a rack and its BIB range.</p>}</div>
      <div className="bike-racking-actions"><button className="button" type="button" disabled={!ranges.length} onClick={download}><Download /> Download rack list</button><button className="button button-primary" type="button" disabled={saving || !dirty} onClick={() => void save()}><Save /> {saving ? "Saving…" : "Save Assignments"}</button></div>
    </>}
  </section>;
}
