import { z } from "./zod";

const nullableDate = z.string().datetime({ offset: true }).nullable();

export const liveTrackingHubConfigSchema = z.object({
  contestMappings: z.array(z.object({ contestId: z.string().trim().min(1).max(160), providerContestUuid: z.string().trim().min(1).max(160) })).max(200),
  start: z.object({
    gunStartAt: nullableDate, startWindowOpenAt: nullableDate, startWindowCloseAt: nullableDate, eventEndAt: nullableDate, overallCutoffSeconds: z.number().int().min(0).max(604800).nullable().optional().default(null),
    timingMode: z.enum(["GUN", "WAVE", "CHIP"]).optional().default("CHIP"), rankingMethod: z.enum(["CHIP", "GUN"]).optional().default("CHIP"),
    deduplicationSeconds: z.number().int().min(1).max(60).optional().default(5), validStartWindowMinutes: z.number().int().min(1).max(1440).optional().default(30), dnsGraceMinutes: z.number().int().min(0).max(1440).optional().default(60),
    passageGroupingGapSeconds: z.number().int().min(1).max(60).optional().default(3), reorderBufferMs: z.number().int().min(0).max(60_000).optional().default(2_000), minimumFinishGapSeconds: z.number().int().min(0).max(86_400).optional().default(300),
    ignoreReadsBeforeStart: z.boolean().optional().default(true), lockFirstAcceptedStart: z.boolean().optional().default(true), storeEveryStartHit: z.boolean().optional().default(true), requireMandatorySplits: z.boolean().optional().default(true), readerTimestampAuthoritative: z.boolean().optional().default(true), strictFinalCutoff: z.boolean().optional().default(false), cutoffReconciliationSeconds: z.number().int().min(0).max(86400).optional().default(1800), useFirstReadOfPassage: z.boolean().optional().default(true),
  }),
  legs: z.array(z.object({ id: z.string().min(1).max(160), name: z.string().trim().min(1).max(160), type: z.enum(["SWIM", "BIKE", "RUN", "TRANSITION", "OTHER"]), order: z.number().int().min(0).max(500), distanceKm: z.number().min(0).max(10000).nullable(), cutoffSeconds: z.number().int().min(0).max(604800).nullable().optional().default(null) })).max(100),
  splits: z.array(z.object({ id: z.string().min(1).max(160), name: z.string().trim().min(1).max(160), legId: z.string().min(1).max(160), order: z.number().int().min(0).max(1000), distanceKm: z.number().min(0).max(10000).nullable(), timingPointId: z.string().max(160).nullable(), passage: z.number().int().min(1).max(100), cutoffSeconds: z.number().int().min(0).max(604800).nullable(), providerContestUuid: z.string().trim().max(160).nullable().optional(), isFinalRaceSplit: z.boolean().optional(), importedName: z.string().max(160).nullable().optional().default(null), visible: z.boolean().optional().default(true) })).max(500),
  timingPoints: z.array(z.object({ id: z.string().min(1).max(160), name: z.string().trim().min(1).max(160), type: z.enum(["START", "SPLIT", "FINISH"]), order: z.number().int().min(0).max(1000), readerUuids: z.array(z.string().trim().min(1).max(160)).max(100), course: z.enum(["SWIM", "BIKE", "RUN", "SPLIT", "TRANSITION", "FINISH"]).optional().default("SPLIT"), km: z.number().min(0).max(10000).nullable().optional().default(null), visible: z.boolean().optional().default(true) })).max(500),
  notifications: z.object({
    enabled: z.boolean(),
    finishersEnabled: z.boolean(),
    registrationEnabled: z.boolean().optional().default(false),
    registrationEmailTemplateId: z.string().trim().max(160).optional().default(""),
    registrationWhatsAppCampaignName: z.string().trim().max(160).optional().default(""),
    campaignName: z.string().trim().min(1).max(160).optional().default("Finisher results"),
    emailEnabled: z.boolean().optional().default(false),
    emailTemplateId: z.string().trim().max(160).optional().default(""),
    emailTriathlonTemplateId: z.string().trim().max(160).optional().default(""),
    emailSingleSportTemplateId: z.string().trim().max(160).optional().default(""),
    whatsappEnabled: z.boolean().optional().default(false),
    whatsappTemplateName: z.string().trim().max(160).optional().default(""),
    whatsappCampaignName: z.string().trim().max(160).optional().default(""),
    whatsappTriathlonCampaignName: z.string().trim().max(160).optional().default(""),
    whatsappSingleSportCampaignName: z.string().trim().max(160).optional().default(""),
    templateName: z.string().trim().min(1).max(160),
  }),
}).superRefine((value, context) => {
  const unique = (values: string[], path: Array<string | number>, label: string) => {
    const duplicate = values.find((item, index) => values.indexOf(item) !== index);
    if (duplicate) context.addIssue({ code: "custom", path, message: `${label} must be unique: ${duplicate}` });
  };
  unique(value.contestMappings.map((item) => item.contestId), ["contestMappings"], "Race Upshot contest mappings");
  unique(value.legs.map((item) => item.id), ["legs"], "Leg IDs");
  unique(value.splits.map((item) => item.id), ["splits"], "Split IDs");
  unique(value.timingPoints.map((item) => item.id), ["timingPoints"], "Timing-point IDs");
  unique(value.timingPoints.flatMap((item) => item.readerUuids), ["timingPoints"], "Reader UUID assignments");

  const legIds = new Set(value.legs.map((item) => item.id));
  const timingPointIds = new Set(value.timingPoints.map((item) => item.id));
  value.splits.forEach((split, index) => {
    if (!legIds.has(split.legId)) context.addIssue({ code: "custom", path: ["splits", index, "legId"], message: "Split must reference a leg in this event." });
    if (split.timingPointId && !timingPointIds.has(split.timingPointId)) context.addIssue({ code: "custom", path: ["splits", index, "timingPointId"], message: "Split must reference a timing point in this event." });
  });

  const splitScopes = new Map<string, Array<{ split: typeof value.splits[number]; index: number }>>();
  value.splits.forEach((split, index) => {
    const scope = split.providerContestUuid?.trim() || "__event__";
    splitScopes.set(scope, [...(splitScopes.get(scope) ?? []), { split, index }]);
  });
  for (const rows of splitScopes.values()) {
    const ordered = [...rows].sort((left, right) => left.split.order - right.split.order);
    const explicitFinals = ordered.filter(({ split }) => split.isFinalRaceSplit === true);
    if (explicitFinals.length > 1) context.addIssue({ code: "custom", path: ["splits"], message: "Each race category must have exactly one final logical split." });
    if (explicitFinals.length === 1 && explicitFinals[0]?.split.id !== ordered.at(-1)?.split.id) {
      context.addIssue({ code: "custom", path: ["splits", explicitFinals[0]!.index, "isFinalRaceSplit"], message: "The final race split must be the last logical split in its category sequence." });
    }
    const passageKeys = new Set<string>();
    for (const { split, index } of ordered) {
      if (!split.timingPointId) continue;
      const key = `${split.timingPointId}:${split.passage}`;
      if (passageKeys.has(key)) context.addIssue({ code: "custom", path: ["splits", index, "passage"], message: "A physical timing point and passage number may map to only one logical split per category." });
      passageKeys.add(key);
    }
  }

  // Feibot may use one physical timing point for both START and FINISH. Split
  // mappings and passage numbers define that lifecycle, so point metadata must
  // not require two separate physical devices.

  const { gunStartAt, startWindowOpenAt, startWindowCloseAt, eventEndAt } = value.start;
  const timestamp = (date: string | null) => date ? new Date(date).getTime() : null;
  const open = timestamp(startWindowOpenAt);
  const gun = timestamp(gunStartAt);
  const close = timestamp(startWindowCloseAt);
  const end = timestamp(eventEndAt);
  if (open !== null && gun !== null && open > gun) context.addIssue({ code: "custom", path: ["start", "startWindowOpenAt"], message: "Start window must open before the gun start." });
  if (gun !== null && close !== null && gun > close) context.addIssue({ code: "custom", path: ["start", "startWindowCloseAt"], message: "Start window must close after the gun start." });
  if (close !== null && end !== null && close > end) context.addIssue({ code: "custom", path: ["start", "eventEndAt"], message: "Event end must be after the start window closes." });
  if (value.notifications.enabled && value.notifications.finishersEnabled && value.notifications.emailEnabled && !value.notifications.emailTemplateId && (!value.notifications.emailTriathlonTemplateId || !value.notifications.emailSingleSportTemplateId)) context.addIssue({ code: "custom", path: ["notifications", "emailTemplateId"], message: "Configure a fallback Bergtecno email template or both triathlon and single-sport templates." });
  if (value.notifications.enabled && value.notifications.registrationEnabled && value.notifications.emailEnabled && !value.notifications.registrationEmailTemplateId) context.addIssue({ code: "custom", path: ["notifications", "registrationEmailTemplateId"], message: "Configure the registration email template before enabling registration confirmations." });
  if (value.notifications.enabled && value.notifications.registrationEnabled && value.notifications.whatsappEnabled && !value.notifications.registrationWhatsAppCampaignName) context.addIssue({ code: "custom", path: ["notifications", "registrationWhatsAppCampaignName"], message: "Configure the registration WhatsApp campaign before enabling registration confirmations." });
});
