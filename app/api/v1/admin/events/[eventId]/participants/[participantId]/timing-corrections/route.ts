import { getAuthenticatedAdminEmail } from '@/lib/admin-auth';
import { apiFailure, apiSuccess } from '@/lib/api-response';
import { reviewTimingCorrections, saveTimingCorrection } from '@/lib/timing-corrections';
import { z } from '@/lib/zod';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ eventId: string; participantId: string }> };
const schema = z.object({
  action: z.enum(['EDIT', 'DELETE', 'RESTORE']), splitId: z.string().min(1).max(150),
  readerTimestamp: z.string().datetime({ offset: true }).optional(),
  reason: z.string().trim().min(3).max(500), providerReceivedAt: z.string().datetime(),
});
export async function GET(_request: Request, context: Context) {
  if (!await getAuthenticatedAdminEmail()) return apiFailure('Admin authentication required.', 401);
  try {
    const { eventId, participantId } = await context.params;
    return apiSuccess(await reviewTimingCorrections(eventId, participantId), { headers: { 'cache-control': 'private, no-store' } });
  } catch (error) { return apiFailure(error instanceof Error ? error.message : 'Unable to review timing.', 400); }
}
export async function POST(request: Request, context: Context) {
  const actor = await getAuthenticatedAdminEmail();
  if (!actor) return apiFailure('Admin authentication required.', 401);
  try {
    const { eventId, participantId } = await context.params;
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return apiFailure(parsed.error.issues[0]?.message || 'Invalid correction.', 400);
    return apiSuccess(await saveTimingCorrection(eventId, participantId, actor, parsed.data), { headers: { 'cache-control': 'private, no-store' } });
  } catch (error) { return apiFailure(error instanceof Error ? error.message : 'Unable to save correction.', 400); }
}
