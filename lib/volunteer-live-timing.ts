import type { LiveParticipant } from "@/packages/contracts/src";
import { getCanonicalLiveEvent } from "./canonical-live-tracking";
import { getLiveTrackingHubConfig, type LiveTrackingHubConfig } from "./live-tracking-hub-config";
import type { VolunteerProfile } from "./volunteer-management";
import { activeAssignment, requireModule } from "./volunteer-operations";
import { resolveVolunteerTimingState } from "./volunteer-timing-state";

export type VolunteerCourseStage = "SWIM" | "T1" | "BIKE" | "T2" | "RUN";
export type VolunteerCutoffStatus = "SAFE" | "WATCH" | "DANGER" | "OUT OF CUTOFF" | "DNF" | "NO CUTOFF";

export interface VolunteerTimingAthlete {
  id: string; bib: string; name: string; category: string; status: string; currentLeg: string;
  currentSplit: string; nextSplit: string; lastTimingAt: string | null; started: boolean; finished: boolean;
  overallSeconds: number | null; overallRank: number | null;
  cutoff: { label: string; deadline: string | null; remainingSeconds: number | null; status: VolunteerCutoffStatus };
}

export interface VolunteerLiveTimingPayload {
  generatedAt: string;
  message: string;
  overview: {
    total: number; notStarted: number; started: number; onCourse: number; finished: number; remaining: number; dnf: number;
    withinCutoff: number; approachingCutoff: number; outOfCutoff: number;
    courseStages: VolunteerCourseStage[]; legCounts: Record<VolunteerCourseStage, number>;
  };
  athletes: VolunteerTimingAthlete[];
  approaching: VolunteerTimingAthlete[];
  recentFinishers: VolunteerTimingAthlete[];
}

const TERMINAL_NON_FINISH = new Set(["DNF", "DNS", "DNQ", "DSQ", "OTL"]);

function statusOf(value: unknown): string {
  const normalized = String(value || "UNKNOWN").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  return normalized === "COMPLETED" || normalized === "FINISHER" ? "FINISHED" : normalized;
}

function stageOf(value: unknown): VolunteerCourseStage | null {
  const normalized = String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (normalized === "T1" || normalized.includes("TRANSITION_1")) return "T1";
  if (normalized === "T2" || normalized.includes("TRANSITION_2")) return "T2";
  if (normalized.includes("SWIM")) return "SWIM";
  if (normalized.includes("BIKE") || normalized.includes("CYCL")) return "BIKE";
  if (normalized.includes("RUN")) return "RUN";
  return null;
}

function durationSeconds(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
  const text = String(value || "").trim();
  if (!text) return null;
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
  const parts = text.split(":").map(Number);
  return parts.length > 1 && parts.every((part) => Number.isFinite(part) && part >= 0)
    ? parts.reduce((seconds, part) => seconds * 60 + part, 0)
    : null;
}

