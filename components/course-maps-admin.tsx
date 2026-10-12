"use client";

import { GoogleCourseMap } from "./google-course-map";
import type {
  CourseMapType,
  CoursePoint,
  EventCourseCollection,
  EventCourseMap,
} from "@/packages/contracts/src";
import { COURSE_MAP_TYPES } from "@/packages/contracts/src";
import { CheckCircle2, FileUp, GripVertical, Link2, Loader2, Map, Pencil, Plus, RefreshCw, Save, Trash2, X } from "lucide-react";
import { ChangeEvent, DragEvent, useEffect, useMemo, useState } from "react";

const TYPE_LABELS: Record<CourseMapType, string> = {
  RACE_COURSE: "Race Course",
  SWIM: "Swim",
  BIKE: "Bike",
  RUN: "Run",
  RUN_1: "Run 1",
  RUN_2: "Run 2",
  ALTERNATE_ROUTE: "Alternate Route",
  EMERGENCY_ROUTE: "Emergency Route",
  AID_STATIONS: "Aid Stations",
  SHUTTLE_ROUTE: "Shuttle Route",
  EXPO_AREA: "Expo Area",
  PARKING: "Parking",
  SPECTATOR_ZONE: "Spectator Zone",
  TRANSITION_AREA: "Transition Area",
  CUSTOM: "Custom",
};

const TYPE_COLORS: Partial<Record<CourseMapType, string>> = {
  SWIM: "#168aad",
  BIKE: "#e6ad12",
  RUN: "#d1495b",
  RUN_1: "#d1495b",
  RUN_2: "#7f2f45",
  RACE_COURSE: "#1768ac",
  AID_STATIONS: "#2d936c",
};

type DraftMap = Omit<EventCourseMap, "mapId" | "eventId" | "updatedAt" | "displayOrder"> & {
  mapId?: string;
  fileName: string;
};

function emptyDraft(category: string): DraftMap {
  return {
    category,
    mapName: "Race Course",
    mapType: "RACE_COURSE",
    fileName: "",
    gpxUrl: undefined,
    points: [],
    distanceKm: null,
    description: "",
    cutoffSeconds: null,
    routeColor: TYPE_COLORS.RACE_COURSE!,
    visibility: { web: true, mobile: true, public: true },
  };
}

function pointElements(document: XMLDocument) {
  const names = ["trkpt", "rtept", "wpt"];
  return names.flatMap((name) => Array.from(document.getElementsByTagNameNS("*", name)));
}

