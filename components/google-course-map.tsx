"use client";

import type { EventCourseMap } from "@/packages/contracts/src";
import { AlertTriangle, LocateFixed, MapPinned } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CourseMapCanvas } from "./course-map-canvas";
import { CourseElevationProfile } from "./course-elevation-profile";

type LatLng = { lat: number; lng: number };
type GoogleMap = { fitBounds: (bounds: unknown, padding?: number) => void };
type MapsApi = {
  Map: new (node: HTMLElement, options: Record<string, unknown>) => GoogleMap;
  LatLngBounds: new () => { extend: (point: LatLng) => void };
  Polyline: new (options: Record<string, unknown>) => unknown;
  Circle: new (options: Record<string, unknown>) => unknown;
  ControlPosition: { RIGHT_BOTTOM: number };
  MapTypeControlStyle: { HORIZONTAL_BAR: number };
};
type GoogleWindow = Window & { google?: { maps?: MapsApi } };

let googleMapsPromise: Promise<MapsApi> | null = null;

function mapsConfigUrl() {
  if (typeof window === "undefined") return "/api/public/maps-config";
  const { hostname } = window.location;
  // Local Next/Expo Web hosts do not have the production Worker secret. Read
  // the public, CORS-enabled config from Race Upshot in those environments.
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
    ? "https://raceupshot.com/api/public/maps-config"
    : "/api/public/maps-config";
}

function loadGoogleMaps(apiKey: string): Promise<MapsApi> {
  const existing = (window as GoogleWindow).google?.maps;
  if (existing?.Map) return Promise.resolve(existing);
  if (googleMapsPromise) return googleMapsPromise;
  googleMapsPromise = new Promise((resolve, reject) => {
    const callback = `raceUpshotGoogleMapsReady${Date.now()}`;
    const target = window as unknown as GoogleWindow & Record<string, unknown>;
    target[callback] = () => {
      delete target[callback];
      const maps = target.google?.maps;
      if (maps?.Map) resolve(maps);
      else reject(new Error("Google Maps loaded without the maps library."));
    };
    const script = document.createElement("script");
    script.id = "raceupshot-google-maps";
    script.async = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async&callback=${callback}`;
    script.onerror = () => {
      googleMapsPromise = null;
      delete target[callback];
      reject(new Error("Google Maps could not be loaded."));
    };
    document.head.append(script);
  });
  return googleMapsPromise;
}

export function GoogleCourseMap({ maps, label = "Live Google course map" }: { maps: EventCourseMap[]; label?: string }) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const [apiKey, setApiKey] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const pointCount = maps.reduce((total, map) => total + map.points.length, 0);

  useEffect(() => {
    let active = true;
    void fetch(mapsConfigUrl(), { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as { ok?: boolean; data?: { configured: boolean; apiKey: string } };
        if (!response.ok || !payload.ok || !payload.data) throw new Error("Google Maps configuration is unavailable.");
        if (!active) return;
        setConfigured(payload.data.configured);
        setApiKey(payload.data.apiKey);
      })
      .catch((reason) => {
        if (!active) return;
        setConfigured(false);
        setError(reason instanceof Error ? reason.message : "Google Maps configuration is unavailable.");
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!apiKey || !nodeRef.current || pointCount < 2) return;
    let active = true;
    setError("");
    void loadGoogleMaps(apiKey).then((googleMaps) => {
      if (!active || !nodeRef.current) return;
      nodeRef.current.replaceChildren();
      const first = maps.find((map) => map.points.length)?.points[0];
      if (!first) return;
      const map = new googleMaps.Map(nodeRef.current, {
        center: { lat: first.latitude, lng: first.longitude },
        zoom: 13,
        mapTypeId: "roadmap",
        mapTypeControl: true,
        mapTypeControlOptions: { style: googleMaps.MapTypeControlStyle.HORIZONTAL_BAR, position: googleMaps.ControlPosition.RIGHT_BOTTOM },
        streetViewControl: false,
        fullscreenControl: true,
        gestureHandling: "greedy",
      });
      const bounds = new googleMaps.LatLngBounds();
      maps.forEach((course) => {
        if (course.points.length < 2) return;
        const path = course.points.map((point) => ({ lat: point.latitude, lng: point.longitude }));
        path.forEach((point) => bounds.extend(point));
        new googleMaps.Polyline({ map, path, strokeColor: "#ffffff", strokeOpacity: .92, strokeWeight: 9, clickable: false, zIndex: 1 });
        new googleMaps.Polyline({ map, path, strokeColor: course.routeColor, strokeOpacity: 1, strokeWeight: 5, clickable: false, zIndex: 2 });
        new googleMaps.Circle({ map, center: path[0], radius: 8, fillColor: "#16a34a", fillOpacity: 1, strokeColor: "#ffffff", strokeWeight: 3, zIndex: 3 });
        new googleMaps.Circle({ map, center: path[path.length - 1], radius: 8, fillColor: "#ef4444", fillOpacity: 1, strokeColor: "#ffffff", strokeWeight: 3, zIndex: 3 });
      });
      map.fitBounds(bounds, 42);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : "Google Maps could not render this course.");
    });
    return () => { active = false; };
  }, [apiKey, maps, pointCount]);

  if (pointCount < 2) return <div className="course-map-empty">Upload a GPX file to preview its actual route on Google Maps.</div>;
  if (configured === false) return <div className="google-course-map-fallback"><CourseMapCanvas maps={maps} label={label}/><p><AlertTriangle/> {error||"Google Maps is not configured. Add GOOGLE_MAPS_BROWSER_API_KEY to the Race Upshot Worker."}</p></div>;
  return <><div className="google-course-map-shell"><div ref={nodeRef} className="google-course-map" role="img" aria-label={label}>{configured===null&&<span><LocateFixed/> Loading Google Maps…</span>}</div><div className="google-course-map-overlay"><b><MapPinned/> Live course map</b><span><i className="start"/>Start</span><span><i className="finish"/>Finish</span>{maps.map(map=><span key={map.mapId}><i style={{background:map.routeColor}}/>{map.mapName}</span>)}</div></div><CourseElevationProfile maps={maps} /></>;
}
