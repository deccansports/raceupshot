"use client";

import type { Athlete, RaceEvent } from "@/lib/types";
import { ArrowRight, Search } from "lucide-react";
import Link from "next/link";
import { FormEvent, useState } from "react";

interface SearchResponse {
  ok: boolean;
  data?: { athletes: Athlete[]; events: RaceEvent[] };
  error?: string;
}

export function SearchPanel({ dark = false, eventsOnly = false }: { dark?: boolean; eventsOnly?: boolean }) {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SearchResponse["data"]>({ athletes: [], events: [] });
  const [error, setError] = useState("");

  async function onSubmit(eventData: FormEvent) {
    eventData.preventDefault();
    if (query.trim().length < 2) return;
    setSubmitted(true);
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/public/search?q=${encodeURIComponent(query.trim())}`, { cache: "no-store" });
      const payload = await response.json() as SearchResponse;
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Search failed");
      setResult(payload.data ?? { athletes: [], events: [] });
    } catch (reason) {
      setResult({ athletes: [], events: [] });
      setError(reason instanceof Error ? reason.message : "Search is unavailable");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={dark ? "search-panel search-panel-dark" : "search-panel"}>
      <form onSubmit={onSubmit}>
        <Search size={22} />
        <label className="sr-only" htmlFor="race-search">{eventsOnly ? "Search events" : "Search events, athletes, or bibs"}</label>
        <input
          id="race-search"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSubmitted(false); setError(""); }}
          placeholder={eventsOnly ? "Search event name or location" : "Search athlete, event or bib number"}
        />
        <button type="submit" disabled={loading}>{loading ? "Searching…" : "Search"} <ArrowRight size={18} /></button>
      </form>
      {submitted && (
        <div className="quick-result">
          {error ? <p>{error}</p> : loading ? <p>{eventsOnly ? "Searching events…" : "Searching live race data…"}</p> : eventsOnly && result?.events[0] ? (
            <Link href={`/events/${result.events[0].slug}`}>
              <span><b>{result.events[0].name}</b><small>{result.events[0].date} · {result.events[0].location}</small></span>
              <ArrowRight />
            </Link>
          ) : !eventsOnly && result?.athletes[0] ? (
            <Link href={`/results/${result.athletes[0].eventSlug}/athlete/${result.athletes[0].id}`}>
              <span><b>{result.athletes[0].name}</b><small>Bib {result.athletes[0].bib} · {result.athletes[0].eventName}</small></span>
              <ArrowRight />
            </Link>
          ) : !eventsOnly && result?.events[0] ? (
            <Link href={`/events/${result.events[0].slug}`}>
              <span><b>{result.events[0].name}</b><small>{result.events[0].date} · {result.events[0].location}</small></span>
              <ArrowRight />
            </Link>
          ) : (
            <p>{eventsOnly ? "No matching event was found." : "No matching event, athlete, or bib was found in Worker data."}</p>
          )}
        </div>
      )}
    </div>
  );
}
