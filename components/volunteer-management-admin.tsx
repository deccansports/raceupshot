"use client";

import type {
  VolunteerActivity,
  VolunteerAssignment,
  VolunteerEventOption,
  VolunteerModule,
  VolunteerOperationLog,
  VolunteerProfile,
  VolunteerStatus,
} from "@/lib/volunteer-management";
import { normalizeVolunteerModules } from "@/lib/volunteer-management";
import { bikeOperationResetIds } from "@/lib/volunteer-bike-log-state";
import { waiverOperationResetIds } from "@/lib/volunteer-waiver-log-state";
import type { VolunteerEventCheckInSummary } from "@/lib/volunteer-operations";
import {
  BadgeCheck, Bike, CheckCircle2, ClipboardCheck, Clock3, Download, MapPin, Pencil,
  Plus, QrCode, RotateCcw, Search, ShieldCheck, Trash2, UserCheck, UserRoundPlus, Users, Utensils, XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { CounterNotificationSettings } from './counter-notification-settings';
import { BikeRackingAdmin } from './bike-racking-admin';

const tabs = [
  ["assignments", "Assignments", UserRoundPlus],
  ["notifications", "Counter Notifications", ClipboardCheck],
  ["timing-chip", "Time Chip Log", QrCode],
  ["volunteer-band", "Volunteer Band Log", Users],
  ["athlete-band", "Athlete Band Log", UserCheck],
  ["timing", "Time Keeper Log", Clock3],
  ["checkins", "Waiver Log", ClipboardCheck],
  ["bike-racking", "Bike Racking", Bike],
  ["bike-in", "Bike-in Log", Bike],
  ["bike-out", "Bike-out Log", Bike],
  ["locker", "Locker Log", ShieldCheck],
  ["medal", "Finisher Items", BadgeCheck],
  ["food", "Catering / Food", Utensils],
  ["activity", "Activity", ShieldCheck],
] as const;

const moduleLabels: Record<VolunteerModule, string> = {
  ATHLETE_LOOKUP: "Athlete Lookup",
  WAIVER_CHECK_IN: "Waiver & Athlete Band",
  ATHLETE_CHECK_IN: "Waiver & Athlete Band",
  BIKE_CHECK_IN: "Bike Check-In",
  BIKE_CHECK_OUT: "Bike Check-Out",
  MEDAL_COUNTER: "Finisher Medal / Goodies",
  FOOD_COUNTER: "Food Counter",
  LOCKER_COUNTER: "Locker Counter",
  COUNTER: "Counter",
  FINISH_LINE_VOLUNTEER: "Finish Line Volunteer",
  CUTOFF_TIME_VOLUNTEER: "Cutoff Time Volunteer",
  TIMING_CHIP_ASSIGNMENT_COUNTER: "Timing Chip Assignment Counter",
  ATHLETE_BAND_ASSIGNMENT_COUNTER: "Athlete Band Assignment Counter",
  VOLUNTEER_BAND_ASSIGNMENT_COUNTER: "Volunteer Band Assignment Counter",
  MANUAL_TIMING: "Timekeeper / Manual Timing",
};

const moduleDescriptions: Record<VolunteerModule, string> = {
  ATHLETE_LOOKUP: "Search or scan assigned-event athletes.",
  WAIVER_CHECK_IN: "Verify identity and waiver, assign the athlete band, and complete athlete check-in.",
  ATHLETE_CHECK_IN: "Verify identity and waiver, assign the athlete band, and complete athlete check-in.",
  BIKE_CHECK_IN: "Record helmet, rack and bike entry.",
  BIKE_CHECK_OUT: "Record secure bike collection.",
  MEDAL_COUNTER: "Record one finisher medal / goodies bundle per athlete.",
  FOOD_COUNTER: "Record food issuance once per athlete.",
  LOCKER_COUNTER: "Assign and view athlete locker numbers.",
  COUNTER: "Assign the volunteer to an event counter station with athlete scan and lookup access.",
  FINISH_LINE_VOLUNTEER: "Assign finish-line operations with athlete scan and lookup access.",
  CUTOFF_TIME_VOLUNTEER: "Assign cutoff-time operations with athlete scan and lookup access.",
  TIMING_CHIP_ASSIGNMENT_COUNTER: "Assign or replace an event timing chip after scanning the athlete.",
  ATHLETE_BAND_ASSIGNMENT_COUNTER: "Assign or replace an event athlete band after scanning the athlete.",
  VOLUNTEER_BAND_ASSIGNMENT_COUNTER: "Assign an event-scoped band to an event volunteer.",
  MANUAL_TIMING: "Capture finishes with selected timing points or automatic manual gun time.",
};

type Tab = (typeof tabs)[number][0];
type ApiResult<T> = { ok: true; data: T } | { ok: false; error?: string };
type DraftAssignment = Pick<VolunteerAssignment, "id" | "eventId" | "modules" | "timingPointIds" | "active">;
type DraftVolunteer = Pick<VolunteerProfile, "id" | "name" | "email" | "mobile" | "status"> & { assignments: DraftAssignment[]; password: string };

function emptyDraft(): DraftVolunteer {
  return { id: "", name: "", email: "", mobile: "", status: "INVITED", password: "", assignments: [] };
}

function draftFromVolunteer(volunteer: VolunteerProfile): DraftVolunteer {
  return {
    id: volunteer.id,
    name: volunteer.name,
    email: volunteer.email,
    mobile: volunteer.mobile,
    status: volunteer.status,
    password: "",
    assignments: volunteer.assignments.map((assignment) => ({
      id: assignment.id,
      eventId: assignment.eventId,
      modules: normalizeVolunteerModules(assignment.modules),
      timingPointIds: [...assignment.timingPointIds],
      active: assignment.active,
    })),
  };
}

function displayDate(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(parsed)
    : "—";
}

function csvCell(value: string | number | null | undefined): string {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function displayDuration(milliseconds: number | null | undefined): string {
  if (milliseconds === null || milliseconds === undefined || !Number.isFinite(milliseconds)) return "—";
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function StatusPill({ status }: { status: VolunteerStatus }) {
  return <span className={`status-pill volunteer-status-${status.toLowerCase()}`}>{status}</span>;
}

export function VolunteerManagementAdmin({
  initialVolunteers,
  events,
  initialActivity,
  initialCheckIns,
  initialManualTiming,
}: {
  initialVolunteers: VolunteerProfile[];
  events: VolunteerEventOption[];
  initialActivity: VolunteerActivity[];
  initialCheckIns: VolunteerOperationLog[];
  initialManualTiming: VolunteerOperationLog[];
}) {
  const [tab, setTab] = useState<Tab>("assignments");
  const [volunteers, setVolunteers] = useState(initialVolunteers);
  const [activity, setActivity] = useState(initialActivity);
  const [checkIns, setCheckIns] = useState(initialCheckIns);
  const [manualTiming, setManualTiming] = useState(initialManualTiming);
  const [checkInSummaries, setCheckInSummaries] = useState<VolunteerEventCheckInSummary[] | null>(null);
  const [checkInSummaryLoading, setCheckInSummaryLoading] = useState(false);
  const [checkInSummaryError, setCheckInSummaryError] = useState("");
  const [draft, setDraft] = useState<DraftVolunteer>(emptyDraft());
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const eventById = useMemo(() => new Map(events.map((event) => [event.id, event])), [events]);
  const filteredVolunteers = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return volunteers;
    return volunteers.filter((volunteer) => `${volunteer.name} ${volunteer.email} ${volunteer.mobile} ${volunteer.assignments.map((item) => item.eventName).join(" ")}`.toLowerCase().includes(term));
  }, [query, volunteers]);

  const stats = useMemo(() => ({
    active: volunteers.filter((volunteer) => volunteer.status === "ACTIVE").length,
    assigned: volunteers.filter((volunteer) => volunteer.status === "ACTIVE" && volunteer.assignments.some((assignment) => assignment.active)).length,
    invited: volunteers.filter((volunteer) => volunteer.status === "INVITED").length,
    disabled: volunteers.filter((volunteer) => volunteer.status === "DISABLED").length,
    checkInAssignments: volunteers.flatMap((volunteer) => volunteer.assignments).filter((assignment) => assignment.active && (assignment.modules.includes("ATHLETE_CHECK_IN") || assignment.modules.includes("WAIVER_CHECK_IN"))).length,
    timingAssignments: volunteers.flatMap((volunteer) => volunteer.assignments).filter((assignment) => assignment.active && assignment.modules.includes("MANUAL_TIMING")).length,
  }), [volunteers]);

  const operationRows = useMemo(() => ({
    checkins: checkIns.filter((row) => ["WAIVER_VERIFY", "CHECK_IN", "CHECK_IN_REVERSE", "ADMIN_WAIVER_CHECK_IN_RESET"].includes(row.action)),
    "bike-in": checkIns.filter((row) => row.action === "BIKE_IN"),
    "bike-out": checkIns.filter((row) => row.action === "BIKE_OUT"),
    medal: checkIns.filter((row) => row.action === "MEDAL_ISSUE"),
    food: checkIns.filter((row) => row.action === "FOOD_ISSUE"),
    locker: checkIns.filter((row) => row.action === "LOCKER_ASSIGN"),
    "timing-chip": checkIns.filter((row) => row.action === "TIMING_CHIP_ASSIGNED"),
    "athlete-band": checkIns.filter((row) => row.action === "ATHLETE_BAND_ASSIGNED"),
    "volunteer-band": checkIns.filter((row) => row.action === "VOLUNTEER_BAND_ASSIGNED"),
  }), [checkIns]);
  const resetBikeOperationIds = useMemo(() => bikeOperationResetIds(checkIns), [checkIns]);
  const resetWaiverOperationIds = useMemo(() => waiverOperationResetIds(checkIns), [checkIns]);
  const tabLogCounts: Partial<Record<Tab, number>> = {
    checkins: operationRows.checkins.length,
    "bike-in": operationRows["bike-in"].length,
    "bike-out": operationRows["bike-out"].length,
    medal: operationRows.medal.length,
    food: operationRows.food.length,
    locker: operationRows.locker.length,
    "timing-chip": operationRows["timing-chip"].length,
    "athlete-band": operationRows["athlete-band"].length,
    "volunteer-band": operationRows["volunteer-band"].length,
    timing: manualTiming.length,
    activity: activity.length,
  };

  async function loadCheckInSummaries() {
    setCheckInSummaryLoading(true);
    setCheckInSummaryError("");
    try {
      const response = await fetch("/api/admin/volunteers/check-in-summary", { cache: "no-store" });
      const body = await response.json() as ApiResult<VolunteerEventCheckInSummary[]>;
      if (!response.ok || !body.ok) throw new Error(body.ok ? "Unable to load check-in totals." : body.error || "Unable to load check-in totals.");
      setCheckInSummaries(body.data);
    } catch (caught) {
      setCheckInSummaries(null);
      setCheckInSummaryError(caught instanceof Error ? caught.message : "Unable to load check-in totals.");
    } finally {
      setCheckInSummaryLoading(false);
    }
  }

  async function refresh() {
    const response = await fetch("/api/admin/volunteers", { cache: "no-store" });
    const body = await response.json() as ApiResult<{
      volunteers: VolunteerProfile[];
      activity: VolunteerActivity[];
      checkIns: VolunteerOperationLog[];
      manualTiming: VolunteerOperationLog[];
    }>;
    if (!response.ok || !body.ok) throw new Error(body.ok ? "Unable to refresh volunteer management." : body.error || "Unable to refresh volunteer management.");
    setVolunteers(body.data.volunteers);
    setActivity(body.data.activity);
    setCheckIns(body.data.checkIns);
    setManualTiming(body.data.manualTiming);
    setCheckInSummaries(null);
    if (tab === "checkins") void loadCheckInSummaries();
  }

  function startCreate() {
    setDraft(emptyDraft());
    setMessage("");
    setError("");
    setTab("assignments");
    requestAnimationFrame(() => document.getElementById("volunteer-editor")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function startEdit(volunteer: VolunteerProfile) {
    setDraft(draftFromVolunteer(volunteer));
    setMessage("");
    setError("");
    setTab("assignments");
    requestAnimationFrame(() => document.getElementById("volunteer-editor")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function addAssignment() {
    const event = events.find((candidate) => !draft.assignments.some((assignment) => assignment.eventId === candidate.id));
    if (!event) return;
    setDraft((current) => ({
      ...current,
      assignments: [...current.assignments, {
        id: "",
        eventId: event.id,
        modules: ["ATHLETE_LOOKUP"],
        timingPointIds: [],
        active: true,
      }],
    }));
  }

  function updateAssignment(index: number, update: Partial<DraftAssignment>) {
    setDraft((current) => ({
      ...current,
      assignments: current.assignments.map((assignment, assignmentIndex) => assignmentIndex === index ? { ...assignment, ...update } : assignment),
    }));
  }

  function toggleModule(index: number, module: VolunteerModule, checked: boolean) {
    const assignment = draft.assignments[index];
    const modules = checked
      ? [...new Set([...assignment.modules, module])]
      : assignment.modules.filter((item) => item !== module);
    updateAssignment(index, { modules, ...(module === "MANUAL_TIMING" && !checked ? { timingPointIds: [] } : {}) });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/admin/volunteers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...draft, id: draft.id || undefined }),
      });
      const body = await response.json() as ApiResult<VolunteerProfile>;
      if (!response.ok || !body.ok) throw new Error(body.ok ? "Unable to save volunteer." : body.error || "Unable to save volunteer.");
      await refresh();
      setDraft(emptyDraft());
      setMessage(draft.id
        ? `Volunteer and assignments updated.${draft.password ? " A new login password was saved." : ""}`
        : `Volunteer created.${draft.password ? " Email-and-password login is ready." : " OTP login is ready; add a password later if required."}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save volunteer.");
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(volunteer: VolunteerProfile) {
    const status: VolunteerStatus = volunteer.status === "DISABLED" ? "ACTIVE" : "DISABLED";
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/admin/volunteers", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: volunteer.id, status }),
      });
      const body = await response.json() as ApiResult<VolunteerProfile>;
      if (!response.ok || !body.ok) throw new Error(body.ok ? "Unable to update access." : body.error || "Unable to update access.");
      await refresh();
      setMessage(`${volunteer.name} is now ${status.toLowerCase()}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update volunteer access.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(volunteer: VolunteerProfile) {
    if (!window.confirm(`Remove ${volunteer.name} and all event assignments?`)) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch(`/api/admin/volunteers?id=${encodeURIComponent(volunteer.id)}`, { method: "DELETE" });
      const body = await response.json() as ApiResult<{ deleted: boolean }>;
      if (!response.ok || !body.ok) throw new Error(body.ok ? "Unable to remove volunteer." : body.error || "Unable to remove volunteer.");
      await refresh();
      if (draft.id === volunteer.id) setDraft(emptyDraft());
      setMessage("Volunteer removed.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to remove volunteer.");
    } finally {
      setBusy(false);
    }
  }

  async function manageManualTiming(row: VolunteerOperationLog, action: "reset" | "delete") {
    const confirmed = action === "reset"
      ? window.confirm(`Reset the manual timing stamp for BIB ${row.bib || "—"}? The original record will be preserved and marked as reset.`)
      : window.confirm(row.action === "MANUAL_TIMING_RESET"
        ? `Permanently delete this reset record for BIB ${row.bib || "—"}? The original stamp will become active again. This cannot be undone.`
        : `Permanently delete this manual timing log for BIB ${row.bib || "—"}? Any linked reset record will also be deleted. This cannot be undone.`);
    if (!confirmed) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch(action === "reset"
        ? "/api/admin/volunteers/manual-timing"
        : `/api/admin/volunteers/manual-timing?id=${encodeURIComponent(row.id)}`, action === "reset" ? {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: row.id }),
        } : { method: "DELETE" });
      const body = await response.json() as ApiResult<unknown>;
      if (!response.ok || !body.ok) throw new Error(body.ok ? `Unable to ${action} manual timing.` : body.error || `Unable to ${action} manual timing.`);
      await refresh();
      setMessage(action === "reset" ? `BIB ${row.bib || "—"} timing stamp reset. Original record preserved.` : `BIB ${row.bib || "—"} manual timing log permanently deleted.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `Unable to ${action} manual timing.`);
    } finally {
      setBusy(false);
    }
  }

  async function resetBikeCheckIn(row: VolunteerOperationLog) {
    if (!window.confirm(`Reset the complete bike check-in and checkout state for BIB ${row.bib || "—"}? Helmet verification and rack assignment will also be cleared. The athlete can then be checked in again.`)) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch(`/api/v1/admin/events/${encodeURIComponent(row.eventId)}/participants/${encodeURIComponent(row.participantUid)}/bike-check-in`, { method: "DELETE" });
      const body = await response.json() as ApiResult<unknown>;
      if (!response.ok || !body.ok) throw new Error(body.ok ? "Unable to reset bike check-in." : body.error || "Unable to reset bike check-in.");
      await refresh();
      setMessage(`Bike check-in and checkout reset for BIB ${row.bib || "—"}. The athlete may now be checked in again.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to reset bike check-in.");
    } finally {
      setBusy(false);
    }
  }

  async function resetWaiverCheckIn(row: VolunteerOperationLog) {
    if (!window.confirm(`Reset the waiver, OTP verification and athlete check-in for BIB ${row.bib || "—"}? The athlete must verify and sign again.`)) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch(`/api/v1/admin/events/${encodeURIComponent(row.eventId)}/participants/${encodeURIComponent(row.participantUid)}/waiver-check-in`, { method: "DELETE" });
      const body = await response.json() as ApiResult<unknown>;
      if (!response.ok || !body.ok) throw new Error(body.ok ? "Unable to reset waiver and check-in." : body.error || "Unable to reset waiver and check-in.");
      await refresh();
      setMessage(`Waiver, OTP verification and check-in reset for BIB ${row.bib || "—"}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to reset waiver and check-in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="volunteer-admin">
      <div className="admin-title volunteer-admin-title">
        <div><h1>Volunteer Management</h1><p>Create volunteers, control event functions, configure automatic or restricted manual timing, and review race-day activity.</p></div>
        <button className="button button-primary" type="button" onClick={startCreate}><UserRoundPlus /> Create volunteer</button>
      </div>

      <div className="volunteer-tabs" role="tablist">
        {tabs.map(([id, label, Icon]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => { setTab(id); if (id === "checkins" && !checkInSummaries && !checkInSummaryLoading) void loadCheckInSummaries(); }}><Icon /> {label}{tabLogCounts[id] !== undefined ? ` (${tabLogCounts[id]})` : ""}</button>)}
      </div>

      <section className="admin-card volunteer-stats-panel" aria-label="Volunteer statistics">
        <h2>Volunteer Stats</h2>
        <div className="volunteer-stats-grid">
          <article><strong>{volunteers.length}</strong><span>Total Volunteers</span></article>
          <article className="volunteer-stat-assigned"><strong>{stats.assigned}</strong><span>Active / Assigned</span></article>
          <article className="volunteer-stat-unassigned"><strong>{Math.max(0, volunteers.length - stats.assigned)}</strong><span>Unassigned</span></article>
        </div>
      </section>

      {message && <div className="success-banner">{message}</div>}
      {error && <div className="error-banner">{error}</div>}

      {tab === "assignments" && <>
        <section className="admin-card volunteer-editor" id="volunteer-editor">
          <div className="admin-card-head"><div><h2>{draft.id ? "Edit volunteer" : "Create volunteer"}</h2><p>Configure identity, access state and event modules. Manual Timing may be saved before timing points are configured.</p></div>{draft.id ? <Pencil /> : <UserRoundPlus />}</div>
          <form onSubmit={save}>
            <div className="form-grid volunteer-identity-fields">
              <div className="field"><label htmlFor="volunteer-name">Full name</label><input id="volunteer-name" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} required /></div>
              <div className="field"><label htmlFor="volunteer-email">Email</label><input id="volunteer-email" type="email" value={draft.email} onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))} required /></div>
              <div className="field"><label htmlFor="volunteer-mobile">Mobile</label><input id="volunteer-mobile" value={draft.mobile} onChange={(event) => setDraft((current) => ({ ...current, mobile: event.target.value }))} placeholder="+91…" /></div>
              <div className="field"><label htmlFor="volunteer-status">Access status</label><select id="volunteer-status" value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value as VolunteerStatus }))}><option value="INVITED">Invited</option><option value="ACTIVE">Active</option><option value="DISABLED">Disabled</option></select></div>
              <div className="field"><label htmlFor="volunteer-password">Login password {draft.id ? "(leave blank to keep current)" : "(optional)"}</label><input id="volunteer-password" type="password" autoComplete="new-password" minLength={6} maxLength={128} value={draft.password} onChange={(event) => setDraft((current) => ({ ...current, password: event.target.value }))} placeholder={draft.id ? "Enter only to set a new password" : "Minimum 6 characters"} /><small>{draft.id && volunteers.find((volunteer) => volunteer.id === draft.id)?.hasPassword ? "Password login is enabled." : "OTP login remains available even when a password is set."}</small></div>
            </div>

            <div className="volunteer-assignment-heading"><div><h3>Event assignments</h3><p>Volunteers see only these events and functions.</p></div><button className="button button-secondary" type="button" onClick={addAssignment} disabled={draft.assignments.length >= events.length}><Plus /> Add event</button></div>
            <div className="volunteer-assignment-editor-list">
              {draft.assignments.map((assignment, index) => {
                const selectedEvent = eventById.get(assignment.eventId);
                return <article key={assignment.id || `new-${index}`} className="volunteer-assignment-editor">
                  <header><div><b>Assignment {index + 1}</b><span>{selectedEvent?.providerEventUuid ? `Provider ${selectedEvent.providerEventUuid}` : "No timing provider linked"}</span></div><button type="button" aria-label="Remove assignment" onClick={() => setDraft((current) => ({ ...current, assignments: current.assignments.filter((_, itemIndex) => itemIndex !== index) }))}><Trash2 /></button></header>
                  <div className="form-grid">
                    <div className="field"><label>Event</label><select value={assignment.eventId} onChange={(event) => updateAssignment(index, { eventId: event.target.value, timingPointIds: [] })}>{events.map((candidate) => <option key={candidate.id} value={candidate.id} disabled={draft.assignments.some((item, itemIndex) => itemIndex !== index && item.eventId === candidate.id)}>{candidate.name}</option>)}</select></div>
                    <label className="volunteer-active-check"><input type="checkbox" checked={assignment.active} onChange={(event) => updateAssignment(index, { active: event.target.checked })} /><span><b>Assignment active</b><small>Disable this event without removing its setup.</small></span></label>
                  </div>
                  <div className="volunteer-module-grid">
                    {(Object.keys(moduleLabels) as VolunteerModule[]).filter((module) => module !== "WAIVER_CHECK_IN").map((module) => <label key={module} className={assignment.modules.includes(module) ? "selected" : ""}><input type="checkbox" checked={assignment.modules.includes(module)} onChange={(event) => toggleModule(index, module, event.target.checked)} /><span><b>{moduleLabels[module]}</b><small>{moduleDescriptions[module]}</small></span></label>)}
                  </div>
                  {assignment.modules.includes("MANUAL_TIMING") && <div className="volunteer-timing-scope"><div><b>Allowed timing points</b><span>{assignment.timingPointIds.length ? `${assignment.timingPointIds.length} restricted point${assignment.timingPointIds.length === 1 ? "" : "s"}` : "Automatic finish assignment"}</span></div>{selectedEvent?.timingPoints.length ? <><div className="volunteer-point-grid">{selectedEvent.timingPoints.map((point) => <label key={point.id} className={assignment.timingPointIds.includes(point.id) ? "selected" : ""}><input type="checkbox" checked={assignment.timingPointIds.includes(point.id)} onChange={(event) => updateAssignment(index, { timingPointIds: event.target.checked ? [...assignment.timingPointIds, point.id] : assignment.timingPointIds.filter((id) => id !== point.id) })} /><span><b>{point.name}</b><small>{point.type} · {point.id}</small></span></label>)}</div>{!assignment.timingPointIds.length && <p className="admin-empty">Automatic mode is active. The configured FINISH point will be assigned to this volunteer automatically.</p>}</> : <p className="admin-empty">Manual Gun Finish is available now. When a FINISH timing point is configured in Live Tracking, this assignment will connect to it automatically.</p>}</div>}
                </article>;
              })}
              {!draft.assignments.length && <div className="volunteer-empty-assignment"><MapPin /><b>No event assigned</b><span>Add an event to grant operational access.</span></div>}
            </div>
            <div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setDraft(emptyDraft())} disabled={busy}>Clear</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? "Saving…" : draft.id ? "Update volunteer" : "Create volunteer"}</button></div>
          </form>
        </section>

        <section className="admin-card volunteer-directory">
          <div className="admin-card-head"><div><h2>Volunteer directory</h2><p>Search, edit, suspend or remove volunteer access.</p></div><span className="status-pill">{volunteers.length} profiles</span></div>
          <label className="volunteer-search"><Search /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, email, mobile or event" /></label>
          <div className="volunteer-directory-list">
            {filteredVolunteers.map((volunteer) => <article key={volunteer.id}>
              <div className="volunteer-avatar">{volunteer.name.slice(0, 1).toUpperCase()}</div>
              <div className="volunteer-directory-identity"><strong>{volunteer.name}</strong><span>{volunteer.email}{volunteer.mobile ? ` · ${volunteer.mobile}` : ""}</span></div>
              <div className="volunteer-directory-assignments">{volunteer.assignments.length ? volunteer.assignments.map((assignment) => <span key={assignment.id}><b>{assignment.eventName}</b><small>{assignment.modules.map((module) => moduleLabels[module]).join(" · ")}</small></span>) : <em>No event assigned</em>}</div>
              <StatusPill status={volunteer.status} />
              <div className="volunteer-row-actions"><button className="button button-secondary" type="button" onClick={() => startEdit(volunteer)} disabled={busy}><Pencil /> Edit</button><button className="button button-secondary" type="button" onClick={() => void changeStatus(volunteer)} disabled={busy}>{volunteer.status === "DISABLED" ? <UserCheck /> : <XCircle />}{volunteer.status === "DISABLED" ? "Enable" : "Disable"}</button><button className="button button-danger" type="button" aria-label={`Remove ${volunteer.name}`} onClick={() => void remove(volunteer)} disabled={busy}><Trash2 /></button></div>
            </article>)}
            {!filteredVolunteers.length && <p className="admin-empty">No volunteers match this search.</p>}
          </div>
        </section>
      </>}

      {tab === "checkins" && <><CheckInSummary summaries={checkInSummaries} loading={checkInSummaryLoading} error={checkInSummaryError} onRetry={() => void loadCheckInSummaries()} /><OperationTable title="Athlete & Waiver Check-In Log" description="Athlete check-in, waiver verification and administrator reset actions." rows={operationRows.checkins} kind="checkin" busy={busy} resetWaiverOperationIds={resetWaiverOperationIds} onWaiverReset={resetWaiverCheckIn} /></>}
      {tab === "bike-racking" && <BikeRackingAdmin events={events} />}
      {tab === "bike-in" && <OperationTable title="Bike-in Log" description="Bike entry, helmet verification and rack-assignment actions." rows={operationRows["bike-in"]} kind="checkin" busy={busy} resetBikeOperationIds={resetBikeOperationIds} onBikeReset={resetBikeCheckIn} />}
      {tab === "bike-out" && <OperationTable title="Bike-out Log" description="Secure bike collection and checkout actions." rows={operationRows["bike-out"]} kind="checkin" busy={busy} resetBikeOperationIds={resetBikeOperationIds} onBikeReset={resetBikeCheckIn} />}
      {tab === "medal" && <OperationTable title="Finisher Items Log" description="Finisher medals and goodies recorded by assigned volunteers." rows={operationRows.medal} kind="checkin" />}
      {tab === "food" && <OperationTable title="Food Counter Log" description="Food issuance recorded by assigned volunteers." rows={operationRows.food} kind="checkin" />}
      {tab === "locker" && <OperationTable title="Locker Counter Log" description="Locker assignments recorded by assigned volunteers." rows={operationRows.locker} kind="checkin" />}
      {tab === "timing-chip" && <OperationTable title="Timing Chip Assignment Log" description="Event timing-chip assignments and replacements." rows={operationRows["timing-chip"]} kind="checkin" />}
      {tab === "athlete-band" && <OperationTable title="Athlete Band Assignment Log" description="Event athlete-band assignments and replacements." rows={operationRows["athlete-band"]} kind="checkin" />}
      {tab === "volunteer-band" && <OperationTable title="Volunteer Band Assignment Log" description="Event-scoped volunteer-band assignments and replacements." rows={operationRows["volunteer-band"]} kind="checkin" />}
      {tab === "timing" && <OperationTable title="Manual Timing Log" description="Device captures, assigned points and synchronization status." rows={manualTiming} kind="timing" busy={busy} onTimingAction={manageManualTiming} />}
      {tab === "activity" && <ActivityTable rows={activity} />}
      {tab === "notifications" && <CounterNotificationSettings events={events} />}
    </div>
  );
}

function CheckInSummary({ summaries, loading, error, onRetry }: { summaries: VolunteerEventCheckInSummary[] | null; loading: boolean; error: string; onRetry: () => void }) {
  if (!summaries) return <section className="admin-card" role={error ? "alert" : "status"}>
    <div className="admin-card-head"><div><h2>Check-in totals {loading ? "loading…" : "unavailable"}</h2><p>{error || "Loading the assigned-event rosters and current check-in states."}</p></div>
      {!loading && <button className="button" type="button" onClick={onRetry}><RotateCcw /> Retry totals</button>}</div>
  </section>;
  const totals = summaries.reduce((result, summary) => ({
    total: result.total + summary.totalAthletes,
    checkedIn: result.checkedIn + summary.checkedInAthletes,
    remaining: result.remaining + summary.remainingAthletes,
  }), { total: 0, checkedIn: 0, remaining: 0 });
  return <>
    <div className="admin-kpis volunteer-kpis">
      <article className="kpi-card"><Users /><span>Total athletes</span><strong>{totals.total}</strong><small>Across {summaries.length} assigned event{summaries.length === 1 ? "" : "s"}</small></article>
      <article className="kpi-card"><CheckCircle2 /><span>Checked-in athletes</span><strong>{totals.checkedIn}</strong><small>Current stored check-in state</small></article>
      <article className="kpi-card"><Clock3 /><span>Remaining to check in</span><strong>{totals.remaining}</strong><small>{totals.total ? `${Math.round((totals.checkedIn / totals.total) * 100)}% completed` : "No roster athletes"}</small></article>
    </div>
    {summaries.length > 1 && <section className="admin-card volunteer-operation-log"><div className="admin-card-head"><div><h2>Event Check-In Totals</h2><p>Roster-backed progress for every active assigned event.</p></div></div><div className="table-wrap"><table className="leaderboard"><thead><tr><th>EVENT</th><th>TOTAL ATHLETES</th><th>CHECKED IN</th><th>REMAINING</th></tr></thead><tbody>{summaries.map((summary) => <tr key={summary.eventId}><td><b>{summary.eventName}</b></td><td>{summary.totalAthletes}</td><td>{summary.checkedInAthletes}</td><td>{summary.remainingAthletes}</td></tr>)}</tbody></table></div></section>}
  </>;
}

function OperationTable({ title, description, rows, kind, busy = false, resetBikeOperationIds = new Set<string>(), resetWaiverOperationIds = new Set<string>(), onBikeReset, onWaiverReset, onTimingAction }: {
  title: string;
  description: string;
  rows: VolunteerOperationLog[];
  kind: "checkin" | "timing";
  busy?: boolean;
  resetBikeOperationIds?: ReadonlySet<string>;
  resetWaiverOperationIds?: ReadonlySet<string>;
  onBikeReset?: (row: VolunteerOperationLog) => Promise<void>;
  onWaiverReset?: (row: VolunteerOperationLog) => Promise<void>;
  onTimingAction?: (row: VolunteerOperationLog, action: "reset" | "delete") => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const filtered = rows.filter((row) => `${row.eventName} ${row.bib} ${row.athleteName} ${row.volunteerName} ${row.status} ${row.timingPointName || ""}`.toLowerCase().includes(query.toLowerCase()));
  const resetOperationIds = new Set(rows
    .filter((row) => row.action === "MANUAL_TIMING_RESET" && row.reversesOperationId)
    .map((row) => row.reversesOperationId));

  function downloadList() {
    const header = ["Time", "Event", "Event ID", "Action", "BIB", "Athlete", "Participant ID", ...(kind === "timing" ? ["Start Time", "End Time", "Elapsed Time", "Start Source", "Overall Rank", "Gender Rank", "Age Category Rank", "Timing Point"] : []), "Volunteer", "Volunteer ID", "Status", "Record ID"];
    const body = filtered.map((row) => [row.capturedAt, row.eventName, row.eventId, row.action, row.bib, row.athleteName, row.participantUid, ...(kind === "timing" ? [row.rankingStartAt || "", row.rankingEndAt || "", row.rankingElapsedMilliseconds === null || row.rankingElapsedMilliseconds === undefined ? "" : displayDuration(row.rankingElapsedMilliseconds), row.rankingStartSource || "", row.overallRank ?? "", row.genderRank ?? "", row.ageGroupRank ?? "", row.timingPointName || ""] : []), row.volunteerName, row.volunteerId, resetOperationIds.has(row.id) || resetBikeOperationIds.has(row.id) ? "RESET" : row.status, row.id]);
    const csv = [header, ...body].map((record) => record.map((value) => csvCell(value)).join(",")).join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${kind === "timing" ? "manual-timing-log" : title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return <section className="admin-card volunteer-operation-log"><div className="admin-card-head"><div><h2>{title}</h2><p>{description}</p></div><div className="volunteer-log-head-actions"><span className="status-pill">{rows.length} records</span><button className="button button-secondary" type="button" disabled={!filtered.length} onClick={downloadList}><Download /> Download list</button></div></div><label className="volunteer-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search event, BIB, athlete or volunteer" /></label><div className="table-wrap"><table className={`leaderboard ${kind === "timing" ? "timing-operation-table" : ""}`}><thead><tr><th>TIME</th><th>EVENT</th><th>ACTION</th><th>BIB / ATHLETE</th>{kind === "timing" && <><th>ELAPSED TIME</th><th>OVERALL RANK</th><th>GENDER RANK</th><th>AGE CATEGORY RANK</th><th>TIMING POINT</th></>}<th>VOLUNTEER</th><th>STATUS</th>{(kind === "timing" || onBikeReset || onWaiverReset) && <th>ACTIONS</th>}</tr></thead><tbody>{filtered.map((row) => {
    const isReset = resetOperationIds.has(row.id);
    const isBikeReset = resetBikeOperationIds.has(row.id);
    const isWaiverReset = resetWaiverOperationIds.has(row.id);
    return <tr key={row.id}><td className="time">{displayDate(row.capturedAt)}</td><td>{row.eventName || row.eventId}</td><td>{row.action.replaceAll("_", " ")}</td><td><b>{row.bib || "—"}</b><small>{row.athleteName || row.participantUid}</small></td>{kind === "timing" && <><td className="time"><b>{displayDuration(row.rankingElapsedMilliseconds)}</b><small>{row.rankingStartSource === "CANONICAL" ? "Canonical start" : row.rankingStartSource === "SAVED_GUN" ? "Saved gun start" : "Start unavailable"}</small></td><td className="rank">{row.overallRank ? `#${row.overallRank}` : "—"}</td><td className="rank">{row.genderRank ? `#${row.genderRank}` : "—"}</td><td className="rank">{row.ageGroupRank ? `#${row.ageGroupRank}` : "—"}</td><td>{row.timingPointName || "—"}</td></>}<td>{row.volunteerName || row.volunteerId}</td><td><span className="status-pill">{isReset || isBikeReset || isWaiverReset ? "RESET" : row.status}</span></td>{kind === "timing" && <td><div className="volunteer-row-actions">{row.action === "MANUAL_TIMING_CAPTURED" && <button className="button button-secondary" type="button" disabled={busy || isReset} onClick={() => void onTimingAction?.(row, "reset")}><RotateCcw /> Reset</button>}<button className="button button-danger" type="button" disabled={busy} onClick={() => void onTimingAction?.(row, "delete")}><Trash2 /> Delete</button></div></td>}{onBikeReset && <td><div className="volunteer-row-actions"><button className="button button-secondary" type="button" disabled={busy || isBikeReset} onClick={() => void onBikeReset(row)}><RotateCcw /> {isBikeReset ? "Reset completed" : "Reset bike"}</button></div></td>}{onWaiverReset && <td><div className="volunteer-row-actions">{row.action === "WAIVER_VERIFY" ? <button className="button button-secondary" type="button" disabled={busy || isWaiverReset} onClick={() => void onWaiverReset(row)}><RotateCcw /> {isWaiverReset ? "Reset completed" : "Reset waiver"}</button> : <span>—</span>}</div></td>}</tr>;
  })}</tbody></table></div>{!filtered.length && <p className="admin-empty">No records are stored for this log yet.</p>}</section>;
}

function ActivityTable({ rows }: { rows: VolunteerActivity[] }) {
  return <section className="admin-card volunteer-operation-log"><div className="admin-card-head"><div><h2>Volunteer Activity</h2><p>Append-only history of profile, permission and race-day operations.</p></div><span className="status-pill">{rows.length} records</span></div><div className="table-wrap"><table className="leaderboard"><thead><tr><th>TIME</th><th>ACTION</th><th>VOLUNTEER</th><th>DETAIL</th><th>ACTOR</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td className="time">{displayDate(row.createdAt)}</td><td><span className={`status-pill ${row.severity === "warning" ? "status-provisional" : "status-official"}`}>{row.action.replaceAll("_", " ")}</span></td><td><b>{row.entity}</b></td><td>{row.detail}</td><td>{row.actor}</td></tr>)}</tbody></table></div>{!rows.length && <p className="admin-empty">No volunteer activity has been recorded.</p>}</section>;
}
