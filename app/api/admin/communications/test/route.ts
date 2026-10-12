import { requireAdmin } from "@/lib/admin-guard";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import { sendBergtecnoEmail } from "@/lib/bergtecno-email";
import { renderCommunicationEmail } from "@/lib/communications";
import { getEventBySlug } from "@/lib/raceupshot-repository";
import { z } from "@/lib/zod";

const testCommunicationInput = z.object({
  recipientEmail: z.string().trim().email(),
  subject: z.string().trim().min(3).max(180),
  message: z.string().trim().min(3).max(500_000),
  contentType: z.enum(["TEXT", "HTML"]).default("TEXT"),
  eventId: z.string().trim().max(160).optional(),
  variables: z.record(z.string().max(80), z.string().max(10_000)).default({}),
});

export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const input = testCommunicationInput.safeParse(await request.json());
    if (!input.success) {
      const issue = input.error.issues[0];
      const field = String(issue?.path[0] || "");
      const fieldMessage = {
        recipientEmail: "Enter a valid test recipient email address.",
        subject: "Enter an email subject of at least 3 characters.",
        message: "Enter an email message of at least 3 characters.",
        contentType: "Choose either styled text or HTML email.",
      }[field];
      return apiFailure(fieldMessage || issue?.message || "Check the test email details.", 400);
    }
    const event = input.data.eventId
      ? await getEventBySlug(input.data.eventId, { includeUnpublished: true })
      : null;
    const delivery = await sendBergtecnoEmail({
      recipientEmail: input.data.recipientEmail,
      subject: `[TEST] ${input.data.subject}`,
      html: renderCommunicationEmail(input.data.message, input.data.contentType, "Test recipient", {
        ...(event ? {
        event_id: event.id,
        event_name: event.name,
        event_date: event.date,
        event_location: event.location,
        event_type: event.sport,
        } : {}),
        ...input.data.variables,
      }),
    });
    if (!delivery.sent) return apiFailure(delivery.error || "The test email could not be sent.", 502);
    return apiSuccess({
      sent: true,
      recipientEmail: input.data.recipientEmail,
      providerStatus: delivery.status || null,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to send the test email.", 503);
  }
}
