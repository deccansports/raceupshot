import { requireAdmin } from '@/lib/admin-guard';
import { apiFailure, apiSuccess } from '@/lib/api-response';
import { cateringRequest } from '@/lib/catering-repository';
import { cateringServiceSchema, cateringVolunteerGroupSchema } from '@/lib/catering';
import { z } from '@/lib/zod';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const denied = await requireAdmin(); if (denied) return denied;
  try { return apiSuccess(await cateringRequest(new URL(request.url).searchParams.get('eventId') || '', '/catering'), { headers: { 'cache-control': 'private, no-store' } }); }
  catch (error) { return apiFailure(error instanceof Error ? error.message : 'Cannot load catering.', 400); }
}
export async function POST(request: Request) {
  const denied = await requireAdmin(); if (denied) return denied;
  try {
    const payload = await request.json();
    const base = z.object({ eventId: z.string().trim().min(1).max(160), action: z.enum(['SERVICE', 'VOLUNTEER_DATE', 'VOLUNTEER_GROUP', 'DELETE_VOLUNTEER_GROUP', 'RESET_ISSUE']).default('SERVICE') }).parse(payload);
    let result: unknown;
    if (base.action === 'SERVICE') {
      const body = z.object({ service: cateringServiceSchema }).parse(payload);
      result = await cateringRequest(base.eventId, '/catering/service', body.service);
    } else if (base.action === 'VOLUNTEER_DATE') {
      const body = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), remove: z.boolean().default(false) }).parse(payload);
      result = await cateringRequest(base.eventId, '/catering/volunteer-date', body);
    } else if (base.action === 'VOLUNTEER_GROUP') {
      const body = z.object({ group: cateringVolunteerGroupSchema }).parse(payload);
      result = await cateringRequest(base.eventId, '/catering/volunteer-group', body.group);
    } else if (base.action === 'DELETE_VOLUNTEER_GROUP') {
      const body = z.object({ id: z.string().trim().min(1).max(100) }).parse(payload);
      result = await cateringRequest(base.eventId, '/catering/volunteer-group/delete', body);
    } else {
      const body = z.object({ issueId: z.string().trim().min(1).max(100) }).parse(payload);
      result = await cateringRequest(base.eventId, '/catering/reset', { ...body, resetBy: 'Administrator' });
    }
    return apiSuccess(result, { headers: { 'cache-control': 'no-store' } });
  } catch (error) { return apiFailure(error instanceof Error ? error.message : 'Cannot save catering.', 400); }
}