function splitTime(participant: LiveParticipant): string | null {
  const split = participant.splits.at(-1);
  const value = split?.timestamp || split?.readerTimestamp || participant.lastUpdatedAt || "";
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function completedSplitIds(participant: LiveParticipant): Set<string> {
  return new Set(participant.splits.filter((split) => !["PENDING", "MISSING", "INVALID", "REJECTED"].includes(String(split.status || "").toUpperCase())).flatMap((split) => [split.splitId, split.name].map((value) => value.trim().toLowerCase()).filter(Boolean)));
}

function nextConfiguredSplit(participant: LiveParticipant, hub: LiveTrackingHubConfig) {
  const completed = completedSplitIds(participant);
  const ordered = hub.splits.toSorted((left, right) => left.order - right.order);
  const lastAcceptedOrder = Math.max(-Infinity, ...ordered.filter((split) => completed.has(split.id.toLowerCase()) || completed.has(split.name.toLowerCase())).map((split) => split.order));
  return ordered.find((split) => split.order > lastAcceptedOrder);
}

function cutoffFor(participant: LiveParticipant, hub: LiveTrackingHubConfig, nowMs: number, finished: boolean, status: string) {
  if (status === "DNF") return { label: "DNF", deadline: null, remainingSeconds: null, status: "DNF" as const };
  if (finished) return { label: "Finished", deadline: null, remainingSeconds: null, status: "NO CUTOFF" as const };
  const nextSplit = nextConfiguredSplit(participant, hub);
  const currentStage = stageOf(participant.currentLeg) || stageOf(participant.raceStatus);
  const currentLeg = hub.legs.find((leg) => stageOf(leg.type) === currentStage);
  const seconds = nextSplit?.cutoffSeconds ?? currentLeg?.cutoffSeconds ?? hub.start.overallCutoffSeconds;
  const gunStartMs = Date.parse(hub.start.gunStartAt || "");
  if (!seconds || !Number.isFinite(gunStartMs)) return { label: nextSplit?.name || currentLeg?.name || "No configured cutoff", deadline: null, remainingSeconds: null, status: "NO CUTOFF" as const };
  const deadlineMs = gunStartMs + seconds * 1_000;
  const remainingSeconds = Math.floor((deadlineMs - nowMs) / 1_000);
  const cutoffStatus: VolunteerCutoffStatus = remainingSeconds < 0 ? "OUT OF CUTOFF" : remainingSeconds <= 15 * 60 ? "DANGER" : remainingSeconds <= 30 * 60 ? "WATCH" : "SAFE";
  return { label: nextSplit?.name || currentLeg?.name || "Overall cutoff", deadline: new Date(deadlineMs).toISOString(), remainingSeconds, status: cutoffStatus };
}

function timingAthlete(participant: LiveParticipant, hub: LiveTrackingHubConfig, nowMs: number): VolunteerTimingAthlete {
  const status = statusOf(participant.raceStatus);
  const finished = status === "FINISHED";
  const started = finished
    || participant.splits.some((split) => Boolean(
      split.readerTimestamp
      || split.timestamp
      || split.officialTimeMs !== undefined
      || split.chipTimeMs !== undefined
      || split.gunTimeMs !== undefined
      || split.cumulativeTime,
    ))
    || (!TERMINAL_NON_FINISH.has(status) && status !== "NOT_STARTED" && status !== "UNKNOWN");
  const next = nextConfiguredSplit(participant, hub);
  const last = participant.splits.at(-1);
  return {
    id: participant.participantUid,
    bib: participant.bib || "—",
    name: participant.fullName || participant.displayName || "Athlete",
    category: participant.contestName || "—",
    status,
    currentLeg: finished ? "FINISHED" : String(participant.currentLeg || stageOf(participant.raceStatus) || "—"),
    currentSplit: last?.name || participant.latestTimingPoint || "—",
    nextSplit: finished ? "Finished" : next?.name || "—",
    lastTimingAt: splitTime(participant),
    started,
    finished,
    overallSeconds: durationSeconds(participant.elapsedTime || participant.cumulativeTime || last?.cumulativeTime),
    overallRank: Number.isFinite(participant.overallRank) ? participant.overallRank! : null,
    cutoff: cutoffFor(participant, hub, nowMs, finished, status),
  };
}

export function buildVolunteerLiveTimingPayload(participants: LiveParticipant[], hub: LiveTrackingHubConfig, now = new Date()): VolunteerLiveTimingPayload {
  const configuredStages = hub.legs.toSorted((left, right) => left.order - right.order).map((leg) => stageOf(leg.type)).filter((stage): stage is VolunteerCourseStage => Boolean(stage));
  const inferredStages = participants.flatMap((participant) => [stageOf(participant.currentLeg), stageOf(participant.raceStatus), ...participant.splits.map((split) => stageOf(split.name))]).filter((stage): stage is VolunteerCourseStage => Boolean(stage));
  const stageSet = new Set(configuredStages.length ? configuredStages : inferredStages);
  const courseStages = (["SWIM", "T1", "BIKE", "T2", "RUN"] as const).filter((stage) => stageSet.has(stage));
  const athletes = participants.map((participant) => {
    const { participant: resolved, config: scopedHub } = resolveVolunteerTimingState(participant, hub);
    return timingAthlete(resolved, scopedHub, now.getTime());
  });
  const legCounts: Record<VolunteerCourseStage, number> = { SWIM: 0, T1: 0, BIKE: 0, T2: 0, RUN: 0 };
  athletes.forEach((athlete) => {
    if (!athlete.started || athlete.finished || TERMINAL_NON_FINISH.has(athlete.status)) return;
    const stage = stageOf(athlete.currentLeg) || stageOf(athlete.status);
    if (stage) legCounts[stage] += 1;
  });
  const finished = athletes.filter((athlete) => athlete.finished);
  const terminal = athletes.filter((athlete) => TERMINAL_NON_FINISH.has(athlete.status)).length;
  const onCourse = athletes.filter((athlete) => athlete.started && !athlete.finished && !TERMINAL_NON_FINISH.has(athlete.status)).length;
  const notStarted = athletes.filter((athlete) => !athlete.started && !TERMINAL_NON_FINISH.has(athlete.status)).length;
  const finalStage = courseStages.at(-1);
  const approaching = athletes.filter((athlete) => {
    if (!athlete.started || athlete.finished || TERMINAL_NON_FINISH.has(athlete.status)) return false;
    return Boolean((finalStage && stageOf(athlete.currentLeg) === finalStage) || /FINISH/.test(`${athlete.currentSplit} ${athlete.nextSplit}`.toUpperCase()));
  }).sort((left, right) => (right.overallSeconds ?? -1) - (left.overallSeconds ?? -1));
  const recentFinishers = [...finished].sort((left, right) => Date.parse(right.lastTimingAt || "") - Date.parse(left.lastTimingAt || "") || (left.overallRank ?? Number.MAX_SAFE_INTEGER) - (right.overallRank ?? Number.MAX_SAFE_INTEGER));
  return {
    generatedAt: now.toISOString(),
    message: athletes.length ? "Canonical volunteer timing loaded." : "No canonical athlete timing is published for this event.",
    overview: {
      total: athletes.length, notStarted, started: athletes.filter((athlete) => athlete.started).length, onCourse,
      finished: finished.length, remaining: Math.max(0, athletes.length - finished.length - terminal),
      dnf: athletes.filter((athlete) => athlete.status === "DNF").length,
      withinCutoff: athletes.filter((athlete) => athlete.cutoff.status === "SAFE").length,
      approachingCutoff: athletes.filter((athlete) => athlete.cutoff.status === "WATCH" || athlete.cutoff.status === "DANGER").length,
      outOfCutoff: athletes.filter((athlete) => athlete.cutoff.status === "OUT OF CUTOFF").length,
      courseStages, legCounts,
    },
    athletes, approaching, recentFinishers,
  };
}

export async function getVolunteerLiveTiming(profile: VolunteerProfile, eventId: string, mode: "finish" | "cutoff"): Promise<VolunteerLiveTimingPayload> {
  const assignment = activeAssignment(profile, eventId);
  requireModule(assignment, mode === "finish" ? "FINISH_LINE_VOLUNTEER" : "CUTOFF_TIME_VOLUNTEER");
  const [canonical, hub] = await Promise.all([getCanonicalLiveEvent(eventId), getLiveTrackingHubConfig(eventId)]);
  if (!hub) throw new Error("Live timing configuration is unavailable for this event.");
  return buildVolunteerLiveTimingPayload(canonical?.participants || [], hub);
}
