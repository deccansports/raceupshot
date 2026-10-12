"use client";

import type { RaceEvent } from "@/lib/types";
import { expandRelayTeamUploadRows, suggestParticipantTicket } from "@/lib/participant-roster-import";
import { CheckCircle2, Download, FileSpreadsheet, LoaderCircle, Plus, UploadCloud } from "lucide-react";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

type SheetRow = Record<string, unknown>;
type ImportTicket = { id: string; name: string; participationMode?: "INDIVIDUAL" | "RELAY"; relayTeamSize?: 2 | 3 | null; sessionId?: string; sessionName?: string };
type MappingKey = "bib" | "name" | "nameOnBib" | "participantId" | "registrationId" | "sessionId" | "email" | "mobile" | "category" | "registrationStatus" | "gender" | "ageGroup" | "age" | "tshirtSize" | "chipCode" | "athleteBandCode" | "emergencyContactName" | "emergencyContact" | "dateOfBirth" | "bloodGroup" | "medicalHistory" | "medicalCondition" | "relayTeamName" | "relayMemberNumber" | "relayMemberRole";

const fields: Array<{ key: MappingKey; label: string; required?: boolean; aliases: string[] }> = [
  { key: "bib", label: "BIB Number", required: true, aliases: ["bib", "bib no", "bib number", "race number"] },
  { key: "name", label: "Athlete Name", aliases: ["name", "full name", "athlete name", "participant name"] },
  { key: "nameOnBib", label: "Name on BIB", aliases: ["name on bib", "bib name", "name to print on bib"] },
  { key: "participantId", label: "Participant ID", aliases: ["participant id", "participant uid", "participant uuid", "uuid"] },
  { key: "registrationId", label: "Registration ID", aliases: ["registration id", "registration uid"] },
  { key: "sessionId", label: "Session ID", aliases: ["session id", "session", "race session", "start session"] },
  { key: "email", label: "Email", aliases: ["email", "email address", "e-mail"] },
  { key: "mobile", label: "Mobile", aliases: ["mobile", "mobile number", "phone", "contact number"] },
  { key: "category", label: "Category / Contest", aliases: ["category", "contest", "contest name", "ticket", "ticket name"] },
  { key: "registrationStatus", label: "Registration Status", aliases: ["registration status", "booking status", "participant status"] },
  { key: "gender", label: "Gender", aliases: ["gender", "sex"] },
  { key: "ageGroup", label: "Age Group", aliases: ["age group", "age category", "agegroup"] },
  { key: "age", label: "Age", aliases: ["age", "athlete age"] },
  { key: "tshirtSize", label: "T-Shirt Size", aliases: ["t-shirt", "t shirt", "tshirt", "t-shirt size", "t shirt size", "tshirt size", "shirt size", "jersey size"] },
  { key: "chipCode", label: "Chip Code", aliases: ["chip code", "chipcode", "timing chip", "rfid"] },
  { key: "athleteBandCode", label: "Athlete Band Code", aliases: ["athlete band code", "athlete band", "band code", "wristband", "qr band"] },
  { key: "emergencyContactName", label: "Emergency Contact Name", aliases: ["emergency contact name", "emergency name", "emergency contact person", "emergency person"] },
  { key: "emergencyContact", label: "Emergency Contact Number", aliases: ["emergency contact", "emergency contact number", "emergency number", "emergency phone", "emergency mobile", "emergency contact mobile"] },
  { key: "dateOfBirth", label: "Date of Birth", aliases: ["date of birth", "dob", "birth date", "dateofbirth"] },
  { key: "bloodGroup", label: "Blood Group", aliases: ["blood group", "bloodgroup", "blood type"] },
  { key: "medicalHistory", label: "Medical History", aliases: ["medical history", "medical notes", "health history"] },
  { key: "medicalCondition", label: "Medical Condition", aliases: ["medical condition", "medical conditions", "health condition"] },
  { key: "relayTeamName", label: "Relay Team Name", aliases: ["relay team name", "team name", "relay name"] },
  { key: "relayMemberNumber", label: "Relay Member Number", aliases: ["relay member number", "member number", "team member number", "member no"] },
  { key: "relayMemberRole", label: "Relay Member Role", aliases: ["relay member role", "member role", "relay leg", "team role"] },
];

