"use client";

import type { Athlete, RaceEvent } from "@/lib/types";
import {
  buildResultCategoryMappings,
  inferResultCategoryMapping,
  resultCategorySourceGroups,
  resultCategorySourceValues,
} from "@/lib/result-category-mapping";
import { CheckCircle2, FileSpreadsheet, Mail, Plus, RefreshCw, Trash2, UploadCloud, X } from "lucide-react";
import { ChangeEvent, useMemo, useRef, useState } from "react";

type SheetRow = Record<string, unknown>;

interface ResultImportSummary {
  imported: number;
  skipped: number;
  replaced: number;
  categories: Array<{ source: string; target: string; count: number }>;
  fileName: string;
}

const resultFieldMappings = [
  ["bib", "Bib Number", ["bib", "bib no", "bib number", "race number"]],
  ["name", "Athlete Name", ["name", "full name", "athlete name", "participant name"]],
  ["email", "Email", ["email", "e-mail", "email address", "athlete email"]],
  ["mobile", "Mobile", ["mobile", "mobile number", "phone", "contact number"]],
  ["status", "Status", ["status", "result status", "race status"]],
  ["chipTime", "Chip / Finish Time", ["chip time", "finish time", "net time", "overall time"]],
  ["gunTime", "Gun Time", ["gun time", "gross time", "official time"]],
  ["gender", "Gender", ["gender", "sex"]],
  ["ageGroup", "Age Group", ["age group", "age category", "agegroup"]],
  ["club", "Club", ["club", "team", "running club"]],
  ["country", "Country", ["country", "country code", "nationality"]],
  ["city", "City", ["city", "location"]],
  ["overallRank", "Overall Rank", ["overall rank", "o rank", "rank", "position"]],
  ["genderRank", "Gender Rank", ["gender rank", "g rank"]],
  ["categoryRank", "Category Rank", ["category rank", "c rank", "age rank", "age group rank"]],
  ["swim", "Swim Leg", ["swim", "swim time"]],
  ["run1", "Run 1 Leg", ["run 1", "run1", "first run"]],
  ["t1", "T1 Transition", ["t1", "transition 1", "transition1"]],
  ["bike", "Bike Leg", ["bike", "bike time", "cycle", "cycling"]],
  ["t2", "T2 Transition", ["t2", "transition 2", "transition2"]],
  ["run", "Run Leg", ["run", "run time"]],
  ["run2", "Run 2 Leg", ["run 2", "run2", "second run"]],
  ["startSplit", "Start Split", ["start", "race start", "start elapsed"]],
  ["swimFinishSplit", "Swim Finish Split", ["swim finish", "swim finish elapsed"]],
  ["bikeStartSplit", "Bike Start Split", ["bike start", "bike start elapsed"]],
  ["bikeFinishSplit", "Bike Finish Split", ["bike finish", "bike finish elapsed"]],
  ["runStartSplit", "Run Start Split", ["run start", "run start elapsed"]],
  ["finishSplit", "Race Finish Split", ["race finish", "finish", "finish elapsed"]],
  ["startTimeOfDay", "Start Time of Day", ["start time of day", "start · time of day"]],
  ["finishTimeOfDay", "Finish Time of Day", ["finish time of day", "finish · time of day", "race finish time of day"]],
] as const;

function suggestedColumnMappings(headers: string[]): Record<string, string> {
  return Object.fromEntries(resultFieldMappings.map(([field, , aliases]) => [field, aliases.map((alias) => headers.find((header) => normalized(header) === normalized(alias))).find(Boolean) ?? ""]));
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9.]+/g, " ").trim();
}

function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function gridToRows(grid: unknown[][], sheetName: string): SheetRow[] {
  const headers = (grid[0] ?? []).map((cell, index) => String(cell ?? "").trim() || `Column ${index + 1}`);
  return grid.slice(1).flatMap((cells) => {
    if (!cells.some((cell) => String(cell ?? "").trim())) return [];
    return [Object.fromEntries([
      ...headers.map((header, index) => [header, cells[index] ?? ""]),
      ["__sheet", sheetName],
    ])];
  });
}

