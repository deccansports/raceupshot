import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bikeCheckWhatsAppParameters, counterTemplateSchema, counterTemplateTestSchema, emptyCounterTemplate, renderCounterEmail, waiverCheckinEmailMappings, waiverCheckinWhatsAppParameters, withAutomaticWaiverStorage } from '../lib/counter-notification-contract';
const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), coordinatorFetch: vi.fn(), roster: vi.fn(), event: vi.fn(), email: vi.fn(), whatsapp: vi.fn() }));
vi.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: async () => ({ env: { RACEUPSHOT: { get: mocks.get, put: mocks.put }, VOLUNTEER_OPERATIONS: { getByName: () => ({ fetch: mocks.coordinatorFetch }) } } }) }));
vi.mock('../lib/participant-chip-assignments', () => ({ getAdminParticipantRoster: mocks.roster }));
vi.mock('../lib/raceupshot-repository', () => ({ getEventBySlug: mocks.event }));
vi.mock('../lib/bergtecno-email', () => ({ sendBergtecnoEmail: mocks.email, textToEmailHtml: (s: string) => s }));
vi.mock('../lib/aisensy-whatsapp', () => ({ sendAiSensyWhatsApp: mocks.whatsapp }));
import { counterConfigKey, dispatchCounterNotifications, legacyCounterConfigKey, readCounterTemplate, savedWaiverUrl, saveCounterTemplate, sendCounterNotificationTest } from '../lib/counter-notifications';

