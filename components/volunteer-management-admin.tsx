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
import { normalizeVolunteerModules, volunteerAssignmentMatchesEvent } from "@/lib/volunteer-management";
import { bikeOperationResetIds } from "@/lib/volunteer-bike-log-state";
import { waiverOperationResetIds } from "@/lib/volunteer-waiver-log-state";
import type { VolunteerEventCheckInSummary } from "@/lib/volunteer-operations";
import type { VolunteerCustomCounter, VolunteerCustomCounterIssue } from "@/lib/volunteer-custom-counters";
import type { VolunteerPaidFoodCoupon } from "@/lib/volunteer-paid-food";
import {
  BadgeCheck, Bike, CheckCircle2, ClipboardCheck, Clock3, Download, MapPin, Pencil,
  Plus, QrCode, RotateCcw, Search, ShieldCheck, Trash2, UserCheck, UserRoundPlus, Users, Utensils, XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CounterNotificationSettings } from './counter-notification-settings';
import { BikeRackingAdmin } from './bike-racking-admin';
import { CateringAdmin } from './catering-admin-v2';

const tabs = [
  ["assignments", "Assignments", UserRoundPlus],
  ["custom-counters", "Custom Counters", Utensils],
  ["catering", "Catering / Food & Items", Utensils],
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
  ["food", "Legacy Food Log", Utensils],
  ["paid-food", "Paid Food", Utensils],
  ["activity", "Activity", ShieldCheck],
] as const;

const moduleLabels: Record<VolunteerModule, string> = {
  ATHLETE_LOOKUP: "Athlete Lookup",
  WAIVER_CHECK_IN: "Waiver & Athlete Band",
  ATHLETE_CHECK_IN: "Waiver & Athlete Band",
  BIKE_CHECK_IN: "Bike Check-In",
  BIKE_CHECK_OUT: "Bike Check-Out",
  MEDAL_COUNTER: "Finisher Medal / Goodies",
  FOOD_COUNTER: "Catering / Food & Items",
  PAID_FOOD_COUNTER: "Paid Food Redemption",
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
  FOOD_COUNTER: "Serve scheduled athlete and volunteer meals and configured items; view stock and serving logs.",
  PAID_FOOD_COUNTER: "Search and redeem purchased food coupons by code, order, mobile or email.",
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
type DraftAssignment = Pick<VolunteerAssignment, "id" | "eventId" | "modules" | "timingPointIds" | "customCounterIds" | "active">;
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
      customCounterIds: [...(assignment.customCounterIds ?? [])],
      active: assignment.active,
    })),
  };
}

function displayDate(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", hourCycle: "h23" }).format(parsed)
    : "—";
}

function displayDateOnly(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(parsed)
    : "—";
}

function displayStampTime(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3, hourCycle: "h23",
  }).formatToParts(parsed);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || "00";
  return `${part("hour")}:${part("minute")}:${part("second")}:${part("fractionalSecond")}`;
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

