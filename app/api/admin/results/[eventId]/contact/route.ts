import { getAuthenticatedAdminEmail } from '@/lib/admin-auth';
import { apiFailure, apiSuccess } from '@/lib/api-response';
import { updateFinisherContact } from '@/lib/safe-finisher-notifications';
import { z } from '@/lib/zod';

const inputSchema = z.object({
  category: z.string().trim().min(1).max(120),
  resultId: z.string().trim().min(1).max(160),
  email: z.string().trim().max(254),
  mobile: z.string().trim().max(40),
  reason: z.string().trim().min(5).max(500),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const actor = await getAuthenticatedAdminEmail();
  if (!actor) return apiFailure('Admin authentication required.', 401);
  try {
    const parsed = inputSchema.safeParse(await request.json());
    if (!parsed.success) return apiFailure(parsed.error.issues[0]?.message || 'Check contact details.', 400);
    const { eventId } = await params;
    const contact = await updateFinisherContact({ eventId, actor, ...parsed.data });
    return apiSuccess({ contact }, { headers: { 'cache-control': 'private, no-store' } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : 'Unable to correct recipient contact.', 400);
  }
}
