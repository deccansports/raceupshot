import type { RaceEvent } from "@/lib/types";
import { ArrowUpRight, CalendarDays, MapPin, Users } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { StatusPill } from "./status-pill";

export function EventCard({ event }: { event: RaceEvent }) {
  const primaryHref = event.status === "live"
    ? `/live/${event.slug}`
    : event.hasResults
      ? `/results/${event.slug}`
      : `/events/${event.slug}`;
  const primaryLabel = event.status === "live" ? "Live results" : event.hasResults ? "Results" : "Event details";
  return (
    <article className="event-card">
      <div className={`event-card-visual${event.bannerUrl ? " has-banner" : ""}`} style={{ "--event-accent": event.accent } as React.CSSProperties}>
        {event.bannerUrl ? (
          <Image
            src={event.bannerUrl}
            alt={`${event.name} event banner`}
            fill
            sizes="(max-width: 720px) 100vw, (max-width: 1100px) 50vw, 33vw"
            className="event-card-banner"
            unoptimized
          />
        ) : (
          <>
            <div className="event-code">{event.shortCode}</div>
            <span>{event.sport.toUpperCase()}</span>
            <b>{event.date.split(" ")[0]}</b>
          </>
        )}
      </div>
      <div className="event-card-body">
        <div className="event-card-top">
          <StatusPill status={event.status} />
          <span className="sport-tag">{event.sport}</span>
        </div>
        <h3>{event.name}</h3>
        <div className="event-meta">
          <span><CalendarDays /> {event.date}</span>
          <span><MapPin /> {event.location}</span>
          <span><Users /> {event.participants.toLocaleString()} athletes</span>
        </div>
        <div className="category-chips">
          {event.categories.map((category) => <span key={category}>{category}</span>)}
        </div>
        <div className="event-card-actions">
          <Link href={primaryHref} className="event-link">
            {primaryLabel}
            <ArrowUpRight size={15} />
          </Link>
          {event.registrationUrl && <a href={event.registrationUrl} target="_blank" rel="noreferrer" className="event-action-register">Register</a>}
          {event.knowMoreUrl && <Link href={event.knowMoreUrl} className="event-action-more">Know more</Link>}
        </div>
      </div>
    </article>
  );
}
