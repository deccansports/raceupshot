import { getAuthenticatedAdminEmail } from '@/lib/admin-auth';
import { apiFailure, apiSuccess } from '@/lib/api-response';
import { counterActions, counterTemplateSchema, counterTemplateTestSchema, withAutomaticWaiverStorage } from '@/lib/counter-notification-contract';
import { listCounterDeliveries, readCounterTemplate, saveCounterTemplate, sendCounterNotificationTest } from '@/lib/counter-notifications';
import { getEventBySlug } from '@/lib/raceupshot-repository';

export const dynamic = 'force-dynamic';
async function scope(request: Request) {
  const params = new URL(request.url).searchParams;
  const eventId = params.get('eventId') || ''; const action = params.get('action') || '';
  if (!Object.hasOwn(counterActions, action)) throw new Error('Choose a supported counter action.');
  const event = await getEventBySlug(eventId, { includeUnpublished: true });
  if (!event) throw new Error('Event not found.');
  return { eventId: event.id, action: action as keyof typeof counterActions, event };
}
export async function GET(request: Request) {
  if (!await getAuthenticatedAdminEmail()) return apiFailure('Admin authentication required.', 401);
  try {
    const { eventId, action } = await scope(request);
    const [template, deliveries] = await Promise.all([readCounterTemplate(eventId, action), listCounterDeliveries(eventId)]);
    return apiSuccess({ template, deliveries }, { headers: { 'cache-control': 'private, no-store' } });
  } catch (error) { return apiFailure(error instanceof Error ? error.message : 'Unable to load notifications.', 400); }
}
export async function PUT(request: Request) {
  const actor = await getAuthenticatedAdminEmail();
  if (!actor) return apiFailure('Admin authentication required.', 401);
  try {
    const { action } = await scope(request);
    const parsed = counterTemplateSchema.safeParse(withAutomaticWaiverStorage(
      await request.json(),
      new URL(request.url).origin,
    ));
    if (!parsed.success) return apiFailure(parsed.error.issues[0]?.message || 'Check the notification template settings.', 400);
    const template = parsed.data;
    const saved = await saveCounterTemplate(action, template, actor);
    return apiSuccess({ template: saved, scope: 'ALL_EVENTS' }, { headers: { 'cache-control': 'private, no-store' } });
  } catch (error) { return apiFailure(error instanceof Error ? error.message : 'Unable to save notifications.', 400); }
}

export async function POST(request: Request) {
  if (!await getAuthenticatedAdminEmail()) return apiFailure('Admin authentication required.', 401);
  try {
    const { action, event } = await scope(request);
    const body = await request.json() as { channel?: unknown; recipient?: unknown; template?: unknown };
    const channel = body.channel === 'EMAIL' || body.channel === 'WHATSAPP' ? body.channel : null;
    const recipient = typeof body.recipient === 'string' ? body.recipient.trim() : '';
    if (!channel || !recipient) throw new Error('Choose Email or WhatsApp and enter a test recipient.');
    if (channel === 'EMAIL' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) throw new Error('Enter a valid test email address.');
    // Email tests exclude waiver attachments. WhatsApp document-header tests
    // use a fixed public sample PDF, so no participant origin is required.
    const template = counterTemplateTestSchema.parse(body.template);
    if (channel === 'EMAIL' && template.email.mode === 'PROVIDER_TEMPLATE' && !template.email.templateId.trim()) throw new Error('Enter the saved email template name or ID before testing.');
    if (channel === 'EMAIL' && template.email.mode === 'CUSTOM' && (!template.email.subject.trim() || !template.email.body.trim())) throw new Error('Enter the custom email subject and message before testing.');
    if (channel === 'WHATSAPP' && !template.whatsapp.campaignName.trim()) throw new Error('Enter the live AiSensy API campaign name before testing.');
    const result = await sendCounterNotificationTest({ channel, recipient, template, event, action });
    return apiSuccess(result, { headers: { 'cache-control': 'private, no-store' } });
  } catch (error) { return apiFailure(error instanceof Error ? error.message : 'Unable to send the test notification.', 400); }
}
