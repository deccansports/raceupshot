import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { KVNamespace } from "@cloudflare/workers-types";
import { getEventBySlug } from "./raceupshot-repository";
import { getEventPlatformSettings, saveEventPlatformSettings } from "./platform-repository";
import { withTransientKvRetry } from "./kv-retry";
import { normalizeRaceFlowPassages } from "./race-flow-editor";

const PREFIX = "raceupshot";

export type HubContestMapping = { contestId: string; providerContestUuid: string };
export type HubTimingPoint = {
  id: string;
  name: string;
  type: "START" | "SPLIT" | "FINISH";
  order: number;
  readerUuids: string[];
  course?: "SWIM" | "BIKE" | "RUN" | "SPLIT" | "TRANSITION" | "FINISH";
  km?: number | null;
  visible?: boolean;
};
export type HubLeg = {
  id: string;
  name: string;
  type: "SWIM" | "BIKE" | "RUN" | "TRANSITION" | "OTHER";
  order: number;
  distanceKm: number | null;
  cutoffSeconds?: number | null;
};
export type HubSplit = {
  id: string;
  name: string;
  legId: string;
  order: number;
  distanceKm: number | null;
  timingPointId: string | null;
  passage: number;
  cutoffSeconds: number | null;
  /** Provider contest owning this logical split. Null keeps legacy event-wide flows readable. */
  providerContestUuid?: string | null;
  /** The one logical split that completes this contest. Never inferred from the physical mat name. */
  isFinalRaceSplit?: boolean;
  importedName?: string | null;
  /** Public presentation only. Hidden reads remain stored and auditable. */
  visible?: boolean;
  /** Independent course/safety requirement. Legacy configs remain mandatory. */
  requiredForProgression?: boolean;
};

/**
 * Upgrade legacy race flows to one explicit logical finish per contest scope.
 * The configured sequence is the fallback authority; physical timing-point
 * labels and types are deliberately ignored because one mat may be reused.
 */
export function normalizeFinalRaceSplits(splits: HubSplit[]): HubSplit[] {
  const scopes = new Map<string, HubSplit[]>();
  for (const split of splits) {
    const scope = split.providerContestUuid?.trim() || "__event__";
    scopes.set(scope, [...(scopes.get(scope) ?? []), split]);
  }
  const finalIds = new Set<string>();
  for (const [scope, rows] of scopes) {
    const ordered = [...rows].sort((left, right) => left.order - right.order);
    const explicit = ordered.filter((split) => split.isFinalRaceSplit === true);
    if (explicit.length > 1) {
      throw new Error(`Race flow ${scope} has multiple final race splits. Select exactly one final logical checkpoint.`);
    }
    if (explicit.length === 1 && explicit[0]?.id !== ordered.at(-1)?.id) {
      throw new Error(`Race flow ${scope} must use its last configured logical checkpoint as the final race split.`);
    }
    const final = explicit[0] ?? ordered.at(-1);
    if (final) finalIds.add(final.id);
  }
  return splits.map((split) => ({
    ...split,
    isFinalRaceSplit: finalIds.has(split.id),
  }));
}
export type LiveTrackingHubConfig = {
  eventId: string;
  contestMappings: HubContestMapping[];
  start: {
    gunStartAt: string | null;
    startWindowOpenAt: string | null;
    startWindowCloseAt: string | null;
    eventEndAt: string | null;
    /** Maximum elapsed race time from the official start, independent of split cutoffs. */
    overallCutoffSeconds: number | null;
    timingMode: "GUN" | "WAVE" | "CHIP";
    rankingMethod: "CHIP" | "GUN";
    deduplicationSeconds: number;
    validStartWindowMinutes: number;
    dnsGraceMinutes: number;
    passageGroupingGapSeconds: number;
    reorderBufferMs: number;
    minimumFinishGapSeconds: number;
    ignoreReadsBeforeStart: boolean;
    lockFirstAcceptedStart: boolean;
    storeEveryStartHit: boolean;
    requireMandatorySplits: boolean;
    readerTimestampAuthoritative: boolean;
    strictFinalCutoff: boolean;
    /** Time allowed for valid, late-arriving physical reader observations. */
    cutoffReconciliationSeconds: number;
    useFirstReadOfPassage: boolean;
  };
  legs: HubLeg[];
  splits: HubSplit[];
  timingPoints: HubTimingPoint[];
  notifications: {
    enabled: boolean;
    finishersEnabled: boolean;
    registrationEnabled?: boolean;
    registrationEmailTemplateId?: string;
    registrationWhatsAppCampaignName?: string;
    campaignName: string;
    emailEnabled: boolean;
    emailTemplateId: string;
    emailTriathlonTemplateId?: string;
    emailSingleSportTemplateId?: string;
    whatsappEnabled: boolean;
    whatsappTemplateName: string;
    whatsappCampaignName?: string;
    whatsappTriathlonCampaignName?: string;
    whatsappSingleSportCampaignName?: string;
    /** Retained for saved configurations created before channel-specific templates. */
    templateName: string;
  };
  updatedAt: string | null;
};

