"use client";
/* eslint-disable @next/next/no-img-element */

import type { FinishLineLedFeed, FinishLineLedFinisher } from "@/lib/finish-line-led";
import { getCountryFlagFromValue } from "@/lib/countries";
import { Maximize, Radio, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

const ROWS_PER_PAGE = 3;

export function rollFinishers<T extends { id: string }>(previous: T[], incoming: T[]): { finishers: T[]; newIds: string[] } {
  const previousIds = new Set(previous.map((row) => row.id));
  const incomingById = new Map(incoming.map((row) => [row.id, row]));
  const newest = incoming.filter((row) => !previousIds.has(row.id));
  const older = previous.map((row) => incomingById.get(row.id)).filter((row): row is T => row !== undefined);
  return { finishers: [...newest, ...older], newIds: newest.map((row) => row.id) };
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
  const [pageIndex, setPageIndex] = useState(0);
  const [newArrivalIds, setNewArrivalIds] = useState<string[]>([]);
  const lastArrivalAtRef = useRef(0);
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
        lastArrivalAtRef.current = Date.now();
        setPageIndex(0);
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

  const totalPages = Math.max(1, Math.ceil(feed.finishers.length / ROWS_PER_PAGE));
  const normalizedPageIndex = pageIndex % totalPages;
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (Date.now() - lastArrivalAtRef.current < feed.display.finisherRotationSeconds * 1000) return;
      setPageIndex((index) => (index + 1) % totalPages);
    }, feed.display.finisherRotationSeconds * 1000);
    return () => window.clearInterval(interval);
  }, [feed.display.finisherRotationSeconds, totalPages]);

  const visibleFinishers = useMemo(() => {
    const start = normalizedPageIndex * ROWS_PER_PAGE;
    return feed.finishers.slice(start, start + ROWS_PER_PAGE);
  }, [feed.finishers, normalizedPageIndex]);

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
    <main className="finish-led-screen">
      <header className="finish-led-header">
        <div className="finish-led-brand">
          {feed.event.logoUrl ? <img src={feed.event.logoUrl} alt={`${feed.event.name} logo`} /> : <div className="finish-led-mark">RU</div>}
          <div><span>FINISH LINE</span><h1>{feed.event.name}</h1><p>{feed.event.location}</p></div>
        </div>
        <div className="finish-led-actions">
          <span><Radio /> LIVE FINISHES</span>
          <button type="button" aria-label="Refresh finishers" onClick={() => void refresh(true)} disabled={refreshing}><RefreshCw /></button>
          <button type="button" aria-label="Open full screen" onClick={() => void document.documentElement.requestFullscreen()}><Maximize /></button>
        </div>
      </header>

      {feed.finishers.length ? (
        <section className="finish-led-results" aria-live="polite">
          <div className="finish-led-results-title">
            <div><span>OFFICIAL LIVE RESULTS</span><h2>FINISHERS</h2></div>
            <strong>{feed.finishers.length}</strong>
          </div>
          <div className="finish-led-grid finish-led-grid-head"><span>PLACE</span><span>BIB</span><span>ATHLETE</span><span>GROUP</span><span>CHIP TIME</span><span>STATUS</span></div>
          <div className="finish-led-rolling" key={normalizedPageIndex} ref={rollingRef}>
            {visibleFinishers.map((finisher, index) => (
              <article className="finish-led-grid" data-finisher-id={finisher.id} key={finisher.id}>
                <b>{finisher.rank || normalizedPageIndex * ROWS_PER_PAGE + index + 1}</b>
                <strong className="finish-led-bib">{finisher.bib || "—"}</strong>
                <div className="finish-led-athlete"><i>{getCountryFlagFromValue(finisher.country) || "🏁"}</i><span><strong>{finisher.name}</strong><small>{finisher.country || "IN"}</small></span></div>
                <strong className="finish-led-group">{athleteBand(finisher)}</strong>
                <time>{finishLineChipTime(finisher.finishTime)}</time>
                <em>FINISHED</em>
              </article>
            ))}
          </div>
          {totalPages > 1 && <div className="finish-led-pages">{Array.from({ length: totalPages }, (_, index) => <i className={index === normalizedPageIndex ? "active" : ""} key={index} />)}</div>}
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

      <footer className="finish-led-footer">
        <strong>RACE UPSHOT</strong>
        <span>{error || (feed.finishers.length ? "ROLLING LIVE FINISHES" : eventFinished ? "EVENT FINISHED" : "TIMING IN PROGRESS")}</span>
        <small>{feed.updatedAt ? `Updated ${new Date(feed.updatedAt).toLocaleTimeString("en-IN")}` : "Connected to live timing"}</small>
      </footer>
    </main>
  );
}
