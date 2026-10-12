import { requireAdmin } from "@/lib/admin-guard";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import { getFinisherNotificationSummaries, getFinisherNotificationSummary, sendFinisherNotificationBatch } from "@/lib/result-emails";
import { z } from "@/lib/zod";

const notifyInput = z.object({
  action: z.enum(["preview", "send"]),
  category: z.string().trim().max(120).default("Overall"),
  retryFailed: z.boolean().optional().default(false),
  forceResend: z.boolean().optional().default(false),
  channels: z.array(z.enum(["EMAIL", "WHATSAPP"])).min(1).max(2).optional(),
  categories: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  resultId: z.string().trim().min(1).max(160).optional(),
  confirmed: z.boolean().optional().default(false),
  dryRunToken: z.string().optional(),
});

async function dryRunToken(summary: { eventId: string; finishers?: Array<{ resultId?: string; eligibilityReason?: string; emailStatus: string; whatsappStatus: string }> }, category: string, channels: string[], resultId?: string, forceResend?: boolean, retryFailed?: boolean): Promise<{ token: string; count: number }> {
  const rows = (summary.finishers ?? []).filter((row) => !row.eligibilityReason && (!resultId || row.resultId === resultId));
  const eligible = rows.flatMap((row) => channels.filter((channel) => {
    const state = channel === "EMAIL" ? row.emailStatus : row.whatsappStatus;
    return !["INELIGIBLE", "MISSING_CONTACT", "UNCONFIRMED"].includes(state) && (resultId || state !== "REVIEW_REQUIRED") && (forceResend || state === "PENDING" || state === "REVIEW_REQUIRED" || (retryFailed && state === "FAILED"));
  }).map((channel) => `${row.resultId}:${channel}`)).sort();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([summary.eventId, category, channels.sort(), eligible, Boolean(forceResend), Boolean(retryFailed)])));
  return { token: Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join(""), count: eligible.length };
}

export async function POST(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const input = notifyInput.safeParse(await request.json());
    if (!input.success) return apiFailure(input.error.issues[0]?.message || "Check notification options.", 400);
    const { eventId } = await params;
    if (input.data.categories?.length) {
      if (input.data.action !== "preview") return apiFailure("Multi-contest tracing is preview-only.", 400);
      const summaries = await getFinisherNotificationSummaries(eventId, input.data.categories, input.data.channels);
      return apiSuccess({ summaries }, { headers: { "cache-control": "no-store" } });
    }
    if (!input.data.channels?.length) return apiFailure("Select email, WhatsApp, or both explicitly.", 400);
    const preview = await getFinisherNotificationSummary(eventId, input.data.category, input.data.channels);
    if (input.data.resultId && !preview.finishers?.some((row) => row.resultId === input.data.resultId)) return apiFailure("Exact result ID was not found in this contest.", 404);
    const dryRun = await dryRunToken(preview, input.data.category, input.data.channels, input.data.resultId, input.data.forceResend, input.data.retryFailed);
    if (input.data.action === "preview") return apiSuccess({ ...preview, dryRun }, { headers: { "cache-control": "no-store" } });
    if (!input.data.confirmed || input.data.dryRunToken !== dryRun.token) return apiFailure("Refresh the dry run and confirm its exact recipient count before sending.", 409);
    const summary = await sendFinisherNotificationBatch(eventId, input.data.category, input.data.channels, input.data.retryFailed, { resultId: input.data.resultId, trigger: "manual", forceResend: input.data.forceResend, confirmed: true });
    return apiSuccess({ ...summary, dryRun }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to process finisher notifications.", 503);
  }
}