async function getKv(): Promise<KVNamespace> {
  const { env } = await getCloudflareContext({ async: true });
  if (!env.RACEUPSHOT) throw new Error("RACEUPSHOT KV binding is unavailable.");
  return withTransientKvRetry(env.RACEUPSHOT);
}

function key(eventId: string) {
  return `${PREFIX}:live:event:${eventId}:hub-config`;
}

export function defaultLiveTrackingHubConfig(eventId: string): LiveTrackingHubConfig {
  return {
    eventId,
    contestMappings: [],
    start: {
      gunStartAt: null,
      startWindowOpenAt: null,
      startWindowCloseAt: null,
      eventEndAt: null,
      overallCutoffSeconds: null,
      timingMode: "CHIP",
      rankingMethod: "CHIP",
      deduplicationSeconds: 5,
      validStartWindowMinutes: 30,
      dnsGraceMinutes: 60,
      passageGroupingGapSeconds: 3,
      reorderBufferMs: 2_000,
      minimumFinishGapSeconds: 300,
      ignoreReadsBeforeStart: true,
      lockFirstAcceptedStart: true,
      storeEveryStartHit: true,
      requireMandatorySplits: true,
      readerTimestampAuthoritative: true,
      strictFinalCutoff: false,
      cutoffReconciliationSeconds: 1_800,
      useFirstReadOfPassage: true,
    },
    legs: [],
    splits: [],
    timingPoints: [],
    notifications: {
      enabled: false,
      finishersEnabled: false,
      registrationEnabled: false,
      registrationEmailTemplateId: "",
      registrationWhatsAppCampaignName: "",
      campaignName: "Finisher results",
      emailEnabled: false,
      emailTemplateId: "",
      whatsappEnabled: false,
      whatsappTemplateName: "",
      whatsappCampaignName: "",
      templateName: "Official result",
    },
    updatedAt: null,
  };
}

export async function getLiveTrackingHubConfig(eventIdOrSlug: string): Promise<LiveTrackingHubConfig | null> {
  const event = await getEventBySlug(eventIdOrSlug, { includeUnpublished: true });
  if (!event) return null;
  const stored = await (await getKv()).get<LiveTrackingHubConfig>(key(event.id), "json");
  if (!stored) return defaultLiveTrackingHubConfig(event.id);
  const defaults = defaultLiveTrackingHubConfig(event.id);
  return {
    ...defaults,
    ...stored,
    eventId: event.id,
    start: { ...defaults.start, ...stored.start },
    notifications: { ...defaults.notifications, ...stored.notifications },
    legs: (stored.legs ?? []).map((leg) => ({ ...leg, cutoffSeconds: leg.cutoffSeconds ?? null })),
    splits: normalizeFinalRaceSplits(normalizeRaceFlowPassages((stored.splits ?? []).map((split) => ({
      ...split,
      providerContestUuid: split.providerContestUuid ?? null,
      importedName: split.importedName ?? null,
      visible: split.visible ?? true,
      // Before this flag existed every configured checkpoint participated in
      // course validation. Preserve that behaviour when upgrading old data;
      // public visibility must never silently change the timing requirement.
      requiredForProgression: split.requiredForProgression ?? true,
    })))),
    timingPoints: (stored.timingPoints ?? []).map((point) => ({
      ...point,
      course: point.course ?? (point.type === "FINISH" ? "FINISH" : point.type === "SPLIT" ? "SPLIT" : "RUN"),
      km: point.km ?? null,
      visible: point.visible ?? true,
    })),
  };
}

