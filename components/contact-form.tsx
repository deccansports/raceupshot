"use client";

import { CheckCircle2, Send } from "lucide-react";
import { FormEvent, useState } from "react";
import { ContactTurnstile } from "./contact-turnstile";

declare global {
  interface Window {
    turnstile?: { reset: (widgetId?: string) => void };
  }
}

export function ContactForm({ turnstileSiteKey }: { turnstileSiteKey: string }) {
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true);
    setSent(false);
    setError("");
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    try {
      const response = await fetch("/api/public/enquiries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Unable to send your enquiry.");
      form.reset();
      window.turnstile?.reset();
      setSent(true);
    } catch (reason) {
      window.turnstile?.reset();
      setError(reason instanceof Error ? reason.message : "Unable to send your enquiry.");
    } finally {
      setSending(false);
    }
  }
  return (
    <form className="form-card" onSubmit={submit}>
      {sent && <div className="success-banner"><CheckCircle2 size={14} /> Thanks—your event enquiry has been received. Our timing team will respond shortly.</div>}
      {error && <div className="success-banner error-banner">{error}</div>}
      <div className="form-grid">
        <div className="field"><label>Name</label><input name="name" required /></div><div className="field"><label>Organization</label><input name="organization" required /></div>
        <div className="field"><label>Email</label><input name="email" type="email" required /></div><div className="field"><label>Phone</label><input name="phone" type="tel" required /></div>
        <div className="field"><label>Event name</label><input name="eventName" required /></div><div className="field"><label>Event type</label><select name="eventType"><option>Running</option><option>Triathlon</option><option>Cycling</option><option>Swimming</option></select></div>
        <div className="field"><label>Event date</label><input name="eventDate" type="date" required /></div><div className="field"><label>Expected participants</label><input name="expectedParticipants" type="number" min="1" required /></div>
        <div className="field"><label>City</label><input name="city" required /></div><div className="field"><label>Required services</label><select name="requiredServices"><option>Complete timing operations</option><option>Live results</option><option>RFID equipment rental</option><option>Result verification</option></select></div>
        <div className="field full"><label>Tell us about the event</label><textarea name="message" required /></div>
        <label className="field full" style={{ flexDirection: "row", alignItems: "flex-start" }}><input name="consent" type="checkbox" required style={{ width: 16 }} /> I agree that Race Upshot may contact me about this enquiry.</label>
        <div className="field full"><ContactTurnstile siteKey={turnstileSiteKey} /></div>
      </div>
      <div className="form-actions"><button className="button button-primary" disabled={sending || !turnstileSiteKey}>{sending ? "Sending…" : "Send enquiry"} <Send /></button></div>
    </form>
  );
}
