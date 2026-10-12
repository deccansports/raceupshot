import { apiFailure, apiSuccess } from "@/lib/api-response";
import { authenticateAdmin, createAdminSession } from "@/lib/admin-auth";
import { z } from "@/lib/zod";

const credentials = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const input = credentials.safeParse(await request.json());
    if (!input.success) return apiFailure("Enter a valid email and password.", 400);
    if (!await authenticateAdmin(input.data.email, input.data.password)) {
      return apiFailure("Invalid email or password.", 401);
    }
    await createAdminSession(input.data.email);
    return apiSuccess({ authenticated: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Sign-in failed", 500);
  }
}
