"use client";

import { Search } from "lucide-react";
import { getCountryFlagFromValue } from "@/lib/countries";
import type { Athlete } from "@/lib/types";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Leaderboard } from "./leaderboard";

function athleteInitials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "RU";
}

function PodiumCard({ athlete, eventSlug, position }: { athlete: Athlete; eventSlug: string; position: number }) {
  const anonymous = athlete.visibility === "ANONYMOUS";
  const resultUrl = `/results/${eventSlug}/athlete/${athlete.id}`;
  const flag = getCountryFlagFromValue(athlete.country);
  return (
    <article className={`results-podium-card podium-rank-${position}`}>
      <div className="podium-avatar" aria-hidden="true">{athleteInitials(anonymous ? "Anonymous Athlete" : athlete.name)}</div>
      <div className="podium-athlete-name">
        {anonymous ? <strong>Anonymous Athlete</strong> : <Link href={resultUrl} prefetch={false}>{athlete.name}</Link>}
        {!anonymous && (flag || athlete.country) ? <small>{flag} {athlete.country}</small> : null}
      </div>
      <div className="podium-metric">
        <span>BIB NO</span>
        {anonymous ? <strong>—</strong> : <Link href={resultUrl} prefetch={false}>{athlete.bib}</Link>}
      </div>
      <div className="podium-metric podium-finish-time">
        <span>FINISH TIME</span>
        <strong>{athlete.finishTime || "—"}</strong>
      </div>
      <div className="podium-position" aria-label={`Rank ${position}`}>{position}</div>
    </article>
  );
}

export function ResultsLeaderboardPanel({ eventSlug, categories, athletes }: { eventSlug: string; categories: string[]; athletes: Athlete[] }) {
  const [category, setCategory] = useState("Overall");
  const [gender, setGender] = useState("All");
  const [ageGroup, setAgeGroup] = useState("All");
  const [query, setQuery] = useState("");
  const options = useMemo(() => ["Overall", ...categories.filter((item) => item && item !== "Overall")], [categories]);
  const genders = useMemo(() => [...new Set(athletes.map((athlete) => athlete.gender).filter(Boolean))], [athletes]);
  const ageGroups = useMemo(() => [...new Set(athletes.map((athlete) => athlete.ageGroup).filter(Boolean))], [athletes]);
  const filtered = useMemo(() => {
    return athletes.filter((athlete) => {
      const matchesCategory = category === "Overall"
        || athlete.category.toLocaleLowerCase() === category.toLocaleLowerCase()
        || athlete.ageGroup.toLocaleLowerCase() === category.toLocaleLowerCase();
      const matchesGender = gender === "All" || athlete.gender.toLocaleLowerCase() === gender.toLocaleLowerCase();
      const matchesAgeGroup = ageGroup === "All" || athlete.ageGroup.toLocaleLowerCase() === ageGroup.toLocaleLowerCase();
      return matchesCategory && matchesGender && matchesAgeGroup;
    });
  }, [ageGroup, athletes, category, gender]);
  const visible = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return filtered.filter((athlete) => !normalizedQuery
      || athlete.name.toLocaleLowerCase().includes(normalizedQuery)
      || athlete.bib.toLocaleLowerCase().includes(normalizedQuery));
  }, [filtered, query]);
  const leaders = useMemo(() => filtered
    .filter((athlete) => athlete.rank > 0 && athlete.status.toLocaleLowerCase() === "finished")
    .sort((left, right) => left.rank - right.rank || left.finishTime.localeCompare(right.finishTime))
    .slice(0, 3), [filtered]);
  const storedRanksAreDistinct = new Set(leaders.map((athlete) => athlete.rank)).size === leaders.length;
  const rankedLeaders = leaders.map((athlete, index) => ({
    athlete,
    position: storedRanksAreDistinct ? athlete.rank : index + 1,
  }));
  const podium = [rankedLeaders[1], rankedLeaders[0], rankedLeaders[2]].filter(Boolean);
  const scope = [gender !== "All" ? gender : "", ageGroup !== "All" ? ageGroup : ""].filter(Boolean).join(" · ") || "Overall";
  const podiumTitle = `${category === "Overall" ? "All Categories" : category} — ${scope}`;
  return (
    <>
      <div className="filter-bar">
        {options.map((item) => <button key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{item}</button>)}
        <select aria-label="Gender" value={gender} onChange={(event) => setGender(event.target.value)}>
          <option value="All">All genders</option>
          {genders.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select aria-label="Age group" value={ageGroup} onChange={(event) => setAgeGroup(event.target.value)}>
          <option value="All">All age groups</option>
          {ageGroups.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <label className="result-search">
          <Search size={14} aria-hidden="true" />
          <span className="sr-only">Search athlete name or bib</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Athlete / bib"
            autoComplete="off"
          />
        </label>
      </div>
      <section className="results-podium" aria-labelledby="results-podium-title">
        <header>
          <span>Top finishers</span>
          <h2 id="results-podium-title">{podiumTitle}</h2>
        </header>
        {podium.length ? (
          <div className={`results-podium-grid podium-count-${podium.length}`}>
            {podium.map(({ athlete, position }) => <PodiumCard key={athlete.id} athlete={athlete} position={position} eventSlug={eventSlug} />)}
          </div>
        ) : <p className="results-podium-empty">No finished athletes are available for this selection.</p>}
      </section>
      <Leaderboard
        eventSlug={eventSlug}
        athletes={visible}
        heading="Complete results"
        emptyMessage={query.trim() ? `No athlete or bib matches “${query.trim()}”.` : undefined}
      />
    </>
  );
}
