import { z } from './zod';
import { BERGTECNO_TEMPLATES, resolveBergtecnoTemplateId } from './email-templates';

export const counterActions = {
  WAIVER_VERIFY: 'Waiver verification & check-in', CHECK_IN: 'Athlete check-in',
  CHECK_IN_REVERSE: 'Reverse check-in', ADMIN_WAIVER_CHECK_IN_RESET: 'Admin waiver/check-in reset', BIKE_IN: 'Bike check-in', BIKE_OUT: 'Bike checkout',
  MEDAL_ISSUE: 'Finisher goodies', FOOD_ISSUE: 'Food counter', LOCKER_ASSIGN: 'Locker assignment',
  TIMING_CHIP_ASSIGNED: 'Timing chip assignment', ATHLETE_BAND_ASSIGNED: 'Athlete band assignment',
  MANUAL_TIMING_CAPTURED: 'Timekeeper stamp',
} as const;
export const counterVariables = ['name', 'email', 'mobile', 'bib', 'category', 'event_name', 'event_date', 'event_location', 'volunteer_name', 'counter', 'action_at', 'action_date', 'action_time', 'bike_rack', 'locker_number', 'athlete_band', 'chip', 'timing_point', 'gun_time', 'waiver_url'] as const;
const mapping = z.object({ token: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/), variable: z.enum(counterVariables) });
const counterTemplateBaseSchema = z.object({
  schemaVersion: z.literal(1),
  email: z.object({ enabled: z.boolean(), mode: z.enum(['PROVIDER_TEMPLATE', 'CUSTOM']).default('CUSTOM'), templateId: z.string().max(200).default(''), subject: z.string().max(500), body: z.string().max(30000), mappings: z.array(mapping).max(40), attachWaiver: z.boolean() }),
  whatsapp: z.object({ enabled: z.boolean(), campaignName: z.string().max(160).default(''), templateName: z.string().max(150), language: z.string().max(30), parameters: z.array(z.enum(counterVariables)).max(30), attachWaiver: z.boolean() }),
  waiver: z.object({ urlField: z.enum(['waiverDocumentUrl', 'signedWaiverUrl', 'waiverPdfUrl', 'waiver_url']), allowedOrigin: z.string().max(250) }),
});