type ImportSummary = {
  imported: number;
  created: number;
  updated: number;
  chipCodesAssigned: number;
  athleteBandsAssigned: number;
  fileName: string;
};

type ManualMember = { name: string; email: string; role: string };
const blankMember = (): ManualMember => ({ name: "", email: "", role: "" });

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function suggestedMappings(headers: string[]): Record<MappingKey, string> {
  return Object.fromEntries(fields.map((field) => [field.key, field.aliases.map((alias) => headers.find((header) => normalized(header) === normalized(alias))).find(Boolean) || ""])) as Record<MappingKey, string>;
}

function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(cell); cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = []; cell = "";
    } else cell += character;
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function gridToRows(grid: unknown[][]): SheetRow[] {
  const headers = (grid[0] || []).map((cell, index) => String(cell ?? "").trim() || `Column ${index + 1}`);
  return grid.slice(1).flatMap((cells) => cells.some((cell) => String(cell ?? "").trim())
    ? [Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]))]
    : []);
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function categoryGroups(rows: SheetRow[], column: string): Array<{ source: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const source = column ? String(row[column] ?? "").trim() : "";
    counts.set(source, (counts.get(source) ?? 0) + 1);
  }
  return [...counts].map(([source, count]) => ({ source, count })).sort((a, b) => a.source.localeCompare(b.source, undefined, { numeric: true }));
}

function suggestedTicketMappings(rows: SheetRow[], column: string, tickets: Array<{ id: string; name: string }>): Record<string, string> {
  return Object.fromEntries(categoryGroups(rows, column).map(({ source }) => {
    const name = suggestParticipantTicket(source, tickets.map((ticket) => ticket.name));
    const matches = tickets.filter((ticket) => ticket.name === name);
    return [source, matches.length === 1 ? matches[0].id : ""];
  }));
}

