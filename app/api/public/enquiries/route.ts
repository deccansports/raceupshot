import { apiFailure, apiSuccess } from "@/lib/api-response";
import { contactEnquiryInput, createEnquiry } from "@/lib/enquiries";
import { TurnstileVerificationError, verifyContactTurnstile } from "@/lib/turnstile";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    await verifyContactTurnstile(String(body["cf-turnstile-response"] || ""), request);
    const input = contactEnquiryInput.safeParse(body);
    if (!input.success) return apiFailure(input.error.issues[0]?.message || "Check the enquiry details.", 400);
    const enquiry = await createEnquiry(input.data);
    return apiSuccess({ id: enquiry.id, received: true }, {
      status: 201,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    if (error instanceof TurnstileVerificationError) return apiFailure(error.message, error.status);
    return apiFailure(error instanceof Error ? error.message : "Unable to store enquiry.", 503);
  }
}