export function PublishResults({ events, resultSets }: { events: RaceEvent[]; resultSets: Record<string, Athlete[]> }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [eventSlug, setEventSlug] = useState(events[0]?.slug ?? "");
  const selected = events.find((event) => event.slug === eventSlug);
  const categories = selected?.categories.length ? selected.categories : ["Overall"];
  const [category, setCategory] = useState(categories[0] ?? "Overall");
  const [emailSummary, setEmailSummary] = useState<{ total: number; sent: number; failed: number; pending: number } | null>(null);
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMessage, setEmailMessage] = useState("");
  const [fileName, setFileName] = useState("");
  const [sheetRows, setSheetRows] = useState<SheetRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [categoryColumn, setCategoryColumn] = useState("");
  const [categoryMappings, setCategoryMappings] = useState<Record<string, string>>({});
  const [categoryAssignment, setCategoryAssignment] = useState<"column" | "single">("column");
  const [singleImportCategory, setSingleImportCategory] = useState(categories[0] ?? "Overall");
  const [columnMappings, setColumnMappings] = useState<Record<string, string>>({});
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const eventAthletes = useMemo(() => resultSets[eventSlug] ?? [], [eventSlug, resultSets]);
  const athletes = useMemo(
    () => category === "Overall"
      ? eventAthletes
      : eventAthletes.filter((athlete) => normalized(athlete.category) === normalized(category)),
    [category, eventAthletes],
  );
  const sourceCategories = useMemo(() => resultCategorySourceValues(sheetRows, categoryColumn), [categoryColumn, sheetRows]);
  const sourceCategoryGroups = useMemo(() => resultCategorySourceGroups(sheetRows, categoryColumn), [categoryColumn, sheetRows]);
  const mappedRows = useMemo(
    () => categoryAssignment === "single"
      ? (singleImportCategory ? sheetRows.length : 0)
      : sheetRows.filter((row) => Boolean(categoryMappings[String(row[categoryColumn] ?? "").trim()])).length,
    [categoryAssignment, categoryColumn, categoryMappings, sheetRows, singleImportCategory],
  );
  const customRows = useMemo(() => sheetRows.map((row, index) => ({ row, index })).filter(({ row }) => row.__custom === true), [sheetRows]);
  const counts = useMemo(() => {
    const valid = athletes.filter((athlete) => athlete.status.toLowerCase() === "finished").length;
    const excluded = athletes.filter((athlete) => ["dnf", "dns", "dnq", "dq", "dsq", "otl"].includes(athlete.status.toLowerCase().replaceAll(" ", "_"))).length;
    return { valid, excluded, review: athletes.length - valid - excluded };
  }, [athletes]);

  function clearImport(defaultCategory = categories[0] ?? "Overall") {
    setFileName("");
    setSheetRows([]);
    setHeaders([]);
    setCategoryColumn("");
    setCategoryMappings({});
    setColumnMappings({});
    setCategoryAssignment("column");
    setSingleImportCategory(defaultCategory);
    setReplaceExisting(false);
    setImportMessage("");
    if (fileInput.current) fileInput.current.value = "";
  }

  function mappingsFor(rows: SheetRow[], column: string, targetCategories: string[]) {
    return buildResultCategoryMappings(rows, column, targetCategories);
  }

  function changeEvent(slug: string) {
    setEventSlug(slug);
    const event = events.find((item) => item.slug === slug);
    setCategory(event?.categories[0] || "Overall");
    setSingleImportCategory(event?.categories[0] || "Overall");
    setEmailSummary(null);
    setEmailMessage("");
    clearImport(event?.categories[0] || "Overall");
  }

  async function chooseSpreadsheet(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !selected) return;
    setImportBusy(true);
    setImportMessage("Reading spreadsheet…");
    try {
      let rows: SheetRow[] = [];
      let sheetNames: string[] = [];
      if (file.name.toLowerCase().endsWith(".csv")) {
        sheetNames = ["CSV"];
        rows = gridToRows(parseCsv(await file.text()), "CSV");
      } else {
        const excel = await import("read-excel-file/browser");
        const sheets = await excel.default(file);
        sheetNames = sheets.map((sheet) => sheet.sheet);
        rows = sheets.flatMap((sheet) => gridToRows(sheet.data, sheet.sheet));
      }
      if (!rows.length) throw new Error("The spreadsheet does not contain any data rows.");
      if (rows.length > 25_000) throw new Error("This importer accepts up to 25,000 rows at a time.");
      const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
      const targets = selected.categories.length ? selected.categories : ["Overall"];
      const inferredCategoryMapping = inferResultCategoryMapping(rows, columns, targets);
      setFileName(file.name);
      setSheetRows(rows);
      setHeaders(columns);
      setCategoryColumn(inferredCategoryMapping.column);
      setCategoryMappings(inferredCategoryMapping.mappings);
      setColumnMappings(suggestedColumnMappings(columns));
      setCategoryAssignment("column");
      setSingleImportCategory(selected.categories[0] || "Overall");
      setImportMessage(
        `${rows.length.toLocaleString()} rows loaded from ${sheetNames.length} sheet${sheetNames.length === 1 ? "" : "s"}. `
        + `${inferredCategoryMapping.mappedRows.toLocaleString()} rows were automatically matched to event tickets/contests`
        + (inferredCategoryMapping.unmatchedRows ? `; review ${inferredCategoryMapping.unmatchedRows.toLocaleString()} unmatched rows below.` : "."),
      );
    } catch (error) {
      clearImport();
      setImportMessage(error instanceof Error ? error.message : "The spreadsheet could not be read.");
    } finally {
      setImportBusy(false);
    }
  }

  function changeCategoryColumn(column: string) {
    setCategoryColumn(column);
    const targets = selected?.categories.length ? selected.categories : ["Overall"];
    setCategoryMappings(mappingsFor(sheetRows, column, targets));
  }

  function addCustomRow() {
    const columns = [...new Set([...headers, "Bib Number", "Name", "Email", "Mobile", "Status", "Chip Time", "Gun Time", "Gender", "Age Group", "Club", "Country", "City", "Overall Rank", "Gender Rank", "Category Rank", "Swim", "RUN 1", "T1", "Bike", "T2", "Run", "RUN 2", "Start", "Swim Finish", "Bike Start", "Bike Finish", "Run Start", "Race Finish", "Start · Time of Day", "Finish · Time of Day", "__sheet"])];
    setHeaders(columns);
    setColumnMappings((current) => Object.keys(current).length ? current : suggestedColumnMappings(columns));
    setCategoryAssignment("single");
    setSingleImportCategory((current) => current || categories[0] || "Overall");
    setFileName((current) => current || "custom-results.csv");
    setSheetRows((current) => [...current, { "Bib Number": "", Name: "", Email: "", Mobile: "", Status: "FINISHED", "Chip Time": "", "Gun Time": "", Gender: "", "Age Group": "", Club: "", Country: "", City: "", "Overall Rank": "", "Gender Rank": "", "Category Rank": "", Swim: "", "RUN 1": "", T1: "", Bike: "", T2: "", Run: "", "RUN 2": "", Start: "", "Swim Finish": "", "Bike Start": "", "Bike Finish": "", "Run Start": "", "Race Finish": "", "Start · Time of Day": "", "Finish · Time of Day": "", __sheet: "Custom rows", __custom: true }]);
    setImportMessage("Custom result row added. Enter a bib or athlete name before importing.");
  }

  function updateCustomRow(index: number, key: string, value: string) {
    setSheetRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row));
  }

  function removeCustomRow(index: number) {
    setSheetRows((current) => current.filter((_row, rowIndex) => rowIndex !== index));
  }

  async function importResults() {
    if (!selected || !fileName || !sheetRows.length || !mappedRows) return;
    if (replaceExisting && !window.confirm(`Replace all ${eventAthletes.length.toLocaleString()} existing results for “${selected.name}” with the mapped spreadsheet rows?`)) return;
    setImportBusy(true);
    setImportMessage("Validating and writing mapped results to Workers KV…");
    try {
      const response = await fetch(`/api/admin/results/${encodeURIComponent(selected.id)}/import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName,
          rows: sheetRows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "__custom"))),
          categoryColumn: categoryAssignment === "single" ? "__sheet" : categoryColumn,
          categoryMappings: categoryAssignment === "single"
            ? Object.fromEntries(resultCategorySourceValues(sheetRows, "__sheet").map((source) => [source, singleImportCategory]))
            : Object.fromEntries(Object.entries(categoryMappings).filter(([, target]) => Boolean(target))),
          columnMappings: Object.fromEntries(Object.entries(columnMappings).filter(([, source]) => Boolean(source))),
          replaceExisting,
        }),
      });
      const payload = await response.json() as { ok?: boolean; data?: ResultImportSummary; error?: string };
      if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error || "Unable to import results.");
      const summary = payload.data;
      setImportMessage(`${summary.imported.toLocaleString()} results imported across ${summary.categories.length} mappings · ${summary.skipped.toLocaleString()} skipped${summary.replaced ? ` · ${summary.replaced.toLocaleString()} old results replaced` : ""}. Refreshing…`);
      window.setTimeout(() => window.location.reload(), 900);
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : "Unable to import results.");
    } finally {
      setImportBusy(false);
    }
  }

  async function resultEmailRequest(action: "preview" | "send", retryFailed = false) {
    if (!selected) return;
    setEmailBusy(true);
    setEmailMessage(action === "preview" ? "Checking result recipients…" : "Sending result emails…");
    try {
      const perform = async (nextAction: "preview" | "send", dryRunToken?: string) => {
        const response = await fetch(`/api/admin/results/${encodeURIComponent(selected.id)}/notify`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: nextAction, category, channels: ["EMAIL"], retryFailed, confirmed: nextAction === "send", dryRunToken }),
        });
        const payload = await response.json() as { ok?: boolean; data?: (NonNullable<typeof emailSummary> & {dryRun?:{token:string;count:number}}); error?: string };
        if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error || "Unable to process result emails.");
        return payload.data;
      };
      const preview = await perform("preview");
      if (action === "send" && (!preview.dryRun?.count || !window.confirm(`Send ${preview.dryRun.count} email notification(s) for ${category}? This is a dry-run count; each batch is limited to 10. Provider acceptance is not delivery.`))) {
        setEmailSummary(preview);
        setEmailMessage("No messages sent.");
        return;
      }
      const summary = action === "send" ? await perform("send", preview.dryRun?.token) : preview;
      setEmailSummary(summary);
      setEmailMessage(`${summary.sent} provider accepted · ${summary.failed} failed · ${summary.pending} pending`);
    } catch (error) {
      setEmailMessage(error instanceof Error ? error.message : "Unable to process result emails.");
    } finally {
      setEmailBusy(false);
    }
  }

  async function deleteResults() {
    if (!selected || !eventAthletes.length) return;
    if (!window.confirm(
      `Permanently delete all ${eventAthletes.length.toLocaleString()} result records for “${selected.name}”? Delivery audit history is preserved. This cannot be undone.`,
    )) return;
    setDeleteBusy(true);
    setImportMessage("Deleting published results from Workers KV…");
    try {
      const response = await fetch(`/api/admin/results/${encodeURIComponent(selected.id)}`, { method: "DELETE" });
      const payload = await response.json() as {
        ok?: boolean;
        data?: { deletedResults: number; deletedNotifications: number };
        error?: string;
      };
      if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error || "Unable to delete results.");
      setImportMessage(
        `${payload.data.deletedResults.toLocaleString()} results deleted. The mobile app will return to live tracking after refresh.`,
      );
      window.setTimeout(() => window.location.reload(), 900);
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : "Unable to delete results.");
      setDeleteBusy(false);
    }
  }

  return (
    <>
      <div className="form-card result-source-card">
        <div className="admin-card-head">
          <h2>Choose result set</h2>
          <div className="form-actions">
            {eventAthletes.length > 0 && (
              <button type="button" className="button button-danger" disabled={deleteBusy || importBusy} onClick={() => void deleteResults()}>
                <Trash2 /> {deleteBusy ? "Deleting…" : "Delete results"}
              </button>
            )}
            <span className="status-pill">RACEUPSHOT KV</span>
          </div>
        </div>
        <div className="result-source-grid">
          <div className="field"><label htmlFor="publish-event">Event</label><select id="publish-event" value={eventSlug} onChange={(event) => changeEvent(event.target.value)}>{events.map((event) => <option key={event.id} value={event.slug}>{event.name}</option>)}</select></div>
          <div className="field"><label htmlFor="publish-category">Review category</label><select id="publish-category" value={category} onChange={(event) => { setCategory(event.target.value); setEmailSummary(null); setEmailMessage(""); }}>{categories.map((item) => <option key={item}>{item}</option>)}</select></div>
          <input ref={fileInput} hidden type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => void chooseSpreadsheet(event)} />
          <button type="button" className="button button-secondary" disabled={!selected || importBusy} onClick={() => fileInput.current?.click()}><UploadCloud /> {fileName ? "Choose another file" : "Upload results"}</button>
          <button type="button" className="button" disabled={!selected || importBusy} onClick={addCustomRow}><Plus /> Add custom row</button>
        </div>
        <div className={`result-file-state ${eventAthletes.length || sheetRows.length ? "ready" : ""}`}>
          <FileSpreadsheet />
          <span>
            <b>{fileName || (eventAthletes.length ? `${eventAthletes.length.toLocaleString()} indexed result records` : "No result records")}</b>
            <small>{sheetRows.length ? `${sheetRows.length.toLocaleString()} spreadsheet rows ready to map` : `Loaded directly from raceupshot:event:${selected?.id ?? "event"}:results:index`}</small>
          </span>
          {(eventAthletes.length > 0 || sheetRows.length > 0) && <span className="status-pill status-official"><CheckCircle2 /> {sheetRows.length ? "Parsed" : "Stored"}</span>}
        </div>

        {sheetRows.length > 0 && (
          <div className="result-import-mapping">
            <div className="admin-card-head">
              <div><h3>Automatic ticket / contest mapping</h3><p>All workbook sheets are imported together. Race Upshot detects the ticket or contest column (including worksheet names) and maps matching rows automatically.</p></div>
              <span className="status-pill">{mappedRows.toLocaleString()} / {sheetRows.length.toLocaleString()} rows mapped</span>
            </div>
            <div className="result-category-mode">
              <button type="button" className={categoryAssignment === "column" ? "active" : ""} onClick={() => setCategoryAssignment("column")}>Automatic from workbook</button>
              <button type="button" className={categoryAssignment === "single" ? "active" : ""} onClick={() => setCategoryAssignment("single")}>Override every row</button>
            </div>
            {categoryAssignment === "single" ? <div className="field"><label>Upload every row to category</label><select value={singleImportCategory} onChange={(event) => setSingleImportCategory(event.target.value)}>{(selected?.categories.length ? selected.categories : ["Overall"]).map((target) => <option key={target}>{target}</option>)}</select></div> : <><div className="field">
              <label>Detected ticket / contest source</label>
              <select value={categoryColumn} onChange={(event) => changeCategoryColumn(event.target.value)}>
                {headers.map((header) => <option value={header} key={header}>{header === "__sheet" ? "Worksheet name" : header}</option>)}
              </select>
            </div><div className="ticket-mapping-list">
              {sourceCategoryGroups.map((group) => {
                const mappedTargets = [...new Set(group.sources.map((source) => categoryMappings[source]).filter(Boolean))];
                const selectedTarget = mappedTargets.length === 1 ? mappedTargets[0] : "";
                return (
                  <div className="ticket-mapping-row" key={group.id}>
                    <span><b>{group.label || "Blank / unspecified"}</b><small>{group.count.toLocaleString()} sheet rows{group.sources.length > 1 ? ` · ${group.sources.length} spelling/case variants combined` : ""}</small></span>
                    <span>maps to</span>
                    <select value={selectedTarget} onChange={(event) => setCategoryMappings((current) => ({
                      ...current,
                      ...Object.fromEntries(group.sources.map((source) => [source, event.target.value])),
                    }))}>
                      <option value="">Do not import</option>
                      {(selected?.categories.length ? selected.categories : ["Overall"]).map((target) => <option key={target} value={target}>{target}</option>)}
                    </select>
                  </div>
                );
              })}
            </div></>}
            <div className="result-column-mapping">
              <div className="admin-card-head"><div><h3>Map custom spreadsheet columns</h3><p>Choose which spreadsheet column supplies each Race Upshot result field. Unused fields may stay blank.</p></div><button type="button" className="button" onClick={() => setColumnMappings(suggestedColumnMappings(headers))}><RefreshCw /> Auto-map</button></div>
              <div className="result-column-grid">{resultFieldMappings.map(([field,label]) => <label key={field}><span>{label}{field === "bib" || field === "name" ? " *" : ""}</span><select value={columnMappings[field] ?? ""} onChange={(event) => setColumnMappings((current) => ({ ...current, [field]: event.target.value }))}><option value="">Not mapped</option>{headers.filter((header) => !header.startsWith("__")).map((header) => <option value={header} key={header}>{header}</option>)}</select></label>)}</div>
            </div>
            {!!customRows.length && <div className="custom-result-rows"><div className="admin-card-head"><div><h3>Custom result rows</h3><p>Manual rows are uploaded together with the spreadsheet rows to the selected category.</p></div><button type="button" className="button" onClick={addCustomRow}><Plus /> Add another row</button></div>{customRows.map(({row,index},customIndex) => <article key={index}><header><b>Custom row {customIndex + 1}</b><button type="button" aria-label={`Remove custom row ${customIndex + 1}`} onClick={() => removeCustomRow(index)}><X /></button></header><div className="custom-result-row-grid">{[["Bib Number","Bib"],["Name","Name"],["Email","Email"],["Mobile","Mobile"],["Status","Status"],["Chip Time","Chip Time"],["Gun Time","Gun Time"],["Gender","Gender"],["Age Group","Age Group"],["Club","Club"],["Overall Rank","Overall Rank"],["Gender Rank","Gender Rank"],["Category Rank","Category Rank"]].map(([key,label]) => <label key={key}><span>{label}</span><input value={String(row[key] ?? "")} onChange={(event) => updateCustomRow(index,key,event.target.value)}/></label>)}</div></article>)}</div>}
            <label className="result-replace-option">
              <input type="checkbox" checked={replaceExisting} onChange={(event) => setReplaceExisting(event.target.checked)} />
              <span><b>Replace existing event results</b><small>Off keeps existing records and updates matching imported IDs. Turn on only for a complete replacement sheet.</small></span>
            </label>
            <div className="form-actions">
              <button type="button" className="button" disabled={importBusy} onClick={() => clearImport()}>Cancel import</button>
              <button type="button" className="button button-primary" disabled={importBusy || !mappedRows} onClick={() => void importResults()}><UploadCloud /> {importBusy ? "Importing…" : `Import ${mappedRows.toLocaleString()} mapped results`}</button>
            </div>
          </div>
        )}
        {importMessage && <div className="success-banner">{importMessage}</div>}
        <p className="publish-help">Accepted files: CSV and XLSX. The file is parsed in the authenticated admin browser; normalized result rows are then written directly to Workers KV. No raw spreadsheet is retained.</p>
      </div>

      <div className="form-card" style={{ marginTop: 16 }}>
        <div className="admin-card-head"><h2>{selected?.name ?? "No event"} · {category}</h2><span className={`status-pill status-${selected?.status ?? "draft"}`}>{selected?.status ?? "unavailable"}</span></div>
        <div className="admin-kpis">
          <div className="kpi-card"><span>VALID RESULTS</span><strong>{counts.valid.toLocaleString()}</strong><small>Finished records</small></div>
          <div className="kpi-card"><span>PENDING REVIEW</span><strong>{counts.review.toLocaleString()}</strong><small>Other statuses</small></div>
          <div className="kpi-card"><span>DNF / DNS / DNQ / DSQ / OTL</span><strong>{counts.excluded.toLocaleString()}</strong><small>Excluded from rank</small></div>
          <div className="kpi-card"><span>CATEGORY TOTAL</span><strong>{athletes.length.toLocaleString()}</strong><small>{eventAthletes.length.toLocaleString()} event results</small></div>
        </div>
        <div className="result-email-actions">
          <div><Mail /><span><b>Result notification email</b><small>Bergtecno template #18 · only finished athletes with a stored email address</small></span></div>
          <button className="button" disabled={emailBusy || !selected?.hasResults} onClick={() => void resultEmailRequest("preview")}><RefreshCw /> Preview recipients</button>
          <button className="button button-primary" disabled={emailBusy || !emailSummary?.pending} onClick={() => void resultEmailRequest("send")}><Mail /> Send result emails</button>
          {!!emailSummary?.failed && <button className="button" disabled={emailBusy} onClick={() => void resultEmailRequest("send", true)}>Retry failed</button>}
        </div>
        {emailMessage && <div className="success-banner">{emailMessage}</div>}
      </div>
    </>
  );
}
