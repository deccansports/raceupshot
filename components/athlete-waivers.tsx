"use client";

import type { User } from "firebase/auth";
import { CheckCircle2, FileCheck2, FileText, KeyRound, Send } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface WaiverSummary {
  eventId: string;
  eventName: string;
  eventDate: string;
  eventLocation: string;
  participantId: string;
  bib: string;
  category: string;
  waiverVersion: string;
  signedAt: string | null;
  signatureName: string | null;
  documentUrl: string | null;
  relayTeam: null | {
    bib: string; name: string; size: 2 | 3; completed: boolean; completedMembers: number;
    members: Array<{ participantId: string; name: string; email: string; role: string; memberNumber: number; signedAt: string | null; completed: boolean }>;
  };
}

interface Draft {
  signatureName: string;
  accepted: boolean;
  otp: string;
  otpSent: boolean;
  busy: boolean;
  message: string;
  error: string;
}

const emptyDraft = (name: string): Draft => ({ signatureName: name, accepted: false, otp: "", otpSent: false, busy: false, message: "", error: "" });

export function AthleteWaivers({ user, displayName }: { user: User | null; displayName: string }) {
  const [waivers, setWaivers] = useState<WaiverSummary[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const headers = useCallback(async (json = false) => ({
    ...(user ? { authorization: `Bearer ${await user.getIdToken()}` } : {}),
    ...(json ? { "content-type": "application/json" } : {}),
  }), [user]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch("/api/v1/athlete/waivers", { headers: await headers(), cache: "no-store" });
      const body = await response.json() as { success?: boolean; data?: WaiverSummary[]; error?: { message?: string } };
      if (!response.ok || !body.success) throw new Error(body.error?.message || "Unable to load event waivers.");
      setWaivers(body.data || []);
      setDrafts((current) => Object.fromEntries((body.data || []).map((waiver) => [
        waiver.participantId,
        current[waiver.participantId] || emptyDraft(displayName),
      ])));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Unable to load event waivers.");
    } finally {
      setLoading(false);
    }
  }, [displayName, headers]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function update(participantId: string, patch: Partial<Draft>) {
    setDrafts((current) => ({ ...current, [participantId]: { ...(current[participantId] || emptyDraft(displayName)), ...patch } }));
  }

  async function requestOtp(waiver: WaiverSummary) {
    const draft = drafts[waiver.participantId] || emptyDraft(displayName);
    update(waiver.participantId, { busy: true, error: "", message: "" });
    try {
      const response = await fetch(`/api/v1/athlete/waivers/${encodeURIComponent(waiver.eventId)}/otp/request`, {
        method: "POST", headers: await headers(true),
        body: JSON.stringify({ participantId: waiver.participantId, signatureName: draft.signatureName, accepted: draft.accepted }),
      });
      const body = await response.json() as { success?: boolean; error?: { message?: string } };
      if (!response.ok || !body.success) throw new Error(body.error?.message || "Unable to send the waiver OTP.");
      update(waiver.participantId, { otpSent: true, message: "Verification OTP sent to your registered email." });
    } catch (error) {
      update(waiver.participantId, { error: error instanceof Error ? error.message : "Unable to send the waiver OTP." });
    } finally {
      update(waiver.participantId, { busy: false });
    }
  }

  async function sign(waiver: WaiverSummary) {
    const draft = drafts[waiver.participantId] || emptyDraft(displayName);
    update(waiver.participantId, { busy: true, error: "", message: "" });
    try {
      const response = await fetch(`/api/v1/athlete/waivers/${encodeURIComponent(waiver.eventId)}/otp/verify`, {
        method: "POST", headers: await headers(true),
        body: JSON.stringify({ participantId: waiver.participantId, otp: draft.otp }),
      });
      const body = await response.json() as { success?: boolean; error?: { message?: string } };
      if (!response.ok || !body.success) throw new Error(body.error?.message || "Unable to sign the waiver.");
      await load();
    } catch (error) {
      update(waiver.participantId, { error: error instanceof Error ? error.message : "Unable to sign the waiver." });
    } finally {
      update(waiver.participantId, { busy: false });
    }
  }

  return (
    <section className="athlete-waivers-card">
      <div className="athlete-waivers-heading"><FileCheck2 /><div><span className="eyebrow">EVENT WAIVERS</span><h2>Sign and download waivers</h2><p>A dedicated email OTP confirms each electronic signature.</p></div></div>
      {loading && <div className="account-loading"><span className="auth-spinner" /> Loading registered events…</div>}
      {loadError && <div className="auth-alert auth-alert-error">{loadError}</div>}
      {!loading && !loadError && !waivers.length && <p className="athlete-waivers-empty">No unsigned or saved event waivers are connected to this athlete account.</p>}
      <div className="athlete-waivers-list">
        {waivers.map((waiver) => {
          const draft = drafts[waiver.participantId] || emptyDraft(displayName);
          return <article className={waiver.signedAt ? "athlete-waiver signed" : "athlete-waiver"} key={`${waiver.eventId}:${waiver.participantId}`}>
            <div className="athlete-waiver-title"><div><b>{waiver.eventName}</b><span>{[waiver.eventDate, waiver.eventLocation].filter(Boolean).join(" · ")}</span></div><strong>{waiver.signedAt ? <><CheckCircle2 /> Signed</> : "Signature required"}</strong></div>
            <div className="athlete-waiver-meta"><span>BIB <b>{waiver.bib || "Not assigned"}</b></span><span>Category <b>{waiver.category || "Not recorded"}</b></span><span>Version <b>{waiver.waiverVersion || "Current"}</b></span></div>
            {waiver.relayTeam ? <section className="athlete-relay-waiver">
              <div><span>TEAM WAIVER · BIB {waiver.relayTeam.bib}</span><b>{waiver.relayTeam.name}</b><small>{waiver.relayTeam.completed ? "Completed" : `${waiver.relayTeam.completedMembers}/${waiver.relayTeam.size} athletes signed`}</small></div>
              <ol>{waiver.relayTeam.members.map((member) => <li key={member.participantId}><span><b>{member.name}</b><small>{[member.role, member.email].filter(Boolean).join(" · ")}</small></span><strong>{member.completed ? `Signed · ${new Date(member.signedAt!).toLocaleString("en-IN")}` : "Signature pending"}</strong></li>)}</ol>
            </section> : null}
            {waiver.signedAt ? <div className="athlete-waiver-complete">
              <div><b>Signed by {waiver.signatureName}</b><span>{new Date(waiver.signedAt).toLocaleString("en-IN")}</span></div>
              {waiver.documentUrl && <a className="button button-secondary" href={waiver.documentUrl} target="_blank" rel="noreferrer"><FileText /> Open signed PDF</a>}
            </div> : <div className="athlete-waiver-form">
              <label>Full legal name<input value={draft.signatureName} maxLength={120} onChange={(event) => update(waiver.participantId, { signatureName: event.target.value })} /></label>
              <label className="athlete-waiver-consent"><input type="checkbox" checked={draft.accepted} onChange={(event) => update(waiver.participantId, { accepted: event.target.checked })} /><span>I have read and accept this event’s waiver and authorize this electronic signature.</span></label>
              {!draft.otpSent ? <button className="button button-primary" type="button" disabled={draft.busy || !draft.accepted || draft.signatureName.trim().length < 2} onClick={() => void requestOtp(waiver)}><Send /> {draft.busy ? "Sending…" : "Send signing OTP"}</button> : <div className="athlete-waiver-otp"><label>Six-digit OTP<input value={draft.otp} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" onChange={(event) => update(waiver.participantId, { otp: event.target.value.replace(/\D/g, "").slice(0, 6) })} /></label><button className="button button-primary" type="button" disabled={draft.busy || draft.otp.length !== 6} onClick={() => void sign(waiver)}><KeyRound /> {draft.busy ? "Signing…" : "Verify OTP & sign"}</button></div>}
              {draft.message && <small className="athlete-waiver-message">{draft.message}</small>}
              {draft.error && <small className="athlete-waiver-error">{draft.error}</small>}
            </div>}
          </article>;
        })}
      </div>
    </section>
  );
}
