"use client";

import type { AthleteVisibility, LiveParticipant } from "@/packages/contracts/src";
import type { RaceEvent } from "@/lib/types";
import { ImportFlow } from "./import-flow";
import {
  CalendarDays, CheckCircle2, Download, ExternalLink, Eye, FileText, Hash, IdCard,
  LoaderCircle, Mail, MapPin, Pencil, Phone, RefreshCw, RotateCcw, Search, ShieldCheck,
  Shirt, Trash2, UploadCloud, UserRound, UsersRound, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface ParticipantRow {
  participant: LiveParticipant;
  override: AthleteVisibility | null;
  email: string;
  phone: string;
  chipCode: string;
  athleteBandCode: string;
  registrationStatus: string;
  registrationType: string;
  registeredAt: string;
  source: string;
  ticketId: string;
  ticketName: string;
  tshirtSize: string;
  dateOfBirth: string; bloodGroup: string; emergencyContactName: string; emergencyContact: string;
  address: string; city: string; state: string; country: string; pincode: string;
  belSeason: string; belRecognition: string; bookingId: string; ticketStatus: string;
  ticketPrice: string; amountPaid: string; balanceAmount: string; taxAmount: string; processingFee: string;
  actualRaceDate: string; handoverToName: string; handoverToMobile: string; bikeCheckInRemarks: string;
  identityProof: string; transactionId: string; deferred: string; deferredFromPune: string; cancellationReason: string;
  waiverStatus: string; waiverCheckedInAt: string; waiverVolunteer: string; waiverCounter: string;
  bikeCheckIn: string; bikeCheckOut: string; helmetChecked: string; lockerNumber: string;
  medalIssued: string; finisherJerseyIssued: string; foodIssued: string; updatedAt: string;
  participationMode: "INDIVIDUAL" | "RELAY";
  relayTeamId: string;
  relayTeamName: string;
  relayTeamSize: number | null;
  relayMemberNumber: number | null;
  relayMemberRole: string;
  uploadedFields: Record<string, string>;
  uploadedFieldMappings: Record<string, string>;
}

interface ParticipantEditDraft {
  bib: string; name: string; email: string; mobile: string; registrationStatus: string;
  gender: string; ageGroup: string; club: string; tshirtSize: string; ticketId: string; ticketName: string;
  chipCode: string; athleteBandCode: string; dateOfBirth: string; bloodGroup: string;
  emergencyContactName: string; emergencyContact: string; address: string; city: string; state: string; country: string; pincode: string;
  belSeason: string; belRecognition: string; bookingId: string; ticketStatus: string; ticketPrice: string;
  amountPaid: string; balanceAmount: string; taxAmount: string; processingFee: string; registeredAt: string; actualRaceDate: string;
  handoverToName: string; handoverToMobile: string; bikeCheckInRemarks: string; identityProof: string; transactionId: string;
  deferred: string; deferredFromPune: string; cancellationReason: string;
  uploadedFields: Record<string, string>;
}

type ParticipantEditKey = Exclude<keyof ParticipantEditDraft, "ticketId" | "ticketName" | "uploadedFields">;
type ParticipantEditField = readonly [ParticipantEditKey, string, "text" | "email" | "date"];

const participantEditSections: ReadonlyArray<{ title: string; fields: ReadonlyArray<ParticipantEditField> }> = [
  { title: "Identity & contact", fields: [
    ["bib", "BIB number", "text"], ["name", "Athlete name", "text"], ["email", "Email", "email"], ["mobile", "Mobile", "text"],
    ["dateOfBirth", "Date of birth", "date"], ["gender", "Gender", "text"], ["ageGroup", "Age group", "text"], ["bloodGroup", "Blood group", "text"],
    ["emergencyContactName", "Emergency contact name", "text"], ["emergencyContact", "Emergency contact number", "text"],
  ] },
  { title: "Timing & registration", fields: [
    ["chipCode", "Timing chip code", "text"], ["athleteBandCode", "Athlete band code", "text"],
    ["registrationStatus", "Registration status", "text"], ["bookingId", "Booking ID", "text"], ["ticketStatus", "Ticket status", "text"],
    ["registeredAt", "Registered at", "text"], ["actualRaceDate", "Actual race date", "date"], ["belSeason", "BEL season", "text"],
    ["belRecognition", "BEL recognition", "text"], ["club", "Affiliated club", "text"], ["tshirtSize", "T-shirt size", "text"],
  ] },
  { title: "Payment", fields: [
    ["ticketPrice", "Ticket price", "text"], ["amountPaid", "Amount paid (INR)", "text"], ["balanceAmount", "Balance amount", "text"],
    ["taxAmount", "Tax amount", "text"], ["processingFee", "Processing fee", "text"], ["transactionId", "Transaction ID", "text"],
  ] },
  { title: "Address & handover", fields: [
    ["address", "Address", "text"], ["city", "City", "text"], ["state", "State", "text"], ["country", "Country", "text"],
    ["pincode", "Pincode", "text"], ["handoverToName", "Handover to name", "text"], ["handoverToMobile", "Handover to mobile", "text"],
    ["bikeCheckInRemarks", "Bike check-in remarks", "text"], ["identityProof", "Identity proof / URL", "text"],
  ] },
  { title: "Deferral & cancellation", fields: [
    ["deferred", "Deferred", "text"], ["deferredFromPune", "Deferred from Pune", "text"], ["cancellationReason", "Cancellation reason", "text"],
  ] },
];

const participantOperationalFields: ReadonlyArray<readonly [keyof ParticipantRow, string]> = [
  ["waiverStatus", "Waiver status"], ["waiverCheckedInAt", "Waiver checked-in at"],
  ["waiverVolunteer", "Waiver volunteer"], ["waiverCounter", "Waiver counter"],
  ["bikeCheckIn", "Bike check-in"], ["bikeCheckOut", "Bike check-out"], ["helmetChecked", "Helmet checked"],
  ["lockerNumber", "Locker number"], ["medalIssued", "Medal issued"],
  ["finisherJerseyIssued", "Finisher jersey issued"], ["foodIssued", "Food issued"], ["updatedAt", "Updated at"],
];

const structuredUploadMappingKeys = new Set([
  "bib", "name", "email", "mobile", "category", "registrationStatus", "gender", "ageGroup", "tshirtSize",
  "chipCode", "athleteBandCode", "emergencyContactName", "emergencyContact", "dateOfBirth", "bloodGroup",
]);

function structuredUploadedHeaders(row: ParticipantRow): Set<string> {
  return new Set(Object.entries(row.uploadedFieldMappings)
    .filter(([field]) => structuredUploadMappingKeys.has(field))
    .map(([, header]) => header));
}

interface ParticipantData { event: { id: string; slug: string; name: string }; rows: ParticipantRow[] }
interface ParticipantDetailData {
  event: { id: string; slug: string; name: string };
  participant: LiveParticipant;
  identity: {
    email: string | null; chipCode: string | null; providerEventUuid: string | null;
    providerParticipantUuid: string | null; contestUuid: string | null; dateOfBirth: string | null;
    waveStartTime: string | null; acceptedStartTime: string | null; finishTime: string | null;
    currentSplit: string | null; statusDetail: string | null;
  };
  canonical: { buildVersion: string | null; updatedAt: string | null; courseVersion: number | null; timingVersion: number | null; leaderboardVersion: number | null };
  registration: {
    mobile: string | null; emergencyContact: string | null; address: string | null; city: string | null;
    state: string | null; country: string | null; pincode: string | null; bloodGroup: string | null;
    tshirtSize: string | null; athleteBandCode: string | null; idProofUrl: string | null;
    waiverDocumentUrl: string | null; waiverDocumentAvailable: boolean; filledFormUrl: string | null; signatureName: string | null;
    invoiceNumber: string | null; waiverStatus: string | null; checkedInAt: string | null;
    checkedInBy: string | null; waiverVerifiedAt: string | null; rulesAccepted: boolean | null;
    cutoffAccepted: boolean | null; cancellationPolicyAccepted: boolean | null; marketingConsent: boolean | null;
    registrationStatus: string; registrationType: string; registeredAt: string | null;
  };
  operations: {
    bikeCheckedInAt: string | null; bikeCheckedOutAt: string | null; helmetChecked: boolean;
    bikeRack: string | null; updatedBy: string | null;
  };
}
const PARTICIPANTS_PER_PAGE = 50;

const visibilityOptions: Array<{ value: AthleteVisibility | null; label: string }> = [
  { value: null, label: "Athlete setting" },
  { value: "PUBLIC", label: "Public" },
  { value: "ANONYMOUS", label: "Anonymous" },
  { value: "PRIVATE", label: "Hidden" },
];

function dateLabel(value: string): string {
  if (!value) return "—";
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

function ageLabel(dateOfBirth: string | null): string {
  if (!dateOfBirth) return "—";
  const birth = new Date(dateOfBirth); if (Number.isNaN(birth.getTime())) return "—";
  const today = new Date(); let age = today.getFullYear() - birth.getFullYear();
  if (today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) age -= 1;
  return age >= 0 ? `${age} years` : "—";
}

export function ParticipantManagementAdmin({ events }: { events: RaceEvent[] }) {
  const [eventId, setEventId] = useState(events[0]?.id || "");
  const activeEventId = useRef(eventId);
  const [data, setData] = useState<ParticipantData | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [ageGroup, setAgeGroup] = useState("ALL");
  const [visibility, setVisibility] = useState("ALL");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(Boolean(eventId));
  const [saving, setSaving] = useState("");
  const [assignmentEdit, setAssignmentEdit] = useState<{ kind: "chip" | "athlete-band"; participantId: string; bib: string; name: string; value: string; currentValue: string } | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [selectedRow, setSelectedRow] = useState<ParticipantRow | null>(null);
  const [participantDetail, setParticipantDetail] = useState<ParticipantDetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editRow, setEditRow] = useState<ParticipantRow | null>(null);
  const [editDraft, setEditDraft] = useState<ParticipantEditDraft | null>(null);
  const [deleteRow, setDeleteRow] = useState<ParticipantRow | null>(null);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [deleteSelectedOpen, setDeleteSelectedOpen] = useState(false);
  const [deleteTicketOpen, setDeleteTicketOpen] = useState(false);
  const [deleteTicketId, setDeleteTicketId] = useState("");
  const [selectedParticipantIds, setSelectedParticipantIds] = useState<string[]>([]);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [mutationBusy, setMutationBusy] = useState(false);
  const [resettingAction, setResettingAction] = useState<"waiver" | "bike" | null>(null);
  const [downloadBusy, setDownloadBusy] = useState(false);

  const load = useCallback(async () => {
    if (!eventId) return;
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/v1/admin/events/${encodeURIComponent(eventId)}/participants`, { cache: "no-store" });
      const payload = await response.json() as { ok?: boolean; data?: ParticipantData; error?: string };
      if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error || "Unable to load event participants.");
      if (activeEventId.current === eventId) {
        setData(payload.data);
        const availableIds = new Set(payload.data.rows.map((row) => row.participant.participantUid));
        setSelectedParticipantIds((current) => current.filter((id) => availableIds.has(id)));
      }
    } catch (reason) {
      if (activeEventId.current === eventId) { setData(null); setError(reason instanceof Error ? reason.message : "Unable to load event participants."); }
    } finally { if (activeEventId.current === eventId) setLoading(false); }
  }, [eventId]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  const categories = useMemo(() => [...new Set((data?.rows || []).map((row) => row.participant.contestName || "Open category"))].sort(), [data]);
  const statuses = useMemo(() => [...new Set((data?.rows || []).map((row) => row.registrationStatus || "Unknown"))].sort(), [data]);
  const ageGroups = useMemo(() => [...new Set((data?.rows || []).map((row) => row.participant.ageGroup || "Unspecified"))].sort(), [data]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data?.rows || []).filter((row) => {
      const participant = row.participant;
      const matchesQuery = !needle || [participant.bib, participant.displayName, row.email, row.phone, row.chipCode, row.athleteBandCode, participant.club, ...Object.values(row.uploadedFields || {})].some((value) => (value || "").toLowerCase().includes(needle));
      return matchesQuery
        && (category === "ALL" || (participant.contestName || "Open category") === category)
        && (status === "ALL" || (row.registrationStatus || "Unknown") === status)
        && (ageGroup === "ALL" || (participant.ageGroup || "Unspecified") === ageGroup)
        && (visibility === "ALL" || (row.override || participant.visibility) === visibility);
    });
  }, [ageGroup, category, data, query, status, visibility]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PARTICIPANTS_PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const firstVisibleRow = (currentPage - 1) * PARTICIPANTS_PER_PAGE;
  const visibleRows = filtered.slice(firstVisibleRow, firstVisibleRow + PARTICIPANTS_PER_PAGE);
  const filteredIds = filtered.map((row) => row.participant.participantUid);
  const selectedIdSet = new Set(selectedParticipantIds);
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIdSet.has(id));
  const someFilteredSelected = filteredIds.some((id) => selectedIdSet.has(id));
  const assignedChips = data?.rows.filter((row) => row.chipCode).length || 0;
  const assignedBands = data?.rows.filter((row) => row.athleteBandCode).length || 0;
  const selectedEvent = events.find((event) => event.id === eventId);
  const eventTickets = selectedEvent?.ticketDefinitions?.length
    ? selectedEvent.ticketDefinitions.map((ticket) => ({ id: ticket.id, name: ticket.name }))
    : selectedEvent?.tickets?.length ? selectedEvent.tickets : (selectedEvent?.categories ?? []).map((name) => ({ id: name, name }));
  const deleteTicket = eventTickets.find((ticket) => ticket.id === deleteTicketId) ?? null;
  const deleteTicketRows = deleteTicket ? (data?.rows ?? []).filter((row) => row.ticketId === deleteTicket.id || (!row.ticketId && row.ticketName === deleteTicket.name)) : [];

  function resetFilters(nextEventId?: string) {
    setQuery(""); setCategory("ALL"); setStatus("ALL"); setAgeGroup("ALL"); setVisibility("ALL"); setPage(1); setAssignmentEdit(null); setMessage(""); setError("");
    if (nextEventId !== undefined) { activeEventId.current = nextEventId; setData(null); setEventId(nextEventId); setUploadOpen(false); setEditRow(null); setDeleteRow(null); setDeleteAllOpen(false); setDeleteSelectedOpen(false); setDeleteTicketOpen(false); setDeleteTicketId(""); setSelectedParticipantIds([]); }
  }

  function openEdit(row: ParticipantRow) {
    const ticket = eventTickets.find((item) => item.id === row.ticketId) ?? eventTickets.find((item) => item.name === row.ticketName);
    setEditRow(row);
    setEditDraft({ bib: row.participant.bib || "", name: row.participant.displayName, email: row.email, mobile: row.phone,
      registrationStatus: row.registrationStatus === "Unknown" ? "" : row.registrationStatus,
      gender: row.participant.gender || "", ageGroup: row.participant.ageGroup || "", club: row.participant.club || "",
      tshirtSize: row.tshirtSize, ticketId: ticket?.id || "", ticketName: ticket?.name || "",
      chipCode: row.chipCode, athleteBandCode: row.athleteBandCode, dateOfBirth: row.dateOfBirth, bloodGroup: row.bloodGroup,
      emergencyContactName: row.emergencyContactName, emergencyContact: row.emergencyContact,
      address: row.address, city: row.city, state: row.state, country: row.country, pincode: row.pincode,
      belSeason: row.belSeason, belRecognition: row.belRecognition, bookingId: row.bookingId, ticketStatus: row.ticketStatus,
      ticketPrice: row.ticketPrice, amountPaid: row.amountPaid, balanceAmount: row.balanceAmount, taxAmount: row.taxAmount,
      processingFee: row.processingFee, registeredAt: row.registeredAt, actualRaceDate: row.actualRaceDate,
      handoverToName: row.handoverToName, handoverToMobile: row.handoverToMobile, bikeCheckInRemarks: row.bikeCheckInRemarks,
      identityProof: row.identityProof, transactionId: row.transactionId, deferred: row.deferred,
      deferredFromPune: row.deferredFromPune, cancellationReason: row.cancellationReason,
      uploadedFields: { ...(row.uploadedFields || {}) } });
    setError("");
  }

  async function saveParticipant() {
    if (!editRow || !editDraft) return;
    if (!editDraft.bib.trim() || !editDraft.name.trim() || !editDraft.ticketId) { setError("BIB, athlete name, and event ticket are required."); return; }
    setMutationBusy(true); setError(""); setMessage("");
    try {
      const { chipCode: nextChipValue, athleteBandCode: nextBandValue, ...registrationDraft } = editDraft;
      const response = await fetch(`/api/v1/admin/events/${encodeURIComponent(eventId)}/participants/${encodeURIComponent(editRow.participant.participantUid)}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(registrationDraft),
      });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Unable to save participant.");
      const nextChip = nextChipValue.trim().replace(/\s+/g, "").toUpperCase();
      const nextBand = nextBandValue.trim().replace(/\s+/g, "").toUpperCase();
      if (nextChip !== editRow.chipCode) await patchAssignment("chip", editRow.participant.participantUid, { chipCode: nextChip });
      if (nextBand !== editRow.athleteBandCode) await patchAssignment("athlete-band", editRow.participant.participantUid, { athleteBandCode: nextBand });
      setEditRow(null); setEditDraft(null); setMessage(`Updated BIB ${editDraft.bib}.`); await load();
      applyAssignmentValues(editRow.participant.participantUid, nextChip, nextBand);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save participant."); }
    finally { setMutationBusy(false); }
  }

  async function confirmDelete() {
    if (!data || (!deleteRow && !deleteAllOpen && !deleteSelectedOpen && !deleteTicketOpen)) return;
    const all = deleteAllOpen;
    const selected = deleteSelectedOpen;
    const ticket = deleteTicketOpen ? deleteTicket : null;
    if (deleteTicketOpen && !ticket) { setError("Select an event ticket to delete."); return; }
    const required = all ? data.event.name : selected ? "DELETE" : ticket ? ticket.name : deleteRow?.participant.bib || "";
    if (deleteConfirmation !== required) { setError(`Type ${required} exactly to confirm.`); return; }
    setMutationBusy(true); setError(""); setMessage("");
    try {
      const url = `/api/v1/admin/events/${encodeURIComponent(eventId)}/participants${all || selected || ticket ? "" : `/${encodeURIComponent(deleteRow!.participant.participantUid)}`}`;
      const response = await fetch(url, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify(all
        ? { confirmEventName: data.event.name, expectedCount: data.rows.length }
        : selected ? { confirmSelection: required, expectedCount: selectedParticipantIds.length, participantIds: selectedParticipantIds }
        : ticket ? { ticketId: ticket.id, confirmTicketName: required, expectedCount: deleteTicketRows.length }
        : { confirmBib: required }) });
      const payload = await response.json() as { ok?: boolean; data?: { deleted: number; warning?: string }; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Unable to delete participants.");
      const deletedCount = payload.data?.deleted ?? (all ? data.rows.length : selected ? selectedParticipantIds.length : ticket ? deleteTicketRows.length : 1);
      setDeleteRow(null); setDeleteAllOpen(false); setDeleteSelectedOpen(false); setDeleteTicketOpen(false); setDeleteTicketId(""); setDeleteConfirmation("");
      if (all || selected) setSelectedParticipantIds([]);
      setMessage(`${deletedCount} uploaded participant${deletedCount === 1 ? "" : "s"} removed from ${data.event.name}. Official results and volunteer history were not deleted.${payload.data?.warning ? ` ${payload.data.warning}` : ""}`);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to delete participants."); }
    finally { setMutationBusy(false); }
  }

  function toggleParticipantSelection(participantId: string) {
    setSelectedParticipantIds((current) => current.includes(participantId)
      ? current.filter((id) => id !== participantId)
      : [...current, participantId]);
  }

  function toggleAllFiltered() {
    setSelectedParticipantIds((current) => {
      const next = new Set(current);
      if (allFilteredSelected) filteredIds.forEach((id) => next.delete(id));
      else filteredIds.forEach((id) => next.add(id));
      return [...next];
    });
  }

  function beginAssignmentEdit(row: ParticipantRow, kind: "chip" | "athlete-band") {
    const currentValue = kind === "chip" ? row.chipCode : row.athleteBandCode;
    setAssignmentEdit({
      kind,
      participantId: row.participant.participantUid,
      bib: row.participant.bib || "—",
      name: row.participant.displayName,
      value: currentValue,
      currentValue,
    });
    setMessage(""); setError("");
  }

  async function openParticipant(row: ParticipantRow) {
    setSelectedRow(row); setParticipantDetail(null); setDetailError(""); setDetailLoading(true);
    try {
      const response = await fetch(`/api/v1/admin/events/${encodeURIComponent(eventId)}/participants/${encodeURIComponent(row.participant.participantUid)}`, { cache: "no-store" });
      const payload = await response.json() as { ok?: boolean; data?: ParticipantDetailData; error?: string };
      if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error || "Unable to load participant details.");
      setParticipantDetail(payload.data);
    } catch (reason) {
      setDetailError(reason instanceof Error ? reason.message : "Unable to load participant details.");
    } finally { setDetailLoading(false); }
  }

  async function resetWaiverCheckIn(row: ParticipantRow) {
    if (!window.confirm(`Reset the waiver, OTP verification, and check-in for ${row.participant.displayName} (BIB ${row.participant.bib || "—"})?`)) return;
    setMutationBusy(true); setResettingAction("waiver"); setDetailError(""); setMessage("");
    try {
      const response = await fetch(`/api/v1/admin/events/${encodeURIComponent(eventId)}/participants/${encodeURIComponent(row.participant.participantUid)}/waiver-check-in`, {
        method: "DELETE",
      });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Unable to reset waiver and check-in.");
      setMessage(`Reset waiver, OTP verification, and check-in for BIB ${row.participant.bib || "—"}.`);
      await openParticipant(row);
    } catch (reason) {
      setDetailError(reason instanceof Error ? reason.message : "Unable to reset waiver and check-in.");
    } finally { setMutationBusy(false); setResettingAction(null); }
  }

  async function resetBikeCheckIn(row: ParticipantRow) {
    if (!window.confirm(`Reset the complete bike check-in and checkout record for ${row.participant.displayName} (BIB ${row.participant.bib || "—"})?`)) return;
    setMutationBusy(true); setResettingAction("bike"); setDetailError(""); setMessage("");
    try {
      const response = await fetch(`/api/v1/admin/events/${encodeURIComponent(eventId)}/participants/${encodeURIComponent(row.participant.participantUid)}/bike-check-in`, {
        method: "DELETE",
      });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Unable to reset bike check-in.");
      setMessage(`Reset bike check-in and checkout for BIB ${row.participant.bib || "—"}.`);
      await openParticipant(row);
    } catch (reason) {
      setDetailError(reason instanceof Error ? reason.message : "Unable to reset bike check-in.");
    } finally { setMutationBusy(false); setResettingAction(null); }
  }

  async function patchAssignment(path: "chip" | "athlete-band", participantId: string, body: Record<string, string>) {
    const removing = (path === "chip" && !body.chipCode?.trim()) || (path === "athlete-band" && !body.athleteBandCode?.trim());
    const response = await fetch(`/api/v1/admin/events/${encodeURIComponent(eventId)}/participants/${encodeURIComponent(participantId)}/${path}`, {
      method: removing ? "DELETE" : "PATCH",
      headers: { "content-type": "application/json" },
      ...(removing ? {} : { body: JSON.stringify({ ...body, reason: "Updated from Participants admin" }) }),
    });
    const payload = await response.json() as { ok?: boolean; error?: string };
    if (!response.ok || !payload.ok) throw new Error(payload.error || `Unable to update ${path === "chip" ? "chip" : "athlete band"}.`);
  }

  function applyAssignmentValues(participantId: string, nextChip: string, nextBand: string) {
    setData((current) => current ? {
      ...current,
      rows: current.rows.map((item) => item.participant.participantUid === participantId
        ? { ...item, chipCode: nextChip, athleteBandCode: nextBand }
        : item),
    } : current);
  }

  async function saveAssignmentEdit() {
    if (!assignmentEdit) return;
    const nextValue = assignmentEdit.value.trim().replace(/\s+/g, "").toUpperCase();
    const currentValue = assignmentEdit.currentValue.trim().replace(/\s+/g, "").toUpperCase();
    if (nextValue === currentValue) { setAssignmentEdit(null); return; }
    setSaving(assignmentEdit.participantId); setError(""); setMessage("");
    try {
      const row = data?.rows.find((item) => item.participant.participantUid === assignmentEdit.participantId);
      if (!row) throw new Error("Participant is no longer available. Refresh and try again.");
      if (assignmentEdit.kind === "chip") {
        await patchAssignment("chip", assignmentEdit.participantId, { chipCode: nextValue });
        applyAssignmentValues(assignmentEdit.participantId, nextValue, row.athleteBandCode);
        setMessage(nextValue ? `Timing chip ${nextValue} saved for BIB ${assignmentEdit.bib}.` : `Timing chip removed from BIB ${assignmentEdit.bib}.`);
      } else {
        await patchAssignment("athlete-band", assignmentEdit.participantId, { athleteBandCode: nextValue });
        applyAssignmentValues(assignmentEdit.participantId, row.chipCode, nextValue);
        setMessage(nextValue ? `Athlete band ${nextValue} saved for BIB ${assignmentEdit.bib}.` : `Athlete band removed from BIB ${assignmentEdit.bib}.`);
      }
      setAssignmentEdit(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : `Unable to save ${assignmentEdit.kind === "chip" ? "timing chip" : "athlete band"}.`); }
    finally { setSaving(""); }
  }

  async function updateVisibility(row: ParticipantRow, next: AthleteVisibility | null) {
    setSaving(row.participant.participantUid); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/v1/admin/events/${encodeURIComponent(eventId)}/participants/visibility`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ participantUid: row.participant.participantUid, visibility: next }),
      });
      const payload = await response.json() as { success?: boolean; error?: { message?: string } };
      if (!response.ok || !payload.success) throw new Error(payload.error?.message || "Unable to update visibility.");
      setData((current) => current ? { ...current, rows: current.rows.map((item) => item.participant.participantUid === row.participant.participantUid ? { ...item, override: next } : item) } : current);
      setMessage(`Updated public visibility for BIB ${row.participant.bib || "—"}.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to update visibility."); }
    finally { setSaving(""); }
  }

  async function downloadCsv() {
    if (!eventId) return;
    setDownloadBusy(true); setError("");
    try {
      const response = await fetch(`/api/v1/admin/events/${encodeURIComponent(eventId)}/participants/export`, { cache: "no-store" });
      if (!response.ok) throw new Error((await response.text()) || "Unable to export participants.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `${data?.event.slug || "event"}-participants.csv`; anchor.click(); URL.revokeObjectURL(url);
      setMessage(`Downloaded all ${(data?.rows.length || 0).toLocaleString()} participant rows with the complete export columns.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to export participants.");
    } finally { setDownloadBusy(false); }
  }

  return <section className="admin-card participant-management-admin">
    <div className="admin-card-head participant-list-heading"><div><h2>Participants List<br />({data ? data.rows.length.toLocaleString() : "—"})</h2><p>View and manage registrations.<br />{data ? `Showing ${filtered.length.toLocaleString()} of ${data.rows.length.toLocaleString()}.` : "Participant totals are unavailable until the roster loads."}</p></div><div className="participant-actions"><button className="button button-primary" type="button" aria-expanded={uploadOpen} onClick={() => { setUploadOpen((open) => !open); if (!uploadOpen) requestAnimationFrame(() => document.getElementById("participant-upload-panel")?.scrollIntoView({ behavior: "smooth", block: "start" })); }}><UploadCloud /> {uploadOpen ? "Close participant upload" : "Upload / update participants"}</button><button className="button" type="button" onClick={() => void downloadCsv()} disabled={!data?.rows.length || downloadBusy}>{downloadBusy ? <LoaderCircle className="spin" /> : <Download />} {downloadBusy ? "Preparing all rows…" : `Download all ${data?.rows.length?.toLocaleString() || ""} rows`}</button><button className="button participant-delete-all" type="button" disabled={!data?.rows.length || mutationBusy} onClick={() => { setDeleteConfirmation(""); setDeleteAllOpen(true); }}><Trash2 /> Delete all participants</button><button className="button participant-refresh-button" type="button" aria-label="Refresh participants" title="Refresh participants" onClick={() => void load()} disabled={loading || !eventId}><RefreshCw className={loading ? "spin" : ""} /></button></div></div>
    {uploadOpen && <div id="participant-upload-panel"><ImportFlow key={eventId} events={events.filter((event) => event.id === eventId)} onImported={() => void load()} /></div>}
    {message && <div className="success-banner">{message}</div>}{error && <div className="success-banner cms-error-banner">{error}</div>}
    {data && <div className="participant-summary"><span><b>{data.rows.length.toLocaleString()}</b><small>Total athletes</small></span><span><b>{assignedChips.toLocaleString()}</b><small>Chip assigned</small></span><span><b>{assignedBands.toLocaleString()}</b><small>Athlete band assigned</small></span><span><b>{Math.max(0, data.rows.length - assignedChips).toLocaleString()}</b><small>Missing chip</small></span><span><b>{Math.max(0, data.rows.length - assignedBands).toLocaleString()}</b><small>Missing band</small></span></div>}
    <div className="participant-filters">
      <div className="field participant-event-filter"><label>Event</label><select value={eventId} onChange={(event) => resetFilters(event.target.value)}>{events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}</select></div>
      {data && <><label className="live-visibility-search participant-search"><Search /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search current event…" /></label>
      <div className="participant-filter-row">
        <div className="field"><label>Status</label><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="ALL">All statuses ({data?.rows.length || 0})</option>{statuses.map((value) => <option key={value}>{value}</option>)}</select></div>
        <div className="field"><label>Category</label><select value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); }}><option value="ALL">All categories ({filtered.length})</option>{categories.map((value) => <option key={value}>{value}</option>)}</select></div>
        <div className="field"><label>Age group</label><select value={ageGroup} onChange={(event) => { setAgeGroup(event.target.value); setPage(1); }}><option value="ALL">Age: All ({data?.rows.length || 0})</option>{ageGroups.map((value) => <option key={value}>{value}</option>)}</select></div>
        <div className="field"><label>Visibility</label><select value={visibility} onChange={(event) => { setVisibility(event.target.value); setPage(1); }}><option value="ALL">Visibility: All</option><option value="PUBLIC">Public</option><option value="ANONYMOUS">Anonymous</option><option value="PRIVATE">Hidden</option></select></div>
      </div></>}
    </div>
    {loading ? <div className="admin-empty participant-loading"><LoaderCircle className="spin" /> Loading participants from Worker/KV…</div> : !data ? <div className="admin-empty" role="alert">Participant roster could not be loaded. No data has been changed. <button className="button" type="button" onClick={() => void load()}>Retry loading participants</button></div> : <>
      <div className="participant-bulk-actions" aria-live="polite"><label><input type="checkbox" checked={allFilteredSelected} ref={(input) => { if (input) input.indeterminate = someFilteredSelected && !allFilteredSelected; }} onChange={toggleAllFiltered} disabled={!filteredIds.length || mutationBusy} /> Select all {filteredIds.length.toLocaleString()} matching participants</label><span><b>{selectedParticipantIds.length.toLocaleString()}</b> selected</span><button className="button" type="button" disabled={!selectedParticipantIds.length || mutationBusy} onClick={() => setSelectedParticipantIds([])}>Clear selection</button><button className="button participant-danger-button" type="button" disabled={!selectedParticipantIds.length || mutationBusy} onClick={() => { setDeleteConfirmation(""); setError(""); setDeleteSelectedOpen(true); }}><Trash2 /> Delete selected</button><div className="participant-ticket-delete"><select aria-label="Ticket to delete" value={deleteTicketId} onChange={(event) => setDeleteTicketId(event.target.value)}><option value="">Select ticket / contest</option>{eventTickets.map((ticket) => <option key={ticket.id} value={ticket.id}>{ticket.name}</option>)}</select><button className="button participant-danger-button" type="button" disabled={!deleteTicket || !deleteTicketRows.length || mutationBusy} onClick={() => { setDeleteConfirmation(""); setError(""); setDeleteTicketOpen(true); }}><Trash2 /> Delete ticket participants{deleteTicket ? ` (${deleteTicketRows.length})` : ""}</button></div></div>
      <div className="table-wrap participant-table-wrap" tabIndex={0} aria-label="Participants table. Scroll vertically to see more rows and horizontally to see more columns."><table className="participant-table"><thead><tr><th className="participant-select-column"><input type="checkbox" aria-label={`Select all ${filteredIds.length} matching participants`} checked={allFilteredSelected} ref={(input) => { if (input) input.indeterminate = someFilteredSelected && !allFilteredSelected; }} onChange={toggleAllFiltered} disabled={!filteredIds.length || mutationBusy} /></th><th className="participant-row-number-column">ROW</th><th>BIB NO.</th><th>CHIPCODE</th><th>ATHLETE BAND</th><th>ATHLETE / BUSINESS</th><th>CATEGORY</th><th>STATUS</th><th>CONTACT</th><th>AGE / GENDER</th><th>CLUB</th><th>TYPE</th><th>REGISTERED</th><th>VISIBILITY</th><th>ACTIONS</th></tr></thead><tbody>{visibleRows.map((row, rowIndex) => {
        const participant = row.participant; const busy = saving === participant.participantUid;
        return <tr key={participant.participantUid} className={selectedIdSet.has(participant.participantUid) ? "participant-row-selected" : undefined}><td className="participant-select-column"><input type="checkbox" aria-label={`Select ${participant.displayName}, BIB ${participant.bib || "unassigned"}`} checked={selectedIdSet.has(participant.participantUid)} onChange={() => toggleParticipantSelection(participant.participantUid)} disabled={mutationBusy} /></td><td className="participant-row-number-column">{firstVisibleRow + rowIndex + 1}</td><td><button className="participant-open-bib" type="button" onClick={() => void openParticipant(row)}>{participant.bib || "—"}</button>{row.participationMode === "RELAY" ? <small>Relay · {row.relayMemberNumber}/{row.relayTeamSize}</small> : null}</td><td><button className="participant-inline-code participant-chip-code" type="button" title="Edit or remove timing chip" disabled={busy} onClick={() => beginAssignmentEdit(row, "chip")}><code>{row.chipCode || "—"}</code>{busy ? <LoaderCircle className="spin" /> : <Pencil />}</button></td><td><button className="participant-inline-code participant-band-code" type="button" title="Edit or remove athlete band" disabled={busy} onClick={() => beginAssignmentEdit(row, "athlete-band")}><code>{row.athleteBandCode || "—"}</code>{busy ? <LoaderCircle className="spin" /> : <Pencil />}</button></td><td><button className="participant-open-name" type="button" onClick={() => void openParticipant(row)}>{participant.displayName}</button><small>{row.participationMode === "RELAY" ? `${row.relayTeamName}${row.relayMemberRole ? ` · ${row.relayMemberRole}` : ""}` : row.source}</small></td><td>{participant.contestName || "—"}</td><td><span className="status-pill">{row.registrationStatus.replaceAll("_", " ")}</span></td><td><span>{row.email || "—"}</span><small>{row.phone}</small></td><td><span>{participant.ageGroup || "—"}</span><small>{participant.gender || "—"}</small></td><td>{participant.club || "—"}</td><td>{row.participationMode === "RELAY" ? `Relay team (${row.relayTeamSize})` : row.registrationType}</td><td>{dateLabel(row.registeredAt)}</td><td><select value={row.override ?? ""} disabled={busy} onChange={(event) => void updateVisibility(row, (event.target.value || null) as AthleteVisibility | null)}>{visibilityOptions.map((option) => <option key={option.value ?? "DEFAULT"} value={option.value ?? ""}>{option.label}</option>)}</select></td><td><div className="participant-row-actions"><button type="button" title="View participant" onClick={() => void openParticipant(row)}><Eye /><span>View</span></button><button className="participant-action-edit" type="button" title="Edit registration" disabled={mutationBusy} onClick={() => openEdit(row)}><Pencil /><span>Edit</span></button><button className="participant-action-delete" type="button" title="Delete participant" disabled={mutationBusy} onClick={() => { setDeleteRow(row); setDeleteConfirmation(""); setError(""); }}><Trash2 /><span>Delete</span></button></div></td></tr>;
      })}</tbody></table></div>
      {!visibleRows.length && <div className="admin-empty">No participants match the selected event and filters.</div>}
      <div className="participant-pagination"><span>{visibleRows.length ? `Showing ${(firstVisibleRow + 1).toLocaleString()}–${(firstVisibleRow + visibleRows.length).toLocaleString()} of ${filtered.length.toLocaleString()}` : "No matching participants"}</span><span className="participant-page-size">50 rows per page</span><div><button disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button><span>Page {currentPage} of {totalPages}</span><button disabled={currentPage >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>Next</button></div></div>
    </>}
    {selectedRow && <ParticipantDetailsModal row={selectedRow} detail={participantDetail} loading={detailLoading} error={detailError} resetting={resettingAction} mutationBusy={mutationBusy} onResetWaiver={() => void resetWaiverCheckIn(selectedRow)} onResetBike={() => void resetBikeCheckIn(selectedRow)} onClose={() => { setSelectedRow(null); setParticipantDetail(null); setDetailError(""); }} />}
    {assignmentEdit && <div className="participant-detail-backdrop" role="presentation" onMouseDown={() => { if (!saving) setAssignmentEdit(null); }}><section className="participant-detail-modal participant-confirm-modal" role="dialog" aria-modal="true" aria-label={assignmentEdit.kind === "chip" ? "Edit timing chip" : "Edit athlete band"} onMouseDown={(event) => event.stopPropagation()}><header><div><h2>{assignmentEdit.kind === "chip" ? "Edit timing chip" : "Edit athlete band"}</h2><p>{assignmentEdit.name} · BIB {assignmentEdit.bib}</p></div><button type="button" disabled={Boolean(saving)} onClick={() => setAssignmentEdit(null)} aria-label="Close assignment editor"><X /></button></header><div className="participant-detail-scroll">{error && <div className="error-banner" role="alert">{error}</div>}<label>{assignmentEdit.kind === "chip" ? "Timing chip code" : "Athlete band code"}<input autoFocus autoComplete="off" maxLength={64} value={assignmentEdit.value} placeholder={assignmentEdit.kind === "chip" ? "Enter timing chip" : "Enter athlete band"} onChange={(event) => setAssignmentEdit((current) => current ? { ...current, value: event.target.value.toUpperCase().replace(/\s+/g, "") } : current)} onKeyDown={(event) => { if (event.key === "Enter") void saveAssignmentEdit(); }} /></label><p>Leave blank and save to remove the {assignmentEdit.kind === "chip" ? "timing chip" : "athlete band"}. Changes are event-scoped and audited.</p><div className="participant-modal-actions"><button className="button" type="button" disabled={Boolean(saving)} onClick={() => setAssignmentEdit(null)}>Cancel</button><button className="button button-primary" type="button" disabled={Boolean(saving)} onClick={() => void saveAssignmentEdit()}>{saving ? <><LoaderCircle className="spin" /> Saving…</> : assignmentEdit.value.trim() ? `Save ${assignmentEdit.kind === "chip" ? "timing chip" : "athlete band"}` : `Remove ${assignmentEdit.kind === "chip" ? "timing chip" : "athlete band"}`}</button></div></div></section></div>}
    {editRow && editDraft && <div className="participant-detail-backdrop" role="presentation"><section className="participant-detail-modal participant-edit-modal" role="dialog" aria-modal="true" aria-label={`Edit ${editRow.participant.displayName}`}><header><h2>Edit participant · BIB {editRow.participant.bib}</h2><button type="button" onClick={() => { setEditRow(null); setEditDraft(null); }} aria-label="Close edit"><X /></button></header><div className="participant-detail-scroll"><p>Update every uploaded registration field, timing chip, and athlete band in one place. Published results remain unchanged. Audited check-in and fulfilment values are shown below as read-only.</p>{error && <div className="error-banner" role="alert">{error}</div>}
      {participantEditSections.map((section) => <section className="participant-edit-section" key={section.title}><h3>{section.title}</h3><div className="participant-edit-grid">{section.fields.map(([field, label, type]) => <label key={field}>{label}<input type={type} value={editDraft[field]} onChange={(event) => setEditDraft({ ...editDraft, [field]: event.target.value })} /></label>)}</div></section>)}
      <section className="participant-edit-section"><h3>Event contest</h3><div className="participant-edit-grid"><label>Event ticket<select value={editDraft.ticketId} onChange={(event) => { const ticket = eventTickets.find((item) => item.id === event.target.value); setEditDraft({ ...editDraft, ticketId: ticket?.id || "", ticketName: ticket?.name || "" }); }}><option value="">Select ticket</option>{eventTickets.map((ticket) => <option key={ticket.id} value={ticket.id}>{ticket.name}</option>)}</select></label><label>Participation mode<input readOnly value={editRow.participationMode === "RELAY" ? `Relay team (${editRow.relayTeamSize || "—"})` : "Individual"} /></label>{editRow.participationMode === "RELAY" && <><label>Relay team<input readOnly value={editRow.relayTeamName} /></label><label>Relay member<input readOnly value={`${editRow.relayMemberNumber || "—"}${editRow.relayMemberRole ? ` · ${editRow.relayMemberRole}` : ""}`} /></label></>}</div></section>
      <section className="participant-edit-section"><h3>Uploaded spreadsheet columns</h3><p>Every column retained from the uploaded row is shown below. Fields already mapped into the form above are synchronized there; other uploaded columns can be edited here.</p>{Object.keys(editDraft.uploadedFields).length ? <div className="participant-edit-grid">{Object.entries(editDraft.uploadedFields).map(([header, value]) => { const managed = structuredUploadedHeaders(editRow).has(header); return <label key={header}>{header}{managed && <small>Managed in the fields above</small>}<input readOnly={managed} value={value} onChange={(event) => setEditDraft({ ...editDraft, uploadedFields: { ...editDraft.uploadedFields, [header]: event.target.value } })} /></label>; })}</div> : <div className="admin-empty participant-uploaded-empty">No original spreadsheet columns were retained for this older upload. Re-upload the source file to preserve every original column.</div>}</section>
      <section className="participant-edit-section participant-edit-readonly"><h3>Check-in &amp; fulfilment · read-only</h3><p>Use the volunteer waiver, bike, medal, food, and checkout workflows to change these audited values.</p><div className="participant-edit-grid">{participantOperationalFields.map(([field, label]) => <label key={field}>{label}<input readOnly value={String(editRow[field] ?? "")} placeholder="—" /></label>)}</div></section>
      <div className="participant-modal-actions"><button className="button" type="button" disabled={mutationBusy} onClick={() => { setEditRow(null); setEditDraft(null); }}>Cancel</button><button className="button button-primary" type="button" disabled={mutationBusy} onClick={() => void saveParticipant()}>{mutationBusy ? "Saving all fields…" : "Save all participant fields"}</button></div></div></section></div>}
    {(deleteRow || deleteAllOpen || deleteSelectedOpen || deleteTicketOpen) && <div className="participant-detail-backdrop" role="presentation"><section className="participant-detail-modal participant-confirm-modal" role="alertdialog" aria-modal="true" aria-label={deleteAllOpen ? "Delete all event participants" : deleteSelectedOpen ? "Delete selected participants" : deleteTicketOpen ? "Delete ticket participants" : "Delete participant"}><header><h2>{deleteAllOpen ? "Delete all uploaded participants?" : deleteSelectedOpen ? `Delete ${selectedParticipantIds.length} selected participants?` : deleteTicketOpen ? `Delete ${deleteTicketRows.length} ${deleteTicket?.name || "ticket"} participants?` : "Delete uploaded participant?"}</h2><button type="button" disabled={mutationBusy} onClick={() => { setDeleteRow(null); setDeleteAllOpen(false); setDeleteSelectedOpen(false); setDeleteTicketOpen(false); setDeleteConfirmation(""); }} aria-label="Cancel deletion"><X /></button></header><div className="participant-detail-scroll"><p className="participant-danger-warning">{deleteAllOpen ? `This removes all ${data?.rows.length ?? 0} uploaded registrations from ${data?.event.name ?? "this event"}, not just the currently filtered rows.` : deleteSelectedOpen ? `This removes exactly ${selectedParticipantIds.length} selected uploaded registrations from ${data?.event.name ?? "this event"}.` : deleteTicketOpen ? `This removes all ${deleteTicketRows.length} uploaded registrations assigned to ${deleteTicket?.name || "the selected ticket"}. Relay tickets include every relay member row.` : `This removes ${deleteRow?.participant.displayName ?? "this athlete"} (BIB ${deleteRow?.participant.bib ?? "—"}) from the uploaded roster.`} This cannot be undone here. Official results, timing records, and volunteer history are not deleted. Previously reserved chip or band codes may need separate admin review before reuse.</p>{error && <div className="error-banner" role="alert">{error}</div>}<label>Type <strong>{deleteAllOpen ? data?.event.name : deleteSelectedOpen ? "DELETE" : deleteTicketOpen ? deleteTicket?.name : deleteRow?.participant.bib}</strong> to confirm<input autoFocus value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} /></label><div className="participant-modal-actions"><button className="button" type="button" disabled={mutationBusy} onClick={() => { setDeleteRow(null); setDeleteAllOpen(false); setDeleteSelectedOpen(false); setDeleteTicketOpen(false); setDeleteConfirmation(""); }}>Cancel</button><button className="button participant-danger-button" type="button" disabled={mutationBusy || deleteConfirmation !== (deleteAllOpen ? data?.event.name : deleteSelectedOpen ? "DELETE" : deleteTicketOpen ? deleteTicket?.name : deleteRow?.participant.bib)} onClick={() => void confirmDelete()}>{mutationBusy ? "Deleting…" : deleteAllOpen ? "Delete all participants" : deleteSelectedOpen ? `Delete ${selectedParticipantIds.length} selected` : deleteTicketOpen ? `Delete ${deleteTicketRows.length} ticket participants` : "Delete participant"}</button></div></div></section></div>}
  </section>;
}

function DetailRow({ icon: Icon, label, value, link }: { icon: typeof UserRound; label: string; value: React.ReactNode; link?: string | null }) {
  return <div className="participant-detail-row"><Icon /><span>{label}</span><b>{link ? <a href={link} target="_blank" rel="noreferrer">{value}<ExternalLink /></a> : value || "—"}</b></div>;
}

function BooleanValue({ value }: { value: boolean | null }) {
  if (value === null) return <>—</>;
  return value ? <span className="participant-detail-yes">YES</span> : <span className="participant-detail-no">NO</span>;
}

function ParticipantDetailsModal({ row, detail, loading, error, resetting, mutationBusy, onResetWaiver, onResetBike, onClose }: { row: ParticipantRow; detail: ParticipantDetailData | null; loading: boolean; error: string; resetting: "waiver" | "bike" | null; mutationBusy: boolean; onResetWaiver: () => void; onResetBike: () => void; onClose: () => void }) {
  const participant = detail?.participant ?? row.participant;
  const registration = detail?.registration;
  const address = [registration?.address, registration?.city, registration?.pincode].filter(Boolean).join(", ");
  const stateCountry = [registration?.state, registration?.country ?? participant.country].filter(Boolean).join(", ");
  return <div className="participant-detail-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="participant-detail-modal" role="dialog" aria-modal="true" aria-label={`Participant details for ${participant.displayName}`} onMouseDown={(event) => event.stopPropagation()}>
      <header><h2>Participant Details</h2><button type="button" onClick={onClose} aria-label="Close participant details"><X /></button></header>
      <div className="participant-detail-scroll">
        <div className="participant-profile-heading"><h3>PARTICIPANT PROFILE</h3><p>Record ID: {participant.participantUid}</p></div>
        {loading && <div className="admin-empty participant-detail-loading"><LoaderCircle className="spin" /> Loading participant profile…</div>}
        {error && <div className="error-banner">{error}</div>}
        {!loading && detail && <>
          <DetailSection title="Identity">
            <DetailRow icon={UserRound} label="Full Name" value={participant.fullName || participant.displayName} />
            <DetailRow icon={Mail} label="Email Address" value={detail.identity.email || row.email} />
            <DetailRow icon={Phone} label="Contact No." value={registration?.mobile || row.phone} />
            <DetailRow icon={Phone} label="Emergency Contact" value={registration?.emergencyContact} />
            <DetailRow icon={CalendarDays} label="Date of Birth" value={detail.identity.dateOfBirth ? dateLabel(detail.identity.dateOfBirth) : "—"} />
            <DetailRow icon={CalendarDays} label="Calculated Age" value={ageLabel(detail.identity.dateOfBirth)} />
            <DetailRow icon={UsersRound} label="Age Category" value={participant.ageGroup} />
            <DetailRow icon={UsersRound} label="Gender" value={participant.gender} />
            <DetailRow icon={ShieldCheck} label="Blood Group" value={registration?.bloodGroup} />
            <DetailRow icon={Shirt} label="T-Shirt Size" value={registration?.tshirtSize} />
            <DetailRow icon={Hash} label="Athlete QR Band" value={registration?.athleteBandCode || row.athleteBandCode || "Not assigned"} />
          </DetailSection>
          <DetailSection title="Logistics">
            <DetailRow icon={MapPin} label="Address" value={address || "—"} />
            <DetailRow icon={MapPin} label="State / Country" value={stateCountry || "—"} />
            <DetailRow icon={UsersRound} label="Club" value={participant.club} />
          </DetailSection>
          <DetailSection title="Registration & Race">
            <DetailRow icon={IdCard} label="BIB No." value={participant.bib} />
            {row.participationMode === "RELAY" && <>
              <DetailRow icon={UsersRound} label="Relay Team" value={row.relayTeamName || `Relay Team ${participant.bib}`} />
              <DetailRow icon={UsersRound} label="Team Member" value={`${row.relayMemberNumber || "—"} of ${row.relayTeamSize || "—"}${row.relayMemberRole ? ` · ${row.relayMemberRole}` : ""}`} />
            </>}
            <DetailRow icon={Hash} label="Chip Code" value={detail.identity.chipCode || row.chipCode || "Not assigned"} />
            <DetailRow icon={UsersRound} label="Category" value={participant.contestName} />
            <DetailRow icon={ShieldCheck} label="Registration Status" value={registration?.registrationStatus.replaceAll("_", " ")} />
            <DetailRow icon={FileText} label="Registration Type" value={registration?.registrationType} />
            <DetailRow icon={CalendarDays} label="Registered" value={registration?.registeredAt ? dateLabel(registration.registeredAt) : "—"} />
            <DetailRow icon={ShieldCheck} label="Race Status" value={participant.raceStatus.replaceAll("_", " ")} />
          </DetailSection>
          <DetailSection title="Check-in Progress">
            <DetailRow icon={CheckCircle2} label="Waiver Status" value={registration?.waiverStatus || (registration?.waiverVerifiedAt ? "VERIFIED" : "NOT VERIFIED")} />
            <DetailRow icon={CalendarDays} label="Check-in Time" value={registration?.checkedInAt ? dateLabel(registration.checkedInAt) : "—"} />
            <DetailRow icon={UserRound} label="Handled By" value={registration?.checkedInBy} />
            {(registration?.waiverVerifiedAt || registration?.checkedInAt) && <div className="participant-modal-actions"><button className="button participant-danger-button" type="button" disabled={mutationBusy} onClick={onResetWaiver}>{resetting === "waiver" ? <LoaderCircle className="spin" /> : <RotateCcw />} {resetting === "waiver" ? "Resetting…" : "Reset waiver & check-in"}</button></div>}
          </DetailSection>
          <DetailSection title="Bike Operations">
            <DetailRow icon={CalendarDays} label="Bike Check-in" value={detail.operations.bikeCheckedInAt ? dateLabel(detail.operations.bikeCheckedInAt) : "—"} />
            <DetailRow icon={CalendarDays} label="Bike Checkout" value={detail.operations.bikeCheckedOutAt ? dateLabel(detail.operations.bikeCheckedOutAt) : "—"} />
            <DetailRow icon={MapPin} label="Bike Rack" value={detail.operations.bikeRack || "—"} />
            <DetailRow icon={ShieldCheck} label="Helmet Checked" value={<BooleanValue value={detail.operations.helmetChecked} />} />
            <DetailRow icon={UserRound} label="Last Handled By" value={detail.operations.updatedBy || "—"} />
            {detail.operations.bikeCheckedInAt && <div className="participant-modal-actions"><button className="button participant-danger-button" type="button" disabled={mutationBusy} onClick={onResetBike}>{resetting === "bike" ? <LoaderCircle className="spin" /> : <RotateCcw />} {resetting === "bike" ? "Resetting…" : "Reset bike check-in"}</button></div>}
          </DetailSection>
          <DetailSection title="Legal & Files">
            <DetailRow icon={IdCard} label="Identity Proof" value={registration?.idProofUrl ? "Open Document" : "Not provided"} link={registration?.idProofUrl} />
            <DetailRow icon={Pencil} label="Signature" value={registration?.signatureName} />
            <DetailRow icon={FileText} label="Waiver Document" value={registration?.waiverDocumentUrl ? "Read Signed Waiver" : "Not available"} link={registration?.waiverDocumentUrl} />
            {registration?.waiverDocumentAvailable && <div className="participant-modal-actions"><a className="button button-primary" href={`/api/v1/admin/events/${encodeURIComponent(detail.event.id)}/participants/${encodeURIComponent(participant.participantUid)}/waiver`}><Download /> Download signed waiver PDF</a></div>}
            <DetailRow icon={ShieldCheck} label="Rules Accepted" value={<BooleanValue value={registration?.rulesAccepted ?? null} />} />
            <DetailRow icon={ShieldCheck} label="Cut-off Accepted" value={<BooleanValue value={registration?.cutoffAccepted ?? null} />} />
            <DetailRow icon={ShieldCheck} label="Cancellation / Deferral Policy" value={<BooleanValue value={registration?.cancellationPolicyAccepted ?? null} />} />
            <DetailRow icon={CheckCircle2} label="Marketing Consent" value={<BooleanValue value={registration?.marketingConsent ?? null} />} />
            <DetailRow icon={Download} label="Filled Form" value={registration?.filledFormUrl ? "Download Filled Form PDF" : "Not available"} link={registration?.filledFormUrl} />
            <DetailRow icon={FileText} label="Invoice No." value={registration?.invoiceNumber} />
          </DetailSection>
          <DetailSection title="Timing Record">
            <DetailRow icon={CalendarDays} label="Accepted Start" value={detail.identity.acceptedStartTime ? dateLabel(detail.identity.acceptedStartTime) : "—"} />
            <DetailRow icon={CalendarDays} label="Finish Time" value={detail.identity.finishTime ? dateLabel(detail.identity.finishTime) : "—"} />
            <DetailRow icon={MapPin} label="Current Split" value={detail.identity.currentSplit} />
            <DetailRow icon={ShieldCheck} label="Timing Source" value={participant.timingSource || detail.identity.statusDetail} />
          </DetailSection>
        </>}
        {!!Object.keys(row.uploadedFields || {}).length && <DetailSection title="Uploaded Spreadsheet Columns">
          {Object.entries(row.uploadedFields).map(([header, value]) => <DetailRow key={header} icon={FileText} label={header} value={value || "—"} />)}
        </DetailSection>}
      </div>
    </section>
  </div>;
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="participant-detail-section"><h4>{title}</h4>{children}</section>;
}
