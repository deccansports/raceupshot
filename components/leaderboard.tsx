"use client";

import type { Athlete } from "@/lib/types";
import { Download } from "lucide-react";
import Link from "next/link";

export function Leaderboard({
  athletes,
  live = false,
  eventSlug,
  emptyMessage,
  heading,
}: {
  athletes: Athlete[];
  live?: boolean;
  eventSlug: string;
  emptyMessage?: string;
  heading?: string;
}) {
  return (
    <div className="leaderboard-shell">
      <div className="leaderboard-head">
        <h3>{heading || (live ? "Live leaderboard" : "Overall results")}</h3>
      </div>
      <table className="leaderboard">
        <thead><tr><th>RANK</th><th>ATHLETE</th><th>BIB</th><th>AGE GROUP</th><th>FINISH / EST.</th><th>PACE</th><th>STATUS</th><th /></tr></thead>
        <tbody>
          {athletes.map((athlete) => {
            const anonymous = athlete.visibility === "ANONYMOUS";
            const resultUrl = `/results/${eventSlug}/athlete/${athlete.id}`;
            return (
            <tr key={athlete.id}>
              <td className="rank">{athlete.rank ? String(athlete.rank).padStart(2, "0") : "—"}</td>
              <td><span className="athlete-cell">{anonymous ? <b>Anonymous Athlete</b> : <Link className="result-primary-link" href={resultUrl} prefetch={false}>{athlete.name}</Link>}<small>{anonymous ? "Identity hidden" : `${athlete.club} · ${athlete.country}`}</small></span></td>
              <td>{anonymous ? "—" : <Link className="result-primary-link result-bib-link" href={resultUrl} prefetch={false}>{athlete.bib}</Link>}</td>
              <td>{athlete.ageGroup}</td>
              <td className="finish-cell">{athlete.finishTime}</td>
              <td>{athlete.pace || "—"}</td>
              <td><span className={`status-pill ${athlete.status.toLowerCase().includes("course") ? "status-live" : "status-official"}`}>{athlete.status}</span></td>
              <td>
                <div className="result-row-actions">
                  {!anonymous && <Link className="athlete-link" href={resultUrl} prefetch={false}>View →</Link>}
                  {!anonymous && !live && athlete.certificateUrl && athlete.status.toLowerCase() === "finished" && (
                    <Link className="certificate-result-link" href={athlete.certificateUrl}><Download /> Certificate</Link>
                  )}
                </div>
              </td>
            </tr>
          );})}
        </tbody>
      </table>
      {!athletes.length && <p className="admin-empty">{emptyMessage || "No result records are stored for this event."}</p>}
    </div>
  );
}
