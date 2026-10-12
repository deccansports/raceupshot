"use client";

import type { CommunicationCampaign } from "@/lib/communications";
import type { RaceEvent } from "@/lib/types";
import { Filter, MailCheck, Megaphone, RefreshCw, Send } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";

interface AudiencePreview {
  count: number;
  sample: Array<{ email: string; name: string; city: string; state: string; country: string; categories: string[] }>;
}

interface Props {
  events: RaceEvent[];
  initialCampaigns: CommunicationCampaign[];
  initialEventId?: string;
}

export function CommunicationsManager({ events, initialCampaigns, initialEventId = "" }: Props) {
  const [scope, setScope] = useState<"GLOBAL" | "EVENT">(initialEventId ? "EVENT" : "GLOBAL");
  const [eventId, setEventId] = useState(initialEventId);
  const [preview, setPreview] = useState<AudiencePreview | null>(null);
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  const [working, setWorking] = useState(false);
  const [testWorking, setTestWorking] = useState(false);
  const [notice, setNotice] = useState("");
  const selectedEvent = useMemo(() => events.find((event) => event.id === eventId), [eventId, events]);
  const activeCampaignIds = useMemo(() => campaigns
    .filter((campaign) => campaign.providerCampaignId && ["QUEUED", "PROCESSING", "SES_ACCEPTED"].includes(campaign.status))
    .map((campaign) => campaign.id)
    .join(","), [campaigns]);
  const activePollingDelay = campaigns.some((campaign) =>
    campaign.providerCampaignId
    && ["QUEUED", "PROCESSING", "SES_ACCEPTED"].includes(campaign.status)
    && Date.now() - new Date(campaign.createdAt).getTime() < 60_000)
    ? 10_000
    : 30_000;

  useEffect(() => {
    if (!activeCampaignIds) return;
    const ids = activeCampaignIds.split(",");
    const timer = window.setInterval(() => {
      void Promise.all(ids.map(async (id) => {
        const response = await fetch(`/api/admin/communications/${encodeURIComponent(id)}/status`, { method: "POST" });
        const payload = await response.json() as { ok?: boolean; data?: CommunicationCampaign };
        if (response.ok && payload.ok && payload.data) {
          setCampaigns((items) => items.map((item) => item.id === id ? payload.data! : item));
        }
      })).catch(() => undefined);
    }, activePollingDelay);
    return () => window.clearInterval(timer);
  }, [activeCampaignIds, activePollingDelay]);

  function parseVariables(value: FormDataEntryValue | null) {
    return Object.fromEntries(String(value || "").split(/\r?\n/).flatMap((line) => {
      const separator = line.indexOf("=");
      if (separator <= 0) return [];
      const key = line.slice(0, separator).trim();
      const variableValue = line.slice(separator + 1).trim();
      return key ? [[key, variableValue]] : [];
    }));
  }

  function formPayload(form: HTMLFormElement) {
    const values = new FormData(form);
    return {
      scope,
      eventId,
      subject: String(values.get("subject") || ""),
      message: String(values.get("message") || ""),
      contentType: String(values.get("contentType") || "TEXT") as "TEXT" | "HTML",
      variables: parseVariables(values.get("variables")),
      filters: {
        country: String(values.get("country") || ""),
        state: String(values.get("state") || ""),
        city: String(values.get("city") || ""),
        category: String(values.get("category") || ""),
      },
    };
  }

  async function sendTest(form: HTMLFormElement) {
    const body = formPayload(form);
    const recipientEmail = String(new FormData(form).get("testEmail") || "").trim();
    const focusField = (name: string) => {
      const field = form.elements.namedItem(name);
      if (field instanceof HTMLElement) field.focus();
    };
    if (!recipientEmail) {
      setNotice("Enter the test recipient email address.");
      focusField("testEmail");
      return;
    }
    if (body.subject.trim().length < 3) {
      setNotice("Enter an email subject before sending the test.");
      focusField("subject");
      return;
    }
    if (body.message.trim().length < 3) {
      setNotice(`Enter the ${body.contentType === "HTML" ? "email HTML" : "email message"} before sending the test.`);
      focusField("message");
      return;
    }
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    setTestWorking(true);
    setNotice("");
    try {
      const response = await fetch("/api/admin/communications/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          recipientEmail,
          subject: body.subject,
          message: body.message,
          contentType: body.contentType,
          eventId: body.eventId,
          variables: body.variables,
        }),
      });
      const payload = await response.json() as { ok?: boolean; data?: { recipientEmail?: string }; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Unable to send the test email.");
      setNotice(`Test email sent to ${payload.data?.recipientEmail || recipientEmail}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to send the test email.");
    } finally {
      setTestWorking(false);
    }
  }

  async function previewAudience(form: HTMLFormElement) {
    setWorking(true);
    setNotice("");
    try {
      const body = formPayload(form);
      const response = await fetch("/api/admin/communications/audience", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: body.scope, eventId: body.eventId, filters: body.filters }),
      });
      const payload = await response.json() as { ok?: boolean; data?: AudiencePreview; error?: string };
      if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error || "Unable to preview audience.");
      setPreview(payload.data);
      setNotice(`${payload.data.count.toLocaleString()} unique email recipient${payload.data.count === 1 ? "" : "s"} matched.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to preview audience.");
    } finally {
      setWorking(false);
    }
  }

  async function sendAllBatches(campaign: CommunicationCampaign, retryFailed = false): Promise<CommunicationCampaign> {
    const response = await fetch(`/api/admin/communications/${encodeURIComponent(campaign.id)}/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ retryFailed }),
    });
    const payload = await response.json() as { ok?: boolean; data?: CommunicationCampaign; error?: string };
    if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error || "A communication batch failed.");
    const next = payload.data;
    setCampaigns((items) => items.map((item) => item.id === next.id ? next : item));
    setNotice(`Submitting ${((next.queuedCount || 0) + (next.suppressedCount || 0)).toLocaleString()} of ${next.recipients.length.toLocaleString()} to Bergtecno…`);
    return next.status === "SUBMITTING" || next.status === "SENDING"
      ? sendAllBatches(next)
      : next;
  }

  async function refreshCampaign(campaign: CommunicationCampaign) {
    setWorking(true);
    setNotice("Refreshing Bergtecno delivery status…");
    try {
      const response = await fetch(`/api/admin/communications/${encodeURIComponent(campaign.id)}/status`, { method: "POST" });
      const payload = await response.json() as { ok?: boolean; data?: CommunicationCampaign; error?: string };
      if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error || "Unable to refresh delivery status.");
      setCampaigns((items) => items.map((item) => item.id === campaign.id ? payload.data! : item));
      setNotice(`Delivery status refreshed: ${payload.data.deliveredCount || 0} delivered, ${payload.data.failedCount || 0} failed.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to refresh delivery status.");
    } finally {
      setWorking(false);
    }
  }

  async function retryCampaign(campaign: CommunicationCampaign) {
    setWorking(true);
    setNotice(`Retrying ${campaign.failedCount.toLocaleString()} failed recipient${campaign.failedCount === 1 ? "" : "s"}…`);
    try {
      const completed = await sendAllBatches(campaign, true);
      setNotice(completed.failedCount
        ? `Retry submitted with ${completed.failedCount.toLocaleString()} recipient${completed.failedCount === 1 ? "" : "s"} still rejected.`
        : `Retry accepted by Bergtecno. Delivery status will update separately.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to retry communication.");
    } finally {
      setWorking(false);
    }
  }

  async function createAndSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = formPayload(form);
    if (!preview?.count) {
      setNotice("Preview the audience first. No confirmed recipients are selected.");
      return;
    }
    if (!window.confirm(`Send “${body.subject}” to ${preview.count.toLocaleString()} recipient${preview.count === 1 ? "" : "s"} via Bergtecno?`)) return;
    setWorking(true);
    setNotice("Creating communication campaign…");
    try {
      const response = await fetch("/api/admin/communications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json() as { ok?: boolean; data?: CommunicationCampaign; error?: string };
      if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error || "Unable to create campaign.");
      setCampaigns((items) => [payload.data!, ...items]);
      const completed = await sendAllBatches(payload.data);
      setNotice(completed.failedCount
        ? `Bergtecno queued the campaign with ${completed.failedCount.toLocaleString()} rejected recipient${completed.failedCount === 1 ? "" : "s"}.`
        : `Bergtecno accepted the campaign into its delivery queue. Delivery status will refresh automatically.`);
      setPreview(null);
      form.reset();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to send communication.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="communications-stack">
      <form className="admin-card communication-compose" onSubmit={(event) => void createAndSend(event)} onChange={() => setPreview(null)}>
        <div className="admin-card-head">
          <div><h2><Megaphone /> Compose communication</h2><p>Filter the database, preview the audience, then send through Bergtecno.</p></div>
          <span className="status-pill">{scope === "GLOBAL" ? "all database" : "event audience"}</span>
        </div>
        {notice && <div className="success-banner">{notice}</div>}
        <div className="communication-scope">
          <button type="button" className={scope === "GLOBAL" ? "active" : ""} onClick={() => { setScope("GLOBAL"); setPreview(null); }}>All database</button>
          <button type="button" className={scope === "EVENT" ? "active" : ""} onClick={() => { setScope("EVENT"); setPreview(null); }}>One event</button>
        </div>
        <div className="form-grid">
          <div className="field full">
            <label>{scope === "EVENT" ? "Event" : "Event context for HTML variables"}</label>
            <select value={eventId} onChange={(event) => setEventId(event.target.value)} required={scope === "EVENT"}>
              <option value="">Choose event</option>
              {events.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.date}</option>)}
            </select>
            {scope === "GLOBAL" && <small>Optional for audience filtering, but required to fill event_name, event_date, event_location, event_type and event_id in HTML.</small>}
          </div>
          <div className="field"><label>Country filter</label><input name="country" placeholder="All countries" /></div>
          <div className="field"><label>State filter</label><input name="state" placeholder="All states" /></div>
          <div className="field"><label>City filter</label><input name="city" placeholder="All cities" /></div>
          <div className="field"><label>Category filter</label><input name="category" placeholder="All categories" /></div>
          <div className="field"><label>Audience</label><div className="audience-readout">{preview ? `${preview.count.toLocaleString()} recipients` : "Preview required"}</div></div>
          <div className="field full"><label>Email subject</label><input name="subject" required defaultValue={selectedEvent ? `${selectedEvent.name} update` : "Race Upshot news"} placeholder="Race Upshot news" /></div>
          <div className="field"><label>Email format</label><select name="contentType" defaultValue="TEXT"><option value="TEXT">Styled text email</option><option value="HTML">HTML email</option></select></div>
          <div className="field full"><label>Message / HTML</label><textarea name="message" required placeholder="Write the email message or paste HTML. Use {{name}} in HTML for the recipient name." /></div>
          <div className="field full"><label>HTML variables</label><textarea name="variables" placeholder={"instagram_handle=@raceupshot\nimg1080x1080=https://…\nimg1080x1920=https://…\ncollab_email=info@raceupshot.com"} /><small>Optional · one key=value per line. Event ID, name, date, location and type are filled automatically for one-event communications.</small></div>
          <div className="field full communication-test">
            <label>Test email</label>
            <div>
              <input name="testEmail" type="email" required placeholder="test@example.com" />
              <button type="button" className="button" disabled={working || testWorking} onClick={(event) => void sendTest(event.currentTarget.form!)}>
                <Send /> {testWorking ? "Sending test…" : "Send test"}
              </button>
            </div>
            <small>Sends only to this address. It does not create a campaign or contact the selected audience.</small>
          </div>
        </div>
        {preview && preview.sample.length > 0 && (
          <div className="audience-sample">
            <strong>Audience sample</strong>
            {preview.sample.map((member) => <span key={member.email}>{member.name} · {member.email} · {[member.city, member.state, member.country].filter(Boolean).join(", ") || "Location unavailable"}{member.categories.length ? ` · ${member.categories.join(", ")}` : ""}</span>)}
          </div>
        )}
        <div className="form-actions">
          <button type="button" className="button" disabled={working || testWorking} onClick={(event) => void previewAudience(event.currentTarget.form!)}><Filter /> Preview audience</button>
          <button className="button button-primary" disabled={working || testWorking || !preview?.count}><Send /> {working ? "Working…" : "Create & send"}</button>
        </div>
      </form>

      <section className="admin-card">
        <div className="admin-card-head"><h2><MailCheck /> Communication history</h2><span className="status-pill">{campaigns.length} total</span></div>
        {!campaigns.length ? <p className="admin-empty">No communications have been created yet.</p> : (
          <div className="campaign-list">
            {campaigns.map((campaign) => (
              <article key={campaign.id}>
                <div><strong>{campaign.subject}</strong><span className={`status-pill status-${["COMPLETED", "SENT"].includes(campaign.status) ? "official" : "upcoming"}`}>{campaign.status.toLowerCase().replaceAll("_", " ")}</span></div>
                <p>{campaign.scope === "EVENT" ? events.find((item) => item.id === campaign.eventId)?.name || campaign.eventId : "All database"} · {[campaign.filters.category, campaign.filters.city, campaign.filters.state, campaign.filters.country].filter(Boolean).join(", ") || "No audience filter"}</p>
                <small>
                  {campaign.providerCampaignId
                    ? `${campaign.queuedCount || 0} queued · ${campaign.sesAcceptedCount || 0} SES accepted · ${campaign.deliveredCount || 0} delivered · ${campaign.suppressedCount || 0} suppressed · ${campaign.failedCount || 0} failed`
                    : `${campaign.sentCount} sent · ${campaign.failedCount} failed`}
                  {` · ${campaign.recipients.length} recipients · ${new Date(campaign.createdAt).toLocaleString("en-IN")}`}
                </small>
                {campaign.providerCampaignId && <button type="button" className="button" disabled={working} onClick={() => void refreshCampaign(campaign)}><RefreshCw /> Refresh status</button>}
                {campaign.recipients.some((recipient) => recipient.status === "FAILED") && <button type="button" className="button" disabled={working} onClick={() => void retryCampaign(campaign)}>Retry failed</button>}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