function validateTemplate(value: z.infer<typeof counterTemplateBaseSchema>, ctx: z.RefinementCtx, requireAttachmentOrigin: boolean) {
  if (value.email.enabled && value.email.mode === 'PROVIDER_TEMPLATE' && !value.email.templateId.trim()) ctx.addIssue({ code: 'custom', message: 'Enter the saved email template name or ID.' });
  if (value.email.enabled && value.email.mode === 'CUSTOM' && (!value.email.subject.trim() || !value.email.body.trim())) ctx.addIssue({ code: 'custom', message: 'Custom email requires a subject and message.' });
  const keys = value.email.mappings.map((m) => m.token);
  if (new Set(keys).size !== keys.length) ctx.addIssue({ code: 'custom', message: 'Email parameter names must be unique.' });
  for (const token of [...(value.email.mode === 'CUSTOM' ? value.email.subject + value.email.body : '').matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map((m) => m[1])) {
    if (!keys.includes(token)) ctx.addIssue({ code: 'custom', message: `Map email parameter {{${token}}}.` });
  }
  // Legacy templates may lack an AiSensy campaign. Validate at send time so
  // they remain editable and cannot block the independent email channel.
  const attachesWaiver = (value.email.enabled && value.email.attachWaiver)
    || (value.whatsapp.enabled && value.whatsapp.attachWaiver);
  if (requireAttachmentOrigin && attachesWaiver) {
    try { const u = new URL(value.waiver.allowedOrigin); if (u.protocol !== 'https:' || u.origin !== value.waiver.allowedOrigin || u.username || u.password || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(u.hostname) || /(^|\.)(localhost|local|internal|test|invalid)$/.test(u.hostname)) throw Error(); }
    catch { ctx.addIssue({ code: 'custom', path: ['waiver', 'allowedOrigin'], message: 'Set the trusted HTTPS origin hosting the saved signed-waiver PDFs, for example https://files.example.com.' }); }
  }
}

export const counterTemplateSchema = counterTemplateBaseSchema.superRefine((value, ctx) => validateTemplate(value, ctx, true));
/** Test sends never fetch or attach a waiver, so attachment-origin validation is intentionally skipped. */
export const counterTemplateTestSchema = counterTemplateBaseSchema.superRefine((value, ctx) => validateTemplate(value, ctx, false));
export type CounterTemplate = z.infer<typeof counterTemplateSchema>;
export type CounterVariable = typeof counterVariables[number];

export const waiverCheckinEmailMappings: CounterTemplate['email']['mappings'] = [
  { token: 'name', variable: 'name' },
  { token: 'eventname', variable: 'event_name' },
  { token: 'ticket', variable: 'category' },
  { token: 'eventdate', variable: 'event_date' },
  { token: 'bib', variable: 'bib' },
  { token: 'checkintime', variable: 'action_time' },
];

/** Keep the provider-owned variable contract fixed for known saved templates. */
export function withKnownEmailTemplateMappings(action: string, template: CounterTemplate): CounterTemplate {
  if (action !== 'WAIVER_VERIFY'
    || resolveBergtecnoTemplateId(template.email.templateId) !== BERGTECNO_TEMPLATES.waiverCheckin.uuid) return template;
  return {
    ...template,
    email: {
      ...template.email,
      mappings: waiverCheckinEmailMappings.map((mapping) => ({ ...mapping })),
    },
  };
}

/**
 * Waiver document storage is application-managed. Admin clients choose whether
 * a channel includes the generated PDF, but never choose roster field names or
 * trusted origins.
 */
export function withAutomaticWaiverStorage(input: unknown, requestOrigin: string): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  return {
    ...input,
    waiver: {
      urlField: 'waiverDocumentUrl',
      allowedOrigin: new URL(requestOrigin).origin,
    },
  };
}

export function emptyCounterTemplate(action?: keyof typeof counterActions): CounterTemplate {
  const whatsappParameters: CounterVariable[] = action === 'BIKE_IN' || action === 'BIKE_OUT'
    ? ['name', 'action_date', 'action_time', 'event_name']
    : ['name', 'event_name', 'bib'];
  const waiverEmail = action === 'WAIVER_VERIFY';
  const emailMappings: CounterTemplate['email']['mappings'] = waiverEmail
    ? waiverCheckinEmailMappings.map((mapping) => ({ ...mapping }))
    : ['name', 'event_name', 'counter', 'bib'].map((token) => ({ token, variable: token as CounterVariable }));
  return { schemaVersion: 1, email: { enabled: false, mode: 'PROVIDER_TEMPLATE', templateId: waiverEmail ? BERGTECNO_TEMPLATES.waiverCheckin.uuid : '', subject: '{{event_name}} · {{counter}}', body: 'Hello {{name}},\nYour {{counter}} has been recorded for BIB {{bib}}.', mappings: emailMappings, attachWaiver: false }, whatsapp: { enabled: false, campaignName: '', templateName: '', language: 'en', parameters: whatsappParameters, attachWaiver: false }, waiver: { urlField: 'waiverDocumentUrl', allowedOrigin: '' } };
}

export function counterEmailVariables(mappings: CounterTemplate['email']['mappings'], values: Partial<Record<CounterVariable, string>>): Record<string, string> {
  return Object.fromEntries(mappings.map(({ token, variable }) => {
    const value = values[variable]?.trim();
    if (!value) throw new Error(`Missing value for email parameter {{${token}}}: ${variable}.`);
    return [token, value];
  }));
}
export function renderCounterEmail(template: string, mappings: CounterTemplate['email']['mappings'], values: Partial<Record<CounterVariable, string>>): string {
  return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_token, key: string) => {
    const variable = mappings.find((m) => m.token === key)?.variable;
    if (!variable || !values[variable]?.trim()) throw new Error(`Missing value for email parameter {{${key}}}.`);
    return values[variable]!;
  });
}
