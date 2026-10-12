import { apiFailure, apiSuccess } from "@/lib/api-response";
import { mobileCorsHeaders, mobileCorsPreflight } from "@/lib/mobile-cors";
import { verifyVolunteerPassword } from "@/lib/volunteer-auth";
import { z } from "@/lib/zod";

const inputSchema = z.object({
  email: z.string().trim().email().max(180),
  password: z.string().min(8).max(128),
});

export const dynamic = "force-dynamic";
export const OPTIONS = mobileCorsPreflight;

export async function POST(request: Request) {
  try {
    const input = inputSchema.safeParse(await request.json());
    if (!input.success) return apiFailure(input.error.issues[0]?.message || "Check your email and password.", 400, { headers: mobileCorsHeaders });
    return apiSuccess(await verifyVolunteerPassword(input.data.email, input.data.password), {
      headers: { ...mobileCorsHeaders, "cache-control": "no-store" },
    });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to sign in.", 401, { headers: mobileCorsHeaders });
  }
}