const operation = { id: 'operation-1', eventId: 'event-1', eventName: 'Race', participantUid: 'athlete-1', bib: '001', athleteName: 'Name', volunteerId: 'v1', volunteerName: 'Volunteer', action: 'BIKE_IN', capturedAt: '2026-10-08T10:00:00.000Z', status: 'CONFIRMED' };
function enableCustomEmail(template: ReturnType<typeof emptyCounterTemplate>) { template.email.enabled = true; template.email.mode = 'CUSTOM'; return template; }
describe('counter notifications', () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => {
    vi.clearAllMocks(); mocks.put.mockResolvedValue(undefined);
    mocks.coordinatorFetch.mockImplementation(async () => Response.json({ ok: true, record: null }));
    mocks.event.mockResolvedValue({ name: 'Race', date: '2026-10-08', location: 'Pune' });
    mocks.roster.mockResolvedValue({ rows: [{ participantUid: 'athlete-1', name: 'Runner', email: 'runner@example.com', mobile: '+919999999999' }] });
    mocks.email.mockResolvedValue({ sent: true }); mocks.whatsapp.mockResolvedValue({ accepted: true });
  });
  it('defaults to disabled and sends nothing', async () => {
    mocks.get.mockResolvedValue(null); await dispatchCounterNotifications(operation);
    expect(mocks.email).not.toHaveBeenCalled(); expect(mocks.whatsapp).not.toHaveBeenCalled();
  });
  it('upgrades previously saved counter templates with the new template fields', () => {
    const legacy = emptyCounterTemplate() as unknown as Record<string, unknown>;
    const email = { ...(legacy.email as Record<string, unknown>) }; delete email.mode; delete email.templateId;
    const whatsapp = { ...(legacy.whatsapp as Record<string, unknown>) }; delete whatsapp.campaignName;
    const parsed = counterTemplateSchema.parse({ ...legacy, email, whatsapp });
    expect(parsed.email).toMatchObject({ mode: 'CUSTOM', templateId: '' });
    expect(parsed.whatsapp.campaignName).toBe('');
  });
  it('uses one shared action template across events and falls back to legacy event settings', async () => {
    const shared = emptyCounterTemplate(); shared.email.templateId = 'shared-check-in';
    mocks.get.mockImplementation(async (key: string) => key === counterConfigKey('CHECK_IN') ? shared : null);
    await expect(readCounterTemplate('event-a', 'CHECK_IN')).resolves.toMatchObject({ email: { templateId: 'shared-check-in' } });
    await expect(readCounterTemplate('event-b', 'CHECK_IN')).resolves.toMatchObject({ email: { templateId: 'shared-check-in' } });
    expect(counterConfigKey('CHECK_IN')).not.toContain('event-a');

    const legacy = emptyCounterTemplate(); legacy.whatsapp.templateName = 'legacy_event_template';
    mocks.get.mockImplementation(async (key: string) => key === legacyCounterConfigKey('event-a', 'CHECK_IN') ? legacy : null);
    await expect(readCounterTemplate('event-a', 'CHECK_IN')).resolves.toMatchObject({ whatsapp: { templateName: 'legacy_event_template' } });
  });
  it('defaults bike check-in and checkout to the five AiSensy API template parameters', async () => {
    mocks.get.mockResolvedValue(null);
    await expect(readCounterTemplate('event-a', 'BIKE_IN')).resolves.toMatchObject({ whatsapp: { parameters: bikeCheckWhatsAppParameters } });
    await expect(readCounterTemplate('event-a', 'BIKE_OUT')).resolves.toMatchObject({ whatsapp: { parameters: bikeCheckWhatsAppParameters } });
  });
  it('defaults waiver check-in to Bergtecno template #34 and its six provider variables', async () => {
    mocks.get.mockResolvedValue(null);
    await expect(readCounterTemplate('event-a', 'WAIVER_VERIFY')).resolves.toMatchObject({
      email: {
        templateId: 'd93bdb49-79e5-42bb-b433-cf4285f9adf4',
        mappings: waiverCheckinEmailMappings,
      },
    });
  });
  it('repairs saved template #34 mappings to the provider-owned variable contract', async () => {
    const saved = emptyCounterTemplate('WAIVER_VERIFY');
    saved.email.mappings = [{ token: 'n', variable: 'name' }];
    mocks.coordinatorFetch.mockResolvedValue(Response.json({ ok: true, record: { template: saved } }));
    await expect(readCounterTemplate('event-a', 'WAIVER_VERIFY')).resolves.toMatchObject({
      email: { mappings: waiverCheckinEmailMappings },
    });
  });
  it('repairs all-name parameters for the known AiSensy waivercheckin campaign', async () => {
    const saved = emptyCounterTemplate('WAIVER_VERIFY');
    saved.whatsapp.campaignName = 'waivercheckin';
    saved.whatsapp.parameters = ['name', 'name', 'name', 'name', 'name'];
    mocks.coordinatorFetch.mockResolvedValue(Response.json({ ok: true, record: { template: saved } }));
    await expect(readCounterTemplate('event-a', 'WAIVER_VERIFY')).resolves.toMatchObject({
      whatsapp: { parameters: waiverCheckinWhatsAppParameters },
    });
  });
  it('repairs stale bike campaign parameters to the approved four-value order', async () => {
    const saved = emptyCounterTemplate('BIKE_IN');
    saved.whatsapp.campaignName = 'bikecheckin1';
    saved.whatsapp.parameters = ['name', 'event_name', 'action_date', 'action_time', 'event_name'];
    mocks.coordinatorFetch.mockResolvedValue(Response.json({ ok: true, record: { template: saved } }));
    await expect(readCounterTemplate('event-a', 'BIKE_IN')).resolves.toMatchObject({
      email: { enabled: false },
      whatsapp: { campaignName: 'bikecheckin1', parameters: bikeCheckWhatsAppParameters },
    });
  });
  it('keeps the AiSensy bike API campaign names and enables an untouched bike email channel', async () => {
    const checkin = emptyCounterTemplate('BIKE_IN');
    checkin.whatsapp = { ...checkin.whatsapp, enabled: true, campaignName: 'bikecheckin1', templateName: 'bikecheckin1' };
    mocks.coordinatorFetch.mockResolvedValueOnce(Response.json({ ok: true, record: { template: checkin } }));
    await expect(readCounterTemplate('event-a', 'BIKE_IN')).resolves.toMatchObject({
      email: { enabled: true, configured: false, mode: 'CUSTOM' },
      whatsapp: { campaignName: 'bikecheckin1', templateName: 'bikecheckin1' },
    });

    const checkout = emptyCounterTemplate('BIKE_OUT');
    checkout.whatsapp = { ...checkout.whatsapp, enabled: true, campaignName: 'bikecheckout1', templateName: 'bikecheckout1' };
    mocks.coordinatorFetch.mockResolvedValueOnce(Response.json({ ok: true, record: { template: checkout } }));
    await expect(readCounterTemplate('event-a', 'BIKE_OUT')).resolves.toMatchObject({
      email: { enabled: true, configured: false, mode: 'CUSTOM' },
      whatsapp: { campaignName: 'bikecheckout1', templateName: 'bikecheckout1' },
    });
  });
  it('respects an explicitly disabled bike email channel', async () => {
    const saved = emptyCounterTemplate('BIKE_OUT');
    saved.email.configured = true;
    saved.whatsapp = { ...saved.whatsapp, enabled: true, campaignName: 'bikecheckout1', templateName: 'bikecheckout1' };
    mocks.coordinatorFetch.mockResolvedValue(Response.json({ ok: true, record: { template: saved } }));
    await expect(readCounterTemplate('event-a', 'BIKE_OUT')).resolves.toMatchObject({ email: { enabled: false, configured: true } });
  });
  it('dispatches both channels from the previously saved production bike configuration', async () => {
    const saved = emptyCounterTemplate('BIKE_OUT');
    saved.whatsapp = { ...saved.whatsapp, enabled: true, campaignName: 'bikecheckout1', templateName: 'bikecheckout1' };
    mocks.coordinatorFetch.mockResolvedValue(Response.json({ ok: true, record: { template: saved } }));
    await dispatchCounterNotifications({ ...operation, action: 'BIKE_OUT' });
    expect(mocks.email).toHaveBeenCalledWith(expect.objectContaining({
      recipientEmail: 'runner@example.com',
      subject: 'Race · Bike checkout',
      singleAttempt: true,
    }));
    expect(mocks.whatsapp).toHaveBeenCalledWith(expect.objectContaining({
      campaignName: 'bikecheckout1',
      parameters: ['Runner', 'Race', '8 Oct 2026', '03:30 pm', 'Race'],
    }));
  });
  it('persists the Bergtecno #34 template ID in strongly consistent shared storage and reads it after refresh', async () => {
    const stored = new Map<string, { template: unknown; updatedAt: string; updatedBy: string }>();
    mocks.coordinatorFetch.mockImplementation(async (input: string, init?: RequestInit) => {
      const action = new URL(input).searchParams.get('action')!;
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { template: unknown; updatedAt: string; updatedBy: string };
        const record = body;
        stored.set(action, record);
        return Response.json({ ok: true, record });
      }
      return Response.json({ ok: true, record: stored.get(action) ?? null });
    });
    const template = emptyCounterTemplate();
    template.email.templateId = '#34';
    await saveCounterTemplate('WAIVER_VERIFY', template, 'admin@example.com');
    mocks.get.mockResolvedValue(null); // Simulates an edge KV read returning its stale cached miss.
    await expect(readCounterTemplate('event-1', 'WAIVER_VERIFY')).resolves.toMatchObject({ email: { templateId: '#34' } });
  });
  it('renders named email parameters without expanding braces in athlete values', () => {
    expect(renderCounterEmail('Hi {{person}}', [{ token: 'person', variable: 'name' }], { name: '{{bib}}' })).toBe('Hi {{bib}}');
    expect(() => renderCounterEmail('{{person}}', [{ token: 'person', variable: 'name' }], {})).toThrow('Missing value');
  });
  it('rejects unmapped tokens and duplicate mapping names', () => {
    const t = emptyCounterTemplate(); t.email.mode = 'CUSTOM'; t.email.body = '{{unknown}}'; expect(counterTemplateSchema.safeParse(t).success).toBe(false);
    t.email.body = 'Hello'; t.email.mappings.push(t.email.mappings[0]); expect(counterTemplateSchema.safeParse(t).success).toBe(false);
  });
  it('requires an attachment origin only when an attachment channel is enabled', () => {
    const t = emptyCounterTemplate(); t.email.attachWaiver = true;
    expect(counterTemplateSchema.safeParse(t).success).toBe(true);
    t.email.enabled = true; t.email.templateId = 'saved-template';
    expect(counterTemplateSchema.safeParse(t).success).toBe(false);
    expect(counterTemplateTestSchema.safeParse(t).success).toBe(true);
  });
  it('automatically selects the canonical waiver field and secure request origin', () => {
    const t = emptyCounterTemplate();
    t.email.enabled = true; t.email.templateId = 'saved-template'; t.email.attachWaiver = true;
    t.waiver = { urlField: 'waiverPdfUrl', allowedOrigin: 'https://untrusted.example.com' };
    const automatic = withAutomaticWaiverStorage(t, 'https://raceupshot.com/api/admin/volunteers/notifications');
    expect(counterTemplateSchema.parse(automatic).waiver).toEqual({
      urlField: 'waiverDocumentUrl',
      allowedOrigin: 'https://raceupshot.com',
    });
  });
  it('maps WhatsApp parameters in numeric order and records provider acceptance', async () => {
    const t = enableCustomEmail(emptyCounterTemplate()); t.whatsapp = { ...t.whatsapp, enabled: true, templateName: 'bike_entry', parameters: ['bib', 'name'] };
    mocks.get.mockResolvedValue(t); await dispatchCounterNotifications(operation);
    expect(mocks.whatsapp).toHaveBeenCalledWith(expect.objectContaining({ parameters: ['001', 'Runner'] }));
    expect(mocks.email).toHaveBeenCalledWith(expect.objectContaining({ recipientEmail: 'runner@example.com', singleAttempt: true }));
    expect(mocks.put.mock.calls.some(([, body]) => JSON.parse(body).status === 'PROVIDER_ACCEPTED')).toBe(true);
  });
  it('formats bike action date and time in the event timezone', async () => {
    const t = emptyCounterTemplate('BIKE_IN');
    t.whatsapp = { ...t.whatsapp, enabled: true, campaignName: 'bikecheckin1' };
    mocks.get.mockResolvedValue(t); await dispatchCounterNotifications(operation);
    expect(mocks.whatsapp).toHaveBeenCalledWith(expect.objectContaining({
      parameters: ['Runner', 'Race', '8 Oct 2026', '03:30 pm', 'Race'],
    }));
  });
  it('never falls back to a different participant with the same BIB', async () => {
    const t = enableCustomEmail(emptyCounterTemplate()); mocks.get.mockResolvedValue(t);
    mocks.roster.mockResolvedValue({ rows: [{ participantUid: 'other', bib: '001', email: 'other@example.com' }] });
    await dispatchCounterNotifications(operation); expect(mocks.email).not.toHaveBeenCalled();
    expect(JSON.parse(mocks.put.mock.calls.at(-1)![1]).status).toBe('FAILED_OR_UNCONFIRMED');
  });
  it('fails attachment sends when a signed PDF is missing', async () => {
    const t = enableCustomEmail(emptyCounterTemplate()); t.email.attachWaiver = true; t.waiver.allowedOrigin = 'https://files.example.com'; mocks.get.mockResolvedValue(t);
    await dispatchCounterNotifications(operation); expect(mocks.email).not.toHaveBeenCalled();
    expect(JSON.parse(mocks.put.mock.calls.at(-1)![1]).error).toContain('no saved signed-waiver');
  });
  it('rejects document URLs outside the trusted origin', () => {
    expect(() => savedWaiverUrl({ waiverPdfUrl: 'https://other.example.com/a.pdf' }, 'waiverPdfUrl', 'https://files.example.com')).toThrow();
    expect(savedWaiverUrl({ waiverPdfUrl: 'https://files.example.com/a.pdf' }, 'waiverPdfUrl', 'https://files.example.com')).toBe('https://files.example.com/a.pdf');
  });
  it('does not retry an ambiguous provider failure', async () => {
    const t = enableCustomEmail(emptyCounterTemplate()); mocks.get.mockResolvedValue(t); mocks.email.mockResolvedValue({ sent: false, error: 'Request timed out' });
    await dispatchCounterNotifications(operation); expect(mocks.email).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mocks.put.mock.calls.at(-1)![1]).status).toBe('FAILED_OR_UNCONFIRMED');
  });
  it('attaches saved PDF bytes to email and its URL to the WhatsApp document header', async () => {
    const t = emptyCounterTemplate();
    enableCustomEmail(t); t.email.attachWaiver = true;
    t.whatsapp = { ...t.whatsapp, enabled: true, templateName: 'waiver_signed', attachWaiver: true };
    t.waiver.allowedOrigin = 'https://files.example.com';
    mocks.get.mockResolvedValue(t);
    mocks.roster.mockResolvedValue({ rows: [{ participantUid: 'athlete-1', name: 'Runner', email: 'runner@example.com', mobile: '+919999999999', [t.waiver.urlField]: 'https://files.example.com/signed.pdf' }] });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('%PDF-1.7\nsaved signed document')));
    await dispatchCounterNotifications(operation);
    expect(mocks.email).toHaveBeenCalledWith(expect.objectContaining({ attachments: [{ filename: 'signed-waiver.pdf', contentType: 'application/pdf', data: Buffer.from('%PDF-1.7\nsaved signed document').toString('base64') }] }));
    expect(mocks.whatsapp).toHaveBeenCalledWith(expect.objectContaining({ document: { link: 'https://files.example.com/signed.pdf', filename: 'signed-waiver.pdf' } }));
  });
  it('sends the other channel when email fails', async () => {
    const t = enableCustomEmail(emptyCounterTemplate());
    t.whatsapp = { ...t.whatsapp, enabled: true, templateName: 'bike_entry' };
    mocks.get.mockResolvedValue(t); mocks.email.mockRejectedValue(new Error('Unavailable'));
    await dispatchCounterNotifications(operation);
    expect(mocks.whatsapp).toHaveBeenCalledTimes(1);
    const logs = mocks.put.mock.calls.map(([, body]) => JSON.parse(body));
    expect(logs).toContainEqual(expect.objectContaining({ channel: 'email', status: 'FAILED_OR_UNCONFIRMED' }));
    expect(logs).toContainEqual(expect.objectContaining({ channel: 'whatsapp', status: 'PROVIDER_ACCEPTED' }));
  });
  it('sends saved email templates with named provider variables', async () => {
    const t = emptyCounterTemplate(); t.email.enabled = true; t.email.templateId = 'counter-template-id';
    mocks.get.mockResolvedValue(t); await dispatchCounterNotifications(operation);
    expect(mocks.email).toHaveBeenCalledWith(expect.objectContaining({
      recipientEmail: 'runner@example.com', templateId: 'counter-template-id',
      variables: { name: 'Runner', event_name: 'Race', counter: 'Bike check-in', bib: '001' },
      singleAttempt: true,
    }));
  });
  it('tests email and WhatsApp templates without a counter operation', async () => {
    const t = emptyCounterTemplate(); t.email.templateId = 'counter-template-id'; t.whatsapp.templateName = 'bike_entry'; t.whatsapp.campaignName = 'Ozar bike counter';
    const event = { name: 'Race', date: '2026-10-08', location: 'Pune' };
    await expect(sendCounterNotificationTest({ channel: 'EMAIL', recipient: 'admin@example.com', template: t, event, action: 'BIKE_IN' })).resolves.toMatchObject({ status: 'PROVIDER_ACCEPTED' });
    await expect(sendCounterNotificationTest({ channel: 'WHATSAPP', recipient: '+919999999999', template: t, event, action: 'BIKE_IN' })).resolves.toMatchObject({ campaignName: 'Ozar bike counter', status: 'PROVIDER_ACCEPTED' });
    expect(mocks.email).toHaveBeenCalledWith(expect.objectContaining({ recipientEmail: 'admin@example.com', templateId: 'counter-template-id' }));
    expect(mocks.whatsapp).toHaveBeenCalledWith(expect.objectContaining({ recipientPhone: '+919999999999', campaignName: 'Ozar bike counter', userName: 'Test Athlete' }));
  });
  it('sends all six template #34 email variables using their exact provider names', async () => {
    const t = emptyCounterTemplate('WAIVER_VERIFY');
    const event = { name: 'Bergman Race', date: '2026-10-10', location: 'Pune' };
    await sendCounterNotificationTest({ channel: 'EMAIL', recipient: 'admin@example.com', template: t, event, action: 'WAIVER_VERIFY' });
    expect(mocks.email).toHaveBeenCalledWith(expect.objectContaining({
      templateId: 'd93bdb49-79e5-42bb-b433-cf4285f9adf4',
      variables: {
        name: 'Test Athlete',
        eventname: 'Bergman Race',
        ticket: 'Test Category',
        eventdate: '2026-10-10',
        bib: 'TEST-001',
        checkintime: expect.any(String),
      },
    }));
  });
  it('includes sample media and the corrected values when testing the waivercheckin campaign', async () => {
    const t = emptyCounterTemplate();
    t.whatsapp.campaignName = 'waivercheckin';
    t.whatsapp.attachWaiver = true;
    t.whatsapp.parameters = ['name', 'name', 'name', 'name', 'name'];
    await sendCounterNotificationTest({ channel: 'WHATSAPP', recipient: '918390288857', template: t, event: { name: 'Race' }, action: 'WAIVER_VERIFY' });
    expect(mocks.whatsapp).toHaveBeenCalledWith({
      recipientPhone: '918390288857',
      userName: 'Test Athlete',
      campaignName: 'waivercheckin',
      parameters: ['Test Athlete', 'Race', 'Test Category', 'TEST-001', expect.any(String)],
      document: {
        link: 'https://d3jt6ku4g6z5l8.cloudfront.net/FILE/6353da2e153a147b991dd812/4079142_dummy.pdf',
        filename: 'sample_media',
      },
    });
  });
});
