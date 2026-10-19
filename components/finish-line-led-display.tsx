"use client";
/* eslint-disable @next/next/no-img-element */

import type { FinishLineLedFeed, FinishLineLedFinisher } from "@/lib/finish-line-led";
import { getCountryFlagFromValue } from "@/lib/countries";
import { LED_FIELD_LABELS, ledGridColumns, normalizeLedFields, type LedField } from "@/lib/finish-line-led-fields";
import { Maximize, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

const ROWS_PER_PAGE = 3;

export function rollFinishers<T extends { id: string }>(previous: T[], incoming: T[]): { finishers: T[]; newIds: string[] } {
  const previousIds = new Set(previous.map((row) => row.id));
  const incomingById = new Map(incoming.map((row) => [row.id, row]));
  const newest = [...incomingById.values()].filter((row) => !previousIds.has(row.id));
  const older = [...previousIds].map((id) => incomingById.get(id)).filter((row): row is T => row !== undefined);
  return { finishers: [...newest, ...older], newIds: newest.map((row) => row.id) };
}

export function latestVisibleFinishers<T extends { id: string }>(finishers: T[]): T[] {
  return [...new Map(finishers.map((row) => [row.id, row])).values()].slice(0, ROWS_PER_PAGE);
}

export function LedFinisherField({ finisher, field }: { finisher: FinishLineLedFinisher; field: LedField }) {
  if (field === "flag") return <span className="finish-led-flag" aria-label={finisher.country || "Country unavailable"}>{getCountryFlagFromValue(finisher.country) || "🏁"}</span>;
  if (field === "name") return <div className="finish-led-athlete"><strong>{finisher.name}</strong></div>;
  if (field === "bib") return <strong className="finish-led-bib">{finisher.bib || "—"}</strong>;
  if (field === "finishTime") return <time>{finishLineChipTime(finisher.finishTime)}</time>;
  if (field === "status") return <em>FINISHED</em>;
  return <strong className="finish-led-group">{(field === "gender" ? finisher.gender.trim().toUpperCase() : finisher[field]) || "—"}</strong>;
}

export function athleteBand(finisher: Pick<FinishLineLedFinisher, "gender" | "ageGroup">): string {
  const gender = finisher.gender.trim().toUpperCase().startsWith("F") ? "F" : finisher.gender.trim() ? "M" : "";
  const age = finisher.ageGroup
    .replace(/\s*(years?|yrs?)\s*/gi, " ")
    .replace(/\bunder[-_\s]*(\d+)\b/gi, "UNDER $1")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
  return [gender, age].filter(Boolean).join(" - ") || "OPEN";
}

export function finishLineChipTime(value: string): string {
  const match = value.trim().match(/^(\d+):([0-5]\d):([0-5]\d)(?:\.\d+)?$/);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}:${match[3]}` : value;
}

function elapsedSince(start: string | undefined, now: number, stopsAt?: string): string {
  const startedAt = Date.parse(start || "");
  if (!Number.isFinite(startedAt)) return new Date(now).toLocaleTimeString("en-IN", { hour12: false });
  const stopTimestamp = Date.parse(stopsAt || "");
  const effectiveNow = Number.isFinite(stopTimestamp) ? Math.min(now, stopTimestamp) : now;
  const total = Math.max(0, Math.floor((effectiveNow - startedAt) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

export function FinishLineLedDisplay({ initialFeed }: { initialFeed: FinishLineLedFeed }) {
  const [feed, setFeed] = useState(initialFeed);
  const feedRef = useRef(initialFeed);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [idleSlideIndex, setIdleSlideIndex] = useState(0);
  const [newArrivalIds, setNewArrivalIds] = useState<string[]>([]);
  const rollingRef = useRef<HTMLDivElement>(null);
  const rowPositionsRef = useRef(new Map<string, number>());

  const refresh = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const response = await fetch(`/api/public/finish-line-led/${encodeURIComponent(initialFeed.event.id)}`, { cache: "no-store" });
      const body = await response.json() as { success?: boolean; data?: FinishLineLedFeed; error?: { message?: string } };
      if (!response.ok || !body.success || !body.data) throw new Error(body.error?.message || "Unable to refresh finishers.");
      const rolled = rollFinishers(feedRef.current.finishers, body.data.finishers);
      const nextFeed = { ...body.data, finishers: rolled.finishers };
      feedRef.current = nextFeed;
      if (rolled.newIds.length) {
        setNewArrivalIds(rolled.newIds);
      }
      setFeed(nextFeed);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to refresh finishers.");
    } finally {
      if (manual) setRefreshing(false);
    }
  }, [initialFeed.event.id]);

  useEffect(() => {
    const refreshTimer = window.setInterval(() => void refresh(), 2000);
    const clockTimer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.clearInterval(refreshTimer); window.clearInterval(clockTimer); };
  }, [refresh]);

  useEffect(() => {
    const interval = window.setInterval(() => setIdleSlideIndex((index) => index + 1), feed.display.idleRotationSeconds * 1000);
    return () => window.clearInterval(interval);
  }, [feed.display.idleRotationSeconds]);

  useEffect(() => {
    if (!newArrivalIds.length) return;
    const timer = window.setTimeout(() => setNewArrivalIds([]), 800);
    return () => window.clearTimeout(timer);
  }, [newArrivalIds]);

  const visibleFinishers = useMemo(() => latestVisibleFinishers(feed.finishers), [feed.finishers]);
  const fields = normalizeLedFields(feed.display.visibleFields);
  const gridStyle = { gridTemplateColumns: ledGridColumns(fields) };

  useLayoutEffect(() => {
    const elements = Array.from(rollingRef.current?.querySelectorAll<HTMLElement>("article[data-finisher-id]") ?? []);
    const nextPositions = new Map<string, number>();
    const animate = newArrivalIds.length > 0 && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    for (const element of elements) {
      const id = element.dataset.finisherId || "";
      const top = element.getBoundingClientRect().top;
      nextPositions.set(id, top);
      if (!animate) continue;
      const previousTop = rowPositionsRef.current.get(id);
      if (previousTop !== undefined && Math.abs(previousTop - top) > 1) {
        element.animate?.([
          { transform: `translateY(${previousTop - top}px)` },
          { transform: "translateY(0)" },
        ], { duration: 650, easing: "cubic-bezier(.2,.8,.2,1)" });
      } else if (newArrivalIds.includes(id)) {
        element.animate?.([
          { opacity: 0, transform: "translateY(-55%)" },
          { opacity: 1, transform: "translateY(0)" },
        ], { duration: 650, easing: "cubic-bezier(.2,.8,.2,1)" });
      }
    }
    rowPositionsRef.current = nextPositions;
  }, [visibleFinishers, newArrivalIds]);
  const idleSlideCount = feed.display.logos.length + 1;
  const normalizedIdleSlide = idleSlideIndex % idleSlideCount;
  const showClock = normalizedIdleSlide === feed.display.logos.length;
  const activeLogo = showClock ? null : feed.display.logos[normalizedIdleSlide];
  const eventEndedAt = Date.parse(feed.event.endsAt || "");
  const eventFinished = Number.isFinite(eventEndedAt) && now >= eventEndedAt;

  return (
    <main className="finish-led-screen finish-led-screen-clean">
        <div className="finish-led-actions finish-led-operator-controls">
          <button type="button" aria-label="Refresh finishers" onClick={() => void refresh(true)} disabled={refreshing}><RefreshCw /></button>
          <button type="button" aria-label="Open full screen" onClick={() => {
            if (!document.documentElement.requestFullscreen) { setError("Fullscreen is unavailable in this browser."); return; }
            void document.documentElement.requestFullscreen().catch(() => setError("Unable to open fullscreen. Please try again."));
          }}><Maximize /></button>
        </div>

      {feed.finishers.length ? (
        <section className="finish-led-results" aria-live="polite">
          <div className="finish-led-grid finish-led-grid-head" style={gridStyle}>{fields.map((field) => <span key={field}>{LED_FIELD_LABELS[field].toUpperCase()}</span>)}</div>
          <div className="finish-led-rolling" ref={rollingRef}>
            {visibleFinishers.map((finisher) => (
              <article className="finish-led-grid" style={gridStyle} data-finisher-id={finisher.id} key={finisher.id}>
                {fields.map((field) => <LedFinisherField key={field} field={field} finisher={finisher} />)}
              </article>
            ))}
          </div>
        </section>
      ) : (
        <section className="finish-led-idle" aria-live="polite">
          {activeLogo ? (
            <div className="finish-led-idle-stage finish-led-idle-slide" key={`logo:${activeLogo.id}:${normalizedIdleSlide}`}>
              <span>{activeLogo.kind === "EVENT" ? "EVENT" : "PROUDLY SUPPORTED BY"}</span>
              <img src={activeLogo.logoUrl} alt={activeLogo.name} />
              <h2>{activeLogo.name}</h2>
            </div>
          ) : (
            <div className="finish-led-clock finish-led-idle-slide" key={`clock:${normalizedIdleSlide}`}>
              <span>RACE ELAPSED</span>
              <strong>{elapsedSince(feed.event.startsAt, now, feed.event.clockStopsAt)}</strong>
              <small>{eventFinished ? "Event finished" : "Waiting for the first official finisher"}</small>
            </div>
          )}
        </section>
      )}

      {error && <div className="finish-led-connection-error" role="status">{error} Showing the last loaded timing.</div>}
    </main>
  );
}
