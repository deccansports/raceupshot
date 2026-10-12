"use client";

import type { RaceEvent } from "@/lib/types";
import { useMemo, useState } from "react";
import { EventCard } from "./event-card";

export function EventsDirectory({ events }: { events: RaceEvent[] }) {
  const [filter, setFilter] = useState("All");
  const visible = useMemo(
    () => events.filter((event) => filter === "All" || event.status === filter.toLowerCase() || event.sport === filter),
    [events, filter],
  );
  return (
    <>
      <div className="filter-bar">
        {["All", "Live", "Upcoming", "Official", "Running", "Triathlon", "Cycling"].map((item) => (
          <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>
        ))}
        <select aria-label="Filter by year"><option>2026</option><option>2025</option></select>
      </div>
      <div className="events-grid">
        {visible.map((event) => <EventCard key={event.slug} event={event} />)}
      </div>
      {!visible.length && <p className="admin-empty">No real events match the selected filter.</p>}
    </>
  );
}
