"use client";

import type { HomepageSlide } from "@/lib/types";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { SearchPanel } from "./search-panel";

function HeroHeadline({ headline }: { headline: string }) {
  const parts = headline.split(". ");
  if (parts.length > 1) return <>{parts[0]}.<br /><em>{parts.slice(1).join(". ")}</em></>;
  return <>{headline}</>;
}

export function HomepageHero({
  slides,
  resultCount,
}: {
  slides: HomepageSlide[];
  resultCount: number;
}) {
  const [activeIndex, setActiveIndex] = useState(0);

  const visibleSlides = useMemo(() => {
    return slides.filter((slide) => slide.enabled);
  }, [slides]);

  useEffect(() => {
    if (visibleSlides.length < 2) return;
    const timer = window.setInterval(() => setActiveIndex((index) => (index + 1) % visibleSlides.length), 6000);
    return () => window.clearInterval(timer);
  }, [visibleSlides.length]);

  const active = visibleSlides[activeIndex % visibleSlides.length];
  if (!active) return null;

  return (
    <section className="hero">
      <div className="hero-slides" aria-hidden="true">
        {visibleSlides.map((slide, index) => (
          <div key={slide.id} className={`hero-image ${index === activeIndex % visibleSlides.length ? "active" : ""}`} style={{ backgroundImage: `linear-gradient(90deg, rgba(3,12,25,.92) 0%, rgba(3,12,25,.68) 38%, rgba(3,12,25,.1) 73%), url("${slide.image}")` }} />
        ))}
      </div>
      <div className="hero-grid" />
      <div className="hero-content shell">
        <div className="hero-copy">
          <div className="hero-live"><span /> {active.eventId ? "FEATURED EVENT" : "RACE TIMING PLATFORM"} · {active.eventName.toUpperCase()}</div>
          <h1><HeroHeadline headline={active.headline} /></h1>
          <p>{active.description}</p>
          <div className="hero-actions">
            {active.primaryUrl && <Link href={active.primaryUrl} className="button button-primary">{active.primaryLabel || "View event"} <ArrowRight /></Link>}
            {active.secondaryUrl && <Link href={active.secondaryUrl} className="text-link">{active.secondaryLabel || "Know more"} <ArrowUpRight /></Link>}
          </div>
        </div>
        <div className="hero-ticker" aria-label="Live race statistics">
          <div><span>RESULT RECORDS</span><strong>{resultCount.toLocaleString()}</strong></div>
          <div><span>RESULT STATUS</span><strong>VERIFIED</strong></div>
          <div><span>DATA STATUS</span><strong className="time">LIVE</strong></div>
        </div>
      </div>
      {visibleSlides.length > 1 && (
        <div className="hero-dots shell" aria-label="Homepage slides">
          {visibleSlides.map((slide, index) => <button key={slide.id} className={index === activeIndex % visibleSlides.length ? "active" : ""} onClick={() => setActiveIndex(index)} aria-label={`Show ${slide.eventName}`} />)}
        </div>
      )}
      <div className="hero-search shell"><SearchPanel dark /></div>
    </section>
  );
}
