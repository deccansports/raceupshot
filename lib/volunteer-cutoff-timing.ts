import type { LiveParticipant, LiveSplit } from "@/packages/contracts/src";
import { getCanonicalLiveEvent } from "./canonical-live-tracking";
import { getLiveTrackingHubConfig, type LiveTrackingHubConfig } from "./live-tracking-hub-config";

export type CutoffState = "SAFE" | "WATCH" | "DANGER" | "OUT OF CUTOFF" | "DNF" | "NO CUTOFF";
export interface CutoffTimingAthlete {
  id: string; bib: string; name: string; category: string; status: string; currentLeg: string; currentSplit: string;
  started: boolean; finished: boolean; cutoff: { label: string; deadline: string | null; remainingSeconds: number | null; status: CutoffState };
}
export interface VolunteerCutoffTimingPayload {
  generatedAt: string; message: string;
  overview: { total: number; racing: number; withinCutoff: number; approachingCutoff: number; outOfCutoff: number; dnf: number };
  athletes: CutoffTimingAthlete[];
}

const TERMINAL = new Set(["DNF", "DNS", "DNQ", "DSQ", "OTL"]);
const normalized = (value: unknown) => String(value || "UNKNOWN").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
function accepted(split: LiveSplit) { return Boolean(split.readerTimestamp || split.timestamp || split.officialTimeMs !== undefined || split.chipTimeMs !== undefined || split.gunTimeMs !== undefined || split.cumulativeTime); }
function completed(participant: LiveParticipant) { return new Set(participant.splits.filter(accepted).flatMap((split) => [split.splitId, split.name].filter(Boolean).map((value) => value.toLowerCase()))); }
function startAt(participant: LiveParticipant, config: LiveTrackingHubConfig): string | null {
  const first = participant.splits.find(accepted);
  const value = config.start.timingMode === "CHIP" ? first?.chipStartTimestamp || first?.gunStartTimestamp || config.start.gunStartAt : first?.gunStartTimestamp || config.start.gunStartAt || first?.chipStartTimestamp;
  return value && Number.isFinite(Date.parse(value)) ? value : null;
}
function durationSeconds(value: string | undefined): number | null {
  if (!value) return null;
  const parts = value.split(":").map(Number);
  return parts.length && parts.every((part) => Number.isFinite(part) && part >= 0) ? parts.reduce((total, part) => total * 60 + part, 0) : null;
}
function elapsed(participant: LiveParticipant, config: LiveTrackingHubConfig, nowMs: number): number | null {
  const start = startAt(participant, config);
  if (start) return Math.max(0, Math.floor((nowMs - Date.parse(start)) / 1_000));
  const final = durationSeconds(participant.elapsedTime || participant.cumulativeTime);
  const last = [...participant.splits].filter(accepted).at(-1);
  const milliseconds = last?.officialTimeMs ?? last?.chipTimeMs ?? last?.gunTimeMs;
  return milliseconds === undefined ? final : Math.max(0, Math.floor(milliseconds / 1_000));
}
function cutoff(participant: LiveParticipant, config: LiveTrackingHubConfig, elapsedSeconds: number | null, nowMs: number) {
  const done = completed(participant);
  const legs = [...config.legs].toSorted((left, right) => left.order - right.order);
  const currentLeg = legs.find((leg) => leg.id === participant.currentLeg || leg.name.toLowerCase() === participant.currentLeg?.toLowerCase());
  const candidates = [
    ...config.splits.filter((split) => split.visible !== false && split.cutoffSeconds !== null && !done.has(split.id.toLowerCase()) && !done.has(split.name.toLowerCase())).map((split) => ({ label: `${split.name} cutoff`, seconds: split.cutoffSeconds as number, order: split.order * 2 })),
    ...legs.filter((leg) => leg.cutoffSeconds !== null && leg.cutoffSeconds !== undefined && (!currentLeg || leg.order >= currentLeg.order)).map((leg) => ({ label: `${leg.name} cutoff`, seconds: leg.cutoffSeconds as number, order: leg.order * 2 + 1 })),
    ...(config.start.overallCutoffSeconds !== null ? [{ label: "Overall finish cutoff", seconds: config.start.overallCutoffSeconds, order: Number.MAX_SAFE_INTEGER }] : []),
  ].toSorted((left, right) => left.order - right.order || left.seconds - right.seconds);
  const next = candidates[0];
  if (!next) return { label: "No pending cutoff", deadline: null, remainingSeconds: null, status: "NO CUTOFF" as const };
  const start = startAt(participant, config);
  const deadlineMs = start ? Date.parse(start) + next.seconds * 1_000 : null;
  const remainingSeconds = deadlineMs !== null ? Math.floor((deadlineMs - nowMs) / 1_000) : elapsedSeconds === null ? null : next.seconds - elapsedSeconds;
  const raceStatus = normalized(participant.raceStatus);
  const state: CutoffState = raceStatus === "DNF" ? "DNF" : TERMINAL.has(raceStatus) || (remainingSeconds !== null && remainingSeconds <= 0) ? "OUT OF CUTOFF" : remainingSeconds !== null && remainingSeconds <= 15 * 60 ? "DANGER" : remainingSeconds !== null && remainingSeconds <= 30 * 60 ? "WATCH" : "SAFE";
  return { label: next.label, deadline: deadlineMs === null ? null : new Date(deadlineMs).toISOString(), remainingSeconds, status: state };
}

