import type { BroadcastAthleteOverlayEntry } from "@/packages/contracts/src";
import { getLiveBroadcastConfig } from "./live-broadcast";
import { getPublicLiveParticipants } from "./platform-repository";

export interface BroadcastAthleteOverlayFeed {
  enabled: boolean;
  message: string;
  displaySeconds: number;
  timingPointName: string;
  athletes: BroadcastAthleteOverlayEntry[];
  updatedAt: string | null;
}

function normalized(value: string | undefined): string {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function timestamp(value: string | undefined | null): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

export async function getBroadcastAthleteOverlayFeed(eventIdOrSlug: string): Promise<BroadcastAthleteOverlayFeed | null> {
  const [broadcast, participants] = await Promise.all([
    getLiveBroadcastConfig(eventIdOrSlug),
    getPublicLiveParticipants(eventIdOrSlug),
  ]);
  if (!broadcast || !participants) return null;
  const overlay = broadcast.athleteOverlay;
  if (!broadcast.enabled || !broadcast.publicEnabled || !overlay.enabled) {
    return {
      enabled: false,
      message: overlay.message,
      displaySeconds: overlay.displaySeconds,
      timingPointName: overlay.timingPointName,
      athletes: [],
      updatedAt: participants.lastUpdatedAt,
    };
  }

  const targetId = normalized(overlay.timingPointId);
  const targetName = normalized(overlay.timingPointName);
  const now = Date.now();
  const recentThreshold = now - overlay.recentWindowSeconds * 1000;
  const finishTrigger = /\bfinish\b/.test(`${targetId} ${targetName}`);
  const athletes = participants.data.flatMap((participant): BroadcastAthleteOverlayEntry[] => {
    const matchingSplit = [...participant.splits].reverse().find((split) => {
      const splitId = normalized(split.splitId);
      const splitName = normalized(split.name);
      return Boolean(
        (targetId && splitId === targetId)
        || (targetName && splitName === targetName)
        || (targetName && normalized(participant.latestTimingPoint) === targetName),
      );
    });
    if (!matchingSplit) return [];
    const readAt = timestamp(matchingSplit.timestamp)
      || timestamp(participant.lastUpdatedAt)
      || timestamp(participants.lastUpdatedAt);
    const readTime = readAt ? Date.parse(readAt) : Number.NaN;
    if (Number.isFinite(readTime) && readTime < recentThreshold) return [];
    return [{
      participantUid: participant.participantUid,
      bib: participant.bib,
      displayName: participant.displayName,
      contestName: participant.contestName,
      timingPointId: matchingSplit.splitId,
      timingPointName: matchingSplit.name,
      readAt,
      state: finishTrigger || participant.raceStatus === "FINISHED" ? "FINISHING_NOW" : "FINISHING_SOON",
    }];
  });

  athletes.sort((a, b) => Date.parse(b.readAt || "") - Date.parse(a.readAt || ""));
  return {
    enabled: true,
    message: overlay.message,
    displaySeconds: overlay.displaySeconds,
    timingPointName: overlay.timingPointName,
    athletes: athletes.slice(0, overlay.maxAthletes),
    updatedAt: participants.lastUpdatedAt,
  };
}