function formatInr(paisa: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format((Number.isFinite(paisa) ? paisa : 0) / 100);
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
  initialCustomCounters,
  initialCustomCounterIssues,
}: {
  initialVolunteers: VolunteerProfile[];
  events: VolunteerEventOption[];
  initialActivity: VolunteerActivity[];
  initialCheckIns: VolunteerOperationLog[];
  initialManualTiming: VolunteerOperationLog[];
  initialCustomCounters: VolunteerCustomCounter[];
  initialCustomCounterIssues: VolunteerCustomCounterIssue[];
}) {
  const [tab, setTab] = useState<Tab>("assignments");
  const [volunteers, setVolunteers] = useState(initialVolunteers);
  const [activity, setActivity] = useState(initialActivity);
  const [checkIns, setCheckIns] = useState(initialCheckIns);
  const [manualTiming, setManualTiming] = useState(initialManualTiming);
  const [customCounters, setCustomCounters] = useState(initialCustomCounters);
  const [customCounterIssues, setCustomCounterIssues] = useState(initialCustomCounterIssues);
  const [checkInSummaries, setCheckInSummaries] = useState<VolunteerEventCheckInSummary[] | null>(null);
  const [checkInSummaryLoading, setCheckInSummaryLoading] = useState(false);
  const [checkInSummaryError, setCheckInSummaryError] = useState("");
  const [draft, setDraft] = useState<DraftVolunteer>(emptyDraft());
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [statsLoading, setStatsLoading] = useState(true);

  const latestOperationEventId = useMemo(() => [...checkIns, ...manualTiming]
    .filter((row) => events.some((event) => event.id === row.eventId))
    .sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt))[0]?.eventId || events[0]?.id || "", [checkIns, events, manualTiming]);
  const [selectedEventId, setSelectedEventId] = useState(() => latestOperationEventId);
  const effectiveEventId = events.some((event) => event.id === selectedEventId) ? selectedEventId : latestOperationEventId;
  const selectedEvent = events.find((event) => event.id === effectiveEventId);

  const eventById = useMemo(() => new Map(events.map((event) => [event.id, event])), [events]);
  const filteredVolunteers = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return volunteers;
    return volunteers.filter((volunteer) => `${volunteer.name} ${volunteer.email} ${volunteer.mobile} ${volunteer.assignments.map((item) => item.eventName).join(" ")}`.toLowerCase().includes(term));
  }, [query, volunteers]);

  const eventVolunteers = useMemo(() => {
    if (!selectedEvent) return [];
    return volunteers.filter((volunteer) => volunteer.assignments.some((assignment) => volunteerAssignmentMatchesEvent(assignment, selectedEvent)));
  }, [selectedEvent, volunteers]);
  const stats = useMemo(() => ({
    active: eventVolunteers.filter((volunteer) => volunteer.status === "ACTIVE").length,
    assigned: eventVolunteers.filter((volunteer) => volunteer.status === "ACTIVE" && (selectedEvent ? volunteer.assignments.some((assignment) => volunteerAssignmentMatchesEvent(assignment, selectedEvent) && assignment.active) : false)).length,
    invited: eventVolunteers.filter((volunteer) => volunteer.status === "INVITED").length,
    disabled: eventVolunteers.filter((volunteer) => volunteer.status === "DISABLED").length,
    checkInAssignments: eventVolunteers.flatMap((volunteer) => volunteer.assignments).filter((assignment) => selectedEvent ? volunteerAssignmentMatchesEvent(assignment, selectedEvent) && assignment.active && (assignment.modules.includes("ATHLETE_CHECK_IN") || assignment.modules.includes("WAIVER_CHECK_IN")) : false).length,
    timingAssignments: eventVolunteers.flatMap((volunteer) => volunteer.assignments).filter((assignment) => selectedEvent ? volunteerAssignmentMatchesEvent(assignment, selectedEvent) && assignment.active && assignment.modules.includes("MANUAL_TIMING") : false).length,
  }), [eventVolunteers, selectedEvent]);

  const eventCheckIns = useMemo(() => checkIns.filter((row) => row.eventId === effectiveEventId), [checkIns, effectiveEventId]);
  const eventManualTiming = useMemo(() => manualTiming.filter((row) => row.eventId === effectiveEventId), [effectiveEventId, manualTiming]);
  const eventActivity = useMemo(() => activity.filter((row) => row.eventId === effectiveEventId), [activity, effectiveEventId]);

  const operationRows = useMemo(() => ({
    checkins: eventCheckIns.filter((row) => ["WAIVER_VERIFY", "CHECK_IN", "CHECK_IN_REVERSE", "ADMIN_WAIVER_CHECK_IN_RESET"].includes(row.action)),
    "bike-in": eventCheckIns.filter((row) => row.action === "BIKE_IN"),
    "bike-out": eventCheckIns.filter((row) => row.action === "BIKE_OUT"),
    medal: eventCheckIns.filter((row) => row.action === "MEDAL_ISSUE"),
    food: eventCheckIns.filter((row) => row.action === "FOOD_ISSUE"),
    locker: eventCheckIns.filter((row) => row.action === "LOCKER_ASSIGN"),
    "timing-chip": eventCheckIns.filter((row) => row.action === "TIMING_CHIP_ASSIGNED"),
    "athlete-band": eventCheckIns.filter((row) => row.action === "ATHLETE_BAND_ASSIGNED"),
    "volunteer-band": eventCheckIns.filter((row) => row.action === "VOLUNTEER_BAND_ASSIGNED"),
  }), [eventCheckIns]);
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
    timing: eventManualTiming.length,
    activity: eventActivity.length,
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
      customCounters: VolunteerCustomCounter[];
      customCounterIssues: VolunteerCustomCounterIssue[];
    }>;
    if (!response.ok || !body.ok) throw new Error(body.ok ? "Unable to refresh volunteer management." : body.error || "Unable to refresh volunteer management.");
    setVolunteers(body.data.volunteers);
    setActivity(body.data.activity);
    setCheckIns(body.data.checkIns);
    setManualTiming(body.data.manualTiming);
    setCustomCounters(body.data.customCounters);
    setCustomCounterIssues(body.data.customCounterIssues);
    setCheckInSummaries(null);
    if (tab === "checkins") void loadCheckInSummaries();
  }

  useEffect(() => {
    let active = true;
    void refresh()
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : "Unable to refresh volunteer statistics.");
      })
      .finally(() => {
        if (active) setStatsLoading(false);
      });
    return () => { active = false; };
    // The initial client reconciliation must run only once after hydration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        customCounterIds: [],
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

  async function deleteWaiverLogs(rows: VolunteerOperationLog[], clearAll: boolean) {
    if (!rows.length) return;
    const description = clearAll
      ? `all waiver and athlete check-in log records for ${rows[0]?.eventName || "the selected event"}`
      : rows.length === 1
        ? `the log record for BIB ${rows[0]?.bib || "—"}`
        : `${rows.length} filtered waiver log records`;
    if (!window.confirm(`Permanently delete ${description}? This cannot be undone and does not change the participant's current waiver or check-in state.`)) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/admin/volunteers/logs", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(clearAll
          ? { eventId: rows[0]?.eventId, actions: ["WAIVER_VERIFY", "CHECK_IN", "CHECK_IN_REVERSE", "ADMIN_WAIVER_CHECK_IN_RESET"] }
          : { ids: rows.map((row) => row.id) }),
      });
      const body = await response.json() as ApiResult<{ deletedCount: number }>;
      if (!response.ok || !body.ok) throw new Error(body.ok ? "Unable to delete volunteer logs." : body.error || "Unable to delete volunteer logs.");
      await refresh();
      setMessage(`${body.data.deletedCount} volunteer log record${body.data.deletedCount === 1 ? "" : "s"} permanently deleted.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to delete volunteer logs.");
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
        <div className="volunteer-stats-heading"><div><h2>Volunteer Stats</h2><p>All counters and operation logs are scoped to one event.</p></div><label className="volunteer-event-filter"><span>EVENT</span><select value={effectiveEventId} onChange={(event) => setSelectedEventId(event.target.value)}>{events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}</select></label></div>
        <div className="volunteer-stats-grid">
          <article><strong>{statsLoading ? "…" : eventVolunteers.length}</strong><span>Total Volunteers</span></article>
          <article className="volunteer-stat-assigned"><strong>{statsLoading ? "…" : stats.assigned}</strong><span>Active / Assigned</span></article>
          <article className="volunteer-stat-unassigned"><strong>{statsLoading ? "…" : Math.max(0, eventVolunteers.length - stats.assigned)}</strong><span>Unassigned</span></article>
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
                    <div className="field"><label>Event</label><select value={assignment.eventId} onChange={(event) => updateAssignment(index, { eventId: event.target.value, timingPointIds: [], customCounterIds: [] })}>{events.map((candidate) => <option key={candidate.id} value={candidate.id} disabled={draft.assignments.some((item, itemIndex) => itemIndex !== index && item.eventId === candidate.id)}>{candidate.name}</option>)}</select></div>
                    <label className="volunteer-active-check"><input type="checkbox" checked={assignment.active} onChange={(event) => updateAssignment(index, { active: event.target.checked })} /><span><b>Assignment active</b><small>Disable this event without removing its setup.</small></span></label>
                  </div>
                  <div className="volunteer-module-grid">
                    {(Object.keys(moduleLabels) as VolunteerModule[]).filter((module) => module !== "WAIVER_CHECK_IN").map((module) => <label key={module} className={assignment.modules.includes(module) ? "selected" : ""}><input type="checkbox" checked={assignment.modules.includes(module)} onChange={(event) => toggleModule(index, module, event.target.checked)} /><span><b>{moduleLabels[module]}</b><small>{moduleDescriptions[module]}</small></span></label>)}
                  </div>
                  {assignment.modules.includes("MANUAL_TIMING") && <div className="volunteer-timing-scope"><div><b>Allowed timing points</b><span>{assignment.timingPointIds.length ? `${assignment.timingPointIds.length} restricted point${assignment.timingPointIds.length === 1 ? "" : "s"}` : "Automatic finish assignment"}</span></div>{selectedEvent?.timingPoints.length ? <><div className="volunteer-point-grid">{selectedEvent.timingPoints.map((point) => <label key={point.id} className={assignment.timingPointIds.includes(point.id) ? "selected" : ""}><input type="checkbox" checked={assignment.timingPointIds.includes(point.id)} onChange={(event) => updateAssignment(index, { timingPointIds: event.target.checked ? [...assignment.timingPointIds, point.id] : assignment.timingPointIds.filter((id) => id !== point.id) })} /><span><b>{point.name}</b><small>{point.type} · {point.id}</small></span></label>)}</div>{!assignment.timingPointIds.length && <p className="admin-empty">Automatic mode is active. The configured FINISH point will be assigned to this volunteer automatically.</p>}</> : <p className="admin-empty">Manual Gun Finish is available now. When a FINISH timing point is configured in Live Tracking, this assignment will connect to it automatically.</p>}</div>}
                  {customCounters.some((counter) => counter.eventId === assignment.eventId && counter.active) && <div className="volunteer-timing-scope"><div><b>Custom counters</b><span>{assignment.customCounterIds.length ? `${assignment.customCounterIds.length} assigned` : "None assigned"}</span></div><div className="volunteer-point-grid">{customCounters.filter((counter) => counter.eventId === assignment.eventId && counter.active).map((counter) => <label key={counter.id} className={assignment.customCounterIds.includes(counter.id) ? "selected" : ""}><input type="checkbox" checked={assignment.customCounterIds.includes(counter.id)} onChange={(event) => {
                    const customCounterIds = event.target.checked ? [...assignment.customCounterIds, counter.id] : assignment.customCounterIds.filter((id) => id !== counter.id);
                    const modules = customCounterIds.length ? [...new Set([...assignment.modules, "COUNTER" as VolunteerModule])] : assignment.modules;
                    updateAssignment(index, { customCounterIds, modules });
                  }} /><span><b>{counter.name}</b><small>{counter.itemName} · maximum {counter.maxPerParticipant} per athlete</small></span></label>)}</div></div>}
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

      {tab === "checkins" && <><CheckInSummary summaries={checkInSummaries} eventId={effectiveEventId} eventName={selectedEvent?.name || "Selected event"} loading={checkInSummaryLoading} error={checkInSummaryError} onRetry={() => void loadCheckInSummaries()} /><OperationTable title="Athlete & Waiver Check-In Log" description="Athlete check-in, waiver verification and administrator reset actions." rows={operationRows.checkins} kind="checkin" busy={busy} resetWaiverOperationIds={resetWaiverOperationIds} onWaiverReset={resetWaiverCheckIn} onDeleteRows={deleteWaiverLogs} /></>}
      {tab === "bike-racking" && <BikeRackingAdmin events={events} />}
      {tab === "bike-in" && <OperationTable title="Bike-in Log" description="Bike entry, helmet verification and rack-assignment actions." rows={operationRows["bike-in"]} kind="checkin" busy={busy} resetBikeOperationIds={resetBikeOperationIds} onBikeReset={resetBikeCheckIn} />}
      {tab === "bike-out" && <><BikeCheckoutSummary rows={operationRows["bike-out"]} resetBikeOperationIds={resetBikeOperationIds} /><OperationTable title="Bike-out Log" description="Secure bike collection, timing-chip return, and checkout audit actions." rows={operationRows["bike-out"]} kind="checkin" busy={busy} resetBikeOperationIds={resetBikeOperationIds} onBikeReset={resetBikeCheckIn} /></>}
      {tab === "medal" && <OperationTable title="Finisher Items Log" description="Finisher medals and goodies recorded by assigned volunteers." rows={operationRows.medal} kind="checkin" />}
      {tab === "food" && <OperationTable title="Food Counter Log" description="Legacy food issuance recorded by assigned volunteers. Scheduled catering uses its own serving log." rows={operationRows.food} kind="checkin" />}
      {tab === "catering" && <CateringAdmin key={effectiveEventId} eventId={effectiveEventId} eventName={selectedEvent?.name || "Selected event"} categories={selectedEvent?.categories ?? []} events={events} onEventChange={setSelectedEventId} />}
      {tab === "paid-food" && <PaidFoodPanel key={effectiveEventId} eventId={effectiveEventId} eventName={selectedEvent?.name || "Selected event"} />}
      {tab === "locker" && <OperationTable title="Locker Counter Log" description="Locker assignments recorded by assigned volunteers." rows={operationRows.locker} kind="checkin" />}
      {tab === "timing-chip" && <OperationTable title="Timing Chip Assignment Log" description="Event timing-chip assignments and replacements." rows={operationRows["timing-chip"]} kind="checkin" />}
      {tab === "athlete-band" && <OperationTable title="Athlete Band Assignment Log" description="Event athlete-band assignments and replacements." rows={operationRows["athlete-band"]} kind="checkin" />}
      {tab === "volunteer-band" && <OperationTable title="Volunteer Band Assignment Log" description="Event-scoped volunteer-band assignments and replacements." rows={operationRows["volunteer-band"]} kind="checkin" />}
      {tab === "timing" && <OperationTable title="Manual Timing Log" description="Event-specific device captures, assigned points, rankings and synchronization status." rows={eventManualTiming} kind="timing" busy={busy} onTimingAction={manageManualTiming} />}
      {tab === "activity" && <ActivityTable rows={eventActivity} />}
      {tab === "notifications" && <CounterNotificationSettings events={events} />}
      {tab === "custom-counters" && <CustomCountersPanel events={events} eventId={effectiveEventId} onEventChange={setSelectedEventId} counters={customCounters} issues={customCounterIssues} busy={busy} setBusy={setBusy} onRefresh={refresh} setMessage={setMessage} setError={setError} />}
    </div>
  );
}

function CustomCountersPanel({ events, eventId, onEventChange, counters, issues, busy, setBusy, onRefresh, setMessage, setError }: {
  events: VolunteerEventOption[];
  eventId: string;
  onEventChange: (eventId: string) => void;
  counters: VolunteerCustomCounter[];
  issues: VolunteerCustomCounterIssue[];
  busy: boolean;
  setBusy: (value: boolean) => void;
  onRefresh: () => Promise<void>;
  setMessage: (value: string) => void;
  setError: (value: string) => void;
}) {
  const [editingId, setEditingId] = useState("");
  const [name, setName] = useState("");
  const [itemName, setItemName] = useState("");
  const [actionLabel, setActionLabel] = useState("Issue");
  const [categories, setCategories] = useState("");
  const [unit, setUnit] = useState<VolunteerCustomCounter["inventoryUnit"]>("piece");
  const [unitLabel, setUnitLabel] = useState("piece");
  const [totalInventoryQuantity, setTotalInventoryQuantity] = useState("");
  const [totalServings, setTotalServings] = useState("");
  const [quantityPerServing, setQuantityPerServing] = useState("1");
  const [purchaseRateRupees, setPurchaseRateRupees] = useState("");
  const [maxPerParticipant, setMaxPerParticipant] = useState("1");
  const [active, setActive] = useState(true);
  const [volunteersEligible, setVolunteersEligible] = useState(false);
  const eventCounters = counters.filter((counter) => counter.eventId === eventId);
  const resetIds = new Set(issues.filter((row) => row.status === "RESET" && row.reversesIssueId).map((row) => row.reversesIssueId));
  const eventIssues = issues.filter((row) => row.eventId === eventId && row.status === "ISSUED");

  function clear() {
    setEditingId(""); setName(""); setItemName(""); setActionLabel("Issue"); setCategories(""); setUnit("piece"); setUnitLabel("piece"); setTotalInventoryQuantity(""); setTotalServings(""); setQuantityPerServing("1"); setPurchaseRateRupees(""); setMaxPerParticipant("1"); setActive(true); setVolunteersEligible(false);
  }

  function edit(counter: VolunteerCustomCounter) {
    setEditingId(counter.id); onEventChange(counter.eventId); setName(counter.name); setItemName(counter.itemName); setActionLabel(counter.actionLabel); setCategories(counter.applicableCategories.join(", ")); setUnit(counter.inventoryUnit); setUnitLabel(counter.unitLabel); setTotalInventoryQuantity(counter.totalInventoryQuantity === null ? "" : String(counter.totalInventoryQuantity)); setTotalServings(counter.totalServings === null ? "" : String(counter.totalServings)); setQuantityPerServing(String(counter.quantityPerServing)); setPurchaseRateRupees(String((counter.purchaseRatePaisaPerUnit || 0) / 100)); setMaxPerParticipant(String(counter.maxPerParticipant)); setActive(counter.active); setVolunteersEligible(counter.volunteersEligible);
  }

  async function saveCounter(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage(""); setError("");
    try {
      const response = await fetch("/api/admin/volunteers/custom-counters", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        ...(editingId ? { id: editingId } : {}), eventId, name, itemName, actionLabel, active, volunteersEligible,
        applicableCategories: categories.split(",").map((value) => value.trim()).filter(Boolean), inventoryUnit: unit, unitLabel,
        totalInventoryQuantity: totalInventoryQuantity ? Number(totalInventoryQuantity) : null, totalServings: totalServings ? Number(totalServings) : null,
        purchaseRatePaisaPerUnit: Math.round((Number(purchaseRateRupees) || 0) * 100),
        quantityPerServing: Number(quantityPerServing) || 1, maxPerParticipant: Number(maxPerParticipant) || 1,
      }) });
      const body = await response.json() as ApiResult<VolunteerCustomCounter>;
      if (!response.ok || !body.ok) throw new Error(body.ok ? "Unable to save custom counter." : body.error || "Unable to save custom counter.");
      await onRefresh(); clear(); setMessage(`${body.data.name} custom counter saved.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to save custom counter."); }
    finally { setBusy(false); }
  }

  async function resetIssue(issue: VolunteerCustomCounterIssue) {
    if (!window.confirm(`Reset ${issue.athleteName} · BIB ${issue.bib || "—"}? The issue remains in the audit log.`)) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin/volunteers/custom-counters", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ issueId: issue.id }) });
      const body = await response.json() as ApiResult<unknown>;
      if (!response.ok || !body.ok) throw new Error(body.ok ? "Unable to reset issue." : body.error || "Unable to reset issue.");
      await onRefresh(); setMessage("Custom counter issue reset. Original audit record preserved.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to reset issue."); }
    finally { setBusy(false); }
  }

  return <>
    <section className="admin-card"><div className="admin-card-head"><div><h2>Custom Counters</h2><p>Create event-specific service, catering or fulfilment counters and assign them to selected volunteers.</p></div><span className="status-pill">{eventCounters.length} counters</span></div>
      <form onSubmit={saveCounter}><div className="form-grid">
        <div className="field"><label>Event</label><select value={eventId} disabled={Boolean(editingId)} onChange={(event) => { clear(); onEventChange(event.target.value); }}>{events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}</select></div>
        <div className="field"><label>Counter name</label><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Hydration Counter" required /></div>
        <div className="field"><label>Item / action</label><input value={itemName} onChange={(event) => setItemName(event.target.value)} placeholder="Water bottle" required /></div>
        <div className="field"><label>Volunteer button label</label><input value={actionLabel} onChange={(event) => setActionLabel(event.target.value)} placeholder="Issue water" required /></div>
        <div className="field"><label>Applicable categories</label><input value={categories} onChange={(event) => setCategories(event.target.value)} placeholder="Blank = all; or Sprint, Olympic" /><small>Comma-separated exact event ticket/category names.</small></div>
        <div className="field"><label>Inventory unit</label><select value={unit} onChange={(event) => { const value = event.target.value as VolunteerCustomCounter["inventoryUnit"]; setUnit(value); setUnitLabel(value); }}><option value="piece">Piece</option><option value="packet">Packet</option><option value="litre">Litre</option><option value="kilogram">Kilogram</option><option value="custom">Custom</option></select></div>
        <div className="field"><label>Unit label</label><input value={unitLabel} onChange={(event) => setUnitLabel(event.target.value)} required /></div>
        <div className="field"><label>Total inventory (optional)</label><input type="number" min="0" step="0.001" value={totalInventoryQuantity} onChange={(event) => setTotalInventoryQuantity(event.target.value)} /><small>Physical stock in {unitLabel || unit}.</small></div>
        <div className="field"><label>Total servings (optional)</label><input type="number" min="0" step="1" value={totalServings} onChange={(event) => setTotalServings(event.target.value)} /></div>
        <div className="field"><label>Quantity per serving</label><input type="number" min="0.001" step="0.001" value={quantityPerServing} onChange={(event) => setQuantityPerServing(event.target.value)} required /></div>
        <div className="field"><label>Purchase rate (₹ per {unitLabel || unit})</label><input type="number" min="0" step="0.01" value={purchaseRateRupees} onChange={(event) => setPurchaseRateRupees(event.target.value)} /></div>
        <div className="field"><label>Maximum per athlete</label><input type="number" min="1" max="100" step="1" value={maxPerParticipant} onChange={(event) => setMaxPerParticipant(event.target.value)} required /></div>
        <label className="volunteer-active-check"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /><span><b>Counter active</b><small>Inactive counters are hidden from volunteers.</small></span></label>
      </div><div className="form-actions"><button className="button button-secondary" type="button" onClick={clear}>Clear</button><button className="button button-primary" disabled={busy} type="submit">{busy ? "Saving…" : editingId ? "Update counter" : "Create counter"}</button></div></form>
    </section>
    <section className="admin-card volunteer-operation-log"><div className="admin-card-head"><div><h2>Configured counters</h2><p>{events.find((event) => event.id === eventId)?.name || "Selected event"} · issue totals exclude reset records.</p></div><button className="button button-secondary" type="button" disabled={busy} onClick={() => void onRefresh()}><RotateCcw /> Refresh</button></div><div className="table-wrap"><table className="leaderboard"><thead><tr><th>COUNTER</th><th>ITEM</th><th>ELIGIBILITY</th><th>ISSUED</th><th>REMAINING</th><th>INVENTORY / COST</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>{eventCounters.map((counter) => { const activeIssues = eventIssues.filter((row) => row.counterId === counter.id && !resetIds.has(row.id)); const issued = activeIssues.length; const consumed = activeIssues.reduce((sum, row) => sum + row.quantity, 0); const inventoryRemaining = counter.totalInventoryQuantity === null ? null : Math.max(0, counter.totalInventoryQuantity - consumed); const totalCost = counter.totalInventoryQuantity === null ? 0 : counter.totalInventoryQuantity * counter.purchaseRatePaisaPerUnit; const consumedCost = consumed * counter.purchaseRatePaisaPerUnit; return <tr key={counter.id}><td><b>{counter.name}</b></td><td>{counter.itemName}<small>{counter.quantityPerServing} {counter.unitLabel} per serving</small></td><td>{counter.applicableCategories.length ? counter.applicableCategories.join(", ") : "All athletes"}<small>{counter.volunteersEligible ? "Athletes + volunteer bands" : "Athletes only"}</small></td><td>{issued}</td><td>{counter.totalServings === null ? "Unlimited" : Math.max(0, counter.totalServings - issued)}</td><td>{inventoryRemaining === null ? "Not tracked" : `${inventoryRemaining} ${counter.unitLabel}`}<small>{counter.purchaseRatePaisaPerUnit ? `${formatInr(consumedCost)} used · ${formatInr(Math.max(0, totalCost - consumedCost))} left` : "No purchase rate"}</small></td><td><span className="status-pill">{counter.active ? "ACTIVE" : "INACTIVE"}</span></td><td><button className="button button-secondary" type="button" onClick={() => edit(counter)}><Pencil /> Edit</button></td></tr>; })}</tbody></table></div>{!eventCounters.length && <p className="admin-empty">No custom counters exist for {events.find((event) => event.id === eventId)?.name || "this event"}.</p>}</section>
    <section className="admin-card volunteer-operation-log"><div className="admin-card-head"><div><h2>Recent custom-counter issues</h2><p>Every issue and administrative reset remains auditable.</p></div><span className="status-pill">{eventIssues.length} issues</span></div><div className="table-wrap"><table className="leaderboard"><thead><tr><th>TIME</th><th>COUNTER</th><th>BIB / ATHLETE</th><th>VOLUNTEER</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>{eventIssues.slice(0, 100).map((issue) => <tr key={issue.id}><td>{displayDate(issue.capturedAt)}</td><td>{counters.find((counter) => counter.id === issue.counterId)?.name || issue.counterId}</td><td><b>{issue.bib || "—"}</b><small>{issue.athleteName}</small></td><td>{issue.volunteerName}</td><td><span className="status-pill">{resetIds.has(issue.id) ? "RESET" : "ISSUED"}</span></td><td><button className="button button-secondary" type="button" disabled={busy || resetIds.has(issue.id)} onClick={() => void resetIssue(issue)}><RotateCcw /> Reset</button></td></tr>)}</tbody></table></div>{!eventIssues.length && <p className="admin-empty">No custom-counter issues recorded yet.</p>}</section>
  </>;
}

