import { EventCard } from "@/components/event-card";
import { HomepageHero } from "@/components/homepage-hero";
import { SearchPanel } from "@/components/search-panel";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getEvents, getHomepageSliderConfig, getResults } from "@/lib/raceupshot-repository";
import type { HomepageSlide } from "@/lib/types";
import {
  Activity, ArrowRight, ArrowUpRight, BarChart3,
  CircleGauge, Radio, Route, ShieldCheck, Timer, Waves, Zap,
} from "lucide-react";
import Link from "next/link";

const services = [
  { icon: Timer, title: "RFID race timing", text: "High-accuracy start, split, transition and finish capture." },
  { icon: Radio, title: "Live race intelligence", text: "Fast public results, on-course progress and leaderboards." },
  { icon: Route, title: "Athlete tracking", text: "Meaningful progress updates at every configured timing point." },
  { icon: BarChart3, title: "Result operations", text: "Imports, verification, ranking, publication and certificates." },
];

export const dynamic = "force-dynamic";

export default async function Home() {
  const events = await getEvents();
  const slider = await getHomepageSliderConfig({ publicFallback: true, events });
  const eventSlides: HomepageSlide[] = events.slice(0, 5).map((event, index) => ({
    id: `event-${event.id}`,
    eventId: event.id,
    eventName: event.name,
    headline: event.name,
    description: event.description || `${event.sport} event in ${event.location}.`,
    image: event.bannerUrl || "/race-upshot-hero.png",
    primaryLabel: event.hasResults ? "View results" : "View event",
    primaryUrl: event.hasResults ? `/results/${event.slug}` : `/events/${event.slug}`,
    secondaryLabel: event.registrationUrl ? "Register" : undefined,
    secondaryUrl: event.registrationUrl,
    enabled: true,
    order: index + 1,
  }));
  const brandSlide: HomepageSlide = {
    id: "race-upshot-platform",
    eventName: "Race Upshot",
    headline: "Every second. Accounted for.",
    description: "Race Upshot uses a world-class timing system to connect athletes with live race progress, trusted results and finish-line certainty.",
    image: "/race-upshot-hero.png",
    primaryLabel: "Login as athlete",
    primaryUrl: "/athlete/login",
    secondaryLabel: "Explore events",
    secondaryUrl: "/events",
    enabled: true,
    order: 1,
  };
  const slides: HomepageSlide[] = !slider.enabled
    ? []
    : slider.slides.length
      ? slider.slides
      : eventSlides.length
        ? eventSlides
        : [brandSlide];
  const resultCounts = await Promise.allSettled(events.filter((event) => event.hasResults).map(async (event) => (await getResults(event.slug)).athletes.length));
  const resultCount = resultCounts.reduce((sum, result) => sum + (result.status === "fulfilled" ? result.value : 0), 0);
  return (
    <>
      <SiteHeader />
      <main>
        <HomepageHero slides={slides} resultCount={resultCount} />

        <section className="signal-strip">
          <div className="shell">
            <span><Zap /> SUB-SECOND ACCURACY</span>
            <span><Activity /> REAL-TIME RESULTS</span>
            <span><ShieldCheck /> VERIFIED OUTCOMES</span>
            <span><CircleGauge /> BUILT FOR SCALE</span>
          </div>
        </section>

        <section className="section shell">
          <div className="section-heading">
            <div><span className="eyebrow">RACE DAY, RIGHT NOW</span><h2>Events in motion.</h2></div>
            <Link href="/events" className="text-link dark">View all events <ArrowRight /></Link>
          </div>
          <div className="events-grid">
            {events.slice(0, 3).map((event) => <EventCard key={event.slug} event={event} />)}
          </div>
          {!events.length && <p className="admin-empty">No published events are available.</p>}
        </section>

        <section className="section shell services-section">
          <div className="section-heading align-end">
            <div><span className="eyebrow">WHAT WE RUN</span><h2>Technology that moves<br />with your event.</h2></div>
            <p>One connected timing operation from race setup through verified publication.</p>
          </div>
          <div className="services-grid">
            {services.map(({ icon: Icon, title, text }, index) => (
              <article key={title}>
                <span className="service-num">0{index + 1}</span>
                <Icon />
                <h3>{title}</h3>
                <p>{text}</p>
                <Link href="/services" aria-label={`Learn about ${title}`}><ArrowUpRight /></Link>
              </article>
            ))}
          </div>
        </section>

        <section className="stats-section">
          <div className="shell stats-grid">
            <div><strong>{events.length}</strong><span>race events</span></div>
            <div><strong>{resultCount.toLocaleString()}</strong><span>result records</span></div>
            <div><strong>{events.filter((event) => event.status === "live").length}</strong><span>live events</span></div>
            <div><strong>{events.filter((event) => event.hasResults).length}</strong><span>published result sets</span></div>
          </div>
        </section>

        <section className="section shell result-finder">
          <div className="finder-copy">
            <span className="eyebrow">FIND YOUR FINISH</span>
            <h2>Your race.<br />Your result.</h2>
            <p>Search every published Race Upshot event by athlete name, event, or bib number.</p>
          </div>
          <SearchPanel />
        </section>

        <section className="testimonial">
          <div className="shell">
            <Waves />
            <blockquote>“The timing operation became the calmest part of race day. Results were live before athletes reached the recovery area.”</blockquote>
            <p><strong>Race Director</strong> · National endurance series</p>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
