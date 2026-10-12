import { requireAdmin } from "@/lib/admin-guard";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import { replyToEnquiry } from "@/lib/enquiries";
import { z } from "@/lib/zod";

const replyInput = z.object({
  subject: z.string().trim().min(3).max(180),
  message: z.string().trim().min(3).max(10_000),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const input = replyInput.safeParse(await request.json());
    if (!input.success) return apiFailure(input.error.issues[0]?.message || "Check the reply.", 400);
    const { id } = await params;
    const enquiry = await replyToEnquiry(id, input.data.subject, input.data.message);
    const latest = enquiry.replies.at(-1);
    return apiSuccess(enquiry, {
      status: latest?.status === "FAILED" ? 202 : 200,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to reply.", 503);
  }
}
