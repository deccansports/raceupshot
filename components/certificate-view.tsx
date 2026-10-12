"use client";

import type { StoredCertificateTemplate } from "@/lib/certificate-storage";
import type { Athlete, RaceEvent } from "@/lib/types";
import { BadgeCheck, Download, Printer, QrCode, ShieldCheck } from "lucide-react";
import Image from "next/image";

export function CertificateView({
  verificationCode,
  certificate,
  template,
}: {
  verificationCode: string;
  certificate: { event: RaceEvent; athlete: Athlete } | null;
  template: StoredCertificateTemplate | null;
}) {
  if (!certificate) {
    return (
      <div className="certificate-invalid">
        <ShieldCheck />
        <h1>Certificate not found</h1>
        <p>No issued certificate with this verification code exists in Worker storage.</p>
      </div>
    );
  }

  const { athlete, event } = certificate;
  const splitValue = (name: string) => athlete.splits.find((split) => split.label.toLowerCase() === name)?.time ?? "";
  const variableValue = (variable: string) => {
    const values: Record<string, string> = {
      athlete_name: athlete.name,
      bib_number: athlete.bib,
      event_name: event.name,
      category: athlete.category,
      distance: event.categories.join(" · "),
      finish_time: athlete.finishTime,
      overall_rank: String(athlete.rank || ""),
      gender_rank: String(athlete.genderRank || ""),
      age_group_rank: String(athlete.ageRank || ""),
      event_date: event.date,
      verification_code: verificationCode,
      swim_time: splitValue("swim"),
      t1_time: splitValue("t1"),
      bike_time: splitValue("bike"),
      t2_time: splitValue("t2"),
      run_time: splitValue("run"),
    };
    return values[variable] ?? "";
  };

  const actions = (
    <div className="certificate-actions">
      <span className="status-pill status-official"><BadgeCheck size={12} /> Verified certificate</span>
      <div>
        <button className="button" onClick={() => window.print()}><Printer /> Print</button>
        <button className="button button-primary" onClick={() => window.print()}><Download /> Save as PDF</button>
      </div>
    </div>
  );

  if (template?.artworkData) {
    return (
      <>
        {actions}
        <article className="certificate-public-custom">
          {template.artworkType === "application/pdf"
            ? <object data={template.artworkData} type="application/pdf" aria-label="Custom certificate artwork" />
            : <div className="certificate-uploaded-art" role="img" aria-label="Custom certificate artwork" style={{ backgroundImage: `url("${template.artworkData}")` }} />}
          {template.elements.map((element) => (
            <div
              key={element.id}
              className={`certificate-public-element ${element.variable === "qr_code" ? "qr" : ""}`}
              style={{ left: `${element.x}%`, top: `${element.y}%`, fontSize: element.fontSize, color: element.color, fontWeight: element.weight }}
            >
              {element.variable === "qr_code" ? <QrCode /> : variableValue(element.variable)}
            </div>
          ))}
        </article>
      </>
    );
  }

  return (
    <>
      {actions}
      <article className="certificate-sheet">
        <div className="certificate-corners" />
        <header>
          <div className="certificate-brand"><Image src="/Race Upshot logo.png" alt="Race Upshot" width={150} height={44} /></div>
          <span>OFFICIAL FINISHER CERTIFICATE</span>
        </header>
        <div className="certificate-body">
          <span className="eyebrow">{event.name.toUpperCase()}</span>
          <p>This certifies that</p>
          <h1>{athlete.name}</h1>
          <p>successfully completed the</p>
          <h2>{athlete.category || athlete.ageGroup}</h2>
          <div className="certificate-time"><span>OFFICIAL FINISH TIME</span><strong>{athlete.finishTime}</strong></div>
          <div className="certificate-stats">
            <div><span>OVERALL RANK</span><strong>{athlete.rank || "—"}</strong></div>
            <div><span>GENDER RANK</span><strong>{athlete.genderRank || "—"}</strong></div>
            <div><span>BIB NUMBER</span><strong>{athlete.bib}</strong></div>
          </div>
        </div>
        <footer>
          <div><span>EVENT DATE</span><b>{event.date}</b></div>
          <div className="certificate-verify"><ShieldCheck /><span>VERIFIED BY RACE UPSHOT<b>{verificationCode}</b></span></div>
          <div><span>EVENT</span><b>{event.shortCode}</b></div>
        </footer>
      </article>
    </>
  );
}