function parsedNumber(value: string | null) {
  if (value === null || value.trim() === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function parseGpx(gpxData: string): { gpxData: string; points: CoursePoint[] } {
  const document = new DOMParser().parseFromString(gpxData, "application/xml");
  if (document.querySelector("parsererror")) throw new Error("The GPX file contains invalid XML.");
  const points = pointElements(document).map((element) => {
    const latitude = parsedNumber(element.getAttribute("lat"));
    const longitude = parsedNumber(element.getAttribute("lon"));
    const elevation = parsedNumber(element.getElementsByTagNameNS("*", "ele")[0]?.textContent ?? null);
    return latitude === undefined || longitude === undefined ? null : {
      latitude,
      longitude,
      ...(elevation === undefined ? {} : { elevation }),
    };
  }).filter((point): point is CoursePoint => Boolean(point));
  if (points.length < 2) throw new Error("The GPX file must contain at least two track, route, or waypoint coordinates.");
  const maximumPoints = 5_000;
  const simplified = points.length <= maximumPoints
    ? points
    : Array.from({ length: maximumPoints }, (_, index) => points[Math.round(index * (points.length - 1) / (maximumPoints - 1))]);
  return { gpxData, points: simplified };
}

async function readGpx(file: File): Promise<{ gpxData: string; points: CoursePoint[] }> {
  if (!file.name.toLowerCase().endsWith(".gpx") && !["application/gpx+xml", "application/xml", "text/xml"].includes(file.type)) throw new Error("Choose a GPX file.");
  if (file.size > 4_000_000) throw new Error("GPX files must be smaller than 4 MB.");
  return parseGpx(await file.text());
}

export function CourseMapsAdmin({
  eventId,
  eventName,
  sport,
  categories,
  initialCollection,
  onSaved,
  splitCounts = {},
}: {
  eventId: string;
  eventName: string;
  sport: string;
  categories: string[];
  initialCollection: EventCourseCollection;
  onSaved?: (collection: EventCourseCollection) => void;
  splitCounts?: Partial<Record<CourseMapType, number>>;
}) {
  const [syncedCategories, setSyncedCategories] = useState(categories);
  useEffect(() => {
    const handleCategories = (event: Event) => {
      const detail = (event as CustomEvent<{ categories?: string[] }>).detail;
      if (!detail?.categories?.length) return;
      setSyncedCategories((current) => [...new Set([...current, ...detail.categories!].filter(Boolean))]);
    };
    window.addEventListener("raceupshot:categories-synced", handleCategories);
    return () => window.removeEventListener("raceupshot:categories-synced", handleCategories);
  }, []);
  const initialCategoryOptions = useMemo(
    () => [...new Set(["Overall", ...syncedCategories, ...initialCollection.maps.map((map) => map.category)].filter(Boolean))],
    [syncedCategories, initialCollection.maps],
  );
  const [maps, setMaps] = useState(initialCollection.maps);
  const categoryOptions = useMemo(
    () => [...new Set(["Overall", ...syncedCategories, ...maps.map((map) => map.category)].filter(Boolean))],
    [syncedCategories, maps],
  );
  const [draft, setDraft] = useState<DraftMap>(() => emptyDraft(initialCategoryOptions[0] || "Overall"));
  const [selectedCategory, setSelectedCategory] = useState(initialCategoryOptions[0] || "Overall");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingUrl, setLoadingUrl] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    async function loadPersistedMaps() {
      try {
        const response = await fetch(`/api/admin/events/${encodeURIComponent(eventId)}/course-maps`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json() as { ok?: boolean; data?: EventCourseCollection };
        if (response.ok && payload.ok && payload.data) {
          const renderedAt = initialCollection.updatedAt ? Date.parse(initialCollection.updatedAt) : 0;
          const persistedAt = payload.data.updatedAt ? Date.parse(payload.data.updatedAt) : 0;
          if (!renderedAt || persistedAt >= renderedAt) setMaps(payload.data.maps);
        }
      } catch (reason) {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) {
          // Keep the server-rendered collection available if the refresh is temporarily unavailable.
        }
      }
    }
    void loadPersistedMaps();
    return () => controller.abort();
  }, [eventId, initialCollection.updatedAt]);

  async function chooseGpx(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      const parsed = await readGpx(file);
      setDraft((current) => ({ ...current, ...parsed, fileName: file.name }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to read the GPX file.");
    } finally {
      event.target.value = "";
    }
  }

  async function loadGpxUrl() {
    const url=draft.gpxUrl?.trim();
    if(!url){setError("Paste a GPX URL first.");return;}
    setLoadingUrl(true);setError("");
    try{
      const response=await fetch(url,{cache:"no-store",signal:AbortSignal.timeout(20_000)});
      if(!response.ok)throw new Error(`GPX URL returned HTTP ${response.status}.`);
      const data=await response.text();
      if(data.length>4_000_000)throw new Error("GPX files must be smaller than 4 MB.");
      const parsed=parseGpx(data);
      const fileName=new URL(url).pathname.split("/").filter(Boolean).at(-1)||"remote-course.gpx";
      setDraft(current=>({...current,...parsed,fileName,gpxUrl:url}));
      setMessage("GPX URL loaded. Review the route, then add or update the map.");
    }catch(reason){setError(reason instanceof Error?reason.message:"Unable to load the GPX URL.");}
    finally{setLoadingUrl(false);}
  }

  async function reloadSavedMaps() {
    setReloading(true);setError("");
    try{
      const response=await fetch(`/api/admin/events/${encodeURIComponent(eventId)}/course-maps`,{cache:"no-store"});
      const payload=await response.json() as {ok?:boolean;data?:EventCourseCollection;error?:string};
      if(!response.ok||!payload.ok||!payload.data)throw new Error(payload.error||"Unable to load saved maps.");
      setMaps(payload.data.maps);onSaved?.(payload.data);setMessage("Saved course maps reloaded from Race Upshot KV.");
    }catch(reason){setError(reason instanceof Error?reason.message:"Unable to load saved maps.");}
    finally{setReloading(false);}
  }

  function changeType(mapType: CourseMapType) {
    setDraft((current) => ({
      ...current,
      mapType,
      mapName: editingId ? current.mapName : TYPE_LABELS[mapType],
      routeColor: TYPE_COLORS[mapType] || current.routeColor,
      customType: mapType === "CUSTOM" ? current.customType : undefined,
    }));
  }

  async function persistMaps(nextMaps: EventCourseMap[], successMessage: string) {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/admin/events/${encodeURIComponent(eventId)}/course-maps`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maps: nextMaps }),
      });
      const payload = await response.json() as { ok?: boolean; data?: EventCourseCollection; error?: string };
      if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error || "Unable to save course maps.");
      setMaps(payload.data.maps);
      onSaved?.(payload.data);
      setMessage(successMessage);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save course maps.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function commitDraft() {
    setError("");
    if (!draft.category.trim() || !draft.mapName.trim()) {
      setError("Enter the category and map name.");
      return;
    }
    if (draft.mapType === "CUSTOM" && !draft.customType?.trim()) {
      setError("Enter a custom map type.");
      return;
    }
    if (draft.points.length < 2 || !draft.fileName) {
      setError("Upload a valid GPX file for this map.");
      return;
    }
    const now = new Date().toISOString();
    const map: EventCourseMap = {
      ...draft,
      mapId: editingId || crypto.randomUUID(),
      eventId,
      displayOrder: editingId ? maps.find((item) => item.mapId === editingId)?.displayOrder ?? maps.length : maps.length,
      updatedAt: now,
    };
    const nextMaps = (editingId
      ? maps.map((item) => item.mapId === editingId ? map : item)
      : [...maps, map]
    ).map((item, index) => ({ ...item, displayOrder: index }));
    const action = editingId ? "updated" : "added";
    if (await persistMaps(nextMaps, `Map ${action} and published to web and mobile.`)) {
      setEditingId(null);
      setDraft(emptyDraft(draft.category));
    }
  }

  function editMap(map: EventCourseMap) {
    setEditingId(map.mapId);
    setDraft({
      mapId: map.mapId,
      category: map.category,
      mapName: map.mapName,
      mapType: map.mapType,
      customType: map.customType,
      fileName: map.fileName,
      gpxUrl: map.gpxUrl,
      gpxData: map.gpxData,
      points: map.points,
      distanceKm: map.distanceKm ?? null,
      description: map.description ?? "",
      cutoffSeconds: map.cutoffSeconds ?? null,
      routeColor: map.routeColor,
      visibility: map.visibility,
    });
    document.getElementById("course-map-editor")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function dropMap(event: DragEvent, targetId: string) {
    event.preventDefault();
    if (!draggedId || draggedId === targetId) return;
    setMaps((current) => {
      const sourceIndex = current.findIndex((map) => map.mapId === draggedId);
      const targetIndex = current.findIndex((map) => map.mapId === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const next = [...current];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next.map((map, index) => ({ ...map, displayOrder: index }));
    });
    setDraggedId(null);
  }

  async function saveMaps() {
    await persistMaps(maps, "Course maps published to web, mobile and public views according to their visibility settings.");
  }

  const previewMap: EventCourseMap = {
    ...draft,
    mapId: draft.mapId || "preview",
    eventId,
    displayOrder: 0,
    updatedAt: new Date().toISOString(),
  };
  const selectedMaps=maps.filter(map=>map.category===selectedCategory);
  const splitCount=(map:EventCourseMap)=>splitCounts[map.mapType]??(map.mapType==="RACE_COURSE"?Object.values(splitCounts).reduce((total,value)=>total+(value??0),0):0);
  const formatDistance=(value:number|null|undefined)=>value==null?"—":`${value.toLocaleString()} km`;
  const formatCutoff=(value:number|null|undefined)=>value==null?"—":`${Math.floor(value/3600)}:${String(Math.floor(value%3600/60)).padStart(2,"0")}:${String(value%60).padStart(2,"0")}`;

  return (
    <section className="admin-card course-maps-admin" id="course-maps">
      <div className="admin-card-head">
        <div><h2><Map /> Course map assets</h2><p>Upload GPX files or paste GPX URLs. Changes are saved to this Race Upshot event configuration.</p></div>
        <span className="status-pill">{maps.length} map{maps.length === 1 ? "" : "s"}</span>
      </div>
      <div className="bergman-course-selectors"><label><span>SELECTED RACE UPSHOT EVENT</span><select disabled><option>{eventName}</option></select></label><label><span>CATEGORY</span><select value={selectedCategory} onChange={event=>{setSelectedCategory(event.target.value);setDraft(current=>({...current,category:event.target.value}));}}>{categoryOptions.map(category=><option key={category}>{category}</option>)}</select></label></div>
      <div className="bergman-course-category"><header><div><small>SELECTED CATEGORY</small><h3>{selectedCategory}</h3><span>{selectedCategory} · Race Upshot event category</span></div><div><span className="status-pill">{selectedMaps.length?"Course maps loaded":"No maps saved yet"}</span><button className="button" disabled={reloading} onClick={()=>void reloadSavedMaps()}>{reloading?<Loader2 className="spin"/>:<RefreshCw/>} Load saved maps</button></div></header>
        {selectedMaps.length?<><div className="bergman-course-summaries">{selectedMaps.map(map=><article key={`${map.mapId}-summary`}><small>{TYPE_LABELS[map.mapType]} Distance</small><b>{formatDistance(map.distanceKm)}</b><p>{map.description||"—"}</p><code>{map.gpxUrl||map.fileName}</code></article>)}</div><div className="bergman-course-summaries compact">{selectedMaps.map(map=><article key={`${map.mapId}-splits`}><small>{TYPE_LABELS[map.mapType]} Splits</small><b>{splitCount(map)}</b><p>From saved Race Flow configuration</p></article>)}</div></>:<p className="admin-empty">Add a GPX asset for this category below.</p>}
      </div>
      <div className="course-map-recommendation"><b>Recommended for {sport}</b><span>{sport.toLowerCase().includes("tri") ? "Swim · Bike · Run · Combined" : sport.toLowerCase().includes("cycl") ? "Bike Course · Alternate Route" : "Race Course · Alternate Route · Aid Stations"}</span></div>
      {message && <div className="success-banner"><CheckCircle2 /> {message}</div>}
      {error && <div className="success-banner cms-error-banner">{error}</div>}

      <div className="course-map-admin-grid">
        <div className="course-map-form" id="course-map-editor">
          <div className="section-heading"><div><span className="eyebrow">{editingId ? "EDIT MAP" : "ADD MAP"}</span><h3>{editingId ? draft.mapName : "Upload a GPX route"}</h3></div>{editingId && <button type="button" onClick={() => { setEditingId(null); setDraft(emptyDraft(draft.category)); }}><X /> Cancel</button>}</div>
          <div className="form-grid">
            <div className="field">
              <label>Category</label>
              <select value={categoryOptions.includes(draft.category) ? draft.category : ""} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>
                <option value="">Custom category…</option>
                {categoryOptions.map((category) => <option value={category} key={category}>{category}</option>)}
              </select>
              {!categoryOptions.includes(draft.category) && <input value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} placeholder="Half Marathon or Bergman 102" />}
            </div>
            <div className="field"><label>Map name</label><input value={draft.mapName} onChange={(event) => setDraft({ ...draft, mapName: event.target.value })} placeholder="Race Course" /></div>
            <div className="field"><label>Map type</label><select value={draft.mapType} onChange={(event) => changeType(event.target.value as CourseMapType)}>{COURSE_MAP_TYPES.map((type) => <option key={type} value={type}>{TYPE_LABELS[type]}</option>)}</select></div>
            {draft.mapType === "CUSTOM" && <div className="field"><label>Custom map type</label><input value={draft.customType || ""} onChange={(event) => setDraft({ ...draft, customType: event.target.value })} placeholder="Parking, Expo Area…" /></div>}
            <div className="field"><label>Route color</label><div className="course-color-field"><input type="color" value={draft.routeColor} onChange={(event) => setDraft({ ...draft, routeColor: event.target.value })} /><code>{draft.routeColor}</code></div></div>
            <div className="field"><label>Segment distance (KM)</label><input type="number" min="0" step="0.1" value={draft.distanceKm??""} onChange={event=>setDraft({...draft,distanceKm:event.target.value?Number(event.target.value):null})} placeholder="0.0"/></div>
            <div className="field"><label>Cutoff (seconds)</label><input type="number" min="0" value={draft.cutoffSeconds??""} onChange={event=>setDraft({...draft,cutoffSeconds:event.target.value?Number(event.target.value):null})} placeholder="No cutoff"/></div>
            <div className="field"><label>GPX file</label><label className="course-file-button"><FileUp /> {draft.fileName || "Choose GPX"}<input type="file" accept=".gpx,application/gpx+xml,application/xml,text/xml" onChange={(event) => void chooseGpx(event)} /></label></div>
          </div>
          <div className="bergman-map-url"><label><span>GPX URL</span><div><input type="url" value={draft.gpxUrl??""} onChange={event=>setDraft({...draft,gpxUrl:event.target.value||undefined})} placeholder="Paste a public GPX URL"/><button className="button" type="button" disabled={loadingUrl||!draft.gpxUrl} onClick={()=>void loadGpxUrl()}>{loadingUrl?<Loader2 className="spin"/>:<Link2/>} Load URL</button></div></label><label><span>{TYPE_LABELS[draft.mapType]} Description</span><textarea rows={3} value={draft.description??""} onChange={event=>setDraft({...draft,description:event.target.value})} placeholder={`Describe the ${TYPE_LABELS[draft.mapType].toLowerCase()} leg...`}/></label></div>
          <div className="course-visibility">
            {(["web", "mobile", "public"] as const).map((surface) => <label key={surface}><input type="checkbox" checked={draft.visibility[surface]} onChange={(event) => setDraft({ ...draft, visibility: { ...draft.visibility, [surface]: event.target.checked } })} /><span>{surface}</span></label>)}
          </div>
          <GoogleCourseMap maps={draft.points.length ? [previewMap] : []} label={`${draft.mapName} Google Maps preview`} />
          <button type="button" className="button button-primary course-add-button" disabled={saving} onClick={() => void commitDraft()}>{saving ? <Loader2 className="spin" /> : editingId ? <Save /> : <Plus />} {saving ? "Publishing…" : editingId ? "Update and publish map" : "Add and publish map"}</button>
        </div>

        <div className="course-map-list">
          <div className="section-heading"><div><span className="eyebrow">DISPLAY ORDER</span><h3>Published maps</h3></div><small>Drag to reorder</small></div>
          {!maps.length && <p className="admin-empty">No course maps configured for this event.</p>}
          {maps.map((map) => (
            <article
              key={map.mapId}
              draggable
              onDragStart={() => setDraggedId(map.mapId)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => dropMap(event, map.mapId)}
              className="course-map-row"
            >
              <GripVertical />
              <i style={{ background: map.routeColor }} />
              <div><b>{map.mapName}</b><span>{map.category} · {map.mapType === "CUSTOM" ? map.customType : TYPE_LABELS[map.mapType]} · {formatDistance(map.distanceKm)} · {map.points.length.toLocaleString()} points</span><small>{map.description||"No segment description"} · Cutoff {formatCutoff(map.cutoffSeconds)} · {Object.entries(map.visibility).filter(([, visible]) => visible).map(([surface]) => surface).join(" · ") || "Private"}</small></div>
              <button type="button" onClick={() => editMap(map)} aria-label={`Edit ${map.mapName}`}><Pencil /></button>
              <button type="button" onClick={() => setMaps((current) => current.filter((item) => item.mapId !== map.mapId).map((item, index) => ({ ...item, displayOrder: index })))} aria-label={`Delete ${map.mapName}`}><Trash2 /></button>
            </article>
          ))}
          <GoogleCourseMap maps={maps} label="Combined course Google Maps preview" />
          <button type="button" className="button button-primary course-save-button" disabled={saving} onClick={() => void saveMaps()}><Save /> {saving ? "Saving…" : "Save course maps"}</button>
        </div>
      </div>
    </section>
  );
}
