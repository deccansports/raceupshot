"use client";

import type { ContactEnquiry } from "@/lib/enquiries";
import { Mail, MessageSquareReply } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";

export function EnquiriesManager({ initialEnquiries }: { initialEnquiries: ContactEnquiry[] }) {
  const [enquiries, setEnquiries] = useState(initialEnquiries);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const openCount = useMemo(() => enquiries.filter((item) => item.status === "OPEN").length, [enquiries]);
  const recentEnquiries = useMemo(
    () => [...enquiries].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)).slice(0, 10),
    [enquiries],
  );

  async function sendReply(event: FormEvent<HTMLFormElement>, enquiry: ContactEnquiry) {
    event.preventDefault();
    setSending(true);
    setNotice("");
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    try {
      const response = await fetch(`/api/admin/enquiries/${encodeURIComponent(enquiry.id)}/reply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      const payload = await response.json() as { ok?: boolean; data?: ContactEnquiry; error?: string };
      if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error || "Unable to save reply.");
      setEnquiries((current) => current.map((item) => item.id === enquiry.id ? payload.data! : item));
      const latest = payload.data.replies.at(-1);
      setNotice(latest?.status === "SENT" ? `Reply sent to ${enquiry.email}.` : `Reply saved, but delivery failed: ${latest?.error || "Bergtecno unavailable"}`);
      if (latest?.status === "SENT") {
        form.reset();
        setActiveId(null);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to reply.");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="admin-card">
      <div className="admin-card-head"><div><h2><Mail /> Contact enquiries</h2><p>Showing the 10 most recent enquiries.</p></div><span className="status-pill">{openCount} open</span></div>
      {notice && <div className="success-banner">{notice}</div>}
      {!enquiries.length ? <p className="admin-empty">No enquiries have been received yet.</p> : (
        <div className="enquiry-list" aria-label="Latest contact enquiries">
          {recentEnquiries.map((enquiry) => (
            <article className="enquiry-row" key={enquiry.id}>
              <div className="enquiry-heading">
                <div><h3>{enquiry.eventName}</h3><p>{enquiry.name} · {enquiry.organization} · <a href={`mailto:${enquiry.email}`}>{enquiry.email}</a></p></div>
                <span className={`status-pill ${enquiry.status === "OPEN" ? "status-upcoming" : "status-official"}`}>{enquiry.status.toLowerCase()}</span>
              </div>
              <div className="enquiry-meta">
                <span>{enquiry.eventType}</span><span>{enquiry.eventDate}</span><span>{enquiry.city}</span>
                <span>{enquiry.expectedParticipants.toLocaleString()} expected</span><span>{enquiry.requiredServices}</span><span>{enquiry.phone}</span>
                {enquiry.confirmation && <span>Ticket email: {enquiry.confirmation.status.toLowerCase()}</span>}
              </div>
              <p className="enquiry-message">{enquiry.message}</p>
              {!!enquiry.replies?.length && (
                <div className="enquiry-replies">
                  {enquiry.replies.map((reply) => <p key={reply.id}><strong>{reply.status}</strong> · {reply.subject}<small>{reply.error || reply.sentAt || reply.createdAt}</small></p>)}
                </div>
              )}
              {activeId === enquiry.id ? (
                <form className="reply-form" onSubmit={(event) => void sendReply(event, enquiry)}>
                  <div className="field"><label>Subject</label><input name="subject" defaultValue={`Re: ${enquiry.eventName} timing enquiry`} required /></div>
                  <div className="field"><label>Reply</label><textarea name="message" required placeholder={`Hello ${enquiry.name},`} /></div>
                  <div className="event-row-actions">
                    <button type="button" className="button" onClick={() => setActiveId(null)}>Cancel</button>
                    <button className="button button-primary" disabled={sending}>{sending ? "Sending…" : "Send via Bergtecno"}</button>
                  </div>
                </form>
              ) : <button className="button" onClick={() => setActiveId(enquiry.id)}><MessageSquareReply /> Reply</button>}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