export function buildVolunteerCutoffTimingPayload(participants: LiveParticipant[], config: LiveTrackingHubConfig, now = new Date()): VolunteerCutoffTimingPayload {
  const nowMs = now.getTime();
  const athletes = participants.map((participant): CutoffTimingAthlete => {
    const raceStatus = normalized(participant.raceStatus);
    const finished = raceStatus === "FINISHED";
    const started = finished || (!TERMINAL.has(raceStatus) && !["NOT_STARTED", "UNKNOWN"].includes(raceStatus)) || participant.splits.some(accepted);
    const last = [...participant.splits].filter(accepted).at(-1);
    const elapsedSeconds = elapsed(participant, config, nowMs);
    return { id: participant.participantUid, bib: participant.bib || "—", name: participant.fullName || participant.displayName || "Athlete", category: participant.contestName || "—", status: raceStatus, currentLeg: String(participant.currentLeg || (started ? "ON COURSE" : "NOT STARTED")).replaceAll("_", " "), currentSplit: participant.latestTimingPoint || last?.name || "—", started, finished, cutoff: cutoff(participant, config, elapsedSeconds, nowMs) };
  });
  const monitored = athletes.filter((athlete) => athlete.started && !athlete.finished);
  return {
    generatedAt: now.toISOString(), message: athletes.length ? "Canonical cutoff timing loaded." : "No canonical athlete timing is published for this event.",
    overview: { total: athletes.length, racing: monitored.filter((athlete) => !TERMINAL.has(athlete.status)).length, withinCutoff: monitored.filter((athlete) => athlete.cutoff.status === "SAFE").length, approachingCutoff: monitored.filter((athlete) => athlete.cutoff.status === "WATCH" || athlete.cutoff.status === "DANGER").length, outOfCutoff: monitored.filter((athlete) => athlete.cutoff.status === "OUT OF CUTOFF" || athlete.cutoff.status === "DNF").length, dnf: athletes.filter((athlete) => athlete.status === "DNF").length },
    athletes,
  };
}

export async function getVolunteerCutoffTiming(eventId: string) {
  const [canonical, config] = await Promise.all([getCanonicalLiveEvent(eventId), getLiveTrackingHubConfig(eventId)]);
  if (!config) throw new Error("Live timing configuration is unavailable for this event.");
  return buildVolunteerCutoffTimingPayload(canonical?.participants ?? [], config);
}