/**
 * Public, presentation-only timing configuration for web and mobile clients.
 * Provider credentials, reader UUIDs, notification templates, and operational
 * controls intentionally never leave the Worker.
 */
export async function getPublicLiveTimingConfiguration(eventIdOrSlug: string) {
  const config = await getLiveTrackingHubConfig(eventIdOrSlug);
  if (!config) return null;

  const splits = config.splits
    .filter((split) => split.visible !== false)
    .toSorted((left, right) => left.order - right.order)
    .map((split) => ({ ...split }));
  const referencedLegIds = new Set(splits.map((split) => split.legId));
  const legs = config.legs
    .filter((leg) => referencedLegIds.size === 0 || referencedLegIds.has(leg.id))
    .toSorted((left, right) => left.order - right.order)
    .map((leg) => ({ ...leg }));
  const timingPoints = config.timingPoints
    .filter((point) => point.visible !== false)
    .toSorted((left, right) => left.order - right.order)
    .map((point) => {
      const { readerUuids, ...publicPoint } = point;
      void readerUuids;
      return publicPoint;
    });
  const contestScopes = [...new Set(config.contestMappings.flatMap((mapping) => [
    mapping.contestId,
    mapping.providerContestUuid,
  ]).filter(Boolean))];
  const legsByContest = Object.fromEntries(contestScopes.map((contestId) => [contestId, legs]));
  const contestProviderById = new Map(config.contestMappings.map((mapping) => [mapping.contestId, mapping.providerContestUuid]));
  const splitsByContest = Object.fromEntries(contestScopes.map((contestId) => {
    const providerContestUuid = contestProviderById.get(contestId) ?? contestId;
    return [contestId, splits.filter((split) => !split.providerContestUuid || split.providerContestUuid === providerContestUuid)];
  }));
  const timingPointsByContest = Object.fromEntries(contestScopes.map((contestId) => [contestId, timingPoints]));
  const raceFlowByContest = Object.fromEntries(contestScopes.map((contestId) => [contestId, { legs, splits: splitsByContest[contestId] ?? [] }]));

  return {
    updatedAt: config.updatedAt,
    contestMappings: config.contestMappings,
    start: {
      gunStartAt: config.start.gunStartAt,
      startWindowOpenAt: config.start.startWindowOpenAt,
      startWindowCloseAt: config.start.startWindowCloseAt,
      eventEndAt: config.start.eventEndAt,
      overallCutoffSeconds: config.start.overallCutoffSeconds,
      timingMode: config.start.timingMode,
      rankingMethod: config.start.rankingMethod,
    },
    legs,
    splits,
    timingPoints,
    legsByContest,
    splitsByContest,
    timingPointsByContest,
    raceFlowByContest,
  };
}

export async function saveLiveTrackingHubConfig(eventIdOrSlug: string, config: Omit<LiveTrackingHubConfig, "eventId" | "updatedAt">): Promise<LiveTrackingHubConfig> {
  const event = await getEventBySlug(eventIdOrSlug, { includeUnpublished: true });
  if (!event) throw new Error("Event not found.");
  const saved: LiveTrackingHubConfig = { ...config, splits: normalizeFinalRaceSplits(normalizeRaceFlowPassages(config.splits)), eventId: event.id, updatedAt: new Date().toISOString() };
  const kv = await getKv();
  const platform = await getEventPlatformSettings(event.id);
  await Promise.all([
    kv.put(key(event.id), JSON.stringify(saved)),
    platform ? saveEventPlatformSettings(event.id, {
      live: {
        ...platform.live,
        liveTrackingStartAt: saved.start.startWindowOpenAt ?? saved.start.gunStartAt,
        liveTrackingEndAt: saved.start.eventEndAt,
      },
      mobile: platform.mobile,
      timingIntegration: platform.timingIntegration ? {
        ...platform.timingIntegration,
        contestMappings: saved.contestMappings,
        updatedAt: saved.updatedAt!,
      } : null,
    }) : Promise.resolve(null),
  ]);
  return saved;
}
