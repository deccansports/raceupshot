import { getAuthenticatedAdminEmail, isAdminAuthenticated } from "@/lib/admin-auth";
import {
  getAthleteTimingAudit,
  listEventTimingAudits,
  processAndStoreTimingBatch,
} from "@/lib/feibot-timing-processing";
import { platformFailure, platformSuccess } from "@/lib/platform-api-response";
import { z } from "@/lib/zod";

export const dynamic = "force-dynamic";

const rawReadSchema = z.object({
  readId: z.string().min(1).max(250),
  eventUuid: z.string().min(1).max(150),
  contestUuid: z.string().min(1).max(150),
  participantUuid: z.string().min(1).max(150),
  bib: z.string().max(50),
  chipCode: z.string().min(1).max(150),
  timingPointUuid: z.string().min(1).max(150),
  passage: z.number().int().min(1).max(100).nullable().optional(),
  readerUuid: z.string().min(1).max(150),
  antennaId: z.string().max(100).nullable(),
  rssi: z.number().finite().nullable(),
  readerTimestamp: z.string().datetime({ offset: true }),
  receivedAt: z.string().datetime({ offset: true }).nullable(),
  source: z.enum(["UDP", "CLOUD", "FIXED", "MANUAL"]),
});

const timingPointSchema = z.object({
  timingPointKey: z.string().min(1).max(150),
  timingPointUuid: z.string().min(1).max(150),
  name: z.string().min(1).max(200),
  type: z.enum(["START", "SPLIT", "FINISH"]),
  order: z.number().int().min(1),
  readerUuids: z.array(z.string().min(1).max(150)).min(1),
});

const configurationSchema = z.object({
  eventUuid: z.string().min(1).max(150),
  contestUuid: z.string().min(1).max(150),
  timingResultSource: z.enum(["FEIBOT_PROCESSED", "RACE_UPSHOT_ENGINE"]),
  resultTimeMode: z.enum(["CHIP", "GUN"]),
  gunStartTimestamp: z.string().datetime({ offset: true }),
  startWindowOpenTimestamp: z.string().datetime({ offset: true }),
  startWindowCloseTimestamp: z.string().datetime({ offset: true }).nullable(),
  eventEndTimestamp: z.string().datetime({ offset: true }).nullable(),
  passageGapMs: z.number().int().min(1_000).max(60_000),
  readerDetectionTimeoutMs: z.record(z.string(), z.number().int().min(1_000).max(300_000)),
  sequence: z.array(timingPointSchema).min(2).max(250),
}).superRefine((configuration, context) => {
  const ordered = [...configuration.sequence].sort((left, right) => left.order - right.order);
  if (ordered[0]?.type !== "START") context.addIssue({ code: "custom", path: ["sequence", 0], message: "The first course timing point must be START." });
  if (ordered.at(-1)?.type !== "FINISH") context.addIssue({ code: "custom", path: ["sequence"], message: "The last course timing point must be FINISH." });
  if (ordered.filter((point) => point.type === "FINISH").length !== 1) {
    context.addIssue({ code: "custom", path: ["sequence"], message: "Exactly one Race Finish is required, and it must be the final configured timing point." });
  }
  if (new Set(ordered.map((point) => point.timingPointKey)).size !== ordered.length) {
    context.addIssue({ code: "custom", path: ["sequence"], message: "Every course sequence entry needs a unique timingPointKey." });
  }
});

const manualOverrideSchema = z.object({
  overrideId: z.string().min(1).max(150),
  participantUuid: z.string().min(1).max(150),
  timingPointKey: z.string().min(1).max(150),
  readerTimestamp: z.string().datetime({ offset: true }),
  source: z.enum(["FIXED", "MANUAL"]),
  authorized: z.literal(true),
  authorizedBy: z.string().max(150).optional(),
  reason: z.string().min(3).max(500),
  appliedAt: z.string().datetime({ offset: true }),
});

const processedResultSchema = z.object({
  timingPointKey: z.string().max(150).optional(),
  timingPointUuid: z.string().min(1).max(150),
  timingPointName: z.string().min(1).max(200),
  readerTimestamp: z.string().datetime({ offset: true }),
  gunTimeMs: z.number().int().min(0).nullable(),
  chipTimeMs: z.number().int().min(0).nullable(),
  sectionTimeMs: z.number().int().min(0).nullable(),
});

const batchSchema = z.object({
  configuration: configurationSchema,
  rawReads: z.array(rawReadSchema).max(20_000),
  manualOverrides: z.array(manualOverrideSchema).max(250).optional(),
  feibotProcessedResults: z.array(processedResultSchema).max(250).optional(),
});

export async function GET(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  if (!await isAdminAuthenticated()) return platformFailure("ADMIN_AUTH_REQUIRED", "Admin authentication required.", 401);
  try {
    const { eventId } = await params;
    const url = new URL(request.url);
    const eventUuid = url.searchParams.get("eventUuid")?.trim() || "";
    const contestUuid = url.searchParams.get("contestUuid")?.trim() || "";
    const participantUuid = url.searchParams.get("participantUuid")?.trim() || "";
    if (!eventUuid) return platformFailure("EVENT_UUID_REQUIRED", "eventUuid is required.", 400);
    if (contestUuid && participantUuid) {
      const audit = await getAthleteTimingAudit(eventUuid, contestUuid, participantUuid);
      return audit
        ? platformSuccess(audit, { eventId, cacheSeconds: 0 }, { headers: { "cache-control": "no-store" } })
        : platformFailure("TIMING_AUDIT_NOT_FOUND", "No timing audit exists for this athlete.", 404);
    }
    const audits = await listEventTimingAudits(eventUuid);
    return platformSuccess(audits, { eventId, cacheSeconds: 0 }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return platformFailure("TIMING_AUDIT_UNAVAILABLE", error instanceof Error ? error.message : "Unable to load timing audit.", 503);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const authenticatedAdminEmail = await getAuthenticatedAdminEmail();
  if (!authenticatedAdminEmail) return platformFailure("ADMIN_AUTH_REQUIRED", "Admin authentication required.", 401);
  try {
    const { eventId } = await params;
    const parsed = batchSchema.safeParse(await request.json());
    if (!parsed.success) return platformFailure("INVALID_TIMING_BATCH", parsed.error.issues[0]?.message ?? "Invalid timing batch.", 400);
    const audits = await processAndStoreTimingBatch({
      eventId,
      ...parsed.data,
      manualOverrides: parsed.data.manualOverrides?.map((override) => ({
        ...override,
        authorizedBy: authenticatedAdminEmail,
      })),
    });
    return platformSuccess(audits, { eventId, cacheSeconds: 0 }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return platformFailure("TIMING_PROCESSING_FAILED", error instanceof Error ? error.message : "Unable to process timing reads.", 400);
  }
}