function PaidFoodPanel({ eventId, eventName }: { eventId: string; eventName: string }) {
  const [coupons, setCoupons] = useState<VolunteerPaidFoodCoupon[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [orderId, setOrderId] = useState("");
  const [code, setCode] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [buyerMobile, setBuyerMobile] = useState("");
  const [itemName, setItemName] = useState("");
  const [amount, setAmount] = useState("");

  async function load(search = query) {
    if (!eventId) return;
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/admin/volunteers/paid-food?eventId=${encodeURIComponent(eventId)}&query=${encodeURIComponent(search.trim())}`, { cache: "no-store" });
      const body = await response.json() as ApiResult<VolunteerPaidFoodCoupon[]>;
      if (!response.ok || !body.ok) throw new Error(body.ok ? "Unable to load coupons." : body.error || "Unable to load coupons.");
      setCoupons(body.data);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load paid-food coupons."); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    let active = true;
    void fetch(`/api/admin/volunteers/paid-food?eventId=${encodeURIComponent(eventId)}&query=`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as ApiResult<VolunteerPaidFoodCoupon[]>;
        if (!response.ok || !body.ok) throw new Error(body.ok ? "Unable to load coupons." : body.error || "Unable to load coupons.");
        if (active) setCoupons(body.data);
      })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Unable to load paid-food coupons."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [eventId]);

  async function createCoupon(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/volunteers/paid-food", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ eventId, orderId, ...(code.trim() ? { code } : {}), buyerName, buyerEmail, buyerMobile, itemName, amountPaisa: Math.round((Number(amount) || 0) * 100) }) });
      const body = await response.json() as ApiResult<VolunteerPaidFoodCoupon>;
      if (!response.ok || !body.ok) throw new Error(body.ok ? "Unable to create coupon." : body.error || "Unable to create coupon.");
      setOrderId(""); setCode(""); setBuyerName(""); setBuyerEmail(""); setBuyerMobile(""); setItemName(""); setAmount("");
      setMessage(`Coupon ${body.data.code} created for ${body.data.buyerName}.`); await load("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to create paid-food coupon."); }
    finally { setSaving(false); }
  }

  const issued = coupons.filter((coupon) => coupon.status === "ISSUED").length;
  const redeemed = coupons.filter((coupon) => coupon.status === "REDEEMED").length;
  return <>
    <section className="admin-card"><div className="admin-card-head"><div><h2>Paid Food Coupons</h2><p>{eventName} · create coupons from confirmed paid orders, then assign the Paid Food Redemption role to volunteers.</p></div><span className="status-pill">{coupons.length} coupons</span></div>
      {message && <div className="success-banner">{message}</div>}{error && <div className="error-banner">{error}</div>}
      <form onSubmit={createCoupon}><div className="form-grid">
        <div className="field"><label>Order ID</label><input value={orderId} onChange={(event) => setOrderId(event.target.value)} required /></div>
        <div className="field"><label>Coupon code (optional)</label><input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="Auto-generate 6 digits" /></div>
        <div className="field"><label>Buyer name</label><input value={buyerName} onChange={(event) => setBuyerName(event.target.value)} required /></div>
        <div className="field"><label>Email</label><input type="email" value={buyerEmail} onChange={(event) => setBuyerEmail(event.target.value)} /></div>
        <div className="field"><label>Mobile</label><input value={buyerMobile} onChange={(event) => setBuyerMobile(event.target.value)} /></div>
        <div className="field"><label>Purchased item</label><input value={itemName} onChange={(event) => setItemName(event.target.value)} required /></div>
        <div className="field"><label>Amount paid (₹)</label><input type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></div>
      </div><div className="form-actions"><button className="button button-primary" type="submit" disabled={saving}>{saving ? "Creating…" : "Create paid-food coupon"}</button></div></form>
    </section>
    <section className="admin-card volunteer-operation-log"><div className="admin-card-head"><div><h2>Paid Food Redemption</h2><p>Search by coupon, order ID, name, email, mobile or item.</p></div><div className="volunteer-log-head-actions"><span className="status-pill">{issued} available · {redeemed} redeemed</span><button className="button button-secondary" type="button" disabled={loading} onClick={() => void load()}><RotateCcw /> Refresh</button></div></div>
      <form className="volunteer-search" onSubmit={(event) => { event.preventDefault(); void load(); }}><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Coupon, order, mobile, email or buyer" /></form>
      <div className="table-wrap"><table className="leaderboard"><thead><tr><th>COUPON</th><th>ORDER</th><th>BUYER</th><th>ITEM</th><th>AMOUNT</th><th>STATUS</th><th>REDEEMED</th></tr></thead><tbody>{coupons.map((coupon) => <tr key={`${coupon.eventId}:${coupon.code}`}><td><b>{coupon.code}</b></td><td>{coupon.orderId}</td><td>{coupon.buyerName}<small>{coupon.buyerMobile || coupon.buyerEmail || "—"}</small></td><td>{coupon.itemName}</td><td>{formatInr(coupon.amountPaisa)}</td><td><span className="status-pill">{coupon.status}</span></td><td>{displayDate(coupon.redeemedAt)}<small>{coupon.redeemedByName || "—"}</small></td></tr>)}</tbody></table></div>
      {!loading && !coupons.length && <p className="admin-empty">No paid-food coupons exist for {eventName}.</p>}
    </section>
  </>;
}

function CheckInSummary({ summaries, eventId, eventName, loading, error, onRetry }: { summaries: VolunteerEventCheckInSummary[] | null; eventId: string; eventName: string; loading: boolean; error: string; onRetry: () => void }) {
  if (!summaries) return <section className="admin-card" role={error ? "alert" : "status"}>
    <div className="admin-card-head"><div><h2>Check-in totals {loading ? "loading…" : "unavailable"}</h2><p>{error || "Loading the assigned-event rosters and current check-in states."}</p></div>
      {!loading && <button className="button" type="button" onClick={onRetry}><RotateCcw /> Retry totals</button>}</div>
  </section>;
  const eventSummaries = summaries.filter((summary) => summary.eventId === eventId);
  const totals = eventSummaries.reduce((result, summary) => ({
    total: result.total + summary.totalAthletes,
    checkedIn: result.checkedIn + summary.checkedInAthletes,
    remaining: result.remaining + summary.remainingAthletes,
  }), { total: 0, checkedIn: 0, remaining: 0 });
  return <>
    <div className="admin-kpis volunteer-kpis">
      <article className="kpi-card"><Users /><span>Total athletes</span><strong>{totals.total}</strong><small>{eventName}</small></article>
      <article className="kpi-card"><CheckCircle2 /><span>Checked-in athletes</span><strong>{totals.checkedIn}</strong><small>Current stored check-in state</small></article>
      <article className="kpi-card"><Clock3 /><span>Remaining to check in</span><strong>{totals.remaining}</strong><small>{totals.total ? `${Math.round((totals.checkedIn / totals.total) * 100)}% completed` : "No roster athletes"}</small></article>
    </div>
    {eventSummaries.length > 0 && <section className="admin-card volunteer-operation-log"><div className="admin-card-head"><div><h2>Event Check-In Totals</h2><p>Roster-backed progress for {eventName}.</p></div></div><div className="table-wrap"><table className="leaderboard"><thead><tr><th>EVENT</th><th>TOTAL ATHLETES</th><th>CHECKED IN</th><th>REMAINING</th></tr></thead><tbody>{eventSummaries.map((summary) => <tr key={summary.eventId}><td><b>{summary.eventName}</b></td><td>{summary.totalAthletes}</td><td>{summary.checkedInAthletes}</td><td>{summary.remainingAthletes}</td></tr>)}</tbody></table></div></section>}
  </>;
}

function BikeCheckoutSummary({ rows, resetBikeOperationIds }: { rows: VolunteerOperationLog[]; resetBikeOperationIds: ReadonlySet<string> }) {
  const active = rows.filter((row) => !resetBikeOperationIds.has(row.id));
  return <section className="admin-card volunteer-operation-log"><div className="admin-card-head"><div><h2>Bike Checkout & Chip Return</h2><p>Server-confirmed return status. Returned chips remain assigned until inventory reconciliation.</p></div></div><div className="admin-kpis volunteer-kpis"><article className="kpi-card"><span>Bikes checked out</span><strong>{active.length}</strong></article><article className="kpi-card"><span>Chips expected</span><strong>{active.filter((row) => row.assignedChipCode).length}</strong></article><article className="kpi-card"><span>Chips returned</span><strong>{active.filter((row) => row.chipReturnStatus === "RETURNED").length}</strong></article><article className="kpi-card"><span>Not returned</span><strong>{active.filter((row) => row.chipReturnStatus === "NOT_RETURNED").length}</strong></article><article className="kpi-card"><span>No chip assigned</span><strong>{active.filter((row) => row.chipReturnStatus === "NO_CHIP_ASSIGNED").length}</strong></article></div><div className="table-wrap"><table className="leaderboard"><thead><tr><th>BIB</th><th>ATHLETE</th><th>ASSIGNED CHIP</th><th>RETURNED CHIP</th><th>CHIP STATUS</th><th>BIKE CHECKOUT</th></tr></thead><tbody>{active.map((row) => <tr key={row.id}><td>{row.bib || "—"}</td><td>{row.athleteName || row.participantUid}</td><td>{row.assignedChipCode || "N/A"}</td><td>{row.returnedChipCode || "N/A"}</td><td><span className="status-pill">{row.chipReturnStatus?.replaceAll("_", " ") || "PENDING RETURN"}</span></td><td>Completed</td></tr>)}</tbody></table></div>{!active.length && <p className="admin-empty">No bike checkout records exist for this event.</p>}</section>;
}

function OperationTable({ title, description, rows, kind, busy = false, resetBikeOperationIds = new Set<string>(), resetWaiverOperationIds = new Set<string>(), onBikeReset, onWaiverReset, onTimingAction, onDeleteRows }: {
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
  onDeleteRows?: (rows: VolunteerOperationLog[], clearAll: boolean) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const eventRows = rows;
  const filtered = eventRows.filter((row) => `${row.eventName} ${row.bib} ${row.athleteName} ${row.volunteerName} ${row.status} ${row.timingPointName || ""}`.toLowerCase().includes(query.toLowerCase()));
  const resetOperationIds = new Set(rows
    .filter((row) => row.action === "MANUAL_TIMING_RESET" && row.reversesOperationId)
    .map((row) => row.reversesOperationId));
  const isBikeCheckout = rows.some((row) => row.action === "BIKE_OUT") || /bike check-out/i.test(title);

  async function downloadList() {
    if (kind === "timing") {
      const XLSX = await import("xlsx");
      const activeRows = filtered.filter((row) => row.action === "MANUAL_TIMING_CAPTURED" && !resetOperationIds.has(row.id));
      const workbook = XLSX.utils.book_new();
      const eventNames = [...new Set(activeRows.map((row) => row.eventName || row.eventId))];
      const summary = XLSX.utils.aoa_to_sheet([["Time Keeper Results"], [], ["Event", eventNames.length === 1 ? eventNames[0] : `${eventNames.length} events`], ["Generated At", new Date()], ["Ranked Finishers", activeRows.filter((row) => row.overallRank).length], [], ["Ranking Basis", "Elapsed time from canonical chip/wave start where available; saved gun start is the fallback."], ["GUN Fallback", "Rows using a saved gun start remain explicitly marked and auditable."], ["Age Group Rank Basis", "Event contest, timing point and uploaded participant age group."], ["Important", "Device capture, server receipt, clock skew and reset records remain in Audit Log."]]);
      summary["!cols"] = [{ wch: 24 }, { wch: 105 }];
      const headers = ["Overall Rank", "Gender Rank", "Category Rank", "Age Group Rank", "BIB", "Athlete Name", "Gender", "Category", "Age Group", "Configured Start Mode", "Used Start Mode", "Start Source", "Start Verification", "Start Timestamp", "Device Finish Timestamp", "Server Received Timestamp", "Elapsed Time", "Clock Skew (ms)", "Clock Warning", "Recorded By", "Recorded By Email", "Device Time Zone"];
      const rowValues = (row: VolunteerOperationLog) => [row.overallRank ?? "", row.genderRank ?? "", row.categoryRank ?? row.overallRank ?? "", row.ageGroupRank ?? "", row.bib, row.athleteName, row.gender || "", row.category || "", row.ageGroup || "", row.configuredStartMode || "", row.rankingStartSource === "CANONICAL" ? "CHIP / WAVE" : row.rankingStartSource === "SAVED_GUN" ? "GUN" : "", row.rankingStartSource || "", row.startVerification || "", row.rankingStartAt ? new Date(row.rankingStartAt) : "", new Date(row.capturedAt), row.serverReceivedAt ? new Date(row.serverReceivedAt) : "", row.rankingElapsedMilliseconds === null || row.rankingElapsedMilliseconds === undefined ? "" : row.rankingElapsedMilliseconds / 86_400_000, row.clockSkewMilliseconds ?? "", row.clockWarning || "", row.volunteerName, row.volunteerEmail || "", row.deviceTimeZone || ""];
      const activeSheet = XLSX.utils.aoa_to_sheet([headers, ...activeRows.map(rowValues)]);
      const auditSheet = XLSX.utils.aoa_to_sheet([["Record ID", "Action", "Status", "Reverses Record", "Event", ...headers], ...filtered.map((row) => [row.id, row.action, resetOperationIds.has(row.id) ? "RESET" : row.status, row.reversesOperationId || "", row.eventName || row.eventId, ...rowValues(row)])]);
      const widths = [13, 13, 14, 16, 12, 28, 12, 28, 16, 20, 16, 24, 72, 24, 24, 24, 16, 16, 28, 24, 28, 22].map((wch) => ({ wch }));
      activeSheet["!cols"] = widths; activeSheet["!autofilter"] = { ref: `A1:V${Math.max(1, activeRows.length + 1)}` };
      auditSheet["!cols"] = [{ wch: 38 }, { wch: 24 }, { wch: 24 }, { wch: 38 }, { wch: 28 }, ...widths]; auditSheet["!autofilter"] = { ref: `A1:AA${Math.max(1, filtered.length + 1)}` };
      for (const [sheet, offset] of [[activeSheet, 0], [auditSheet, 5]] as const) {
        const range = XLSX.utils.decode_range(sheet["!ref"] || "A1:A1");
        for (let row = 1; row <= range.e.r; row += 1) {
          const bibCell = sheet[XLSX.utils.encode_cell({ r: row, c: offset + 4 })]; if (bibCell) bibCell.z = "@";
          for (const column of [offset + 13, offset + 14, offset + 15]) { const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })]; if (cell?.t === "d") cell.z = "yyyy-mm-dd hh:mm:ss.000"; }
          const elapsedCell = sheet[XLSX.utils.encode_cell({ r: row, c: offset + 16 })]; if (elapsedCell?.t === "n") elapsedCell.z = "[h]:mm:ss.00";
        }
      }
      XLSX.utils.book_append_sheet(workbook, summary, "Summary");
      XLSX.utils.book_append_sheet(workbook, activeSheet, "Active Results");
      XLSX.utils.book_append_sheet(workbook, auditSheet, "Audit Log");
      const eventFileName = eventNames.length === 1 ? eventNames[0].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : "all-events";
      XLSX.writeFile(workbook, `time-keeper-${eventFileName || "event"}-ranked-results.xlsx`, { cellDates: true });
      return;
    }
    const header = ["Time", "Event", "Event ID", "Action", "BIB", "Athlete", "Participant ID", ...(isBikeCheckout ? ["Assigned Chip", "Returned Chip", "Chip Return Status", "Return Method", "Return Reason", "Bike Checkout Transaction ID"] : []), "Volunteer", "Volunteer ID", "Status", "Record ID"];
    const body = filtered.map((row) => [row.capturedAt, row.eventName, row.eventId, row.action, row.bib, row.athleteName, row.participantUid, ...(isBikeCheckout ? [row.assignedChipCode || "N/A", row.returnedChipCode || "N/A", row.chipReturnStatus || "PENDING_RETURN", row.chipReturnMethod || "", row.chipReturnReason || "", row.bikeCheckoutTransactionId || ""] : []), row.volunteerName, row.volunteerId, resetOperationIds.has(row.id) || resetBikeOperationIds.has(row.id) ? "RESET" : row.status, row.id]);
    const csv = [header, ...body].map((record) => record.map((value) => csvCell(value)).join(",")).join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return <section className="admin-card volunteer-operation-log"><div className="admin-card-head"><div><h2>{title}</h2><p>{description}</p></div><div className="volunteer-log-head-actions"><span className="status-pill">{eventRows.length} records</span><button className="button button-secondary" type="button" disabled={!filtered.length} onClick={() => void downloadList()}><Download /> {kind === "timing" ? "Download Ranked Excel" : "Download list"}</button>{onDeleteRows && <button className="button button-danger" type="button" disabled={busy || !filtered.length} onClick={() => void onDeleteRows(filtered, !query.trim())}><Trash2 /> {query.trim() ? `Clear filtered (${filtered.length})` : "Clear event logs"}</button>}</div></div><label className="volunteer-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={kind === "timing" ? "Search BIB, athlete, volunteer or timing point" : "Search BIB, athlete or volunteer"} /></label><div className="table-wrap"><table className={`leaderboard ${kind === "timing" ? "timing-operation-table" : ""}`}><thead><tr>{kind === "timing" ? <><th>DATE</th><th>STAMP TIME</th></> : <th>TIME</th>}<th>EVENT</th><th>ACTION</th><th>BIB / ATHLETE</th>{kind === "timing" && <><th>CANONICAL CHIP TIME</th><th>CANONICAL GUN TIME</th><th>OVERALL RANK</th><th>GENDER RANK</th><th>AGE CATEGORY RANK</th><th>TIMING POINT</th></>}<th>VOLUNTEER</th><th>STATUS</th>{(kind === "timing" || onBikeReset || onWaiverReset || onDeleteRows) && <th>ACTIONS</th>}</tr></thead><tbody>{filtered.map((row) => {
    const isReset = resetOperationIds.has(row.id);
    const isBikeReset = resetBikeOperationIds.has(row.id);
    const isWaiverReset = resetWaiverOperationIds.has(row.id);
    return <tr key={row.id}>{kind === "timing" ? <><td className="time">{displayDateOnly(row.capturedAt)}</td><td className="time">{displayStampTime(row.capturedAt)}<small>Manual device stamp</small></td></> : <td className="time">{displayDate(row.capturedAt)}</td>}<td>{row.eventName || row.eventId}</td><td>{row.action.replaceAll("_", " ")}</td><td><b>{row.bib || "—"}</b><small>{row.athleteName || row.participantUid}</small></td>{kind === "timing" && <><td className="time"><b>{displayDuration(row.rankingChipElapsedMilliseconds)}</b><small>{row.rankingChipElapsedMilliseconds == null ? "No canonical result" : "Feibot canonical"}</small></td><td className="time"><b>{displayDuration(row.rankingGunElapsedMilliseconds)}</b><small>{row.rankingGunElapsedMilliseconds == null ? "No canonical result" : "Feibot canonical"}</small></td><td className="rank">{row.overallRank ? `#${row.overallRank}` : "—"}</td><td className="rank">{row.genderRank ? `#${row.genderRank}` : "—"}</td><td className="rank">{row.ageGroupRank ? `#${row.ageGroupRank}` : "—"}</td><td>{row.timingPointName || "—"}</td></>}<td>{row.volunteerName || row.volunteerId}</td><td><span className="status-pill">{isReset || isBikeReset || isWaiverReset ? "RESET" : row.status}</span></td>{kind === "timing" && <td><div className="volunteer-row-actions">{row.action === "MANUAL_TIMING_CAPTURED" && <button className="button button-secondary" type="button" disabled={busy || isReset} onClick={() => void onTimingAction?.(row, "reset")}><RotateCcw /> Reset</button>}<button className="button button-danger" type="button" disabled={busy} onClick={() => void onTimingAction?.(row, "delete")}><Trash2 /> Delete</button></div></td>}{kind !== "timing" && (onBikeReset || onWaiverReset || onDeleteRows) && <td><div className="volunteer-row-actions">{onBikeReset && <button className="button button-secondary" type="button" disabled={busy || isBikeReset} onClick={() => void onBikeReset(row)}><RotateCcw /> {isBikeReset ? "Reset completed" : "Reset bike"}</button>}{onWaiverReset && row.action === "WAIVER_VERIFY" && <button className="button button-secondary" type="button" disabled={busy || isWaiverReset} onClick={() => void onWaiverReset(row)}><RotateCcw /> {isWaiverReset ? "Reset completed" : "Reset waiver"}</button>}{onDeleteRows && <button className="button button-danger" type="button" disabled={busy} onClick={() => void onDeleteRows([row], false)}><Trash2 /> Delete</button>}</div></td>}</tr>;
  })}</tbody></table></div>{!filtered.length && <p className="admin-empty">No records are stored for this log yet.</p>}</section>;
}

function ActivityTable({ rows }: { rows: VolunteerActivity[] }) {
  return <section className="admin-card volunteer-operation-log"><div className="admin-card-head"><div><h2>Volunteer Activity</h2><p>Append-only history of profile, permission and race-day operations.</p></div><span className="status-pill">{rows.length} records</span></div><div className="table-wrap"><table className="leaderboard"><thead><tr><th>TIME</th><th>ACTION</th><th>VOLUNTEER</th><th>DETAIL</th><th>ACTOR</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td className="time">{displayDate(row.createdAt)}</td><td><span className={`status-pill ${row.severity === "warning" ? "status-provisional" : "status-official"}`}>{row.action.replaceAll("_", " ")}</span></td><td><b>{row.entity}</b></td><td>{row.detail}</td><td>{row.actor}</td></tr>)}</tbody></table></div>{!rows.length && <p className="admin-empty">No volunteer activity has been recorded.</p>}</section>;
}
