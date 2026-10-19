import { requireVolunteer } from '@/lib/volunteer-auth';
import { activeAssignment, searchVolunteerParticipants } from '@/lib/volunteer-operations';
import { getVolunteerById } from '@/lib/volunteer-management';
import { apiSuccess, apiFailure } from '@/lib/api-response';
import { mobileCorsHeaders, mobileCorsPreflight } from '@/lib/mobile-cors';
import { cateringRequest } from '@/lib/catering-repository';
import { cateringBandIdentifier, type CateringRecipient, type CateringSnapshot, type CateringVolunteerGroup } from '@/lib/catering';
import { z } from '@/lib/zod';
export const dynamic = 'force-dynamic';
export const OPTIONS = mobileCorsPreflight;
const headers = { ...mobileCorsHeaders, 'cache-control': 'no-store' };
const inputSchema = z.object({ requestId: z.string().trim().min(16).max(100), eventId: z.string().trim().min(1).max(160), serviceId: z.string().trim().min(1).max(100), audience: z.enum(['ATHLETE', 'VOLUNTEER']), identifier: z.string().trim().min(1).max(250), recipientId: z.string().trim().min(1).max(250) });
function failure(error: unknown) { const message = error instanceof Error ? error.message : 'Catering request failed.'; return apiFailure(message, message.includes('AUTH_REQUIRED') ? 401 : /not assigned|disabled/i.test(message) ? 403 : 400, { headers }); }
async function authorize(request: Request, eventId: string) {
  const { profile } = await requireVolunteer(request);
  const assignment = activeAssignment(profile, eventId);
  if (!assignment.modules.includes('FOOD_COUNTER')) throw new Error('Catering / Food is not assigned to this volunteer.');
  return profile;
}
async function recipients(profile: Awaited<ReturnType<typeof authorize>>, eventId: string, audience: string, identifier: string): Promise<CateringRecipient[]> {
  if (audience === 'VOLUNTEER') {
    identifier = cateringBandIdentifier(identifier);
    const { id, group } = await cateringRequest<{ id: string | null; group: CateringVolunteerGroup | null }>(eventId, '/catering/band', { code: identifier });
    if (group) return [{ id: `group-band:${identifier}`, name: group.name, identifier, audience: 'VOLUNTEER', category: group.type === 'ADMIN_TAG' ? 'Admin tag' : 'Volunteer group', groupId: group.id, groupType: group.type }];
    const volunteer = id ? await getVolunteerById(id) : null;
    if (!volunteer || volunteer.status === 'DISABLED' || !volunteer.assignments.some(row => row.eventId === eventId && row.active)) return [];
    return [{ id: volunteer.id, name: volunteer.name, identifier, audience: 'VOLUNTEER', category: 'Volunteer' }];
  }
  const result = await searchVolunteerParticipants({ profile, eventId, query: identifier });
  return result.participants.map(row => ({ id: row.id, name: row.name, identifier: row.bib, audience: 'ATHLETE', category: row.category }));
}
export async function GET(request: Request) {
  try {
    const url = new URL(request.url), eventId = url.searchParams.get('eventId') || '';
    const profile = await authorize(request, eventId);
    const snapshot = await cateringRequest<CateringSnapshot>(eventId, '/catering');
    const query = (url.searchParams.get('query') || '').trim();
    return apiSuccess({ ...snapshot, recipients: query ? await recipients(profile, eventId, url.searchParams.get('audience') || 'ATHLETE', query) : [] }, { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const body = inputSchema.parse(await request.json());
    const profile = await authorize(request, body.eventId);
    // Resolve again on the server; never trust submitted recipient names/categories.
    const target = (await recipients(profile, body.eventId, body.audience, body.identifier)).find(row => row.id === body.recipientId);
    if (!target) throw new Error('Recipient no longer matches this event and identifier.');
    return apiSuccess(await cateringRequest(body.eventId, '/catering/issue', { requestId: body.requestId, serviceId: body.serviceId, recipient: target, operatorId: profile.id, operatorName: profile.name }), { headers });
  } catch (error) { return failure(error); }
}
