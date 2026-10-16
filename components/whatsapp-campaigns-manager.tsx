"use client";

import type { RaceEvent } from "@/lib/types";
import { WHATSAPP_CAMPAIGN_TOKEN_OPTIONS, type WhatsAppCampaign } from "@/lib/whatsapp-campaigns";
import { CheckCircle2, FileUp, Filter, History, Loader2, MessageCircle, Plus, RefreshCw, Search, Send, TestTube2, Trash2, XCircle } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";

type ApiResult<T> = { ok: true; data: T } | { ok: false; error?: string };
type Participant = { id: string; name: string; bib: string; mobile: string; email: string; category: string };
type Preview = { count: number; sample: Array<{ id: string; name: string; bib: string; mobile: string; category: string }> };

export function WhatsAppCampaignsManager({ events, initialCampaigns, initialEventId }: { events: RaceEvent[]; initialCampaigns: WhatsAppCampaign[]; initialEventId: string }) {
  const testEvents = events.filter((event) => /test/i.test(event.name));
  const [view, setView] = useState<"SEND" | "HISTORY">("SEND");
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  const [eventId, setEventId] = useState(testEvents.some((event) => event.id === initialEventId) ? initialEventId : testEvents[0]?.id || "");
  const [targetType, setTargetType] = useState<"EVENT" | "SINGLE_PARTICIPANT">("EVENT");
  const [campaignLabel, setCampaignLabel] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [parameters, setParameters] = useState<string[]>(["{{name}}"]);
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaFilename, setMediaFilename] = useState("");
  const [testMobile, setTestMobile] = useState("");
  const [participantQuery, setParticipantQuery] = useState("");
  const [participantResults, setParticipantResults] = useState<Participant[]>([]);
  const [selectedParticipant, setSelectedParticipant] = useState<Participant | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [working, setWorking] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [logSearch, setLogSearch] = useState("");
  const selectedEvent = events.find((event) => event.id === eventId);
  const eventCategories = useMemo(() => [...new Set([...(selectedEvent?.tickets?.map((ticket) => ticket.name) ?? []), ...(selectedEvent?.categories ?? [])])].filter(Boolean), [selectedEvent]);

  const payload = () => ({ eventId, targetType, participantId: selectedParticipant?.id || "", campaignLabel, campaignName, categories, parameters: parameters.map((value) => ({ value })), mediaUrl, mediaFilename });

  useEffect(() => {
    if (targetType !== "SINGLE_PARTICIPANT" || participantQuery.trim().length < 2 || !eventId) return;
    const timer = window.setTimeout(() => { void fetch(`/api/admin/communications/whatsapp/participants?eventId=${encodeURIComponent(eventId)}&q=${encodeURIComponent(participantQuery)}`, { cache: "no-store" }).then((response) => response.json()).then((body: ApiResult<Participant[]>) => { if (body.ok) setParticipantResults(body.data); }).catch(() => undefined); }, 300);
    return () => window.clearTimeout(timer);
  }, [eventId, participantQuery, targetType]);

  function resetAudience() { setPreview(null); setSelectedParticipant(null); setParticipantQuery(""); setParticipantResults([]); }
  function validate(): string | null {
    if (!eventId) return "Choose the test event.";
    if (!campaignLabel.trim()) return "Enter a campaign label.";
    if (!campaignName.trim()) return "Enter the exact approved AiSensy API campaign name.";
    if (targetType === "SINGLE_PARTICIPANT" && !selectedParticipant) return "Choose one participant.";
    if (!parameters.length) return "Add at least one template parameter.";
    if (parameters.some((parameter) => !parameter.trim())) return "Choose a variable or enter static text for every parameter.";
    return null;
  }

  async function runPreview() {
    const invalid = validate(); if (invalid) { setError(invalid); return; }
    setWorking("preview"); setError(""); setNotice("");
    try { const response = await fetch("/api/admin/communications/whatsapp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload(), action: "PREVIEW" }) }); const body = await response.json() as ApiResult<Preview>; if (!response.ok || !body.ok) throw new Error(body.ok ? "Unable to preview audience." : body.error || "Unable to preview audience."); setPreview(body.data); setNotice(`${body.data.count} unique WhatsApp recipient${body.data.count === 1 ? "" : "s"} matched.`); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to preview audience."); } finally { setWorking(""); }
  }

  async function sendTest() {
    const invalid = validate(); if (invalid) { setError(invalid); return; } if (!testMobile.trim()) { setError("Enter the test WhatsApp number."); return; }
    setWorking("test"); setError(""); setNotice("");
    try { const response = await fetch("/api/admin/communications/whatsapp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload(), action: "TEST", mobile: testMobile }) }); const body = await response.json() as ApiResult<unknown>; if (!response.ok || !body.ok) throw new Error(body.ok ? "Test was not accepted." : body.error || "Test was not accepted."); setNotice(`Test WhatsApp accepted for ${testMobile}. Provider acceptance is not confirmed delivery.`); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to send test WhatsApp."); } finally { setWorking(""); }
  }

  async function sendBatches(campaign: WhatsAppCampaign, retryFailed = false): Promise<WhatsAppCampaign> {
    const response = await fetch(`/api/admin/communications/whatsapp/${encodeURIComponent(campaign.id)}/send`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ retryFailed }) });
    const body = await response.json() as ApiResult<WhatsAppCampaign>; if (!response.ok || !body.ok) throw new Error(body.ok ? "WhatsApp batch failed." : body.error || "WhatsApp batch failed.");
    setCampaigns((current) => current.map((row) => row.id === body.data.id ? body.data : row));
    return body.data.recipients.some((row) => row.status === "PENDING") ? sendBatches(body.data) : body.data;
  }

  async function createAndSend(event: FormEvent) {
    event.preventDefault(); const invalid = validate(); if (invalid) { setError(invalid); return; }
    if (!preview?.count) { setError("Preview the audience before sending."); return; }
    if (!window.confirm(`Send ${campaignName} to ${preview.count} recipient${preview.count === 1 ? "" : "s"} from ${selectedEvent?.name || "the selected event"}?`)) return;
    setWorking("send"); setError(""); setNotice("Creating WhatsApp campaign…");
    try { const response = await fetch("/api/admin/communications/whatsapp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload()) }); const body = await response.json() as ApiResult<WhatsAppCampaign>; if (!response.ok || !body.ok) throw new Error(body.ok ? "Unable to create campaign." : body.error || "Unable to create campaign."); setCampaigns((current) => [body.data, ...current]); setView("HISTORY"); const done = await sendBatches(body.data); setNotice(`Campaign complete: ${done.acceptedCount} accepted, ${done.failedCount} failed, ${done.unconfirmedCount} unconfirmed.`); setPreview(null); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to send WhatsApp campaign."); } finally { setWorking(""); }
  }

  async function uploadMedia(file: File | undefined) {
    if (!file) return; setWorking("upload"); setError("");
    try { const data = new FormData(); data.set("file", file); const response = await fetch("/api/admin/communications/whatsapp/media", { method: "POST", body: data }); const body = await response.json() as ApiResult<{ url: string; filename: string }>; if (!response.ok || !body.ok) throw new Error(body.ok ? "Upload failed." : body.error || "Upload failed."); setMediaUrl(body.data.url); setMediaFilename(body.data.filename); setNotice(`${body.data.filename} uploaded for the template header.`); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to upload media."); } finally { setWorking(""); }
  }

  const visibleCampaigns = campaigns.filter((campaign) => !logSearch.trim() || `${campaign.campaignLabel} ${campaign.campaignName} ${campaign.status} ${campaign.recipients.map((row) => `${row.name} ${row.bib} ${row.mobile}`).join(" ")}`.toLowerCase().includes(logSearch.toLowerCase()));
  const totalAccepted = campaigns.reduce((sum, campaign) => sum + campaign.acceptedCount, 0); const totalFailed = campaigns.reduce((sum, campaign) => sum + campaign.failedCount, 0); const totalUnconfirmed = campaigns.reduce((sum, campaign) => sum + campaign.unconfirmedCount, 0);

  return <div className="communications-stack">
    <div className="communication-scope"><button type="button" className={view === "SEND" ? "active" : ""} onClick={() => setView("SEND")}><Send /> New broadcast</button><button type="button" className={view === "HISTORY" ? "active" : ""} onClick={() => setView("HISTORY")}><History /> Campaign history</button></div>
    {notice && <div className="success-banner">{notice}</div>}{error && <div className="error-banner">{error}</div>}
    {view === "SEND" ? <form className="admin-card communication-compose" onSubmit={(event) => void createAndSend(event)} onChange={() => setPreview(null)}>
      <div className="admin-card-head"><div><h2><MessageCircle /> Dispatch WhatsApp broadcast</h2><p>Use an approved AiSensy API campaign and keep body parameters in exact template order.</p></div><span className="status-pill">test event only</span></div>
      <div className="communication-scope"><button type="button" className={targetType === "EVENT" ? "active" : ""} onClick={() => { setTargetType("EVENT"); resetAudience(); }}>Event participants</button><button type="button" className={targetType === "SINGLE_PARTICIPANT" ? "active" : ""} onClick={() => { setTargetType("SINGLE_PARTICIPANT"); resetAudience(); }}>Single participant</button></div>
      <div className="form-grid">
        <div className="field full"><label>Event</label><select value={eventId} onChange={(event) => { setEventId(event.target.value); setCategories([]); resetAudience(); }} required><option value="">Choose test event</option>{testEvents.map((event) => <option key={event.id} value={event.id}>{event.name} · {event.date}</option>)}</select>{!testEvents.length && <small>No event containing “Test” is available. WhatsApp sending remains locked.</small>}</div>
        {targetType === "SINGLE_PARTICIPANT" && <div className="field full"><label>Search participant</label>{selectedParticipant ? <div className="audience-readout"><b>{selectedParticipant.name}</b> · BIB {selectedParticipant.bib || "—"} · {selectedParticipant.mobile}<button type="button" onClick={() => resetAudience()}>Change</button></div> : <><input value={participantQuery} onChange={(event) => { const next = event.target.value; setParticipantQuery(next); if (next.trim().length < 2) setParticipantResults([]); }} placeholder="Name, BIB, mobile, email or participant ID" />{participantQuery.trim().length >= 2 && participantResults.length > 0 && <div className="campaign-search-results">{participantResults.map((participant) => <button type="button" key={participant.id} onClick={() => { setSelectedParticipant(participant); setParticipantQuery(participant.name); setParticipantResults([]); }}><b>{participant.name}</b><small>BIB {participant.bib || "—"} · {participant.category || "No category"} · {participant.mobile || "No mobile"}</small></button>)}</div>}</>}</div>}
        <div className="field"><label>Campaign label</label><input value={campaignLabel} onChange={(event) => setCampaignLabel(event.target.value)} placeholder="Test event race-day update" required /></div>
        <div className="field"><label>AiSensy API campaign name</label><input value={campaignName} onChange={(event) => setCampaignName(event.target.value)} placeholder="Exact activated campaign name" required /><small>Template and language are selected inside AiSensy.</small></div>
        {targetType === "EVENT" && eventCategories.length > 0 && <div className="field full"><label>Ticket / category audience</label><div className="volunteer-point-grid">{eventCategories.map((category) => <label key={category} className={categories.includes(category) ? "selected" : ""}><input type="checkbox" checked={categories.includes(category)} onChange={(event) => setCategories((current) => event.target.checked ? [...current, category] : current.filter((value) => value !== category))} /><span><b>{category}</b></span></label>)}</div><small>No selection sends to all eligible event participants.</small></div>}
        <div className="field full"><label>Body parameters in approved order</label><div className="campaign-parameter-list">{parameters.map((parameter, index) => <div key={index}><b>{`{{${index + 1}}}`}</b><select value={WHATSAPP_CAMPAIGN_TOKEN_OPTIONS.some((option) => option.value === parameter) ? parameter : "__custom__"} onChange={(event) => setParameters((current) => current.map((value, itemIndex) => itemIndex === index ? event.target.value === "__custom__" ? "" : event.target.value : value))}><option value="">Choose variable</option>{WHATSAPP_CAMPAIGN_TOKEN_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.value} · {option.label}</option>)}<option value="__custom__">Custom static text</option></select>{!WHATSAPP_CAMPAIGN_TOKEN_OPTIONS.some((option) => option.value === parameter) && <input value={parameter} onChange={(event) => setParameters((current) => current.map((value, itemIndex) => itemIndex === index ? event.target.value : value))} placeholder="Static text" />}<button type="button" aria-label={`Remove parameter ${index + 1}`} onClick={() => setParameters((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 /></button></div>)}</div><button type="button" className="button" onClick={() => setParameters((current) => [...current, "{{name}}"])}><Plus /> Add parameter</button></div>
        <div className="field full"><label>Template header media (optional)</label><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => void uploadMedia(event.target.files?.[0])} disabled={working === "upload"} />{mediaUrl && <div className="audience-readout"><FileUp /> {mediaFilename}<button type="button" onClick={() => { setMediaUrl(""); setMediaFilename(""); }}>Remove</button></div>}<small>Approved template must have a matching image or document header. Stored in R2 at an unguessable HTTPS URL.</small></div>
        <div className="field full communication-test"><label>Test WhatsApp</label><div><input value={testMobile} onChange={(event) => setTestMobile(event.target.value)} placeholder="+91…" /><button type="button" className="button" disabled={Boolean(working)} onClick={() => void sendTest()}>{working === "test" ? <Loader2 /> : <TestTube2 />} Send test</button></div><small>Uses sample athlete values and the exact configured parameter order.</small></div>
      </div>
      {preview?.sample.length ? <div className="audience-sample"><strong>Audience sample</strong>{preview.sample.map((row) => <span key={`${row.id}:${row.mobile}`}>{row.name} · BIB {row.bib || "—"} · {row.category || "No category"} · {row.mobile}</span>)}</div> : null}
      <div className="form-actions"><button type="button" className="button" disabled={Boolean(working)} onClick={() => void runPreview()}><Filter /> {working === "preview" ? "Previewing…" : "Preview audience"}</button><button className="button button-primary" disabled={Boolean(working) || !preview?.count}><Send /> {working === "send" ? "Sending…" : "Create & send"}</button></div>
    </form> : <>
      <div className="admin-kpis volunteer-kpis"><article className="kpi-card"><MessageCircle /><span>Campaigns</span><strong>{campaigns.length}</strong></article><article className="kpi-card"><CheckCircle2 /><span>Provider accepted</span><strong>{totalAccepted}</strong></article><article className="kpi-card"><XCircle /><span>Failed</span><strong>{totalFailed}</strong></article><article className="kpi-card"><RefreshCw /><span>Unconfirmed</span><strong>{totalUnconfirmed}</strong></article></div>
      <section className="admin-card"><div className="admin-card-head"><div><h2>WhatsApp campaign history</h2><p>Accepted means submitted to AiSensy, not confirmed delivered.</p></div><span className="status-pill">{visibleCampaigns.length} campaigns</span></div><label className="volunteer-search"><Search /><input value={logSearch} onChange={(event) => setLogSearch(event.target.value)} placeholder="Search campaign, recipient, BIB or mobile" /></label><div className="campaign-list">{visibleCampaigns.map((campaign) => <article key={campaign.id}><div><strong>{campaign.campaignLabel}</strong><span className="status-pill">{campaign.status.replaceAll("_", " ")}</span></div><p>{campaign.campaignName} · {events.find((event) => event.id === campaign.eventId)?.name || campaign.eventId}</p><small>{campaign.acceptedCount} accepted · {campaign.failedCount} failed · {campaign.unconfirmedCount} unconfirmed · {campaign.recipients.length} recipients · {new Date(campaign.createdAt).toLocaleString("en-IN")}</small>{campaign.recipients.some((row) => ["FAILED", "UNCONFIRMED"].includes(row.status)) && <button type="button" className="button" disabled={Boolean(working)} onClick={() => { if (!window.confirm("Retry failed and unconfirmed recipients? Check AiSensy first to avoid duplicates.")) return; setWorking("retry"); void sendBatches(campaign, true).then((done) => setNotice(`Retry complete: ${done.acceptedCount} accepted.`)).catch((caught) => setError(caught instanceof Error ? caught.message : "Retry failed.")).finally(() => setWorking("")); }}><RefreshCw /> Retry failed</button>}<details><summary>Recipient audit</summary><div className="table-wrap"><table className="leaderboard"><thead><tr><th>Recipient</th><th>BIB / Category</th><th>Status</th><th>Attempt</th><th>Details</th></tr></thead><tbody>{campaign.recipients.map((row) => <tr key={`${campaign.id}:${row.id}:${row.mobile}`}><td><b>{row.name}</b><small>{row.mobile}</small></td><td>{row.bib || "—"}<small>{row.category || "—"}</small></td><td>{row.status}</td><td>{row.attemptedAt ? new Date(row.attemptedAt).toLocaleString("en-IN") : "—"}</td><td>{row.error || row.resolvedParameters?.join(" · ") || "—"}</td></tr>)}</tbody></table></div></details></article>)}</div>{!visibleCampaigns.length && <p className="admin-empty">No WhatsApp campaigns found.</p>}</section>
    </>}
  </div>;
}
