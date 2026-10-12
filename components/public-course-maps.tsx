"use client";

import { GoogleCourseMap } from "./google-course-map";
import type { EventCourseView } from "@/packages/contracts/src";
import { Layers3, Map } from "lucide-react";
import { useMemo, useState } from "react";

export function PublicCourseMaps({ course }: { course: EventCourseView }) {
  const [category, setCategory] = useState(course.categories[0] || "");
  const categoryMaps = useMemo(() => course.maps.filter((map) => map.category === category), [category, course.maps]);
  const [view, setView] = useState("combined");
  const visibleMaps = view === "combined" ? categoryMaps : categoryMaps.filter((map) => map.mapId === view);

  if (!course.maps.length) return null;
  return (
    <div className="result-card public-course-card">
      <div className="public-course-head">
        <div><span className="eyebrow">INTERACTIVE COURSE</span><h2><Map /> Course maps</h2><p>Routes automatically fit the uploaded GPX coordinates.</p></div>
        <span><Layers3 /> {categoryMaps.length} segment{categoryMaps.length === 1 ? "" : "s"}</span>
      </div>
      {course.categories.length > 1 && (
        <div className="course-tab-row course-category-tabs">
          {course.categories.map((item) => <button key={item} className={category === item ? "active" : ""} onClick={() => { setCategory(item); setView("combined"); }}>{item}</button>)}
        </div>
      )}
      <div className="course-tab-row">
        <button className={view === "combined" ? "active" : ""} onClick={() => setView("combined")}>Combined Course</button>
        {categoryMaps.map((map) => <button key={map.mapId} className={view === map.mapId ? "active" : ""} onClick={() => setView(map.mapId)}><i style={{ background: map.routeColor }} />{map.mapName}</button>)}
      </div>
      <GoogleCourseMap maps={visibleMaps} label={`${category} ${view === "combined" ? "combined course" : "course map"}`} />
      <div className="course-map-legend">
        {visibleMaps.map((map) => <span key={map.mapId}><i style={{ background: map.routeColor }} /><b>{map.mapName}</b><small>{map.category}</small></span>)}
      </div>
    </div>
  );
}