export function ImportFlow({ events, onImported }: { events: RaceEvent[]; onImported?: () => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [eventSlug, setEventSlug] = useState(events[0]?.slug ?? "");
  const event = events.find((item) => item.slug === eventSlug);
  const tickets = useMemo<ImportTicket[]>(() => event?.ticketDefinitions?.length ? event.ticketDefinitions : event?.tickets?.length ? event.tickets : (event?.categories ?? []).map((name) => ({ id: name, name, participationMode: "INDIVIDUAL", relayTeamSize: null })), [event]);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<SheetRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mappings, setMappings] = useState<Record<MappingKey, string>>(() => suggestedMappings([]));
  const [ticketMappings, setTicketMappings] = useState<Record<string, string>>({});
  const [previewPage, setPreviewPage] = useState(1);
  const [showAllRows, setShowAllRows] = useState(true);
  const [editingRow, setEditingRow] = useState<number | null>(null);
  const [newColumnName, setNewColumnName] = useState("");
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [manualTicketId, setManualTicketId] = useState("");
  const [manualBib, setManualBib] = useState("");
  const [manualTeamName, setManualTeamName] = useState("");
  const [manualMembers, setManualMembers] = useState<ManualMember[]>([blankMember()]);
  const [manualBusy, setManualBusy] = useState(false);
  const groups = useMemo(() => categoryGroups(rows, mappings.category), [rows, mappings.category]);
  const unmappedGroups = groups.filter(({ source }) => tickets.length && !ticketMappings[source]);
  const missingBibRows = rows.filter((row) => !String(row[mappings.bib] ?? "").trim()).length;
  const ready = Boolean(tickets.length && rows.length && mappings.bib && !missingBibRows && !unmappedGroups.length);
  const previewSize = showAllRows ? Math.max(rows.length, 1) : 50;
  const pageCount = Math.max(1, Math.ceil(rows.length / previewSize));
  const preview = useMemo(() => rows.slice((previewPage - 1) * previewSize, previewPage * previewSize), [rows, previewPage, previewSize]);
  useEffect(() => {
    if (editingRow === null) return;
    document.querySelector(`[data-import-row="${editingRow}"]`)?.scrollIntoView({ block: "center" });
  }, [editingRow]);

  function clearSheet() {
    setFileName(""); setRows([]); setHeaders([]); setMappings(suggestedMappings([])); setTicketMappings({}); setPreviewPage(1); setShowAllRows(true); setEditingRow(null); setNewColumnName(""); setMessage(""); setSummary(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  function changeEvent(slug: string) {
    setEventSlug(slug); clearSheet(); setReplaceExisting(false); setManualTicketId(""); setManualBib(""); setManualTeamName(""); setManualMembers([blankMember()]);
  }

  async function chooseSpreadsheet(change: ChangeEvent<HTMLInputElement>) {
    const file = change.target.files?.[0];
    if (!file) return;
    setBusy(true); setSummary(null); setMessage("Reading participant spreadsheet…");
    try {
      let parsedRows: SheetRow[];
      if (file.name.toLowerCase().endsWith(".csv")) parsedRows = gridToRows(parseCsv(await file.text()));
      else {
        const excel = await import("read-excel-file/browser");
        const sheets = await excel.default(file);
        parsedRows = sheets.flatMap((sheet) => gridToRows(sheet.data));
      }
      parsedRows = expandRelayTeamUploadRows(parsedRows);
      if (!parsedRows.length) throw new Error("The spreadsheet does not contain participant rows.");
      if (parsedRows.length > 10_000) throw new Error("Participant uploads are limited to 10,000 rows at a time.");
      const columns = [...new Set(parsedRows.flatMap((row) => Object.keys(row)))];
      const detected = suggestedMappings(columns);
      setFileName(file.name); setRows(parsedRows); setHeaders(columns); setMappings(detected);
      setTicketMappings(suggestedTicketMappings(parsedRows, detected.category, tickets)); setPreviewPage(1); setShowAllRows(parsedRows.length <= 500); setEditingRow(null);
      setMessage(`${parsedRows.length.toLocaleString()} participant row${parsedRows.length === 1 ? "" : "s"} loaded. Review every source category and its event ticket before importing.`);
    } catch (error) {
      clearSheet(); setMessage(error instanceof Error ? error.message : "The spreadsheet could not be read.");
    } finally { setBusy(false); }
  }

  function addMissingRow() {
    const sourceCategory = groups[0]?.source ?? "";
    const row = Object.fromEntries(headers.map((header) => [header, header === mappings.category ? sourceCategory : ""]));
    const index = rows.length;
    setRows((current) => [...current, row]);
    setEditingRow(index);
    setPreviewPage(1);
    setShowAllRows(true);
  }

  function addMissingColumn() {
    const column = newColumnName.trim();
    if (!column || column.length > 160 || headers.some((header) => normalized(header) === normalized(column))) {
      setMessage("Enter a new column name (up to 160 characters) that is not already in the sheet.");
      return;
    }
    setHeaders((current) => [...current, column]);
    setRows((current) => current.map((row) => ({ ...row, [column]: "" })));
    const detected = suggestedMappings([column]);
    setMappings((current) => Object.fromEntries(Object.entries(current).map(([key, value]) => [key, value || detected[key as MappingKey]])) as Record<MappingKey, string>);
    setNewColumnName("");
    setMessage(`Added “${column}”. Fill it in the row review before importing.`);
  }

  async function importParticipants() {
    if (!event || !ready) return;
    if (replaceExisting && !window.confirm(`Replace the previously uploaded participant roster for “${event.name}”? Provider-synced rows will be retained.`)) return;
    setBusy(true); setSummary(null); setMessage("Validating BIB, chip and athlete-band assignments…");
    try {
      const response = await fetch(`/api/admin/participants/${encodeURIComponent(event.id)}/import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileName, rows, mappings, categoryMappings: ticketMappings, replaceExisting }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string; data?: ImportSummary };
      if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error || "Unable to import participants.");
      setSummary(payload.data);
      setMessage(`Imported ${payload.data.imported.toLocaleString()} participants. Their BIB, chip and athlete-band codes are now available to the volunteer app.`);
      onImported?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to import participants.");
    } finally { setBusy(false); }
  }

  function downloadTemplate() {
    const templateHeaders = [...fields.map((field) => field.label), "Contest Type", "Team Bib Number", "Athlete 1 Name", "Athlete 1 Email", "Athlete 1 Role", "Athlete 2 Name", "Athlete 2 Email", "Athlete 2 Role", "Athlete 3 Name", "Athlete 3 Email", "Athlete 3 Role"];
    const relayTicket = tickets.find((ticket) => ticket.participationMode === "RELAY");
    const individualTicket = tickets.find((ticket) => ticket.participationMode !== "RELAY");
    const samples: Record<string, string>[] = [{
      "Category / Contest": individualTicket?.name || "Individual Triathlon", "BIB Number": "1001", "Athlete Name": "Individual Athlete", Email: "individual@example.com", "Registration Status": "REGISTERED",
    }, {
      "Category / Contest": relayTicket?.name || "Relay Triathlon", "Contest Type": `Relay - ${relayTicket?.relayTeamSize || 3} Athletes`, "Relay Team Name": "Bergman Relay Team A", "Team Bib Number": "1501",
      "Athlete 1 Name": "Rahul Sharma", "Athlete 1 Email": "rahul@example.com", "Athlete 1 Role": "Swimming",
      "Athlete 2 Name": "Amit Patil", "Athlete 2 Email": "amit@example.com", "Athlete 2 Role": "Cycling",
      "Athlete 3 Name": relayTicket?.relayTeamSize === 2 ? "" : "Rohit Desai", "Athlete 3 Email": relayTicket?.relayTeamSize === 2 ? "" : "rohit@example.com", "Athlete 3 Role": relayTicket?.relayTeamSize === 2 ? "" : "Running",
    }];
    const blob = new Blob([[templateHeaders, ...samples.map((sample) => templateHeaders.map((header) => sample[header] || ""))].map((line) => line.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "race-upshot-participant-template.csv"; anchor.click();
    URL.revokeObjectURL(url);
  }

  const manualTicket = tickets.find((ticket) => ticket.id === manualTicketId);
  const manualTeamSize = manualTicket?.participationMode === "RELAY" ? manualTicket.relayTeamSize ?? 2 : 1;

  function selectManualTicket(ticketId: string) {
    const ticket = tickets.find((item) => item.id === ticketId);
    const count = ticket?.participationMode === "RELAY" ? ticket.relayTeamSize ?? 2 : 1;
    setManualTicketId(ticketId);
    setManualTeamName("");
    setManualMembers(Array.from({ length: count }, (_, index) => manualMembers[index] || blankMember()));
  }

  async function addManualParticipant() {
    if (!event || !manualTicket) return;
    const relay = manualTicket.participationMode === "RELAY";
    if (!manualBib.trim()) { setMessage("Enter the participant or team BIB number."); return; }
    if (relay && !manualTeamName.trim()) { setMessage("Enter the relay team name."); return; }
    if (manualMembers.length !== manualTeamSize || manualMembers.some((member) => !member.name.trim() || !member.email.trim())) {
      setMessage(`Enter the name and email address for all ${manualTeamSize} athlete${manualTeamSize === 1 ? "" : "s"}.`); return;
    }
    setManualBusy(true); setSummary(null); setMessage("Validating and creating participant records…");
    try {
      const manualRows = manualMembers.map((member, index) => ({
        "BIB Number": manualBib.trim(), "Athlete Name": member.name.trim(), Email: member.email.trim(),
        "Category / Contest": manualTicket.name, "Registration Status": "REGISTERED",
        "Relay Team Name": relay ? manualTeamName.trim() : "", "Relay Member Number": relay ? String(index + 1) : "",
        "Relay Member Role": relay ? member.role.trim() : "",
      }));
      const response = await fetch(`/api/admin/participants/${encodeURIComponent(event.id)}/import`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: `manual-entry-${new Date().toISOString()}.json`, rows: manualRows,
          mappings: { bib: "BIB Number", name: "Athlete Name", email: "Email", category: "Category / Contest", registrationStatus: "Registration Status", relayTeamName: "Relay Team Name", relayMemberNumber: "Relay Member Number", relayMemberRole: "Relay Member Role" },
          categoryMappings: { [manualTicket.name]: manualTicket.id }, replaceExisting: false,
        }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string; data?: ImportSummary };
      if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error || "Unable to add participants.");
      setSummary(payload.data); setMessage(relay ? `Relay team ${manualTeamName.trim()} added with ${manualTeamSize} athletes under BIB ${manualBib.trim()}.` : `${manualMembers[0].name.trim()} added under BIB ${manualBib.trim()}.`);
      setManualBib(""); setManualTeamName(""); setManualMembers(Array.from({ length: manualTeamSize }, blankMember)); onImported?.();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to add participants."); }
    finally { setManualBusy(false); }
  }

  return <div className="form-card">
    <div className="admin-card-head"><div><h2>Participant roster upload</h2><p>Preview athletes, map spreadsheet categories to event tickets, and link chip and band codes to BIBs. This does not import or change race results.</p></div><span className="status-pill">Volunteer ready</span></div>
    <div className="form-grid">
      <div className="field"><label>Event</label><select value={eventSlug} onChange={(input) => changeEvent(input.target.value)}>{events.map((item) => <option value={item.slug} key={item.id}>{item.name}</option>)}</select></div>
      <div className="field"><label>Configured event tickets</label><input readOnly value={tickets.length ? `${tickets.length} ticket${tickets.length === 1 ? "" : "s"}` : "No tickets configured"} /></div>
    </div>
    <div className="form-actions">
      <label className="button button-primary"><UploadCloud /> Choose CSV/XLSX<input ref={fileInput} type="file" accept=".csv,.xlsx,.xls" hidden onChange={(change) => void chooseSpreadsheet(change)} /></label>
      <button className="button" type="button" onClick={downloadTemplate}><Download /> Download template</button>
    </div>
    <section className="admin-card" style={{ marginTop: 18 }}>
      <div className="admin-card-head"><div><h3>Manual participant entry</h3><p>Choose an individual or relay ticket. Relay teams create separate athlete profiles under one team BIB.</p></div><span className="status-pill">Individual &amp; relay</span></div>
      <div className="form-grid"><div className="field"><label>Contest *</label><select value={manualTicketId} onChange={(change) => selectManualTicket(change.target.value)}><option value="">Choose contest…</option>{tickets.map((ticket) => <option key={ticket.id} value={ticket.id}>{ticket.name}{ticket.participationMode === "RELAY" ? ` · Relay ${ticket.relayTeamSize}` : " · Individual"}</option>)}</select></div><div className="field"><label>{manualTicket?.participationMode === "RELAY" ? "Team BIB Number" : "BIB Number"} *</label><input value={manualBib} onChange={(change) => setManualBib(change.target.value)} /></div>{manualTicket?.participationMode === "RELAY" ? <div className="field"><label>Team Name *</label><input value={manualTeamName} onChange={(change) => setManualTeamName(change.target.value)} /></div> : null}</div>
      {manualTicket ? <div className="relay-manual-members">{manualMembers.map((member, index) => <article className="admin-card" key={index}><h4>Athlete {index + 1}{member.role ? ` · ${member.role}` : ""}</h4><div className="form-grid"><div className="field"><label>Full Name *</label><input value={member.name} onChange={(change) => setManualMembers((current) => current.map((item, memberIndex) => memberIndex === index ? { ...item, name: change.target.value } : item))} /></div><div className="field"><label>Email Address *</label><input type="email" value={member.email} onChange={(change) => setManualMembers((current) => current.map((item, memberIndex) => memberIndex === index ? { ...item, email: change.target.value } : item))} /></div>{manualTicket.participationMode === "RELAY" ? <div className="field"><label>Relay Role / Leg</label><input placeholder={index === 0 ? "Swimming" : index === 1 ? "Cycling" : "Running"} value={member.role} onChange={(change) => setManualMembers((current) => current.map((item, memberIndex) => memberIndex === index ? { ...item, role: change.target.value } : item))} /></div> : null}</div></article>)}</div> : null}
      {manualTicket?.participationMode === "RELAY" ? <button className="button" type="button" disabled={manualMembers.length >= manualTeamSize} onClick={() => setManualMembers((current) => [...current, blankMember()])}><Plus /> {manualMembers.length >= manualTeamSize ? `Team limit reached (${manualTeamSize})` : "+ Add Team Member"}</button> : null}
      <div className="form-actions" style={{ marginTop: 14 }}><button className="button button-primary" type="button" disabled={!manualTicket || manualBusy} onClick={() => void addManualParticipant()}>{manualBusy ? <LoaderCircle className="spinning" /> : <Plus />} {manualBusy ? "Saving…" : manualTicket?.participationMode === "RELAY" ? "Add Relay Team" : "Add Participant"}</button></div>
    </section>
    {fileName && <section className="admin-card" style={{ marginTop: 18 }}>
      <div className="admin-card-head"><div><h3><FileSpreadsheet /> {fileName}</h3><p>{rows.length.toLocaleString()} rows · only BIB is required for individual entries; missing athlete and contact details can be added later.</p></div></div>
      <div className="form-grid">{fields.map((field) => <div className="field" key={field.key}><label>{field.label}{field.required ? " *" : ""}</label><select value={mappings[field.key]} onChange={(change) => { const column = change.target.value; setMappings((current) => ({ ...current, [field.key]: column })); if (field.key === "category") setTicketMappings(suggestedTicketMappings(rows, column, tickets)); setPreviewPage(1); }}><option value="">Not mapped</option>{headers.map((header) => <option key={header} value={header}>{header}</option>)}</select></div>)}</div>
      <div className="form-actions" style={{ marginTop: 12 }}><input aria-label="New spreadsheet column name" placeholder="Missing a column? Enter its name" value={newColumnName} onChange={(change) => setNewColumnName(change.target.value)} /><button type="button" className="button" onClick={addMissingColumn}>Add column</button></div>
      {!!tickets.length && <section style={{ marginTop: 18 }}><h3>Map spreadsheet categories to event tickets</h3><p>Each distinct category must have a ticket. Relay tickets accept exactly their configured 2 or 3 members per shared BIB; individual tickets continue to require one athlete per BIB.</p><div className="form-grid">{groups.map(({ source, count }) => { const ticket = tickets.find((item) => item.id === ticketMappings[source]); return <div className="field" key={source}><label>{source || "No category in file"} · {count.toLocaleString()} row{count === 1 ? "" : "s"}</label><select value={ticketMappings[source] ?? ""} onChange={(change) => setTicketMappings((current) => ({ ...current, [source]: change.target.value }))}><option value="">Choose event ticket…</option>{tickets.map((item) => <option key={item.id} value={item.id}>{item.name}{item.participationMode === 'RELAY' ? ` · Relay ${item.relayTeamSize}` : ' · Individual'}</option>)}</select>{ticket ? <small>{ticket.participationMode === 'RELAY' ? `Relay · ${ticket.relayTeamSize} athletes share one BIB` : 'Individual · one athlete per BIB'}</small> : null}</div>; })}</div>{!!unmappedGroups.length && <p className="publish-blocked">Map {unmappedGroups.length} remaining categor{unmappedGroups.length === 1 ? "y" : "ies"} before importing.</p>}</section>}
      {!tickets.length && <p className="publish-blocked">No event tickets are configured. Add tickets to this event before importing participants.</p>}
      {!!missingBibRows && <p className="publish-blocked">{missingBibRows.toLocaleString()} row{missingBibRows === 1 ? " is" : "s are"} missing a BIB. Fill every BIB before importing.</p>}
      <label style={{ display: "flex", gap: 9, alignItems: "center", marginTop: 16 }}><input type="checkbox" checked={replaceExisting} onChange={(change) => setReplaceExisting(change.target.checked)} /> Replace previously uploaded roster rows for this event</label>
      {!!preview.length && <>
        <div className="admin-card-head" style={{ marginTop: 18 }}><div><h3>Review participant rows</h3><p>Showing {((previewPage - 1) * previewSize + 1).toLocaleString()}–{Math.min(previewPage * previewSize, rows.length).toLocaleString()} of {rows.length.toLocaleString()} rows. Every source column is shown; edit a row to fill missing details.</p></div></div>
        <div className="form-actions"><button type="button" className="button" onClick={addMissingRow}><Plus /> Add missing participant row</button>{rows.length > 50 && <button type="button" className="button" onClick={() => { setShowAllRows((current) => !current); setPreviewPage(1); setEditingRow(null); }}>{showAllRows ? "Use 50-row pages" : `Show all ${rows.length.toLocaleString()} rows`}</button>}</div>
        <div className="table-wrap"><table><thead><tr><th>ROW</th>{headers.map((header) => <th key={header}>{header}</th>)}<th>EVENT TICKET</th><th>ACTION</th></tr></thead><tbody>{preview.map((row, index) => {
          const rowIndex = (previewPage - 1) * previewSize + index;
          const source = mappings.category ? String(row[mappings.category] ?? "").trim() : "";
          return <tr key={rowIndex} data-import-row={rowIndex}><td>{rowIndex + 2}</td>{headers.map((header) => <td key={header}>{editingRow === rowIndex ? <input aria-label={`Row ${rowIndex + 2} ${header}`} value={String(row[header] ?? "")} onChange={(change) => setRows((current) => current.map((item, itemIndex) => itemIndex === rowIndex ? { ...item, [header]: change.target.value } : item))} /> : String(row[header] ?? "").trim() || "—"}</td>)}<td>{tickets.find((ticket) => ticket.id === ticketMappings[source])?.name || (tickets.length ? "Needs mapping" : "—")}</td><td><button type="button" className="button" onClick={() => setEditingRow(editingRow === rowIndex ? null : rowIndex)}>{editingRow === rowIndex ? "Done" : "Edit"}</button></td></tr>;
        })}</tbody></table></div>
        {!showAllRows && <div className="participant-pagination"><span>Page {previewPage} of {pageCount}</span><div><button type="button" disabled={previewPage <= 1} onClick={() => setPreviewPage((page) => page - 1)}>Previous</button><button type="button" disabled={previewPage >= pageCount} onClick={() => setPreviewPage((page) => page + 1)}>Next</button></div></div>}
      </>}
      <div className="form-actions" style={{ marginTop: 18 }}><button type="button" className="button button-primary" disabled={!ready || busy} onClick={() => void importParticipants()}>{busy ? <LoaderCircle className="spinning" /> : <UploadCloud />} {busy ? "Processing…" : `Import ${rows.length.toLocaleString()} participants`}</button></div>
    </section>}
    {summary && <div className="admin-kpis" style={{ marginTop: 18 }}><article className="kpi-card"><CheckCircle2 /><span>IMPORTED</span><strong>{summary.imported}</strong><small>{summary.created} new · {summary.updated} updated</small></article><article className="kpi-card"><CheckCircle2 /><span>CHIPS</span><strong>{summary.chipCodesAssigned}</strong><small>Linked to event BIBs</small></article><article className="kpi-card"><CheckCircle2 /><span>ATHLETE BANDS</span><strong>{summary.athleteBandsAssigned}</strong><small>Scannable in volunteer app</small></article></div>}
    {message && <p className={summary ? "publish-success" : "publish-blocked"}>{message}</p>}
  </div>;
}
